// 브러시별 소리. 같은 함수를 "그리는 순간(지금)"과 "루프 재생(예약 시각)"에 그대로 써서 같은 소리를 재현한다.
import { hat, kick, perc, type SliceSpec, type Voice } from '../../dj/audio/synth';

export type HitKind =
  | 'kick'
  | 'perc'
  | 'click'
  | 'hat'
  | 'shaker'
  | 'pluck'
  // 칸딘스키 모드: 디지털 피아노(FM)·물방울 플럭·전자 퍼커션
  | 'fmkey'
  | 'drop'
  | 'ehat'
  | 'tick'
  | 'ekick'
  | 'eclap'
  // 힙합 모드: 짧은 환호 (합성 대체음 — 실제 사람 녹음 아님)
  | 'cheer';
export type SustainKind = 'ribbon' | 'band' | 'choir' | 'fmline' | 'scratch' | 'spray';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 위아래 위치(0=아래 어둡게, 1=위 밝게) → 저역 통과 차단 주파수 */
export const brightToCutoff = (b: number) => 1400 * Math.pow(2, clamp01(b) * 3.5);

/**
 * 하이햇·셰이커·클릭처럼 고음만 있는 소리는 위 범위를 쓰면 아래쪽에서 소리가 통째로 사라진다
 * (이전 버전에서 1·2번이 묻힌 원인 중 하나). 고음 소리는 6.5k~16k 사이에서만 밝기를 바꾼다.
 */
const highCutoff = (b: number) => 6500 * Math.pow(2, clamp01(b) * 1.3);

function toneOut(ctx: BaseAudioContext, out: AudioNode, t: number, cutoff: number, life: number) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(cutoff, t);
  lp.Q.value = 0.6;
  lp.connect(out);
  // 소리가 끝난 뒤 노드 정리
  const ms = Math.max(0, (t - ctx.currentTime + life + 0.5) * 1000);
  setTimeout(() => lp.disconnect(), ms);
  return lp;
}

/** 짧은 클릭: 사각파 한 주기 + 고역 노이즈 */
function click(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, noise: AudioBuffer): Voice {
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.value = 2400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain * 0.35, t + 0.0008);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 0.018);
  o.connect(g).connect(out);
  const n = ctx.createBufferSource();
  n.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 4000;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(gain * 0.5, t);
  ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.01);
  n.connect(hp).connect(ng).connect(out);
  o.start(t);
  o.stop(t + 0.03);
  n.start(t, 0.37);
  n.stop(t + 0.02);
  return { nodes: [o, n], start: t, end: t + 0.03 };
}

/** 셰이커: 하이햇보다 느린 어택과 조금 긴 꼬리의 대역 노이즈 */
function shaker(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, noise: AudioBuffer): Voice {
  const n = ctx.createBufferSource();
  n.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 6500;
  bp.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 0.11);
  n.connect(bp).connect(g).connect(out);
  n.start(t, 0.91);
  n.stop(t + 0.12);
  return { nodes: [n], start: t, end: t + 0.12 };
}

/**
 * 탄성 있는 짧은 톤: 원곡 조각을 공진 대역 필터에 통과시키고 필터 중심을 위에서 아래로 튕긴다.
 * 재생 속도는 바꾸지 않는다 (음높이를 임의로 바꾸지 않음).
 * 이전 버전은 1/8박(약 58ms) 조각 + Q5 좁은 대역 + 뒤쪽 저역 통과까지 겹쳐 피크가 -41~-48dB 에 그쳤다.
 * → 조각을 1/4박으로, 대역을 넓게(Q 2.2), 저역 통과는 거치지 않게 바꾸고 감쇠를 지수→선형 꼬리로.
 */
function pluck(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, buf: AudioBuffer, s: SliceSpec, bright: number): Voice {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  const f0 = 500 * Math.pow(2, clamp01(bright) * 2.6);
  bp.frequency.setValueAtTime(f0 * 2.6, t);
  bp.frequency.exponentialRampToValueAtTime(f0, t + 0.1);
  bp.Q.value = 2.2;
  // 두 번째 고역 성분: 튕기는 어택을 또렷하게
  const bp2 = ctx.createBiquadFilter();
  bp2.type = 'bandpass';
  bp2.frequency.setValueAtTime(f0 * 5, t);
  bp2.Q.value = 1.5;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(gain * 0.5, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  const g = ctx.createGain();
  const len = s.length;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.003);
  g.gain.setTargetAtTime(0, t + len * 0.35, len * 0.25);
  src.connect(bp).connect(g).connect(out);
  src.connect(bp2).connect(g2).connect(out);
  src.start(t, s.start, len + 0.02);
  return { nodes: [src], start: t, end: t + len + 0.05 };
}

export interface HitContext {
  ctx: BaseAudioContext;
  out: AudioNode;
  noise: AudioBuffer;
  buffer: AudioBuffer;
  pluckSlice: SliceSpec;
  /** 음높이 있는 소리의 근음(Hz). 원곡에서 가장 강한 음 높이 성분 */
  rootHz: number;
}

// ---------------- 칸딘스키 모드 소리 ----------------
// 음높이는 무작위로 바꾸지 않는다. 도형 크기 등 그림 규칙에 따라 근음·5도·옥타브(note: 반음 수)만 쓴다.

const hz = (root: number, note: number) => root * Math.pow(2, note / 12);

/** 디지털 피아노: 2-오퍼레이터 FM(1:1, 지수 감쇠하는 변조 지수) + 짧은 고음 '틴' 성분 */
function fmkey(ctx: BaseAudioContext, out: AudioNode, t: number, f: number, gain: number, bright: number): Voice {
  const car = ctx.createOscillator();
  car.frequency.value = f;
  const mod = ctx.createOscillator();
  mod.frequency.value = f;
  const idx = ctx.createGain();
  idx.gain.setValueAtTime(f * (1.4 + 1.8 * bright), t);
  idx.gain.exponentialRampToValueAtTime(f * 0.12, t + 0.6);
  mod.connect(idx).connect(car.frequency);
  const tine = ctx.createOscillator();
  tine.frequency.value = f * 4;
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0, t);
  tg.gain.linearRampToValueAtTime(gain * 0.22, t + 0.002);
  tg.gain.exponentialRampToValueAtTime(0.0005, t + 0.08);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.003);
  g.gain.exponentialRampToValueAtTime(gain * 0.35, t + 0.25);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 1.3);
  car.connect(g).connect(out);
  tine.connect(tg).connect(out);
  for (const o of [car, mod, tine]) {
    o.start(t);
    o.stop(t + 1.35);
  }
  return { nodes: [car, mod, tine], start: t, end: t + 1.35 };
}

/** 물방울 플럭: 짧은 사인파가 아래에서 위로 휙 올라가며 둥글게 사라짐 */
function drop(ctx: BaseAudioContext, out: AudioNode, t: number, f: number, gain: number): Voice {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(f * 0.62, t);
  o.frequency.exponentialRampToValueAtTime(f * 1.32, t + 0.035);
  o.frequency.exponentialRampToValueAtTime(f * 1.18, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 0.17);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.19);
  return { nodes: [o], start: t, end: t + 0.19 };
}

/** 전자 하이햇: 비정수비 사각파 6개(금속성) → 대역·고역 통과, 짧은 감쇠 */
function ehat(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, bright: number): Voice {
  const sum = ctx.createGain();
  sum.gain.value = 0.25;
  const nodes: AudioScheduledSourceNode[] = [];
  for (const r of [205.3, 304.4, 369.6, 522.7, 540, 800]) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = r * 1.7;
    o.connect(sum);
    nodes.push(o);
  }
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 10000;
  bp.Q.value = 0.8;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  const len = 0.035 + 0.05 * bright;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0005, t + len);
  sum.connect(bp).connect(hp).connect(g).connect(out);
  for (const o of nodes) {
    o.start(t);
    o.stop(t + len + 0.02);
  }
  return { nodes, start: t, end: t + len + 0.02 };
}

/** 금속성 틱: FM(비정수비 3.53) 짧은 타격. 원이 클수록 낮게 */
function tick(ctx: BaseAudioContext, out: AudioNode, t: number, f: number, gain: number): Voice {
  const car = ctx.createOscillator();
  car.frequency.value = f;
  const mod = ctx.createOscillator();
  mod.frequency.value = f * 3.53;
  const idx = ctx.createGain();
  idx.gain.setValueAtTime(f * 2.5, t);
  idx.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.04);
  mod.connect(idx).connect(car.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 0.07);
  car.connect(g).connect(out);
  for (const o of [car, mod]) {
    o.start(t);
    o.stop(t + 0.08);
  }
  return { nodes: [car, mod], start: t, end: t + 0.08 };
}

/** 전자 킥: 짧고 단단한 사인 스윕 + 클릭 */
function ekick(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, noise: AudioBuffer): Voice {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(46, t + 0.08);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 0.28);
  o.connect(g).connect(out);
  const n = ctx.createBufferSource();
  n.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 5000;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(gain * 0.3, t);
  ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.006);
  n.connect(hp).connect(ng).connect(out);
  o.start(t);
  o.stop(t + 0.3);
  n.start(t, 0.21);
  n.stop(t + 0.01);
  return { nodes: [o, n], start: t, end: t + 0.3 };
}

/** 전자 클랩: 대역 노이즈 세 번의 짧은 파열 + 짧은 꼬리 */
function eclap(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, noise: AudioBuffer): Voice {
  const n = ctx.createBufferSource();
  n.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1400;
  bp.Q.value = 0.9;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 600;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  for (const k of [0, 0.011, 0.022]) {
    g.gain.setValueAtTime(gain, t + k);
    g.gain.exponentialRampToValueAtTime(gain * 0.15, t + k + 0.009);
  }
  g.gain.setValueAtTime(gain * 0.7, t + 0.033);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 0.2);
  n.connect(bp).connect(hp).connect(g).connect(out);
  n.start(t, 0.63);
  n.stop(t + 0.22);
  return { nodes: [n], start: t, end: t + 0.22 };
}

// ---------------- 힙합 모드 소리 ----------------

/**
 * 짧고 높은 환호 (합성 대체음). 프로젝트에 사람 목소리 샘플이 없어 포먼트 합성으로 흉내낸다.
 * 톱니파 3개(살짝 디튠) + 숨소리 → 모음 포먼트 2개(시간에 따라 이동) → 음량 엔벌로프.
 * variant 0: 'Woo!'  (우→오, 음높이 상승)
 * variant 1: '야호!' (야 → 호, 두 음절)
 * variant 2: '끼얏호!' (짧은 '끼' + 야 + 호)
 */
function cheer(ctx: BaseAudioContext, out: AudioNode, t: number, variant: number, gain: number, noise: AudioBuffer): Voice {
  type Seg = { at: number; f0: number; f1: number; F1: number; F2: number; amp: number };
  // 음절별 (시각, 음높이, 1·2 포먼트, 크기)
  const shapes: Seg[][] = [
    [
      { at: 0, f0: 330, f1: 330, F1: 340, F2: 700, amp: 0 },
      { at: 0.05, f0: 360, f1: 360, F1: 360, F2: 720, amp: 1 },
      { at: 0.24, f0: 640, f1: 640, F1: 480, F2: 880, amp: 1 },
      { at: 0.42, f0: 560, f1: 560, F1: 500, F2: 900, amp: 0.7 },
      { at: 0.55, f0: 520, f1: 520, F1: 500, F2: 900, amp: 0 },
    ],
    [
      { at: 0, f0: 480, f1: 480, F1: 300, F2: 2200, amp: 0 },
      { at: 0.03, f0: 500, f1: 500, F1: 320, F2: 2100, amp: 1 },
      { at: 0.13, f0: 560, f1: 560, F1: 820, F2: 1250, amp: 1 },
      { at: 0.18, f0: 560, f1: 560, F1: 700, F2: 1100, amp: 0.25 },
      { at: 0.24, f0: 680, f1: 680, F1: 520, F2: 860, amp: 1 },
      { at: 0.45, f0: 600, f1: 600, F1: 500, F2: 850, amp: 0.8 },
      { at: 0.56, f0: 560, f1: 560, F1: 500, F2: 850, amp: 0 },
    ],
    [
      { at: 0, f0: 720, f1: 720, F1: 300, F2: 2400, amp: 0 },
      { at: 0.015, f0: 740, f1: 740, F1: 300, F2: 2400, amp: 0.8 },
      { at: 0.07, f0: 700, f1: 700, F1: 320, F2: 2300, amp: 0.15 },
      { at: 0.1, f0: 560, f1: 560, F1: 320, F2: 2100, amp: 1 },
      { at: 0.19, f0: 600, f1: 600, F1: 820, F2: 1250, amp: 1 },
      { at: 0.24, f0: 600, f1: 600, F1: 700, F2: 1100, amp: 0.25 },
      { at: 0.3, f0: 720, f1: 720, F1: 520, F2: 860, amp: 1 },
      { at: 0.5, f0: 640, f1: 640, F1: 500, F2: 850, amp: 0.8 },
      { at: 0.62, f0: 600, f1: 600, F1: 500, F2: 850, amp: 0 },
    ],
  ];
  const vi = ((variant % 3) + 3) % 3;
  const sh = shapes[vi];
  // 세 환호의 크기를 비슷하게 (오프라인 측정 기준, 소리 나는 동안 RMS 약 -16dB)
  gain *= [0.4, 0.7, 0.85][vi];
  const end = t + sh[sh.length - 1].at + 0.03;
  const mix = ctx.createGain();
  mix.gain.value = 0.33;
  const nodes: AudioScheduledSourceNode[] = [];
  for (const cents of [-14, 0, 11]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.detune.value = cents;
    o.frequency.setValueAtTime(sh[0].f0, t);
    for (const p of sh.slice(1)) o.frequency.linearRampToValueAtTime(p.f0, t + p.at);
    o.connect(mix);
    o.start(t);
    o.stop(end);
    nodes.push(o);
  }
  // 숨소리 (특히 '호'의 ㅎ)
  const n = ctx.createBufferSource();
  n.buffer = noise;
  const ng = ctx.createGain();
  ng.gain.value = 0.25;
  n.connect(ng).connect(mix);
  n.start(t, 1.7);
  n.stop(end);
  nodes.push(n);
  const sum = ctx.createGain();
  sum.gain.value = 6;
  for (const [key, q, amp] of [['F1', 6, 1], ['F2', 9, 0.6]] as const) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(sh[0][key], t);
    for (const p of sh.slice(1)) bp.frequency.linearRampToValueAtTime(p[key], t + p.at);
    const g = ctx.createGain();
    g.gain.value = amp;
    mix.connect(bp).connect(g).connect(sum);
  }
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  for (const p of sh.slice(1)) env.gain.linearRampToValueAtTime(p.amp * gain, t + p.at);
  sum.connect(env).connect(out);
  return { nodes, start: t, end };
}

/** +6dB = 진폭 약 2배 */
export const DB6 = 1.995;

/**
 * 소리 종류별 기본 음량. duck: 원곡의 같은 음역이 강하면 살짝 줄이는 배율.
 * 1번(pluck)·2번(hat·shaker)은 원인 수정 후 개별 게인을 이전 대비 +6dB.
 * 그리는 순간과 루프 재생이 모두 이 함수를 쓰므로 양쪽에 같이 적용된다.
 */
export function playHit(h: HitContext, kind: HitKind, t: number, bright: number, duck: number, amp = 1, note = 0): Voice {
  const d = duck * amp;
  switch (kind) {
    case 'cheer':
      return cheer(h.ctx, h.out, t, note, 0.55 * d, h.noise);
    case 'fmkey':
      return fmkey(h.ctx, h.out, t, hz(h.rootHz * 2, note), 0.42 * d, bright);
    case 'drop':
      return drop(h.ctx, h.out, t, hz(h.rootHz * 4, note), 0.4 * d);
    case 'ehat':
      return ehat(h.ctx, h.out, t, 1.25 * d, bright); // 오프라인 측정: 원곡 대비 묻혀서 +8dB
    case 'tick':
      return tick(h.ctx, h.out, t, 1500 * Math.pow(2, note / 12), 0.32 * d);
    case 'ekick':
      return ekick(h.ctx, h.out, t, 0.75 * d, h.noise);
    case 'eclap':
      return eclap(h.ctx, h.out, t, 0.95 * d, h.noise); // +4dB
    case 'kick':
      return kick(h.ctx, toneOut(h.ctx, h.out, t, 16000, 0.5), t, 0.85 * d, h.noise);
    case 'perc':
      return perc(h.ctx, toneOut(h.ctx, h.out, t, brightToCutoff(bright), 0.5), t, 0.5 * d, h.noise);
    case 'click':
      return click(h.ctx, toneOut(h.ctx, h.out, t, highCutoff(bright), 0.5), t, 0.6 * d, h.noise);
    case 'hat':
      return hat(h.ctx, toneOut(h.ctx, h.out, t, highCutoff(bright), 0.5), t, 0.28 * DB6 * d, h.noise);
    case 'shaker':
      return shaker(h.ctx, toneOut(h.ctx, h.out, t, highCutoff(bright), 0.5), t, 0.22 * DB6 * d, h.noise);
    case 'pluck':
      // 저역 통과를 거치지 않는다 (자체 대역 필터가 밝기를 담당)
      return pluck(h.ctx, h.out, t, 2.6 * DB6 * d, h.buffer, h.pluckSlice, bright);
  }
}

/** 지속음 파라미터: [차단 주파수(Hz), 음량, 공진 Q] */
export type SustainParams = [number, number, number];

export interface SustainVoice {
  filter: BiquadFilterNode;
  gain: GainNode;
  stop: (at: number) => void;
  /** 파라미터 해석이 다른 지속음(스크래치)은 직접 적용 */
  apply?: (p: SustainParams, at: number, mode: 'target' | 'ramp') => void;
}

export type Vowel = 'a' | 'u' | 'm';
export const VOWELS: Vowel[] = ['a', 'u', 'm'];
export const VOWEL_TEXT: Record<Vowel, string> = { a: 'AHH', u: 'OOH', m: 'HMM' };

/**
 * 모음 포먼트 (Hz, 대역폭 Hz, 상대 크기). 성악 모음 포먼트 표를 단순화한 값.
 * a: 열린 '아'  u: 둥근 '우'  m: 입을 다문 허밍(비음, 높은 포먼트가 거의 없음)
 */
const FORMANTS: Record<Vowel, { f: number; bw: number; amp: number }[]> = {
  a: [
    { f: 750, bw: 90, amp: 1 },
    { f: 1150, bw: 100, amp: 0.55 },
    { f: 2850, bw: 140, amp: 0.22 },
    { f: 3500, bw: 200, amp: 0.1 },
  ],
  u: [
    { f: 330, bw: 50, amp: 1 },
    { f: 700, bw: 70, amp: 0.3 },
    { f: 2500, bw: 120, amp: 0.06 },
  ],
  m: [
    { f: 270, bw: 60, amp: 1 },
    { f: 1050, bw: 140, amp: 0.12 },
    { f: 2300, bw: 200, amp: 0.03 },
  ],
};

/**
 * 합창 단원: 근음 3명, 5도 2명, 옥타브 위 1명. 각자 조금씩 다른 음정(센트)과 비브라토.
 * 무작위가 아니라 고정값이라 같은 그림은 같은 소리로 재현된다.
 */
const SINGERS = [
  { semi: 0, cents: -11, vib: 5.1, depth: 16, level: 1 },
  { semi: 0, cents: 4, vib: 5.6, depth: 20, level: 1 },
  { semi: 0, cents: 13, vib: 4.7, depth: 14, level: 0.9 },
  { semi: 7, cents: -7, vib: 5.3, depth: 17, level: 0.75 },
  { semi: 7, cents: 9, vib: 5.9, depth: 15, level: 0.7 },
  { semi: 12, cents: -3, vib: 5.0, depth: 18, level: 0.45 },
];

export interface SustainOpts {
  buffer: AudioBuffer;
  noise: AudioBuffer;
  slice: SliceSpec;
  gridAnchor: number;
  /** 합창: 모음과 근음(Hz) */
  vowel?: Vowel;
  rootHz?: number;
  /** 합창은 잔향으로 공간감을 준다 */
  reverb?: AudioNode;
  /** FM 실선: 옥타브 */
  octave?: number;
  /** 스크래치: 원곡 짧은 조각의 정방향·역방향 버퍼 */
  scratch?: { fwd: AudioBuffer; rev: AudioBuffer };
}

/**
 * 합성 합창. 여러 명이 함께 '아—' 하는 음색을 흉내낸다:
 * 톱니파 6개(서로 다른 디튠·비브라토) + 숨소리 노이즈 → 모음 포먼트 대역 필터 묶음 → 밝기 저역 통과 → 음량.
 * 실제 사람 녹음이 아니라 합성이다.
 */
function makeChoir(ctx: BaseAudioContext, out: AudioNode, t: number, p: SustainParams, o: SustainOpts): SustainVoice {
  const vowel = o.vowel ?? 'a';
  const root = o.rootHz ?? 196;
  const mix = ctx.createGain();
  mix.gain.value = 1 / SINGERS.length;
  const srcs: AudioScheduledSourceNode[] = [];
  SINGERS.forEach((sg, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = root * Math.pow(2, sg.semi / 12);
    osc.detune.value = sg.cents;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = sg.vib;
    const lg = ctx.createGain();
    // 비브라토는 발성 시작 후 서서히 깊어진다
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(sg.depth, t + 0.45 + i * 0.05);
    lfo.connect(lg).connect(osc.detune);
    const vg = ctx.createGain();
    vg.gain.value = sg.level;
    osc.connect(vg).connect(mix);
    // 단원마다 아주 조금씩 다른 시작 (합창의 어긋남)
    osc.start(t + i * 0.012);
    lfo.start(t);
    srcs.push(osc, lfo);
  });
  // 숨소리
  const n = ctx.createBufferSource();
  n.buffer = o.noise;
  n.loop = true;
  const ng = ctx.createGain();
  ng.gain.value = vowel === 'm' ? 0.02 : 0.08;
  n.connect(ng).connect(mix);
  n.start(t, 1.3);
  srcs.push(n);

  // 포먼트 필터 묶음 (병렬)
  const formantSum = ctx.createGain();
  // 좁은 대역 필터를 거치며 줄어드는 에너지 보충
  formantSum.gain.value = vowel === 'a' ? 7 : vowel === 'u' ? 6 : 2.6; // 세 모음의 크기를 비슷하게 (오프라인 측정 기준)
  for (const fm of FORMANTS[vowel]) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = fm.f;
    bp.Q.value = fm.f / fm.bw;
    const g = ctx.createGain();
    g.gain.value = fm.amp;
    mix.connect(bp).connect(g).connect(formantSum);
  }
  if (vowel === 'm') {
    // 허밍: 다문 입 → 고역을 더 깎는다
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    formantSum.disconnect();
    const tmp = ctx.createGain();
    formantSum.connect(lp).connect(tmp);
    return finishChoir(ctx, out, t, p, o, tmp, srcs);
  }
  return finishChoir(ctx, out, t, p, o, formantSum, srcs);
}

function finishChoir(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  p: SustainParams,
  o: SustainOpts,
  from: AudioNode,
  srcs: AudioScheduledSourceNode[],
): SustainVoice {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(p[0], t);
  filter.Q.setValueAtTime(p[2], t);
  const gain = ctx.createGain();
  // 사람 목소리처럼 천천히 열린다
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(p[1], t + 0.14);
  from.connect(filter).connect(gain).connect(out);
  if (o.reverb) {
    const send = ctx.createGain();
    send.gain.value = 0.9;
    gain.connect(send).connect(o.reverb);
  }
  return {
    filter,
    gain,
    stop: (at) => {
      for (const s of srcs) {
        try {
          s.stop(at);
        } catch {
          /* 이미 멈춤 */
        }
      }
    },
  };
}

/**
 * 실선 브러시의 지속음: FM 신스(변조비 2) 두 대를 살짝 디튠해 겹치고 저역 통과로 밝기를 조절.
 * opts.octave: 0=굵은 파랑(낮게), 1=가는 보조선(한 옥타브 위)
 */
function makeFmLine(ctx: BaseAudioContext, out: AudioNode, t: number, p: SustainParams, o: SustainOpts): SustainVoice {
  const f = (o.rootHz ?? 130.8) * Math.pow(2, o.octave ?? 0);
  const mix = ctx.createGain();
  mix.gain.value = 0.5;
  const srcs: AudioScheduledSourceNode[] = [];
  for (const cents of [-6, 7]) {
    const car = ctx.createOscillator();
    car.frequency.value = f;
    car.detune.value = cents;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * 2;
    mod.detune.value = cents;
    const idx = ctx.createGain();
    idx.gain.value = f * 1.1;
    mod.connect(idx).connect(car.frequency);
    car.connect(mix);
    car.start(t);
    mod.start(t);
    srcs.push(car, mod);
  }
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(p[0], t);
  filter.Q.setValueAtTime(p[2], t);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(p[1], t + 0.03);
  mix.connect(filter).connect(gain).connect(out);
  return {
    filter,
    gain,
    stop: (at) => {
      for (const s of srcs) {
        try {
          s.stop(at);
        } catch {
          /* 이미 멈춤 */
        }
      }
    },
  };
}

/**
 * 레코드 스크래치: 원곡 짧은 조각을 정방향·역방향 두 버퍼로 반복 재생해 두고,
 * 손의 속도(p[0], 부호 = 방향)에 따라 재생 속도와 어느 쪽을 들려줄지를 바꾼다.
 * 멈추면(속도 0) 소리도 멈춘다. p[1] = 음량, p[2] = 레코드 각도(소리에는 쓰지 않음, 화면 재현용)
 */
function makeScratch(ctx: BaseAudioContext, out: AudioNode, t: number, p: SustainParams, o: SustainOpts): SustainVoice {
  const sc = o.scratch!;
  const mk = (buf: AudioBuffer) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g);
    src.start(t);
    return { src, g };
  };
  const fwd = mk(sc.fwd);
  const rev = mk(sc.rev);
  // 스크래치 특유의 중고역을 살리고 저역 웅웅거림은 덜어낸다
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 160;
  const peak = ctx.createBiquadFilter();
  peak.type = 'peaking';
  peak.frequency.value = 1800;
  peak.gain.value = 6;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  fwd.g.connect(filter);
  rev.g.connect(filter);
  filter.connect(peak).connect(gain).connect(out);
  const apply = (q: SustainParams, at: number, mode: 'target' | 'ramp') => {
    const rate = q[0];
    const mag = Math.max(0.02, Math.min(3.5, Math.abs(rate)));
    const on = Math.abs(rate) > 0.06;
    const vol = on ? q[1] * Math.min(1, Math.abs(rate) * 1.6) : 0;
    const set = (param: AudioParam, v: number) => (mode === 'ramp' ? param.linearRampToValueAtTime(v, at) : param.setTargetAtTime(v, at, 0.012));
    set(fwd.src.playbackRate, mag);
    set(rev.src.playbackRate, mag);
    set(fwd.g.gain, rate > 0.06 ? 1 : 0);
    set(rev.g.gain, rate < -0.06 ? 1 : 0);
    set(gain.gain, vol);
  };
  apply(p, t, 'target');
  return {
    filter,
    gain,
    apply,
    stop: (at) => {
      for (const s of [fwd.src, rev.src]) {
        try {
          s.stop(at);
        } catch {
          /* 이미 멈춤 */
        }
      }
    },
  };
}

/** 스프레이 '치익': 노이즈 → 고역 통과 → 대역 통과(중심 = p[0]) */
function makeSpray(ctx: BaseAudioContext, out: AudioNode, t: number, p: SustainParams, o: SustainOpts): SustainVoice {
  const src = ctx.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(p[0], t);
  filter.Q.setValueAtTime(p[2], t);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(p[1], t + 0.012);
  src.connect(hp).connect(filter).connect(gain).connect(out);
  src.start(t, 0.9);
  return {
    filter,
    gain,
    stop: (at) => {
      try {
        src.stop(at);
      } catch {
        /* 이미 멈춤 */
      }
    },
  };
}

/**
 * 지속음 생성.
 * - ribbon: 원곡 조각(1/4박)을 반복. 반복 위상을 박 격자에 맞춰 시작해 연주와 박이 어긋나지 않는다.
 * - band: 반복 노이즈 → 공진 저역 통과. 상승음 질감.
 * - choir: 합성 합창 (모음별 포먼트)
 */
export function makeSustain(ctx: BaseAudioContext, out: AudioNode, kind: SustainKind, t: number, p: SustainParams, opts: SustainOpts): SustainVoice {
  if (kind === 'choir') return makeChoir(ctx, out, t, p, opts);
  if (kind === 'fmline') return makeFmLine(ctx, out, t, p, opts);
  if (kind === 'scratch') return makeScratch(ctx, out, t, p, opts);
  if (kind === 'spray') return makeSpray(ctx, out, t, p, opts);
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  const gain = ctx.createGain();
  if (kind === 'ribbon') {
    src.buffer = opts.buffer;
    src.loop = true;
    src.loopStart = opts.slice.start;
    src.loopEnd = opts.slice.start + opts.slice.length;
    const phase = (((t - opts.gridAnchor) % opts.slice.length) + opts.slice.length) % opts.slice.length;
    src.start(t, opts.slice.start + phase);
    src.connect(filter);
  } else {
    src.buffer = opts.noise;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 90;
    src.connect(hp);
    hp.connect(filter);
    src.start(t, 0.5);
  }
  filter.frequency.setValueAtTime(p[0], t);
  filter.Q.setValueAtTime(p[2], t);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(p[1], t + 0.02);
  filter.connect(gain).connect(out);
  return {
    filter,
    gain,
    stop: (at) => {
      try {
        src.stop(at);
      } catch {
        /* 이미 멈춤 */
      }
    },
  };
}

/** 그리는 동안: 짧은 보간으로 즉시 따라감 */
export function sustainTarget(v: SustainVoice, p: SustainParams, now: number) {
  if (v.apply) return v.apply(p, now, 'target');
  v.filter.frequency.setTargetAtTime(p[0], now, 0.02);
  v.gain.gain.setTargetAtTime(p[1], now, 0.02);
  v.filter.Q.setTargetAtTime(p[2], now, 0.02);
}

/** 루프 재생: 기록한 값을 같은 시각에 직선 보간으로 재현 */
export function sustainRamp(v: SustainVoice, p: SustainParams, at: number) {
  if (v.apply) return v.apply(p, at, 'ramp');
  v.filter.frequency.linearRampToValueAtTime(p[0], at);
  v.gain.gain.linearRampToValueAtTime(p[1], at);
  v.filter.Q.linearRampToValueAtTime(p[2], at);
}

export function sustainEnd(v: SustainVoice, at: number, fade: number) {
  v.gain.gain.cancelScheduledValues(at);
  v.gain.gain.setTargetAtTime(0, at, fade / 4);
  v.stop(at + fade + 0.05);
}
