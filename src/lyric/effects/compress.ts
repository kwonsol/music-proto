import { clamp, easeInQuad, spring } from '../lib/ease';
import { hash } from '../lib/noise';
import { drawCols, drawRows } from './slicer';
import type { Effect } from './types';

/**
 * ⑤ 압축·팽창 — 압박, 답답함, 해방
 * 글자 박스 크기는 그대로 두고 내부 비율만 바꾼다.
 * 가운데 구간은 얇은 조각이 될 때까지 눌리고, 그 위아래 획은 밀려나며 늘어난다.
 * 압력이 풀리면 감쇠 진동으로 반대로 부풀었다가 원형으로 돌아온다.
 * 흐름: 원형 → 서서히 눌림 → 눌린 채 버팀 → 탄성 해방(오버슈트) → 원형
 */

/** 압축량: 1 = 최대 압축, 음수 = 팽창 */
export function compressAmount(phase: number): number {
  if (phase < 0.08) return 0;
  if (phase < 0.46) return easeInQuad((phase - 0.08) / 0.38);
  if (phase < 0.6) return 1;
  if (phase < 0.95) return spring((phase - 0.6) / 0.35);
  return 0;
}

/**
 * 출력 좌표 v → 원본 좌표 u (구간별 선형). 전체 [lo,hi] 길이는 보존된다.
 * 반환값은 [u, du/dv].
 */
export function compressMap(v: number, lo: number, hi: number, c: number, hw: number, k: number): [number, number] {
  const a0 = c - hw;
  const a1 = c + hw;
  const A = Math.max(1, a0 - lo);
  const B = Math.max(1, hi - a1);
  const D = 2 * hw * (1 - k);
  const A2 = A + (D * A) / (A + B);
  const B2 = B + (D * B) / (A + B);
  const m0 = lo + A2;
  const m1 = m0 + 2 * hw * k;
  if (v < lo || v > hi) return [v, 1];
  if (v < m0) return [lo + ((v - lo) * A) / A2, A / A2];
  if (v < m1) return [a0 + (v - m0) / k, 1 / k];
  return [a1 + ((v - m1) * B) / B2, B / B2];
}

export const compress: Effect = {
  id: 'compress',
  label: '압축·팽창',
  mood: '압박 · 답답함 · 해방',
  cycle: 4,
  stagger: 0.035,
  defaultDirection: 'v',

  draw(f) {
    const { ctx, g, x, y, p, seed } = f;
    let amt = compressAmount(f.phase);
    if (Math.abs(amt) < 0.002) {
      ctx.drawImage(g.canvas, x, y);
      return;
    }
    // 눌린 채 버틸 때의 미세한 저항
    if (f.phase > 0.4 && f.phase < 0.6) amt *= 1 - 0.04 * (0.5 + 0.5 * Math.sin(f.t * 31 + seed));
    const cols = p.direction === 'h';
    const lo = cols ? g.inkLeft : g.inkTop;
    const hi = cols ? g.inkRight + 1 : g.inkBottom + 1;
    const span = hi - lo;
    const c = lo + span * (0.32 + 0.36 * hash(seed, 1));
    const hw = span * (0.06 + 0.24 * p.range);
    const k = clamp(1 - 0.94 * p.intensity * amt, 0.035, 1.4);
    // 눌린 띠는 옆으로 살짝 퍼진다 (부피 보존 느낌)
    const bulge = (1 - k) * 0.22;
    const step = f.step;
    const map = (o: number, out: { src: number; rate: number; scale: number }) => {
      const [u, rate] = compressMap(o + step / 2, lo, hi, c, hw, k);
      out.src = u - (rate * step) / 2;
      out.rate = rate;
      if (bulge !== 0 && u > c - hw && u < c + hw) out.scale = 1 + bulge;
      return true;
    };
    if (cols) drawCols(ctx, g, x, y, 0, g.w, step, map);
    else drawRows(ctx, g, x, y, 0, g.h, step, map);
  },
};
