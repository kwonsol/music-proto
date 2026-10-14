// 브러시별 소리. 같은 함수를 "그리는 순간(지금)"과 "루프 재생(예약 시각)"에 그대로 써서 같은 소리를 재현한다.
import { hat, kick, perc, type SliceSpec, type Voice } from '../../dj/audio/synth';

export type HitKind = 'kick' | 'perc' | 'click' | 'hat' | 'shaker' | 'pluck';
export type SustainKind = 'ribbon' | 'band' | 'choir';

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
}

/** +6dB = 진폭 약 2배 */
export const DB6 = 1.995;

/**
 * 소리 종류별 기본 음량. duck: 원곡의 같은 음역이 강하면 살짝 줄이는 배율.
 * 1번(pluck)·2번(hat·shaker)은 원인 수정 후 개별 게인을 이전 대비 +6dB.
 * 그리는 순간과 루프 재생이 모두 이 함수를 쓰므로 양쪽에 같이 적용된다.
 */
export function playHit(h: HitContext, kind: HitKind, t: number, bright: number, duck: number, amp = 1): Voice {
  const d = duck * amp;
  switch (kind) {
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
 * 지속음 생성.
 * - ribbon: 원곡 조각(1/4박)을 반복. 반복 위상을 박 격자에 맞춰 시작해 연주와 박이 어긋나지 않는다.
 * - band: 반복 노이즈 → 공진 저역 통과. 상승음 질감.
 * - choir: 합성 합창 (모음별 포먼트)
 */
export function makeSustain(ctx: BaseAudioContext, out: AudioNode, kind: SustainKind, t: number, p: SustainParams, opts: SustainOpts): SustainVoice {
  if (kind === 'choir') return makeChoir(ctx, out, t, p, opts);
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
  v.filter.frequency.setTargetAtTime(p[0], now, 0.02);
  v.gain.gain.setTargetAtTime(p[1], now, 0.02);
  v.filter.Q.setTargetAtTime(p[2], now, 0.02);
}

/** 루프 재생: 기록한 값을 같은 시각에 직선 보간으로 재현 */
export function sustainRamp(v: SustainVoice, p: SustainParams, at: number) {
  v.filter.frequency.linearRampToValueAtTime(p[0], at);
  v.gain.gain.linearRampToValueAtTime(p[1], at);
  v.filter.Q.linearRampToValueAtTime(p[2], at);
}

export function sustainEnd(v: SustainVoice, at: number, fade: number) {
  v.gain.gain.cancelScheduledValues(at);
  v.gain.gain.setTargetAtTime(0, at, fade / 4);
  v.stop(at + fade + 0.05);
}
