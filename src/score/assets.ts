// 힙합 모드 이미지: 앨범커버, 환호 인물(첫 번째 첨부), 레코드판(두 번째 첨부).
// 첨부 이미지는 투명 배경이 없는 RGB 라 불러올 때 '가장자리에서 이어진 흰 영역'만 지운다.
// (가장자리와 닿지 않은 흰색 — 치아·셔츠·레코드 라벨 — 은 지우지 않는다)
import { ASSETS } from '../dj/config';
import type { CoverSampler } from './stroke';

export const HIPHOP_ASSETS = {
  cheer: '/score/hiphop/cheer.png',
  record: '/score/hiphop/record.png',
};

export interface Images {
  cover: HTMLImageElement | null;
  coverSampler: CoverSampler | null;
  cheer: HTMLCanvasElement | null;
  record: HTMLCanvasElement | null;
}

/** 렌더러가 읽는 공용 이미지 (불러오기 전에는 null) */
export const IMG: Images = { cover: null, coverSampler: null, cheer: null, record: null };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`이미지 파일이 없습니다: public${src}`));
    img.src = src;
  });
}

/**
 * 가장자리에서 시작하는 흰 배경 제거 (4방향 flood fill).
 * 거의 흰색(밝고 채도 낮음)만 지우고, 경계의 밝은 회색은 투명도를 서서히 줘서 흰 테두리가 남지 않게 한다.
 */
export function removeWhiteBackground(img: HTMLImageElement, hard = 238, soft = 205): HTMLCanvasElement {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const im = g.getImageData(0, 0, W, H);
  const d = im.data;
  const light = (i: number) => {
    const r = d[i];
    const gg = d[i + 1];
    const b = d[i + 2];
    const mn = Math.min(r, gg, b);
    const mx = Math.max(r, gg, b);
    return mx - mn < 28 ? mn : 0; // 무채색 밝기 (채도 있으면 0)
  };
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const k = y * W + x;
    if (seen[k]) return;
    seen[k] = 1;
    if (light(k * 4) >= soft) stack.push(k);
  };
  for (let x = 0; x < W; x++) {
    push(x, 0);
    push(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    push(0, y);
    push(W - 1, y);
  }
  while (stack.length) {
    const k = stack.pop()!;
    const i = k * 4;
    const l = light(i);
    // hard 이상은 완전히 투명, soft~hard 는 경계 → 부분 투명 (더 안쪽으로는 퍼지지 않음)
    d[i + 3] = l >= hard ? 0 : Math.round(255 * (1 - (l - soft) / (hard - soft)));
    if (l < hard) continue;
    const x = k % W;
    const y = (k / W) | 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  g.putImageData(im, 0, 0);
  return cv;
}

function makeSampler(img: HTMLImageElement): CoverSampler {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  // 커버 로컬 좌표 [-500,500]² → 화소 (쌍선형 보간, 밖은 가장자리 색)
  return (x, y) => {
    const u = Math.min(W - 1.001, Math.max(0, ((x + 500) / 1000) * (W - 1)));
    const v = Math.min(H - 1.001, Math.max(0, ((y + 500) / 1000) * (H - 1)));
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    const px = (xx: number, yy: number, c: number) => d[(yy * W + xx) * 4 + c];
    const ch = (c: number) =>
      px(x0, y0, c) * (1 - fx) * (1 - fy) + px(x0 + 1, y0, c) * fx * (1 - fy) + px(x0, y0 + 1, c) * (1 - fx) * fy + px(x0 + 1, y0 + 1, c) * fx * fy;
    return [ch(0), ch(1), ch(2)];
  };
}

/** 모든 이미지를 불러온다. 실패한 파일은 오류 목록으로 돌려준다 (적용한 척하지 않음) */
export async function loadImages(): Promise<string[]> {
  const errors: string[] = [];
  await Promise.all([
    loadImage(ASSETS.cover)
      .then((img) => {
        IMG.cover = img;
        IMG.coverSampler = makeSampler(img);
      })
      .catch((e) => errors.push(e.message)),
    loadImage(HIPHOP_ASSETS.cheer)
      .then((img) => (IMG.cheer = removeWhiteBackground(img)))
      .catch((e) => errors.push(e.message)),
    loadImage(HIPHOP_ASSETS.record)
      .then((img) => (IMG.record = removeWhiteBackground(img)))
      .catch((e) => errors.push(e.message)),
  ]);
  return errors;
}
