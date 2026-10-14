/**
 * Electronic — 촘촘한 다색 세로 스트라이프 + 일부 행의 수평 스트레치.
 * 기본은 셀 폭 1~2 의 세로 줄. 줄 색은 열마다 불규칙하게 고르되 명암 단계에 따라 색상이 밀려서 대상의 볼륨이 읽힌다.
 * 일부 얇은 행은 한 열의 색을 시작점에서 한쪽으로 길게 끌어 날카로운 가닥(스트레치)을 만든다. 시작점·길이는 행마다 다르다.
 */
import { lerp, smoothstep } from '../lib/math';
import { VIVID, hashf, levelAt, pick, type PatternEffect } from './common';

export const electronicPattern: PatternEffect = ({ grid, i0, i1, j0, j1, box, time, I, put }) => {
  const stripeW = I < 0.35 ? 2 : 1;
  const color = (i: number, lv: number) => pick(VIVID, Math.floor(hashf(Math.floor(i / stripeW), 17) * 9) + lv * 2);
  // 얇은 행 밴드 (1~3 셀)
  const bandOf = (j: number) => {
    // 절대 좌표 기준 밴드: 3셀 단위 안에서 1~3 행
    const g = Math.floor(j / 3);
    return { g, on: hashf(g, 41) };
  };
  for (let j = j0; j <= j1; j++) {
    const { g } = bandOf(j);
    const period = 0.55 + 1.4 * hashf(g, 5);
    const t = time / period + hashf(g, 6) * 10;
    const epoch = Math.floor(t);
    const tr = smoothstep(0, 0.18, t - epoch);
    const gate = (e: number) => hashf(g * 7 + e, 43) < 0.12 + 0.42 * I;
    const start = (e: number) => box.x + box.w * (0.25 + 0.5 * hashf(g * 5 + e, 47));
    const len = (e: number) => (0.15 + 0.85 * Math.pow(hashf(g * 3 + e, 53), 0.8)) * box.w * (0.4 + 0.6 * I);
    const cur = tr > 0.5 ? epoch : epoch - 1;
    const stretch = gate(cur);
    const sx = Math.floor(start(cur));
    const L = lerp(len(epoch - 1), len(epoch), tr);
    const dirL = hashf(g * 11 + cur, 59) < 0.5;
    const lvS = levelAt(grid, sx, j);
    const colS = color(sx, lvS < 0 ? 2 : lvS);
    for (let i = i0; i <= i1; i++) {
      const k = j * grid.cols + i;
      if (!grid.inside[k]) continue;
      const lv = grid.level[k];
      let c = color(i, lv);
      if (stretch && (dirL ? i <= sx && i >= sx - L : i >= sx && i <= sx + L)) c = colS;
      put(i, j, c);
    }
  }
};
