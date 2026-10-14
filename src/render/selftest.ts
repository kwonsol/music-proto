import { GENRE_IDS, type GenreId } from '../lib/genres';
import { makeSampleImage } from '../lib/sample';
import { drawRegion, prepareSource } from './renderer';

/**
 * 구획 밖으로 픽셀이 새어 나오는지 검사한다. 투명한 캔버스에 구획 하나만 최대 강도로 그린 뒤,
 * 구획 바깥의 알파가 전부 0 인지, 안쪽은 전부 채워졌는지를 센다.
 */
export function clipSelfTest(times = [0, 1.3, 4.7, 9.1], intensities = [0.3, 1]) {
  const W = 640;
  const H = 480;
  const src = document.createElement('canvas');
  prepareSource(src, makeSampleImage(), 1200, 900, W, H);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const rects = [
    { x: 120, y: 90, w: 300, h: 220 },
    { x: 0, y: 0, w: 200, h: 140 }, // 캔버스 모서리에 접한 구획
    { x: 431, y: 307, w: 209, h: 173 },
  ];
  const result: Record<string, { outside: number; holes: number }> = {};
  for (const g of GENRE_IDS as GenreId[]) {
    let outside = 0;
    let holes = 0;
    for (const r of rects) {
      for (const t of times) {
        for (const I of intensities) {
         for (const opt of [0, 1]) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, W, H);
          drawRegion(ctx, src, r, g, 0, t, I, opt);
          drawRegion(ctx, src, { x: r.x, y: r.y, w: r.w, h: r.h }, g, 1, t, I, opt);
          const d = ctx.getImageData(0, 0, W, H).data;
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const a = d[(y * W + x) * 4 + 3];
              const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
              if (!inside && a !== 0) outside++;
              if (inside && a < 255) holes++;
            }
          }
         }
        }
      }
    }
    result[g] = { outside, holes };
  }
  return result;
}
