import { EFFECTS, type Effect, type EffectId, type EffectParams } from '../effects';
import { clamp, fract } from '../lib/ease';
import { lineAt, parseMarked, type LyricLine } from '../data/lyrics';
import type { DirectionPreset, SemanticTag } from '../data/presets';
import type { FontInfo } from './fonts';
import { advanceOf, BASE, GlyphCache } from './glyphs';
import { stepFor } from '../effects/slicer';
import type { RingLine, RingView } from '../data/rings';
import { RingScene } from './ring';

export type Mode = 'ring' | 'single' | 'repeat' | 'demo';
export type Theme = 'white' | 'yellow';

export const THEME_BG: Record<Theme, string> = { white: '#ffffff', yellow: '#ffe500' };

export interface SceneState {
  mode: Mode;
  /** 자유 입력 텍스트. [대괄호] = 강조 범위 */
  input: string;
  effect: EffectId;
  params: EffectParams;
  compare: boolean;
  theme: Theme;
  presets: Record<SemanticTag, DirectionPreset>;
  lyrics: LyricLine[];
  /** 링 편집 모드: 줄마다 독립 설정 (선택된 줄은 미리보기 값이 들어온다) */
  ring: { lines: RingLine[]; selected: number; view: RingView };
}

export interface Clock {
  /** 재생 위치(초). 데모 가사 타임라인 기준 */
  time: number;
  /** 속도가 반영된 효과 시간(초). 속도를 바꿔도 끊기지 않도록 누적 */
  fx: number;
  /** 이번 프레임의 경과 시간(초). 일시정지 중에는 0 */
  dt: number;
  /** '처음부터' 를 누를 때마다 증가 → 링 공전·줄별 효과 시간 초기화 */
  epoch: number;
}

interface Style {
  effect: Effect;
  params: EffectParams;
  index: number;
  count: number;
}

export type StripItem = Item;

interface Item {
  ch: string;
  style: Style | null;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 타이밍 계산 방식: 반복(loop) 또는 가사 한 줄 안에서 한 번(once) */
type Timing =
  | { kind: 'loop'; fx: number; offset: number }
  | { kind: 'once'; local: number; t: number; cycle: number };

/** 캡 높이 근사치 (em 비율). 블록 세로 중앙 정렬에 사용 */
const CAP = 0.8;

export class SceneRenderer {
  cache: GlyphCache;
  /** 이번 프레임에 왜곡되는 글자 수 (슬라이스 예산 계산용) */
  private load = 1;
  /** 줄바꿈 결과는 글자 인덱스로만 저장 (효과 파라미터가 바뀌어도 재사용) */
  private layoutMemo = new Map<string, { size: number; lines: number[][] }>();

  ring: RingScene;

  constructor(private fi: FontInfo) {
    this.cache = new GlyphCache(fi);
    this.ring = new RingScene(this, fi);
  }

  setLoad(n: number) {
    this.load = Math.max(1, n);
  }

  /** 링 텍스처용: 한 줄을 왼쪽 정렬로 그리고 실제 폭을 돌려준다 */
  drawStripLine(ctx: CanvasRenderingContext2D, items: Item[], size: number, ax: number, baseline: number, fx: number, distort: boolean, instance: number, radius: number, room: number) {
    return this.drawLine(ctx, items, size, ax, baseline, 'left', { kind: 'loop', fx, offset: 0 }, distort, instance, room, -Infinity, Infinity, radius);
  }

  render(ctx: CanvasRenderingContext2D, W: number, H: number, s: SceneState, clock: Clock) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = THEME_BG[s.theme];
    ctx.fillRect(0, 0, W, H);

    // 데모 모드는 하단 타임라인 표시줄 높이만큼 비워 둔다
    const hud = s.mode === 'demo' ? Math.min(H * 0.12, 64 * (W / Math.max(1, ctx.canvas.clientWidth || W))) : 0;
    const usable = H - hud;
    const halves: { rect: Rect; distort: boolean }[] = s.compare
      ? [
          { rect: { x: 0, y: 0, w: W, h: H / 2 }, distort: false },
          { rect: { x: 0, y: H / 2, w: W, h: usable - H / 2 }, distort: true },
        ]
      : [{ rect: { x: 0, y: 0, w: W, h: usable }, distort: true }];

    if (s.mode === 'ring') this.ring.advance(s.ring.lines, s.ring.view, clock.dt, clock.epoch);
    for (const { rect, distort } of halves) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      this.load = 1;
      if (s.mode === 'ring') this.ring.draw(ctx, rect, s.ring.lines, s.ring.view, s.ring.selected, distort, ringItems);
      else if (s.mode === 'repeat') this.drawRepeat(ctx, rect, s, clock, distort);
      else if (s.mode === 'single') this.drawSingle(ctx, rect, itemsFromInput(s), s.input, { kind: 'loop', fx: clock.fx, offset: 0 }, distort);
      else this.drawDemo(ctx, rect, s, clock, distort);
      ctx.restore();
    }
    if (s.compare) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, Math.round(H / 2), W, Math.max(1, Math.round(H / 600)));
    }
  }

  private drawDemo(ctx: CanvasRenderingContext2D, rect: Rect, s: SceneState, clock: Clock, distort: boolean) {
    const cur = lineAt(s.lyrics, clock.time);
    if (!cur) return;
    const { line, index, local } = cur;
    const items: Item[] = [...line.text].map((ch) => ({ ch, style: null }));
    let speed = 1;
    for (const em of line.emphasis) {
      const preset = s.presets[em.tag];
      const effect = EFFECTS[em.effect ?? preset.effect];
      const params: EffectParams = {
        intensity: clamp(preset.intensity * (em.intensity ?? 1), 0, 1.2),
        speed: preset.speed,
        range: preset.range,
        direction: preset.direction,
        tail: preset.tail,
        origin: preset.origin,
        sharp: preset.sharp,
        spin: preset.spin,
      };
      speed = preset.speed;
      const count = em.end - em.start;
      for (let i = em.start; i < em.end && i < items.length; i++) items[i].style = { effect, params, index: i - em.start, count };
    }
    this.drawSingle(ctx, rect, items, `demo|${line.id}|${line.text}`, { kind: 'once', local, t: clock.time * speed, cycle: index }, distort);
  }

  private drawSingle(ctx: CanvasRenderingContext2D, rect: Rect, items: Item[], key: string, timing: Timing, distort: boolean) {
    const fit = this.fitLayout(items, rect, key);
    const size = fit.size;
    const lines = fit.lines.map((l) => l.map((i) => items[i]));
    const pitch = size * 1.22;
    const blockH = (lines.length - 1) * pitch + size * CAP;
    let baseline = rect.y + (rect.h - blockH) / 2 + size * CAP;
    for (const line of lines) {
      this.drawLine(ctx, line, size, rect.x + rect.w / 2, baseline, 'center', timing, distort, 1, rect.w * 0.94, rect.y, rect.y + rect.h);
      baseline += pitch;
    }
  }

  private drawRepeat(ctx: CanvasRenderingContext2D, rect: Rect, s: SceneState, clock: Clock, distort: boolean) {
    const items = itemsFromInput(s).filter((it) => it.ch !== '\n');
    if (items.length === 0) return;
    const unit = items.reduce((w, it) => w + advanceOf(it.ch, 100, this.fi), 0) / 100;
    const size = clamp((rect.w * 0.42) / Math.max(0.1, unit), rect.h / 16, rect.h / 5.2);
    const pitch = size * 1.08;
    const stride = unit * size + size * 0.9;
    const rows = Math.ceil(rect.h / pitch) + 2;
    const cols = Math.ceil(rect.w / stride) + 2;
    const x0 = rect.x - stride * 0.38;
    this.load = Math.max(1, rows * cols * items.filter((it) => it.style).length);
    for (let r = 0; r < rows; r++) {
      const baseline = rect.y + size * CAP + (r - 0.35) * pitch;
      for (let c = 0; c < cols; c++) {
        // 반복된 문장마다 위상과 시드를 다르게 → 변형의 리듬과 차이가 보인다
        const timing: Timing = { kind: 'loop', fx: clock.fx, offset: -(r * 0.085 + c * 0.033) };
        this.drawLine(ctx, items, size, x0 + c * stride, baseline, 'left', timing, distort, 1 + r * 7 + c * 131, stride * 1.25, -Infinity, Infinity);
      }
    }
  }

  private drawLine(
    ctx: CanvasRenderingContext2D,
    line: Item[],
    size: number,
    ax: number,
    baseline: number,
    align: 'center' | 'left',
    timing: Timing,
    distort: boolean,
    instance: number,
    room: number,
    topBound: number,
    bottom: number,
    radius = 0,
  ): number {
    const glyphs = line.map((it) => this.cache.get(it.ch, size));
    const vfit = clamp((bottom - baseline) / (size * 1.5), 0.2, 1);
    const tfit = clamp((baseline - size * CAP - topBound) / (size * 0.8), 0.2, 1);
    const states = line.map((it, i) => (distort && it.style ? stateFor(it, glyphs[i], timing, instance, i, vfit, tfit, stepFor(glyphs[i], this.load), radius > 0 ? radius : size * 3) : null));
    const extraOf = () => states.map((st) => (st && st.effect.extraAdvance ? st.effect.extraAdvance(st.frame) : 0));
    let extra = extraOf();
    const base = glyphs.reduce((a, g) => a + g.advance, 0);
    const sumExtra = extra.reduce((a, b) => a + b, 0);
    // 늘어난 폭이 남은 여백을 넘으면 늘어나는 길이 자체를 줄인다 (그리는 쪽과 같은 값 사용)
    if (sumExtra > room - base && sumExtra > 0) {
      const fit = Math.max(0.15, (room - base) / sumExtra);
      for (const st of states) if (st) st.frame.fit = fit;
      extra = extraOf();
    }
    const adv = glyphs.map((g, i) => g.advance + extra[i]);
    const total = adv.reduce((a, b) => a + b, 0);
    let pen = align === 'center' ? ax - total / 2 : ax;
    const top = Math.round(baseline - size * BASE);
    for (let i = 0; i < line.length; i++) {
      const g = glyphs[i];
      if (!g.space) {
        const x = Math.round(pen - g.pad);
        const st = states[i];
        if (st) st.effect.draw({ ...st.frame, ctx, x, y: top });
        else ctx.drawImage(g.canvas, x, top);
      }
      pen += adv[i];
    }
    return total;
  }

  private fitLayout(items: Item[], rect: Rect, key: string) {
    const memoKey = `${key}|${Math.round(rect.w)}x${Math.round(rect.h)}`;
    const hit = this.layoutMemo.get(memoKey);
    if (hit) return hit;
    const maxW = rect.w * 0.78;
    const maxH = rect.h * 0.62;
    let lo = 8;
    let hi = Math.max(lo + 1, rect.h * 0.42);
    const indexed = items.map((it, i) => ({ ...it, i }));
    let best = { size: lo, lines: wrap(indexed, lo, maxW, this.fi) };
    for (let it = 0; it < 14; it++) {
      const mid = (lo + hi) / 2;
      const lines = wrap(indexed, mid, maxW, this.fi);
      const widest = Math.max(...lines.map((l) => lineWidth(l, mid, this.fi)));
      const h = (lines.length - 1) * mid * 1.22 + mid * CAP;
      if (widest <= maxW && h <= maxH) {
        best = { size: mid, lines };
        lo = mid;
      } else hi = mid;
    }
    const out = { size: best.size, lines: best.lines.map((l) => l.map((it) => it.i)) };
    if (this.layoutMemo.size > 50) this.layoutMemo.clear();
    this.layoutMemo.set(memoKey, out);
    return out;
  }
}

function stateFor(it: Item, g: ReturnType<GlyphCache['get']>, timing: Timing, instance: number, pos: number, vfit: number, tfit: number, step: number, radius: number) {
  const st = it.style!;
  const { effect, params, index, count } = st;
  let phase: number;
  let cycle: number;
  let t: number;
  if (timing.kind === 'loop') {
    const cp = timing.fx / effect.cycle + timing.offset - index * effect.stagger;
    cycle = Math.floor(cp);
    phase = fract(cp);
    t = timing.fx;
  } else {
    // 가사 한 줄 안에서: 원형 → 변형 → 유지 → 복귀 를 한 번 수행
    phase = clamp(timing.local * (1 + effect.stagger * count) - index * effect.stagger, 0, 1);
    cycle = timing.cycle;
    t = timing.t;
  }
  const seed = instance * 7919 + (pos + 1) * 131 + it.ch.charCodeAt(0);
  return { effect, frame: { g, phase, cycle, t, p: params, seed, index, count, fit: 1, vfit, tfit, step, radius } };
}

/** 링 한 줄 → 글자 목록. [대괄호] 구간에만 그 줄의 효과를 건다 */
function ringItems(l: RingLine): Item[] {
  const { text, ranges } = parseMarked(l.text);
  const effect = EFFECTS[l.effect];
  const items: Item[] = [...text].filter((ch) => ch !== '\n').map((ch) => ({ ch, style: null }));
  for (const [a, b] of ranges) {
    for (let i = a; i < b && i < items.length; i++) items[i].style = { effect, params: l.params, index: i - a, count: b - a };
  }
  return items;
}

function itemsFromInput(s: SceneState): Item[] {
  const { text, ranges } = parseMarked(s.input);
  const effect = EFFECTS[s.effect];
  const items: Item[] = [...text].map((ch) => ({ ch, style: null }));
  for (const [a, b] of ranges) {
    for (let i = a; i < b; i++) items[i].style = { effect, params: s.params, index: i - a, count: b - a };
  }
  return items;
}

function lineWidth(line: Item[], size: number, fi: FontInfo) {
  return line.reduce((w, it) => w + advanceOf(it.ch, size, fi), 0);
}

/** 공백 기준 줄바꿈 (한글 어절 단위), \n 은 강제 줄바꿈 */
export function wrap<T extends Item>(items: T[], size: number, maxW: number, fi: FontInfo): T[][] {
  const lines: T[][] = [];
  let cur: T[] = [];
  let word: T[] = [];
  const flushWord = () => {
    if (word.length === 0) return;
    const trial = [...cur, ...word];
    if (cur.length > 0 && lineWidth(trimEnd(trial), size, fi) > maxW) {
      lines.push(trimEnd(cur));
      cur = [...word];
    } else cur = trial;
    word = [];
  };
  for (const it of items) {
    if (it.ch === '\n') {
      flushWord();
      lines.push(trimEnd(cur));
      cur = [];
    } else if (it.ch === ' ') {
      flushWord();
      cur.push(it);
    } else word.push(it);
  }
  flushWord();
  if (cur.length) lines.push(trimEnd(cur));
  return lines.length ? lines : [[]];
}

function trimEnd<T extends Item>(l: T[]) {
  let e = l.length;
  while (e > 0 && l[e - 1].ch === ' ') e--;
  return l.slice(0, e);
}
