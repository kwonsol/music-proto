import { rng } from '../lib/noise';
import { piece } from './slicer';
import type { Effect, GlyphFrame } from './types';

/**
 * ③ 절단·어긋남 — 단절, 갈등, 상처
 * 글자를 불규칙한 수평 띠로 자르고 일부 띠만 좌우로 어긋나게 한다.
 * 절단면은 정수 픽셀 경계라 날카롭게 유지된다. 색 분리 없이 검은 획 자체가 어긋난다.
 * 흐름: 원형 → 순간 어긋남(스냅) → 멈춤 → 짧은 2차 튐 → 다시 맞물림. 사이클마다 절단 위치가 바뀐다.
 */

interface Band {
  a: number;
  b: number;
  off: number;
  t0: number;
  t1: number;
  twitch: number;
}

function bandsFor(f: GlyphFrame, lo: number, hi: number, em: number): Band[] {
  const r = rng(f.seed * 7919 + f.cycle * 104729 + 17);
  const span = hi - lo;
  const cuts = new Set<number>();
  const n = 2 + Math.floor(r() * 3 + f.p.range * 3);
  for (let i = 0; i < n; i++) cuts.add(Math.round(lo + span * r()));
  // 얇은 실 같은 조각 (레퍼런스의 가는 가로선)
  const slivers = Math.round(f.p.range * 1.2 + r() * 0.8);
  const sliverStarts = new Set<number>();
  for (let i = 0; i < slivers; i++) {
    const c = Math.round(lo + span * (0.1 + 0.8 * r()));
    cuts.add(c);
    sliverStarts.add(c);
    cuts.add(c + Math.max(2, Math.round(em * (0.012 + 0.02 * r()))));
  }
  const edges = [lo - 2, ...[...cuts].filter((c) => c > lo && c < hi).sort((a, b) => a - b), hi + 2];
  const out: Band[] = [];
  let sign = r() < 0.5 ? -1 : 1;
  // 굵은 띠 하나는 반드시 어긋난다
  const must = 1 + Math.floor(r() * Math.max(1, edges.length - 2));
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i];
    const b = edges[i + 1];
    const thin = sliverStarts.has(a) && b - a < em * 0.05;
    const active = thin || i === must || r() < 0.15 + 0.35 * f.p.range;
    if (!active) {
      out.push({ a, b, off: 0, t0: 1, t1: 1, twitch: 0 });
      continue;
    }
    sign = r() < 0.7 ? -sign : sign;
    const mag = (thin ? 0.35 + 0.6 * r() : 0.12 + 0.3 * r()) * em * f.p.intensity;
    const t0 = 0.12 + 0.22 * r();
    out.push({ a, b, off: sign * mag, t0, t1: t0 + 0.25 + 0.25 * r(), twitch: 0.5 + r() * 0.9 });
  }
  return out;
}

/** 띠 하나의 어긋남 비율. 전환은 사이클의 1.5% 안에 끝나는 스냅. */
function shape(ph: number, b: Band) {
  const e = 0.015;
  if (ph < b.t0 || ph > b.t1 + e) return 0;
  if (ph < b.t0 + e) return (ph - b.t0) / e;
  const mid = b.t0 + (b.t1 - b.t0) * 0.55;
  if (ph > mid && ph < mid + 0.05) return b.twitch;
  if (ph > b.t1) return 1 - (ph - b.t1) / e;
  return 1;
}

export const slice: Effect = {
  id: 'slice',
  label: '절단·어긋남',
  mood: '단절 · 갈등 · 상처',
  cycle: 2.8,
  stagger: 0.03,
  defaultDirection: 'h',

  draw(f) {
    const { ctx, g, x, y } = f;
    const vertical = f.p.direction === 'v';
    const lo = vertical ? g.inkLeft : g.inkTop;
    const hi = vertical ? g.inkRight + 1 : g.inkBottom + 1;
    const bands = bandsFor(f, lo, hi, g.em);
    const size = vertical ? g.w : g.h;
    // 잉크 바깥 부분(박스 여백)은 그대로
    if (vertical) {
      piece(ctx, g.canvas, 0, 0, Math.max(0, bands[0].a), g.h, x, y, Math.max(0, bands[0].a), g.h);
    } else {
      piece(ctx, g.canvas, 0, 0, g.w, Math.max(0, bands[0].a), x, y, g.w, Math.max(0, bands[0].a));
    }
    for (const b of bands) {
      const a = Math.max(0, b.a);
      const z = Math.min(size, b.b);
      if (z <= a) continue;
      const d = Math.round(b.off * shape(f.phase, b));
      if (vertical) piece(ctx, g.canvas, a, 0, z - a, g.h, x + a, y + d, z - a, g.h);
      else piece(ctx, g.canvas, 0, a, g.w, z - a, x + d, y + a, g.w, z - a);
    }
  },
};
