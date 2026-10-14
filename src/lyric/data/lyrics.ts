import type { EffectId } from '../effects/types';
import type { SemanticTag } from './presets';

/**
 * 가사 데이터 구조.
 * 문장 · 시간 · 강조 범위 · 의미 태그 · 효과를 분리해 두어,
 * 나중에 실제 음원 재생 시간(LRC 등)이나 의미 분석 결과로 그대로 교체할 수 있다.
 */
export interface Emphasis {
  /** 문장 안의 문자 인덱스 [start, end) */
  start: number;
  end: number;
  tag: SemanticTag;
  /** 프리셋 효과 대신 이 구간만 다른 효과를 쓰고 싶을 때 */
  effect?: EffectId;
  /** 프리셋 강도에 곱하는 값 */
  intensity?: number;
  /** 태그 출처. 이번 버전은 전부 사람이 직접 지정한 'manual' */
  source: 'manual' | 'analysis';
}

export interface LyricLine {
  id: string;
  text: string;
  /** 초 */
  start: number;
  end: number;
  emphasis: Emphasis[];
}

/** 문장 안의 단어로 강조 범위를 만드는 도우미 */
export function mark(text: string, word: string, tag: SemanticTag, extra: Partial<Emphasis> = {}): Emphasis {
  const start = text.indexOf(word);
  if (start < 0) throw new Error(`"${word}" not in "${text}"`);
  return { start, end: start + word.length, tag, source: 'manual', ...extra };
}

function line(id: string, text: string, start: number, end: number, word: string, tag: SemanticTag): LyricLine {
  return { id, text, start, end, emphasis: [mark(text, word, tag)] };
}

/** 직접 작성한 예시 가사와 수동 의미 태그 (자동 분석 아님) */
export const DEMO_LYRICS: LyricLine[] = [
  line('l1', '멀어지는 너를 붙잡아', 0, 5, '붙잡아', 'longing'),
  line('l2', '괜찮다는 말이 떨려', 5, 10, '괜찮다는', 'anxiety'),
  line('l3', '우리 사이가 끊어져', 10, 15, '끊어져', 'rupture'),
  line('l4', '숨이 자꾸 막혀', 15, 20, '막혀', 'pressure'),
  line('l5', '기억이 흘러내려', 20, 25.5, '흘러내려', 'sorrow'),
  line('l6', '어지러운 밤에 취해', 25.5, 30.5, '어지러운', 'confusion'),
  line('l7', 'YOUR NAME ECHOES AGAIN', 30.5, 35.5, 'ECHOES', 'memory'),
];

export const demoDuration = (lines: LyricLine[]) => lines.reduce((m, l) => Math.max(m, l.end), 0);

/** 재생 시간 → 현재 줄 (반복 재생) */
export function lineAt(lines: LyricLine[], time: number): { line: LyricLine; index: number; local: number } | null {
  const total = demoDuration(lines);
  if (total <= 0) return null;
  const t = ((time % total) + total) % total;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (t >= l.start && t < l.end) return { line: l, index: i, local: (t - l.start) / (l.end - l.start) };
  }
  return null;
}

/**
 * 자유 입력 텍스트의 [대괄호] 를 강조 범위로 해석한다.
 * 대괄호가 없으면 문장 전체를 강조한다.
 */
export function parseMarked(input: string): { text: string; ranges: [number, number][] } {
  let text = '';
  const ranges: [number, number][] = [];
  let open = -1;
  for (const ch of input) {
    if (ch === '[' && open < 0) open = text.length;
    else if (ch === ']' && open >= 0) {
      if (text.length > open) ranges.push([open, text.length]);
      open = -1;
    } else text += ch;
  }
  if (open >= 0 && text.length > open) ranges.push([open, text.length]);
  if (ranges.length === 0 && text.length > 0) ranges.push([0, text.length]);
  return { text, ranges };
}
