/**
 * Hip-hop — 블록 슬라이스 + 사선 타일.
 * 이미지를 높이가 제각각인 가로 행으로 자르고, 행마다 폭이 다른 직사각 조각으로 나눈다. 행은 박자에 맞춰 짧게 어긋난다.
 * 조각은 (a) 원본 그대로, (b) 앞 조각과 같은 부분을 반복, (c) 인접 부분을 당겨 온 것 중 하나이며 모두 사진 픽셀을 자른 것이다.
 * option(기울기)을 올리면 각 조각이 "/" 방향 평행사변형으로 전단되어 직사각 슬라이스 → 사선 엇갈림 타일로 바뀐다.
 */
import { hash2, hash3, lerp, smoothstep } from '../lib/math';
import { bandEdges, bandRange, blit, blitAffine } from './helpers';
import type { GenreEffect } from './types';

const TILES = 36;

export const hiphopEffect: GenreEffect = ({ ctx, src, rect, time, intensity: I, option: tilt }) => {
  const { x, y, w, h } = rect;
  blit(ctx, src, x, y, w, h, x, y, w, h);
  if (I <= 0.001) return;

  const D = Math.min(src.width, src.height);
  const seed = 5;
  const edges = bandEdges(seed, src.height, Math.max(14, D * lerp(0.15, 0.075, I)), 0.55);
  const [r0, r1] = bandRange(edges, y, y + h);
  const beat = (time * 98) / 60;
  const epoch = Math.floor(beat / 6);
  const ccx = x + w / 2;
  const shear = tilt * 1.0; // 높이 1당 가로 이동량

  for (let r = r0; r <= r1; r++) {
    const Y = edges[r];
    const bh = edges[r + 1] - edges[r];
    const tw0 = bh * lerp(1.5, 2.2, I);
    const widths: number[] = [];
    let period = 0;
    for (let k = 0; k < TILES; k++) {
      const tw = tw0 * (0.55 + 1.9 * hash3(r, k, seed + 1));
      widths.push(tw);
      period += tw;
    }
    // 행마다 박자에 맞춘 짧은 스텝으로 어긋난다
    const dir = hash2(r, 7) < 0.5 ? -1 : 1;
    const b = beat * (hash2(r, 8) < 0.5 ? 0.5 : 1) + hash2(r, 9) * 4;
    const step = Math.floor(b) + smoothstep(0, 0.2, b - Math.floor(b));
    const ox = (hash2(r, 3) * period + dir * (step % 6) * tw0 * (0.4 + 0.8 * hash2(r, 4)) * I) % period;
    let X = ox - period;
    const skew = shear * bh;
    let prevW = widths[TILES - 1];
    for (let k = 0; X < x + w + skew + 2; k++) {
      const tw = widths[k % TILES];
      if (X + tw + skew >= x - 2) {
        const m = hash3(r, k % TILES, epoch + seed);
        let sx = X;
        let sw = tw;
        // 대상의 중심 쪽 이웃을 가져와서, 대상이 바깥으로 반복·끌려 나오는 인상을 만든다
        const toward = X + tw / 2 < ccx ? 1 : -1;
        if (m < 0.12 * I + 0.02) {
          sx = X + toward * prevW; // 이웃 조각과 같은 부분을 반복
          sw = tw;
        } else if (m < 0.34 * I + 0.04) {
          sx = X + toward * tw * (0.25 + 0.55 * hash3(r, k, 9)); // 인접 부분을 당겨 온다
        }
        if (shear < 0.02) blit(ctx, src, sx, Y, sw, bh, X, Y, tw + 1, bh);
        else blitAffine(ctx, src, sx, Y, sw, bh, X, Y, tw + 1, 0, -skew, bh);
      }
      prevW = tw;
      X += tw;
    }
  }
};
