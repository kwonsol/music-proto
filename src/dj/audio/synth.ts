// Web Audio 로 직접 합성하는 짧은 타악기·효과음. 모든 함수는 AudioContext 시각 t 에 예약한다.

export interface Voice {
  /** 아직 시작 전이면 취소할 수 있도록 노드와 시작 시각을 돌려준다 */
  nodes: AudioScheduledSourceNode[];
  start: number;
  end: number;
}

export function makeNoiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** 잔향용 임펄스 응답: 지수 감쇠하는 스테레오 노이즈 */
export function makeImpulse(ctx: BaseAudioContext, seconds = 2.4, decay = 3.2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;
}

/** 킥: 사인파 주파수와 음량이 빠르게 내려간다 + 아주 짧은 클릭 */
export function kick(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, noise: AudioBuffer): Voice {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(gain * 0.5, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 0.42);
  o.connect(g).connect(out);

  const n = ctx.createBufferSource();
  n.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(gain * 0.25, t);
  ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.012);
  n.connect(hp).connect(ng).connect(out);

  o.start(t);
  o.stop(t + 0.45);
  n.start(t, Math.random());
  n.stop(t + 0.02);
  return { nodes: [o, n], start: t, end: t + 0.45 };
}

/** 하이햇: 하이패스 노이즈 + 짧은 엔벌로프 */
export function hat(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, noise: AudioBuffer, open = false): Voice {
  const n = ctx.createBufferSource();
  n.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7200;
  const bp = ctx.createBiquadFilter();
  bp.type = 'peaking';
  bp.frequency.value = 10000;
  bp.gain.value = 6;
  const g = ctx.createGain();
  const len = open ? 0.22 : 0.055;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0005, t + len);
  n.connect(hp).connect(bp).connect(g).connect(out);
  n.start(t, Math.random());
  n.stop(t + len + 0.01);
  return { nodes: [n], start: t, end: t + len };
}

/** 퍼커션: 짧게 떨어지는 삼각파(나무 타격 느낌) + 대역 통과 노이즈 */
export function perc(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, noise: AudioBuffer): Voice {
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(520, t);
  o.frequency.exponentialRampToValueAtTime(260, t + 0.06);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0, t);
  og.gain.linearRampToValueAtTime(gain * 0.8, t + 0.001);
  og.gain.exponentialRampToValueAtTime(0.0005, t + 0.13);
  o.connect(og).connect(out);

  const n = ctx.createBufferSource();
  n.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1900;
  bp.Q.value = 1.4;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(gain * 0.9, t + 0.001);
  ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
  n.connect(bp).connect(ng).connect(out);

  o.start(t);
  o.stop(t + 0.15);
  n.start(t, Math.random());
  n.stop(t + 0.1);
  return { nodes: [o, n], start: t, end: t + 0.15 };
}

export interface SliceSpec {
  start: number;
  length: number;
}

/**
 * 원곡 조각을 별도 노드로 재생. 매번 새 AudioBufferSourceNode 를 만들고 시작·끝에 짧은 페이드를 둔다.
 * playbackRate 는 1 로 고정한다 (속도를 바꾸면 음높이도 같이 바뀐다).
 */
export function slice(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  gain: number,
  buffer: AudioBuffer,
  s: SliceSpec,
  maxLen: number,
  lowpassHz: number,
): Voice {
  const len = Math.max(0.03, Math.min(s.length, maxLen));
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = lowpassHz;
  lp.Q.value = 0.5;
  const g = ctx.createGain();
  const fadeIn = 0.003;
  const fadeOut = Math.min(0.012, len * 0.3);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + fadeIn);
  g.gain.setValueAtTime(gain, t + len - fadeOut);
  g.gain.linearRampToValueAtTime(0, t + len);
  src.connect(lp).connect(g).connect(out);
  src.start(t, s.start, len + 0.005);
  return { nodes: [src], start: t, end: t + len };
}

/** 곡선을 놓을 때의 악센트: 필터 노이즈 버스트 + 짧은 저음 타격 */
export function accent(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  gain: number,
  noise: AudioBuffer,
  cutoff: number,
): Voice {
  const n = ctx.createBufferSource();
  n.buffer = noise;
  const lp = ctx.createBiquadFilter();
  lp.type = 'bandpass';
  lp.frequency.setValueAtTime(cutoff, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.25), t + 0.35);
  lp.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 0.4);
  n.connect(lp).connect(g).connect(out);
  n.start(t, Math.random());
  n.stop(t + 0.42);
  const k = kick(ctx, out, t, gain * 0.7, noise);
  return { nodes: [n, ...k.nodes], start: t, end: t + 0.45 };
}
