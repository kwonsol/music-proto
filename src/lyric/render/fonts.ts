import '@fontsource/anton/400.css';
import '@fontsource/noto-sans-kr/900.css';

/** 영문: 굵고 폭이 좁은 Anton / 한글: 굵은 고딕 Noto Sans KR Black */
export const LATIN_FAMILY = '"Anton", "Impact", "Helvetica Neue", sans-serif';
export const HANGUL_FAMILY = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

const HANGUL_RE = /[ᄀ-ᇿ㄰-㆏가-힯　-〿一-鿿＀-￯]/;
export const isHangul = (ch: string) => HANGUL_RE.test(ch);

export interface FontInfo {
  /** 한글 글자 크기 배율. 한글 높이를 영문 대문자 높이에 맞춘다. */
  hangulScale: number;
  latinOk: boolean;
  hangulOk: boolean;
}

export function fontFor(ch: string, size: number, hangulScale: number): string {
  return isHangul(ch) ? `900 ${size * hangulScale}px ${HANGUL_FAMILY}` : `400 ${size}px ${LATIN_FAMILY}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
export function mctx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

/**
 * 주어진 텍스트에 필요한 글리프(유니코드 범위별 서브셋)까지 모두 받은 뒤 resolve.
 * 측정·래스터화는 반드시 이 이후에 한다.
 */
export async function loadFonts(text: string): Promise<FontInfo> {
  const sample = text + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 한글가나다';
  await Promise.all([
    document.fonts.load(`400 64px "Anton"`, sample),
    document.fonts.load(`900 64px "Noto Sans KR"`, sample),
  ]);
  await document.fonts.ready;
  const latinOk = document.fonts.check(`400 64px "Anton"`, 'ABC');
  const hangulOk = document.fonts.check(`900 64px "Noto Sans KR"`, '한글');
  const c = mctx();
  c.font = `400 100px ${LATIN_FAMILY}`;
  const m1 = c.measureText('H');
  c.font = `900 100px ${HANGUL_FAMILY}`;
  const m2 = c.measureText('한');
  const hLatin = m1.actualBoundingBoxAscent + m1.actualBoundingBoxDescent;
  const hHangul = m2.actualBoundingBoxAscent + m2.actualBoundingBoxDescent;
  const hangulScale = hHangul > 0 ? Math.min(1.3, Math.max(0.75, hLatin / hHangul)) : 1;
  return { hangulScale, latinOk, hangulOk };
}
