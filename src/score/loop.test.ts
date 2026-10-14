import { describe, expect, it } from 'vitest';
import { buildChunks, lastOccurrence, nextOccurrence, quantizeHits, splitAuto } from './loop';

const L = 8; // 루프 8초, 16분 = 0.125초라고 가정
const G = 0.125;

describe('quantizeHits', () => {
  it('snaps to the loop grid, keeps order and never doubles a slot', () => {
    const r = quantizeHits(
      [
        { s: 0.01, kind: 'a', bright: 0, elem: 0 },
        { s: 0.05, kind: 'a', bright: 0, elem: 1 }, // 같은 칸 → 다음 칸
        { s: 0.3, kind: 'a', bright: 0, elem: 2 },
      ],
      1.02,
      L,
      G,
    );
    const abs = r.map((h) => +(1.02 + h.hit.local + h.chunk * L).toFixed(4));
    expect(abs).toEqual([1.125, 1.25, 1.375]);
    expect(r.every((h) => h.hit.local >= 0)).toBe(true);
  });

  it('wraps a stroke that crosses the loop end into the same chunk with local > L - p', () => {
    const r = quantizeHits([{ s: 1.5, kind: 'a', bright: 0, elem: 0 }], 7.0, L, G);
    expect(r[0].chunk).toBe(0);
    expect(r[0].hit.local).toBeCloseTo(1.5);
  });
});

describe('chunks', () => {
  it('splits long strokes into loop-length chunks that start at the same loop position', () => {
    const hits = [0.2, 5, 9, 17].map((s, i) => ({ s, kind: 'a', bright: 0, elem: i }));
    const ch = buildChunks(2, 18, hits, null, L, G);
    expect(ch.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(ch.every((c) => c.length <= L)).toBe(true);
    expect(ch[1].hits[0].local).toBeCloseTo(1);
  });

  it('interpolates automation at chunk boundaries', () => {
    const a = splitAuto(
      [
        { s: 0, v: [0] },
        { s: 10, v: [10] },
      ],
      L,
    );
    expect(a.length).toBe(2);
    expect(a[0][a[0].length - 1].v[0]).toBeCloseTo(8);
    expect(a[1][0].v[0]).toBeCloseTo(8);
    expect(a[1][a[1].length - 1].t).toBeCloseTo(2);
  });
});

describe('occurrences', () => {
  it('finds loop occurrences relative to the bar anchor', () => {
    expect(lastOccurrence(100, L, 3, 112)).toBeCloseTo(111);
    expect(nextOccurrence(100, L, 3, 111)).toBeCloseTo(119);
    expect(nextOccurrence(100, L, 3, 110.9)).toBeCloseTo(111);
  });
});
