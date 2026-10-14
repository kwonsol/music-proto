// 스트로크를 4마디 루프에 기록하기 위한 순수 계산 (오디오·화면과 무관, 테스트 가능).
//
// 시간 규칙
// - 스트로크는 그리기 시작한 순간의 루프 위치 p(초, 0 ≤ p < L)와 실제로 그린 시간축을 그대로 기록한다.
//   가로 위치를 시간으로 해석하지 않는다.
// - 루프 길이 L 보다 긴 스트로크는 L 단위 청크로 나눈다. 모든 청크는 같은 루프 위치 p 에서 시작하므로
//   매 루프마다 겹쳐서(오버더빙처럼) 재생된다. 청크 하나는 L 을 넘지 않아 자기 자신과 겹치지 않는다.
// - 타격 이벤트는 루프 기준 16분음표 격자에 맞춘다(재생할 때만. 그리는 순간의 소리는 즉시).

export interface RawHit<K extends string = string> {
  /** 스트로크 시작부터의 실제 경과 시간(초) */
  s: number;
  kind: K;
  /** 0~1, 위아래 위치에서 온 밝기 */
  bright: number;
  /** 그래픽 요소 번호 (재생 강조용) */
  elem: number;
  /** 음높이 있는 소리: 근음 기준 반음 수 (그림 규칙으로 정해짐) */
  note?: number;
}

export interface ChunkHit<K extends string = string> extends RawHit<K> {
  /** 청크 시작부터의 재생 시각(격자에 맞춘 값) */
  local: number;
}

export interface AutoPoint {
  /** 청크 시작부터의 시각 */
  t: number;
  v: number[];
}

export interface Chunk<K extends string = string> {
  index: number;
  /** 청크 길이(초) ≤ L */
  length: number;
  hits: ChunkHit<K>[];
  /** 지속음 파라미터 기록 (없으면 null) */
  auto: AutoPoint[] | null;
}

export const mod = (a: number, n: number) => ((a % n) + n) % n;

export function loopPos(t: number, anchor: number, L: number) {
  return mod(t - anchor, L);
}

/** p 에서 시작하는 루프 재생 중 시각 at 이전(포함) 가장 최근 시작 시각 */
export function lastOccurrence(anchor: number, L: number, p: number, at: number) {
  return anchor + p + Math.floor((at - anchor - p) / L) * L;
}

/** after 이후(초과) 첫 시작 시각 */
export function nextOccurrence(anchor: number, L: number, p: number, after: number) {
  return anchor + p + (Math.floor((after - anchor - p) / L + 1e-9) + 1) * L;
}

/**
 * 타격을 16분 격자에 맞추고 청크로 나눈다.
 * - 루프 위치 기준 격자(루프 시작 = 마디 첫 박)에 가장 가까운 칸으로 옮긴다.
 * - 같은 칸에 두 번 떨어지면 다음 칸으로 민다 (순서 유지, 중복 발음 방지).
 * - 스트로크 시작 이전 칸으로 당겨지면 한 칸 뒤로.
 */
export function quantizeHits<K extends string>(hits: RawHit<K>[], p: number, L: number, grid: number): { chunk: number; hit: ChunkHit<K> }[] {
  const out: { chunk: number; hit: ChunkHit<K> }[] = [];
  let prevAbs = -Infinity;
  const sorted = [...hits].sort((a, b) => a.s - b.s);
  for (const h of sorted) {
    // 루프 위치축(스트로크 시작 루프의 0 기준)에서의 절대 위치
    let abs = Math.round((p + h.s) / grid) * grid;
    if (abs < p - 1e-9) abs += grid;
    if (abs <= prevAbs + 1e-9) abs = prevAbs + grid;
    prevAbs = abs;
    const rel = abs - p; // 스트로크 시작 기준
    const chunk = Math.floor(rel / L + 1e-9);
    out.push({ chunk, hit: { ...h, local: rel - chunk * L } });
  }
  return out;
}

/** 지속음 파라미터 기록을 청크로 나눈다. 경계에서는 값을 보간해 양쪽 청크에 넣는다 */
export function splitAuto(samples: { s: number; v: number[] }[], L: number): AutoPoint[][] {
  if (!samples.length) return [];
  const last = samples[samples.length - 1].s;
  const n = Math.max(1, Math.ceil(last / L - 1e-9));
  const at = (s: number) => {
    let i = 0;
    while (i < samples.length - 1 && samples[i + 1].s < s) i++;
    const a = samples[i];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    if (b.s <= a.s) return a.v.slice();
    const k = Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s)));
    return a.v.map((x, j) => x + (b.v[j] - x) * k);
  };
  const chunks: AutoPoint[][] = [];
  for (let c = 0; c < n; c++) {
    const a = c * L;
    const b = Math.min(last, (c + 1) * L);
    const pts: AutoPoint[] = [{ t: 0, v: at(a) }];
    for (const smp of samples) if (smp.s > a && smp.s < b) pts.push({ t: smp.s - a, v: smp.v.slice() });
    pts.push({ t: b - a, v: at(b) });
    chunks.push(pts);
  }
  return chunks;
}

export function buildChunks<K extends string>(
  p: number,
  duration: number,
  hits: RawHit<K>[],
  auto: { s: number; v: number[] }[] | null,
  L: number,
  grid: number,
): Chunk<K>[] {
  const q = quantizeHits(hits, p, L, grid);
  const autoChunks = auto && auto.length ? splitAuto(auto, L) : [];
  const lastHitChunk = q.reduce((m, h) => Math.max(m, h.chunk), -1);
  const n = Math.max(1, Math.ceil(duration / L - 1e-9), autoChunks.length, lastHitChunk + 1);
  const chunks: Chunk<K>[] = [];
  for (let c = 0; c < n; c++) {
    const hs = q.filter((h) => h.chunk === c).map((h) => h.hit);
    const au = autoChunks[c] ?? null;
    const endHit = hs.reduce((m, h) => Math.max(m, h.local + 0.3), 0);
    const endAuto = au ? au[au.length - 1].t : 0;
    const len = Math.min(L, Math.max(endHit, endAuto, Math.min(L, duration - c * L)));
    if (!hs.length && !au) continue;
    chunks.push({ index: c, length: len, hits: hs, auto: au });
  }
  return chunks;
}
