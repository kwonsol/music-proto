import { describe, expect, it } from 'vitest';
import { AREA_REL, BoxTracker, boxAreas, boxSize, feasibleAspect, spreadOrder, type GenreShare, type Point } from './boxes';
import { DEFAULT_APPLE_FEATURES, detectFeatures } from './features';
import { GENRE_IDS } from '../lib/genres';
import { DEFAULT_RATIOS, type Ratios } from '../lib/ratios';
import { bboxOfAlpha, maskFromBorder } from '../subject/mask';

const W = 1600;
const H = 1200;
// 대상: 캔버스 중앙의 경계 상자
const SUBJ = { cx: W / 2, cy: H / 2, w: 0.5 * W, h: 0.62 * H };
const cands: Point[] = DEFAULT_APPLE_FEATURES.map((p) => ({
  x: SUBJ.cx + (p.x - 0.5) * SUBJ.w * 1.6,
  y: SUBJ.cy + (p.y - 0.5) * SUBJ.h * 1.4,
  weight: p.weight,
}));
const toShares = (r: Ratios): GenreShare[] =>
  GENRE_IDS.filter((id) => r[id] !== undefined).map((id) => ({ id, share: r[id] as number }));
const make = (seed: number, r: Ratios = DEFAULT_RATIOS) => {
  const tr = new BoxTracker(seed);
  tr.configure(W, H, SUBJ, cands, toShares(r));
  return tr;
};

describe('효과 박스 — 개수·면적', () => {
  const combos: Ratios[] = [
    DEFAULT_RATIOS,
    { pop: 60, hiphop: 10, electronic: 10, rock: 10, rnb: 10 },
    { pop: 50, rnb: 50 },
    { rock: 100 },
    { pop: 97, hiphop: 3 },
    { pop: 33.3, hiphop: 33.3, rock: 33.4 },
  ];

  it('선택한 장르 수 = 박스 수, 박스 면적 = 비율·예산 이 매 프레임 정확히 유지(종횡비만 변함)', () => {
    for (const c of combos) {
      const shares = toShares(c);
      const tr = make(3, c);
      let fx = 0;
      const aspects = new Map<string, Set<number>>();
      for (let f = 0; f < 60 * 60; f++) {
        fx += 1 / 60;
        tr.step(1 / 60, fx);
        const boxes = tr.boxes();
        expect(boxes.length).toBe(shares.length);
        const total = shares.reduce((a, s) => a + s.share, 0);
        const areas = boxAreas(boxes);
        for (const s of shares) {
          const want = (s.share / total) * AREA_REL * SUBJ.w * SUBJ.h;
          expect(Math.abs((areas[s.id] ?? 0) - want) / (W * H)).toBeLessThan(1e-9);
        }
        for (const b of boxes) {
          expect(b.x).toBeGreaterThanOrEqual(-1e-6);
          expect(b.y).toBeGreaterThanOrEqual(-1e-6);
          expect(b.x + b.w).toBeLessThanOrEqual(W + 1e-6);
          expect(b.y + b.h).toBeLessThanOrEqual(H + 1e-6);
          expect(b.w / b.h).toBeGreaterThan(0.44);
          expect(b.w / b.h).toBeLessThan(2.25);
          (aspects.get(b.id) ?? aspects.set(b.id, new Set()).get(b.id)!).add(Math.round((b.w / b.h) * 50));
        }
      }
      // 크기(종횡비)가 실제로 변한다
      for (const s of aspects.values()) if (shares.length > 1 || true) expect(s.size).toBeGreaterThan(8);
    }
  });

  it('width = √(A·r), height = √(A/r); 캔버스를 넘으면 면적이 아니라 종횡비를 조정', () => {
    const { w, h } = boxSize(250000, 1.6);
    expect(w).toBeCloseTo(Math.sqrt(250000 * 1.6), 9);
    expect(h).toBeCloseTo(Math.sqrt(250000 / 1.6), 9);
    const r = feasibleAspect(0.5 * W * H, W, H, 2);
    const s = boxSize(0.5 * W * H, r);
    expect(s.w).toBeLessThanOrEqual(W);
    expect(s.h).toBeLessThanOrEqual(H);
  });
});

describe('효과 박스 — 기준점 주변의 좁은 이동', () => {
  it('기준점은 장르마다 고정·서로 다르고, 중심은 기준점에서 대상 크기의 ~7.5% 안에서만 움직인다', () => {
    const tr = make(11);
    const anchors = new Map(GENRE_IDS.map((g) => [g, tr.anchorOf(g)]));
    expect(new Set([...anchors.values()]).size).toBe(5);
    let fx = 0;
    let maxDx = 0;
    let maxDy = 0;
    for (let f = 0; f < 60 * 120; f++) {
      fx += 1 / 60;
      tr.step(1 / 60, fx);
      for (const b of tr.boxes()) {
        const a = anchors.get(b.id)!;
        expect(tr.anchorOf(b.id)).toBe(a); // 고정
        maxDx = Math.max(maxDx, Math.abs(b.x + b.w / 2 - a.x) / SUBJ.w);
        maxDy = Math.max(maxDy, Math.abs(b.y + b.h / 2 - a.y) / SUBJ.h);
      }
    }
    expect(maxDx).toBeLessThan(0.075);
    expect(maxDy).toBeLessThan(0.075);
    expect(maxDx).toBeGreaterThan(0.02); // 실제로 보정되며 움직이긴 한다
  });

  it('가로로 넓어졌다 세로로 길어진다 (모든 박스가 가로형·세로형 모두 경험)', () => {
    const tr = make(5);
    const wide = new Set<string>();
    const tall = new Set<string>();
    let fx = 0;
    for (let f = 0; f < 60 * 60; f++) {
      fx += 1 / 60;
      tr.step(1 / 60, fx);
      for (const b of tr.boxes()) {
        if (b.w / b.h > 1.3) wide.add(b.id);
        if (b.w / b.h < 0.77) tall.add(b.id);
      }
    }
    expect(wide.size).toBe(5);
    expect(tall.size).toBe(5);
  });

  it('박스마다 독립 타이밍으로 갱신(0.19~1.0s), 동시 갱신은 드물고, 일부는 겹친다', () => {
    const tr = make(5);
    const last: Record<string, number> = {};
    const gaps: number[] = [];
    let simultaneous = 0;
    let events = 0;
    let overlap = 0;
    let frames = 0;
    let fx = 0;
    for (let f = 0; f < 120 * 60; f++) {
      fx += 1 / 120;
      tr.step(1 / 120, fx);
      const b = tr.boxes();
      const ev = b.filter((x) => last[x.id] !== x.lastEvent);
      if (ev.length) {
        events += ev.length;
        if (ev.length > 1) simultaneous++;
        for (const x of ev) {
          if (last[x.id] !== undefined && last[x.id] > 0) gaps.push(x.lastEvent - last[x.id]); // 스폰 직후의 초기값(0)은 제외
          last[x.id] = x.lastEvent;
        }
      }
      if (f % 12 === 0) {
        frames++;
        let ov = false;
        for (let i = 0; i < b.length; i++)
          for (let j = i + 1; j < b.length; j++) {
            const iw = Math.min(b[i].x + b[i].w, b[j].x + b[j].w) - Math.max(b[i].x, b[j].x);
            const ih = Math.min(b[i].y + b[i].h, b[j].y + b[j].h) - Math.max(b[i].y, b[j].y);
            if (iw > 0 && ih > 0) ov = true;
          }
        if (ov) overlap++;
      }
    }
    expect(Math.min(...gaps)).toBeGreaterThan(0.19);
    expect(Math.max(...gaps)).toBeLessThan(1.0);
    expect(gaps.reduce((a, b) => a + b, 0) / gaps.length).toBeLessThan(0.5);
    expect(simultaneous / events).toBeLessThan(0.1);
    expect(overlap / frames).toBeGreaterThan(0.1);
  });

  it('정지(dt=0) 동안은 박스가 그대로이고, 장르 선택·해제 시 박스 수가 따라간다', () => {
    const tr = make(2);
    tr.step(0.5, 1);
    const a = JSON.stringify(tr.boxes());
    tr.step(0, 1);
    expect(JSON.stringify(tr.boxes())).toBe(a);
    tr.setShares([{ id: 'pop', share: 50 }, { id: 'rock', share: 50 }, { id: 'rnb', share: 0 }]);
    expect(tr.boxes().map((b) => b.id).sort()).toEqual(['pop', 'rock']);
    tr.setShares([]);
    expect(tr.boxes().length).toBe(0);
    tr.setShares([{ id: 'hiphop', share: 100 }]);
    expect(tr.boxes().length).toBe(1);
  });

  it('후보가 적어도(없어도) 기준점이 대상 경계 상자 안에서 분산 배치된다', () => {
    const tr = new BoxTracker(1);
    tr.configure(W, H, SUBJ, [], toShares(DEFAULT_RATIOS));
    const pts = GENRE_IDS.map((g) => tr.anchorOf(g));
    for (const p of pts) {
      expect(Math.abs(p.x - SUBJ.cx)).toBeLessThanOrEqual(SUBJ.w / 2);
      expect(Math.abs(p.y - SUBJ.cy)).toBeLessThanOrEqual(SUBJ.h / 2);
    }
    expect(spreadOrder(pts).length).toBe(5);
    expect(new Set(pts.map((p) => `${p.x}|${p.y}`)).size).toBeGreaterThanOrEqual(5);
  });
});

describe('대상 마스크·특징점', () => {
  it('테두리 색을 배경으로 보고 원형 대상만 남긴다 (사과 전용 규칙 없음)', () => {
    const w = 80;
    const h = 60;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const inDisk = Math.hypot(x - 40, y - 30) < 18;
        // 파란 배경 + 초록 대상 (색상 규칙이 사과(빨강)에 묶여 있지 않음을 확인)
        [d[o], d[o + 1], d[o + 2], d[o + 3]] = inDisk ? [30, 200, 60, 255] : [20, 90, 230, 255];
      }
    const m = maskFromBorder(d, w, h);
    expect(m.isolated).toBe(true);
    expect(m.coverage).toBeGreaterThan(0.18);
    expect(m.coverage).toBeLessThan(0.26);
    const bb = bboxOfAlpha((i) => m.alpha[i], w, h);
    expect(bb.w).toBeGreaterThan(0.4);
    expect(bb.w).toBeLessThan(0.55);
  });

  it('배경을 못 걷으면 이미지 전체를 대상으로 쓴다', () => {
    const w = 40;
    const h = 30;
    const d = new Uint8ClampedArray(w * h * 4).fill(128);
    const m = maskFromBorder(d, w, h);
    expect(m.isolated).toBe(false);
    expect(m.coverage).toBe(1);
  });

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
