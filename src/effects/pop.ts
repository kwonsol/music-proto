/**
 * Pop — 강한 픽셀레이트.
 * 원본을 셀 크기 단위로 평균 샘플링해 "셀당 한 색"의 저해상도 이미지를 만들고, 보간 없이 확대해서 그린다.
 * 셀 사이에 틈이나 선이 없고 모두 정사각형이다. 격자는 캔버스 기준 절대 좌표라 구획이 움직여도 이어진다.
 * 강도가 높을수록 셀이 커진다 (기본값에서도 반사광·윤곽이 계단처럼 뭉개질 만큼 크다).
 */
import { lerp } from '../lib/math';
import type { GenreEffect } from './types';

interface Cached {
  key: string;
  canvas: HTMLCanvasElement;
}
const cache = new WeakMap<HTMLCanvasElement, Cached>();

/** 원본을 cols×rows 로 줄인 캔버스. 2배씩 줄이는 평균(2x2 box)으로 만들어 셀 색이 영역 평균이 된다. */
function lowRes(src: HTMLCanvasElement, cs: number, cols: number, rows: number): HTMLCanvasElement {
  const key = `${src.dataset.v ?? ''}|${src.width}x${src.height}|${cs}`;
  const hit = cache.get(src);
  if (hit && hit.key === key) return hit.canvas;
  // 셀 격자(cols×rows)보다 약간 큰 영역을 먼저 만든다 — 원본을 격자 크기로 패딩(가장자리 색 연장)
  let cur = document.createElement('canvas');
  cur.width = cols * cs;
  cur.height = rows * cs;
  const g = cur.getContext('2d')!;
  g.drawImage(src, 0, 0);
  // 오른쪽·아래 패딩은 마지막 픽셀 줄/점을 늘려 채운다 (원본에서 직접 복사: 자기 자신을 복사하지 않는다)
  const padW = cur.width - src.width;
  const padH = cur.height - src.height;
  if (padW > 0) g.drawImage(src, src.width - 1, 0, 1, src.height, src.width, 0, padW, src.height);
  if (padH > 0) g.drawImage(src, 0, src.height - 1, src.width, 1, 0, src.height, src.width, padH);
  if (padW > 0 && padH > 0) g.drawImage(src, src.width - 1, src.height - 1, 1, 1, src.width, src.height, padW, padH);
  // cs 가 2의 거듭제곱이 아니어도 평균이 되도록: 정수 배율(2)로 줄이다가 마지막 한 번만 남은 비율로 축소
  let w = cur.width;
  let h = cur.height;
  let ratio = cs;
  while (ratio >= 2 && Math.floor(w / 2) >= cols && Math.floor(h / 2) >= rows && ratio / 2 >= 1) {
    const nxt = document.createElement('canvas');
    nxt.width = Math.max(cols, Math.round(w / 2));
    nxt.height = Math.max(rows, Math.round(h / 2));
    const c = nxt.getContext('2d')!;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(cur, 0, 0, nxt.width, nxt.height);
    cur = nxt;
    w = nxt.width;
    h = nxt.height;
    ratio /= 2;
  }
  const out = document.createElement('canvas');
  out.width = cols;
  out.height = rows;
  const o = out.getContext('2d')!;
  o.imageSmoothingEnabled = true;
  o.imageSmoothingQuality = 'high';
  o.drawImage(cur, 0, 0, cols, rows);
  cache.set(src, { key, canvas: out });
  return out;
}

export const popEffect: GenreEffect = ({ ctx, src, rect, intensity: I }) => {
  const { x, y, w, h } = rect;
  if (I <= 0.001) {
    ctx.drawImage(src, x, y, w, h, x, y, w, h);
    return;
  }
  const D = Math.min(src.width, src.height);
  const cs = Math.max(4, Math.round(D * lerp(0.035, 0.2, I))); // 정수 픽셀의 정사각형 셀
  const cols = Math.ceil(src.width / cs);
  const rows = Math.ceil(src.height / cs);
  const low = lowRes(src, cs, cols, rows);
  const i0 = Math.floor(x / cs);
  const j0 = Math.floor(y / cs);
  const i1 = Math.min(cols, Math.ceil((x + w) / cs));
  const j1 = Math.min(rows, Math.ceil((y + h) / cs));
  ctx.imageSmoothingEnabled = false; // 보간 없이 확대 → 단색 정사각형 덩어리
  ctx.drawImage(low, i0, j0, i1 - i0, j1 - j0, i0 * cs, j0 * cs, (i1 - i0) * cs, (j1 - j0) * cs);
  ctx.imageSmoothingEnabled = true;
};
