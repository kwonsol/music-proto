/**
 * 면적 보존 분할 (stream-slicing) + 컷 전환
 * ------------------------------------------------------------------
 * 전체 영역(W×H)을 "면적 스트림"으로 본다. 스트림은 장르별 슬롯(조각)을 이어 붙인 1차원 구간이고
 * 각 슬롯의 길이는 그 슬롯의 면적이다.
 *
 *  1. 행 높이 h_r 는 Σh_r = H 를 만족하도록 가중치를 정규화해서 얻는다.
 *  2. 행 r 은 스트림에서 [W·y_r, W·(y_r+h_r)] 구간(길이 W·h_r)을 소비한다.
 *  3. 슬롯과 행 구간의 교집합 길이 ℓ 이 곧 사각형의 면적이고, 너비는 ℓ / h_r 로 다시 계산된다.
 *     (면적 A 인 사각형의 높이를 h 로 바꾸면 너비는 A/h) → 좌표를 보간하지 않으므로 면적이 변하지 않는다.
 *  4. 슬롯 면적은 장르 면적 p_g·W·H 를 슬롯 가중치로 나눈 값. 가중치는 장르 안에서 정규화되므로 장르 합계는 불변.
 *  5. 스트림이 빈틈 없이 행을 채우고 각 행은 폭 W 를 정확히 채우므로, 어느 순간이든 빈틈·겹침 없는 사각형 분할이다.
 *
 * 움직임은 보간이 아니라 "컷"이다. 0.2~0.4s(τ 단위, 불규칙) 간격의 이벤트마다 몇 개 항목(행 가중치, 슬롯 가중치,
 * 슬롯 배치 순서)만 새 값으로 즉시 교체된다. 항목 값은 이벤트 이력에서 결정되는 순수 함수라 테스트가 쉽다.
 */
import { GENRE_INDEX, type GenreId } from '../lib/genres';
import { clamp, hash2, smoothstep } from '../lib/math';

export interface GenreShare {
  id: GenreId;
  /** 상대 비율 (내부에서 합 1로 정규화) */
  share: number;
}

export interface Rect {
  id: string;
  genre: GenreId;
  slot: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const SLOTS_PER_GENRE = 3;
const MIN_ROW_FRAC = 0.06;
export const EVENT_PERIOD = 0.3; // 이벤트 간격 평균 (τ 단위)
const PICKS_PER_EVENT = 1;
const HISTORY = 260;

/** k 번째 이벤트 시각: 일정 간격 + 불규칙 지터 (단조 증가 보장) */
export const eventTime = (k: number) => k * EVENT_PERIOD + (hash2(k, 5) - 0.5) * 0.6 * EVENT_PERIOD;

export function lastEventIndex(tau: number): number {
  let k = Math.floor(tau / EVENT_PERIOD) + 1;
  while (eventTime(k) > tau) k--;
  return k;
}

const ORDER_ITEM = 5 + 5 * SLOTS_PER_GENRE;
/**
 * 이벤트가 갱신할 항목: 슬롯 가중치(75%) — 그 장르의 구획만 바뀐다 / 행 높이(10%) / 장르 배치 순서(15%) — 전체가 재배치.
 * 한 장르의 슬롯은 스트림에서 연속이므로, 슬롯 가중치 변경은 장르 합계가 불변이라 다른 장르의 구획을 건드리지 않는다.
 */
const picks = (k: number, n: number) => {
  const u = hash2(k, 17 + n);
  if (u < 0.75) return 5 + Math.min(14, Math.floor((u / 0.75) * 15));
  if (u < 0.85) return Math.min(4, Math.floor(((u - 0.75) / 0.1) * 5));
  return ORDER_ITEM;
};

/** 항목의 현재 값 [0,1): 마지막으로 그 항목을 갱신한 이벤트의 해시. 보간 없음 */
function itemValue(K: number, item: number): number {
  for (let k = K; k > K - HISTORY; k--) {
    for (let n = 0; n < PICKS_PER_EVENT; n++) if (picks(k, n) === item) return hash2(k, item + 1000);
  }
  return hash2(-1, item + 1000);
}

export function rowCount(n: number): number {
  return clamp(n + 1, 3, 5);
}

/** 행 높이 (합계가 정확히 H) */
export function rowHeights(n: number, H: number, K: number): number[] {
  const R = rowCount(n);
  const w: number[] = [];
  for (let r = 0; r < R; r++) w.push(0.4 + 1.4 * itemValue(K, r));
  const sum = w.reduce((a, b) => a + b, 0);
  const h = w.map((v) => H * (MIN_ROW_FRAC + (1 - R * MIN_ROW_FRAC) * (v / sum)));
  h[R - 1] = H - h.slice(0, R - 1).reduce((a, b) => a + b, 0); // 부동소수점 잔여분 흡수
  return h;
}

function slotActivity(p: number): number[] {
  return [1, smoothstep(0.06, 0.14, p), smoothstep(0.2, 0.32, p)];
}

/** 장르 g 의 슬롯별 면적 (합계 = genreArea) */
export function slotAreas(genre: GenreId, p: number, genreArea: number, K: number): number[] {
  const gi = GENRE_INDEX[genre];
  const raw = slotActivity(p).map((a, i) => a * (0.1 + 1.1 * itemValue(K, 5 + gi * SLOTS_PER_GENRE + i)));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => (genreArea * v) / sum);
}

export function computeLayout(genres: GenreShare[], W: number, H: number, tau: number): Rect[] {
  const K = lastEventIndex(tau);
  const active = genres.filter((g) => g.share > 0);
  if (active.length === 0) return [];
  const total = active.reduce((s, g) => s + g.share, 0);
  if (active.length === 1) {
    return [{ id: `${active[0].id}:0:0`, genre: active[0].id, slot: 0, x: 0, y: 0, w: W, h: H }];
  }

  // 1) 스트림 구성: 슬롯 순서를 장르별로 교차시켜 같은 장르 조각이 붙지 않게 한다.
  const areas = active.map((g) => slotAreas(g.id, g.share / total, (g.share / total) * W * H, K));
  const pieces: { genre: GenreId; slot: number; area: number }[] = [];
  // 장르 배치 순서도 컷으로 바뀐다. 한 장르의 슬롯은 스트림에서 연속 배치.
  const seedOrder = Math.floor(itemValue(K, ORDER_ITEM) * 1e6);
  const order = active
    .map((g, gi) => ({ gi, key: hash2(seedOrder, GENRE_INDEX[g.id]) }))
    .sort((a, b) => a.key - b.key);
  for (const { gi } of order) {
    for (let s = 0; s < SLOTS_PER_GENRE; s++) pieces.push({ genre: active[gi].id, slot: s, area: areas[gi][s] });
  }

  // 2) 행 구간
  const heights = rowHeights(active.length, H, K);
  const rowTop: number[] = [];
  let acc = 0;
  for (const h of heights) {
    rowTop.push(acc);
    acc += h;
  }

  // 3) 스트림을 행에 흘려 넣는다.
  const out: Rect[] = [];
  let s0 = 0;
  const streamEnd = W * H;
  pieces.forEach((pc, pi) => {
    const s1 = pi === pieces.length - 1 ? streamEnd : s0 + pc.area;
    heights.forEach((h, r) => {
      const rs = W * rowTop[r];
      const re = r === heights.length - 1 ? streamEnd : W * (rowTop[r] + h);
      const lo = Math.max(s0, rs);
      const hi = Math.min(s1, re);
      if (hi - lo <= 1e-9) return;
      const x0 = lo === rs ? 0 : (lo - rs) / h;
      const x1 = re - hi <= 1e-9 ? W : (hi - rs) / h;
      out.push({
        id: `${pc.genre}:${pc.slot}:${r}`,
        genre: pc.genre,
        slot: pc.slot,
        x: x0,
        y: rowTop[r],
        w: x1 - x0,
        h,
      });
    });
    s0 = s1;
  });
  return out;
}

export function genreAreas(rects: Rect[]): Partial<Record<GenreId, number>> {
  const out: Partial<Record<GenreId, number>> = {};
  for (const r of rects) out[r.genre] = (out[r.genre] ?? 0) + r.w * r.h;
  return out;
}
