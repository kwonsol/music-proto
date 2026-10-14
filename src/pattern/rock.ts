/**
 * Rock — 대비가 강한 색면 + 지그재그·가시형 변형.
 * 명암을 고대비 색면(검정/빨강/흰색/노랑)으로 나누되, 샘플링 위치를 변형해서 대상 내부를 일그러뜨린다.
 *  - 지그재그: 행마다 가로로 삼각파 변위
 *  - 가시: 박스 중심에서 방사 방향으로 불규칙한 길이의 가시처럼 샘플링 반경을 당긴다
 * 변형 크기는 외곽에서의 깊이에 비례해 줄어들어, 실루엣 외곽은 무너지지 않고 강한 변형은 내부에 집중된다.
 */
import { clamp, noise1, smoothstep } from '../lib/math';
import { C, hashf, levelOfTone, pick, toneAt, tri, type PatternEffect } from './common';

// 흰색은 가장 밝은 단계에만 (넓은 흰 구멍이 생기지 않도록)
const PAL = [C.black, C.red, C.yellow, C.white];

export const rockPattern: PatternEffect = ({ grid, i0, i1, j0, j1, box, time, I, put }) => {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const R = Math.max(6, Math.min(box.w, box.h) / 2);
  const N = 12 + Math.round(10 * I);
  const flick = 0.8 + 0.2 * Math.sin(time * 1.3);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * grid.cols + i;
      if (!grid.inside[k]) continue;
      const depthW = smoothstep(1.5, 6, grid.depth[k]); // 외곽은 보존, 내부는 강하게
      const dx = i + 0.5 - cx;
      const dy = j + 0.5 - cy;
      const r = Math.hypot(dx, dy) + 1e-6;
      const a = Math.atan2(dy, dx);
      // 가시: 각도별 불규칙한 길이
      const q = Math.floor(((a + Math.PI) / (2 * Math.PI)) * N);
      const f = Math.abs(((((a + Math.PI) / (2 * Math.PI)) * N) % 1) - 0.5) * 2; // 0 중심 ~ 1 가장자리
      const spike = Math.pow(1 - f, 2.2) * Math.pow(hashf(q, 91), 1.4) * flick;
      const pull = I * 0.75 * spike * smoothstep(0.1, 0.5, r / R) * depthW;
      const rs = r * (1 - pull);
      // 지그재그
      const zig = I * 5 * tri(j * 0.42 + time * 1.4 + hashf(Math.floor(j / 7), 83) * 6) * depthW;
      const sx = Math.round(cx + (dx / r) * rs + zig);
      const sy = Math.round(cy + (dy / r) * rs);
      let t = toneAt(grid, sx, sy);
      if (!grid.inside[clamp(sy, 0, grid.rows - 1) * grid.cols + clamp(sx, 0, grid.cols - 1)]) t = 0.02;
      t += 0.07 * tri(j * 0.28 + i * 0.13 + time * 0.8) * I * depthW; // 색면 경계가 거칠게 갈라진다 (잔노이즈가 아니라 큰 단위로)
      let col = pick(PAL, levelOfTone(grid, t));
      if (spike > 0.55 && depthW > 0.3) col = pick(PAL, levelOfTone(grid, t) + 1); // 가시 끝은 한 단계 밝은 색
      void noise1;
      put(i, j, col);
    }
  }
};
