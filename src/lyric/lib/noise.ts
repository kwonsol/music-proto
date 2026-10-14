/** 결정적 해시 (0..1). 같은 입력이면 항상 같은 값 → 일시정지 시 왜곡이 정확히 멈춘다. */
export function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 부호 있는 해시 (-1..1) */
export const shash = (a: number, b = 0, c = 0) => hash(a, b, c) * 2 - 1;

/** 1D value noise (-1..1), 부드럽게 보간 */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return shash(i, seed) * (1 - u) + shash(i + 1, seed) * u;
}

/** 여러 옥타브를 섞은 불규칙 노이즈 */
export function fbm(x: number, seed = 0): number {
  return noise1(x, seed) * 0.6 + noise1(x * 2.3 + 7.1, seed + 11) * 0.28 + noise1(x * 5.7 + 3.3, seed + 23) * 0.12;
}

/** 시드 기반 의사난수 수열 */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
