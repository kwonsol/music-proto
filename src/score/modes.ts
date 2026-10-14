// 스타일 모드: 같은 숫자키가 모드마다 다른 브러시를 만든다.
// 원곡 재생·오디오 엔진·입력 기록·루프는 모든 모드가 공통으로 쓴다.
import type { Brush } from './stroke';

export type ModeId = 'kandinsky' | 'dreamy' | 'hiphop';

export interface ModeDef {
  id: ModeId;
  label: string;
  /** false 면 '준비 중' 표시만 하고 그리기는 막는다 */
  ready: boolean;
  /** 이 모드의 음악 (모드마다 따로 재생·분석) */
  song: string | null;
  /** 숫자키 → 브러시 */
  keys: Record<string, Brush>;
  labels: Partial<Record<Brush, string>>;
}

export const MODES: ModeDef[] = [
  {
    id: 'kandinsky',
    label: '칸딘스키',
    ready: true,
    song: '/score/kandinsky.mp3',
    keys: { '1': 'kcircles', '2': 'vbars', '3': 'pbars', '4': 'kline', '5': 'beads', '6': 'sun' },
    labels: { kcircles: '원 배열', vbars: '점 달린 세로 막대', pbars: '투시 막대', kline: '실선', beads: '사각 점선', sun: '노란 원' },
  },
  // 디자인은 추후 별도 지시 — 임의의 스타일을 채우지 않는다
  { id: 'dreamy', label: '몽환', ready: false, song: null, keys: {}, labels: {} },
  {
    id: 'hiphop',
    label: '힙합',
    ready: true,
    // 스타일을 나누기 전 최초 버전 음악 (사운드_2.mp3 와 같은 파일)
    song: '/dj/song.mp3',
    keys: { '1': 'hcover', '2': 'htype', '3': 'hcheer', '4': 'hrecord', '5': 'hspray' },
    labels: { hcover: '커버 스트레치', htype: '코러스 타이포', hcheer: '환호 스탬프', hrecord: '레코드 스크래치', hspray: '형광 스프레이' },
  },
];

export const modeById = (id: ModeId) => MODES.find((m) => m.id === id)!;

/** 힙합 모드 형광 스프레이 색 */
export const NEON = ['#B6FF1A', '#FF2D9B', '#FF7A12'];

/**
 * 칸딘스키 모드 팔레트: 두 번째 참고 이미지에서 배경과 안티앨리어싱 중간색을 빼고
 * 채도 높은 화소를 색상각별로 모아 평균낸 값 (sips 로 BMP 변환 → 색상각 히스토그램).
 * 노랑·파랑·초록 = 큰 구조 / 빨강·보라 = 작은 색면·반복 요소 / 검정 = 구조적인 선·막대
 */
export const KPAL = {
  yellow: '#E6D83A',
  lime: '#C6E05C',
  green: '#459758',
  blue: '#4174C6',
  teal: '#448AAF',
  red: '#CF2428',
  purple: '#451D6C',
  magenta: '#CF4CA3',
  black: '#161414',
};
