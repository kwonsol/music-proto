import { easeInCubic, easeInOutCubic, envelope } from '../lib/ease';
import { hash } from '../lib/noise';
import { piece } from './slicer';
import type { Effect, GlyphState } from './types';

/**
 * ① 부분 스트레치 — 그리움, 갈망, 붙잡음
 * 글자 안의 한 줄(1px) 띠를 골라 길게 늘린다 (single row/column marquee stretch).
 * 띠 앞쪽은 원형 그대로, 띠 뒤쪽은 늘어난 길이만큼 밀려나고, 그 사이를 늘어난 띠가 잇는다.
 * 흐름: 원형 → 끌려 늘어남 → 버팀(미세한 호흡) → 튕기듯 복귀
 */

function amount(s: GlyphState) {
  const e = envelope(s.phase, 0.1, 0.42, 0.64, 0.8, easeInOutCubic, easeInCubic);
  // 버티는 동안 아주 작은 호흡 — 붙잡고 있는 긴장
  return e * (1 + 0.05 * Math.sin(s.t * 5.3 + s.seed));
}

function selected(s: GlyphState) {
  // 첫 글자는 항상, 나머지는 범위에 따라 확률적으로 (글자마다 다름)
  return s.index === 0 || hash(s.seed, 1) < 0.3 + 0.7 * s.p.range;
}

function lengthOf(s: GlyphState, axis: 'h' | 'v') {
  const k = axis === 'h' ? 0.8 + 1.6 * hash(s.seed, 2) : 0.6 + 1.3 * hash(s.seed, 2);
  // 사이클마다 늘어나는 길이가 조금씩 다르다
  const cyc = 0.8 + 0.4 * hash(s.seed, 3, s.cycle);
  return amount(s) * s.p.intensity * s.g.em * k * cyc * (axis === 'h' ? s.fit : s.vfit);
}

export const stretch: Effect = {
  id: 'stretch',
  label: '부분 스트레치',
  mood: '그리움 · 갈망 · 붙잡음',
  cycle: 3.6,
  stagger: 0.06,
  defaultDirection: 'h',

  extraAdvance(s) {
    if (s.p.direction !== 'h' || !selected(s)) return 0;
    return lengthOf(s, 'h');
  },

  draw(f) {
    const { ctx, g, x, y, p } = f;
    const L = selected(f) ? lengthOf(f, p.direction) : 0;
    if (L < 0.5) {
      ctx.drawImage(g.canvas, x, y);
      return;
    }
    const iw = g.inkRight - g.inkLeft + 1;
    const ih = g.inkBottom - g.inkTop + 1;
    if (p.direction === 'h') {
      // 가로 띠 영역 [ya, yb) 에서만, 열 xp 를 오른쪽으로 길게 끌어낸다
      const bh = Math.max(2, Math.round(ih * (0.1 + 0.55 * p.range * (0.4 + 0.6 * hash(f.seed, 4)))));
      const ya = Math.round(g.inkTop + (ih - bh) * hash(f.seed, 5));
      const yb = ya + bh;
      const xp = Math.round(g.inkLeft + iw * (0.35 + 0.5 * hash(f.seed, 6)));
      const Lr = Math.round(L);
      piece(ctx, g.canvas, 0, 0, g.w, ya, x, y, g.w, ya);
      piece(ctx, g.canvas, 0, yb, g.w, g.h - yb, x, y + yb, g.w, g.h - yb);
      piece(ctx, g.canvas, 0, ya, xp, bh, x, y + ya, xp, bh);
      piece(ctx, g.canvas, xp, ya, 1, bh, x + xp, y + ya, Lr, bh);
      piece(ctx, g.canvas, xp, ya, g.w - xp, bh, x + xp + Lr, y + ya, g.w - xp, bh);
    } else {
      // 세로 띠 영역 [xa, xb) 에서만, 행 yp 를 아래로 길게 끌어내린다
      const bw = Math.max(2, Math.round(iw * (0.15 + 0.7 * p.range * (0.4 + 0.6 * hash(f.seed, 4)))));
      const xa = Math.round(g.inkLeft + (iw - bw) * hash(f.seed, 5));
      const xb = xa + bw;
      const yp = Math.round(g.inkTop + ih * (0.3 + 0.55 * hash(f.seed, 6)));
      const Lr = Math.round(L);
      piece(ctx, g.canvas, 0, 0, xa, g.h, x, y, xa, g.h);
      piece(ctx, g.canvas, xb, 0, g.w - xb, g.h, x + xb, y, g.w - xb, g.h);
      piece(ctx, g.canvas, xa, 0, bw, yp, x + xa, y, bw, yp);
      piece(ctx, g.canvas, xa, yp, bw, 1, x + xa, y + yp, bw, Lr);
      piece(ctx, g.canvas, xa, yp, bw, g.h - yp, x + xa, y + yp + Lr, bw, g.h - yp);
    }
  },
};
