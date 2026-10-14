import { easeInCubic, easeInQuad, envelope } from '../lib/ease';
import { hash } from '../lib/noise';
import { piece } from './slicer';
import type { Effect, GlyphFrame } from './types';

/**
 * ⑥ 흘러내림 — 슬픔, 소진
 * 몇몇 열 묶음에서 한 행을 골라 아래로 길게 끌어내리고, 그 아래 획은 끌려 내려간다.
 * 열마다 끌리는 길이를 가운데가 가장 길게(뾰족하게) 줘서 가늘고 긴 그래픽 꼬리가 된다.
 * 글자마다 시작 위치·길이·개수·지연이 다르다. 물방울·액체 질감은 쓰지 않는다.
 * 흐름: 원형 → 중력처럼 가속하며 늘어짐 → 매달림(조금 더 처짐) → 빠르게 되감김
 */

interface Run {
  c: number;
  half: number;
  start: number;
  len: number;
  delay: number;
}

function runsFor(f: GlyphFrame, cols: boolean): Run[] {
  const g = f.g;
  const top = cols ? g.colTop : g.rowLeft;
  const bottom = cols ? g.colBottom : g.rowRight;
  const n = 1 + Math.floor(hash(f.seed, 1) * (1 + f.p.range * 3));
  const runs: Run[] = [];
  const lo = cols ? g.inkLeft : g.inkTop;
  const hi = cols ? g.inkRight : g.inkBottom;
  for (let i = 0; i < n; i++) {
    let c = Math.round(lo + (hi - lo) * hash(f.seed, 10 + i));
    // 잉크가 있는 곳으로 보정
    for (let k = 0; k < hi - lo && top[c] < 0; k++) c = lo + ((c - lo + 3) % Math.max(1, hi - lo));
    if (top[c] < 0) continue;
    const half = Math.max(2, g.em * (0.025 + 0.09 * hash(f.seed, 20 + i)) * (0.5 + f.p.range));
    const start = Math.round(top[c] + (bottom[c] - top[c]) * (0.35 + 0.6 * hash(f.seed, 30 + i)));
    const len = g.em * f.p.intensity * (0.45 + 1.25 * hash(f.seed, 40 + i)) * (cols ? f.vfit : f.fit);
    runs.push({ c, half, start, len, delay: hash(f.seed, 50 + i) * 0.12 });
  }
  return runs;
}

function amount(phase: number) {
  const e = envelope(phase, 0.08, 0.52, 0.72, 0.84, easeInQuad, easeInCubic);
  // 매달린 동안 조금 더 처진다
  const sag = phase > 0.52 && phase < 0.72 ? ((phase - 0.52) / 0.2) * 0.12 : phase >= 0.72 ? 0.12 : 0;
  return e * (1 + sag);
}

export const drip: Effect = {
  id: 'drip',
  label: '흘러내림',
  mood: '슬픔 · 소진',
  cycle: 5.2,
  stagger: 0.07,
  defaultDirection: 'v',

  draw(f) {
    const { ctx, g, x, y } = f;
    const cols = f.p.direction === 'v';
    const runs = runsFor(f, cols);
    const size = cols ? g.w : g.h;
    const len = new Float32Array(size);
    const start = new Int32Array(size);
    let any = false;
    for (const r of runs) {
      const a = amount(f.phase - r.delay);
      if (a <= 0) continue;
      for (let i = Math.max(0, Math.floor(r.c - r.half)); i < Math.min(size, Math.ceil(r.c + r.half)); i++) {
        const prof = Math.pow(Math.max(0, 1 - Math.abs(i - r.c) / r.half), 0.8);
        const L = r.len * a * prof;
        if (L > len[i]) {
          len[i] = L;
          start[i] = r.start;
          any = true;
        }
      }
    }
    if (!any) {
      ctx.drawImage(g.canvas, x, y);
      return;
    }
    let still = 0;
    const flush = (end: number) => {
      if (end <= still) return;
      if (cols) piece(ctx, g.canvas, still, 0, end - still, g.h, x + still, y, end - still, g.h);
      else piece(ctx, g.canvas, 0, still, g.w, end - still, x, y + still, g.w, end - still);
    };
    for (let i = 0; i < size; i++) {
      const L = Math.round(len[i]);
      if (L <= 0) continue;
      flush(i);
      const s = start[i];
      if (cols) {
        piece(ctx, g.canvas, i, 0, 1, s, x + i, y, 1, s);
        piece(ctx, g.canvas, i, s, 1, 1, x + i, y + s, 1, L);
        piece(ctx, g.canvas, i, s, 1, g.h - s, x + i, y + s + L, 1, g.h - s);
      } else {
        piece(ctx, g.canvas, 0, i, s, 1, x, y + i, s, 1);
        piece(ctx, g.canvas, s, i, 1, 1, x + s, y + i, L, 1);
        piece(ctx, g.canvas, s, i, g.w - s, 1, x + s + L, y + i, g.w - s, 1);
      }
      still = i + 1;
    }
    flush(size);
  },
};
