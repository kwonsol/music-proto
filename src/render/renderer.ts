import { EFFECTS, type PxRect } from '../effects';
import { GENRE_LABEL, type GenreId } from '../lib/genres';
import type { Box } from '../layout/boxes';
import { PATTERNS } from '../pattern';
import { BASE_LEVELS } from '../pattern/common';
import type { Subject } from '../subject/art';

export const BORDER_COLOR = '#39ff14';

export interface FrameInput {
  ctx: CanvasRenderingContext2D;
  subject: Subject;
  mode: 'pattern' | 'photo';
  /** 논리 좌표계 크기 (레이아웃이 계산된 공간) */
  logicalW: number;
  logicalH: number;
  boxes: Box[];
  fxTime: number;
  intensity: Record<GenreId, number>;
  /** 장르별 보조 옵션 (hiphop 기울기, rnb 모자이크) */
  options: Record<GenreId, number>;
  /** 갱신 직후라 테두리·라벨을 잠깐 끄는 구획 id */
  blink: Set<string>;
  /** 라벨에 표시할 장르별 비율(%) */
  percent: Partial<Record<GenreId, number>>;
  showBoxes: boolean;
}

/** 논리 사각형 -> 정수 픽셀 사각형. 공유되는 모서리는 같은 값으로 반올림되어 빈틈·겹침이 생기지 않는다. */
export function toPx(r: { x: number; y: number; w: number; h: number }, sx: number, sy: number): PxRect {
  const x0 = Math.round(r.x * sx);
  const y0 = Math.round(r.y * sy);
  return { x: x0, y: y0, w: Math.round((r.x + r.w) * sx) - x0, h: Math.round((r.y + r.h) * sy) - y0 };
}

let scratch: HTMLCanvasElement | null = null;

/**
 * 하나의 구획을 그린다. 효과는 작업 캔버스에 그려지고, 구획 영역만 1:1 로 복사된다.
 * clip 만으로는 Skia 의 draw 병합 때문에 경계 바깥 1px 에 옅은 알파가 번지는 경우가 있어서,
 * "구획 밖에는 절대 그리지 않는다"를 복사 영역으로 한 번 더 보장한다.
 */
export function drawRegion(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  rect: PxRect,
  genre: GenreId,
  slot: number,
  time: number,
  intensity: number,
  option = 0,
  mask?: HTMLCanvasElement,
) {
  if (rect.w < 1 || rect.h < 1) return;
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== cw || scratch.height !== ch) {
    scratch.width = cw;
    scratch.height = ch;
  }
  const g = scratch.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  // 이전 구획의 잔여물이 복사 영역에 남지 않도록, 이 구획 주변만 지운다 (전체 지우기는 비싸다)
  g.clearRect(rect.x - 4, rect.y - 4, rect.w + 8, rect.h + 8);
  g.save();
  g.beginPath();
  g.rect(rect.x, rect.y, rect.w, rect.h);
  g.clip();
  EFFECTS[genre]({ ctx: g, src, rect, slot, time, intensity, option });
  if (mask) {
    // 효과의 실제 표시 영역 = 박스 ∩ 대상 실루엣: 마지막에 실루엣으로 다시 자른다
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(mask, 0, 0);
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();
  ctx.drawImage(scratch, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
}

// 패턴 모드용 저해상도 레이어(셀당 1픽셀)
let baseLow: { key: string; canvas: HTMLCanvasElement } | null = null;
let layer: { cols: number; rows: number; canvas: HTMLCanvasElement; img: ImageData; u32: Uint32Array } | null = null;

function drawBase(ctx: CanvasRenderingContext2D, f: FrameInput) {
  const { art } = f.subject;
  const key = `${f.subject.src.dataset.v}|${art.cols}x${art.rows}`;
  if (!baseLow || baseLow.key !== key) {
    const c = document.createElement('canvas');
    c.width = art.cols;
    c.height = art.rows;
    const g = c.getContext('2d')!;
    const im = g.createImageData(art.cols, art.rows);
    const u32 = new Uint32Array(im.data.buffer);
    for (let i = 0; i < art.cols * art.rows; i++) {
      if (!art.inside[i]) continue;
      const rgb = BASE_LEVELS[art.level[i]];
      u32[i] = 0xff000000 | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff); // ABGR
    }
    g.putImageData(im, 0, 0);
    baseLow = { key, canvas: c };
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(baseLow.canvas, 0, 0, art.cols, art.rows, 0, 0, art.cols * art.cell, art.rows * art.cell);
  ctx.imageSmoothingEnabled = true;
}

function drawPatternBox(ctx: CanvasRenderingContext2D, f: FrameInput, b: Box, p: PxRect) {
  const { art } = f.subject;
  if (!layer || layer.cols !== art.cols || layer.rows !== art.rows) {
    const c = document.createElement('canvas');
    c.width = art.cols;
    c.height = art.rows;
    const img = c.getContext('2d')!.createImageData(art.cols, art.rows);
    layer = { cols: art.cols, rows: art.rows, canvas: c, img, u32: new Uint32Array(img.data.buffer) };
  }
  const cell = art.cell;
  const i0 = Math.max(0, Math.floor(p.x / cell));
  const j0 = Math.max(0, Math.floor(p.y / cell));
  const i1 = Math.min(art.cols - 1, Math.floor((p.x + p.w - 1) / cell));
  const j1 = Math.min(art.rows - 1, Math.floor((p.y + p.h - 1) / cell));
  if (i1 < i0 || j1 < j0) return;
  const { u32 } = layer;
  for (let j = j0; j <= j1; j++) u32.fill(0, j * art.cols + i0, j * art.cols + i1 + 1);
  const put = (i: number, j: number, rgb: number) => {
    u32[j * art.cols + i] = 0xff000000 | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff);
  };
  PATTERNS[b.genre]({
    grid: art,
    i0,
    i1,
    j0,
    j1,
    box: { x: p.x / cell, y: p.y / cell, w: p.w / cell, h: p.h / cell },
    time: f.fxTime,
    I: f.intensity[b.genre],
    option: f.options[b.genre],
    put,
  });
  const lg = layer.canvas.getContext('2d')!;
  lg.putImageData(layer.img, 0, 0, i0, j0, i1 - i0 + 1, j1 - j0 + 1);
  // 박스 영역(정수 픽셀)으로 정확히 잘라서 표시 = 박스 ∩ 실루엣(셀 단위 계단 외곽)
  ctx.save();
  ctx.beginPath();
  ctx.rect(p.x, p.y, p.w, p.h);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(layer.canvas, i0, j0, i1 - i0 + 1, j1 - j0 + 1, i0 * cell, j0 * cell, (i1 - i0 + 1) * cell, (j1 - j0 + 1) * cell);
  ctx.restore();
}

export function drawFrame(f: FrameInput) {
  const { ctx } = f;
  const { src } = f.subject;
  const cw = src.width;
  const ch = src.height;
  const sx = cw / f.logicalW;
  const sy = ch / f.logicalH;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;

  // 배경은 실제 흰색. 대상은 항상 같은 자리에 그려지고, 박스 밖의 대상도 기본 그래픽으로 남는다
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);
  if (f.mode === 'pattern') drawBase(ctx, f);
  else ctx.drawImage(f.subject.cut, 0, 0);
  if (f.boxes.length === 0) return;

  const px = f.boxes.map((b) => toPx(b, sx, sy));
  // 배열 뒤쪽이 위. 겹친 곳은 맨 위 박스의 효과만 보인다 (중첩 적용 없음)
  f.boxes.forEach((b, i) => {
    if (f.mode === 'pattern') drawPatternBox(ctx, f, b, px[i]);
    else drawRegion(ctx, src, px[i], b.genre, 0, f.fxTime, f.intensity[b.genre], f.options[b.genre], f.subject.mask);
  });

  if (!f.showBoxes) return;
  const u = Math.max(1, Math.min(cw, ch) / 800); // 화면 크기에 따라 선·글자 크기 보정
  const lw = Math.max(1, Math.round(u));
  ctx.font = `600 ${Math.round(11 * u + 1)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textBaseline = 'top';
  f.boxes.forEach((b, i) => {
    const p = px[i];
    if (f.blink.has(b.id) || p.w < 4 || p.h < 4) return;
    // 흰 배경에서도 보이도록 어두운 바깥선 + 형광 초록 선
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = lw;
    ctx.strokeRect(p.x - lw / 2, p.y - lw / 2, p.w + lw, p.h + lw);
    ctx.strokeStyle = BORDER_COLOR;
    ctx.strokeRect(p.x + lw / 2, p.y + lw / 2, p.w - lw, p.h - lw);

    const text = `${GENRE_LABEL[b.genre]} ${Math.round((f.percent[b.genre] ?? 0) * 10) / 10}%`;
    const tw = ctx.measureText(text).width + 8 * u;
    const lh = 15 * u;
    const inside = p.y < lh + 2; // 위쪽 여백이 없으면 박스 안쪽에
    const ly = inside ? p.y + lw : p.y - lh - lw;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(p.x, ly, tw, lh);
    ctx.fillStyle = BORDER_COLOR;
    ctx.fillText(text, p.x + 4 * u, ly + 2.5 * u);
  });
}

/** 원본 이미지를 캔버스 비율에 맞춰 cover 로 채운 소스 캔버스를 만든다. 모든 구획이 이 한 장을 공유한다. */
export function prepareSource(
  target: HTMLCanvasElement,
  img: CanvasImageSource | null,
  imgW: number,
  imgH: number,
  w: number,
  h: number,
) {
  target.width = w;
  target.height = h;
  target.dataset.v = String((Number(target.dataset.v) || 0) + 1);
  const c = target.getContext('2d')!;
  c.fillStyle = '#111';
  c.fillRect(0, 0, w, h);
  if (!img || !imgW || !imgH) return;
  const s = Math.max(w / imgW, h / imgH);
  const dw = imgW * s;
  const dh = imgH * s;
  c.imageSmoothingQuality = 'high';
  c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
