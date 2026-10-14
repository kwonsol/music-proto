import { describe, expect, it } from 'vitest';
import { compressAmount, compressMap } from './effects/compress';
import { DEMO_LYRICS, lineAt, parseMarked } from './data/lyrics';
import { DEFAULT_PRESETS, SEMANTIC_TAGS } from './data/presets';
import { envelope, spring } from './lib/ease';
import { hash, noise1 } from './lib/noise';

describe('parseMarked', () => {
  it('대괄호 구간만 강조 범위로 만든다', () => {
    expect(parseMarked('멀어지는 너를 [붙잡아]')).toEqual({ text: '멀어지는 너를 붙잡아', ranges: [[8, 11]] });
  });
  it('여러 구간을 지원한다', () => {
    expect(parseMarked('[A] B [CD]').ranges).toEqual([
      [0, 1],
      [4, 6],
    ]);
  });
  it('대괄호가 없으면 전체가 강조된다', () => {
    expect(parseMarked('HOLD ME')).toEqual({ text: 'HOLD ME', ranges: [[0, 7]] });
  });
});

describe('demo lyrics', () => {
  it('강조 범위가 실제 단어를 가리킨다', () => {
    const l = DEMO_LYRICS[0];
    const e = l.emphasis[0];
    expect(l.text.slice(e.start, e.end)).toBe('붙잡아');
    expect(DEMO_LYRICS.every((x) => x.emphasis.every((m) => m.source === 'manual'))).toBe(true);
  });
  it('모든 태그에 프리셋이 있다', () => {
    for (const l of DEMO_LYRICS) for (const e of l.emphasis) expect(SEMANTIC_TAGS).toContain(e.tag);
    expect(Object.keys(DEFAULT_PRESETS).length).toBe(9);
  });
  it('시간으로 현재 줄을 찾고 끝나면 처음으로 돌아간다', () => {
    expect(lineAt(DEMO_LYRICS, 0)?.index).toBe(0);
    expect(lineAt(DEMO_LYRICS, 12)?.line.text).toBe('우리 사이가 끊어져');
    const total = DEMO_LYRICS[DEMO_LYRICS.length - 1].end;
    expect(lineAt(DEMO_LYRICS, total + 1)?.index).toBe(0);
  });
  it('줄은 시간 순서이고 겹치지 않는다', () => {
    for (let i = 1; i < DEMO_LYRICS.length; i++) expect(DEMO_LYRICS[i].start).toBeGreaterThanOrEqual(DEMO_LYRICS[i - 1].end);
  });
});

describe('envelope', () => {
  it('사이클 양 끝은 원형(0)이고 중간은 유지(1)', () => {
    expect(envelope(0, 0.1, 0.3, 0.7, 0.9)).toBe(0);
    expect(envelope(0.5, 0.1, 0.3, 0.7, 0.9)).toBe(1);
    expect(envelope(0.95, 0.1, 0.3, 0.7, 0.9)).toBe(0);
  });
  it('spring 은 1 에서 시작해 음수로 넘쳤다가 0 으로 끝난다', () => {
    expect(spring(0)).toBe(1);
    expect(spring(1)).toBe(0);
    let min = 1;
    for (let x = 0; x <= 1; x += 0.01) min = Math.min(min, spring(x));
    expect(min).toBeLessThan(-0.15);
  });
});

describe('compress', () => {
  it('사이클 시작·끝은 원형, 중간은 최대 압축', () => {
    expect(compressAmount(0)).toBe(0);
    expect(compressAmount(0.5)).toBe(1);
    expect(compressAmount(0.99)).toBe(0);
  });
  it('내부 비율만 바뀌고 전체 범위는 보존된다 (단조 증가)', () => {
    for (const k of [0.05, 0.5, 1, 1.3]) {
      const [u0] = compressMap(10, 10, 110, 60, 15, k);
      const [u1] = compressMap(110 - 1e-9, 10, 110, 60, 15, k);
      expect(u0).toBeCloseTo(10);
      expect(u1).toBeCloseTo(110);
      let prev = -Infinity;
      for (let v = 10; v < 110; v += 0.5) {
        const [u] = compressMap(v, 10, 110, 60, 15, k);
        expect(u).toBeGreaterThanOrEqual(prev);
        prev = u;
      }
    }
  });
  it('k 가 작을수록 가운데 구간이 얇아진다', () => {
    const [, rate] = compressMap(60, 10, 110, 60, 15, 0.1);
    expect(rate).toBeCloseTo(10);
  });
});

describe('determinism', () => {
  it('같은 입력이면 같은 값 → 일시정지 시 정확히 멈춘다', () => {
    expect(hash(3, 4, 5)).toBe(hash(3, 4, 5));
    expect(noise1(1.234, 9)).toBe(noise1(1.234, 9));
    expect(hash(3, 4, 5)).not.toBe(hash(3, 4, 6));
  });
});

describe('ring lines', async () => {
  const { DEFAULT_RINGS } = await import('./data/rings');
  const { defaultParams, controlsOf } = await import('./effects');
  const { ringFrame } = await import('./render/ring');
  it('예시는 4줄 이상: 1줄 유체, 2줄 회전 잔상, 나머지는 기존 효과', () => {
    expect(DEFAULT_RINGS.length).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_RINGS[0].effect).toBe('fluid');
    expect(DEFAULT_RINGS[1].effect).toBe('swirl');
    for (const l of DEFAULT_RINGS.slice(2)) expect(['stretch', 'wave', 'slice', 'jitter', 'compress', 'drip', 'echo']).toContain(l.effect);
  });
  it('줄마다 고유 ID 와 독립 설정을 가진다', () => {
    expect(new Set(DEFAULT_RINGS.map((l) => l.id)).size).toBe(DEFAULT_RINGS.length);
    expect(DEFAULT_RINGS[0].params).not.toBe(DEFAULT_RINGS[1].params);
    // 이웃한 링끼리 같은 효과를 쓰지 않는다 (일괄 적용 아님)
    for (let i = 1; i < DEFAULT_RINGS.length; i++) expect(DEFAULT_RINGS[i].effect).not.toBe(DEFAULT_RINGS[i - 1].effect);
  });
  it('기본 링은 10~14개, 링마다 고정된 서로 다른 기울기', () => {
    expect(DEFAULT_RINGS.length).toBeGreaterThanOrEqual(10);
    expect(DEFAULT_RINGS.length).toBeLessThanOrEqual(14);
    expect(new Set(DEFAULT_RINGS.map((l) => `${l.layout.tilt}/${l.layout.axis}`)).size).toBe(DEFAULT_RINGS.length);
  });
  it('링 평면 좌표계는 직교 단위벡터 (글자는 법선 방향으로 선다)', () => {
    const { U, V, N } = ringFrame(18, 130);
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(U, V)).toBeCloseTo(0);
    expect(dot(U, N)).toBeCloseTo(0);
    expect(dot(V, N)).toBeCloseTo(0);
    expect(dot(N, N)).toBeCloseTo(1);
    expect(N[1]).toBeCloseTo(Math.cos((18 * Math.PI) / 180));
  });
  it('새 효과는 전용 조절 항목과 기본값을 가진다', () => {
    expect(controlsOf('fluid').map((c) => c.key)).toEqual(['intensity', 'speed', 'range', 'tail', 'origin']);
    expect(controlsOf('swirl').map((c) => c.key)).toEqual(['intensity', 'spin', 'tail', 'sharp', 'speed']);
    expect(defaultParams('swirl').sharp).toBeDefined();
    expect(controlsOf('stretch').map((c) => c.key)).toEqual(['intensity', 'speed', 'range', 'direction']);
  });
});
