import { compress } from './compress';
import { drip } from './drip';
import { echo } from './echo';
import { fluid } from './fluid';
import { jitter } from './jitter';
import { slice } from './slice';
import { stretch } from './stretch';
import { swirl } from './swirl';
import { DEFAULT_CONTROLS, type ControlSpec, type Effect, type EffectId, type EffectParams } from './types';
import { wave } from './wave';

export * from './types';

/** 효과 레지스트리. 새 효과는 Effect 를 구현해 여기에 추가하면 UI·데모에 자동으로 나타난다. */
export const EFFECTS: Record<EffectId, Effect> = { stretch, wave, slice, jitter, compress, drip, echo, fluid, swirl };
export const EFFECT_IDS = Object.keys(EFFECTS) as EffectId[];

export const controlsOf = (id: EffectId): ControlSpec[] => EFFECTS[id].controls ?? DEFAULT_CONTROLS;

/** 효과를 처음 고를 때의 파라미터 (효과가 충분히 드러나는 값) */
export function defaultParams(id: EffectId): EffectParams {
  return { intensity: 0.85, speed: 1, range: 0.6, direction: EFFECTS[id].defaultDirection, ...EFFECTS[id].defaults };
}
