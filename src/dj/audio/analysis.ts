// 디코딩한 원곡에서 박자(BPM·첫 박)와 짧은 샘플 후보를 찾는다.
// 외부 의존 없이 단일 파일로 유지한다 (Node 스크립트에서도 그대로 import 가능하도록).

export interface TempoCandidate {
  bpm: number;
  score: number;
}

export interface TempoEstimate {
  bpm: number;
  /** 첫 박자 위치(초). 0 이상 중 가장 이른 박 */
  firstBeat: number;
  /** 마디 첫 박으로 추정한 위치(초). 저음 타격 기준이며 확실하지 않다 */
  firstDownbeat: number;
  /** 0~1. 박 위치의 타격 강도가 평균보다 얼마나 두드러지는지 */
  confidence: number;
  /** 반박/두 배 BPM 후보와 점수 (가중치 적용 전 원점수) */
  alternatives: TempoCandidate[];
  /** 두 배·반박 후보와 점수 차가 작으면 true */
  ambiguous: boolean;
}

export interface SliceInfo {
  start: number;
  length: number;
  /** 타격 강도 × 구간 음량 기반 점수 */
  score: number;
  rms: number;
  /** 0~1. 영교차율 기반 밝기 (음색 차이를 고르기 위한 대략적 지표) */
  brightness: number;
  onBeat: boolean;
}

export interface OnsetData {
  env: Float32Array;
  lowEnv: Float32Array;
  hopSec: number;
  /** env[n] 이 가리키는 실제 시각 = n * hopSec + offsetSec */
  offsetSec: number;
}

const HOP = 512;
const WIN = 1024;

export function toMono(channels: Float32Array[]): Float32Array {
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

// ---- FFT (radix-2, in-place) ----
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** 로그 스펙트럼 플럭스로 타격 시작점 강도 곡선을 만든다. lowEnv 는 200Hz 이하만. */
export function onsetEnvelope(mono: Float32Array, sr: number): OnsetData {
  const frames = Math.max(1, Math.floor((mono.length - WIN) / HOP) + 1);
  const bins = WIN / 2;
  const lowBin = Math.max(2, Math.round((200 * WIN) / sr));
  const win = new Float64Array(WIN);
  for (let i = 0; i < WIN; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN);
  const env = new Float32Array(frames);
  const lowEnv = new Float32Array(frames);
  let prev = new Float64Array(bins);
  const re = new Float64Array(WIN);
  const im = new Float64Array(WIN);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < WIN; i++) {
      re[i] = (mono[off + i] ?? 0) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const cur = new Float64Array(bins);
    let flux = 0;
    let lowFlux = 0;
    for (let k = 1; k < bins; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = cur[k] - prev[k];
      if (d > 0) {
        flux += d;
        if (k <= lowBin) lowFlux += d;
      }
    }
    env[f] = f === 0 ? 0 : flux;
    lowEnv[f] = f === 0 ? 0 : lowFlux;
    prev = cur;
  }
  normalizeEnvelope(env, Math.round(0.4 / (HOP / sr)));
  normalizeEnvelope(lowEnv, Math.round(0.4 / (HOP / sr)));
  // 플럭스는 직전 프레임과 현재 프레임의 차이 → 두 창의 경계(현재 창의 앞부분)가 실제 타격 시각에 가깝다
  return { env, lowEnv, hopSec: HOP / sr, offsetSec: (WIN * 0.5 - HOP * 0.5) / sr };
}

/** 이동 평균을 빼고 반파 정류한 뒤 최대값 1로 맞춘다 */
function normalizeEnvelope(e: Float32Array, half: number) {
  const n = e.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + e[i];
  const out = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    const v = Math.max(0, e[i] - (prefix[b] - prefix[a]) / (b - a));
    out[i] = v;
    if (v > max) max = v;
  }
  for (let i = 0; i < n; i++) e[i] = max > 0 ? out[i] / max : 0;
}

function sampleAt(e: Float32Array, x: number): number {
  if (x < 0 || x > e.length - 1) return 0;
  const i = Math.floor(x);
  const t = x - i;
  return e[i] * (1 - t) + (e[i + 1] ?? 0) * t;
}

/** 주어진 주기(프레임)와 위상에서 박 위치의 평균 강도 */
function combMean(e: Float32Array, period: number, phase: number): number {
  let s = 0;
  let c = 0;
  for (let x = phase; x < e.length - 1; x += period) {
    // 근처 ±1 프레임의 최대값을 써서 프레임 양자화 오차를 줄인다
    s += Math.max(sampleAt(e, x - 1), sampleAt(e, x), sampleAt(e, x + 1));
    c++;
  }
  return c ? s / c : 0;
}

/**
 * 박 / 반박 / 1/4박 격자를 함께 평가한다.
 * 3-3-2 같은 당김 리듬은 박 하나만 보면 점 4분음표(1.5박) 간격이 더 강하게 잡히는데,
 * 잘게 나눈 격자까지 맞는지 같이 보면 실제 박과 구분된다.
 */
function metricalScore(e: Float32Array, period: number, phase: number) {
  return combMean(e, period, phase) + 0.5 * combMean(e, period / 2, phase) + 0.5 * combMean(e, period / 4, phase);
}

function bestPhase(e: Float32Array, period: number, phaseEnv: Float32Array): { phase: number; score: number } {
  let best = { phase: 0, score: -1 };
  for (let p = 0; p < period; p += 0.25) {
    const s = metricalScore(e, period, p);
    if (s > best.score) best = { phase: p, score: s };
  }
  // 1/4박 격자 덕분에 위상이 1/4박 어긋난 자리도 점수가 비슷하게 나온다.
  // 정박 자리는 저음 타격을 더 크게 본 곡선으로 다시 고른다 (하이햇·스네어가 강한 엇박에 끌려가지 않도록)
  let phase = best.phase;
  let top = -1;
  for (let k = 0; k < 4; k++) {
    const p = (best.phase + (k * period) / 4) % period;
    const s = combMean(phaseEnv, period, p);
    if (s > top) {
      top = s;
      phase = p;
    }
  }
  return { phase, score: best.score };
}

export interface TempoOptions {
  minBpm?: number;
  maxBpm?: number;
  /** BPM 선호 중심(옥타브 오류 완화용 약한 가중치) */
  preferBpm?: number;
}

export function estimateTempo(onset: OnsetData, opts: TempoOptions = {}): TempoEstimate {
  const { env, lowEnv, hopSec, offsetSec } = onset;
  const minBpm = opts.minBpm ?? 60;
  const maxBpm = opts.maxBpm ?? 200;
  const prefer = opts.preferBpm ?? 120;
  const n = env.length;

  // 1) 자기상관으로 대략적인 반복 간격 후보
  const lagMin = Math.floor(60 / maxBpm / hopSec);
  const lagMax = Math.min(n - 2, Math.ceil(60 / minBpm / hopSec));
  let bestLag = lagMin;
  let bestW = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    s /= n - lag;
    const bpm = 60 / (lag * hopSec);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / prefer) / 0.9) ** 2);
    if (s * prior > bestW) {
      bestW = s * prior;
      bestLag = lag;
    }
  }
  const roughBpm = 60 / (bestLag * hopSec);

  // 2) 주변 BPM을 촘촘히 훑어 위상까지 함께 맞춘다 (곡 전체에서 박 위치 강도의 평균이 최대인 조합)
  const phaseEnv = new Float32Array(n);
  for (let i = 0; i < n; i++) phaseEnv[i] = 0.5 * env[i] + lowEnv[i];
  const prior = (bpm: number) => Math.exp(-0.5 * (Math.log2(bpm / prefer) / 0.9) ** 2);
  const refine = (center: number) => {
    let best = { bpm: center, phase: 0, score: -1 };
    for (let bpm = center * 0.97; bpm <= center * 1.03; bpm += 0.05) {
      const period = 60 / bpm / hopSec;
      const ph = bestPhase(env, period, phaseEnv);
      if (ph.score > best.score) best = { bpm, phase: ph.phase, score: ph.score };
    }
    return best;
  };
  // 자기상관 결과와 2배·반·3/2·2/3 관계 후보를 모두 다듬어 비교한다
  const cands = [1, 2, 0.5, 1.5, 2 / 3]
    .map((r) => roughBpm * r)
    .filter((b) => b >= minBpm && b <= maxBpm)
    .map(refine);
  cands.sort((a, b) => b.score * prior(b.bpm) - a.score * prior(a.bpm));
  const main = cands[0];

  const period = 60 / main.bpm / hopSec;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n;
  // 박 위치 평균 강도가 전체 평균의 몇 배인지 → 0~1 로 압축
  const ratio = combMean(env, period, main.phase) / Math.max(1e-6, mean);
  const confidence = Math.max(0, Math.min(1, (ratio - 1.3) / 2.5));

  // 3) 마디 첫 박: 4개 위상 중 저음 타격이 가장 강한 위상
  let down = 0;
  let downScore = -1;
  for (let k = 0; k < 4; k++) {
    const s = combMean(lowEnv, period * 4, main.phase + k * period);
    if (s > downScore) {
      downScore = s;
      down = k;
    }
  }
  const beatSec = 60 / main.bpm;
  let firstBeat = main.phase * hopSec + offsetSec;
  // 위상 탐색은 프레임 단위라 수 ms 치우칠 수 있다 → 1/4박 격자 근처의 강한 타격들과의 오차 중앙값만큼 보정
  const quarter = beatSec / 4;
  const errs = pickOnsets(onset)
    .filter((o) => o.strength > 0.3)
    .map((o) => {
      const x = (o.time - firstBeat) / quarter;
      return (x - Math.round(x)) * quarter;
    })
    .filter((e) => Math.abs(e) < 0.03)
    .sort((a, b) => a - b);
  if (errs.length >= 4) firstBeat += errs[Math.floor(errs.length / 2)];

  // 4) 강한 타격들을 16분 격자 번호에 대응시켜 최소제곱 직선(t = a + n·q)으로 BPM·첫 박을 다듬는다.
  //    탐색 간격(0.05 BPM)과 프레임 크기(샘플레이트마다 다름)에 덜 묶여, 반복 구간 끝에서도 박이 밀리지 않게.
  let fitBpm = main.bpm;
  const strong = pickOnsets(onset).filter((o) => o.strength > 0.3);
  for (let iter = 0; iter < 4; iter++) {
    const q = 60 / fitBpm / 4;
    const pts = strong
      .map((o) => ({ n: Math.round((o.time - firstBeat) / q), t: o.time }))
      // 반복할수록 허용 오차를 좁혀 격자에서 벗어난 필인·끝부분 타격을 제외
      .filter((p) => Math.abs(p.t - (firstBeat + p.n * q)) < [0.03, 0.015, 0.012, 0.012][iter]);
    if (pts.length < 8) break;
    const mn = pts.reduce((s, p) => s + p.n, 0) / pts.length;
    const mt = pts.reduce((s, p) => s + p.t, 0) / pts.length;
    let num = 0;
    let den = 0;
    for (const p of pts) {
      num += (p.n - mn) * (p.t - mt);
      den += (p.n - mn) ** 2;
    }
    const qFit = den > 0 ? num / den : q;
    // ±1% 안에서만 다듬는다 (반박·두 배 판단은 앞 단계 결과 유지)
    if (Math.abs(qFit - q) / q > 0.01) break;
    fitBpm = 60 / qFit / 4;
    firstBeat = mt - mn * qFit;
  }
  const beat = 60 / fitBpm;
  firstBeat = ((firstBeat % beat) + beat) % beat;
  void beatSec;

  let firstDownbeat = firstBeat + down * beat;
  while (firstDownbeat - 4 * beat >= -0.02) firstDownbeat -= 4 * beat;
  while (firstDownbeat < -0.02) firstDownbeat += 4 * beat;

  const alternatives: TempoCandidate[] = cands.map((c) => ({ bpm: Math.round(c.bpm * 100) / 100, score: c.score }));
  const mainW = main.score * prior(main.bpm);
  const ambiguous = cands.slice(1).some((c) => c.score * prior(c.bpm) > mainW * 0.9);

  return {
    bpm: Math.round(fitBpm * 1000) / 1000,
    firstBeat,
    firstDownbeat: Math.max(0, firstDownbeat),
    confidence,
    alternatives,
    ambiguous,
  };
}

/** 타격 시작점(초). 지역 최대이면서 평균+표준편차*0.5 이상인 프레임 */
export function pickOnsets(onset: OnsetData): { time: number; strength: number }[] {
  const { env, hopSec, offsetSec } = onset;
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  let varSum = 0;
  for (const v of env) varSum += (v - mean) ** 2;
  const thr = mean + 0.5 * Math.sqrt(varSum / env.length);
  const w = Math.max(1, Math.round(0.05 / hopSec));
  const out: { time: number; strength: number }[] = [];
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] < thr) continue;
    let isMax = true;
    for (let k = Math.max(0, i - w); k <= Math.min(env.length - 1, i + w); k++) {
      if (env[k] > env[i]) {
        isMax = false;
        break;
      }
    }
    if (isMax) out.push({ time: i * hopSec + offsetSec, strength: env[i] });
  }
  return out;
}

function rmsOf(x: Float32Array, a: number, b: number) {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

function zcrOf(x: Float32Array, a: number, b: number) {
  let z = 0;
  for (let i = a + 1; i < b; i++) if ((x[i - 1] >= 0) !== (x[i] >= 0)) z++;
  return z / Math.max(1, b - a);
}

export interface SliceQuery {
  length: number;
  /** 이미 고른 구간과 겹치지 않게 피할 시작점들 */
  avoid?: number[];
  /** 밝기 선호: 1 이면 밝은 구간, -1 이면 어두운 구간, 0 은 무관 */
  preferBright?: number;
}

/**
 * 타격 시작점 기준으로 짧은 구간 후보를 만들고, 무음·작은 구간을 제외한 뒤 점수순으로 돌려준다.
 * 시작점은 타격 직전 10ms 로 당겨 어택이 잘리지 않게 한다.
 */
export function rankSlices(
  mono: Float32Array,
  sr: number,
  onsets: { time: number; strength: number }[],
  tempo: Pick<TempoEstimate, 'bpm' | 'firstBeat'>,
  q: SliceQuery,
): SliceInfo[] {
  const globalRms = rmsOf(mono, 0, mono.length);
  const beat = 60 / tempo.bpm;
  const list: SliceInfo[] = [];
  for (const o of onsets) {
    const start = Math.max(0, o.time - 0.01);
    const a = Math.floor(start * sr);
    const b = Math.floor((start + q.length) * sr);
    if (b >= mono.length) continue;
    const rms = rmsOf(mono, a, b);
    if (rms < 0.35 * globalRms || rms < 0.01) continue; // 무음·작은 구간 제외
    const phase = (((o.time - tempo.firstBeat) / beat) % 1 + 1) % 1;
    const gridDist = Math.min(phase, 1 - phase) * beat;
    const onBeat = gridDist < 0.035;
    const brightness = Math.min(1, zcrOf(mono, a, b) * 8);
    list.push({ start, length: q.length, score: o.strength * rms * (onBeat ? 1.6 : 1), rms, brightness, onBeat });
  }
  const avoid = q.avoid ?? [];
  const pref = q.preferBright ?? 0;
  return list
    .filter((s) => avoid.every((t) => Math.abs(s.start - t) > Math.max(q.length, 0.25)))
    .map((s) => ({ s, k: s.score * (1 + pref * (s.brightness - 0.5)) }))
    .sort((x, y) => y.k - x.k)
    .map((x) => x.s);
}
