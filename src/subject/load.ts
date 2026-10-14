import defaultApple from '../assets/default-apple.webp';
import defaultAppleMask from '../assets/default-apple-mask.png';
import type { LoadedImage } from '../components/Stage';
import { DEFAULT_APPLE_FEATURES, detectFeatures } from '../layout/features';
import { bboxOfAlpha, maskFromBorder } from './mask';

const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });

function alphaOf(img: CanvasImageSource, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

/** 기본 사과 사진: 정리해 둔 실루엣 마스크 에셋과 지정한 특징점을 사용한다 */
export async function loadDefaultImage(): Promise<LoadedImage> {
  const [img, mask] = await Promise.all([loadImg(defaultApple), loadImg(defaultAppleMask)]);
  const w = 250;
  const h = Math.round((250 * mask.naturalHeight) / mask.naturalWidth);
  const d = alphaOf(mask, w, h);
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    features: DEFAULT_APPLE_FEATURES,
    mask,
    maskBBox: bboxOfAlpha((i) => d[i * 4 + 3], w, h),
  };
}

/**
 * 업로드 이미지: 테두리 색을 배경으로 보는 일반 규칙으로 실루엣을 만든다(사과 전용 색 규칙 없음).
 * 배경을 못 걷어내면 이미지 전체가 대상이 된다. 모두 브라우저 안에서만 처리한다.
 */
export function prepareUpload(bmp: ImageBitmap): LoadedImage {
  const w = 160;
  const h = Math.max(40, Math.round((160 * bmp.height) / bmp.width));
  const data = alphaOf(bmp, w, h);
  const m = maskFromBorder(data, w, h);
  const mc = document.createElement('canvas');
  mc.width = w;
  mc.height = h;
  const mg = mc.getContext('2d')!;
  const im = mg.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255;
    im.data[i * 4 + 3] = m.alpha[i];
  }
  mg.putImageData(im, 0, 0);
  const fw = 96;
  const fh = Math.max(24, Math.round((96 * bmp.height) / bmp.width));
  const small = alphaOf(bmp, fw, fh);
  const ma = alphaOf(mc, fw, fh);
  const feats = detectFeatures(small, fw, fh, 12).filter((p) => ma[(Math.floor(p.y * fh) * fw + Math.floor(p.x * fw)) * 4 + 3] > 127);
  return {
    source: bmp,
    width: bmp.width,
    height: bmp.height,
    features: feats,
    mask: mc,
    maskBBox: bboxOfAlpha((i) => m.alpha[i], w, h),
  };
}
