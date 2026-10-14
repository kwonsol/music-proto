/**
 * Hip-hop — 체크와 굵은 블록 패턴이 행마다 엇갈려 이동.
 * 높이가 다른 가로 행으로 나누고, 행마다 폭이 다른 타일(체크 / 굵은 단색 블록 / 세로 줄)을 이어 붙인다.
 * 행은 박자에 맞춰 짧게 어긋나고, 일부 타일은 앞 타일의 패턴을 그대로 반복한다.
 * option(기울기)을 올리면 타일 경계가 "/" 방향으로 기울어 사선 타일 슬라이스가 된다.
 */
import { lerp, smoothstep } from '../lib/math';
import { C, VIVID, hashf, mod, pick, type PatternEffect } from './common';

const TILES = 24;
const rowCache = new Map<number, number[]>();

/** 절대 행 인덱스(0..)의 시작 j 목록: 행 높이는 3~7 셀로 제각각 */
function rowEdges(rows: number): number[] {
  const hit = rowCache.get(rows);
  if (hit) return hit;
  const e = [0];
  for (let k = 0; e[e.length - 1] < rows + 8; k++) e.push(e[e.length - 1] + 3 + Math.floor(hashf(k, 71) * 5));
  rowCache.set(rows, e);
  return e;
}

export const hiphopPattern: PatternEffect = ({ grid, i0, i1, j0, j1, time, I, option: tilt, put }) => {
  const edges = rowEdges(grid.rows);
  const beat = (time * 98) / 60;
  const epoch = Math.floor(beat / 6);
  let r = 0;
  while (edges[r + 1] <= j0) r++;
  for (; edges[r] <= j1; r++) {
    const top = edges[r];
    const bot = edges[r + 1];
    const widths: number[] = [];
    let period = 0;
    for (let k = 0; k < TILES; k++) {
      const w = 4 + Math.floor(hashf(r * 31 + k, 5) * 8);
      widths.push(w);
      period += w;
    }
    const dir = hashf(r, 7) < 0.5 ? -1 : 1;
    const b = beat * (hashf(r, 8) < 0.5 ? 0.5 : 1) + hashf(r, 9) * 4;
    const step = Math.floor(b) + smoothstep(0, 0.2, b - Math.floor(b)); // 박자마다 짧게 이동
    const shift = hashf(r, 3) * period + dir * (step % 6) * 5 * (0.4 + 0.8 * hashf(r, 4)) * (0.35 + 0.65 * I);
    for (let j = Math.max(top, j0); j < Math.min(bot, j1 + 1); j++) {
      for (let i = i0; i <= i1; i++) {
        if (!grid.inside[j * grid.cols + i]) continue;
        const lv = grid.level[j * grid.cols + i];
        const u = mod(i + tilt * (j - top) * 1.3 - shift, period); // 기울기: 행 안에서 타일 경계가 사선으로 밀린다
        let k = 0;
        let acc = 0;
        while (acc + widths[k] <= u) acc += widths[k++];
        const lu = u - acc; // 타일 안의 위치
        // 일부 타일은 앞 타일의 패턴을 반복
        const rep = hashf(r * 17 + k, epoch + 11) < 0.28 * I ? 1 : 0;
        const kk = k - rep;
        const h = hashf(r * 59 + kk, epoch + 3);
        const kind = h < 0.4 ? 0 : h < 0.62 ? 1 : h < 0.82 ? 2 : 3;
        const base = Math.floor(hashf(r * 13 + kk, 29) * 9);
        let cA = pick(VIVID, base + lv * 2);
        let cB = pick(VIVID, base + lv * 2 + 3 + (h < 0.5 ? 1 : 0));
        if (kind === 0 && hashf(r * 5 + kk, 97) < 0.3) {
          cA = C.black; // 흑백 체크
          cB = C.white;
        }
        const cs = lv >= 2 ? 2 : 1; // 밝은 곳은 체크가 더 크다
        let on: boolean;
        if (kind === 0) on = (Math.floor(lu / cs) + Math.floor((j - top) / cs)) % 2 === 0; // 체크
        else if (kind === 1) on = lu < widths[k] / 2; // 굵은 반반 블록
        else if (kind === 2) on = Math.floor(lu) % 2 === 0; // 세로 줄
        else on = true; // 단색 블록
        put(i, j, on ? cA : kind === 3 ? cA : cB);
      }
    }
  }
  void lerp;
  void C;
};
