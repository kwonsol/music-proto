/**
 * Rock — 날카로운 가시형 왜곡.
 * 1) 지그재그 띠: 얇은 행들을 중심선을 기준으로 좌우 반대로 밀어 V자(chevron)로 꺾이고 압축된 결을 만든다.
 * 2) 가시: 구획 중심에서 사방으로 가시가 솟는다. 길이·굵기·각도가 불규칙하고(긴 가시는 드묾), 끝으로 갈수록
 *    뾰족하게 좁아지며 옆으로 꺾인다. 가시 내부는 원본의 한 지점 부근을 느리게 끌어당겨 샘플링하므로
 *    사진 결이 가시 방향으로 길게 늘어나 끝까지 이어진다. 삼각형을 덧붙이지 않고 원본 조각만 쓴다.
 */
import { clamp, hash3, lerp, noise1 } from '../lib/math';
import { bandEdges, bandRange, blit } from './helpers';
import type { GenreEffect } from './types';

const tri = (v: number) => Math.abs((((v % 2) + 2) % 2) - 1) * 2 - 1; // -1..1 삼각파

export const rockEffect: GenreEffect = ({ ctx, src, rect, slot, time, intensity: I }) => {
  const { x, y, w, h } = rect;
  blit(ctx, src, x, y, w, h, x, y, w, h);
  if (I <= 0.001) return;

  const seed = 77 + slot * 23;
  const D = Math.min(src.width, src.height);
  const cx = x + w * (0.5 + 0.08 * Math.sin(time * 0.31));
  const cy = y + h * (0.5 + 0.08 * Math.cos(time * 0.27));

  // 1) chevron 지그재그 띠 (원본 중간부터 변형)
  const edges = bandEdges(seed, src.height, Math.max(3, D * 0.011), 0.65);
  const [b0, b1] = bandRange(edges, y, y + h);
  for (let b = b0; b <= b1; b++) {
    const gate = noise1(b * 0.045 - time * 0.2, seed + 1);
    if (gate > 0.25 + 0.75 * I) continue;
    const env = 0.3 + 1.2 * noise1(b * 0.09 + time * 0.15, seed + 2);
    const ph = b * 0.19 + time * 0.8 + noise1(b * 0.2, seed + 3) * 6;
    const s = I * D * 0.07 * tri(ph) * env;
    const by = edges[b];
    const th = edges[b + 1] - edges[b];
    const yy = Math.max(by, y);
    const hh = Math.min(by + th, y + h) - yy;
    if (hh <= 0) continue;
    // 중심선 왼쪽은 +s, 오른쪽은 -s 로 반대로 밀려 V 로 꺾인다
    blit(ctx, src, x - s, yy, cx - x, hh, x, yy, cx - x, hh);
    blit(ctx, src, cx + s, yy, x + w - cx, hh, cx, yy, x + w - cx, hh);
  }

  // 2) 가시
  const Rb = Math.max(20, Math.min(w, h) * 0.5);
  const N = Math.round(50 + 110 * I);
  interface Spike {
    ex: number;
    ey: number;
    r0: number;
    L: number;
    bw: number;
    id: number;
  }
  const spikes: Spike[] = [];
  for (let i = 0; i < N; i++) {
    const a = ((i + (hash3(i, 2, seed) - 0.5) * 1.1) / N) * Math.PI * 2 + noise1(i * 0.3, seed + 4) * 0.5;
    const flick = 0.75 + 0.25 * Math.sin(time * (0.7 + hash3(i, 6, seed)) + hash3(i, 7, seed) * 6.28);
    const L = Rb * (0.12 + 1.15 * Math.pow(hash3(i, 4, seed), 2.0)) * I * flick;
    if (L < 6) continue;
    spikes.push({
      ex: Math.cos(a),
      ey: Math.sin(a),
      r0: Rb * (0.42 + 0.42 * hash3(i, 3, seed)),
      L,
      bw: Math.max(6, Rb * (0.06 + 0.2 * hash3(i, 5, seed))),
      id: i,
    });
  }
  spikes.sort((p, q) => q.L - p.L); // 긴 가시부터 그려서 짧은 가시가 위에

  const KAPPA = 0.3; // 샘플링은 표시 거리보다 느리게 진행 → 결이 길게 늘어남
  for (const sp of spikes) {
    const step = clamp(sp.L / 70, 1.5, 8);
    const fx = -sp.ey; // 가시에 수직인 방향
    const fy = sp.ex;
    for (let p = 0; p < sp.L; p += step) {
      const t = p / sp.L;
      const hw = Math.max(0.25, (sp.bw / 2) * Math.pow(1 - t, 1.3));
      // 옆으로 꺾이는 지그재그 (끝으로 갈수록 크게)
      const bend = (noise1(sp.id * 3.1 + p * 0.012 + time * 0.4, seed + 9) - 0.5) * sp.bw * 0.9 * t;
      const rr = sp.r0 + p;
      const bx = cx + sp.ex * rr + fx * bend;
      const by = cy + sp.ey * rr + fy * bend;
      const sr = sp.r0 + p * KAPPA;
      const sxc = cx + sp.ex * sr;
      const syc = cy + sp.ey * sr;
      const pw = Math.max(2, sp.bw * 0.9);
      const ph = Math.max(1, step * KAPPA);
      // 로컬 x -> 가시에 수직, 로컬 y -> 가시 방향. 원본 y(세로)가 가시 길이로 늘어난다.
      ctx.setTransform(fx, fy, sp.ex, sp.ey, bx, by);
      blit(ctx, src, sxc - pw / 2, syc - ph / 2, pw, ph, -hw, 0, hw * 2, step + 1);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  void lerp;
};
