import type { Glyph } from '../render/glyphs';

export type EffectId = 'stretch' | 'wave' | 'slice' | 'jitter' | 'compress' | 'drip' | 'echo';
/** 변형이 일어나는 축. h = 가로 방향으로 밀리거나 늘어남, v = 세로 방향 */
export type Direction = 'h' | 'v';

export interface EffectParams {
  /** 0..1 변형량 */
  intensity: number;
  /** 시간 배율 (1 = 기본 속도) */
  speed: number;
  /** 0..1 글자 안에서 변형되는 영역의 넓이 */
  range: number;
  direction: Direction;
}

/** 효과가 글자 하나를 그릴 때 받는 정보. 모든 좌표는 디바이스 픽셀. */
export interface GlyphFrame {
  ctx: CanvasRenderingContext2D;
  g: Glyph;
  /** 글자 박스 왼쪽 위 */
  x: number;
  y: number;
  /** 이 글자의 사이클 위치 0..1 (글자별 지연 적용됨). 0 과 1 근처는 원형. */
  phase: number;
  /** 몇 번째 사이클인지 (사이클마다 절단 위치 등을 바꾸는 데 사용) */
  cycle: number;
  /** 효과 내부 움직임용 시간(초, 속도 반영) */
  t: number;
  p: EffectParams;
  /** 글자별 고유 시드 → 글자마다 변형 위치·강도가 다르다 */
  seed: number;
  index: number;
  count: number;
  /** 화면 여백에 맞추기 위한 길이 배율 (밀어내는 효과가 캔버스 밖으로 나가지 않게) */
  fit: number;
  /** 아래쪽 여백에 맞추기 위한 세로 길이 배율 */
  vfit: number;
  /** 위쪽 여백에 맞추기 위한 세로 길이 배율 */
  tfit: number;
  /** 슬라이스 두께(px). 화면 전체 부하에 따라 렌더러가 정한다 */
  step: number;
}

export type GlyphState = Omit<GlyphFrame, 'ctx' | 'x' | 'y'>;

export interface Effect {
  id: EffectId;
  label: string;
  /** 연결되는 감정 키워드 (UI 표시용) */
  mood: string;
  /** 한 사이클 길이(초, speed=1 기준) */
  cycle: number;
  /** 글자 사이 위상 지연 (사이클 비율) */
  stagger: number;
  defaultDirection: Direction;
  /** 변형으로 글자가 차지하는 폭이 늘어나는 경우, 뒤 글자를 밀어낼 추가 폭 */
  extraAdvance?(s: GlyphState): number;
  draw(f: GlyphFrame): void;
}
