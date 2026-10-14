import { envelope, lerp, smooth } from '../lib/ease';
import { fbm, hash } from '../lib/noise';
import { drawCols, drawRows } from './slicer';
import type { Effect } from './types';

/**
 * ② 일렁임 — 망설임, 혼란, 취기
 * 글자 높이(또는 폭)에 따라 변위가 달라져 획이 S자·불규칙 물결로 휜다.
 * 서로 다른 파장 두 개 + 노이즈를 섞고, 글자마다 위상·흐르는 속도를 다르게 한다.
 * 흐름: 원형 → 서서히 휘기 시작 → 물결이 획을 따라 흘러감 → 가라앉음
 */
export const wave: Effect = {
  id: 'wave',
  label: '일렁임',
  mood: '망설임 · 혼란 · 취기',
  cycle: 5,
  stagger: 0.05,
  defaultDirection: 'h',

  draw(f) {
    const { ctx, g, x, y, p, t, seed } = f;
    const amt = envelope(f.phase, 0.06, 0.32, 0.7, 0.94, smooth, smooth);
    if (amt <= 0.001) {
      ctx.drawImage(g.canvas, x, y);
      return;
    }
    const em = g.em;
    const A = p.intensity * em * 0.22 * amt;
    const ph1 = hash(seed, 1) * 6.283;
    const ph2 = hash(seed, 2) * 6.283;
    const f1 = 0.7 + 0.5 * hash(seed, 3);
    const f2 = 1.3 + 0.8 * hash(seed, 4);
    const v1 = 0.45 + 0.4 * hash(seed, 5);
    const v2 = -(0.7 + 0.6 * hash(seed, 6));
    const vertical = p.direction === 'v';
    const lo = vertical ? g.inkLeft : g.inkTop;
    const hi = vertical ? g.inkRight : g.inkBottom;
    const span = Math.max(1, hi - lo);
    // 변형 범위: 좁으면 움직이는 띠 하나만 휘고 나머지는 원형 유지
    const center = lo + span * (0.5 + 0.38 * Math.sin(t * 0.8 + ph1));
    const width = span * (0.12 + 0.9 * p.range);
    const full = p.range * p.range;

    const disp = (o: number) => {
      const v = o / em;
      const w = lerp(Math.exp(-(((o - center) / width) ** 2)), 1, full);
      const s =
        0.6 * Math.sin(6.283 * (v * f1 + t * v1) + ph1) +
        0.3 * Math.sin(6.283 * (v * f2 + t * v2) + ph2) +
        0.35 * fbm(v * 2.2 + t * 0.9, seed);
      return A * w * s;
    };
    const step = f.step;
    if (vertical) {
      drawCols(ctx, g, x, y, 0, g.w, step, (o, out) => {
        out.src = o;
        out.shift = disp(o);
        return true;
      });
    } else {
      drawRows(ctx, g, x, y, 0, g.h, step, (o, out) => {
        out.src = o;
        out.shift = disp(o);
        return true;
      });
    }
  },
};
