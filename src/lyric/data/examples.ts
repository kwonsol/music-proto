import type { EffectId } from '../effects/types';

/** 효과별 예시 문장 (한글 / 영문). [대괄호] 가 강조 범위 */
export const EXAMPLES: Record<EffectId, [string, string]> = {
  stretch: ['멀어지는 너를 [붙잡아]', "DON'T [LET ME GO]"],
  wave: ['[어지러운] 밤에 취해', 'SO [DIZZY] TONIGHT'],
  slice: ['우리 사이가 [끊어져]', 'WE [BROKE] APART'],
  jitter: ['[괜찮다는] 말이 떨려', "I'M [FINE] I SAID"],
  compress: ['숨이 자꾸 [막혀]', "I CAN'T [BREATHE]"],
  drip: ['기억이 [흘러내려]', '[MELTING] AWAY'],
  echo: ['[아직도] 네 이름을 불러', '[ECHOES] OF YOU'],
  fluid: ['흐르는 [그리움]이 번져 가', '[LINGERING] TRACES'],
  swirl: ['어지러운 밤이 [돌고 돌아]', '[SPINNING] AROUND'],
};
