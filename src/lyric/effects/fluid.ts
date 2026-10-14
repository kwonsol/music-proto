import { clamp, clamp01, easeOutCubic, envelope, smooth } from '../lib/ease';
import { noise1 } from '../lib/noise';
import { compressMap } from './compress';
import { drawRows } from './slicer';
import type { Effect } from './types';

/**
 * A. 유체 흐름 — 그리움, 슬픔, 여운
 * 글자 획 자체가 흐름에 끌린다. 배경 물결이나 전체 사인파가 아니다.
 *  - 변형 중심(origin)에서 시작한 파동이 거리만큼 늦게 이웃 글자로 전달된다 (줄=링을 따라 이동).
 *  - 핵(획 중심부)은 짙은 검정으로 남되, 움직이는 띠가 팽창·수축하며 눌렸다 부푼다.
 *  - 1px 행들을 여러 겹(층)으로 흐름 방향에 누적해 그린다. 행마다 노이즈로 끌리는 길이와 휘어짐이
 *    달라 꼬리가 갈라졌다 다시 합쳐지는 가는 결·주름이 생기고, 멀어질수록 반투명해진다 (잉크·연기).
 *  - 퍼지는 범위 밖의 글자는 원형 그대로 → 줄 전체가 녹지 않는다.
 * 흐름: 원형 → 파동 도달·끌림 → 잔결이 머묾 → 흘러가며 원형 복귀
 */
export const fluid: Effect = {
  id: 'fluid',
  label: '유체 흐름',
  mood: '그리움 · 슬픔 · 여운',
  cycle: 6.5,
  stagger: 0,
  defaultDirection: 'h',
  defaults: { intensity: 0.85, speed: 0.9, range: 0.55, tail: 0.65, origin: 0.2 },
  controls: [
    { key: 'intensity', label: '강도' },
    { key: 'speed', label: '흐름 속도' },
    { key: 'range', label: '퍼지는 범위' },
    { key: 'tail', label: '꼬리 길이' },
    { key: 'origin', label: '변형 중심' },
  ],

  draw(f) {
    const { ctx, g, x, y, p, t, seed } = f;
    const origin = p.origin ?? 0.2;
    const tail = p.tail ?? 0.6;
    const u = (f.index + 0.5) / Math.max(1, f.count);
    const dist = Math.abs(u - origin);
    const reach = 0.12 + 0.88 * p.range;
    const w = smooth(clamp01(1 - dist / reach));
    // 중심에서 멀수록 늦게 도달하는 파동
    const amt = w * envelope(f.phase - dist * 0.35, 0.02, 0.18, 0.42, 0.6, easeOutCubic, smooth);
    if (amt < 0.003) {
      ctx.drawImage(g.canvas, x, y);
      return;
    }
    const em = g.em;
    const top = g.inkTop;
    const span = Math.max(1, g.inkBottom - g.inkTop + 1);
    const tailLen = em * (0.8 + 5.5 * tail) * p.intensity;
    const mid = top + span / 2;
    const sheet = (r: number) => noise1((r / em) * 5 + (seed % 97), seed);

    // 1) 잔결: 행 묶음을 흐름 방향으로 여러 겹 누적
    // 층 간격이 획 두께보다 촘촘해야 점선이 아닌 이어진 가는 결이 된다
    const layers = Math.round(clamp((tailLen * amt) / (em * 0.07), 6, 56));
    const gap = Math.max(3, Math.round(em / 30), f.step);
    const thick = Math.max(1, Math.round(gap / 3));
    ctx.save();
    for (let j = layers; j >= 1; j--) {
      const s = j / layers;
      ctx.globalAlpha = clamp(0.8 * (1 - s) ** 0.9 * amt ** 0.6 + 0.04, 0, 1);
      const off = (j % 2) * Math.floor(gap / 2);
      for (let r = top + off; r <= g.inkBottom; r += gap) {
        const n = sheet(r);
        const n2 = noise1((r / em) * 13 + j * 0.31 + t * 0.6, seed + 7);
        const dx = -tailLen * amt * s * (0.55 + 0.45 * n);
        // 행 위치에 따라 위아래로 부채꼴처럼 갈라지고, 노이즈로 꼬이며 다시 모인다
        const fan = (r - mid) / span;
        const dy = em * amt * (fan * s * 0.75 * (0.4 + p.range) + 0.4 * s * s * (0.8 * n2 + 0.6 * Math.sin(t * 1.2 + s * 4 + n * 3)));
        ctx.drawImage(g.canvas, 0, r, g.w, thick, Math.round(x + dx), Math.round(y + r + dy), g.w, thick);
      }
    }
    ctx.restore();

    // 2) 핵: 움직이는 띠가 팽창·수축하고, 획이 흐름 쪽으로 살짝 끌린다
    const c = top + span * (0.5 + 0.38 * Math.sin(t * 0.9 + seed));
    const hw = span * 0.2;
    const k = clamp(1 + 0.65 * amt * Math.sin(t * 2.1 + seed * 0.37), 0.35, 1.6);
    drawRows(ctx, g, x, y, 0, g.h, f.step, (o, out) => {
      const [src, rate] = compressMap(o + f.step / 2, top, g.inkBottom + 1, c, hw, k);
      out.src = src - (rate * f.step) / 2;
      out.rate = rate;
      out.shift = -em * 0.12 * amt * (0.5 + 0.5 * sheet(src));
      return true;
    });
  },
};
