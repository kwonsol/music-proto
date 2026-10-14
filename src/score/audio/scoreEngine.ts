// 원곡(기존 DjEngine) 위에 사용자가 그린 스트로크를 4마디 루프로 쌓아 재생한다.
// 발음 시각은 모두 AudioContext 시간으로 예약한다. setInterval 은 "곧 시작할 루프 회차를 찾아 예약"하는 용도로만 쓴다.

import { DjEngine } from '../../dj/audio/engine';
import { onsetEnvelope, pickOnsets, rankSlices, toMono } from '../../dj/audio/analysis';
import type { SliceSpec, Voice } from '../../dj/audio/synth';
import { SCORE } from '../config';
import { buildChunks, lastOccurrence, nextOccurrence, type Chunk, type RawHit } from '../loop';
import {
  makeSustain,
  playHit,
  sustainEnd,
  sustainRamp,
  sustainTarget,
  type HitContext,
  type HitKind,
  type SustainKind,
  type SustainParams,
  type SustainVoice,
  type SustainOpts,
  VOWELS,
} from './sounds';

export interface StrokeAudio {
  /** 루프 안 시작 위치(초) */
  p: number;
  chunks: Chunk<HitKind>[];
  sustain: { kind: SustainKind; slice: number } | null;
  /** 이 시각 이후 시작하는 루프 회차부터 재생 (그리는 순간의 소리와 중복 방지) */
  activeFrom: number;
}

interface Playing {
  voices: Voice[];
  sustains: { v: SustainVoice; end: number }[];
  scheduledUpTo: number;
}

const LOOKAHEAD = 0.3;

export class ScoreEngine {
  readonly dj: DjEngine;
  /** 루프 길이(초) = 4마디 */
  readonly L: number;
  /** 타격 격자(16분) */
  readonly grid: number;
  /** 커버 위치별 이미지 띠 소리에 쓰는 원곡 조각 (1/4박) */
  readonly ribbonSlices: SliceSpec[];
  readonly pluckSlice: SliceSpec;
  /** 합창 근음(Hz). 원곡에서 가장 강한 음 높이 성분(크로마)으로 정한다 — 조성 인식이 아님 */
  readonly choirRootHz: number;
  readonly choirRootName: string;

  private strokes = new Map<number, { a: StrokeAudio; play: Playing }>();
  private timer: number;
  private live: { v: SustainVoice } | null = null;
  /** 재생(재개) 시각. 이보다 이른 이벤트는 강조하지 않는다 */
  playFrom = Infinity;

  static async load(url: string) {
    return new ScoreEngine(await DjEngine.load(url));
  }

  private constructor(dj: DjEngine) {
    this.dj = dj;
    const spb = dj.spb;
    this.L = SCORE.bars * 4 * spb;
    this.grid = spb / 4;

    // 원곡에서 조각 후보 추출 (무음·작은 구간 제외, 타격 시작점 기준)
    const buf = dj.buffer;
    const mono = toMono(Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)));
    const onset = onsetEnvelope(mono, buf.sampleRate);
    const onsets = pickOnsets(onset);
    const tq = { bpm: dj.tempo.bpm, firstBeat: dj.tempo.firstBeat };
    const picked: SliceSpec[] = [];
    const len = spb / 4;
    for (const s of rankSlices(mono, buf.sampleRate, onsets, tq, { length: len })) {
      if (picked.every((x) => Math.abs(x.start - s.start) > 0.3)) picked.push({ start: s.start, length: len });
      if (picked.length >= 8) break;
    }
    while (picked.length < 8) picked.push(dj.slices.stutterA);
    this.ribbonSlices = SCORE.ribbonSliceStarts ? SCORE.ribbonSliceStarts.map((s) => ({ start: s, length: len })) : picked;
    this.pluckSlice = { start: dj.slices.echo.start, length: spb / 4 };
    const pc = SCORE.choirRootPc ?? strongestPitchClass(mono, buf.sampleRate);
    this.choirRootHz = 440 * Math.pow(2, (48 + pc - 69) / 12); // C3~B3
    this.choirRootName = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][pc];

    this.timer = window.setInterval(() => this.tick(), 25);
  }

  get ctx() {
    return this.dj.ctx;
  }

  get playing() {
    return this.dj.playing;
  }

  /** 루프 0 위치 = 마디 첫 박 */
  get anchor() {
    return this.dj.downAnchor;
  }

  loopPosAt(t: number) {
    const L = this.L;
    return (((t - this.anchor) % L) + L) % L;
  }

  private hitCtx(): HitContext {
    return { ctx: this.ctx, out: this.dj.playBus, noise: this.dj.noise, buffer: this.dj.buffer, pluckSlice: this.pluckSlice };
  }

  /** 원곡의 같은 음역이 강하면 그 음역 소리를 조금 줄인다 (음역 분석의 기본 음색 반영) */
  private duck(kind: HitKind) {
    const b = this.dj.bands;
    if (kind === 'kick') return 1 - 0.3 * b.low;
    if (kind === 'hat' || kind === 'shaker' || kind === 'click') return 1 - 0.3 * b.high;
    return 1 - 0.2 * b.mid;
  }

  private ensureRunning() {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  // ---------------- 그리는 순간 ----------------

  /** 즉시 발음. 발음 시각을 돌려준다 */
  hitNow(kind: HitKind, bright: number): number {
    this.ensureRunning();
    const t = this.ctx.currentTime + 0.004;
    if (this.dj.voiceBudget()) this.dj.track(playHit(this.hitCtx(), kind, t, bright, this.duck(kind)));
    return t;
  }

  private sustainOpts(kind: SustainKind, slice: number): SustainOpts {
    return {
      buffer: this.dj.buffer,
      noise: this.dj.noise,
      slice: this.sustainSlice(kind, slice),
      gridAnchor: this.dj.anchor,
      vowel: VOWELS[slice % VOWELS.length],
      rootHz: this.choirRootHz,
      reverb: kind === 'choir' ? this.dj.reverbSend : undefined,
    };
  }

  /** 기존 요소 클릭 재연주용: 짧은 지속음 한 번 (루프에 기록하지 않음) */
  sustainShot(kind: SustainKind, slice: number, p: SustainParams, dur: number) {
    this.ensureRunning();
    const t = this.ctx.currentTime + 0.004;
    const v = makeSustain(this.ctx, this.dj.playBus, kind, t, p, this.sustainOpts(kind, slice));
    sustainEnd(v, t + dur, kind === 'choir' ? 0.3 : 0.12);
  }

  // ---- 기존 요소를 누른 채 끌 때: 박 격자에 맞춘 반복(롤). 루프에는 기록하지 않음 ----
  private rolls = new Map<string, { kind: HitKind; bright: number; div: number; last: number; pending: Voice[] }>();

  /** since(단발 발음 시각)에서 반 간격 이상 떨어진 격자점부터 반복 → 단발과 겹쳐 두 번 울리지 않음 */
  startRoll(key: string, kind: HitKind, bright: number, div: number, since: number) {
    this.rolls.set(key, { kind, bright, div, last: since + (this.dj.spb * div) / 2 - 1e-3, pending: [] });
  }

  setRoll(key: string, bright: number, div: number) {
    const r = this.rolls.get(key);
    if (r) {
      r.bright = bright;
      r.div = div;
    }
  }

  stopRoll(key: string) {
    const r = this.rolls.get(key);
    if (!r) return;
    this.rolls.delete(key);
    const now = this.ctx.currentTime;
    for (const v of r.pending)
      if (v.start > now)
        for (const n of v.nodes) {
          try {
            n.stop();
          } catch {
            /* noop */
          }
        }
  }

  sustainSlice(kind: SustainKind, slice: number) {
    return kind === 'ribbon' ? this.ribbonSlices[slice % this.ribbonSlices.length] : this.ribbonSlices[0];
  }

  liveSustainStart(kind: SustainKind, slice: number, p: SustainParams): number {
    this.ensureRunning();
    this.liveSustainStop(0.03);
    const t = this.ctx.currentTime + 0.004;
    const v = makeSustain(this.ctx, this.dj.playBus, kind, t, p, this.sustainOpts(kind, slice));
    this.live = { v };
    return t;
  }

  liveSustainUpdate(p: SustainParams) {
    if (this.live) sustainTarget(this.live.v, p, this.ctx.currentTime);
  }

  /** at: 이 시각까지는 유지 (짧은 클릭 재연주가 너무 짧게 끊기지 않게) */
  liveSustainStop(fade: number, at = 0) {
    const l = this.live;
    if (!l) return;
    this.live = null;
    const now = this.ctx.currentTime;
    if (at > now) {
      sustainEnd(l.v, at, fade);
      return;
    }
    l.v.gain.gain.cancelScheduledValues(now);
    l.v.gain.gain.setValueAtTime(l.v.gain.gain.value, now);
    sustainEnd(l.v, now, fade);
  }

  // ---------------- 루프 기록 ----------------

  /**
   * 스트로크 확정. startTime: 그리기 시작한 AudioContext 시각.
   * 그리는 동안 이미 소리를 냈으므로, 확정 시각 이후 시작하는 회차부터 재생한다.
   */
  commit(
    id: number,
    startTime: number,
    duration: number,
    hits: RawHit<HitKind>[],
    auto: { s: number; v: number[] }[] | null,
    sustain: StrokeAudio['sustain'],
  ): StrokeAudio {
    const p = this.loopPosAt(startTime);
    const chunks = buildChunks(p, duration, hits, auto, this.L, this.grid);
    const a: StrokeAudio = { p, chunks, sustain, activeFrom: this.ctx.currentTime };
    this.strokes.set(id, { a, play: { voices: [], sustains: [], scheduledUpTo: this.ctx.currentTime } });
    return a;
  }

  remove(id: number) {
    const s = this.strokes.get(id);
    if (!s) return;
    this.stopPlaying(s.play);
    this.strokes.delete(id);
  }

  clear() {
    for (const id of [...this.strokes.keys()]) this.remove(id);
  }

  private stopPlaying(pl: Playing) {
    const now = this.ctx.currentTime;
    for (const v of pl.voices)
      for (const n of v.nodes) {
        try {
          n.stop(v.start > now ? 0 : now + 0.01);
        } catch {
          /* noop */
        }
      }
    for (const s of pl.sustains) {
      s.v.gain.gain.cancelScheduledValues(now);
      s.v.gain.gain.setValueAtTime(s.v.gain.gain.value, now);
      sustainEnd(s.v, now, 0.04);
    }
    pl.voices = [];
    pl.sustains = [];
  }

  /** 루프 회차 하나(시작 시각 T)를 예약. from 이전 이벤트는 건너뛴다(재개 시 중간부터) */
  private scheduleOccurrence(a: StrokeAudio, pl: Playing, T: number, from: number) {
    const hc = this.hitCtx();
    for (const ch of a.chunks) {
      for (const h of ch.hits) {
        const t = T + h.local;
        if (t < from) continue;
        if (!this.dj.voiceBudget()) continue; // 동시 발음 수 제한
        const v = this.dj.track(playHit(hc, h.kind, t, h.bright, this.duck(h.kind)));
        pl.voices.push(v);
      }
      if (ch.auto && a.sustain) {
        const end = T + ch.length;
        if (end <= from + 0.05) continue;
        const active = pl.sustains.filter((s) => s.end > this.ctx.currentTime).length + this.countSustains();
        if (active >= SCORE.maxSustains) continue;
        const start = Math.max(T, from);
        const valAt = (time: number) => {
          const lt = time - T;
          const pts = ch.auto!;
          let i = 0;
          while (i < pts.length - 1 && pts[i + 1].t < lt) i++;
          const p0 = pts[i];
          const p1 = pts[Math.min(pts.length - 1, i + 1)];
          const k = p1.t > p0.t ? Math.min(1, Math.max(0, (lt - p0.t) / (p1.t - p0.t))) : 0;
          return p0.v.map((x, j) => x + (p1.v[j] - x) * k) as SustainParams;
        };
        const v = makeSustain(this.ctx, this.dj.playBus, a.sustain.kind, start, valAt(start), this.sustainOpts(a.sustain.kind, a.sustain.slice));
        for (const pt of ch.auto) if (T + pt.t > start + 0.02) sustainRamp(v, pt.v as SustainParams, T + pt.t);
        // 마지막 청크는 짧게 잦아들고, 이어지는 청크 경계는 아주 짧게 교차
        const last = ch.index === a.chunks[a.chunks.length - 1].index;
        sustainEnd(v, end, last ? 0.25 : 0.03);
        pl.sustains.push({ v, end: end + 0.3 });
      }
    }
  }

  private countSustains() {
    let n = 0;
    const now = this.ctx.currentTime;
    for (const s of this.strokes.values()) n += s.play.sustains.filter((x) => x.end > now).length;
    return n;
  }

  private tick() {
    const now = this.ctx.currentTime;
    const horizon = now + LOOKAHEAD;
    for (const r of this.rolls.values()) {
      r.pending = r.pending.filter((v) => v.end > now);
      let t = this.dj.nextGrid(Math.max(r.last + 1e-3, now + 0.004), r.div);
      while (t < now + 0.12) {
        if (this.dj.voiceBudget()) r.pending.push(this.dj.track(playHit(this.hitCtx(), r.kind, t, r.bright, this.duck(r.kind), 0.8)));
        r.last = t;
        t = this.dj.nextGrid(t + 1e-3, r.div);
      }
    }
    if (!this.dj.playing) return;
    for (const { a, play } of this.strokes.values()) {
      play.voices = play.voices.filter((v) => v.end > now);
      play.sustains = play.sustains.filter((s) => s.end > now);
      let T = nextOccurrence(this.anchor, this.L, a.p, Math.max(play.scheduledUpTo, a.activeFrom - 1e-6));
      while (T < horizon) {
        if (T >= a.activeFrom) this.scheduleOccurrence(a, play, T, Math.max(T, now));
        play.scheduledUpTo = T;
        T += this.L;
      }
    }
  }

  // ---------------- 재생 ----------------

  async play() {
    if (this.dj.playing) return;
    await this.dj.play();
    // dj.play() 가 박 격자를 새 재생 위치에 맞춘다 → 진행 중이던 회차는 지금부터 이어서 예약
    const t0 = this.ctx.currentTime + 0.05;
    this.playFrom = t0;
    for (const { a, play } of this.strokes.values()) {
      const T = lastOccurrence(this.anchor, this.L, a.p, t0);
      const longest = a.chunks.reduce((m, c) => Math.max(m, c.length), 0);
      if (t0 < T + longest) this.scheduleOccurrence(a, play, T, t0);
      play.scheduledUpTo = T;
      a.activeFrom = -Infinity; // 정지 중 확정한 스트로크도 진행 중인 회차부터 재생
    }
  }

  /**
   * 지금 들리는 시각 기준으로 이 스트로크의 어느 회차가 울리고 있는지.
   * 실제로 예약된 회차만 돌려준다 (그래픽 강조를 소리와 맞추기 위해).
   */
  occurrenceAt(a: StrokeAudio, audible: number): number | null {
    if (!this.dj.playing) return null;
    const T = lastOccurrence(this.anchor, this.L, a.p, audible);
    if (T < a.activeFrom) return null;
    return T;
  }

  pause() {
    this.dj.pause();
    this.stopAll();
    this.playFrom = Infinity;
  }

  private stopAll() {
    for (const s of this.strokes.values()) this.stopPlaying(s.play);
  }

  /** 조작 취소·포커스 상실: 그리던 소리만 끝낸다 (확정된 루프는 유지) */
  cancelLive() {
    this.liveSustainStop(0.04);
    for (const k of [...this.rolls.keys()]) this.stopRoll(k);
  }

  dispose() {
    window.clearInterval(this.timer);
    this.stopAll();
    this.dj.dispose();
  }
}

/**
 * 원곡에서 가장 강한 음 높이 성분(0=C … 11=B). 곡의 조성을 판정하는 것이 아니라
 * 합창이 원곡과 덜 부딪히도록 근음·5도만 고르기 위한 대략적 기준이다.
 * C2~B5 의 각 음 높이에서 Goertzel 파워를 여러 구간에 걸쳐 합산한다.
 */
export function strongestPitchClass(mono: Float32Array, sr: number): number {
  const N = 4096;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const chroma = new Float64Array(12);
  const windows = 48;
  const span = mono.length - N;
  if (span <= 0) return 0;
  for (let w = 0; w < windows; w++) {
    const off = Math.floor((span * (w + 0.5)) / windows);
    for (let midi = 36; midi < 84; midi++) {
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      const k = (2 * Math.cos((2 * Math.PI * f) / sr));
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < N; i++) {
        const s0 = mono[off + i] * win[i] + k * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      chroma[midi % 12] += s1 * s1 + s2 * s2 - k * s1 * s2;
    }
  }
  let best = 0;
  for (let i = 1; i < 12; i++) if (chroma[i] > chroma[best]) best = i;
  return best;
}
