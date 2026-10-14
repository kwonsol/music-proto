// 악보 드로잉 버전 설정 (코드에서 직접 보정).
// 박자(BPM·첫 박)는 기존 src/dj/config.ts 의 TEMPO_OVERRIDE 를 그대로 쓴다.

export const SCORE = {
  /** 루프 길이(마디). 4/4 박자를 작업 가정으로 둔다 */
  bars: 4,
  /** 한 스트로크 최대 길이(루프 배수). 넘으면 자동 확정 */
  maxLoopsPerStroke: 3,
  /** 동시에 울리는 지속음(이미지 띠·곡선 띠) 상한 */
  maxSustains: 6,
  /** 확정 스트로크 상한 (넘으면 가장 오래된 것부터 지우지 않고 새 입력을 막는다) */
  maxStrokes: 40,
  /** 이미지 띠 소리에 쓸 원곡 조각 시작점(초). null 이면 자동 선택 */
  ribbonSliceStarts: null as number[] | null,
  /** 합창 근음 음이름 번호(0=C … 11=B). null 이면 원곡에서 가장 강한 음 높이 성분으로 자동 */
  choirRootPc: null as number | null,
};

/** 브러시별 배치 간격(월드 단위, 커버 한 변 = 1000) */
export const SPACING = { arc: 96, hatch: 72, shape: 112 };

/** 한 스트로크 안에서 타격음 사이 최소 간격(박). 빠르게 그려도 이 이상 촘촘해지지 않는다 */
export const MIN_HIT_BEATS = 0.25;

/** 이미지 띠 */
export const RIBBON = {
  /** 화면에 그려지는 단면 폭 (이전 84 → 약 2.5배) */
  width: 210,
  /** 커버에서 읽는 단면(슬릿) 너비 */
  sourceWidth: 300,
  lanes: 36,
  /** 새 직사각형 단면을 붙이는 간격 (드드득 늘어나는 리듬) */
  sliceStep: 10,
  /** 당긴 길이 / 원본에서 읽어 오는 깊이. 클수록 더 많이 늘어난 질감 */
  stretch: 14,
  /** 원본에서 읽는 최대 깊이(월드 단위). 작을수록 잡은 자리 색이 오래 유지된다 */
  maxDepth: 60,
  step: 5,
};
