import { useCallback, useEffect, useRef, useState } from 'react';
import { ASSETS, MIX } from '../dj/config';
import { complementPalette, dominantHues, hslCss } from '../dj/graphics/palette';
import { ScoreEngine } from './audio/scoreEngine';
import { SCORE } from './config';
import { drawHighlight, drawHover, drawSparks, drawStroke, hitTest, pulse, type Deform, type Target } from './render';
import {
  attachLocalTimes,
  BRUSH_KEYS,
  BRUSH_LABEL,
  brightOf,
  inCover,
  StrokeBuilder,
  type Brush,
  type CoverSampler,
  type Stroke,
  type Vec,
} from './stroke';

const BG = '#e7e6e2';

/** 기존 요소를 누르고 있는 동안의 상태 */
interface Touch {
  pointerId: number;
  target: Target;
  st: Stroke;
  start: Vec;
  startScreen: { x: number; y: number };
  dragging: boolean;
  /** 단발 발음 시각 (끌기 반복이 이 소리와 겹치지 않게) */
  since: number;
  key: string;
  /** 지속음 계열(띠·코러스·이미지)인지 */
  sustain: boolean;
  downCtx: number;
}

interface LiveDeform extends Deform {
  vx: number;
  vy: number;
  pv: number;
  active: boolean;
}

/** 끌기 반복(롤) 간격(박): 소리 종류별 */
const ROLL_DIV: Record<string, number> = { kick: 0.5, perc: 0.5, click: 0.25, hat: 0.25, shaker: 0.25, pluck: 0.25 };
/** 변형 한계(월드 단위): 원래 형태를 알아볼 수 있는 범위 */
const MAX_DEFORM = 45;

interface View {
  w: number;
  h: number;
  dpr: number;
  cx: number;
  cy: number;
  /** 월드 1 단위의 CSS 픽셀 */
  s: number;
}

/** 공통 좌표계: 커버 중심이 화면 중심, 커버 한 변 = 짧은 변의 40% */
function makeView(w: number, h: number): View {
  const coverPx = Math.max(200, Math.min(w, h) * 0.4);
  return { w, h, dpr: window.devicePixelRatio || 1, cx: w / 2, cy: h / 2 - 28, s: coverPx / 1000 };
}

function makeSampler(img: HTMLImageElement): CoverSampler {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  return (x, y) => {
    // 커버 밖으로 나가면 가장자리 픽셀 (띠는 항상 실제 커버 색)
    const u = Math.min(W - 1.001, Math.max(0, ((x + 500) / 1000) * (W - 1)));
    const v = Math.min(H - 1.001, Math.max(0, ((y + 500) / 1000) * (H - 1)));
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    const px = (xx: number, yy: number, c: number) => d[(yy * W + xx) * 4 + c];
    const ch = (c: number) =>
      px(x0, y0, c) * (1 - fx) * (1 - fy) + px(x0 + 1, y0, c) * fx * (1 - fy) + px(x0, y0 + 1, c) * (1 - fx) * fy + px(x0 + 1, y0 + 1, c) * fx * fy;
    return [ch(0), ch(1), ch(2)];
  };
}

export default function ScoreApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<ScoreEngine | null>(null);
  const [cover, setCover] = useState<HTMLImageElement | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [songVol, setSongVol] = useState(MIX.songDefault);
  const [playVol, setPlayVol] = useState(MIX.playDefault);
  const [heldBrush, setHeldBrush] = useState<Brush | null>(null);
  const [drawingBrush, setDrawingBrush] = useState<Brush | null>(null);
  const [count, setCount] = useState(0);
  const [notice, setNotice] = useState('');
  const addError = (m: string) => setErrors((e) => (e.includes(m) ? e : [...e, m]));

  // 가변 상태는 ref 로 (매 프레임 그리기)
  const r = useRef({
    view: makeView(window.innerWidth, window.innerHeight),
    strokes: [] as Stroke[],
    live: null as { b: StrokeBuilder; pointerId: number } | null,
    nextId: 1,
    held: null as Brush | null,
    sampler: null as CoverSampler | null,
    colors: { arc: '#5b3fc4', hatch: '#2d5fb8', shape: '#1f9aa3', band: '#1f9aa3', circle: '#2d5fb8' } as Record<string, string>,
    cache: document.createElement('canvas'),
    cacheDirty: true,
    pointer: { x: 0, y: 0 },
    touch: null as Touch | null,
    deforms: new Map<number, LiveDeform>(),
    hover: null as Target | null,
    /** 스트로크별 마지막 클릭 재연주 시각 (점광 반짝임용, performance 초) */
    flash: new Map<number, number>(),
    liveFlash: 0,
  }).current;

  // ---- 자원 불러오기 ----
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      r.sampler = makeSampler(img);
      // 기존 보색 팔레트: 커버 대표 유채색의 색상각 + 180°. 밝은 배경과 어두운 커버 양쪽에서 보이도록 명도 0.42
      const cv = document.createElement('canvas');
      cv.width = cv.height = 120;
      const g = cv.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, 120, 120);
      const pal = complementPalette(dominantHues(g.getImageData(0, 0, 120, 120).data, 3)).map((e) =>
        hslCss({ h: e.color.h, s: 0.85, l: 0.42 }),
      );
      const at = (i: number) => pal[i % pal.length];
      r.colors = { band: at(0), shape: at(0), hatch: at(1), arc: at(2), circle: at(1), choir: at(2) };
      r.cacheDirty = true;
      setCover(img);
    };
    img.onerror = () => addError(`커버 이미지 파일이 없습니다: public${ASSETS.cover}`);
    img.src = ASSETS.cover;
  }, [r]);

  useEffect(() => {
    let alive = true;
    let made: ScoreEngine | null = null;
    (async () => {
      try {
        const head = await fetch(ASSETS.song, { method: 'HEAD' });
        if (!head.ok || (head.headers.get('content-type') ?? '').includes('text/html'))
          throw new Error(`음원 파일이 없습니다: public${ASSETS.song}`);
        made = await ScoreEngine.load(ASSETS.song);
        if (!alive) return made.dispose();
        made.dj.setOnEnded(() => {
          made?.pause();
          setPlaying(false);
        });
        setEngine(made);
        if (import.meta.env.DEV) Object.assign(window, { __score: made, __scoreState: r });
      } catch (err) {
        if (alive) addError((err as Error).message || '음원을 디코딩하지 못했습니다');
      }
    })();
    return () => {
      alive = false;
      made?.dispose();
    };
  }, [r]);

  useEffect(() => engine?.dj.setSongVolume(songVol), [engine, songVol]);
  useEffect(() => engine?.dj.setPlayVolume(playVol), [engine, playVol]);

  // ---- 화면 크기 ----
  useEffect(() => {
    const onResize = () => {
      r.view = makeView(window.innerWidth, window.innerHeight);
      r.cacheDirty = true;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [r]);

  const toWorld = (cx: number, cy: number): Vec => {
    const v = r.view;
    return { x: (cx - v.cx) / v.s, y: (cy - v.cy) / v.s };
  };

  // ---- 그리기 루프 ----
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (nowMs: number) => {
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      raf = requestAnimationFrame(frame);
      // 창 크기가 바뀌었는데 resize 이벤트를 놓친 경우(숨겨진 탭 등)도 공통 좌표계를 다시 맞춘다
      if (window.innerWidth !== r.view.w || window.innerHeight !== r.view.h) {
        r.view = makeView(window.innerWidth, window.innerHeight);
        r.cacheDirty = true;
      }
      const cv = canvasRef.current;
      const v = r.view;
      if (cv && v.w > 0 && v.h > 0) {
        const pw = Math.round(v.w * v.dpr);
        const ph = Math.round(v.h * v.dpr);
        if (cv.width !== pw || cv.height !== ph) {
          cv.width = pw;
          cv.height = ph;
          r.cacheDirty = true;
        }
        const g = cv.getContext('2d')!;
        const world = (ctx: CanvasRenderingContext2D) => ctx.setTransform(v.dpr * v.s, 0, 0, v.dpr * v.s, v.dpr * v.cx, v.dpr * v.cy);

        // 확정된 스트로크는 정적 레이어에 한 번만 그린다 (재생 중에는 강조만 위에 덧그림 — 그림을 복제하지 않음)
        if (r.cacheDirty) {
          r.cache.width = pw;
          r.cache.height = ph;
          const cg = r.cache.getContext('2d')!;
          world(cg);
          // 변형 중인 스트로크는 정적 레이어에서 빼고 매 프레임 따로 그린다
          for (const st of r.strokes) if (!r.deforms.has(st.id)) drawStroke(cg, st);
          r.cacheDirty = false;
        }

        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = BG;
        g.fillRect(0, 0, pw, ph);
        world(g);
        const bands = engine ? engine.dj.updateBands(dt) : null;
        if (cover) {
          // 저음에 아주 약하게 반응하는 그림자 (커버 위치·크기는 그대로)
          g.save();
          g.shadowColor = 'rgba(0,0,0,0.28)';
          g.shadowBlur = (24 + 26 * (bands?.low ?? 0)) * v.s * v.dpr;
          g.shadowOffsetY = 10 * v.s * v.dpr;
          g.drawImage(cover, -500, -500, 1000, 1000);
          g.restore();
        }
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(r.cache, 0, 0);
        world(g);

        // 기존 요소 변형: 스프링으로 떨림·복원
        const nowS = nowMs / 1000;
        for (const [id, d] of r.deforms) {
          for (let k = 0; k < 4; k++) {
            const h = dt / 4;
            d.pv += (-320 * d.pulse - 11 * d.pv) * h;
            d.pulse += d.pv * h;
            if (!d.active) {
              d.vx += (-200 * d.dx - 13 * d.vx) * h;
              d.vy += (-200 * d.dy - 13 * d.vy) * h;
              d.dx += d.vx * h;
              d.dy += d.vy * h;
            }
          }
          const st = r.strokes.find((x) => x.id === id);
          const settled = Math.abs(d.pulse) + Math.abs(d.pv) * 0.05 < 0.01 && Math.hypot(d.dx, d.dy) + Math.hypot(d.vx, d.vy) * 0.05 < 0.3;
          if (!st || (!d.active && settled)) {
            r.deforms.delete(id);
            r.cacheDirty = true;
            if (st) drawStroke(g, st);
            continue;
          }
          drawStroke(g, st, d);
        }

        // 루프 재생 강조
        const audible = engine ? engine.dj.audibleTime() : 0;
        for (const st of r.strokes) {
          let age = Infinity;
          const fl = r.flash.get(st.id);
          if (fl != null) age = nowS - fl;
          if (engine && engine.playing && st.audio) {
            const T = engine.occurrenceAt(st.audio, audible);
            if (T != null && audible >= engine.playFrom) {
              const local = audible - T;
              drawHighlight(g, st, local, engine.L);
              // 점광: 이 스트로크의 소리가 시작되는 순간(지속음 시작·타격) 반짝임
              let onset = st.sustain ? 0 : -Infinity;
              for (const e of st.elems) if (e.local != null && e.local <= local && e.local > onset) onset = e.local;
              if (onset > -Infinity) age = Math.min(age, local - onset);
            }
          }
          drawSparks(g, st, age);
        }
        if (engine && engine.playing && meterRef.current) meterRef.current.style.setProperty('--pos', String(engine.loopPosAt(audible) / engine.L));

        // 호버: 어떤 요소가 선택될지
        if (r.hover && !r.touch && !r.live) {
          const st = r.strokes.find((x) => x.id === r.hover!.stroke);
          if (st) drawHover(g, st, r.hover);
        }

        // 그리는 중인 스트로크
        const live = r.live?.b.stroke;
        if (live) {
          drawStroke(g, live);
          for (const e of live.elems) {
            const k = 1 - (nowS - e.born) / 0.28;
            if (k > 0 && e.hit) pulse(g, e, live.color, k);
          }
          if (live.brush === 'ribbon' || live.brush === 'band' || live.brush === 'choir') drawHighlight(g, live, live.duration, 1e9);
          drawSparks(g, live, nowS - r.liveFlash);
        }

        // 브러시 표시 (커서 옆)
        const badge = badgeRef.current;
        if (badge) {
          const b = r.live?.b.brush ?? r.held;
          badge.style.opacity = b ? '1' : '0';
          badge.style.transform = `translate(${r.pointer.x + 16}px, ${r.pointer.y + 14}px)`;
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine, cover, r]);

  // ---- 그리는 동안 일정 간격: 멈춰 있을 때 속도 감소, 지속음 파라미터 기록 ----
  useEffect(() => {
    const id = window.setInterval(() => {
      const l = r.live;
      if (!l || !engine) return;
      const t = engine.ctx.currentTime - l.b.stroke.startTime;
      const out = l.b.idle(t, performance.now() / 1000);
      for (const e of out.spawned) engine.hitNow(e.hit!, brightOf(e.y));
      if (out.spawned.length) r.liveFlash = performance.now() / 1000;
      if (l.b.stroke.sustain) {
        const p = l.b.sustainParams();
        engine.liveSustainUpdate(p);
        l.b.recordAuto(t, p);
      }
      // 너무 긴 스트로크는 자동 확정
      if (t > SCORE.maxLoopsPerStroke * engine.L) finish(l.pointerId, false);
    }, 30);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, r]);

  // ---- 입력 ----
  // ---- 기존 요소 재연주 ----
  const touchParams = (t: Touch, p: Vec): [number, number, number] => {
    const drag01 = Math.min(1, Math.hypot(p.x - t.start.x, p.y - t.start.y) / 220);
    const b = brightOf(p.y);
    const kind = t.st.sustain!.kind;
    if (kind === 'choir') return [900 * Math.pow(2, b * 3.2), 0.42, 0.7];
    if (kind === 'band') return [260 * Math.pow(2, b * 4.5 + drag01 * 1.5), 0.2 + 0.3 * drag01, 2 + 6 * drag01];
    return [700 * Math.pow(2, drag01 * 4), 0.38 + 0.2 * drag01, 1 + 4 * drag01];
  };

  const startTouch = (e: React.PointerEvent<HTMLCanvasElement>, target: Target, p: Vec) => {
    if (!engine) return;
    const st = r.strokes.find((x) => x.id === target.stroke);
    if (!st) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 합성 이벤트 등 */
    }
    // 같은 그림을 복제하지 않고, 원래 스트로크에 일시적 변형만 건다
    const d = r.deforms.get(st.id) ?? { target, dx: 0, dy: 0, pulse: 0, vx: 0, vy: 0, pv: 0, active: true };
    d.target = target;
    d.active = true;
    d.pv -= 14;
    if (!r.deforms.has(st.id)) r.cacheDirty = true;
    r.deforms.set(st.id, d);
    r.flash.set(st.id, performance.now() / 1000);
    const t: Touch = {
      pointerId: e.pointerId,
      target,
      st,
      start: p,
      startScreen: { x: e.clientX, y: e.clientY },
      dragging: false,
      since: 0,
      key: `touch:${e.pointerId}`,
      sustain: target.kind !== 'elem',
      downCtx: engine.ctx.currentTime,
    };
    if (target.kind === 'elem') {
      const el = st.elems[target.idx];
      t.since = engine.hitNow(el.hit!, brightOf(el.y)); // 즉시 한 번
    } else {
      // 지속음 계열: 누르는 순간부터 하나의 소리. 짧게 떼면 짧은 효과음, 끌면 이어서 변형 (발음은 한 번뿐)
      engine.liveSustainStart(st.sustain!.kind, st.sustain!.slice, touchParams(t, p));
    }
    r.touch = t;
  };

  const moveTouch = (t: Touch, e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!engine) return;
    const p = toWorld(e.clientX, e.clientY);
    const d = r.deforms.get(t.st.id);
    // 클릭과 드래그는 화면 이동 거리로 구분 (6px)
    if (!t.dragging && Math.hypot(e.clientX - t.startScreen.x, e.clientY - t.startScreen.y) > 6) {
      t.dragging = true;
      if (t.target.kind === 'elem') {
        const el = t.st.elems[t.target.idx];
        engine.startRoll(t.key, el.hit!, brightOf(p.y), ROLL_DIV[el.hit!] ?? 0.25, t.since);
      }
    }
    if (!t.dragging) return;
    let dx = p.x - t.start.x;
    let dy = p.y - t.start.y;
    const len = Math.hypot(dx, dy);
    if (len > MAX_DEFORM) {
      dx *= MAX_DEFORM / len;
      dy *= MAX_DEFORM / len;
    }
    if (d) {
      d.dx = dx;
      d.dy = dy;
    }
    if (t.target.kind === 'elem') {
      const el = t.st.elems[t.target.idx];
      engine.setRoll(t.key, brightOf(p.y), ROLL_DIV[el.hit!] ?? 0.25);
    } else engine.liveSustainUpdate(touchParams(t, p));
  };

  const endTouch = useCallback(
    (cancelled: boolean) => {
      const t = r.touch;
      if (!t || !engine) return;
      r.touch = null;
      if (t.sustain) {
        // 짧은 클릭도 너무 짧게 끊기지 않도록 최소 길이
        const minLen = t.st.sustain?.kind === 'choir' ? 0.45 : 0.22;
        engine.liveSustainStop(cancelled ? 0.04 : t.dragging ? 0.2 : 0.15, cancelled ? 0 : t.downCtx + minLen);
      } else engine.stopRoll(t.key);
      const d = r.deforms.get(t.st.id);
      if (d) d.active = false; // 놓으면 복원
    },
    [engine, r],
  );

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!engine || e.button > 0 || r.live || r.touch) return;
    const p = toWorld(e.clientX, e.clientY);
    // 숫자키 없이 기존 그래픽을 누르면 재연주 (숫자키를 누르고 있으면 그 위에도 새로 그린다)
    if (!r.held) {
      const target = hitTest(r.strokes, p, 10 / r.view.s);
      if (target) {
        startTouch(e, target, p);
        return;
      }
    }
    const brush: Brush | null = r.held ?? (inCover(p) ? 'ribbon' : null);
    if (!brush) return;
    if (r.strokes.length >= SCORE.maxStrokes) {
      setNotice(`스트로크는 ${SCORE.maxStrokes}개까지 쌓을 수 있어요. 실행 취소나 전체 지우기를 써 주세요.`);
      return;
    }
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 합성 이벤트 등 */
    }
    const startTime = engine.ctx.currentTime;
    const color = brush === 'shape' ? r.colors.shape : (r.colors[brush] ?? '#333');
    const b = new StrokeBuilder(r.nextId++, brush, p, startTime, color, engine.dj.spb, r.sampler, engine.ribbonSlices.length);
    r.live = { b, pointerId: e.pointerId };
    r.liveFlash = performance.now() / 1000;
    setDrawingBrush(brush);
    const out = b.begin(performance.now() / 1000);
    for (const el of out.spawned) engine.hitNow(el.hit!, brightOf(el.y));
    if (b.stroke.sustain) {
      const prm = b.sustainParams();
      engine.liveSustainStart(b.stroke.sustain.kind, b.stroke.sustain.slice, prm);
      b.recordAuto(0, prm);
    }
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    r.pointer = { x: e.clientX, y: e.clientY };
    if (r.touch) {
      if (r.touch.pointerId === e.pointerId) moveTouch(r.touch, e);
      return;
    }
    if (!r.live) {
      // 호버 표시 (소리는 나지 않음)
      const p = toWorld(e.clientX, e.clientY);
      r.hover = r.held ? null : hitTest(r.strokes, p, 10 / r.view.s);
      e.currentTarget.style.cursor = r.hover ? 'pointer' : !r.held && inCover(p) ? 'grab' : 'crosshair';
    }
    const l = r.live;
    if (!l || l.pointerId !== e.pointerId || !engine) return;
    const t = engine.ctx.currentTime - l.b.stroke.startTime;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const pts = events.length ? events : [e.nativeEvent];
    for (const pe of pts) {
      const out = l.b.add(toWorld(pe.clientX, pe.clientY), t, performance.now() / 1000);
      for (const el of out.spawned) engine.hitNow(el.hit!, brightOf(el.y));
      if (out.spawned.length) r.liveFlash = performance.now() / 1000;
    }
    if (l.b.stroke.sustain) engine.liveSustainUpdate(l.b.sustainParams());
  };

  /** 놓기 = 확정(다음 루프부터 반복). 취소 = 미완성 입력 폐기 */
  const finish = useCallback(
    (pointerId: number, cancelled: boolean) => {
      const l = r.live;
      if (!l || l.pointerId !== pointerId || !engine) return;
      r.live = null;
      setDrawingBrush(null);
      const b = l.b;
      const st = b.stroke;
      const t = engine.ctx.currentTime - st.startTime;
      if (!cancelled) b.end(t, performance.now() / 1000);
      if (st.sustain) {
        const prm = b.sustainParams();
        b.recordAuto(t, [prm[0], prm[1], prm[2]]);
        // 놓으면 짧게 잦아든다 (루프 재생에서도 같은 길이로)
        engine.liveSustainStop(cancelled ? 0.04 : 0.25);
      }
      if (cancelled) return;
      const hasSomething = st.sustain ? st.path.length > 2 : st.elems.some((x) => x.hit);
      if (!hasSomething) return;
      st.duration = t;
      st.audio = engine.commit(st.id, st.startTime, t, b.hits, st.sustain ? b.auto : null, st.sustain);
      attachLocalTimes(st);
      r.strokes.push(st);
      r.cacheDirty = true;
      setCount(r.strokes.length);
      setNotice('');
    },
    [engine, r],
  );

  const undo = useCallback(() => {
    const st = r.strokes.pop();
    if (!st || !engine) return;
    if (r.touch?.st.id === st.id) endTouch(true);
    engine.remove(st.id); // 연결된 소리·예약 이벤트까지 함께 제거 (글자·점광은 스트로크 데이터라 함께 사라짐)
    r.deforms.delete(st.id);
    r.flash.delete(st.id);
    r.hover = null;
    r.cacheDirty = true;
    setCount(r.strokes.length);
  }, [engine, r, endTouch]);

  const clearAll = useCallback(() => {
    if (r.touch) endTouch(true);
    engine?.clear();
    r.deforms.clear();
    r.flash.clear();
    r.hover = null;
    r.strokes = [];
    r.cacheDirty = true;
    setCount(0);
  }, [engine, r, endTouch]);

  const toggle = useCallback(async () => {
    if (!engine) return;
    if (engine.playing) {
      engine.pause();
      setPlaying(false);
    } else {
      await engine.play();
      setPlaying(true);
    }
  }, [engine]);

  // ---- 키보드: 숫자키 = 브러시, Space = 재생, ⌘/Ctrl+Z = 실행 취소 ----
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const b = BRUSH_KEYS[e.key];
      if (b && !e.metaKey && !e.ctrlKey) {
        r.held = b;
        setHeldBrush(b);
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) void toggle();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    const up = (e: KeyboardEvent) => {
      // 드래그 중 키를 놓아도 이미 시작한 스트로크의 브러시는 그대로
      if (BRUSH_KEYS[e.key] && r.held === BRUSH_KEYS[e.key]) {
        r.held = null;
        setHeldBrush(null);
      }
    };
    const blur = () => {
      r.held = null;
      setHeldBrush(null);
      if (r.live) finish(r.live.pointerId, true);
      if (r.touch) endTouch(true);
      engine?.cancelLive();
    };
    const vis = () => document.hidden && blur();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [engine, finish, endTouch, toggle, undo, r]);

  const t = engine?.dj.tempo;
  const shown = drawingBrush ?? heldBrush;

  return (
    <div className="score">
      <canvas
        ref={canvasRef}
        className="score-canvas"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={(e) => {
          if (r.touch?.pointerId === e.pointerId) endTouch(false);
          else finish(e.pointerId, false);
        }}
        onPointerCancel={(e) => {
          if (r.touch?.pointerId === e.pointerId) endTouch(true);
          else finish(e.pointerId, true);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div ref={badgeRef} className="score-badge">
        {shown ? `${shown === 'ribbon' ? '드래그' : Object.entries(BRUSH_KEYS).find(([, v]) => v === shown)?.[0]} · ${BRUSH_LABEL[shown]}` : ''}
      </div>

      <div className="score-bar">
        <button className="score-play" onClick={toggle} disabled={!engine} aria-label={playing ? '일시정지' : '재생'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="score-loop" ref={meterRef} title="4마디 루프">
          <i />
          <i />
          <i />
          <i />
          <b />
        </div>
        <button onClick={undo} disabled={!count}>
          실행 취소
        </button>
        <button onClick={clearAll} disabled={!count}>
          전체 지우기
        </button>
        <label>
          원곡
          <input type="range" min={0} max={1} step={0.01} value={songVol} onChange={(e) => setSongVol(+e.target.value)} />
        </label>
        <label>
          연주
          <input type="range" min={0} max={1.2} step={0.01} value={playVol} onChange={(e) => setPlayVol(+e.target.value)} />
        </label>
        {t && (
          <span className="score-tempo" title={t.ambiguous ? '반박/두 배 BPM 가능성 있음' : '원곡에서 추정한 박자'}>
            {t.bpm.toFixed(1)} BPM{t.source === 'auto' ? ' 추정' : ''} · 4/4 · 4마디
          </span>
        )}
      </div>

      <ul className="score-keys">
        <li className={shown === 'ribbon' ? 'on' : ''}>
          <kbd>드래그</kbd> 커버를 당겨 이미지 띠
        </li>
        {Object.entries(BRUSH_KEYS).map(([k, b]) => (
          <li key={k} className={shown === b ? 'on' : ''}>
            <kbd>{k}</kbd>+드래그 {BRUSH_LABEL[b]}
          </li>
        ))}
        <li>
          <kbd>Space</kbd> 재생 <kbd>⌘Z</kbd> 취소
        </li>
      </ul>

      {(notice || errors.length > 0) && (
        <div className="score-errors" role="alert">
          {notice && <p>{notice}</p>}
          {errors.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}
      {!engine && !errors.length && <div className="score-loading">음원 분석 중…</div>}
    </div>
  );
}
