import { hash2 } from '../lib/math';
import type { ArtGrid } from '../subject/art';

export const C = {
  green: 0x00ff6a,
  blue: 0x0047ff,
  pink: 0xff2a8a,
  red: 0xff1a1a,
  yellow: 0xffe600,
  cyan: 0x00e5ff,
  purple: 0x8a1cff,
  black: 0x000000,
  white: 0xffffff,
};
/** 줄무늬·체크에 쓰는 고채도 팔레트 (넓은 흰 면이 대상에 구멍처럼 보이지 않도록 흰색은 제외 — 체크 한 쌍에서만 쓴다) */
export const VIVID = [C.green, C.blue, C.pink, C.red, C.yellow, C.cyan, C.purple, C.black];
/** 효과 구획 밖의 대상: 명암 4단계를 단순화한 평면 색면 */
export const BASE_LEVELS = [0x9a0020, 0xf01a30, 0xff4d8d, 0xffe600];

/** 한 박스가 한 프레임에 칠할 영역과 입력 */
export interface PatternArgs {
  grid: ArtGrid;
  /** 박스와 겹치는 셀 범위(포함) */
  i0: number;
  i1: number;
  j0: number;
  j1: number;
  /** 박스(셀 단위, 실수) */
  box: { x: number; y: number; w: number; h: number };
  time: number;
  /** 0..1 */
  I: number;
  /** hiphop: 기울기, rnb: 체크(모자이크) 비율 */
  option: number;
  /** 셀 하나를 칠한다 (대상 안쪽 셀에서만 호출) */
  put: (i: number, j: number, rgb: number) => void;
}

export type PatternEffect = (a: PatternArgs) => void;

export const tri = (v: number) => Math.abs((((v % 2) + 2) % 2) - 1) * 2 - 1; // -1..1
export const fract = (v: number) => v - Math.floor(v);
export const mod = (a: number, n: number) => ((a % n) + n) % n;
export const pick = <T,>(arr: T[], k: number) => arr[mod(Math.floor(k), arr.length)];
export const hashf = (a: number, b: number) => hash2(Math.floor(a), Math.floor(b));

/** 격자 밖이거나 대상 밖이면 -1 */
export function levelAt(g: ArtGrid, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) return -1;
  const k = j * g.cols + i;
  return g.inside[k] ? g.level[k] : -1;
}

export function toneAt(g: ArtGrid, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) return 0;
  const k = j * g.cols + i;
  return g.inside[k] ? g.tone[k] : 0;
}

export function levelOfTone(g: ArtGrid, t: number): number {
  return t < g.thr[0] ? 0 : t < g.thr[1] ? 1 : t < g.thr[2] ? 2 : 3;
}
