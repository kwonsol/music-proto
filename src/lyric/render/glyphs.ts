import { fontFor, isHangul, mctx, type FontInfo } from './fonts';

/**
 * 한 글자를 고해상도 오프스크린 캔버스에 래스터화한 결과.
 * 모든 좌표는 디바이스 픽셀. 같은 크기의 글자는 같은 박스·기준선을 공유한다.
 */
export interface Glyph {
  ch: string;
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  /** 박스 왼쪽 여백 (글자 원점 = pad) */
  pad: number;
  advance: number;
  /** 기준 글자 크기 (효과 진폭의 단위) */
  em: number;
  space: boolean;
  inkTop: number;
  inkBottom: number;
  inkLeft: number;
  inkRight: number;
  /** 열마다 잉크가 있는 가장 위/아래 행 (-1 = 없음) */
  colTop: Int16Array;
  colBottom: Int16Array;
  /** 행마다 잉크가 있는 가장 왼/오른 열 (-1 = 없음) */
  rowLeft: Int16Array;
  rowRight: Int16Array;
  outline: HTMLCanvasElement | null;
  font: string;
}

/** 줄 박스 비율: 글자 박스 높이 = em*BOX, 기준선 = em*BASE */
export const BOX = 1.42;
export const BASE = 1.08;
export const PAD = 0.12;

export function advanceOf(ch: string, size: number, fi: FontInfo): number {
  const c = mctx();
  c.font = fontFor(ch, size, fi.hangulScale);
  // 한글은 자간을 살짝 좁혀 영문 콘덴스드 서체와 밀도를 맞춘다
  return c.measureText(ch).width * (isHangul(ch) ? 0.96 : 1.02);
}

export class GlyphCache {
  private map = new Map<string, Glyph>();
  constructor(private fi: FontInfo) {}

  get(ch: string, size: number): Glyph {
    const s = Math.round(size * 4) / 4;
    const key = `${s}|${ch}`;
    let g = this.map.get(key);
    if (!g) {
      if (this.map.size > 700) this.map.clear();
      g = this.build(ch, s);
      this.map.set(key, g);
    }
    return g;
  }

  private build(ch: string, em: number): Glyph {
    const advance = advanceOf(ch, em, this.fi);
    const pad = Math.ceil(em * PAD);
    const w = Math.max(1, Math.ceil(advance + pad * 2));
    const h = Math.ceil(em * BOX);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const font = fontFor(ch, em, this.fi.hangulScale);
    const space = ch.trim() === '';
    const colTop = new Int16Array(w).fill(-1);
    const colBottom = new Int16Array(w).fill(-1);
    const rowLeft = new Int16Array(h).fill(-1);
    const rowRight = new Int16Array(h).fill(-1);
    let inkTop = h, inkBottom = -1, inkLeft = w, inkRight = -1;
    if (!space) {
      const c = canvas.getContext('2d', { willReadFrequently: true })!;
      c.font = font;
      c.fillStyle = '#000';
      c.textBaseline = 'alphabetic';
      c.fillText(ch, pad, Math.round(em * BASE));
      const data = c.getImageData(0, 0, w, h).data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] > 96) {
            if (colTop[x] < 0) colTop[x] = y;
            colBottom[x] = y;
            if (rowLeft[y] < 0) rowLeft[y] = x;
            rowRight[y] = x;
            if (y < inkTop) inkTop = y;
            if (y > inkBottom) inkBottom = y;
            if (x < inkLeft) inkLeft = x;
            if (x > inkRight) inkRight = x;
          }
        }
      }
    }
    if (inkBottom < 0) {
      inkTop = Math.round(em * 0.3);
      inkBottom = Math.round(em * BASE);
      inkLeft = pad;
      inkRight = Math.round(pad + advance);
    }
    return { ch, canvas, w, h, pad, advance, em, space, inkTop, inkBottom, inkLeft, inkRight, colTop, colBottom, rowLeft, rowRight, outline: null, font };
  }
}

/** 잔상용 윤곽선 비트맵 (필요할 때만 생성) */
export function outlineOf(g: Glyph): HTMLCanvasElement {
  if (g.outline) return g.outline;
  const c = document.createElement('canvas');
  c.width = g.w;
  c.height = g.h;
  const x = c.getContext('2d')!;
  if (!g.space) {
    x.font = g.font;
    x.strokeStyle = '#000';
    x.lineJoin = 'miter';
    x.lineWidth = Math.max(1.5, g.em * 0.022);
    x.textBaseline = 'alphabetic';
    x.strokeText(g.ch, g.pad, Math.round(g.em * BASE));
  }
  g.outline = c;
  return c;
}
