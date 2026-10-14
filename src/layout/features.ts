/**
 * 특징점(탐지 대상 후보) — 정규화 좌표(0..1, 원본 이미지 기준).
 * 기본 사과 사진은 직접 지정하고, 업로드한 이미지는 간단한 돌출도(밝기·경계) 분석으로 찾는다. 객체 인식 AI는 쓰지 않는다.
 */
export interface Point {
  x: number;
  y: number;
  /** 선택 가중치(큰 특징일수록 자주 잡힌다) */
  weight: number;
}

/** 기본 사과 사진: 꼭지, 반사광, 어깨선, 윤곽, 하단 오목부 등 */
export const DEFAULT_APPLE_FEATURES: Point[] = [
  { x: 0.5, y: 0.19, weight: 1.2 }, // 꼭지
  { x: 0.43, y: 0.41, weight: 1.5 }, // 큰 반사광
  { x: 0.53, y: 0.44, weight: 1.4 }, // 두 번째 반사광
  { x: 0.65, y: 0.4, weight: 0.8 }, // 오른쪽 작은 반사광
  { x: 0.29, y: 0.47, weight: 1.0 }, // 왼쪽 윤곽
  { x: 0.71, y: 0.47, weight: 1.0 }, // 오른쪽 윤곽
  { x: 0.36, y: 0.26, weight: 1.0 }, // 왼쪽 어깨
  { x: 0.66, y: 0.25, weight: 1.0 }, // 오른쪽 어깨
  { x: 0.5, y: 0.56, weight: 0.9 }, // 어두운 몸통
  { x: 0.36, y: 0.68, weight: 0.9 }, // 왼쪽 아래 윤곽
  { x: 0.66, y: 0.68, weight: 0.9 }, // 오른쪽 아래 윤곽
  { x: 0.52, y: 0.77, weight: 1.1 }, // 아래 오목부
];

/** 저해상도 RGBA 에서 돌출도 상위 지점을 고른다. 결과는 최대 max 개, 서로 충분히 떨어져 있다. */
export function detectFeatures(data: ArrayLike<number>, w: number, h: number, max = 12): Point[] {
  const lum = new Float32Array(w * h);
  let mean = 0;
  for (let i = 0; i < w * h; i++) {
    lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    mean += lum[i];
  }
  mean /= w * h;
  const sal = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = lum[i + 1] - lum[i - 1];
      const gy = lum[i + w] - lum[i - w];
      sal[i] = Math.hypot(gx, gy) + 0.6 * Math.abs(lum[i] - mean);
    }
  }
  // 3x3 평균을 두 번 → 점 하나가 아니라 "영역" 단위의 돌출도
  let cur = sal;
  for (let pass = 0; pass < 2; pass++) {
    const nxt = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += cur[(y + dy) * w + x + dx];
        nxt[y * w + x] = s / 9;
      }
    cur = nxt;
  }
  const out: Point[] = [];
  const radius = 0.2 * Math.min(w, h);
  const taken = new Uint8Array(w * h);
  let top = 0;
  for (let n = 0; n < max; n++) {
    let best = -1;
    let bv = 0;
    for (let i = 0; i < w * h; i++) {
      if (!taken[i] && cur[i] > bv) {
        bv = cur[i];
        best = i;
      }
    }
    if (best < 0) break;
    if (n === 0) top = bv;
    if (bv < top * 0.22) break;
    const bx = best % w;
    const by = Math.floor(best / w);
    out.push({ x: (bx + 0.5) / w, y: (by + 0.5) / h, weight: 0.6 + bv / top });
    for (let y = Math.max(0, Math.floor(by - radius)); y <= Math.min(h - 1, Math.ceil(by + radius)); y++)
      for (let x = Math.max(0, Math.floor(bx - radius)); x <= Math.min(w - 1, Math.ceil(bx + radius)); x++)
        if (Math.hypot(x - bx, y - by) <= radius) taken[y * w + x] = 1;
  }
  return out;
}

/** 특징점이 부족하거나 한쪽에 몰렸을 때 채우는 균등 분산 점 (R2 quasi-random) */
export function scatterPoints(n: number): Point[] {
  const g = 1.32471795724474602596;
  const a1 = 1 / g;
  const a2 = 1 / (g * g);
  return Array.from({ length: n }, (_, i) => ({
    x: 0.12 + 0.76 * ((0.5 + a1 * (i + 1)) % 1),
    y: 0.12 + 0.76 * ((0.5 + a2 * (i + 1)) % 1),
    weight: 0.5,
  }));
}
