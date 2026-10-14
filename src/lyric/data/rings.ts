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
  /** 링 평면의 기울기(도). 0 = 공통 바닥면과 평행. 링별로 고정 */
  tilt: number;
  /** 기울이는 축의 방향(도, 위에서 본 방위각) */
  axis: number;
  /** 이 링의 기본 글자 크기 배율 (0.85~1.15) */
  scale: number;
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
  /** 카메라가 내려다보는 각도(도). 90 = 바로 위 */
  tilt: number;
  /** 전체 공전 배율. 0 이면 링 공전만 멈추고 왜곡은 계속된다 */
  spin: number;
  /** false 면 왜곡을 끄고 배치만 본다 */
  effects: boolean;
}

let counter = 0;
export const newRingId = () => `ring-${Date.now().toString(36)}-${(counter++).toString(36)}`;

function ring(
  id: string,
  text: string,
  effect: EffectId,
  speed: number,
  dir: 1 | -1,
  layout: Partial<RingLayout> & { phase: number },
  extra: Partial<EffectParams> = {},
): RingLine {
  return {
    id,
    text,
    layout: { tilt: 0, axis: 0, scale: 1, ...layout },
    rotation: { speed, dir },
    effect,
    params: { ...defaultParams(effect), ...extra },
    applied: true,
  };
}

/**
 * 예시 가사 12줄 (직접 작성). 1줄 유체, 2줄 회전 잔상, 나머지는 기존 효과를 섞는다.
 * 기울기·축·크기는 링마다 고정값 → 설정을 바꿔도 무작위로 재배치되지 않는다.
 */
export const DEFAULT_RINGS: RingLine[] = [
  ring('r1', '창밖에 번진 불빛 사이로 [그리움]이 천천히 흘러가는 밤', 'fluid', 6, 1, { phase: 0, tilt: 6, axis: 20, scale: 1.05 }),
  ring('r2', '어지러운 도시의 소음 속에서 우리는 [돌고 또 돌아]', 'swirl', 5, -1, { phase: 40, tilt: 15, axis: 110, scale: 0.92 }),
  ring('r3', '함께 걷던 길 위에서 우리 사이가 조용히 [끊어져] 버렸어', 'slice', 4.4, 1, { phase: 85, tilt: -10, axis: 200, scale: 1.12 }),
  ring('r4', '멀어지는 너의 뒷모습을 끝까지 [붙잡아] 보려 했는데', 'stretch', 3.8, -1, { phase: 130, tilt: 20, axis: 300, scale: 0.88 }),
  ring('r5', '[괜찮다는] 말 한마디가 오늘따라 자꾸만 떨려 와', 'jitter', 3.4, 1, { phase: 175, tilt: -16, axis: 60, scale: 1.0 }),
  ring('r6', '희미한 달빛 아래 [흔들리는] 마음을 감출 수가 없어서 나는 오늘도 창가에 서 있어', 'wave', 3, -1, { phase: 220, tilt: 9, axis: 160, scale: 1.1 }),
  ring('r7', '숨이 자꾸 [막혀] 와 닫힌 방 안에 혼자 남겨진 채로 시계 소리만 크게 들려', 'compress', 2.7, 1, { phase: 265, tilt: 24, axis: 250, scale: 0.9 }),
  ring('r8', '빗물처럼 [흘러내린] 기억들이 발끝에 고여 가는 새벽 젖은 신발을 끌고 집으로 가', 'drip', 2.4, -1, { phase: 310, tilt: -6, axis: 340, scale: 1.08 }),
  ring('r9', '아직도 네 이름이 [메아리]처럼 귓가에 맴돌아 잠들 수 없어 눈을 감으면 더 또렷해져', 'echo', 2.2, 1, { phase: 355, tilt: 13, axis: 30, scale: 0.95 }),
  ring('r10', 'WE WERE DANCING IN THE [AFTERGLOW] UNTIL THE MORNING CAME AND TOOK THE LAST OF THE STARS AWAY', 'stretch', 2, -1, { phase: 30, tilt: -20, axis: 130, scale: 1.15 }),
  ring('r11', '지워지지 않는 계절의 끝에서 나는 아직 너를 [기다려] 낡은 벤치에 앉아 해가 질 때까지 같은 노래를 들으며', 'wave', 1.8, 1, { phase: 75, tilt: 4, axis: 220, scale: 0.86 }),
  ring('r12', 'HOLD ON TO THE LIGHT BEFORE IT [FADES] AWAY FROM US AND EVERY SONG WE SANG BECOMES A QUIET ROOM WITHOUT A DOOR', 'drip', 1.6, -1, { phase: 120, tilt: 17, axis: 280, scale: 1.04 }),
];

export const DEFAULT_VIEW: RingView = { tilt: 40, spin: 1, effects: true };

const KEY = 'lyric-typo.rings.v2';

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
    const lines = data.lines.map((l, i) => ({
      ...l,
      layout: { tilt: 0, axis: (i * 97) % 360, scale: 1, ...(l.layout as Partial<RingLayout>), phase: l.layout?.phase ?? 0 },
      params: { ...defaultParams(l.effect), ...l.params },
    }));
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
