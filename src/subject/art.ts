/**
 * 대상 배치 + "아트 격자".
 * 대상은 캔버스 중앙에 고정된 위치·크기로 놓이고(박스가 움직여도 변하지 않는다), 그 위에서 효과 박스만 움직인다.
 * 패턴 표현은 거친 정사각 셀 격자(아트 격자) 위에서 계산한다: 셀마다 대상 안/밖, 명암(tone), 명암 단계(level), 외곽에서의 깊이(depth).
 */
import type { BBox } from './mask';

export interface ArtGrid {
  cell: number;
  cols: number;
  rows: number;
  /** 1: 실루엣 안쪽 셀 (거친 픽셀 계단 외곽) */
  inside: Uint8Array;
  /** 0..1 명암 (3x3 평활) */
  tone: Float32Array;
  /** 0..3 명암 4단계 (대상 안 분위수 기준) */
  level: Uint8Array;
  thr: [number, number, number];
  /** 외곽에서 안쪽으로의 거리(셀 단위) */
  depth: Float32Array;
}

export interface Subject {
  /** 마스크로 오려 낸 사진(밖은 투명) — 사진 모드의 기본 표현 */
  cut: HTMLCanvasElement;
  /** 사진 모드 효과의 원본: 오려 낸 사진의 색을 바깥으로 번지게 채운 불투명 캔버스(효과가 밖을 끌어와도 흰 구멍이 생기지 않는다). 모든 박스가 공유 */
  src: HTMLCanvasElement;
  /** 매끈한 실루엣 알파 마스크(사진 모드) */
  mask: HTMLCanvasElement;
  art: ArtGrid;
  /** 캔버스 픽셀 기준 대상 경계 상자 */
  bbox: { x: number; y: number; w: number; h: number };
  /** 이미지 정규화 좌표 -> 캔버스 픽셀 */
  map: (nx: number, ny: number) => { x: number; y: number };
}

export interface SubjectInput {
  source: CanvasImageSource;
  width: number;
  height: number;
  mask: CanvasImageSource;
  maskBBox: BBox;
}

/** 대상의 최대 크기(캔버스 대비): 둘레에 흰 여백이 충분히 남도록 */
export const SUBJECT_MAX_W = 0.5;
export const SUBJECT_MAX_H = 0.62;

/** 2x2 평균을 반복해서 셀당 평균 색(알파 포함)을 얻는다 */
function averageDown(src: HTMLCanvasElement, cell: number, cols: number, rows: number): ImageData {
  let cur = document.createElement('canvas');
  cur.width = cols * cell;
  cur.height = rows * cell;
  cur.getContext('2d')!.drawImage(src, 0, 0);
  let ratio = cell;
  while (ratio >= 2 && Math.floor(cur.width / 2) >= cols && Math.floor(cur.height / 2) >= rows) {
    const nxt = document.createElement('canvas');
    nxt.width = Math.max(cols, Math.round(cur.width / 2));
    nxt.height = Math.max(rows, Math.round(cur.height / 2));
    const c = nxt.getContext('2d')!;
    c.imageSmoothingQuality = 'high';
    c.drawImage(cur, 0, 0, nxt.width, nxt.height);
    cur = nxt;
    ratio /= 2;
  }
  const out = document.createElement('canvas');
  out.width = cols;
  out.height = rows;
  const o = out.getContext('2d', { willReadFrequently: true })!;
  o.imageSmoothingQuality = 'high';
  o.drawImage(cur, 0, 0, cols, rows);
  return o.getImageData(0, 0, cols, rows);
}

export function buildArtGrid(photo: HTMLCanvasElement, mask: HTMLCanvasElement, cell: number): ArtGrid {
  const cols = Math.ceil(photo.width / cell);
  const rows = Math.ceil(photo.height / cell);
  const colorD = averageDown(photo, cell, cols, rows).data;
  const maskD = averageDown(mask, cell, cols, rows).data;
  const n = cols * rows;
  const inside = new Uint8Array(n);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    inside[i] = maskD[i * 4 + 3] >= 128 ? 1 : 0;
    raw[i] = (0.299 * colorD[i * 4] + 0.587 * colorD[i * 4 + 1] + 0.114 * colorD[i * 4 + 2]) / 255;
  }
  // 대상 안의 셀끼리만 3x3 평균
  const tone = new Float32Array(n);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (!inside[k]) continue;
      let s = 0;
      let c = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
          const kk = jj * cols + ii;
          if (inside[kk]) {
            s += raw[kk];
            c++;
          }
        }
      tone[k] = s / c;
    }
  // 분위수 기준 4단계
  const vals: number[] = [];
  for (let i = 0; i < n; i++) if (inside[i]) vals.push(tone[i]);
  vals.sort((a, b) => a - b);
  const q = (p: number) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 0.5);
  const thr: [number, number, number] = [q(0.3), q(0.64), q(0.92)];
  const level = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (inside[i]) level[i] = tone[i] < thr[0] ? 0 : tone[i] < thr[1] ? 1 : tone[i] < thr[2] ? 2 : 3;
  // 외곽 거리(chamfer 3-4)
  const INF = 1e9;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = inside[i] ? INF : 0;
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= cols || j >= rows ? 0 : d[j * cols + i]);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (!inside[k]) continue;
      d[k] = Math.min(d[k], at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + 1.4, at(i + 1, j - 1) + 1.4);
    }
  for (let j = rows - 1; j >= 0; j--)
    for (let i = cols - 1; i >= 0; i--) {
      const k = j * cols + i;
      if (!inside[k]) continue;
      d[k] = Math.min(d[k], at(i + 1, j) + 1, at(i, j + 1) + 1, at(i + 1, j + 1) + 1.4, at(i - 1, j + 1) + 1.4);
    }
  return { cell, cols, rows, inside, tone, level, thr, depth: d };
}

/** 이미지를 캔버스 중앙에 고정 배치하고 마스크·아트 격자를 만든다 */
export function buildSubject(img: SubjectInput, cw: number, ch: number): Subject {
  const bw = img.maskBBox.w * img.width;
  const bh = img.maskBBox.h * img.height;
  const k = Math.min((SUBJECT_MAX_W * cw) / bw, (SUBJECT_MAX_H * ch) / bh);
  const ox = cw / 2 - (img.maskBBox.x + img.maskBBox.w / 2) * img.width * k;
  const oy = ch / 2 - (img.maskBBox.y + img.maskBBox.h / 2) * img.height * k;
  const dw = img.width * k;
  const dh = img.height * k;

  const mask = document.createElement('canvas');
  mask.width = cw;
  mask.height = ch;
  const mg = mask.getContext('2d')!;
  mg.imageSmoothingQuality = 'high';
  mg.drawImage(img.mask, ox, oy, dw, dh);

  // 마스크로 오려낸 사진 (투명 배경) — 명암 분석용
  const cut = document.createElement('canvas');
  cut.width = cw;
  cut.height = ch;
  const cg = cut.getContext('2d')!;
  cg.imageSmoothingQuality = 'high';
  cg.drawImage(img.source, ox, oy, dw, dh);
  cg.globalCompositeOperation = 'destination-in';
  cg.drawImage(mask, 0, 0);

  // 사진 모드 원본: 오려낸 사진 아래에, 점점 더 거칠게 줄인 사본을 깔아 대상 색을 바깥으로 번지게 한다 (피라미드 채움)
  const src = document.createElement('canvas');
  src.width = cw;
  src.height = ch;
  const sg = src.getContext('2d')!;
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(cut, 0, 0);
  for (let l = 1; l <= 11; l++) {
    const sw = Math.max(1, Math.round(cw / 2 ** l));
    const sh = Math.max(1, Math.round(ch / 2 ** l));
    const small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    const smg = small.getContext('2d')!;
    smg.imageSmoothingQuality = 'high';
    smg.drawImage(cut, 0, 0, sw, sh);
    sg.globalCompositeOperation = 'destination-over';
    sg.drawImage(small, 0, 0, cw, ch);
  }
  sg.globalCompositeOperation = 'destination-over';
  sg.fillStyle = '#fff';
  sg.fillRect(0, 0, cw, ch);
  src.dataset.v = String(Math.random());

  const cell = Math.max(4, Math.round(Math.min(cw, ch) / 112));
  const art = buildArtGrid(cut, mask, cell);
  return {
    cut,
    src,
    mask,
    art,
    bbox: { x: ox + img.maskBBox.x * img.width * k, y: oy + img.maskBBox.y * img.height * k, w: bw * k, h: bh * k },
    map: (nx, ny) => ({ x: ox + nx * dw, y: oy + ny * dh }),
  };
}
