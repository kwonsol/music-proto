import { useCallback, useEffect, useRef, useState } from 'react';
import { ASSETS, MIX } from '../dj/config';
import { ScoreEngine } from './audio/scoreEngine';
import { SCORE } from './config';
import { IMG, loadImages } from './assets';
import { drawSpray, sprayFlowing } from './hiphop';
import { KPAL, MODES, modeById, type ModeId } from './modes';
import { drawHighlight, drawHover, drawSparks, drawStroke, hitTest, pulse, type Deform, type Target } from './render';
import { attachLocalTimes, brightOf, H_SIZE, StrokeBuilder, type Brush, type Stroke, type Vec } from './stroke';

const BG = '#ffffff';

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
  /** 지속음 계열(실선·사각 점선·큰 원)인지 */
  sustain: boolean;
  downCtx: number;
  /** 레코드 스크래치: 가로 속도 */
  lastX: number;
  lastT: number;
  vx: number;
}

interface LiveDeform extends Deform {
  vx: number;
  vy: number;
  pv: number;
  active: boolean;
}

/** 끌기 반복(롤) 간격(박): 소리 종류별 */
const ROLL_DIV: Record<string, number> = {
  kick: 0.5,
  perc: 0.5,
  click: 0.25,
  hat: 0.25,
  shaker: 0.25,
  pluck: 0.25,
  fmkey: 0.5,
  drop: 0.25,
  ehat: 0.25,
  tick: 0.25,
  ekick: 0.5,
  eclap: 0.5,
  cheer: 0.5,
};
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

/** 공통 좌표계: 오른쪽 캔버스 중심이 원점, 짧은 변 = 1000 단위. 창 크기가 바뀌어도 그림의 상대 위치 유지 */
function makeView(w: number, h: number): View {
  return { w, h, dpr: window.devicePixelRatio || 1, cx: w / 2, cy: h / 2, s: Math.max(1, Math.min(w, h)) / 1000 };
}

/** 모드마다 따로 보관하는 그림·루프 데이터 */
interface ModeStore {
  strokes: Stroke[];
}

export default function ScoreApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  // 모드마다 자기 음악을 가진 엔진 (소리가 겹치지 않도록 한 번에 하나만 재생)
  const [engines, setEngines] = useState<Partial<Record<ModeId, ScoreEngine>>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [coverOk, setCoverOk] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [songVol, setSongVol] = useState(MIX.songDefault);
  const [playVol, setPlayVol] = useState(MIX.playDefault);
  const [mode, setMode] = useState<ModeId>('kandinsky');
  const [heldBrush, setHeldBrush] = useState<Brush | null>(null);
  const [drawingBrush, setDrawingBrush] = useState<Brush | null>(null);
  const [count, setCount] = useState(0);
  const [notice, setNotice] = useState('');
  const addError = (m: string) => setErrors((e) => (e.includes(m) ? e : [...e, m]));
  const modeDef = modeById(mode);
  const engine = engines[mode] ?? null;
  const coverPrevRef = useRef<HTMLImageElement>(null);

  // 가변 상태는 ref 로 (매 프레임 그리기)
  const r = useRef({
    view: makeView(1, 1),
    mode: 'kandinsky' as ModeId,
    stores: new Map<ModeId, ModeStore>(MODES.map((m) => [m.id, { strokes: [] }])),
    strokes: [] as Stroke[],
    live: null as { b: StrokeBuilder; pointerId: number } | null,
    nextId: 1,
    held: null as Brush | null,
    cache: document.createElement('canvas'),
    cacheDirty: true,
    pointer: { x: 0, y: 0 },
    touch: null as Touch | null,
    deforms: new Map<number, LiveDeform>(),
    hover: null as Target | null,
    /** 스트로크별 마지막 클릭 재연주 시각 (performance 초) */
    flash: new Map<number, number>(),
    liveFlash: 0,
    /** 방울이 아직 흐르는 스프레이 (정적 레이어 대신 매 프레임 그림) */
    flowing: new Set<number>(),
  }).current;
  r.strokes = r.stores.get(r.mode)!.strokes;

  // ---- 이미지: 커버·환호 인물·레코드 (첨부 이미지의 흰 배경 제거) ----
  useEffect(() => {
    void loadImages().then((errs) => {
      errs.forEach(addError);
      r.cacheDirty = true;
    });
  }, [r]);

  // ---- 음원: 모드별 음악을 각각 불러와 분석 ----
  useEffect(() => {
    let alive = true;
    const made: ScoreEngine[] = [];
    for (const m of MODES) {
      if (!m.song) continue;
      const url = m.song;
      (async () => {
        try {
          const head = await fetch(url, { method: 'HEAD' });
          if (!head.ok || (head.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`음원 파일이 없습니다: public${url}`);
          const eng = await ScoreEngine.load(url);
          if (!alive) return eng.dispose();
          made.push(eng);
          eng.dj.setOnEnded(() => {
            eng.pause();
            if (r.mode === m.id) setPlaying(false);
          });
          setEngines((cur) => ({ ...cur, [m.id]: eng }));
          if (import.meta.env.DEV) {
            const w = window as unknown as { __engines?: Record<string, ScoreEngine>; __scoreState?: unknown };
            w.__engines = { ...(w.__engines ?? {}), [m.id]: eng };
            w.__scoreState = r;
          }
        } catch (err) {
          if (alive) addError((err as Error).message || '음원을 디코딩하지 못했습니다');
        }
      })();
    }
    return () => {
      alive = false;
      made.forEach((e) => e.dispose());
    };
  }, [r]);

  useEffect(() => Object.values(engines).forEach((e) => e?.dj.setSongVolume(songVol)), [engines, songVol]);
  useEffect(() => Object.values(engines).forEach((e) => e?.dj.setPlayVolume(playVol)), [engines, playVol]);

  const toWorld = (cx: number, cy: number): Vec => {
    // 화면 프레임이 아직 돌지 않았어도(백그라운드 탭 등) 입력 좌표가 어긋나지 않게 크기를 바로 맞춘다
    const area = areaRef.current;
    if (area && (area.clientWidth !== r.view.w || area.clientHeight !== r.view.h)) {
      r.view = makeView(area.clientWidth, area.clientHeight);
      r.cacheDirty = true;
    }
    const v = r.view;
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (cx - rect.left - v.cx) / v.s, y: (cy - rect.top - v.cy) / v.s };
  };

  // ---- 그리기 루프 ----
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (nowMs: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      // 오른쪽 캔버스 영역 크기를 따라 공통 좌표계를 맞춘다
      const area = areaRef.current;
      if (area && (area.clientWidth !== r.view.w || area.clientHeight !== r.view.h)) {
        r.view = makeView(area.clientWidth, area.clientHeight);
        r.cacheDirty = true;
      }
      const cv = canvasRef.current;
      const v = r.view;
      if (!cv || v.w < 2 || v.h < 2) return;
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
        const nowC = performance.now() / 1000;
        r.flowing.clear();
        for (const st of r.strokes) {
          if (st.brush === 'ribbon' || r.deforms.has(st.id)) continue;
          if (sprayFlowing(st, nowC)) {
            r.flowing.add(st.id);
            continue;
          }
          drawStroke(cg, st);
        }
        r.cacheDirty = false;
      }

      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = BG;
      g.fillRect(0, 0, pw, ph);
      if (engine) engine.dj.updateBands(dt);
      g.drawImage(r.cache, 0, 0);
      world(g);

      // 기존 요소 변형: 스프링으로 떨림·복원
      const nowS = nowMs / 1000;
      // 흐르는 중인 스프레이 방울: 다 흐르면 정적 레이어로
      for (const id of r.flowing) {
        const st = r.strokes.find((x) => x.id === id);
        if (!st) continue;
        drawSpray(g, st, nowS);
        if (!sprayFlowing(st, nowS)) r.cacheDirty = true;
      }
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
        if (st.brush === 'ribbon') continue; // 칸딘스키 모드: 커버 스트레치는 그리거나 발음하지 않음
        let age = Infinity;
        const fl = r.flash.get(st.id);
        if (fl != null) age = nowS - fl;
        if (engine && engine.playing && st.audio) {
          const T = engine.occurrenceAt(st.audio, audible);
          if (T != null && audible >= engine.playFrom) {
            const local = audible - T;
            drawHighlight(g, st, local, engine.L);
            let onset = st.sustain ? 0 : -Infinity;
            for (const e of st.elems) if (e.local != null && e.local <= local && e.local > onset) onset = e.local;
            if (onset > -Infinity) age = Math.min(age, local - onset);
          }
        }
        if (st.sparks.length) drawSparks(g, st, age);
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
          if (k > 0 && e.hit && (e.sounded ?? true)) pulse(g, e, live.color, k);
        }
        if (live.brush === 'kline' || live.brush === 'beads') drawHighlight(g, live, live.duration, 1e9);
        if (live.sparks.length) drawSparks(g, live, nowS - r.liveFlash);
      }

      // 1번(힙합): 키를 누르고 있으면 작은 커버가 커서를 따라다닌다 (미리보기, 저장 안 됨)
      const prev = coverPrevRef.current;
      if (prev) {
        const show = r.held === 'hcover' && !r.live;
        prev.style.opacity = show ? '0.85' : '0';
        const size = H_SIZE.cover * v.s;
        const rc = cv.getBoundingClientRect();
        prev.style.width = prev.style.height = `${size}px`;
        prev.style.transform = `translate(${r.pointer.x - rc.left - size / 2}px, ${r.pointer.y - rc.top - size / 2}px)`;
      }

      // 브러시 표시 (커서 옆)
      const badge = badgeRef.current;
      if (badge) {
        const b = r.live?.b.brush ?? r.held;
        badge.style.opacity = b ? '1' : '0';
        badge.style.transform = `translate(${r.pointer.x + 16}px, ${r.pointer.y + 14}px)`;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine, r]);

  // ---- 그리는 동안 일정 간격: 멈춰 있을 때 속도 감소, 지속음 파라미터 기록 ----
  useEffect(() => {
    const id = window.setInterval(() => {
      const l = r.live;
      if (!l || !engine) return;
      const t = engine.ctx.currentTime - l.b.stroke.startTime;
      const out = l.b.idle(t, performance.now() / 1000);
      for (const e of out.spawned) engine.hitNow(e.hit!, brightOf(e.y), e.note ?? 0);
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

  // ---- 기존 요소 재연주 ----
  const touchParams = (t: Touch, p: Vec): [number, number, number] => {
    const drag01 = Math.min(1, Math.hypot(p.x - t.start.x, p.y - t.start.y) / 220);
    const b = brightOf(p.y);
    const kind = t.st.sustain!.kind;
    if (kind === 'choir') return [900 * Math.pow(2, b * 3.2 + drag01), 0.4, 0.7];
    if (kind === 'scratch') return [Math.max(-3.5, Math.min(3.5, t.vx / 380)), 1.1, 0];
    if (kind === 'spray') return [4200 + 4200 * b, 0.34, 0.9];
    if (kind === 'fmline') return [300 * Math.pow(2, b * 4.6 + drag01 * 1.2), 0.28 + 0.15 * drag01, 0.8 + 4 * drag01];
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
    const el = target.kind === 'elem' ? st.elems[target.idx] : null;
    const t: Touch = {
      pointerId: e.pointerId,
      target,
      st,
      start: p,
      startScreen: { x: e.clientX, y: e.clientY },
      dragging: false,
      since: 0,
      key: `touch:${e.pointerId}`,
      sustain: !el?.hit,
      downCtx: engine.ctx.currentTime,
      lastX: p.x,
      lastT: performance.now() / 1000,
      vx: 0,
    };
    if (el?.hit) {
      t.since = engine.hitNow(el.hit, brightOf(el.y), el.note ?? 0); // 즉시 한 번
    } else if (st.sustain) {
      // 지속음 계열: 누르는 순간부터 하나의 소리. 짧게 떼면 짧은 효과음, 끌면 이어서 변형 (발음은 한 번뿐)
      engine.liveSustainStart(st.sustain.kind, st.sustain.slice, touchParams(t, p));
    }
    r.touch = t;
  };

  const moveTouch = (t: Touch, e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!engine) return;
    const p = toWorld(e.clientX, e.clientY);
    const d = r.deforms.get(t.st.id);
    const el = t.target.kind === 'elem' ? t.st.elems[t.target.idx] : null;
    // 레코드를 다시 잡고 앞뒤로: 가로 속도 → 스크래치 (방향이 바뀌면 재생 방향도)
    const nowP = performance.now() / 1000;
    const dtp = Math.max(0.004, nowP - t.lastT);
    t.vx += ((p.x - t.lastX) / dtp - t.vx) * Math.min(1, dtp / 0.05);
    t.lastX = p.x;
    t.lastT = nowP;
    // 클릭과 드래그는 화면 이동 거리로 구분 (6px)
    if (!t.dragging && Math.hypot(e.clientX - t.startScreen.x, e.clientY - t.startScreen.y) > 6) {
      t.dragging = true;
      if (el?.hit) engine.startRoll(t.key, el.hit, brightOf(p.y), ROLL_DIV[el.hit] ?? 0.25, t.since, el.note ?? 0);
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
    if (el?.hit) engine.setRoll(t.key, brightOf(p.y), ROLL_DIV[el.hit] ?? 0.25);
    else if (t.st.sustain) engine.liveSustainUpdate(touchParams(t, p));
  };

  const endTouch = useCallback(
    (cancelled: boolean) => {
      const t = r.touch;
      if (!t || !engine) return;
      r.touch = null;
      if (t.sustain) {
        // 짧은 클릭도 너무 짧게 끊기지 않도록 최소 길이 (스크래치는 손을 떼면 바로 멈춤)
        const kind = t.st.sustain?.kind;
        const minLen = kind === 'choir' ? 0.45 : kind === 'scratch' ? 0 : 0.25;
        engine.liveSustainStop(cancelled ? 0.04 : t.dragging ? 0.2 : 0.15, cancelled ? 0 : t.downCtx + minLen);
      } else engine.stopRoll(t.key);
      const d = r.deforms.get(t.st.id);
      if (d) d.active = false; // 놓으면 복원
    },
    [engine, r],
  );

  // ---- 입력 (오른쪽 캔버스에서만) ----
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!engine || e.button > 0 || r.live || r.touch || !modeById(r.mode).ready) return;
    const p = toWorld(e.clientX, e.clientY);
    // 숫자키 없이 기존 그래픽을 누르면 재연주 (숫자키를 누르고 있으면 그 위에도 새로 그린다)
    if (!r.held) {
      const target = hitTest(r.strokes, p, 10 / r.view.s);
      if (target) startTouch(e, target, p);
      // 칸딘스키 모드: 숫자키 없는 빈 곳 드래그는 아무것도 만들지 않는다 (커버 스트레치 없음)
      return;
    }
    const brush = r.held;
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
    const color = brush === 'beads' ? KPAL.purple : brush === 'sun' ? KPAL.yellow : KPAL.black;
    const nth = r.strokes.filter((x) => x.brush === brush).length;
    // 1번(힙합) 커버 스트레치는 커버 이미지에서 색을 읽는다
    const sampler = brush === 'hcover' ? IMG.coverSampler : null;
    const b = new StrokeBuilder(r.nextId++, brush, p, startTime, color, engine.dj.spb, sampler, engine.ribbonSlices.length, nth);
    r.live = { b, pointerId: e.pointerId };
    r.liveFlash = performance.now() / 1000;
    setDrawingBrush(brush);
    const out = b.begin(performance.now() / 1000);
    for (const el of out.spawned) engine.hitNow(el.hit!, brightOf(el.y), el.note ?? 0);
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
      r.hover = r.held || !modeById(r.mode).ready ? null : hitTest(r.strokes, p, 10 / r.view.s);
      e.currentTarget.style.cursor = r.hover ? 'pointer' : r.held ? 'crosshair' : 'default';
    }
    const l = r.live;
    if (!l || l.pointerId !== e.pointerId || !engine) return;
    const t = engine.ctx.currentTime - l.b.stroke.startTime;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const pts = events.length ? events : [e.nativeEvent];
    for (const pe of pts) {
      const out = l.b.add(toWorld(pe.clientX, pe.clientY), t, performance.now() / 1000);
      for (const el of out.spawned) engine.hitNow(el.hit!, brightOf(el.y), el.note ?? 0);
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
      const hasSomething =
        st.brush === 'hcover' || st.brush === 'hrecord' || st.brush === 'sun'
          ? true // 클릭만 해도 커버 스탬프·레코드판·큰 원이 남는다
          : st.brush === 'hspray'
            ? (st.spray?.pts.length ?? 0) > 0
            : st.brush === 'htype'
              ? st.elems.length > 0
              : st.sustain
                ? st.path.length > 2
                : st.elems.some((x) => x.hit);
      if (!hasSomething) return;
      st.duration = t;
      st.audio = engine.commit(st.id, st.startTime, t, b.hits, st.sustain ? b.auto : null, st.sustain);
      attachLocalTimes(st);
      r.strokes.push(st);
      if (st.brush === 'hspray') r.flowing.add(st.id);
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
    engine.remove(st.id); // 연결된 소리·예약 이벤트까지 함께 제거
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
    r.strokes.length = 0;
    r.cacheDirty = true;
    setCount(0);
  }, [engine, r, endTouch]);

  /**
   * 모드 전환: 모드마다 음악이 다르므로 이전 모드의 음악·지속음·예약된 연주를 정리(일시정지)하고,
   * 재생 중이었다면 새 모드의 음악을 이어서 재생한다. 그림·루프 데이터는 모드별로 보관했다가 돌아오면 그대로.
   */
  const switchMode = useCallback(
    (next: ModeId) => {
      if (next === r.mode) return;
      const prev = engines[r.mode];
      const wasPlaying = !!prev?.playing;
      if (r.live) finish(r.live.pointerId, true);
      if (r.touch) endTouch(true);
      prev?.cancelLive();
      prev?.pause();
      r.deforms.clear();
      r.flowing.clear();
      r.hover = null;
      r.held = null;
      setHeldBrush(null);
      r.mode = next;
      r.strokes = r.stores.get(next)!.strokes;
      r.cacheDirty = true;
      setCount(r.strokes.length);
      setMode(next);
      const nextEng = engines[next];
      if (wasPlaying && nextEng) void nextEng.play().then(() => setPlaying(true));
      else setPlaying(false);
    },
    [engines, r, finish, endTouch],
  );

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

  // ---- 키보드: 숫자키 = 브러시(모드별), Space = 재생, ⌘/Ctrl+Z = 실행 취소 ----
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const b = modeById(r.mode).keys[e.key];
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
      const b = modeById(r.mode).keys[e.key];
      if (b && r.held === b) {
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
  const keyOf = (b: Brush) => Object.entries(modeDef.keys).find(([, v]) => v === b)?.[0];

  return (
    <div className="score">
      {/* ---- 왼쪽: 음악 영역 ---- */}
      <aside className="score-music">
        {coverOk ? (
          <img className="score-cover" src={ASSETS.cover} alt="앨범커버" draggable={false} onError={() => (setCoverOk(false), addError(`커버 이미지 파일이 없습니다: public${ASSETS.cover}`))} />
        ) : (
          <div className="score-cover missing">커버 없음</div>
        )}
        <button className="score-play" onClick={toggle} disabled={!engine} aria-label={playing ? '일시정지' : '재생'}>
          {playing ? (
            <svg viewBox="0 0 24 24" aria-hidden>
              <rect x="6" y="5" width="4" height="14" />
              <rect x="14" y="5" width="4" height="14" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M8 5 L19 12 L8 19 Z" />
            </svg>
          )}
        </button>
        <div className="score-vols">
          <label>
            원곡
            <input type="range" min={0} max={1} step={0.01} value={songVol} onChange={(e) => setSongVol(+e.target.value)} />
          </label>
          <label>
            연주
            <input type="range" min={0} max={1.2} step={0.01} value={playVol} onChange={(e) => setPlayVol(+e.target.value)} />
          </label>
        </div>
        {t ? (
          <p className="score-tempo" title={t.ambiguous ? '반박/두 배 BPM 가능성 있음' : '원곡에서 추정한 박자'}>
            {t.bpm.toFixed(1)} BPM{t.source === 'auto' ? ' 추정' : ''} · 4/4 · 4마디 루프
          </p>
        ) : (
          !errors.length && <p className="score-tempo">음원 분석 중…</p>
        )}
      </aside>

      {/* ---- 오른쪽: 그래픽 캔버스 ---- */}
      <main className="score-area" ref={areaRef}>
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

        <nav className="score-modes" aria-label="스타일 모드">
          {MODES.map((m) => (
            <button key={m.id} className={m.id === mode ? 'on' : ''} onClick={() => switchMode(m.id)}>
              {m.label}
            </button>
          ))}
        </nav>

        {!modeDef.ready && (
          <div className="score-pending">
            <strong>{modeDef.label}</strong>
            <span>준비 중</span>
          </div>
        )}

        {modeDef.ready && (
          <>
            <div className="score-tools">
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
                지우기
              </button>
            </div>
            <ul className="score-keys">
              {Object.entries(modeDef.keys).map(([k, b]) => (
                <li key={k} className={shown === b ? 'on' : ''}>
                  <kbd>{k}</kbd>
                  {modeDef.labels[b]}
                </li>
              ))}
              <li className="hint">숫자키+드래그 그리기 · 그림 클릭 재연주</li>
            </ul>
          </>
        )}
        <img ref={coverPrevRef} className="score-cover-preview" src={ASSETS.cover} alt="" draggable={false} />
        <div ref={badgeRef} className="score-badge">
          {shown ? `${keyOf(shown)} · ${modeDef.labels[shown]}` : ''}
        </div>
      </main>

      {(notice || errors.length > 0) && (
        <div className="score-errors" role="alert">
          {notice && <p>{notice}</p>}
          {errors.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}
    </div>
  );
}
