// 앨범커버 위에 겹치는 투명 벡터 레이어. 그래픽 자체가 연주 도구다.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { DjEngine, HitId } from '../audio/engine';
import type { Bands } from '../audio/bands';
import { INPUT } from '../config';
import type { ElementColor } from './colors';
import {
  DECOR,
  ECHO,
  HATS,
  KICK,
  PERC,
  RISER,
  STUTTER_A,
  STUTTER_B,
  arcPath,
  bandCenter,
  bandPath,
  nearestT,
  polyline,
  rad,
  type Vec,
} from './geometry';

interface Spring {
  x: number;
  v: number;
}
const spring = (): Spring => ({ x: 0, v: 0 });
function stepSpring(s: Spring, k: number, c: number, dt: number) {
  s.v += (-k * s.x - c * s.v) * dt;
  s.x += s.v * dt;
}

type Active =
  | { kind: 'hit'; id: HitId; key: string; timer: number | null; t: number; start: Vec; repeating: boolean; divIdx: number }
  | { kind: 'riser'; grab: Vec }
  | { kind: 'echo'; start: Vec; fb0: number; tone0: number };

const STEPS = INPUT.stutterSteps;
const STEP_LABEL = ['1/8', '1/4', '1/2', '1'];
const DEFAULT_STEP = 2; // 1/2박

/** 리듬 요소의 길게 누르기 반복 격자 */
const REPEAT: Record<'kick' | 'perc' | 'hat', { div: number; phase: number }> = {
  kick: { div: 1, phase: 0 }, // 매 박
  perc: { div: 1, phase: 0.5 }, // 엇박
  hat: { div: 1 / 4, phase: 0 }, // 16분
};

function makeModel() {
  return {
    kick: spring(),
    perc: spring(),
    hats: HATS.map(spring),
    stA: spring(),
    stB: spring(),
    spaceA: 20,
    spaceB: 1,
    divA: DEFAULT_STEP,
    divB: DEFAULT_STEP,
    labelA: 0, // 간격 표시 투명도
    labelB: 0,
    riser: { grabT: 0.6, disp: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, active: false, tension: 0, flash: 0 },
    echo: { fb: 0.35, tone: 0.5, pulse: spring(), ghosts: [] as { born: number; s: number }[], active: false },
    activeIds: new Set<string>(),
  };
}

export function Art({ engine, colors }: { engine: DjEngine | null; colors: Record<string, ElementColor> }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const m = useRef(makeModel()).current;
  const bandsRef = useRef<Bands>({ low: 0, mid: 0, high: 0 });
  const active = useRef(new Map<number, Active>()).current;
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const [, setFrame] = useState(0);

  // ---- 애니메이션 루프: 분석값 갱신, 실제 발음 시각에 도달한 이벤트를 그래픽에 반영 ----
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const eng = engineRef.current;
      if (eng) {
        bandsRef.current = eng.updateBands(dt);
        for (const e of eng.drainEvents(eng.audibleTime())) {
          const s = e.strength;
          switch (e.id) {
            case 'kick':
              m.kick.v -= 9 * s; // 수축 → 스프링으로 반발
              break;
            case 'perc':
              m.perc.v -= 8 * s;
              break;
            case 'hat':
              m.hats.forEach((h, i) => (h.v -= (6 - i) * s));
              break;
            case 'stutterA':
              m.stA.v += 10 * s;
              break;
            case 'stutterB':
              m.stB.v += 10 * s;
              break;
            case 'echo':
              m.echo.pulse.v += 5 * s;
              m.echo.ghosts.push({ born: now / 1000, s });
              break;
            case 'riser':
              m.riser.flash = 1;
              break;
          }
        }
      }
      // 스프링 (안정성을 위해 잘게 나눠 적분)
      const sub = 4;
      for (let i = 0; i < sub; i++) {
        const h = dt / sub;
        stepSpring(m.kick, 520, 15, h);
        stepSpring(m.perc, 620, 18, h);
        m.hats.forEach((s) => stepSpring(s, 700, 20, h));
        stepSpring(m.stA, 480, 14, h);
        stepSpring(m.stB, 480, 14, h);
        stepSpring(m.echo.pulse, 300, 10, h);
        if (!m.riser.active) {
          // 놓은 곡선: 탄성 있게 떨리며 제자리로
          const r = m.riser;
          r.vel.x += (-260 * r.disp.x - 5 * r.vel.x) * h;
          r.vel.y += (-260 * r.disp.y - 5 * r.vel.y) * h;
          r.disp.x += r.vel.x * h;
          r.disp.y += r.vel.y * h;
        }
      }
      m.riser.flash *= Math.exp(-dt * 4);
      const tSpace = { 0: 7, 1: 12, 2: 20, 3: 30 }[m.divA] ?? 20;
      m.spaceA += (tSpace - m.spaceA) * (1 - Math.exp(-dt * 14));
      const tSpread = { 0: 0.35, 1: 0.65, 2: 1, 3: 1.35 }[m.divB] ?? 1;
      m.spaceB += (tSpread - m.spaceB) * (1 - Math.exp(-dt * 14));
      m.labelA = Math.max(0, m.labelA - dt * (m.activeIds.has('stutterA') ? 0 : 2));
      m.labelB = Math.max(0, m.labelB - dt * (m.activeIds.has('stutterB') ? 0 : 2));
      m.echo.ghosts = m.echo.ghosts.filter((g) => now / 1000 - g.born < 1);
      if (!m.riser.active) m.riser.tension += (bandsRef.current.mid - m.riser.tension) * (1 - Math.exp(-dt * 3));
      setFrame((f) => (f + 1) % 1e6);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [m]);

  // ---- 입력 ----
  const toSvg = (e: { clientX: number; clientY: number }): Vec => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };

  const startHitRepeat = (a: Extract<Active, { kind: 'hit' }>) => {
    const eng = engineRef.current;
    if (!eng || a.repeating) return;
    a.repeating = true;
    if (a.timer != null) window.clearTimeout(a.timer);
    a.timer = null;
    if (a.id === 'stutterA' || a.id === 'stutterB') eng.startRepeat(a.key, a.id, STEPS[a.divIdx], a.t);
    else eng.startRepeat(a.key, a.id, REPEAT[a.id].div, a.t, REPEAT[a.id].phase);
  };

  const down = (id: string) => (e: RPointerEvent) => {
    const eng = engineRef.current;
    if (!eng || e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      svgRef.current!.setPointerCapture(e.pointerId);
    } catch {
      /* 캡처할 수 없는 포인터(합성 이벤트 등)는 무시 */
    }
    const p = toSvg(e);
    m.activeIds.add(id);
    if (id === 'riser') {
      const center = bandCenter(m.riser.tension, m.riser.grabT, { x: 0, y: 0 });
      m.riser.grabT = nearestT(center, p);
      m.riser.disp = { x: 0, y: 0 };
      m.riser.vel = { x: 0, y: 0 };
      m.riser.active = true;
      eng.riserStart();
      active.set(e.pointerId, { kind: 'riser', grab: p });
      return;
    }
    if (id === 'echo') {
      m.echo.active = true;
      eng.echoUpdate(m.echo.fb, m.echo.tone);
      eng.echoStart();
      active.set(e.pointerId, { kind: 'echo', start: p, fb0: m.echo.fb, tone0: m.echo.tone });
      return;
    }
    const hid = id as HitId;
    // 단발은 즉시. 길게 누르고 있으면 그때부터 박 격자 반복
    const t = eng.hit(hid);
    const a: Extract<Active, { kind: 'hit' }> = {
      kind: 'hit',
      id: hid,
      key: `${hid}:${e.pointerId}`,
      timer: null,
      t,
      start: p,
      repeating: false,
      divIdx: DEFAULT_STEP,
    };
    a.timer = window.setTimeout(() => startHitRepeat(a), INPUT.holdMs);
    active.set(e.pointerId, a);
    if (hid === 'stutterA') {
      m.divA = DEFAULT_STEP;
      m.labelA = 1;
    }
    if (hid === 'stutterB') {
      m.divB = DEFAULT_STEP;
      m.labelB = 1;
    }
  };

  const move = (e: RPointerEvent) => {
    const a = active.get(e.pointerId);
    const eng = engineRef.current;
    if (!a || !eng) return;
    const p = toSvg(e);
    if (a.kind === 'riser') {
      let dx = p.x - a.grab.x;
      let dy = p.y - a.grab.y;
      const len = Math.hypot(dx, dy);
      if (len > RISER.maxPull) {
        dx *= RISER.maxPull / len;
        dy *= RISER.maxPull / len;
      }
      m.riser.disp = { x: dx, y: dy };
      eng.riserUpdate(Math.min(1, len / RISER.maxPull));
    } else if (a.kind === 'echo') {
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      m.echo.fb = clamp(a.fb0 + (p.x - a.start.x) / 320);
      m.echo.tone = clamp(a.tone0 + (a.start.y - p.y) / 320);
      eng.echoUpdate(m.echo.fb, m.echo.tone);
    } else if (a.id === 'stutterA' || a.id === 'stutterB') {
      // 위로 끌수록 잘게(1/8), 아래로 끌수록 길게(1박)
      const dy = a.start.y - p.y;
      const idx = Math.min(STEPS.length - 1, Math.max(0, DEFAULT_STEP - Math.round(dy / 60)));
      const moved = Math.hypot(p.x - a.start.x, dy) > 14;
      if (moved && !a.repeating) startHitRepeat(a);
      if (idx !== a.divIdx) {
        a.divIdx = idx;
        eng.setRepeatDivision(a.key, STEPS[idx]);
      }
      if (a.id === 'stutterA') m.divA = idx;
      else m.divB = idx;
    }
  };

  const end = (pointerId: number, cancelled: boolean) => {
    const a = active.get(pointerId);
    if (!a) return;
    active.delete(pointerId);
    const eng = engineRef.current;
    if (a.kind === 'riser') {
      m.activeIds.delete('riser');
      m.riser.active = false;
      if (cancelled) eng?.riserCancel();
      else eng?.riserRelease();
    } else if (a.kind === 'echo') {
      m.activeIds.delete('echo');
      m.echo.active = false;
      eng?.echoRelease();
    } else {
      m.activeIds.delete(a.id);
      if (a.timer != null) window.clearTimeout(a.timer);
      if (a.repeating) eng?.stopRepeat(a.key);
    }
  };

  // 창 포커스 상실·탭 숨김: 지속음과 반복 예약 해제
  useEffect(() => {
    const releaseAll = () => {
      for (const id of [...active.keys()]) end(id, true);
      engineRef.current?.releaseAll();
    };
    const vis = () => document.hidden && releaseAll();
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', vis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 그리기 ----
  const b = bandsRef.current;
  const now = performance.now() / 1000;
  const auto = (id: string) => (m.activeIds.has(id) ? 0 : 1); // 조작 중인 요소는 자동 움직임 없음
  const c = (id: string) => colors[id];
  const outlineStroke = (id: string, w: number) =>
    c(id).outline ? { stroke: c(id).outline!, strokeWidth: w } : { stroke: 'none' as const, strokeWidth: 0 };

  // 곡선 띠
  const center = bandCenter(m.riser.tension, m.riser.grabT, m.riser.disp);
  const bandD = bandPath(center, 1 + 0.07 * b.low * auto('riser'));
  const centerD = polyline(center);

  // 원호
  const tilt = (m.echo.tone - 0.5) * 70;
  const open = m.echo.fb * 120;
  const arcR = 1 + 0.03 * b.low * auto('echo') + m.echo.pulse.x * 0.05;

  // 사선 묶음 A
  const dA = { x: Math.cos(rad(STUTTER_A.angle)), y: Math.sin(rad(STUTTER_A.angle)) };
  const nA = { x: -dA.y, y: dA.x };
  const lenA = STUTTER_A.len + 10 * b.high * auto('stutterA');
  const linesA = [0, 1, 2, 3].map((i) => {
    const off = (i - 1.5) * m.spaceA;
    const slide = m.stA.x * 3 * (i % 2 ? 1 : -1);
    const cx = STUTTER_A.c.x + nA.x * off + dA.x * slide;
    const cy = STUTTER_A.c.y + nA.y * off + dA.y * slide;
    return { x1: cx - (dA.x * lenA) / 2, y1: cy - (dA.y * lenA) / 2, x2: cx + (dA.x * lenA) / 2, y2: cy + (dA.y * lenA) / 2 };
  });
  const crA = { x: Math.cos(rad(STUTTER_A.cross.angle)), y: Math.sin(rad(STUTTER_A.cross.angle)) };
  const crossA = {
    x1: STUTTER_A.c.x - (crA.x * STUTTER_A.cross.len) / 2,
    y1: STUTTER_A.c.y - (crA.y * STUTTER_A.cross.len) / 2,
    x2: STUTTER_A.c.x + (crA.x * STUTTER_A.cross.len) / 2,
    y2: STUTTER_A.c.y + (crA.y * STUTTER_A.cross.len) / 2,
  };

  // 사선 묶음 B (부채꼴)
  const lenB = STUTTER_B.len + 10 * b.high * auto('stutterB');
  const linesB = STUTTER_B.angles.map((ang, i) => {
    const a = rad(ang * m.spaceB + m.stB.x * 2.5 * (i % 2 ? 1 : -1));
    const ox = (i - 2) * 9;
    return {
      x1: STUTTER_B.c.x + ox - (Math.cos(a) * lenB) / 2,
      y1: STUTTER_B.c.y - (Math.sin(a) * lenB) / 2,
      x2: STUTTER_B.c.x + ox + (Math.cos(a) * lenB) / 2,
      y2: STUTTER_B.c.y + (Math.sin(a) * lenB) / 2,
    };
  });

  const kickR = KICK.r * (1 + m.kick.x * 0.28 + 0.05 * b.low * auto('kick'));
  const percR = PERC.r * (1 + m.perc.x * 0.3 + 0.03 * b.mid * auto('perc'));

  const label = (text: string, x: number, y: number, op: number, id: string) =>
    op > 0.01 ? (
      <text x={x} y={y} className="dj-label" style={{ opacity: op, fill: c(id).stroke }}>
        {text}
      </text>
    ) : null;

  const line = (l: { x1: number; y1: number; x2: number; y2: number }, id: string, w: number, key: string | number) => (
    <g key={key}>
      {c(id).outline && <line {...l} stroke={c(id).outline!} strokeWidth={w + 2.5} strokeLinecap="round" />}
      <line {...l} stroke={c(id).stroke} strokeWidth={w} strokeLinecap="round" />
    </g>
  );

  return (
    <svg
      ref={svgRef}
      className="dj-art"
      viewBox="0 0 1000 1000"
      onPointerMove={move}
      onPointerUp={(e) => end(e.pointerId, false)}
      onPointerCancel={(e) => end(e.pointerId, true)}
      onLostPointerCapture={(e) => end(e.pointerId, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* ---- 장식: 큰 윤곽 도형과 가는 선 (연주하지 않음, 저음에 아주 약하게 맥동) ---- */}
      <g className="decor" pointerEvents="none">
        <polygon
          points={DECOR.triangle.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={c('triangle').stroke}
          strokeWidth={2.2}
          strokeLinejoin="miter"
          opacity={0.8}
          transform={`rotate(${(b.low * 1.2).toFixed(2)} 700 690)`}
        />
        <ellipse
          cx={DECOR.ellipse.c.x}
          cy={DECOR.ellipse.c.y}
          rx={DECOR.ellipse.rx * (1 + 0.025 * b.low)}
          ry={DECOR.ellipse.ry * (1 + 0.025 * b.low)}
          transform={`rotate(${DECOR.ellipse.rot} ${DECOR.ellipse.c.x} ${DECOR.ellipse.c.y})`}
          fill="none"
          {...outlineStroke('ellipse', 6)}
        />
        <ellipse
          cx={DECOR.ellipse.c.x}
          cy={DECOR.ellipse.c.y}
          rx={DECOR.ellipse.rx * (1 + 0.025 * b.low)}
          ry={DECOR.ellipse.ry * (1 + 0.025 * b.low)}
          transform={`rotate(${DECOR.ellipse.rot} ${DECOR.ellipse.c.x} ${DECOR.ellipse.c.y})`}
          fill="none"
          stroke={c('ellipse').stroke}
          strokeWidth={3.5}
          opacity={0.85}
        />
        {line({ x1: DECOR.line.a.x, y1: DECOR.line.a.y, x2: DECOR.line.b.x, y2: DECOR.line.b.y }, 'line', 1.6, 'l')}
        {line({ x1: DECOR.bar.a.x, y1: DECOR.bar.a.y, x2: DECOR.bar.b.x, y2: DECOR.bar.b.y }, 'bar', 8, 'b')}
      </g>

      {/* ---- ③ 긴 곡선 띠: 잡아당기면 상승 효과 ---- */}
      <g className="el" onPointerDown={down('riser')}>
        <path d={centerD} className="hit" strokeWidth={58} />
        <path d={centerD} className="hl" stroke={c('riser').soft} strokeWidth={14} fill="none" />
        <path
          d={bandD}
          fill={c('riser').stroke}
          {...outlineStroke('riser', 1.5)}
          style={{ filter: m.riser.flash > 0.02 ? `brightness(${1 + m.riser.flash * 0.6})` : undefined }}
        />
      </g>

      {/* ---- ④ 큰 원호: 에코 ---- */}
      <g className="el" onPointerDown={down('echo')}>
        {ECHO.arcs.map((a, i) => {
          const d = arcPath(a.c, a.r * arcR, a.rot + tilt * (i === 1 ? -1 : 1), a.sweep - open * (1 - i * 0.2));
          return (
            <g key={i}>
              <path d={d} className="hit" strokeWidth={42} />
              <path d={d} className="hl" stroke={c('echo').soft} strokeWidth={a.w + 10} fill="none" />
              {c('echo').outline && <path d={d} fill="none" stroke={c('echo').outline!} strokeWidth={a.w + 2.5} strokeLinecap="round" />}
              <path d={d} fill="none" stroke={c('echo').stroke} strokeWidth={a.w} strokeLinecap="round" />
            </g>
          );
        })}
        {/* 지연 반복이 울릴 때마다 퍼지는 잔상 */}
        {m.echo.ghosts.map((g, i) => {
          const age = (now - g.born) / 1;
          const a = ECHO.arcs[0];
          return (
            <path
              key={`g${i}`}
              d={arcPath(a.c, a.r * (1 + age * 0.3), a.rot + tilt, a.sweep - open)}
              fill="none"
              stroke={c('echo').stroke}
              strokeWidth={2}
              opacity={Math.max(0, g.s * (1 - age) * 0.7)}
              pointerEvents="none"
            />
          );
        })}
      </g>

      {/* ---- ② 짧은 사선 묶음 A: 원곡 조각 스터터 ---- */}
      <g className="el" onPointerDown={down('stutterA')}>
        <circle cx={STUTTER_A.c.x} cy={STUTTER_A.c.y} r={95} className="hit" />
        {linesA.map((l, i) => (
          <line key={`h${i}`} {...l} className="hl" stroke={c('stutterA').soft} strokeWidth={12} strokeLinecap="round" />
        ))}
        {linesA.map((l, i) => line(l, 'stutterA', 4, i))}
        {line(crossA, 'stutterA', 2, 'x')}
        {label(`${STEP_LABEL[m.divA]}박`, STUTTER_A.c.x - 70, STUTTER_A.c.y + 125, m.labelA, 'stutterA')}
      </g>

      {/* ---- ② 짧은 사선 묶음 B ---- */}
      <g className="el" onPointerDown={down('stutterB')}>
        <circle cx={STUTTER_B.c.x} cy={STUTTER_B.c.y} r={90} className="hit" />
        {linesB.map((l, i) => (
          <line key={`h${i}`} {...l} className="hl" stroke={c('stutterB').soft} strokeWidth={12} strokeLinecap="round" />
        ))}
        {linesB.map((l, i) => line(l, 'stutterB', i === 2 ? 5 : 2.5, i))}
        {label(`${STEP_LABEL[m.divB]}박`, STUTTER_B.c.x - 40, STUTTER_B.c.y - 80, m.labelB, 'stutterB')}
      </g>

      {/* ---- ① 작은 사각형 묶음: 하이햇 ---- */}
      <g className="el" onPointerDown={down('hat')}>
        <rect x={865} y={520} width={90} height={240} className="hit" />
        {HATS.map((h, i) => {
          const s = h.s * (1 + m.hats[i].x * 0.25 + 0.05 * b.high * auto('hat'));
          const tr = `rotate(${h.rot + m.hats[i].x * 8} ${h.c.x} ${h.c.y})`;
          return (
            <g key={i} transform={tr}>
              <rect x={h.c.x - s / 2} y={h.c.y - s / 2} width={s} height={s} className="hl" stroke={c('hat').soft} strokeWidth={10} fill="none" />
              {c('hat').outline && (
                <rect x={h.c.x - s / 2} y={h.c.y - s / 2} width={s} height={s} fill="none" stroke={c('hat').outline!} strokeWidth={5} />
              )}
              <rect x={h.c.x - s / 2} y={h.c.y - s / 2} width={s} height={s} fill="none" stroke={c('hat').stroke} strokeWidth={2.5} />
            </g>
          );
        })}
      </g>

      {/* ---- ① 윤곽 원 + 작은 점: 퍼커션 ---- */}
      <g className="el" onPointerDown={down('perc')}>
        <circle cx={PERC.c.x} cy={PERC.c.y} r={PERC.r + 22} className="hit" />
        <circle cx={PERC.c.x} cy={PERC.c.y} r={percR} className="hl" stroke={c('perc').soft} strokeWidth={12} fill="none" />
        {c('perc').outline && <circle cx={PERC.c.x} cy={PERC.c.y} r={percR} fill="none" stroke={c('perc').outline!} strokeWidth={6} />}
        <circle cx={PERC.c.x} cy={PERC.c.y} r={percR} fill="none" stroke={c('perc').stroke} strokeWidth={3.5} />
        <circle cx={PERC.c.x + 6} cy={PERC.c.y - 5} r={PERC.dot * (1 - m.perc.x * 0.4)} fill={c('perc').stroke} />
      </g>

      {/* ---- ① 작은 색면 원: 킥 ---- */}
      <g className="el" onPointerDown={down('kick')}>
        <circle cx={KICK.c.x} cy={KICK.c.y} r={KICK.r + 26} className="hit" />
        <circle cx={KICK.c.x} cy={KICK.c.y} r={kickR + 6} className="hl" fill={c('kick').soft} />
        <circle cx={KICK.c.x} cy={KICK.c.y} r={kickR} fill={c('kick').stroke} {...outlineStroke('kick', 2)} />
      </g>
    </svg>
  );
}
