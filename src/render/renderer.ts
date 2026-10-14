import { EFFECTS, type PxRect } from '../effects';
import { GENRE_LABEL, type GenreId } from '../lib/genres';
import type { Rect } from '../layout/partition';

export const BORDER_COLOR = '#39ff14';

export interface FrameInput {
  ctx: CanvasRenderingContext2D;
  src: HTMLCanvasElement;
  /** 논리 좌표계 크기 (레이아웃이 계산된 공간) */
  logicalW: number;
  logicalH: number;
  rects: Rect[];
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
export function toPx(r: Rect, sx: number, sy: number): PxRect {
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
  g.restore();
  ctx.drawImage(scratch, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
}

export function drawFrame(f: FrameInput) {
  const { ctx, src } = f;
  const cw = src.width;
  const ch = src.height;
  const sx = cw / f.logicalW;
  const sy = ch / f.logicalH;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;

  if (f.rects.length === 0) {
    ctx.drawImage(src, 0, 0);
    return;
  }

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, ch);
  const px = f.rects.map((r) => toPx(r, sx, sy));
  f.rects.forEach((r, i) => drawRegion(ctx, src, px[i], r.genre, r.slot, f.fxTime, f.intensity[r.genre], f.options[r.genre]));

  if (!f.showBoxes) return;
  const u = Math.max(1, Math.min(cw, ch) / 800); // 화면 크기에 따라 선·글자 크기 보정
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = Math.max(1, Math.round(u));
  px.forEach((p, i) => {
    if (p.w < 4 || p.h < 4 || f.blink.has(f.rects[i].id)) return;
    const o = ctx.lineWidth / 2;
    ctx.strokeRect(p.x + o, p.y + o, p.w - ctx.lineWidth, p.h - ctx.lineWidth);
  });

  // 라벨은 장르마다 가장 큰 구획에 한 번만
  const biggest = new Map<GenreId, number>();
  f.rects.forEach((r, i) => {
    const cur = biggest.get(r.genre);
    if (cur === undefined || r.w * r.h > f.rects[cur].w * f.rects[cur].h) biggest.set(r.genre, i);
  });
  ctx.font = `600 ${Math.round(11 * u + 1)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textBaseline = 'top';
  biggest.forEach((i, genre) => {
    const p = px[i];
    if (f.blink.has(f.rects[i].id)) return;
    const pct = f.percent[genre] ?? 0;
    const text = `${GENRE_LABEL[genre]} ${Math.round(pct * 10) / 10}%`;
    const padX = 4 * u;
    const tw = ctx.measureText(text).width + padX * 2;
    const lh = 15 * u;
    if (p.w < tw + 4 || p.h < lh + 4) return;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(p.x + ctx.lineWidth, p.y + ctx.lineWidth, tw, lh);
    ctx.fillStyle = BORDER_COLOR;
    ctx.fillText(text, p.x + ctx.lineWidth + padX, p.y + ctx.lineWidth + 2.5 * u);
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
