import { easeInOutCubic, easeOutCubic, envelope } from '../lib/ease';
import { hash } from '../lib/noise';
import { outlineOf } from '../render/glyphs';
import { drawCols, drawRows } from './slicer';
import type { Effect, GlyphState } from './types';

/**
 * ⑦ 잔상·메아리 — 기억, 미련, 반복
 * 현재 글자(검은 면)에서 윤곽선과 획 조각이 시차를 두고 밀려나며 반복된다.
 * 멀어질수록 간격이 벌어지고 기울기·폭 변형이 커져, 그림자와 달리 "지나간 형태"로 읽힌다.
 * 홀수 잔상 = 윤곽선 전체, 짝수 잔상 = 일부 획 띠만 남은 조각.
 * 흐름: 원형 → 잔상이 하나씩 떨어져 나감 → 머묾 → 역순으로 다시 빨려 들어옴
 */

const count = (s: GlyphState) => 2 + Math.round(s.p.range * 2);

function echoAmt(phase: number, k: number) {
  // 나갈 때는 가까운 것부터, 돌아올 때는 먼 것부터
  const a = 0.05 + 0.04 * k;
  const c = 0.7 - 0.03 * k;
  return envelope(phase, a, a + 0.22, c, c + 0.2, easeOutCubic, easeInOutCubic);
}

function distance(s: GlyphState, k: number) {
  return s.g.em * s.p.intensity * echoAmt(s.phase, k) * (0.2 * k + 0.08 * k * k) * (s.p.direction === 'h' ? s.fit : s.tfit);
}

export const echo: Effect = {
  id: 'echo',
  label: '잔상·메아리',
  mood: '기억 · 미련 · 반복',
  cycle: 4.6,
  stagger: 0.05,
  defaultDirection: 'v',

  extraAdvance(s) {
    return s.p.direction === 'h' ? distance(s, count(s)) * 0.7 : 0;
  },

  draw(f) {
    const { ctx, g, x, y, seed } = f;
    const n = count(f);
    const step = f.step;
    const horiz = f.p.direction === 'h';
    const outline = outlineOf(g);
    for (let k = n; k >= 1; k--) {
      const a = echoAmt(f.phase, k);
      if (a <= 0.001) continue;
      const d = distance(f, k);
      // 세로: 위로 떠오르며 옆으로 조금씩 흐트러진다 / 가로: 오른쪽으로 밀려난다
      const dx = horiz ? d : d * 0.35 * (hash(seed, k) - 0.5);
      const dy = horiz ? -d * 0.06 : -d * 0.55;
      // 잔상마다 다른 기울기와 폭 → 간격과 변형량이 함께 달라진다
      const shear = (hash(seed, 100 + k) - 0.35) * 0.5 * k * a / n;
      const sc = 1 + 0.07 * k * a;
      const mid = (g.inkTop + g.inkBottom) / 2;
      const midX = (g.inkLeft + g.inkRight) / 2;
      if (k % 2 === 1) {
        if (horiz) {
          drawRows(ctx, g, x + dx, y + dy, 0, g.h, step, (o, out) => {
            out.src = o;
            out.shift = shear * (mid - o);
            out.scale = sc;
            return true;
          }, outline);
        } else {
          drawCols(ctx, g, x + dx, y + dy, 0, g.w, step, (o, out) => {
            out.src = o;
            out.shift = shear * (o - midX);
            out.scale = sc;
            return true;
          }, outline);
        }
      } else {
        // 일부 획 띠만 밀려나는 조각 잔상
        const span = horiz ? g.inkBottom - g.inkTop : g.inkRight - g.inkLeft;
        const lo = horiz ? g.inkTop : g.inkLeft;
        const bandA = lo + span * hash(seed, 200 + k) * 0.6;
        const bandB = bandA + span * (0.12 + 0.18 * f.p.range);
        const map = (o: number, out: { src: number; shift: number }) => {
          if (o < bandA || o > bandB) return false;
          out.src = o;
          out.shift = shear * (horiz ? mid - o : o - midX) * 1.5;
          return true;
        };
        if (horiz) drawRows(ctx, g, x + dx, y + dy, 0, g.h, step, map);
        else drawCols(ctx, g, x + dx, y + dy, 0, g.w, step, map);
      }
    }
    ctx.drawImage(g.canvas, x, y);
  },
};
