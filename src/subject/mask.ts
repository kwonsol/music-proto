/**
 * 일반 업로드 이미지용 대상 마스크.
 * 사과 전용 색상 규칙은 쓰지 않는다. 이미지 테두리 색을 배경으로 보고, 테두리와 이어진 비슷한 색만 배경으로 걷어낸다.
 * 결과가 비정상(대상이 너무 작거나 거의 전체)이면 이미지 전체를 대상으로 쓴다.
 */
export interface MaskResult {
  /** 0 또는 255 */
  alpha: Uint8Array;
  coverage: number;
  /** 배경 제거에 성공했는지(false 면 이미지 전체를 대상으로 사용) */
  isolated: boolean;
}

export function maskFromBorder(data: ArrayLike<number>, w: number, h: number): MaskResult {
  const px = (x: number, y: number) => (y * w + x) * 4;
  // 테두리 픽셀의 중앙값 색
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const addBorder = (x: number, y: number) => {
    const o = px(x, y);
    rs.push(data[o]);
    gs.push(data[o + 1]);
    bs.push(data[o + 2]);
  };
  for (let x = 0; x < w; x++) {
    addBorder(x, 0);
    addBorder(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    addBorder(0, y);
    addBorder(w - 1, y);
  }
  const med = (a: number[]) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  const br = med(rs);
  const bg = med(gs);
  const bb = med(bs);
  const dist = (x: number, y: number) => {
    const o = px(x, y);
    return Math.hypot(data[o] - br, data[o + 1] - bg, data[o + 2] - bb);
  };
  // 테두리 색 분산에 맞춰 허용치를 정한다 (그라데이션 배경 대응)
  const bd: number[] = [];
  for (let x = 0; x < w; x++) bd.push(dist(x, 0), dist(x, h - 1));
  for (let y = 0; y < h; y++) bd.push(dist(0, y), dist(w - 1, y));
  const T = Math.min(90, Math.max(34, 2.2 * med(bd) + 30));

  const bgMask = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * w + x;
    if (!bgMask[i] && dist(x, y) < T) {
      bgMask[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop() as number;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  const alpha = new Uint8Array(w * h);
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!bgMask[i]) {
      alpha[i] = 255;
      n++;
    }
  }
  const coverage = n / (w * h);
  if (coverage < 0.06 || coverage > 0.93) return { alpha: new Uint8Array(w * h).fill(255), coverage: 1, isolated: false };
  return { alpha, coverage, isolated: true };
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 알파 > 127 인 영역의 정규화 경계 상자 */
export function bboxOfAlpha(alphaAt: (i: number) => number, w: number, h: number): BBox {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (alphaAt(y * w + x) > 127) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h };
}
