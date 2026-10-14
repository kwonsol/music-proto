import { envelope, linear } from '../lib/ease';
import { hash, noise1, rng } from '../lib/noise';
import { piece } from './slicer';
import type { Effect } from './types';

/**
 * ④ 국소 떨림 — 불안, 긴장
 * 글자 전체가 아니라 일부 구역의 얇은 띠들만 서로 다른 방향으로 빠르게 떨려
 * 획의 외곽이 톱니처럼 갈라진다. 구역 밖은 완전히 정지해 긴장이 국소적으로 보인다.
 * 흐름: 원형 → 떨림이 번짐 → (불규칙한 강약으로) 지속 → 잦아듦
 * 떨림은 초당 22틱으로 양자화된 시간에서 계산 → 프레임률과 무관하고 일시정지 시 정확히 멈춤.
 */
export const jitter: Effect = {
  id: 'jitter',
  label: '국소 떨림',
  mood: '불안 · 긴장',
  cycle: 3.2,
  stagger: 0.04,
  defaultDirection: 'h',

  draw(f) {
    const { ctx, g, x, y, p, t, seed } = f;
    const env = envelope(f.phase, 0.08, 0.22, 0.78, 0.92, linear, linear);
    if (env <= 0.001) {
      ctx.drawImage(g.canvas, x, y);
      return;
    }
    const vertical = p.direction === 'v';
    const lo = vertical ? g.inkLeft : g.inkTop;
    const hi = vertical ? g.inkRight : g.inkBottom;
    const span = Math.max(1, hi - lo);
    const size = vertical ? g.w : g.h;
    // 불안정한 구역: 글자마다 다른 위치, 천천히 이동
    const c = lo + span * (0.25 + 0.5 * hash(seed, 1) + 0.15 * noise1(t * 0.35, seed));
    const half = span * (0.08 + 0.42 * p.range);
    // 떨림 세기도 일정하지 않게 (긴장이 몰렸다 풀렸다)
    const burst = 0.55 + 0.45 * Math.max(0, noise1(t * 2.2, seed + 5));
    const amp = g.em * 0.07 * p.intensity * env * burst;
    const tick = Math.floor(t * 22);
    const r = rng(seed * 31 + tick * 977);
    const maxBand = Math.max(2, Math.round(g.em / 45), f.step * 2);

    let o = 0;
    let runStart = 0;
    const flushStill = (end: number) => {
      if (end <= runStart) return;
      if (vertical) piece(ctx, g.canvas, runStart, 0, end - runStart, g.h, x + runStart, y, end - runStart, g.h);
      else piece(ctx, g.canvas, 0, runStart, g.w, end - runStart, x, y + runStart, g.w, end - runStart);
    };
    while (o < size) {
      const bandH = f.step + Math.floor(r() * maxBand);
      const mid = o + bandH / 2;
      const d = Math.abs(mid - c) / half;
      const w = d < 1 ? 0.5 + 0.5 * Math.cos(Math.PI * d) : 0;
      const still = w === 0 || r() < 0.3;
      const off = still ? 0 : Math.round((r() * 2 - 1) * amp * w);
      if (off === 0) {
        o += bandH;
        continue;
      }
      flushStill(o);
      const z = Math.min(size, o + bandH);
      if (vertical) piece(ctx, g.canvas, o, 0, z - o, g.h, x + o, y + off, z - o, g.h);
      else piece(ctx, g.canvas, 0, o, g.w, z - o, x + off, y + o, g.w, z - o);
      o = z;
      runStart = o;
    }
    flushStill(size);
  },
};
