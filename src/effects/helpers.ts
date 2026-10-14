import { hash2 } from '../lib/math';

/** 원본 범위를 벗어나는 부분을 비례 보정해서 자른 drawImage */
export function blit(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
  const kx = dw / sw;
  const ky = dh / sh;
  let x0 = sx;
  let y0 = sy;
  let x1 = sx + sw;
  let y1 = sy + sh;
  if (x0 < 0) { dx -= x0 * kx; x0 = 0; }
  if (y0 < 0) { dy -= y0 * ky; y0 = 0; }
  if (x1 > src.width) x1 = src.width;
  if (y1 > src.height) y1 = src.height;
  if (x1 <= x0 || y1 <= y0) return;
  ctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, dx, dy, (x1 - x0) * kx, (y1 - y0) * ky);
}

/**
 * 원본의 사각 조각 (sx,sy,sw,sh) 을 평행사변형 O + u·U + v·V (u,v∈[0,1]) 로 보낸다.
 * 사선 타일, 큐브 옆면에 사용.
 */
export function blitAffine(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  ox: number,
  oy: number,
  ux: number,
  uy: number,
  vx: number,
  vy: number,
) {
  if (sw <= 0 || sh <= 0) return;
  const x0 = Math.max(sx, 0);
  const y0 = Math.max(sy, 0);
  const x1 = Math.min(sx + sw, src.width);
  const y1 = Math.min(sy + sh, src.height);
  if (x1 <= x0 || y1 <= y0) return;
  ctx.save();
  ctx.transform(ux / sw, uy / sw, vx / sh, vy / sh, ox, oy);
  ctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, x0 - sx, y0 - sy, x1 - x0, y1 - y0);
  ctx.restore();
}

export type Axis = 'h' | 'v';

/**
 * 원본의 "한 줄(두께 srcThick, 길이 1px)" 을 축 방향으로 destLen 만큼 늘려 그린다 (marquee stretch).
 * axis 'h': 가로로 늘어남 (A=x, B=y).  axis 'v': 세로로 늘어남 (A=y, B=x).
 */
export function strip(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  axis: Axis,
  srcA: number,
  srcB: number,
  srcThick: number,
  destA: number,
  destB: number,
  destLen: number,
  destThick: number,
) {
  if (destLen <= 0 || destThick <= 0) return;
  if (axis === 'h') blit(ctx, src, srcA, srcB, 1, srcThick, destA, destB, destLen, destThick);
  else blit(ctx, src, srcB, srcA, srcThick, 1, destB, destA, destThick, destLen);
}

const bandCache = new Map<string, number[]>();

/**
 * 절대 좌표 [0, extent] 를 불규칙한 두께의 밴드로 나눈 경계 목록. 캐시된다.
 * 절대 좌표 기준이라 사각형이 움직여도 밴드 구조가 유지된다 (구획은 창문처럼 동작).
 */
export function bandEdges(seed: number, extent: number, base: number, variance: number): number[] {
  const key = `${seed}|${Math.round(extent)}|${base.toFixed(1)}|${variance.toFixed(2)}`;
  let edges = bandCache.get(key);
  if (edges) return edges;
  edges = [0];
  let y = 0;
  let i = 0;
  while (y < extent) {
    y += Math.max(2, base * (1 - variance + variance * 2 * hash2(seed, i++)));
    edges.push(y);
  }
  if (bandCache.size > 64) bandCache.clear();
  bandCache.set(key, edges);
  return edges;
}

/** [lo,hi] 와 겹치는 밴드 인덱스 범위 */
export function bandRange(edges: number[], lo: number, hi: number): [number, number] {
  let a = 0;
  let b = edges.length - 2;
  let l = 0;
  let h = edges.length - 1;
  while (l < h) {
    const m = (l + h) >> 1;
    if (edges[m + 1] <= lo) l = m + 1;
    else h = m;
  }
  a = Math.max(0, l);
  l = a;
  h = edges.length - 1;
  while (l < h) {
    const m = (l + h) >> 1;
    if (edges[m] < hi) l = m + 1;
    else h = m;
  }
  b = Math.min(edges.length - 2, l - 1);
  return [a, b];
}
