/**
 * 독립 박스 배치 + CCTV 식 탐지·추적
 * ------------------------------------------------------------------
 * 장르 하나 = 박스 하나. 박스끼리는 분할·그리드로 묶이지 않고, 겹치거나 떨어져 있을 수 있다.
 *
 * 면적: 전체 박스 면적 합은 AREA_BUDGET·W·H 로 고정(남은 면적은 흰 여백). 장르 g 의 목표 면적은
 *   A_g = p_g · AREA_BUDGET · W · H
 * 종횡비 r 이 바뀌면 width = √(A·r), height = √(A/r) 로 다시 계산한다 → w·h = A 가 항상 정확히 성립.
 * 박스를 쪼개지 않으며, 캔버스 안에 들어오는 r 과 중심 위치만 고른다(크기를 자르거나 줄이지 않는다).
 * "겹치기 전 박스 면적 합 대비 장르 면적" = p_g 이므로 비율이 그대로 유지된다.
 *
 * 움직임: 박스마다 독립 타이머로 [탐지 → 짧은 추적(작은 떨림) → 재탐지] 를 반복한다.
 *  - 재탐지 시: 62% 같은 특징점 주변을 다시 잡음 / 23% 가까운 특징점으로 이동 / 15% 멀리 떨어진 특징점으로 크게 이동.
 *  - 위치·종횡비는 보간 없이 즉시 바뀐다.
 *  - 다른 박스가 잡고 있는 특징점은 피하고, 멀리 떨어진 곳을 선호해서 한곳에 몰리지 않는다.
 */
import { GENRE_IDS, type GenreId } from '../lib/genres';
import { clamp } from '../lib/math';
import { scatterPoints, type Point } from './features';

export const AREA_BUDGET = 0.55;
export const ASPECT_MIN = 0.5;
export const ASPECT_MAX = 2;
const MARGIN = 0.012;
/** 장르별 선호 종횡비(w/h): 가로형·세로형·정사각형이 섞이도록 */
const PREF_ASPECT: Record<GenreId, number> = { pop: 1.05, hiphop: 1.6, electronic: 1.9, rock: 0.8, rnb: 0.62 };

export interface Box {
  id: GenreId;
  genre: GenreId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 마지막 재탐지 시각(효과 시계). 테두리·라벨 점멸에 쓴다 */
  lastEvent: number;
}

export interface GenreShare {
  id: GenreId;
  share: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const boxSize = (A: number, r: number) => ({ w: Math.sqrt(A * r), h: Math.sqrt(A / r) });

/** 면적 A 의 박스가 캔버스(여백 포함) 안에 들어오는 종횡비 구간으로 r 을 맞춘다 */
export function feasibleAspect(A: number, W: number, H: number, r: number): number {
  const mw = W * (1 - 2 * MARGIN);
  const mh = H * (1 - 2 * MARGIN);
  const fLo = A / (mh * mh);
  const fHi = (mw * mw) / A;
  const lo = Math.max(ASPECT_MIN, fLo);
  const hi = Math.min(ASPECT_MAX, fHi);
  return lo <= hi ? clamp(r, lo, hi) : clamp(r, fLo, fHi);
}

interface State {
  id: GenreId;
  share: number;
  anchor: number; // features 인덱스
  lockX: number; // 박스 크기에 대한 비율 (-0.3..0.3)
  lockY: number;
  r: number;
  jx: number; // 떨림 (W 비율)
  jy: number;
  jr: number;
  nextEvent: number;
  nextJitter: number;
  lastEvent: number;
}

export class BoxTracker {
  private rnd: () => number;
  private W = 1600;
  private H = 1200;
  private feat: Point[] = [];
  private states: State[] = [];
  private t = 0;

  constructor(private seed = 7) {
    this.rnd = mulberry32(seed);
  }

  /** 캔버스 크기와 특징점(논리 좌표)을 지정하고 박스를 새로 잡는다 */
  configure(W: number, H: number, features: Point[], shares: GenreShare[]) {
    this.W = W;
    this.H = H;
    const inside = features.filter((p) => p.x > 0.05 * W && p.x < 0.95 * W && p.y > 0.05 * H && p.y < 0.95 * H);
    const fill = scatterPoints(Math.max(0, 10 - inside.length)).map((p) => ({ x: p.x * W, y: p.y * H, weight: 0.5 }));
    // 대상 주변의 배경 쪽 지점(낮은 가중치): 모든 박스가 대상 한가운데에만 모이지 않도록 한다
    const rim = [
      [0.14, 0.22],
      [0.86, 0.24],
      [0.13, 0.78],
      [0.87, 0.8],
    ].map(([x, y]) => ({ x: x * W, y: y * H, weight: 0.55 }));
    this.feat = [...inside, ...fill, ...rim];
    this.rnd = mulberry32(this.seed);
    this.states = [];
    this.t = 0;
    this.setShares(shares);
  }

  setShares(shares: GenreShare[]) {
    const live = shares.filter((s) => s.share > 0);
    const keep = new Map(this.states.map((s) => [s.id, s]));
    const next: State[] = [];
    for (const g of GENRE_IDS) {
      const sh = live.find((s) => s.id === g);
      if (!sh) continue;
      const prev = keep.get(g);
      if (prev) {
        prev.share = sh.share;
        next.push(prev);
      } else {
        next.push(this.spawn(g, sh.share, next));
      }
    }
    this.states = next;
  }

  private spawn(id: GenreId, share: number, others: State[]): State {
    return {
      id,
      share,
      anchor: this.pickFeature(-1, others, 'jump'),
      lockX: (this.rnd() - 0.5) * 0.7,
      lockY: (this.rnd() - 0.5) * 0.7,
      r: this.pickAspect(id),
      jx: 0,
      jy: 0,
      jr: 1,
      nextEvent: this.t + 0.15 + this.rnd() * 0.3,
      nextJitter: this.t + 0.06 + this.rnd() * 0.07,
      lastEvent: this.t,
    };
  }

  private gauss() {
    return Math.sqrt(-2 * Math.log(1 - this.rnd())) * Math.cos(2 * Math.PI * this.rnd());
  }

  private pickAspect(id: GenreId, around?: number) {
    const mu =
      around !== undefined ? Math.log(around) * 0.6 + Math.log(PREF_ASPECT[id]) * 0.4 : Math.log(PREF_ASPECT[id]);
    return clamp(Math.exp(mu + 0.28 * this.gauss()), ASPECT_MIN, ASPECT_MAX);
  }

  /** 다른 박스가 잡지 않은 특징점 선택. 'near' 는 현재 앵커의 가까운 이웃, 'jump' 는 먼 곳 선호 */
  private pickFeature(cur: number, others: State[], mode: 'near' | 'jump'): number {
    const taken = new Set(others.map((o) => o.anchor));
    const centers = others.map((o) => this.feat[o.anchor]);
    const cand: { i: number; wgt: number }[] = [];
    this.feat.forEach((f, i) => {
      if (i === cur && mode === 'near') return;
      if (taken.has(i) && taken.size < this.feat.length) return;
      let wgt = f.weight;
      if (mode === 'near' && cur >= 0) {
        const d = Math.hypot(f.x - this.feat[cur].x, f.y - this.feat[cur].y) / this.W;
        wgt *= d < 0.28 ? 1 / (0.04 + d) : 0.02; // 가까운 이웃 위주
      } else {
        const dmin = centers.length
          ? Math.min(...centers.map((c) => Math.hypot(f.x - c.x, f.y - c.y))) / this.W
          : 0.5;
        wgt *= 0.15 + dmin; // 다른 박스에서 먼 곳 선호
      }
      cand.push({ i, wgt });
    });
    if (!cand.length) return cur >= 0 ? cur : 0;
    const sum = cand.reduce((a, c) => a + c.wgt, 0);
    let u = this.rnd() * sum;
    for (const c of cand) {
      u -= c.wgt;
      if (u <= 0) return c.i;
    }
    return cand[cand.length - 1].i;
  }

  /** dt: 전환 빈도가 반영된 시간(초), fx: 점멸 판정용 효과 시계 */
  step(dt: number, fx: number) {
    const target = this.t + dt;
    for (const s of this.states) {
      for (let guard = 0; guard < 8; guard++) {
        if (Math.min(s.nextEvent, s.nextJitter) > target) break;
        if (s.nextEvent <= s.nextJitter) this.redetect(s, fx);
        else this.jitter(s);
      }
    }
    this.t = target;
  }

  private jitter(s: State) {
    s.jx = (this.rnd() - 0.5) * 0.02;
    s.jy = (this.rnd() - 0.5) * 0.02;
    s.jr = Math.exp((this.rnd() - 0.5) * 0.08); // 종횡비만 흔들리므로 면적은 그대로
    s.nextJitter += 0.06 + this.rnd() * 0.08;
  }

  private redetect(s: State, fx: number) {
    const others = this.states.filter((o) => o !== s);
    const u = this.rnd();
    if (u < 0.62) {
      // 같은 특징점 주변을 다시 잡는다
      s.lockX = clamp(s.lockX + this.gauss() * 0.12, -0.4, 0.4);
      s.lockY = clamp(s.lockY + this.gauss() * 0.12, -0.4, 0.4);
      s.r = this.pickAspect(s.id, s.r * s.jr);
    } else {
      s.anchor = this.pickFeature(s.anchor, others, u < 0.85 ? 'near' : 'jump');
      s.lockX = (this.rnd() - 0.5) * 0.75;
      s.lockY = (this.rnd() - 0.5) * 0.75;
      s.r = this.pickAspect(s.id);
    }
    s.jx = 0;
    s.jy = 0;
    s.jr = 1;
    s.lastEvent = fx;
    // 대부분 0.2~0.42 초, 가끔 길게 머문다
    s.nextEvent += 0.2 + this.rnd() * 0.22 + (this.rnd() < 0.1 ? 0.45 : 0);
    if (s.nextJitter > s.nextEvent - 0.02) s.nextJitter = Math.max(this.t, s.nextEvent - 0.02);
  }

  /** 현재 박스들 (z 순서: 배열 뒤쪽이 위, 최근 재탐지 순) */
  boxes(): Box[] {
    const total = this.states.reduce((a, s) => a + s.share, 0);
    if (!total) return [];
    const W = this.W;
    const H = this.H;
    // 가장 최근에 재탐지한 박스가 맨 위 (겹친 곳은 맨 위 박스의 효과만 보인다)
    const ordered = [...this.states].sort((a, b) => a.lastEvent - b.lastEvent);
    return ordered.map((s) => {
      const A = (s.share / total) * AREA_BUDGET * W * H;
      const r = feasibleAspect(A, W, H, s.r * s.jr);
      const { w, h } = boxSize(A, r);
      const f = this.feat[s.anchor];
      const cx = clamp(f.x + s.lockX * w + s.jx * W, w / 2 + MARGIN * W, W - w / 2 - MARGIN * W);
      const cy = clamp(f.y + s.lockY * h + s.jy * W, h / 2 + MARGIN * H, H - h / 2 - MARGIN * H);
      return { id: s.id, genre: s.id, x: cx - w / 2, y: cy - h / 2, w, h, lastEvent: s.lastEvent };
    });
  }

  /** 테스트·디버그용: 각 박스가 잡고 있는 특징점 인덱스 */
  anchors(): number[] {
    return this.states.map((s) => s.anchor);
  }

  featureCount() {
    return this.feat.length;
  }
}

export function boxAreas(boxes: Box[]): Partial<Record<GenreId, number>> {
  const out: Partial<Record<GenreId, number>> = {};
  for (const b of boxes) out[b.genre] = (out[b.genre] ?? 0) + b.w * b.h;
  return out;
}
