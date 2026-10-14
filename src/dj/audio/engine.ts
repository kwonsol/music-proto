// 원곡 재생, 박 격자, 반복 예약, 네 가지 연주 소리를 묶는 오디오 엔진.
// 모든 발음 시각은 AudioContext 시간으로 예약한다. setInterval 은 "앞으로 120ms 안에 올 박"을 찾는 용도로만 쓴다.

import { estimateTempo, onsetEnvelope, pickOnsets, rankSlices, toMono, type TempoEstimate } from './analysis';
import { BandMeter, type Bands } from './bands';
import { accent, hat, kick, makeImpulse, makeNoiseBuffer, perc, slice, type SliceSpec, type Voice } from './synth';
import { INPUT, LOOP, MIX, SLICE_BEATS, SLICE_OVERRIDE, TEMPO_OVERRIDE } from '../config';

export type HitId = 'kick' | 'perc' | 'hat' | 'stutterA' | 'stutterB';
export type ElementId = HitId | 'riser' | 'echo';

export interface VisualEvent {
  id: ElementId | 'beat';
  time: number;
  strength: number;
  /** 반복 예약을 취소할 때 함께 지우기 위한 키 */
  key?: string;
  /** 박 표시용: 마디 안 몇 번째 박인지 */
  beatInBar?: number;
}

export interface TempoInfo {
  bpm: number;
  firstBeat: number;
  firstDownbeat: number;
  confidence: number;
  ambiguous: boolean;
  alternatives: number[];
  source: 'auto' | 'override';
}

interface RepeatJob {
  id: HitId | 'echo' | 'metro';
  division: number; // 박 단위 간격
  /** 격자를 박 단위로 밀기 (0.5 = 엇박) */
  phase: number;
  last: number; // 마지막으로 예약한 시각
  pending: Voice[];
}

const LOOKAHEAD = 0.12;
const TICK_MS = 25;

export class DjEngine {
  readonly ctx: AudioContext;
  readonly buffer: AudioBuffer;
  readonly tempo: TempoInfo;
  readonly slices: Record<'stutterA' | 'stutterB' | 'echo', SliceSpec>;
  readonly loop: { start: number; end: number } | null;
  readonly bands: Bands;

  /** 악보 드로잉 버전(src/score)에서도 같은 믹서·박 격자를 쓰기 위해 공개한다 */
  readonly noise: AudioBuffer;
  private readonly songGain: GainNode;
  private readonly playGain: GainNode;
  readonly playBus: GainNode;
  readonly reverbSend: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly meter: BandMeter;
  private readonly echoIn: GainNode;
  private readonly echoDelay: DelayNode;
  private readonly echoFb: GainNode;
  private readonly echoTone: BiquadFilterNode;

  private src: AudioBufferSourceNode | null = null;
  private startCtx = 0;
  private startOffset = 0;
  private offset = 0;
  private _playing = false;
  /** 박 하나가 울리는 AudioContext 시각. 이 시각 ± k*spb 가 모두 박 */
  anchor = 0;
  /** 마디 첫 박이 울리는 AudioContext 시각 */
  downAnchor = 0;

  private jobs = new Map<string, RepeatJob>();
  private events: VisualEvent[] = [];
  private voiceEnds: number[] = [];
  private timer: number;
  private riser: { src: AudioBufferSourceNode; hp: BiquadFilterNode; lp: BiquadFilterNode; g: GainNode; pull: number } | null =
    null;
  private onEnded: (() => void) | null = null;

  static async load(url: string): Promise<DjEngine> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`음원 파일을 불러오지 못했습니다 (${res.status} ${url})`);
    const data = await res.arrayBuffer();
    const buffer = await ctx.decodeAudioData(data);
    return new DjEngine(ctx, buffer);
  }

  private constructor(ctx: AudioContext, buffer: AudioBuffer) {
    this.ctx = ctx;
    this.buffer = buffer;

    // ---- 분석: 박자 + 샘플 후보 ----
    const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const mono = toMono(chans);
    const onset = onsetEnvelope(mono, buffer.sampleRate);
    const est: TempoEstimate = estimateTempo(onset);
    const bpm = (TEMPO_OVERRIDE.bpm ?? est.bpm) * TEMPO_OVERRIDE.bpmMultiplier;
    const spb = 60 / bpm;
    const firstBeat = TEMPO_OVERRIDE.firstBeat ?? est.firstBeat;
    // 마디 시작은 첫 박 기준 격자 위로 다시 맞춘다 (BPM 을 덮어쓴 경우 대비)
    const downK = Math.round((est.firstDownbeat - firstBeat) / spb);
    const firstDownbeat = TEMPO_OVERRIDE.firstBeat != null ? firstBeat : firstBeat + Math.max(0, downK) * spb;
    const overridden = TEMPO_OVERRIDE.bpm != null || TEMPO_OVERRIDE.firstBeat != null || TEMPO_OVERRIDE.bpmMultiplier !== 1;
    this.tempo = {
      bpm,
      firstBeat,
      firstDownbeat,
      confidence: est.confidence,
      ambiguous: est.ambiguous,
      alternatives: est.alternatives.slice(1).map((a) => a.bpm),
      source: overridden ? 'override' : 'auto',
    };

    const onsets = pickOnsets(onset);
    const tq = { bpm, firstBeat };
    const pick = (key: 'stutterA' | 'stutterB' | 'echo', avoid: number[], preferBright: number): SliceSpec => {
      const o = SLICE_OVERRIDE[key];
      if (o) return { start: o.start, length: o.beats * spb };
      const length = SLICE_BEATS[key] * spb;
      const best = rankSlices(mono, buffer.sampleRate, onsets, tq, { length, avoid, preferBright })[0];
      // 후보가 없으면 첫 마디 첫 박에서 자른다
      return best ? { start: best.start, length } : { start: firstDownbeat, length };
    };
    const a = pick('stutterA', [], 0);
    const b = pick('stutterB', [a.start], -1);
    const e = pick('echo', [a.start, b.start], 1);
    this.slices = { stutterA: a, stutterB: b, echo: e };

    // 반복 구간: 마디 첫 박부터 정수 마디만큼. 길이가 박의 정수배라 반복해도 박 격자가 이어진다
    if (LOOP.enabled) {
      const bar = 4 * spb;
      const bars = LOOP.bars ?? Math.floor((buffer.duration - firstDownbeat - 0.01) / bar);
      this.loop = bars >= 1 ? { start: firstDownbeat, end: firstDownbeat + bars * bar } : null;
    } else this.loop = null;

    // ---- 노드 그래프 ----
    // 원곡: src → songGain → master        (src → analyser 는 분석 전용 분기, 연주음이 섞이기 전)
    // 연주: 각 소리 → playBus → comp → playGain → master,  playBus → reverbSend → convolver → playGain
    // 마스터: master → limiter → destination
    this.noise = makeNoiseBuffer(ctx);
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    master.connect(limiter).connect(ctx.destination);

    this.songGain = ctx.createGain();
    this.songGain.gain.value = MIX.songDefault;
    this.songGain.connect(master);
    this.analyser = ctx.createAnalyser();
    this.meter = new BandMeter(this.analyser);
    this.bands = this.meter.value;

    this.playBus = ctx.createGain();
    this.playBus.gain.value = MIX.playHeadroom;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    this.playGain = ctx.createGain();
    this.playGain.gain.value = MIX.playDefault;
    this.playBus.connect(comp).connect(this.playGain).connect(master);

    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.18;
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx);
    const revOut = ctx.createGain();
    revOut.gain.value = 0.5;
    this.playBus.connect(this.reverbSend);
    this.reverbSend.connect(conv).connect(revOut).connect(this.playGain);

    // 에코: echoIn → delay → tone → fb → delay (피드백 루프), delay → playBus
    this.echoIn = ctx.createGain();
    this.echoDelay = ctx.createDelay(4);
    this.echoDelay.delayTime.value = 0.75 * spb; // 점8분 — 박자에 맞는 지연
    this.echoTone = ctx.createBiquadFilter();
    this.echoTone.type = 'lowpass';
    this.echoTone.frequency.value = 3000;
    this.echoTone.Q.value = 0.7;
    this.echoFb = ctx.createGain();
    this.echoFb.gain.value = 0.4;
    this.echoIn.connect(this.echoDelay);
    this.echoDelay.connect(this.echoTone).connect(this.echoFb).connect(this.echoDelay);
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.9;
    this.echoTone.connect(echoOut).connect(this.playBus);

    this.offset = 0;
    this.anchor = firstBeat;
    this.downAnchor = firstDownbeat;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  // ---------------- 시간·박 ----------------

  get spb() {
    return 60 / this.tempo.bpm;
  }

  get playing() {
    return this._playing;
  }

  /** 지금 스피커에서 나오고 있는 소리의 AudioContext 시각 (그래픽 타이밍용) */
  audibleTime(): number {
    const ctx = this.ctx;
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime != null && ts.performanceTime != null && ts.contextTime > 0) {
        return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      }
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  /** after 이후 첫 격자점 (division: 박 단위) */
  nextGrid(after: number, division: number, phase = 0): number {
    const step = this.spb * division;
    const a = this.anchor + phase * this.spb;
    const k = Math.ceil((after - a) / step - 1e-6);
    return a + k * step;
  }

  /** 원곡 위치(초) */
  songTime(at = this.ctx.currentTime): number {
    if (!this._playing) return this.offset;
    let t = this.startOffset + (at - this.startCtx);
    if (this.loop && t >= this.loop.end) {
      const len = this.loop.end - this.loop.start;
      t = this.loop.start + ((t - this.loop.start) % len);
    }
    return Math.max(0, t);
  }

  /** 박 위상(0~1)과 마디 안 박 번호 */
  beatPos(at: number): { phase: number; beatInBar: number } {
    const x = (at - this.downAnchor) / this.spb;
    const f = Math.floor(x);
    return { phase: x - f, beatInBar: ((f % 4) + 4) % 4 };
  }

  // ---------------- 원곡 재생 ----------------

  setOnEnded(fn: () => void) {
    this.onEnded = fn;
  }

  async play() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (this._playing) return;
    this.cancelRepeats();
    const t0 = this.ctx.currentTime + 0.04;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    if (this.loop) {
      src.loop = true;
      src.loopStart = this.loop.start;
      src.loopEnd = this.loop.end;
    }
    src.connect(this.songGain);
    src.connect(this.analyser);
    src.onended = () => {
      if (this.src !== src) return;
      this.src = null;
      this._playing = false;
      this.offset = 0;
      this.cancelRepeats();
      this.onEnded?.();
    };
    src.start(t0, this.offset);
    this.src = src;
    this.startCtx = t0;
    this.startOffset = this.offset;
    this._playing = true;
    // 박 격자를 원곡 위치에 고정: 곡 시각 firstBeat 가 울리는 AudioContext 시각
    this.anchor = t0 + (this.tempo.firstBeat - this.offset);
    this.downAnchor = t0 + (this.tempo.firstDownbeat - this.offset);
    if (this.metronome) this.startMetronome();
  }

  pause() {
    if (!this._playing || !this.src) return;
    this.offset = this.songTime();
    this.stopSource();
    this.releaseAll();
  }

  async restart() {
    this.stopSource();
    this.releaseAll();
    this.offset = 0;
    await this.play();
  }

  private stopSource() {
    const s = this.src;
    this.src = null;
    this._playing = false;
    if (s) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* 이미 멈춤 */
      }
      s.disconnect();
    }
  }

  setSongVolume(v: number) {
    this.songGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setPlayVolume(v: number) {
    this.playGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** 매 화면 프레임마다 호출: 음역 분석값 갱신 */
  updateBands(dt: number): Bands {
    return this.meter.update(dt, this._playing);
  }

  // ---------------- 박 확인용 메트로놈 ----------------

  metronome = false;

  setMetronome(on: boolean) {
    this.metronome = on;
    if (on && this._playing) this.startMetronome();
    if (!on) this.stopRepeat('metro');
  }

  private startMetronome() {
    this.jobs.set('metro', { id: 'metro', division: 1, phase: 0, last: this.ctx.currentTime, pending: [] });
  }

  // ---------------- 발음 ----------------

  private ensureRunning() {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  /** 동시 발음 수 제한 */
  voiceBudget(): boolean {
    this.voiceEnds = this.voiceEnds.filter((e) => e > this.ctx.currentTime);
    return this.voiceEnds.length < MIX.maxVoices;
  }

  track(v: Voice): Voice {
    this.voiceEnds.push(v.end);
    return v;
  }

  /** 원곡의 같은 음역이 이미 강하면 그 음역 소리를 조금 줄인다 */
  private duck(id: HitId): number {
    const b = this.bands;
    switch (id) {
      case 'kick':
        return 1 - 0.35 * b.low;
      case 'hat':
        return 1 - 0.35 * b.high;
      case 'perc':
        return 1 - 0.25 * b.mid;
      default:
        return 1 - 0.2 * b.mid;
    }
  }

  /** 중음이 강할수록 샘플 고역을 조금 깎아 원곡 중음과 덜 부딪히게 */
  private sliceCutoff(): number {
    return 16000 - 8000 * this.bands.mid;
  }

  private voice(id: HitId, t: number, strength: number, maxLen = Infinity): Voice | null {
    if (!this.voiceBudget()) return null;
    const g = strength * this.duck(id);
    const out = this.playBus;
    switch (id) {
      case 'kick':
        return this.track(kick(this.ctx, out, t, 0.95 * g, this.noise));
      case 'hat':
        return this.track(hat(this.ctx, out, t, 0.32 * g, this.noise));
      case 'perc':
        return this.track(perc(this.ctx, out, t, 0.55 * g, this.noise));
      case 'stutterA':
      case 'stutterB':
        return this.track(slice(this.ctx, out, t, 1.1 * g, this.buffer, this.slices[id], maxLen, this.sliceCutoff()));
    }
  }

  /** 단발: 즉시 발음. 발음 시각을 돌려준다 */
  hit(id: HitId): number {
    this.ensureRunning();
    const t = this.ctx.currentTime + 0.005;
    const v = this.voice(id, t, 1);
    if (v) this.events.push({ id, time: t, strength: 1 });
    return t;
  }

  /**
   * 길게 누르기: 박 격자에 맞춰 반복.
   * since(직전 단발 시각)에서 반 간격 이상 떨어진 격자점부터 시작해 단발과 첫 반복이 겹쳐 두 번 울리지 않게 한다.
   */
  startRepeat(key: string, id: HitId, division: number, since: number, phase = 0) {
    this.ensureRunning();
    this.jobs.set(key, { id, division, phase, last: since + (this.spb * division) / 2 - 1e-3, pending: [] });
  }

  setRepeatDivision(key: string, division: number) {
    const j = this.jobs.get(key);
    if (j) j.division = division;
  }

  stopRepeat(key: string) {
    const j = this.jobs.get(key);
    if (!j) return;
    this.jobs.delete(key);
    const now = this.ctx.currentTime;
    // 아직 시작하지 않은 예약 소리 취소
    for (const v of j.pending) {
      if (v.start > now) {
        for (const n of v.nodes) {
          try {
            n.stop();
          } catch {
            /* noop */
          }
        }
      }
    }
    this.events = this.events.filter((e) => e.key !== key || e.time <= now);
  }

  private cancelRepeats() {
    for (const k of [...this.jobs.keys()]) this.stopRepeat(k);
  }

  private tick() {
    const now = this.ctx.currentTime;
    const horizon = now + LOOKAHEAD;
    for (const [key, j] of this.jobs) {
      j.pending = j.pending.filter((v) => v.end > now);
      // 다음 격자점: 마지막 예약 이후 & 지금 이후
      let t = this.nextGrid(Math.max(j.last + 1e-3, now + 0.004), j.division, j.phase);
      while (t < horizon) {
        this.fireRepeat(key, j, t);
        j.last = t;
        t = this.nextGrid(t + 1e-3, j.division, j.phase);
      }
    }
  }

  private fireRepeat(key: string, j: RepeatJob, t: number) {
    if (j.id === 'metro') {
      const { beatInBar } = this.beatPos(t);
      const o = this.ctx.createOscillator();
      o.frequency.value = beatInBar === 0 ? 1760 : 1320;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.04);
      o.connect(g).connect(this.playBus);
      o.start(t);
      o.stop(t + 0.05);
      this.events.push({ id: 'beat', time: t, strength: 1, key, beatInBar });
      return;
    }
    if (j.id === 'echo') {
      const v = this.echoShot(t);
      if (v) j.pending.push(v);
      return;
    }
    // 스터터는 반복 간격보다 길게 울리지 않게 잘라 다음 발음과 겹치지 않게
    const interval = this.spb * j.division;
    // 하이햇 16분 반복은 정박·반박에 강세
    let strength = 1;
    if (j.id === 'hat') {
      const ph = ((t - this.anchor) / this.spb) % 1;
      const q = Math.round((ph < 0 ? ph + 1 : ph) * 4) % 4;
      strength = q === 0 ? 1 : q === 2 ? 0.8 : 0.5;
    }
    const v = this.voice(j.id, t, strength, interval * 0.95);
    if (v) {
      j.pending.push(v);
      this.events.push({ id: j.id, time: t, strength, key });
    }
  }

  // ---------------- 상승 효과 (곡선 당기기) ----------------

  riserStart() {
    this.ensureRunning();
    this.riserStop(0.02);
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 60;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.Q.value = 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.03);
    src.connect(hp).connect(lp).connect(g).connect(this.playBus);
    src.start();
    this.riser = { src, hp, lp, g, pull: 0 };
  }

  /** pull: 0~1. 필터·음량을 즉시(짧은 보간으로) 따라간다 */
  riserUpdate(pull: number) {
    const r = this.riser;
    if (!r) return;
    const p = Math.min(1, Math.max(0, pull));
    r.pull = p;
    const now = this.ctx.currentTime;
    const tc = 0.025;
    r.lp.frequency.setTargetAtTime(320 * Math.pow(2, p * 5.3), now, tc); // 320Hz → 약 12.6kHz
    r.lp.Q.setTargetAtTime(1 + p * 7, now, tc);
    r.hp.frequency.setTargetAtTime(60 + p * 900, now, tc);
    r.g.gain.setTargetAtTime(0.05 + 0.45 * Math.pow(p, 1.4), now, tc);
  }

  /** 놓기: 악센트 + 잔향으로 마무리 */
  riserRelease() {
    const r = this.riser;
    if (!r) return;
    const p = r.pull;
    const t = this.ctx.currentTime + 0.005;
    const cutoff = 320 * Math.pow(2, p * 5.3);
    this.riserStop(0.06);
    if (p > 0.05) {
      // 악센트는 잔향을 많이 보낸다
      const wet = this.ctx.createGain();
      wet.gain.value = 1.4;
      wet.connect(this.reverbSend);
      const v = accent(this.ctx, this.playBus, t, 0.25 + 0.55 * p, this.noise, Math.max(800, cutoff));
      const v2 = accent(this.ctx, wet, t, 0.2 + 0.4 * p, this.noise, Math.max(800, cutoff));
      this.track(v);
      this.track(v2);
      window.setTimeout(() => wet.disconnect(), 3000);
      this.events.push({ id: 'riser', time: t, strength: p });
    }
  }

  /** 조작 취소: 악센트 없이 조용히 멈춤 */
  riserCancel() {
    this.riserStop(0.04);
  }

  private riserStop(fade: number) {
    const r = this.riser;
    if (!r) return;
    this.riser = null;
    const now = this.ctx.currentTime;
    r.g.gain.cancelScheduledValues(now);
    r.g.gain.setValueAtTime(r.g.gain.value, now);
    r.g.gain.linearRampToValueAtTime(0, now + fade);
    r.src.stop(now + fade + 0.02);
  }

  // ---------------- 에코 (큰 원호) ----------------

  private echoShot(t: number): Voice | null {
    if (!this.voiceBudget()) return null;
    const s = this.slices.echo;
    // 원음은 작게, 에코 입력은 크게
    const dry = this.ctx.createGain();
    dry.gain.value = 0.45;
    dry.connect(this.playBus);
    const v = slice(this.ctx, this.echoIn, t, 0.9, this.buffer, s, s.length, this.sliceCutoff());
    const v2 = slice(this.ctx, dry, t, 0.9, this.buffer, s, s.length, this.sliceCutoff());
    window.setTimeout(() => dry.disconnect(), (t - this.ctx.currentTime + 1) * 1000);
    this.track(v);
    // 지연 반복이 실제로 울리는 시각에 그래픽도 반응
    const d = this.echoDelay.delayTime.value;
    const fb = this.echoFb.gain.value;
    this.events.push({ id: 'echo', time: t, strength: 1, key: 'echo' });
    for (let k = 1; k <= 5; k++) this.events.push({ id: 'echo', time: t + d * k, strength: Math.pow(fb, k - 1) * 0.8 });
    return { nodes: [...v.nodes, ...v2.nodes], start: t, end: v.end };
  }

  echoStart() {
    this.ensureRunning();
    // 첫 소리는 즉시, 이후는 매 박
    const t = this.ctx.currentTime + 0.005;
    this.echoShot(t);
    this.jobs.set('echo', { id: 'echo', division: 1, phase: 0, last: t + this.spb / 2 - 1e-3, pending: [] });
  }

  /** fb, tone: 0~1. 피드백은 상한(MIX.echoFeedbackMax)을 넘지 않는다 */
  echoUpdate(fb: number, tone: number) {
    const now = this.ctx.currentTime;
    const f = 0.2 + (MIX.echoFeedbackMax - 0.2) * Math.min(1, Math.max(0, fb));
    this.echoFb.gain.setTargetAtTime(f, now, 0.03);
    this.echoTone.frequency.setTargetAtTime(500 * Math.pow(2, Math.min(1, Math.max(0, tone)) * 4.2), now, 0.03);
  }

  /** 놓기: 새 입력만 멈추고, 이미 들어간 소리는 피드백대로 자연 감쇠 */
  echoRelease() {
    this.stopRepeat('echo');
    const now = this.ctx.currentTime;
    const cur = this.echoFb.gain.value;
    this.echoFb.gain.cancelScheduledValues(now);
    this.echoFb.gain.setValueAtTime(cur, now);
    this.echoFb.gain.setTargetAtTime(Math.min(cur, 0.45), now + 0.6, 0.6);
  }

  get echoDelaySec() {
    return this.echoDelay.delayTime.value;
  }

  // ---------------- 정리 ----------------

  /** 조작 취소·포커스 상실·일시정지 시: 지속음과 반복 예약을 모두 해제 */
  releaseAll() {
    this.cancelRepeats();
    this.riserStop(0.05);
    if (this.metronome && this._playing) this.startMetronome();
  }

  /** 지금 들리는 시각까지 도달한 그래픽 이벤트를 꺼낸다 */
  drainEvents(audible: number): VisualEvent[] {
    if (!this.events.length) return [];
    const due: VisualEvent[] = [];
    const rest: VisualEvent[] = [];
    for (const e of this.events) (e.time <= audible ? due : rest).push(e);
    this.events = rest;
    return due;
  }

  dispose() {
    window.clearInterval(this.timer);
    this.stopSource();
    this.releaseAll();
    void this.ctx.close();
  }
}

export const HOLD_MS = INPUT.holdMs;
