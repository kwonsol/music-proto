import type { GenreId } from '../lib/genres';
import { electronicPattern } from './electronic';
import { hiphopPattern } from './hiphop';
import { popPattern } from './pop';
import { rnbPattern } from './rnb';
import { rockPattern } from './rock';
import type { PatternEffect } from './common';

/** 패턴 모드의 장르별 효과. 항목만 바꾸면 효과를 교체할 수 있다. */
export const PATTERNS: Record<GenreId, PatternEffect> = {
  pop: popPattern,
  hiphop: hiphopPattern,
  electronic: electronicPattern,
  rock: rockPattern,
  rnb: rnbPattern,
};

export type { PatternArgs, PatternEffect } from './common';
