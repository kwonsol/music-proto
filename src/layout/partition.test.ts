import { describe, expect, it } from 'vitest';
import { computeLayout, eventTime, genreAreas, type GenreShare, type Rect } from './partition';
import { GENRE_IDS } from '../lib/genres';
import { DEFAULT_RATIOS, setRatio, toggleGenre, type Ratios } from '../lib/ratios';

const W = 1600;
const H = 1000;
const A = W * H;

function overlapArea(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function check(shares: GenreShare[], tau: number) {
  const rects = computeLayout(shares, W, H, tau);
  const total = shares.reduce((s, g) => s + g.share, 0);
  // 범위 안
  for (const r of rects) {
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
    expect(r.x).toBeGreaterThanOrEqual(-1e-9);
    expect(r.y).toBeGreaterThanOrEqual(-1e-9);
    expect(r.x + r.w).toBeLessThanOrEqual(W + 1e-6);
    expect(r.y + r.h).toBeLessThanOrEqual(H + 1e-6);
  }
  // 빈틈 없음: 면적 합 = 전체 (+ 겹침 없음이면 완전 분할)
  const sum = rects.reduce((s, r) => s + r.w * r.h, 0);
  expect(Math.abs(sum - A) / A).toBeLessThan(1e-9);
  // 겹침 없음
  let ov = 0;
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) ov += overlapArea(rects[i], rects[j]);
  expect(ov / A).toBeLessThan(1e-9);
  // 장르별 면적
  const areas = genreAreas(rects);
  let worst = 0;
  for (const g of shares) {
    const want = (g.share / total) * A;
    worst = Math.max(worst, Math.abs((areas[g.id] ?? 0) - want) / A);
  }
  return worst;
}

const toShares = (r: Ratios): GenreShare[] =>
  GENRE_IDS.filter((id) => r[id] !== undefined).map((id) => ({ id, share: r[id] as number }));

describe('면적 보존 분할', () => {
  it('Pop 60% — 시간 0~300 전 구간에서 면적 오차 ~1e-12 이하', () => {
    const shares: GenreShare[] = [
      { id: 'pop', share: 60 },
      { id: 'hiphop', share: 10 },
      { id: 'electronic', share: 10 },
      { id: 'rock', share: 10 },
      { id: 'rnb', share: 10 },
    ];
    let worst = 0;
    for (let t = 0; t < 400; t += 0.037) worst = Math.max(worst, check(shares, t));
    expect(worst).toBeLessThan(1e-9);
  });

  it('여러 비율 조합과 장르 수(2~5) 모두 빈틈·겹침 없음', () => {
    const combos: Ratios[] = [
      DEFAULT_RATIOS,
      { pop: 50, rnb: 50 },
      { pop: 97, hiphop: 3 },
      { rock: 1, electronic: 99 },
      { pop: 33.3, hiphop: 33.3, rock: 33.4 },
      { pop: 1, hiphop: 1, electronic: 1, rock: 1, rnb: 96 },
    ];
    for (const c of combos) for (let t = 0; t < 120; t += 0.37) expect(check(toShares(c), t)).toBeLessThan(1e-9);
  });

  it('장르 하나면 전체를 채우고 0%는 렌더링 대상에서 빠진다', () => {
    const one = computeLayout([{ id: 'rock', share: 100 }], W, H, 3);
    expect(one).toEqual([expect.objectContaining({ genre: 'rock', x: 0, y: 0, w: W, h: H })]);
    const withZero = computeLayout([{ id: 'rock', share: 100 }, { id: 'pop', share: 0 }], W, H, 3);
    expect(withZero.length).toBe(1);
    expect(computeLayout([], W, H, 0)).toEqual([]);
  });

  it('컷 전환: 이벤트 사이에는 정지, 이벤트마다 일부만 즉시 교체 (보간 없음)', () => {
    const s = toShares(DEFAULT_RATIOS);
    // 같은 이벤트 구간 안의 두 시각은 완전히 동일
    const k = 10;
    const t0 = Math.max(eventTime(k), eventTime(k - 1)) + 1e-6;
    const t1 = eventTime(k + 1) - 1e-6;
    expect(JSON.stringify(computeLayout(s, W, H, t0))).toEqual(JSON.stringify(computeLayout(s, W, H, t1)));
    // 이벤트 간격이 0.15~0.45 (τ) 범위인지, 레이아웃이 실제로 바뀌는지
    let changes = 0;
    let prev = JSON.stringify(computeLayout(s, W, H, 0));
    for (let i = 1; i < 200; i++) {
      const gap = eventTime(i) - eventTime(i - 1);
      expect(gap).toBeGreaterThan(0.11);
      expect(gap).toBeLessThan(0.49);
      const cur = JSON.stringify(computeLayout(s, W, H, eventTime(i) + 1e-6));
      if (cur !== prev) changes++;
      prev = cur;
    }
    expect(changes).toBeGreaterThan(120);
  });
});

describe('컷 전환 — 일부 구획만 갱신', () => {
  it('이벤트마다 모든 구획이 바뀌지는 않는다 (평균 변경 비율 < 60%, 일부만 바뀌는 이벤트가 과반)', () => {
    const s = toShares(DEFAULT_RATIOS);
    let prev = computeLayout(s, W, H, eventTime(0) + 1e-6);
    let events = 0;
    let sum = 0;
    let partial = 0;
    for (let i = 1; i < 300; i++) {
      const cur = computeLayout(s, W, H, eventTime(i) + 1e-6);
      const key = (r: Rect) => `${r.x.toFixed(6)}|${r.y.toFixed(6)}|${r.w.toFixed(6)}|${r.h.toFixed(6)}`;
      const before = new Map(prev.map((r) => [r.id, key(r)]));
      const changed = cur.filter((r) => before.get(r.id) !== key(r)).length;
      if (changed > 0) {
        events++;
        sum += changed / cur.length;
        if (changed < cur.length * 0.6) partial++;
      }
      prev = cur;
    }
    console.log('events', events, 'avg changed fraction', (sum / events).toFixed(2), 'partial events', partial);
    expect(sum / events).toBeLessThan(0.6);
    expect(partial).toBeGreaterThan(events * 0.5);
  });
});

describe('비율 상태', () => {
  const sum = (r: Ratios) => Object.values(r).reduce((s, v) => s + (v as number), 0);

  it('한 장르를 바꾸면 나머지가 비례 조정되고 합은 100', () => {
    const r = setRatio({ pop: 40, hiphop: 40, rock: 20 }, 'pop', 60);
    expect(sum(r)).toBeCloseTo(100, 10);
    expect(r.pop).toBeCloseTo(60);
    expect(r.hiphop! / r.rock!).toBeCloseTo(2);
  });

  it('나머지가 전부 0이어도 처리된다', () => {
    const r = setRatio({ pop: 100, hiphop: 0, rock: 0 }, 'pop', 40);
    expect(r.hiphop).toBeCloseTo(30);
    expect(r.rock).toBeCloseTo(30);
    expect(sum(r)).toBeCloseTo(100, 10);
  });

  it('0% / 100% / 단일 선택 / 선택·해제 경계', () => {
    expect(setRatio({ pop: 50, rnb: 50 }, 'pop', 100)).toEqual({ pop: 100, rnb: 0 });
    expect(setRatio({ pop: 50, rnb: 50 }, 'pop', 0)).toEqual({ pop: 0, rnb: 100 });
    expect(setRatio({ pop: 100 }, 'pop', 30)).toEqual({ pop: 100 });
    expect(toggleGenre({ pop: 100 }, 'pop')).toEqual({});
    expect(sum(toggleGenre({}, 'rock'))).toBe(100);
    const added = toggleGenre({ pop: 100 }, 'rock');
    expect(added.rock).toBeCloseTo(50);
    const removed = toggleGenre({ pop: 0, rock: 0, rnb: 100 }, 'rnb'); // 남은 것이 모두 0
    expect(removed.pop).toBeCloseTo(50);
    expect(sum(removed)).toBeCloseTo(100, 10);
    const addOnZeros = toggleGenre({ pop: 0, rock: 100 }, 'rnb');
    expect(sum(addOnZeros)).toBeCloseTo(100, 10);
  });
});
