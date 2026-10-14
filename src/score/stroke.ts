// 사용자가 그린 한 획(스트로크)의 그래픽 데이터와, 그리는 동안의 소리 파라미터를 만든다.
// 좌표는 월드 단위: 커버 중심 (0,0), 커버 한 변 1000 (커버 = [-500, 500]²).

import { VOWEL_TEXT, VOWELS, type HitKind, type SustainKind, type SustainParams } from './audio/sounds';
import type { StrokeAudio } from './audio/scoreEngine';
import { MIN_HIT_BEATS, RIBBON, SPACING } from './config';

export type Brush = 'ribbon' | 'arc' | 'hatch' | 'shape' | 'band' | 'choir';
export type Vec = { x: number; y: number };

export const BRUSH_KEYS: Record<string, Brush> = { '1': 'arc', '2': 'hatch', '3': 'shape', '4': 'band', '5': 'choir' };
export const BRUSH_LABEL: Record<Brush, string> = {
  ribbon: '이미지 띠',
  arc: '원호',
  hatch: '사선 묶음',
  shape: '도형',
  band: '곡선 띠',
  choir: '코러스',
};

export interface PathPt {
  x: number;
  y: number;
  /** 스트로크 시작부터 경과 시간(초) */
  t: number;
  /** 누적 길이 */
  s: number;
  /** 곡선 띠의 기본 굵기 */
  w: number;
}

export type ElemType = 'arc' | 'ring' | 'hatch' | 'circle' | 'triangle' | 'square' | 'glyph';

export interface Elem {
  type: ElemType;
  x: number;
  y: number;
  angle: number;
  size: number;
  weight: number;
  variant: number;
  /** 원호: 중심·반지름·각도 */
  arc?: { cx: number; cy: number; r: number; a0: number; a1: number; ccw: boolean };
  hit: HitKind | null;
  /** 글자 (코러스 브러시) */
  ch?: string;
  /** 그린 시각(스트로크 기준 초) */
  t: number;
  /** 확정 후: 루프 재생 시 청크 안 발음 시각 */
  local?: number;
  /** 그리는 순간 튀어나오는 표시용 (performance.now 초) */
  born: number;
}

/** 이미지 스트레치의 직사각형 단면 하나 (축 정렬, 모서리 각짐) */
export interface RibbonSlice {
  /** 중심 */
  x: number;
  y: number;
  /** 진행 방향이 가로인지 */
  horiz: boolean;
  /** 진행 방향 길이 */
  len: number;
  /** 단면 폭 */
  w: number;
  /** 만들어진 시각(스트로크 기준) */
  t: number;
  /** 단면 안의 줄 색 (폭 방향 위→아래 또는 왼→오른쪽) */
  colors: string[];
}

export interface RibbonTex {
  origin: Vec;
  /** 원본 커버에서 읽는 단면(슬릿)이 세로선인지 */
  slitVertical: boolean;
  /** 원본을 읽어 들어가는 방향 부호 (당기는 반대쪽) */
  sign: number;
  slices: RibbonSlice[];
}

/** 시작점 주변과 초반 경로의 작은 점광 */
export interface Spark {
  x: number;
  y: number;
  r: number;
  /** 반짝임이 퍼지는 순서용 지연(초) */
  delay: number;
}

export interface Stroke {
  id: number;
  brush: Brush;
  color: string;
  path: PathPt[];
  elems: Elem[];
  ribbon: RibbonTex | null;
  sparks: Spark[];
  sustain: { kind: SustainKind; slice: number } | null;
  /** AudioContext 시각 */
  startTime: number;
  duration: number;
  audio: StrokeAudio | null;
}

export type CoverSampler = (x: number, y: number) => [number, number, number];

/** 스트로크 번호로 고정된 의사난수 (같은 그림은 같은 형태) */
export function prng(seed: number) {
  let a = seed * 2654435761;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 코러스: 시작 높이로 모음 결정 (위 AHH · 가운데 OOH · 아래 HMM). 한 스트로크 안에서는 유지 */
export const vowelIndexAt = (y: number) => (y < -170 ? 0 : y > 170 ? 2 : 1);

export const inCover = (p: Vec) => Math.abs(p.x) <= 500 && Math.abs(p.y) <= 500;

/** 위아래 위치 → 밝기 0~1 (위가 밝음). 커버 위·아래 여백까지 포함한 범위 */
export const brightOf = (y: number) => Math.min(1, Math.max(0, 0.5 - y / 1500));

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 원호의 시작·끝 각도와 방향: 현(chord) A→B 위에 side 쪽으로 볼록 */
function arcOnChord(a: Vec, b: Vec, rFactor: number, side: number) {
  const c = Math.hypot(b.x - a.x, b.y - a.y);
  const r = (c / 2) * rFactor;
  const h = Math.sqrt(Math.max(0, r * r - (c / 2) ** 2));
  const ux = (b.x - a.x) / c;
  const uy = (b.y - a.y) / c;
  const nx = -uy * side;
  const ny = ux * side;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const cx = mx - nx * h;
  const cy = my - ny * h;
  const bulge = { x: mx + nx * (r - h), y: my + ny * (r - h) };
  const a0 = Math.atan2(a.y - cy, a.x - cx);
  const a1 = Math.atan2(b.y - cy, b.x - cx);
  const am = Math.atan2(bulge.y - cy, bulge.x - cx);
  const norm = (v: number) => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = norm(am - a0) > norm(a1 - a0);
  return { cx, cy, r, a0, a1, ccw };
}

export interface BuilderOut {
  /** 이번 입력으로 새로 생긴 타격 요소 (소리를 낼 것) */
  spawned: Elem[];
}

/**
 * 입력 점들을 받아 스트로크를 만들어 간다.
 * - 입력을 일정 간격(step)으로 다시 찍고 1차 저역 필터로 살짝 다듬는다 (손떨림은 남기고 지글거림만 줄임)
 * - 반복 도형은 포인터 이벤트 수가 아니라 이동 거리 기준으로 배치
 * - 타격음은 스트로크 안에서 최소 간격(MIN_HIT_BEATS)을 지키며, 그때만 도형을 놓는다
 */
export class StrokeBuilder {
  readonly stroke: Stroke;
  private last: Vec;
  private smooth: Vec;
  private sinceElem = 0;
  private lastHitT = -Infinity;
  private count = 0;
  speed = 0;
  private lastMoveT = 0;
  private start: Vec;
  readonly hits: { s: number; kind: HitKind; bright: number; elem: number }[] = [];
  private rnd: () => number;
  private nextSparkS = 30;
  private glyphCount = 0;
  private sliceRun = 0;
  private sliceLevel = 2;
  private sliceOff = 0;
  private nextSliceS = 0;
  readonly auto: { s: number; v: number[] }[] = [];

  constructor(
    id: number,
    brush: Brush,
    p: Vec,
    startTime: number,
    color: string,
    private readonly spb: number,
    private readonly sampler: CoverSampler | null,
    sliceCount: number,
  ) {
    this.start = p;
    this.last = p;
    this.smooth = p;
    this.rnd = prng(id);
    const sustain: Stroke['sustain'] =
      brush === 'ribbon'
        ? // 커버의 어느 영역을 잡았는지(4×2 구역)로 원곡 조각을 고정 → 같은 자리 = 같은 소리
          { kind: 'ribbon', slice: (Math.min(3, Math.floor(((p.x + 500) / 1000) * 4)) + 4 * (p.y > 0 ? 1 : 0)) % sliceCount }
        : brush === 'band'
          ? { kind: 'band', slice: 0 }
          : brush === 'choir'
            ? { kind: 'choir', slice: vowelIndexAt(p.y) }
            : null;
    // 시작점 주변에 모인 작은 점들 (크기·간격에 작은 차이)
    const sparks: Spark[] = [];
    const n = 5 + Math.floor(this.rnd() * 3);
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const d = 10 + this.rnd() * 26;
      sparks.push({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 3.5 + this.rnd() * 4.5, delay: i * 0.025 });
    }
    this.stroke = {
      id,
      brush,
      color,
      path: [{ x: p.x, y: p.y, t: 0, s: 0, w: 0 }],
      elems: [],
      ribbon: null,
      sparks,
      sustain,
      startTime,
      duration: 0,
      audio: null,
    };
  }

  get brush() {
    return this.stroke.brush;
  }

  /** 누르는 순간: 사선 묶음·도형은 첫 요소를 바로 놓아 즉시 소리 낸다 (원호는 움직여야 현이 생김) */
  begin(nowPerf: number): BuilderOut {
    const out: BuilderOut = { spawned: [] };
    if (this.stroke.brush === 'hatch' || this.stroke.brush === 'shape') {
      this.sinceElem = Infinity;
      this.onPoint(this.stroke.path[0], out, 0, nowPerf);
    }
    if (this.stroke.brush === 'choir') this.placeGlyph(this.stroke.path[0], 0, 0, nowPerf);
    return out;
  }

  /** 놓는 순간: OOH 처럼 끝 글자가 다른 발성은 마지막 글자를 붙인다 */
  end(t: number, nowPerf: number) {
    const st = this.stroke;
    if (st.brush !== 'choir' || !st.sustain) return;
    const word = VOWEL_TEXT[VOWELS[st.sustain.slice]];
    if (word[2] === word[1] || this.glyphCount < 2) return;
    const i = st.path.length - 1;
    const tan = this.tangent(i);
    const last = st.path[i];
    this.placeGlyph({ ...last, x: last.x + tan.x * 52, y: last.y + tan.y * 52 }, Math.atan2(tan.y, tan.x), t, nowPerf, word[2]);
  }

  /** 코러스 글자 하나: 선 위에 놓고 곡선 방향을 따라 조금씩 회전 */
  private placeGlyph(pt: { x: number; y: number }, ang: number, t: number, nowPerf: number, force?: string) {
    const st = this.stroke;
    const word = VOWEL_TEXT[VOWELS[st.sustain!.slice]];
    const g = this.glyphCount++;
    const ch = force ?? (g === 0 ? word[0] : word[1]);
    const tilt = [0.12, -0.18, 0.05, -0.08, 0.2][g % 5];
    st.elems.push({
      type: 'glyph',
      ch,
      x: pt.x,
      y: pt.y,
      angle: ang + tilt,
      size: [70, 57, 64, 53, 76][g % 5] * (g === 0 ? 1.15 : 1),
      weight: 1,
      variant: g,
      hit: null,
      t,
      born: nowPerf,
    });
    // 세 글자마다 글자에서 가는 곡선 가지 하나 (선과 글자가 한 그래픽으로 엮이도록)
    if (g % 3 === 1) {
      const side = g % 2 ? 1 : -1;
      const r = 46 + (g % 4) * 14;
      const nx = -Math.sin(ang) * side;
      const ny = Math.cos(ang) * side;
      const cx = pt.x + nx * r;
      const cy = pt.y + ny * r;
      const a0 = Math.atan2(pt.y - cy, pt.x - cx);
      st.elems.push({
        type: 'ring',
        x: cx,
        y: cy,
        angle: ang,
        size: r,
        weight: 2,
        variant: g,
        arc: { cx, cy, r, a0, a1: a0 + side * 1.6, ccw: side < 0 },
        hit: null,
        t,
        born: nowPerf,
      });
    }
  }

  /** 새 포인터 위치. t: 스트로크 시작부터의 시간 */
  add(raw: Vec, t: number, nowPerf: number): BuilderOut {
    const dt = Math.max(1e-3, t - this.lastMoveT);
    const d = Math.hypot(raw.x - this.last.x, raw.y - this.last.y);
    // 속도: 짧은 지수 평균
    this.speed += (d / dt - this.speed) * Math.min(1, dt / 0.08);
    this.lastMoveT = t;
    this.last = raw;
    return this.follow(t, nowPerf);
  }

  /** 마우스가 멈춰 있을 때: 속도를 0 쪽으로, 다듬은 점은 마지막 위치까지만 따라간다 (새 도형은 거의 생기지 않음) */
  idle(t: number, nowPerf: number): BuilderOut {
    const dt = t - this.lastMoveT;
    if (dt > 0.05) this.speed *= Math.exp(-(dt - 0.05) / 0.12);
    return this.follow(t, nowPerf);
  }

  /** 1차 저역 필터로 다듬은 점을 따라 일정 간격으로 경로 점을 찍는다 */
  private follow(t: number, nowPerf: number): BuilderOut {
    const out: BuilderOut = { spawned: [] };
    const st = this.stroke;
    const step = st.brush === 'ribbon' || st.brush === 'band' ? RIBBON.step : 4;
    this.smooth = { x: this.smooth.x + (this.last.x - this.smooth.x) * 0.5, y: this.smooth.y + (this.last.y - this.smooth.y) * 0.5 };
    let prev = st.path[st.path.length - 1];
    for (let guard = 0; guard < 300; guard++) {
      const dx = this.smooth.x - prev.x;
      const dy = this.smooth.y - prev.y;
      const dist = Math.hypot(dx, dy);
      if (dist < step) break;
      const np: PathPt = {
        x: prev.x + (dx / dist) * step,
        y: prev.y + (dy / dist) * step,
        t,
        s: prev.s + step,
        // 곡선 띠: 빠르게 그리면 가늘게, 천천히 그리면 넓게
        w: st.brush === 'band' ? 70 * (1.2 - 0.6 * clamp01(this.speed / 1600)) : 0,
      };
      st.path.push(np);
      this.onPoint(np, out, t, nowPerf);
      prev = np;
    }
    st.duration = Math.max(st.duration, t);
    return out;
  }

  private tangent(i: number): Vec {
    const p = this.stroke.path;
    const a = p[Math.max(0, i - 4)];
    const b = p[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  }

  private onPoint(pt: PathPt, out: BuilderOut, t: number, nowPerf: number) {
    const st = this.stroke;
    const i = st.path.length - 1;
    // 초반 경로(약 300 단위)를 따라 듬성듬성 점광
    if (pt.s >= this.nextSparkS && pt.s < 300 && i > 1) {
      const tan = this.tangent(i);
      const side = this.rnd() < 0.5 ? -1 : 1;
      const off = (st.brush === 'ribbon' ? RIBBON.width * 0.6 : 14) + this.rnd() * 14;
      st.sparks.push({ x: pt.x - tan.y * off * side, y: pt.y + tan.x * off * side, r: 2.8 + this.rnd() * 3.2, delay: 0.12 + pt.s / 1200 });
      this.nextSparkS = pt.s + 38 + this.rnd() * 40;
    }
    if (st.brush === 'ribbon') {
      this.extendRibbon(i, t);
      return;
    }
    if (st.brush === 'band') return;
    if (st.brush === 'choir') {
      // 이동 거리 기준으로 글자 배치. 빠르게 그리면 간격이 넓어진다 (A—H—H—H)
      this.sinceElem += Math.hypot(pt.x - st.path[i - 1].x, pt.y - st.path[i - 1].y);
      const gap = 104 + 70 * clamp01(this.speed / 1600) + [0, 22, 8, 34][this.glyphCount % 4];
      if (this.sinceElem >= gap) {
        this.sinceElem = 0;
        const tan = this.tangent(i);
        this.placeGlyph(pt, Math.atan2(tan.y, tan.x), t, nowPerf);
      }
      return;
    }
    if (i > 0) this.sinceElem += Math.hypot(pt.x - st.path[i - 1].x, pt.y - st.path[i - 1].y);
    const spacing = SPACING[st.brush];
    // 거리 + 최소 시간 간격을 모두 만족할 때만 다음 요소
    if (this.sinceElem < spacing || t - this.lastHitT < MIN_HIT_BEATS * this.spb) return;
    this.sinceElem = 0;
    this.lastHitT = t;
    const tan = this.tangent(i);
    const ang = Math.atan2(tan.y, tan.x);
    const nrm = { x: -tan.y, y: tan.x };
    const v = this.count++;
    const sp = clamp01(this.speed / 1600);
    const bright = brightOf(pt.y);
    const make = (e: Omit<Elem, 't' | 'born' | 'variant'>): Elem => ({ ...e, variant: v, t, born: nowPerf });
    let el: Elem;
    if (st.brush === 'arc') {
      // 이전 요소 자리(또는 시작점)에서 지금 자리까지를 현으로 하는 원호. 크기·방향·굵기를 4박자 패턴으로
      const prevEl = [...st.elems].reverse().find((e) => e.type === 'arc');
      const a = prevEl ? { x: prevEl.x, y: prevEl.y } : st.path[Math.max(0, i - Math.round(spacing / 4))];
      const rF = [1, 1.6, 1.05, 2.4][v % 4];
      const side = [1, -1, 1, 1][v % 4];
      el = make({
        type: 'arc',
        x: pt.x,
        y: pt.y,
        angle: ang,
        size: spacing,
        weight: [9, 3.2, 4, 6.5][v % 4],
        arc: arcOnChord(a, pt, rF, side),
        hit: 'pluck',
      });
      st.elems.push(el);
      // 세 번에 한 번, 바깥에 작은 끊어진 원 (소리 없음)
      if (v % 3 === 2) {
        const r = 16 + (v % 2) * 10;
        const cx = pt.x + nrm.x * 42 * side;
        const cy = pt.y + nrm.y * 42 * side;
        st.elems.push({
          type: 'ring',
          x: cx,
          y: cy,
          angle: ang,
          size: r,
          weight: 3,
          variant: v,
          arc: { cx, cy, r, a0: ang + 0.6, a1: ang + 0.6 + 4.6, ccw: false },
          hit: null,
          t,
          born: nowPerf,
        });
      }
    } else if (st.brush === 'hatch') {
      el = make({
        type: 'hatch',
        x: pt.x,
        y: pt.y,
        angle: ang,
        size: 62 + (v % 3) * 16,
        weight: 3.4,
        // 짝수 = 하이햇, 홀수 = 셰이커
        hit: v % 2 === 0 ? 'hat' : 'shaker',
      });
      st.elems.push(el);
    } else {
      // 원 → 삼각형 → 사각형 순환. 같은 도형 = 같은 소리
      const type = (['circle', 'triangle', 'square'] as const)[v % 3];
      const side = v % 2 ? 1 : -1;
      const size = (type === 'circle' ? 24 : type === 'triangle' ? 44 : 36) * (1.25 - 0.5 * sp);
      el = make({
        type,
        x: pt.x + nrm.x * 26 * side,
        y: pt.y + nrm.y * 26 * side,
        angle: ang + (type === 'square' ? 0.2 : 0),
        size,
        weight: type === 'triangle' ? 6 : 4.2,
        hit: type === 'circle' ? 'kick' : type === 'triangle' ? 'perc' : 'click',
      });
      st.elems.push(el);
    }
    this.hits.push({ s: t, kind: el.hit!, bright, elem: st.elems.indexOf(el) });
    out.spawned.push(el);
  }

  /**
   * 이미지 스트레치: 커버의 좁은 직선 단면(슬릿)을 읽어, 경로를 따라 직사각형 단면을 작은 간격으로 이어 붙인다.
   * - 단면은 축 정렬 직사각형(모서리 각짐). 진행 방향이 바뀌면 둥근 접합 대신 가로↔세로로 꺾인 단차가 생긴다
   * - 폭·옆 위치는 몇 개마다 한 단계씩만 바뀌어 계단형 외곽이 된다 (스트로크 번호로 고정된 순서, 매 프레임 흔들지 않음)
   * - 단면끼리 겹치게 놓아 하나의 이미지 덩어리로 보이게
   */
  private extendRibbon(i: number, t: number) {
    const st = this.stroke;
    if (!this.sampler) return;
    const pt = st.path[i];
    if (!st.ribbon) {
      // 처음 20 단위 움직인 방향으로 슬릿 방향을 정한다 (가로로 당기면 세로 슬릿)
      if (pt.s < 20) return;
      const p0 = st.path[0];
      const dx = pt.x - p0.x;
      const dy = pt.y - p0.y;
      const horiz = Math.abs(dx) >= Math.abs(dy);
      st.ribbon = { origin: { x: p0.x, y: p0.y }, slitVertical: horiz, sign: horiz ? -Math.sign(dx || 1) : -Math.sign(dy || 1), slices: [] };
      this.nextSliceS = 0;
    }
    const rb = st.ribbon;
    while (this.nextSliceS <= pt.s) {
      const j = Math.max(1, Math.min(i, Math.round(this.nextSliceS / RIBBON.step)));
      const p = st.path[j];
      // 진행 축: 최근 구간 방향. 다른 축이 확실히 우세할 때만 바꿔 깜빡이지 않게
      const tan = this.tangent(j);
      const prev = rb.slices[rb.slices.length - 1];
      let horiz = prev ? prev.horiz : Math.abs(tan.x) >= Math.abs(tan.y);
      if (prev && (horiz ? Math.abs(tan.y) > Math.abs(tan.x) * 1.35 : Math.abs(tan.x) > Math.abs(tan.y) * 1.35)) horiz = !horiz;
      // 몇 개마다 폭·옆 위치를 한 단계씩
      if (this.sliceRun-- <= 0) {
        this.sliceRun = 2 + Math.floor(this.rnd() * 5);
        this.sliceLevel = Math.min(4, Math.max(0, this.sliceLevel + (this.rnd() < 0.5 ? -1 : 1)));
        this.sliceOff = Math.min(2, Math.max(-2, this.sliceOff + (this.rnd() < 0.5 ? -1 : 1)));
      }
      const w = RIBBON.width * [0.66, 0.8, 0.92, 1.05, 1.18][this.sliceLevel];
      const snap = (v: number) => Math.round(v / 4) * 4;
      const off = this.sliceOff * 9;
      const cx = snap(p.x + (horiz ? 0 : off));
      const cy = snap(p.y + (horiz ? off : 0));
      // 원본에서 읽는 깊이: 당긴 길이를 줄여서, 잡은 자리 안쪽으로
      const depth = rb.sign * Math.min(p.s / RIBBON.stretch, RIBBON.maxDepth);
      const colors: string[] = [];
      const N = RIBBON.lanes;
      for (let k = 0; k < N; k++) {
        const off2 = -RIBBON.sourceWidth / 2 + ((k + 0.5) * RIBBON.sourceWidth) / N;
        const sx = rb.slitVertical ? rb.origin.x + depth : rb.origin.x + off2;
        const sy = rb.slitVertical ? rb.origin.y + off2 : rb.origin.y + depth;
        const [r, g, b] = this.sampler(sx, sy);
        colors.push(`rgb(${r | 0},${g | 0},${b | 0})`);
      }
      // 첫 단면은 커버에서 막 밀려 나오듯 짧고 좁게
      const grow = Math.min(1, 0.45 + rb.slices.length / 8);
      rb.slices.push({ x: cx, y: cy, horiz, len: RIBBON.sliceStep * 1.9, w: w * grow, t, colors });
      this.nextSliceS += RIBBON.sliceStep;
    }
  }

  /** 지속음 파라미터: 브러시 규칙에 따른 현재 값 */
  sustainParams(): SustainParams {
    const st = this.stroke;
    const sp = clamp01(this.speed / 1600);
    const cur = st.path[st.path.length - 1];
    if (st.brush === 'ribbon') {
      // 당긴 거리 → 필터가 열림, 이동 속도 → 음량·공진
      const d01 = clamp01(Math.hypot(cur.x - this.start.x, cur.y - this.start.y) / 650);
      return [380 * Math.pow(2, d01 * 5.1), (0.16 + 0.34 * d01) * (0.35 + 0.65 * sp), 0.7 + 5 * sp];
    }
    if (st.brush === 'choir') {
      // 코러스: 위아래 → 밝기(입 모양은 모음으로 고정), 속도 → 음량. 멈춰 있어도 발성은 이어진다
      const y01 = brightOf(cur.y);
      return [900 * Math.pow(2, y01 * 3.2), 0.36 + 0.3 * sp, 0.7];
    }
    // 곡선 띠: 위아래 → 밝기, 속도 → 음량·공진
    const y01 = brightOf(cur.y);
    return [260 * Math.pow(2, y01 * 5.4), 0.05 + 0.3 * sp, 1 + 7 * sp];
  }

  recordAuto(t: number, v: SustainParams) {
    this.auto.push({ s: t, v: [...v] });
  }
}

/** 확정 후: 각 타격 요소에 루프 재생 시각을 붙인다 (그래픽 강조용) */
export function attachLocalTimes(st: Stroke) {
  const a = st.audio;
  if (!a) return;
  for (const ch of a.chunks)
    for (const h of ch.hits) {
      const el = st.elems[h.elem];
      if (el) el.local = h.local;
    }
}
