import { defaultParams, EFFECT_IDS, type EffectId, type EffectParams } from '../effects';

/**
 * 링 편집 데이터. 가사 한 줄 = 원 하나 = 편집 단위.
 * 공간 배치·공전(layout, rotation)과 글자 왜곡(effect, params)을 분리해 둔다.
 */
export interface RingRotation {
  /** 공전 속도 (도/초) */
  speed: number;
  /** 1 = 반시계, -1 = 시계 (위에서 내려다본 기준) */
  dir: 1 | -1;
}

export interface RingLayout {
  /** 처음 놓이는 각도 오프셋(도). 링마다 글자 시작 위치가 겹치지 않게 한다 */
  phase: number;
}

export interface RingLine {
  id: string;
  /** [대괄호] = 효과 적용 범위 (기존 핵심 단어 기능) */
  text: string;
  layout: RingLayout;
  rotation: RingRotation;
  effect: EffectId;
  params: EffectParams;
  /** '적용' 으로 확정된 적이 있는지 */
  applied: boolean;
}

export interface RingView {
  /** 원판 기울기: 내려다보는 각도(도). 90 = 바로 위 */
  tilt: number;
  /** 전체 공전 배율. 0 이면 링 공전만 멈추고 왜곡은 계속된다 */
  spin: number;
}

let counter = 0;
export const newRingId = () => `ring-${Date.now().toString(36)}-${(counter++).toString(36)}`;

function ring(id: string, text: string, effect: EffectId, speed: number, dir: 1 | -1, phase: number, extra: Partial<EffectParams> = {}): RingLine {
  return { id, text, layout: { phase }, rotation: { speed, dir }, effect, params: { ...defaultParams(effect), ...extra }, applied: true };
}

/** 예시 가사: 1줄 유체, 2줄 회전 잔상, 나머지 기존 효과 */
export const DEFAULT_RINGS: RingLine[] = [
  ring('r1', '흐르는 [그리움]이 번져 가', 'fluid', 7, 1, 0),
  ring('r2', '어지러운 밤이 [돌고 돌아]', 'swirl', 6, -1, 70),
  ring('r3', '우리 사이가 [끊어져]', 'slice', 5, 1, 150),
  ring('r4', '멀어지는 너를 [붙잡아]', 'stretch', 4.2, -1, 220),
  ring('r5', '[괜찮다는] 말이 떨려', 'jitter', 3.6, 1, 300),
];

export const DEFAULT_VIEW: RingView = { tilt: 34, spin: 1 };

const KEY = 'lyric-typo.rings.v1';

export interface RingStore {
  lines: RingLine[];
  selected: number;
  view: RingView;
}

function valid(l: unknown): l is RingLine {
  const r = l as RingLine;
  return !!r && typeof r.id === 'string' && typeof r.text === 'string' && EFFECT_IDS.includes(r.effect) && !!r.params && !!r.rotation && !!r.layout;
}

export function loadRings(): RingStore {
  const fallback = { lines: DEFAULT_RINGS, selected: 0, view: DEFAULT_VIEW };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const data = JSON.parse(raw) as Partial<RingStore>;
    if (!Array.isArray(data.lines) || data.lines.length === 0 || !data.lines.every(valid)) return fallback;
    const lines = data.lines.map((l) => ({ ...l, params: { ...defaultParams(l.effect), ...l.params } }));
    return {
      lines,
      selected: Math.min(Math.max(0, data.selected ?? 0), lines.length - 1),
      view: { ...DEFAULT_VIEW, ...data.view },
    };
  } catch {
    return fallback;
  }
}

export function saveRings(store: RingStore) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* 저장할 수 없는 환경이면 무시 (세션 동안은 메모리에 유지) */
  }
}
