/**
 * 효과 박스 — 고정된 대상 위를 탐색하는 마스크
 * ------------------------------------------------------------------
 * 장르 하나 = 박스 하나. 대상(실루엣)은 고정이고 박스만 변한다.
 *
 * 기준점: 박스마다 대상 주변에 고정된 기준점(anchor)을 하나씩 둔다. 중심 이동은 기준점 주변에서
 * 대상 너비·높이의 3~6% 범위로 제한되므로 화면 반대편으로 가거나 배경으로 나가지 않는다.
 *
 * 면적: 장르 g 의 목표 면적은 A_g = p_g · AREA_REL · (대상 경계 상자 면적). 종횡비 r 이 바뀌면
 *   width = √(A·r), height = √(A/r)
 * 로 다시 계산하므로 w·h = A 가 항상 정확히 성립한다 (움직임의 중심은 크기 변화).
 * 이 비율은 겹치거나 실루엣에 잘리기 전 사각형 면적 기준이며, 박스를 쪼개지 않는다.
 *
 * 리듬: 박스마다 독립 타이머로 [유지 → 위치 보정 또는 종횡비 변경 → 유지]. 종횡비 변경은 가로로 넓어졌다
 * 세로로 길어지는 식으로 방향을 번갈아 바꾼다. 유지 중에는 작은 떨림(종횡비·위치)만 있다.
 */
import { GENRE_IDS, GENRE_INDEX, type GenreId } from '../lib/genres';
import { clamp } from '../lib/math';

export const AREA_REL = 0.8;
export const ASPECT_MIN = 0.45;
export const ASPECT_MAX = 2.2;
const MARGIN = 0.012;

export interface Point {
  x: number;
  y: number;
  weight?: number;
}

export interface Box {
  id: GenreId;
  genre: GenreId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 마지막 갱신 시각(효과 시계). 테두리·라벨 점멸에 쓴다 */
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

/** 면적 A 의 박스가 캔버스 안에 들어오는 종횡비 구간으로 r 을 맞춘다 */
export function feasibleAspect(A: number, W: number, H: number, r: number): number {
  const mw = W * (1 - 2 * MARGIN);
  const mh = H * (1 - 2 * MARGIN);
  const fLo = A / (mh * mh);
  const fHi = (mw * mw) / A;
  const lo = Math.max(ASPECT_MIN, fLo);
  const hi = Math.min(ASPECT_MAX, fHi);
  return lo <= hi ? clamp(r, lo, hi) : clamp(r, fLo, fHi);
}

/** 기준점 후보들 중 서로 가장 멀리 떨어진 순서로 정렬 (greedy farthest-point) */
export function spreadOrder(points: Point[]): number[] {
  if (!points.length) return [];
  const first = points.reduce((b, p, i) => ((p.weight ?? 1) > (points[b].weight ?? 1) ? i : b), 0);
  const order = [first];
  while (order.length < points.length) {
    let best = -1;
    let bd = -1;
    points.forEach((p, i) => {
      if (order.includes(i)) return;
      const d = Math.min(...order.map((o) => Math.hypot(p.x - points[o].x, p.y - points[o].y)));
      if (d > bd) {
        bd = d;
        best = i;
      }
    });
    order.push(best);
  }
  return order;
}

interface State {
  id: GenreId;
  share: number;
  anchor: Point;
  /** 이동 범위(대상 크기 대비 3~6%) */
  range: number;
  lockX: number; // -1..1
  lockY: number;
  r: number;
  jx: number;
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
  private subjW = 600;
  private subjH = 700;
  private anchors: Point[] = [];
  private states: State[] = [];
  private t = 0;

  constructor(private seed = 7) {
    this.rnd = mulberry32(seed);
  }

  /** 캔버스와 대상 크기, 기준점 후보(논리 좌표)를 지정하고 박스를 새로 잡는다 */
  configure(W: number, H: number, subject: { cx: number; cy: number; w: number; h: number }, candidates: Point[], shares: GenreShare[]) {
    this.W = W;
    this.H = H;
    this.subjW = subject.w;
    this.subjH = subject.h;
    // 대상 경계 상자 안에서 후보가 부족하면 균등 배치 점으로 채운다
    const pts = candidates.filter((p) => Math.abs(p.x - subject.cx) <= subject.w * 0.5 && Math.abs(p.y - subject.cy) <= subject.h * 0.5);
    const fillSrc: Point[] = [
      [0.5, 0.5],
      [0.3, 0.3],
      [0.7, 0.3],
      [0.3, 0.7],
      [0.7, 0.7],
      [0.5, 0.2],
      [0.5, 0.8],
    ].map(([fx, fy]) => ({ x: subject.cx + (fx - 0.5) * subject.w, y: subject.cy + (fy - 0.5) * subject.h, weight: 0.5 }));
    const all = [...pts];
    for (const f of fillSrc) if (all.length < GENRE_IDS.length) all.push(f);
    const order = spreadOrder(all);
    this.anchors = GENRE_IDS.map((_, gi) => all[order[gi % order.length]]);
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
      } else next.push(this.spawn(g, sh.share));
    }
    this.states = next;
  }

  private spawn(id: GenreId, share: number): State {
    return {
      id,
      share,
      anchor: this.anchors[GENRE_INDEX[id]],
      range: 0.03 + this.rnd() * 0.03,
      lockX: (this.rnd() - 0.5) * 2,
      lockY: (this.rnd() - 0.5) * 2,
      r: Math.exp((this.rnd() - 0.5) * 1.4),
      jx: 0,
      jy: 0,
      jr: 1,
      nextEvent: this.t + 0.12 + this.rnd() * 0.3,
      nextJitter: this.t + 0.06 + this.rnd() * 0.07,
      lastEvent: this.t,
    };
  }

  private gauss() {
    return Math.sqrt(-2 * Math.log(1 - this.rnd())) * Math.cos(2 * Math.PI * this.rnd());
  }

  /** dt: 전환 빈도가 반영된 시간(초), fx: 점멸 판정용 효과 시계 */
  step(dt: number, fx: number) {
    const target = this.t + dt;
    for (const s of this.states) {
      for (let guard = 0; guard < 8; guard++) {
        if (Math.min(s.nextEvent, s.nextJitter) > target) break;
        if (s.nextEvent <= s.nextJitter) this.update(s, fx);
        else this.jitter(s);
      }
    }
    this.t = target;
  }

  private jitter(s: State) {
    s.jx = (this.rnd() - 0.5) * 0.012; // 대상 크기 대비
    s.jy = (this.rnd() - 0.5) * 0.012;
    s.jr = Math.exp((this.rnd() - 0.5) * 0.07); // 종횡비만 흔들리므로 면적은 그대로
    s.nextJitter += 0.06 + this.rnd() * 0.08;
  }

  private update(s: State, fx: number) {
    if (this.rnd() < 0.68) {
      // 종횡비 변경: 가로로 넓어졌다 세로로 길어지는 식으로 방향을 번갈아
      const dir = s.r >= 1 ? -1 : 1;
      s.r = clamp(Math.exp(dir * (0.35 + this.rnd() * 0.5) + Math.log(Math.max(0.6, Math.min(1.7, s.r))) * 0.2), ASPECT_MIN, ASPECT_MAX);
    } else {
      // 위치 보정(기준점 주변, 이동 범위 안) + 종횡비 약간 조정
      s.lockX = clamp(s.lockX + this.gauss() * 0.5, -1, 1);
      s.lockY = clamp(s.lockY + this.gauss() * 0.5, -1, 1);
      s.r = clamp(s.r * Math.exp(this.gauss() * 0.12), ASPECT_MIN, ASPECT_MAX);
    }
    s.jx = 0;
    s.jy = 0;
    s.jr = 1;
    s.lastEvent = fx;
    // 대부분 0.2~0.42 초, 가끔 길게 머문다
    s.nextEvent += 0.2 + this.rnd() * 0.22 + (this.rnd() < 0.1 ? 0.45 : 0);
    if (s.nextJitter > s.nextEvent - 0.02) s.nextJitter = Math.max(this.t, s.nextEvent - 0.02);
  }

  /** 현재 박스들 (z 순서: 배열 뒤쪽이 위, 최근 갱신 순) */
  boxes(): Box[] {
    const total = this.states.reduce((a, s) => a + s.share, 0);
    if (!total) return [];
    const W = this.W;
    const H = this.H;
    const ordered = [...this.states].sort((a, b) => a.lastEvent - b.lastEvent);
    return ordered.map((s) => {
      const A = (s.share / total) * AREA_REL * this.subjW * this.subjH;
      const r = feasibleAspect(A, W, H, s.r * s.jr);
      const { w, h } = boxSize(A, r);
      const cx = clamp(s.anchor.x + (s.lockX * s.range + s.jx) * this.subjW, w / 2 + MARGIN * W, W - w / 2 - MARGIN * W);
      const cy = clamp(s.anchor.y + (s.lockY * s.range + s.jy) * this.subjH, h / 2 + MARGIN * H, H - h / 2 - MARGIN * H);
      return { id: s.id, genre: s.id, x: cx - w / 2, y: cy - h / 2, w, h, lastEvent: s.lastEvent };
    });
  }

  /** 테스트·디버그용 */
  anchorOf(id: GenreId): Point {
    return this.anchors[GENRE_INDEX[id]];
  }
  subjectSize() {
    return { w: this.subjW, h: this.subjH };
  }
}

export function boxAreas(boxes: Box[]): Partial<Record<GenreId, number>> {
  const out: Partial<Record<GenreId, number>> = {};
  for (const b of boxes) out[b.genre] = (out[b.genre] ?? 0) + b.w * b.h;
  return out;
}
