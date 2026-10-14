import { compress } from './compress';
import { drip } from './drip';
import { echo } from './echo';
import { jitter } from './jitter';
import { slice } from './slice';
import { stretch } from './stretch';
import type { Effect, EffectId } from './types';
import { wave } from './wave';

export * from './types';

/** 효과 레지스트리. 새 효과는 Effect 를 구현해 여기에 추가하면 UI·데모에 자동으로 나타난다. */
export const EFFECTS: Record<EffectId, Effect> = { stretch, wave, slice, jitter, compress, drip, echo };
export const EFFECT_IDS = Object.keys(EFFECTS) as EffectId[];
