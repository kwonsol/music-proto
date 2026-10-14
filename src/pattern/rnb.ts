/**
 * R&B — 줄무늬·체크가 연속적인 S자 곡선으로 휜다.
 * 무늬는 (u,v) 패턴 좌표에서 정의되고, 그 좌표 자체를 큰 굴곡 + 중간 굴곡 + 잔물결 + 위상 왜곡으로 변형한다.
 * (무늬 위에 물결선을 얹는 것이 아니다.) option 이 클수록 일부 영역이 줄무늬 대신 체크 모자이크가 된다.
 * 색 쌍은 명암 단계와 세로 위치(밴드)마다 바뀐다.
 */
import { noise1 } from '../lib/math';
import { C, hashf, pick, type PatternEffect } from './common';

const PAIRS: [number, number][] = [
  [C.pink, C.cyan],
  [C.blue, C.cyan],
  [C.green, C.yellow],
  [C.purple, C.pink],
  [C.red, C.yellow],
];

export const rnbPattern: PatternEffect = ({ grid, i0, i1, j0, j1, time, I, option, put }) => {
  const H = grid.rows;
  const k1 = (Math.PI * 2) / (H * 0.62);
  const k2 = (Math.PI * 2) / (H * 0.24);
  const k3 = (Math.PI * 2) / (H * 0.09);
  for (let j = j0; j <= j1; j++) {
    const env = 0.55 + 0.9 * noise1(j / (H * 0.4) + time * 0.1, 3);
    const warp = 1.3 * Math.sin(k2 * j * 0.5 + time * 0.4);
    // 행마다의 가로 변위: 줄무늬/체크의 u 좌표를 직접 이동
    const du =
      I * (8 * env * Math.sin(k1 * j + time * 0.7 + warp) + 3 * Math.sin(k2 * j - time * 0.9 + 1.2) + 1.1 * Math.sin(k3 * j + time * 1.4));
    for (let i = i0; i <= i1; i++) {
      const k = j * grid.cols + i;
      if (!grid.inside[k]) continue;
      const lv = grid.level[k];
      const u = i + du;
      const v = j + I * 1.6 * Math.sin(k2 * i * 0.5 + time * 0.6); // v 도 살짝 흔들려 체크가 휜다
      const band = Math.floor(j / 9);
      const [a, b] = pick(PAIRS, lv + band);
      const sw = lv >= 2 ? 3 : 2;
      const useCheck = hashf(band, 61) < option;
      const on = useCheck ? (Math.floor(u / sw) + Math.floor(v / sw)) % 2 === 0 : Math.floor(u / sw) % 2 === 0;
      put(i, j, on ? a : b);
    }
  }
};
