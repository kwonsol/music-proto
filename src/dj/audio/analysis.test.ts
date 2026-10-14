import { describe, expect, it } from 'vitest';
import { estimateTempo, onsetEnvelope, pickOnsets, rankSlices } from './analysis';

const SR = 44100;

/** 킥 + 하이햇(8분·16분) 합성 트랙. tresillo=true 면 저음을 마디 안 16분음표 0,3,6,9,12 자리에 둔다 */
function synth(bpm: number, first: number, seconds: number, tresillo = false) {
  const out = new Float32Array(Math.floor(SR * seconds));
  const beat = 60 / bpm;
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const kick = (t: number, amp: number) => {
    const s = Math.floor(t * SR);
    for (let i = 0; i < SR * 0.25 && s + i < out.length; i++) {
      const tt = i / SR;
      out[s + i] += amp * Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 12);
    }
  };
  const hat = (t: number, amp: number) => {
    const s = Math.floor(t * SR);
    // 실제 하이햇처럼 저음이 없도록 1차 차분(고역 통과)한 노이즈
    let prev = 0;
    for (let i = 0; i < SR * 0.04 && s + i < out.length; i++) {
      const n = rnd();
      out[s + i] += amp * 0.5 * (n - prev) * Math.exp(-(i / SR) * 90);
      prev = n;
    }
  };
  for (let t = first, k = 0; t < seconds - 0.3; t += beat, k++) {
    if (!tresillo) kick(t, 0.8);
    else if (k % 4 === 0) {
      // 한 마디(4박) 안 16분음표 0, 3, 6, 9, 12 위치의 저음 (예제 곡과 같은 형태)
      for (const s of [0, 3, 6, 9, 12]) kick(t + (s * beat) / 4, 0.8);
    }
    hat(t, 0.3);
    hat(t + beat / 2, 0.3);
    hat(t + beat / 4, 0.12);
    hat(t + (3 * beat) / 4, 0.12);
  }
  return out;
}

describe('estimateTempo', () => {
  it('finds bpm and first beat of a straight beat', () => {
    const t = estimateTempo(onsetEnvelope(synth(120, 0.31, 12), SR));
    expect(Math.abs(t.bpm - 120)).toBeLessThan(0.5);
    expect(Math.abs(t.firstBeat - 0.31)).toBeLessThan(0.015);
  });

  it('is not fooled into 3/2 tempo by a 3-3-2 bass pattern', () => {
    const t = estimateTempo(onsetEnvelope(synth(130, 0.2, 15, true), SR));
    expect(Math.abs(t.bpm - 130)).toBeLessThan(0.6);
    const beat = 60 / 130;
    const err = ((((t.firstBeat - 0.2) / beat) % 1) + 1) % 1;
    expect(Math.min(err, 1 - err) * beat).toBeLessThan(0.015);
  });
});

describe('rankSlices', () => {
  it('skips silence and prefers loud on-beat hits', () => {
    const x = synth(120, 0.5, 8);
    x.fill(0, 0, Math.floor(SR * 4)); // 앞 4초 무음
    const on = onsetEnvelope(x, SR);
    const tempo = estimateTempo(on);
    const s = rankSlices(x, SR, pickOnsets(on), tempo, { length: 0.25 });
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((v) => v.start > 3.9)).toBe(true);
  });
});
