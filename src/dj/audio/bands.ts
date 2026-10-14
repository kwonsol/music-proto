// 원곡 경로(연주음이 섞이기 전)에 붙인 AnalyserNode 에서 저·중·고음 에너지를 읽는다.

export interface Bands {
  low: number;
  mid: number;
  high: number;
}

const RANGES: [keyof Bands, number, number][] = [
  ['low', 40, 250],
  ['mid', 250, 4000],
  ['high', 4000, 16000],
];

export class BandMeter {
  readonly value: Bands = { low: 0, mid: 0, high: 0 };
  private readonly db: Float32Array<ArrayBuffer>;
  private readonly bins: Record<keyof Bands, [number, number]>;
  /** 구간별 최근 최대 레벨(dB). 곡 음량 차이를 흡수하는 적응형 기준 */
  private readonly peak: Record<keyof Bands, number> = { low: -60, mid: -60, high: -60 };

  constructor(private readonly analyser: AnalyserNode) {
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0; // 평활은 아래에서 직접
    this.db = new Float32Array(analyser.frequencyBinCount);
    const sr = analyser.context.sampleRate;
    const nyq = sr / 2;
    const hz = sr / analyser.fftSize;
    const bins = {} as Record<keyof Bands, [number, number]>;
    for (const [k, lo, hi] of RANGES) {
      // 샘플레이트가 허용하는 범위까지만
      const top = Math.min(hi, nyq * 0.98);
      bins[k] = [Math.max(1, Math.round(lo / hz)), Math.max(1, Math.round(top / hz))];
    }
    this.bins = bins;
  }

  /** dt 초만큼 경과했다고 보고 값을 갱신. active=false 면 서서히 0 으로 */
  update(dt: number, active: boolean): Bands {
    if (!active) {
      for (const [k] of RANGES) this.value[k] *= Math.exp(-dt * 6);
      return this.value;
    }
    this.analyser.getFloatFrequencyData(this.db);
    for (const [k] of RANGES) {
      const [a, b] = this.bins[k];
      // dB 를 그대로 평균 내지 않고 선형 파워로 바꿔 평균 → 구간 폭(bin 수)으로 나눠 폭 차이 보정
      let p = 0;
      for (let i = a; i <= b; i++) p += Math.pow(10, this.db[i] / 10);
      const level = 10 * Math.log10(p / (b - a + 1) + 1e-12);
      // 적응형 최대값: 올라갈 땐 즉시, 내려갈 땐 초당 4dB
      this.peak[k] = Math.max(level, this.peak[k] - 4 * dt);
      // 최대값 아래 24dB 범위를 0~1 로
      const target = Math.min(1, Math.max(0, (level - (this.peak[k] - 24)) / 24));
      // 빠르게 오르고 천천히 내린다 → 급격한 흔들림 완화
      const tau = target > this.value[k] ? 0.035 : 0.18;
      this.value[k] += (target - this.value[k]) * (1 - Math.exp(-dt / tau));
    }
    return this.value;
  }
}
