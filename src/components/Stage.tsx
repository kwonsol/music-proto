import { useEffect, useRef, useState } from 'react';
import { GENRE_IDS, type GenreId } from '../lib/genres';
import type { Ratios } from '../lib/ratios';
import { computeLayout, genreAreas, type GenreShare, type Rect } from '../layout/partition';
import { drawFrame, prepareSource } from '../render/renderer';
import { clipSelfTest } from '../render/selftest';

export const LOGICAL_W = 1600;
const MAX_LONG_SIDE = 1400;
const BLINK_SEC = 0.07;

export interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

interface Props {
  image: LoadedImage | null;
  aspect: number;
  ratios: Ratios;
  intensity: Record<GenreId, number>;
  options: Record<GenreId, number>;
  /** 구획 전환 빈도 (0=정지) */
  freq: number;
  playing: boolean;
  showBoxes: boolean;
  resetToken: number;
  children?: React.ReactNode;
}

interface Runtime {
  tau: number;
  fx: number;
  rects: Rect[];
  geom: Map<string, string>;
  changedAt: Map<string, number>;
  logicalH: number;
}

export function Stage(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const srcRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const propsRef = useRef(props);
  propsRef.current = props;
  const dirty = useRef(true);
  const rt = useRef<Runtime>({
    tau: 0,
    fx: 0,
    rects: [],
    geom: new Map(),
    changedAt: new Map(),
    logicalH: LOGICAL_W * 0.75,
  });
  const [box, setBox] = useState({ w: 0, h: 0 });

  // 가용 영역 안에 비율을 유지한 채 가장 크게 맞춘다
  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fitW = Math.max(1, Math.min(box.w, box.h * props.aspect));
  const fitH = fitW / props.aspect;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.min(dpr, MAX_LONG_SIDE / Math.max(fitW, fitH));
  const pxW = Math.max(2, Math.round(fitW * scale));
  const pxH = Math.max(2, Math.round(fitH * scale));

  // 원본을 캔버스 해상도로 한 번만 준비 (모든 구획이 공유)
  useEffect(() => {
    const cv = canvasRef.current!;
    cv.width = pxW;
    cv.height = pxH;
    const img = props.image;
    prepareSource(srcRef.current, img?.source ?? null, img?.width ?? 0, img?.height ?? 0, pxW, pxH);
    dirty.current = true;
  }, [props.image, pxW, pxH]);

  useEffect(() => {
    dirty.current = true;
  });

  useEffect(() => {
    rt.current.tau = 0;
    rt.current.fx = 0;
    dirty.current = true;
  }, [props.resetToken]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const p = propsRef.current;
      const s = rt.current;
      const cv = canvasRef.current;
      if (!cv || cv.width < 2) return;

      if (p.playing) {
        s.fx += dt;
        s.tau += dt * p.freq;
      }
      if (!p.playing && !dirty.current) return;
      dirty.current = false;

      const logicalH = LOGICAL_W / p.aspect;
      // 비율은 즉시 반영(보간 없음)
      const shares: GenreShare[] = GENRE_IDS.filter((g) => (p.ratios[g] ?? 0) > 1e-9).map((g) => ({
        id: g,
        share: p.ratios[g] as number,
      }));
      const total = shares.reduce((a, b) => a + b.share, 0) || 1;
      const rects = computeLayout(shares, LOGICAL_W, logicalH, s.tau);
      s.rects = rects;
      s.logicalH = logicalH;
      // 구획이 컷 전환된 순간을 찾아 그 구획의 테두리·라벨만 잠깐 끈다
      const nextGeom = new Map<string, string>();
      for (const r of rects) {
        const gk = `${r.x.toFixed(2)}|${r.y.toFixed(2)}|${r.w.toFixed(2)}|${r.h.toFixed(2)}`;
        nextGeom.set(r.id, gk);
        if (s.geom.get(r.id) !== gk) s.changedAt.set(r.id, s.fx);
      }
      s.geom = nextGeom;
      const blink = new Set<string>();
      for (const r of rects) if (s.fx - (s.changedAt.get(r.id) ?? -9) < BLINK_SEC && p.playing) blink.add(r.id);
      const percent: Partial<Record<GenreId, number>> = {};
      for (const sh of shares) percent[sh.id] = (sh.share / total) * 100;
      drawFrame({
        ctx: cv.getContext('2d')!,
        src: srcRef.current,
        logicalW: LOGICAL_W,
        logicalH,
        rects,
        fxTime: s.fx,
        intensity: p.intensity,
        options: p.options,
        blink,
        percent,
        showBoxes: p.showBoxes,
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 검증용 훅: 콘솔에서 window.__musicProto.audit() / clipSelfTest()
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__musicProto = {
      audit() {
        const s = rt.current;
        const total = LOGICAL_W * s.logicalH;
        const areas = genreAreas(s.rects);
        const pct: Record<string, number> = {};
        for (const [k, v] of Object.entries(areas)) pct[k] = ((v as number) / total) * 100;
        let overlap = 0;
        for (let i = 0; i < s.rects.length; i++)
          for (let j = i + 1; j < s.rects.length; j++) {
            const a = s.rects[i];
            const b = s.rects[j];
            const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            if (w > 0 && h > 0) overlap += w * h;
          }
        const sum = s.rects.reduce((a, r) => a + r.w * r.h, 0);
        return { rects: s.rects.length, pct, coverage: sum / total, overlap, tau: s.tau, geometry: s.rects.map((r) => [r.id, r.x, r.y, r.w, r.h] as const) };
      },
      clipSelfTest,
    };
  }, []);

  return (
    <div className="stage-wrap" ref={wrapRef}>
      <div className="stage" style={{ width: fitW, height: fitH }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
        {props.children}
      </div>
    </div>
  );
}
