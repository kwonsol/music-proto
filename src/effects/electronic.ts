/**
 * Electronic — 가느다란 single-row/column marquee stretch.
 * 원본의 1px 한 줄을 골라 그 지점에서 한쪽으로 길게 끌어낸다. 줄(밴드)은 매우 얇고 두께가 제각각이며,
 * 줄마다 시작점(구획 중간 포함)과 길이가 달라 짧고 긴 가닥이 섞인 끝단을 만든다.
 * 붉은 껍질, 흰 반사광, 어두운 부분이 선택한 줄의 색 그대로 늘어난다. 원본이 남은 부분에서 끊김 없이 이어진다.
 */
import { hash3, lerp, noise1, smoothstep } from '../lib/math';
import { bandEdges, bandRange, strip, type Axis } from './helpers';
import type { GenreEffect } from './types';

function params(b: number, epoch: number, seed: number, I: number) {
  const gate = hash3(b, epoch, seed + 1);
  const on = gate < 0.8 + 0.2 * I;
  // 인접 줄과 상관된 시작점 + 줄마다 독립적인 변주
  const r0 = 0.55 * noise1(b * 0.22 + epoch * 5.7, seed + 2) + 0.45 * hash3(b, epoch, seed + 3);
  // 대부분 대상의 중심부(0.4~0.8)에서 시작하고, 가끔 바깥쪽에서 시작하는 가닥이 섞인다
  const start = hash3(b, epoch, seed + 7) < 0.15 ? 0.2 + 0.75 * r0 : 0.4 + 0.4 * r0;
  // 길이는 짧은 가닥이 많고 가끔 아주 긴 가닥이 섞인다
  const len = (0.3 + 0.7 * Math.pow(hash3(b, epoch, seed + 4), 0.7)) * (0.2 + 0.8 * I);
  const dir = noise1(b * 0.06 + epoch * 1.3, seed + 5) > 0.2 ? -1 : 1;
  return { start, len: on ? len : 0, dir };
}

export const electronicEffect: GenreEffect = ({ ctx, src, rect, slot, time, intensity: I }) => {
  ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
  if (I <= 0.001) return;

  const axis: Axis = slot === 1 ? 'v' : 'h';
  const seed = 31 + slot * 17;
  const D = Math.min(src.width, src.height);
  const aLo = axis === 'h' ? rect.x : rect.y;
  const aLen = axis === 'h' ? rect.w : rect.h;
  const bLo = axis === 'h' ? rect.y : rect.x;
  const bHi = axis === 'h' ? rect.y + rect.h : rect.x + rect.w;
  const extentB = axis === 'h' ? src.height : src.width;

  // 한 줄 두께 ≈ 1~7px: 수많은 가느다란 실선
  const edges = bandEdges(seed, extentB, Math.max(1.5, D * 0.0042), 0.85);
  const [b0, b1] = bandRange(edges, bLo, bHi);
  for (let b = b0; b <= b1; b++) {
    const period = 0.6 + 1.5 * hash3(b, 0, seed + 9);
    const t = time / period + hash3(b, 1, seed + 9) * 10;
    const epoch = Math.floor(t);
    const tr = smoothstep(0, 0.2, t - epoch);
    const p0 = params(b, epoch - 1, seed, I);
    const p1 = params(b, epoch, seed, I);
    const len = lerp(p0.len, p1.len, tr);
    if (len <= 0.002) continue;
    const start = lerp(p0.start, p1.start, tr);
    const dir = tr < 0.5 ? p0.dir : p1.dir;

    const A = aLo + start * aLen; // 늘림이 시작되는 열(행) — 구획 중간
    const L = len * aLen;
    const B0 = edges[b];
    const thick = edges[b + 1] - edges[b];
    // 가닥을 몇 구간으로 나눠 참조 줄을 조금씩 옮긴다 → 늘어난 가닥 안에도 사진의 결이 남는다
    const segs = Math.max(1, Math.min(6, Math.round(L / 60)));
    const sl = L / segs;
    for (let j = 0; j < segs; j++) {
      const ref = Math.floor(A - dir * j * (2 + 4 * hash3(b, j, seed + 6)));
      const da = dir > 0 ? A + j * sl : A - (j + 1) * sl;
      strip(ctx, src, axis, ref, B0, thick, da, B0, sl + 0.5, thick);
    }
  }
};
