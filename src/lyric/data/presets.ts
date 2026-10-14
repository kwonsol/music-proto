import type { Direction, EffectId, EffectParams } from '../effects/types';

/**
 * 의미 태그 → 연출 프리셋.
 * 의미와 효과의 연결은 고정 규칙이 아니라 수정 가능한 연출 값이다.
 * (UI 의 데모 모드에서 태그별 효과·강도를 바꿀 수 있다.)
 */
export type SemanticTag = 'longing' | 'anxiety' | 'rupture' | 'pressure' | 'sorrow' | 'confusion' | 'memory';

export interface DirectionPreset extends EffectParams {
  tag: SemanticTag;
  label: string;
  effect: EffectId;
}

const p = (tag: SemanticTag, label: string, effect: EffectId, intensity: number, direction: Direction, range = 0.55, speed = 1): DirectionPreset => ({
  tag, label, effect, intensity, direction, range, speed,
});

export const DEFAULT_PRESETS: Record<SemanticTag, DirectionPreset> = {
  longing: p('longing', '붙잡음·갈망', 'stretch', 0.9, 'h', 0.6),
  anxiety: p('anxiety', '불안·떨림', 'jitter', 0.85, 'h', 0.6),
  rupture: p('rupture', '단절·상처', 'slice', 0.9, 'h', 0.6),
  pressure: p('pressure', '압박·답답함', 'compress', 0.95, 'v', 0.55),
  sorrow: p('sorrow', '슬픔·소진', 'drip', 0.9, 'v', 0.6),
  confusion: p('confusion', '혼란·취기', 'wave', 0.85, 'h', 0.75),
  memory: p('memory', '기억·미련', 'echo', 0.85, 'v', 0.5),
};

export const SEMANTIC_TAGS = Object.keys(DEFAULT_PRESETS) as SemanticTag[];
