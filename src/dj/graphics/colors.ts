import { samplePoints } from './geometry';
import { complementPalette, dominantHues, fitToBackground, hslCss, luminance, type PaletteEntry } from './palette';

export interface ElementColor {
  stroke: string;
  /** 반투명 하이라이트(호버·타격)용 */
  soft: string;
  outline: string | null;
}

export interface CoverPalette {
  entries: PaletteEntry[];
  colors: Record<string, ElementColor>;
}

/** 요소별 팔레트 순서. 0: 가장 많은 커버 색의 보색 */
const ASSIGN: Record<string, number> = {
  riser: 0,
  echo: 2,
  kick: 1,
  perc: 0,
  hat: 1,
  stutterA: 2,
  stutterB: 0,
  triangle: 1,
  ellipse: 2,
  line: 0,
  bar: 1,
};

/** 커버 이미지에서 한 번만 계산한다 */
export function buildPalette(img: HTMLImageElement): CoverPalette {
  const N = 120;
  const cv = document.createElement('canvas');
  cv.width = N;
  cv.height = N;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, N, N);
  const px = g.getImageData(0, 0, N, N).data;
  const entries = complementPalette(dominantHues(px, 3));
  if (!entries.length) throw new Error('커버에서 유채색을 찾지 못했습니다');

  // 각 요소가 놓인 자리의 커버 휘도(주변 5×5 평균) → 명도·채도 조정
  const lumAt = (x: number, y: number) => {
    const cx = Math.round((x / 1000) * (N - 1));
    const cy = Math.round((y / 1000) * (N - 1));
    let s = 0;
    let c = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const xx = Math.min(N - 1, Math.max(0, cx + dx));
        const yy = Math.min(N - 1, Math.max(0, cy + dy));
        const i = (yy * N + xx) * 4;
        s += luminance([px[i], px[i + 1], px[i + 2]]);
        c++;
      }
    return s / c;
  };
  const pts = samplePoints();
  const colors: Record<string, ElementColor> = {};
  for (const [id, idx] of Object.entries(ASSIGN)) {
    const base = entries[idx % entries.length].color;
    const list = pts[id];
    const bg = list.reduce((s, p) => s + lumAt(p.x, p.y), 0) / list.length;
    const { color, outline } = fitToBackground(base, bg);
    colors[id] = { stroke: hslCss(color), soft: hslCss(color, 0.35), outline };
  }
  return { entries, colors };
}
