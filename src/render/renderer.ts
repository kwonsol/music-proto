import { EFFECTS, type PxRect } from '../effects';
import { GENRE_LABEL, type GenreId } from '../lib/genres';
import type { Box } from '../layout/boxes';

export const BORDER_COLOR = '#39ff14';

export interface FrameInput {
  ctx: CanvasRenderingContext2D;
  src: HTMLCanvasElement;
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

  // 배경은 실제 흰색. 사진은 각 박스 안에서만 그려진다 (박스 밖·박스 사이는 흰 여백)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);
  if (f.boxes.length === 0) return;

  const px = f.boxes.map((b) => toPx(b, sx, sy));
  // 배열 뒤쪽이 위. 각 박스는 자기 영역을 통째로 덮어쓰므로 겹친 곳은 맨 위 박스의 효과만 보인다 (중첩 적용 없음)
  f.boxes.forEach((b, i) => drawRegion(ctx, src, px[i], b.genre, 0, f.fxTime, f.intensity[b.genre], f.options[b.genre]));

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
