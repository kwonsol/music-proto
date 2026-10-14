import { GENRE_IDS, type GenreId } from './genres';

/** 선택된 장르만 키로 가진다. 값은 퍼센트이며 합계는 항상 100 (선택이 하나도 없으면 빈 객체). */
export type Ratios = Partial<Record<GenreId, number>>;

export const DEFAULT_RATIOS: Ratios = { pop: 30, hiphop: 25, electronic: 20, rock: 15, rnb: 10 };

const selectedIds = (r: Ratios) => GENRE_IDS.filter((id) => r[id] !== undefined);

/** 합계를 정확히 100으로 맞춘다 (부동소수점 잔여분은 가장 큰 항목이 흡수). */
function fixSum(r: Ratios, keep?: GenreId): Ratios {
  const ids = selectedIds(r);
  if (ids.length === 0) return {};
  const sum = ids.reduce((s, id) => s + (r[id] as number), 0);
  const resid = 100 - sum;
  if (Math.abs(resid) < 1e-12) return r;
  const pool = ids.filter((id) => id !== keep);
  const targets = pool.length ? pool : ids;
  const big = targets.reduce((a, b) => ((r[b] as number) > (r[a] as number) ? b : a));
  return { ...r, [big]: Math.max(0, (r[big] as number) + resid) };
}

export function toggleGenre(r: Ratios, id: GenreId): Ratios {
  const ids = selectedIds(r);
  if (r[id] !== undefined) {
    // 해제: 남은 장르가 기존 비율에 비례해 100%를 채운다. 모두 0이면 균등 분배.
    const rest = ids.filter((g) => g !== id);
    if (rest.length === 0) return {};
    const sum = rest.reduce((s, g) => s + (r[g] as number), 0);
    const next: Ratios = {};
    for (const g of rest) next[g] = sum > 0 ? ((r[g] as number) / sum) * 100 : 100 / rest.length;
    return fixSum(next);
  }
  // 선택: 새 장르는 균등 몫을 받고 나머지는 비례 축소. 기존이 전부 0이면 새 장르가 100%.
  if (ids.length === 0) return { [id]: 100 };
  const sum = ids.reduce((s, g) => s + (r[g] as number), 0);
  const share = sum > 0 ? 100 / (ids.length + 1) : 100;
  const next: Ratios = {};
  for (const g of ids) next[g] = sum > 0 ? ((r[g] as number) / sum) * (100 - share) : 0;
  next[id] = share;
  return fixSum(next, id);
}

export function setRatio(r: Ratios, id: GenreId, value: number): Ratios {
  if (r[id] === undefined || !Number.isFinite(value)) return r;
  const ids = selectedIds(r);
  if (ids.length === 1) return { [id]: 100 };
  const v = Math.min(100, Math.max(0, value));
  const others = ids.filter((g) => g !== id);
  const sum = others.reduce((s, g) => s + (r[g] as number), 0);
  const next: Ratios = { [id]: v };
  for (const g of others) {
    // 나머지는 기존 비율에 비례. 전부 0이면 남은 몫을 균등 분배.
    next[g] = sum > 0 ? ((r[g] as number) / sum) * (100 - v) : (100 - v) / others.length;
  }
  return fixSum(next, id);
}

export const formatPct = (v: number) => String(Math.round(v * 10) / 10);
