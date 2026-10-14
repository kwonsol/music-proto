export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EffectContext {
  ctx: CanvasRenderingContext2D;
  /** 전체 캔버스 해상도로 준비된 원본 이미지 (모든 구획이 같은 좌표계에서 샘플링) */
  src: HTMLCanvasElement;
  /** 이 효과가 보일 사각형 (정수 픽셀). 렌더러가 이 영역으로 clip 한다. */
  rect: PxRect;
  /** 같은 장르의 몇 번째 슬롯인지 (축 선택 등 변주에 사용) */
  slot: number;
  /** 효과 시계(초). 일시정지 시 멈춘다. 구획 이동 속도와 무관. */
  time: number;
  /** 0..1 왜곡 강도 */
  intensity: number;
  /** 0..1 장르별 보조 옵션. hiphop: 타일 기울기(0=직사각 슬라이스, 1=사선), rnb: 모자이크 정도(0=연속 물결) */
  option: number;
}

/** 장르 효과는 이 시그니처만 지키면 교체 가능하다. 사각형 밖 그리기는 렌더러 clip 이 잘라낸다. */
export type GenreEffect = (e: EffectContext) => void;
