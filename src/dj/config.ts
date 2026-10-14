// 코드에서 직접 보정하는 설정값. 사용자용 편집 화면은 두지 않는다.

export const ASSETS = {
  cover: '/dj/cover.webp',
  song: '/dj/song.mp3',
};

/**
 * 박자 보정.
 * - bpm/firstBeat 를 숫자로 넣으면 자동 추정값 대신 사용한다.
 * - bpmMultiplier 는 반박(0.5)·두 배(2) 오류를 고칠 때 쓴다.
 * 첨부 곡 오프라인 분석 결과(scripts/dj-analyze.ts): 130.02 BPM, 첫 박 ≈ 0.205s, 마디 시작 ≈ 1.59s.
 * 3-3-2 당김 리듬 때문에 단순 자기상관은 87 BPM(점4분 간격)으로 잘못 잡혔던 곡이다.
 */
export const TEMPO_OVERRIDE: { bpm: number | null; firstBeat: number | null; bpmMultiplier: number } = {
  bpm: null,
  firstBeat: null,
  bpmMultiplier: 1,
};

/** 곡이 17.5초로 짧아 마디 단위로 반복 재생한다. 반복 길이가 박의 정수배라 박 격자가 끊기지 않는다 */
export const LOOP = { enabled: true, bars: null as number | null };

/** 원곡 조각. start/length(초)를 넣으면 자동 선택 대신 사용한다. length 는 박 단위(beats)로도 줄 수 있다 */
export type SliceOverride = { start: number; beats: number } | null;
export const SLICE_OVERRIDE: Record<'stutterA' | 'stutterB' | 'echo', SliceOverride> = {
  stutterA: null,
  stutterB: null,
  echo: null,
};

/** 자동 선택 시 조각 길이(박) */
export const SLICE_BEATS = { stutterA: 0.5, stutterB: 1, echo: 0.25 };

export const MIX = {
  songDefault: 0.8,
  playDefault: 0.85,
  /** 연주 버스 앞단 여유. 추가 소리가 원곡을 덮지 않도록 낮게 둔다 */
  playHeadroom: 0.55,
  maxVoices: 28,
  /** 에코 피드백 상한 */
  echoFeedbackMax: 0.72,
};

export const INPUT = {
  /** 이 시간 이상 누르고 있으면 길게 누르기(박자 반복)로 본다 */
  holdMs: 180,
  /** 스터터 간격 단계(박). 드래그로 위→아래 이동 */
  stutterSteps: [1 / 8, 1 / 4, 1 / 2, 1] as const,
};
