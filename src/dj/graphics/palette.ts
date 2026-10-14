// 앨범커버의 대표 유채색 → 색상각 180° 회전한 보색 팔레트.
// 페이지를 열 때 한 번 만들고 유지한다 (재생할 때마다 바뀌지 않음).

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export interface PaletteEntry {
  /** 커버에서 추출한 원래 색상각 */
  sourceHue: number;
  /** 커버 픽셀에서 이 색상이 차지한 비중 (0~1) */
  weight: number;
  /** 보색 (h = sourceHue + 180) */
  color: Hsl;
}

export function rgbToHsl(r: number, g: number, b: number): Hsl {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function hslCss(c: Hsl, alpha = 1): string {
  return `hsla(${c.h.toFixed(1)}, ${(c.s * 100).toFixed(1)}%, ${(c.l * 100).toFixed(1)}%, ${alpha})`;
}

/** WCAG 상대 휘도 */
export function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(l1: number, l2: number) {
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

/**
 * RGBA 픽셀 배열에서 대표 유채색 색상각을 찾는다.
 * 검정·흰색·회색(채도 낮음, 너무 어둡거나 밝음)은 제외하고, 채도로 가중한 색상각 히스토그램의 봉우리를 고른다.
 */
export function dominantHues(rgba: Uint8ClampedArray, maxCount = 3): { hue: number; weight: number }[] {
  const BINS = 36;
  const hist = new Float64Array(BINS);
  const sumX = new Float64Array(BINS);
  const sumY = new Float64Array(BINS);
  let total = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const c = rgbToHsl(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (c.s < 0.28 || c.l < 0.12 || c.l > 0.88) continue;
    const w = c.s * (1 - Math.abs(2 * c.l - 1));
    const bin = Math.floor(c.h / (360 / BINS)) % BINS;
    hist[bin] += w;
    sumX[bin] += w * Math.cos((c.h * Math.PI) / 180);
    sumY[bin] += w * Math.sin((c.h * Math.PI) / 180);
    total += w;
  }
  if (total === 0) return [];
  // 원형으로 이웃 bin 을 더해 부드럽게
  const smooth = hist.map((_, i) => hist[(i + BINS - 1) % BINS] * 0.5 + hist[i] + hist[(i + 1) % BINS] * 0.5);
  const out: { hue: number; weight: number }[] = [];
  const used = new Set<number>();
  for (let n = 0; n < maxCount; n++) {
    let best = -1;
    for (let i = 0; i < BINS; i++) {
      if (used.has(i)) continue;
      if (best < 0 || smooth[i] > smooth[best]) best = i;
    }
    if (best < 0 || smooth[best] < (out.length ? 0.01 : 0) * total) break;
    // 봉우리 주변 ±1 bin 의 원형 평균으로 정확한 색상각
    let x = 0;
    let y = 0;
    let w = 0;
    for (const d of [-1, 0, 1]) {
      const k = (best + d + BINS) % BINS;
      x += sumX[k];
      y += sumY[k];
      w += hist[k];
    }
    const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    out.push({ hue, weight: w / total });
    // 30° 이내는 같은 색으로 보고 제외
    for (let d = -3; d <= 3; d++) used.add((best + d + BINS) % BINS);
  }
  return out;
}

export function complementPalette(hues: { hue: number; weight: number }[]): PaletteEntry[] {
  const entries = hues.map(({ hue, weight }) => ({
    sourceHue: hue,
    weight,
    color: { h: (hue + 180) % 360, s: 0.85, l: 0.6 },
  }));
  if (entries.length === 1) {
    // 대표색이 하나뿐이면 같은 보색의 밝기 변주로 2색을 만든다
    const c = entries[0].color;
    entries.push({ ...entries[0], color: { ...c, l: 0.78, s: 0.7 } });
  }
  return entries.slice(0, 4);
}

/**
 * 배경 휘도에 맞춰 보색의 명도·채도만 조정한다 (색상각 유지).
 * 3:1 대비를 못 맞추면 얇은 대비 테두리를 쓰도록 outline 을 돌려준다.
 */
export function fitToBackground(c: Hsl, bgLum: number): { color: Hsl; outline: string | null } {
  let best = c;
  let bestScore = -1;
  for (let l = 0.3; l <= 0.86; l += 0.02) {
    for (const s of [c.s, Math.min(1, c.s + 0.1)]) {
      const cand = { h: c.h, s, l };
      const cr = contrast(luminance(hslToRgb(cand)), bgLum);
      // 대비 3 이상을 만족하면서 기본 명도(0.6)에 가까울수록 좋음
      const score = Math.min(cr, 3) * 10 - Math.abs(l - 0.6);
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
  }
  const cr = contrast(luminance(hslToRgb(best)), bgLum);
  const outline = cr < 3 ? (bgLum > 0.3 ? 'rgba(10,10,14,0.7)' : 'rgba(255,255,255,0.7)') : null;
  return { color: best, outline };
}
