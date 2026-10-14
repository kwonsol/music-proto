/**
 * Pop — 강한 픽셀레이트 + 큼직한 색 블록.
 * 대상을 큰 정사각 블록으로 나누고, 블록의 평균 명암 단계를 제한된 고채도 팔레트 색으로 치환한다.
 * 블록 사이에 선·그림자·베벨이 없다. 강도가 높을수록 블록이 커진다.
 */
import { lerp } from '../lib/math';
import { C, hashf, levelOfTone, pick, type PatternEffect } from './common';

const PAL = [C.blue, C.green, C.pink, C.yellow];

export const popPattern: PatternEffect = ({ grid, i0, i1, j0, j1, time, I, put }) => {
  const B = Math.max(2, Math.round(lerp(3, 9, I)));
  const epoch = Math.floor(time / 1.4);
  const cache = new Map<number, number>();
  const blockColor = (bi: number, bj: number): number => {
    const key = bj * 4096 + bi;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let s = 0;
    let n = 0;
    for (let j = bj * B; j < bj * B + B; j++)
      for (let i = bi * B; i < bi * B + B; i++) {
        if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) continue;
        const k = j * grid.cols + i;
        if (grid.inside[k]) {
          s += grid.tone[k];
          n++;
        }
      }
    let col = -1;
    if (n) {
      const lv = levelOfTone(grid, s / n);
      // 블록 일부는 이웃 단계 색으로 바뀐다 (epoch 마다 천천히 교체)
      const sub = hashf(bi * 7 + epoch, bj * 13) < 0.22 ? 1 : 0;
      col = pick(PAL, lv + sub);
    }
    cache.set(key, col);
    return col;
  };
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      if (!grid.inside[j * grid.cols + i]) continue;
      const c = blockColor(Math.floor(i / B), Math.floor(j / B));
      if (c >= 0) put(i, j, c);
    }
};
