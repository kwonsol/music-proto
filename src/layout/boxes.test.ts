import { describe, expect, it } from 'vitest';
import { AREA_BUDGET, BoxTracker, boxAreas, boxSize, feasibleAspect, type GenreShare } from './boxes';
import { DEFAULT_APPLE_FEATURES, detectFeatures } from './features';
import { GENRE_IDS } from '../lib/genres';
import { DEFAULT_RATIOS, type Ratios } from '../lib/ratios';

const W = 1600;
const H = 1200;
const feats = DEFAULT_APPLE_FEATURES.map((p) => ({ x: p.x * W, y: p.y * H, weight: p.weight }));
const toShares = (r: Ratios): GenreShare[] =>
  GENRE_IDS.filter((id) => r[id] !== undefined).map((id) => ({ id, share: r[id] as number }));

function union(boxes: { x: number; y: number; w: number; h: number }[]) {
  const N = 120;
  let c = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N) * W;
      const y = ((j + 0.5) / N) * H;
      if (boxes.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)) c++;
    }
  return c / (N * N);
}

describe('독립 박스 — 면적·개수', () => {
  const combos: Ratios[] = [
    DEFAULT_RATIOS,
    { pop: 60, hiphop: 10, electronic: 10, rock: 10, rnb: 10 },
    { pop: 50, rnb: 50 },
    { rock: 100 },
    { pop: 97, hiphop: 3 },
    { pop: 33.3, hiphop: 33.3, rock: 33.4 },
  ];

  it('선택한 장르 수 = 박스 수, 장르 면적 = p·예산·W·H 가 매 프레임 정확히 유지', () => {
    for (const c of combos) {
      const shares = toShares(c);
      const tr = new BoxTracker(3);
      tr.configure(W, H, feats, shares);
      let fx = 0;
      for (let f = 0; f < 60 * 90; f++) {
        fx += 1 / 60;
        tr.step(1 / 60, fx);
        const boxes = tr.boxes();
        expect(boxes.length).toBe(shares.length);
        const total = shares.reduce((a, s) => a + s.share, 0);
        const areas = boxAreas(boxes);
        for (const s of shares) {
          const want = (s.share / total) * AREA_BUDGET * W * H;
          expect(Math.abs((areas[s.id] ?? 0) - want) / (W * H)).toBeLessThan(1e-9);
        }
        for (const b of boxes) {
          expect(b.x).toBeGreaterThanOrEqual(-1e-6);
          expect(b.y).toBeGreaterThanOrEqual(-1e-6);
          expect(b.x + b.w).toBeLessThanOrEqual(W + 1e-6);
          expect(b.y + b.h).toBeLessThanOrEqual(H + 1e-6);
          expect(b.w / b.h).toBeGreaterThan(0.45);
          expect(b.w / b.h).toBeLessThan(2.2);
        }
        if (f % 30 === 0) expect(union(boxes)).toBeLessThanOrEqual(AREA_BUDGET + 0.03); // 흰 여백 ≥ 약 45% (격자 샘플 오차 허용)
      }
    }
  });

  it('width = √(A·r), height = √(A/r)', () => {
    const { w, h } = boxSize(250000, 1.6);
    expect(w).toBeCloseTo(Math.sqrt(250000 * 1.6), 9);
    expect(h).toBeCloseTo(Math.sqrt(250000 / 1.6), 9);
    expect(w * h).toBeCloseTo(250000, 6);
    // 캔버스를 넘는 종횡비는 면적이 아니라 종횡비가 조정된다
    const r = feasibleAspect(0.5 * W * H, W, H, 2);
    const s = boxSize(0.5 * W * H, r);
    expect(s.w).toBeLessThanOrEqual(W);
    expect(s.h).toBeLessThanOrEqual(H);
  });
});

describe('독립 박스 — 배치와 움직임', () => {
  it('공통 행·열 타일처럼 정렬되지 않고, 겹침과 분리가 함께 나타난다', () => {
    const tr = new BoxTracker(11);
    tr.configure(W, H, feats, toShares(DEFAULT_RATIOS));
    let fx = 0;
    let aligned = 0;
    let frames = 0;
    let overlapFrames = 0;
    let separateFrames = 0;
    const aspects: number[] = [];
    for (let f = 0; f < 60 * 120; f++) {
      fx += 1 / 60;
      tr.step(1 / 60, fx);
      if (f % 10) continue;
      const b = tr.boxes();
      frames++;
      let al = false;
      let ov = false;
      let sep = false;
      for (let i = 0; i < b.length; i++)
        for (let j = i + 1; j < b.length; j++) {
          const A = b[i];
          const B = b[j];
          for (const [p, q, max] of [
            [A.x, B.x, W],
            [A.x + A.w, B.x + B.w, W],
            [A.y, B.y, H],
            [A.y + A.h, B.y + B.h, H],
          ])
            if (Math.abs(p - q) < 0.0007 * W && p > 0.02 * max && p < 0.98 * max) al = true; // 캔버스 여백선에 닿은 것은 제외
          const iw = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
          const ih = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
          if (iw > 0 && ih > 0) ov = true;
          else sep = true;
        }
      if (al) aligned++;
      if (ov) overlapFrames++;
      if (sep) separateFrames++;
      b.forEach((x) => aspects.push(x.w / x.h));
    }
    expect(aligned / frames).toBeLessThan(0.12); // 우연히 1px 이내로 겹치는 정도만 허용 (체계적 정렬이면 훨씬 높다)
    expect(overlapFrames / frames).toBeGreaterThan(0.2);
    expect(separateFrames / frames).toBeGreaterThan(0.5);
    expect(aspects.some((a) => a > 1.4)).toBe(true); // 가로형
    expect(aspects.some((a) => a < 0.75)).toBe(true); // 세로형
    expect(aspects.some((a) => a > 0.85 && a < 1.2)).toBe(true); // 정사각형에 가까움
  });

  it('박스마다 독립 타이밍으로 재탐지하고(0.2~0.9s), 모든 박스가 동시에 바뀌지 않는다', () => {
    const tr = new BoxTracker(5);
    tr.configure(W, H, feats, toShares(DEFAULT_RATIOS));
    const last: Record<string, number> = {};
    const gaps: number[] = [];
    let simultaneous = 0;
    let events = 0;
    let fx = 0;
    const key = (b: { x: number; y: number; w: number; h: number }) => `${b.x.toFixed(3)}|${b.y.toFixed(3)}|${b.w.toFixed(3)}`;
    let prev = new Map(tr.boxes().map((b) => [b.id, key(b)]));
    for (let f = 0; f < 120 * 60; f++) {
      fx += 1 / 120;
      tr.step(1 / 120, fx);
      const b = tr.boxes();
      const evBoxes = b.filter((x) => last[x.id] !== x.lastEvent);
      if (evBoxes.length) {
        events += evBoxes.length;
        if (evBoxes.length > 1) simultaneous++;
        for (const x of evBoxes) {
          if (last[x.id] !== undefined) gaps.push(x.lastEvent - last[x.id]);
          last[x.id] = x.lastEvent;
        }
      }
      prev = new Map(b.map((x) => [x.id, key(x)]));
    }
    void prev;
    expect(Math.min(...gaps)).toBeGreaterThan(0.19);
    expect(Math.max(...gaps)).toBeLessThan(1.0);
    expect(gaps.reduce((a, b) => a + b, 0) / gaps.length).toBeLessThan(0.5);
    expect(simultaneous / events).toBeLessThan(0.1);
  });

  it('특징점 주변을 잡고(박스가 특징점과 겹침), 서로 다른 특징점을 나눠 갖고, 한곳에 몰리지 않는다', () => {
    const tr = new BoxTracker(9);
    tr.configure(W, H, feats, toShares(DEFAULT_RATIOS));
    let fx = 0;
    let distinct = 0;
    let frames = 0;
    let spreadSum = 0;
    for (let f = 0; f < 60 * 120; f++) {
      fx += 1 / 60;
      tr.step(1 / 60, fx);
      if (f % 6) continue;
      frames++;
      if (new Set(tr.anchors()).size === tr.anchors().length) distinct++;
      const b = tr.boxes();
      const cx = b.map((x) => x.x + x.w / 2);
      const cy = b.map((x) => x.y + x.h / 2);
      const mx = cx.reduce((a, c) => a + c, 0) / cx.length;
      const my = cy.reduce((a, c) => a + c, 0) / cy.length;
      spreadSum += Math.sqrt(cx.reduce((a, c) => a + (c - mx) ** 2, 0) / cx.length + cy.reduce((a, c) => a + (c - my) ** 2, 0) / cy.length) / W;
    }
    expect(distinct / frames).toBeGreaterThan(0.95);
    expect(spreadSum / frames).toBeGreaterThan(0.12);
  });

  it('정지(dt=0) 동안은 박스가 그대로이고, 이미지가 달라도(특징점 없음) 박스가 캔버스 안에 있다', () => {
    const tr = new BoxTracker(2);
    tr.configure(W, H, [], toShares(DEFAULT_RATIOS)); // 특징점 없음 → 분산 점으로 대체
    tr.step(0.5, 1);
    const a = JSON.stringify(tr.boxes());
    tr.step(0, 1);
    expect(JSON.stringify(tr.boxes())).toBe(a);
    for (const b of tr.boxes()) expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H).toBe(true);
    expect(tr.featureCount()).toBeGreaterThanOrEqual(10);
  });

  it('장르 선택·해제 시 박스 수가 정확히 따라가고, 모두 해제하면 0개', () => {
    const tr = new BoxTracker(4);
    tr.configure(W, H, feats, toShares(DEFAULT_RATIOS));
    expect(tr.boxes().length).toBe(5);
    tr.setShares([{ id: 'pop', share: 50 }, { id: 'rock', share: 50 }, { id: 'rnb', share: 0 }]);
    expect(tr.boxes().map((b) => b.id).sort()).toEqual(['pop', 'rock']);
    tr.setShares([]);
    expect(tr.boxes().length).toBe(0);
    tr.setShares([{ id: 'hiphop', share: 100 }]);
    expect(tr.boxes().length).toBe(1);
  });
});

describe('특징점 검출', () => {
  it('밝은 점 두 개를 상위 특징점으로 찾는다', () => {
    const w = 64;
    const h = 48;
    const d = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let i = 0; i < w * h; i++) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 20;
    const blob = (cx: number, cy: number) => {
      for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) d[((cy + y) * w + cx + x) * 4] = d[((cy + y) * w + cx + x) * 4 + 1] = d[((cy + y) * w + cx + x) * 4 + 2] = 250;
    };
    blob(48, 12);
    blob(16, 36);
    const pts = detectFeatures(d, w, h, 4);
    const near = (x: number, y: number) => pts.some((p) => Math.hypot(p.x * w - x, p.y * h - y) < 8);
    expect(near(48, 12)).toBe(true);
    expect(near(16, 36)).toBe(true);
  });
});
