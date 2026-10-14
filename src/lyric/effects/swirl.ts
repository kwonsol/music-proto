import { easeInOutCubic, envelope } from '../lib/ease';
import { hash, rng } from '../lib/noise';
import { BASE } from '../render/glyphs';
import type { Effect } from './types';

/**
 * B. 회전 잔상 / 소용돌이 — 혼란, 현기증, 몰입
 * 링 공전과는 별개로, 글자 획 자체를 링 중심 기준 원호 방향으로 끌어 잔상을 만든다.
 *  - 글자 텍스처 좌표에서 가로축 = 원둘레, 세로축 = 반지름이다.
 *    각도 θ 만큼 돌리면 반지름 r 인 행은 θ·r 만큼 원호를 따라 이동한다.
 *  - 바깥쪽 반지름일수록 더 많이 돌도록(θ 가 r 에 비례해 증가) 해 소용돌이처럼 비틀린다.
 *    이 변위는 행 위치에 대한 1차식이라 각 각도 샘플을 기울임(shear) 변환 한 번으로 그린다.
 *  - 여러 각도 샘플을 옅어지는 불투명도로 합성 → 원호 잔상. 일반 블러가 아니다.
 *  - 글자를 몇 개의 띠로 나눠 일부 띠는 선명하게 남기고(선명 비율), 나머지만 잔상을 끈다.
 *  - 효과 시간으로만 움직이므로 링 공전이 멈춰도 독립적으로 작동한다.
 */
export const swirl: Effect = {
  id: 'swirl',
  label: '회전 잔상',
  mood: '혼란 · 현기증 · 몰입',
  cycle: 5,
  stagger: 0.04,
  defaultDirection: 'h',
  defaults: { intensity: 0.8, speed: 1, range: 0.5, tail: 0.6, sharp: 0.4, spin: 1 },
  controls: [
    { key: 'intensity', label: '왜곡 강도' },
    { key: 'spin', label: '회전 방향' },
    { key: 'tail', label: '잔상 길이' },
    { key: 'sharp', label: '선명한 원형 비율' },
    { key: 'speed', label: '속도' },
  ],

  draw(f) {
    const { ctx, g, x, y, p, t, seed } = f;
    const amt = envelope(f.phase, 0.06, 0.3, 0.72, 0.94, easeInOutCubic, easeInOutCubic);
    const pulse = 0.75 + 0.25 * Math.sin(t * 2.3 + seed);
    const tail = p.tail ?? 0.6;
    const sharp = p.sharp ?? 0.4;
    const spin = (p.spin ?? 1) >= 0 ? 1 : -1;
    // 강도가 낮으면 짧은 각도, 높으면 긴 원호
    const theta = p.intensity * (0.08 + 1.1 * tail) * amt * pulse * (0.7 + 0.6 * hash(seed, 1));
    if (theta < 0.002) {
      ctx.drawImage(g.canvas, x, y);
      return;
    }
    const em = g.em;
    const R = Math.max(em * 2, f.radius);
    const base = y + Math.round(em * BASE);
    const twist = 0.18;

    // 띠 나누기: 일부는 선명, 일부는 잔상
    const r = rng(seed * 13 + 5);
    const K = 5;
    const span = g.inkBottom - g.inkTop + 1;
    const edges = [0];
    for (let i = 1; i < K; i++) edges.push(Math.round(g.inkTop + (span * (i + (r() - 0.5) * 0.6)) / K));
    edges.push(g.h);
    const smear: boolean[] = [];
    for (let b = 0; b < K; b++) smear.push(hash(seed, 10 + b) >= sharp);
    if (!smear.some(Boolean)) smear[Math.floor(hash(seed, 3) * K)] = true;

    // 행 위치 py 에서의 원호 변위: θ·(R + d·(1 + twist·R/em)), d = base - py
    const shear = (ang: number) => {
      const A = ang * R;
      const B = ang * (1 + (twist * R) / em);
      ctx.setTransform(1, 0, -B, 1, A + B * base, 0);
    };
    // 샘플 간격을 획 두께보다 촘촘하게 → 끊기지 않는 원호
    const N = Math.round(Math.min(64, Math.max(6, (theta * R) / (em * 0.05))));
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    for (let k = N; k >= 1; k--) {
      const frac = k / N;
      shear(-spin * theta * frac);
      ctx.globalAlpha = Math.min(1, (0.85 * (1 - frac) ** 1.1 + 0.03) * (12 / Math.max(12, N)) ** 0.5);
      for (let b = 0; b < K; b++) {
        if (!smear[b]) continue;
        const a = edges[b];
        const h = edges[b + 1] - a;
        if (h > 0) ctx.drawImage(g.canvas, 0, a, g.w, h, x, y + a, g.w, h);
      }
    }
    // 현재 글자: 잔상 띠는 살짝 앞서 비틀리고, 선명 띠는 원형 그대로
    ctx.globalAlpha = 1;
    for (let b = 0; b < K; b++) {
      const a = edges[b];
      const h = edges[b + 1] - a;
      if (h <= 0) continue;
      if (smear[b]) shear(spin * theta * 0.07);
      else ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(g.canvas, 0, a, g.w, h, x, y + a, g.w, h);
    }
    ctx.restore();
  },
};
