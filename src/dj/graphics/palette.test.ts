import { describe, expect, it } from 'vitest';
import { complementPalette, dominantHues, fitToBackground, hslToRgb, luminance, contrast } from './palette';

function pixels(list: [number, number, number, number][]) {
  const out: number[] = [];
  for (const [r, g, b, n] of list) for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  return new Uint8ClampedArray(out);
}

describe('palette', () => {
  it('ignores black/white/gray and finds red and green', () => {
    const px = pixels([
      [0, 0, 0, 500],
      [255, 255, 255, 500],
      [128, 128, 128, 500],
      [200, 30, 30, 300],
      [40, 180, 60, 150],
    ]);
    const hues = dominantHues(px);
    expect(hues.length).toBe(2);
    expect(Math.min(hues[0].hue, 360 - hues[0].hue)).toBeLessThan(8); // 빨강
    expect(Math.abs(hues[1].hue - 128)).toBeLessThan(10); // 초록
  });

  it('rotates hue by 180 degrees', () => {
    const p = complementPalette([{ hue: 10, weight: 0.7 }, { hue: 130, weight: 0.3 }]);
    expect(p[0].color.h).toBeCloseTo(190);
    expect(p[1].color.h).toBeCloseTo(310);
  });

  it('keeps hue and reaches 3:1 contrast on dark and bright backgrounds', () => {
    for (const bg of [0.02, 0.8]) {
      const { color } = fitToBackground({ h: 190, s: 0.85, l: 0.6 }, bg);
      expect(color.h).toBe(190);
      expect(contrast(luminance(hslToRgb(color)), bg)).toBeGreaterThanOrEqual(3);
    }
  });
});
