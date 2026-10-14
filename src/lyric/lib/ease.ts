export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const fract = (v: number) => v - Math.floor(v);

export type Ease = (x: number) => number;
export const linear: Ease = (x) => x;
export const smooth: Ease = (x) => x * x * (3 - 2 * x);
export const easeInQuad: Ease = (x) => x * x;
export const easeInCubic: Ease = (x) => x * x * x;
export const easeOutCubic: Ease = (x) => 1 - (1 - x) ** 3;
export const easeInOutCubic: Ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** 순간적으로 튀어 오르는 스냅 */
export const snap: Ease = (x) => 1 - (1 - x) ** 6;

/**
 * 원형 → 변형 → 유지 → 복귀 흐름의 공통 엔벨로프.
 * phase 가 [a,b] 에서 0→1, [b,c] 유지, [c,d] 에서 1→0, 그 밖은 0(원형).
 */
export function envelope(p: number, a: number, b: number, c: number, d: number, inE: Ease = easeInOutCubic, outE: Ease = easeInOutCubic): number {
  if (p <= a || p >= d) return 0;
  if (p < b) return inE((p - a) / (b - a));
  if (p <= c) return 1;
  return 1 - outE((p - c) / (d - c));
}

/** 감쇠 진동: x=0 에서 1, 음수로 넘쳤다가 x=1 에서 0 으로 수렴 (탄성 복귀) */
export function spring(x: number, freq = 1.25, damp = 2.5): number {
  if (x <= 0) return 1;
  if (x >= 1) return 0;
  return Math.exp(-damp * x) * Math.cos(Math.PI * 2 * freq * x) * Math.sqrt(1 - x);
}
