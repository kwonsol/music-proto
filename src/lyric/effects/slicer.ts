import type { Glyph } from '../render/glyphs';

/**
 * 슬라이스 재배치 도구.
 * 글자 비트맵을 1px(또는 step px) 띠 단위로 잘라 다른 위치·높이로 다시 그린다.
 * 이것이 scale/rotate 가 아닌 "글자 내부 변형"의 바탕이다.
 */

export interface SliceOut {
  /** 출력 띠가 가져올 원본 위치 (행 또는 열, 소수 허용) */
  src: number;
  /** 출력 1px 당 원본 몇 px 을 쓰는지. <1 이면 늘어남(같은 행 반복), >1 이면 압축 */
  rate: number;
  /** 띠의 수직 축 변위 (행이면 x 변위, 열이면 y 변위) */
  shift: number;
  /** 띠 길이 배율 (행이면 가로폭 배율, 글자 중심 기준) */
  scale: number;
}

const OUT: SliceOut = { src: 0, rate: 1, shift: 0, scale: 1 };

function reset() {
  OUT.src = 0;
  OUT.rate = 1;
  OUT.shift = 0;
  OUT.scale = 1;
  return OUT;
}

/**
 * 행 단위 재배치. 출력 행 o ∈ [from, to) 마다 map 을 호출한다.
 * 같은 변위·연속된 원본이 이어지면 한 번에 그려 호출 수를 줄인다.
 */
export function drawRows(
  ctx: CanvasRenderingContext2D,
  g: Glyph,
  x: number,
  y: number,
  from: number,
  to: number,
  step: number,
  map: (o: number, out: SliceOut) => boolean,
  source: CanvasImageSource = g.canvas,
) {
  let runO = 0, runSrc = 0, runLen = 0, runShift = 0, active = false;
  const flush = () => {
    if (active && runLen > 0) ctx.drawImage(source, 0, runSrc, g.w, runLen, x + runShift, y + runO, g.w, runLen);
    active = false;
  };
  for (let o = from; o < to; o += step) {
    if (!map(o, reset())) {
      flush();
      continue;
    }
    let sy = Math.floor(OUT.src);
    let sh = Math.max(1, Math.round(OUT.rate * step));
    if (sy >= g.h || sy + sh <= 0) {
      flush();
      continue;
    }
    if (sy < 0) {
      sh += sy;
      sy = 0;
    }
    if (sy + sh > g.h) sh = g.h - sy;
    const shift = Math.round(OUT.shift);
    if (OUT.scale !== 1) {
      flush();
      const dw = g.w * OUT.scale;
      ctx.drawImage(source, 0, sy, g.w, sh, x + shift + (g.w - dw) / 2, y + o, dw, step);
      continue;
    }
    const identity = sh === step;
    if (identity && active && shift === runShift && sy === runSrc + runLen && o === runO + runLen) {
      runLen += step;
      continue;
    }
    flush();
    if (identity) {
      active = true;
      runO = o;
      runSrc = sy;
      runLen = step;
      runShift = shift;
    } else {
      ctx.drawImage(source, 0, sy, g.w, sh, x + shift, y + o, g.w, step);
    }
  }
  flush();
}

/** 열 단위 재배치. drawRows 의 축을 바꾼 버전 (shift = y 변위, scale = 세로 길이 배율). */
export function drawCols(
  ctx: CanvasRenderingContext2D,
  g: Glyph,
  x: number,
  y: number,
  from: number,
  to: number,
  step: number,
  map: (o: number, out: SliceOut) => boolean,
  source: CanvasImageSource = g.canvas,
) {
  let runO = 0, runSrc = 0, runLen = 0, runShift = 0, active = false;
  const flush = () => {
    if (active && runLen > 0) ctx.drawImage(source, runSrc, 0, runLen, g.h, x + runO, y + runShift, runLen, g.h);
    active = false;
  };
  for (let o = from; o < to; o += step) {
    if (!map(o, reset())) {
      flush();
      continue;
    }
    let sx = Math.floor(OUT.src);
    let sw = Math.max(1, Math.round(OUT.rate * step));
    if (sx >= g.w || sx + sw <= 0) {
      flush();
      continue;
    }
    if (sx < 0) {
      sw += sx;
      sx = 0;
    }
    if (sx + sw > g.w) sw = g.w - sx;
    const shift = Math.round(OUT.shift);
    if (OUT.scale !== 1) {
      flush();
      const dh = g.h * OUT.scale;
      ctx.drawImage(source, sx, 0, sw, g.h, x + o, y + shift + (g.h - dh) / 2, step, dh);
      continue;
    }
    const identity = sw === step;
    if (identity && active && shift === runShift && sx === runSrc + runLen && o === runO + runLen) {
      runLen += step;
      continue;
    }
    flush();
    if (identity) {
      active = true;
      runO = o;
      runSrc = sx;
      runLen = step;
      runShift = shift;
    } else {
      ctx.drawImage(source, sx, 0, sw, g.h, x + o, y + shift, step, g.h);
    }
  }
  flush();
}

/** 경계 검사를 포함한 부분 복사 */
export function piece(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource & { width: number; height: number },
  sx: number, sy: number, sw: number, sh: number,
  dx: number, dy: number, dw: number, dh: number,
) {
  if (sx < 0) { dx -= (sx * dw) / sw; dw += (sx * dw) / sw; sw += sx; sx = 0; }
  if (sy < 0) { dy -= (sy * dh) / sh; dh += (sy * dh) / sh; sh += sy; sy = 0; }
  if (sx + sw > src.width) { const k = (src.width - sx) / sw; sw *= k; dw *= k; }
  if (sy + sh > src.height) { const k = (src.height - sy) / sh; sh *= k; dh *= k; }
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
}

/** 프레임당 슬라이스 예산. 왜곡되는 글자가 많을수록 띠를 두껍게 해 호출 수를 제한한다. */
const SLICE_BUDGET = 22000;
export function stepFor(g: Glyph, distortedGlyphs: number): number {
  const base = g.em > 260 ? 2 : 1;
  return Math.max(base, Math.ceil((g.h * distortedGlyphs) / SLICE_BUDGET));
}
