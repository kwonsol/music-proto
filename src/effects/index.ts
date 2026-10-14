import type { GenreId } from '../lib/genres';
import { electronicEffect } from './electronic';
import { hiphopEffect } from './hiphop';
import { popEffect } from './pop';
import { rnbEffect } from './rnb';
import { rockEffect } from './rock';
import type { GenreEffect } from './types';

/** 장르별 효과 레지스트리. 새 효과로 바꾸려면 이 표의 항목만 교체하면 된다. */
export const EFFECTS: Record<GenreId, GenreEffect> = {
  pop: popEffect,
  hiphop: hiphopEffect,
  electronic: electronicEffect,
  rock: rockEffect,
  rnb: rnbEffect,
};

export type { GenreEffect, EffectContext, PxRect } from './types';
