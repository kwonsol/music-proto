import { useEffect, useRef, useState } from 'react';
import { GENRE_IDS, type GenreId } from '../lib/genres';
import type { Ratios } from '../lib/ratios';
import { AREA_BUDGET, BoxTracker, boxAreas, type Box, type GenreShare } from '../layout/boxes';
import type { Point } from '../layout/features';
import { drawFrame, prepareSource } from '../render/renderer';
import { clipSelfTest } from '../render/selftest';

export const LOGICAL_W = 1600;
const MAX_LONG_SIDE = 1400;
const BLINK_SEC = 0.07;

export interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** 정규화(0..1) 특징점 — 박스가 탐지·추적하는 대상 후보 */
  features: Point[];
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

/** 이미지 정규화 좌표 -> 캔버스 논리 좌표 (원본이 캔버스를 cover 로 채우는 방식과 동일) */
function mapFeatures(img: LoadedImage | null, W: number, H: number): Point[] {
  if (!img) return [];
  const s = Math.max(W / img.width, H / img.height);
  const ox = (W - img.width * s) / 2;
  const oy = (H - img.height * s) / 2;
  return img.features.map((p) => ({ x: ox + p.x * img.width * s, y: oy + p.y * img.height * s, weight: p.weight }));
}

export function Stage(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const srcRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const propsRef = useRef(props);
  propsRef.current = props;
  const dirty = useRef(true);
  const trackerRef = useRef(new BoxTracker(7));
  const rt = useRef({
    fx: 0,
    boxes: [] as Box[],
    logicalH: LOGICAL_W * 0.75,
    cfgKey: '',
    ratiosRef: null as Ratios | null,
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

  // 원본을 캔버스 해상도로 한 번만 준비 (모든 박스가 같은 좌표계의 이 한 장을 공유)
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
    rt.current.fx = 0;
    rt.current.cfgKey = ''; // 박스를 처음 상태로 다시 잡는다
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

      const logicalH = LOGICAL_W / p.aspect;
      const shares: GenreShare[] = GENRE_IDS.filter((g) => (p.ratios[g] ?? 0) > 1e-9).map((g) => ({
        id: g,
        share: p.ratios[g] as number,
      }));
      const tracker = trackerRef.current;
      // 이미지·캔버스 비율이 바뀌면 박스를 새로 잡고, 비율만 바뀌면 박스 면적만 갱신한다
      const cfgKey = `${p.aspect}|${p.image?.width}x${p.image?.height}|${p.image?.features.length}`;
      if (cfgKey !== s.cfgKey) {
        s.cfgKey = cfgKey;
        s.ratiosRef = p.ratios;
        tracker.configure(LOGICAL_W, logicalH, mapFeatures(p.image, LOGICAL_W, logicalH), shares);
        dirty.current = true;
      } else if (s.ratiosRef !== p.ratios) {
        s.ratiosRef = p.ratios;
        tracker.setShares(shares);
        dirty.current = true;
      }

      if (p.playing) {
        s.fx += dt;
        tracker.step(dt * p.freq, s.fx);
      } else if (!dirty.current) return;
      dirty.current = false;

      const boxes = tracker.boxes();
      s.boxes = boxes;
      s.logicalH = logicalH;
      const total = shares.reduce((a, b) => a + b.share, 0) || 1;
      const percent: Partial<Record<GenreId, number>> = {};
      for (const sh of shares) percent[sh.id] = (sh.share / total) * 100;
      // 방금 재탐지한 박스는 테두리·라벨만 잠깐 끈다 (사진은 그대로)
      const blink = new Set<string>();
      if (p.playing) for (const b of boxes) if (s.fx - b.lastEvent < BLINK_SEC && b.lastEvent > 0) blink.add(b.id);
      drawFrame({
        ctx: cv.getContext('2d')!,
        src: srcRef.current,
        logicalW: LOGICAL_W,
        logicalH,
        boxes,
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
        const areas = boxAreas(s.boxes);
        const sum = s.boxes.reduce((a, b) => a + b.w * b.h, 0);
        const pct: Record<string, number> = {};
        for (const [k, v] of Object.entries(areas)) pct[k] = ((v as number) / sum) * 100;
        // 합집합 면적(흰 여백 = 1 - union)을 격자 샘플로 계산
        const N = 200;
        let covered = 0;
        for (let j = 0; j < N; j++)
          for (let i = 0; i < N; i++) {
            const x = ((i + 0.5) / N) * LOGICAL_W;
            const y = ((j + 0.5) / N) * s.logicalH;
            if (s.boxes.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)) covered++;
          }
        const inside = s.boxes.every(
          (b) => b.x >= -1e-6 && b.y >= -1e-6 && b.x + b.w <= LOGICAL_W + 1e-6 && b.y + b.h <= s.logicalH + 1e-6,
        );
        return {
          count: s.boxes.length,
          pct,
          budget: sum / total,
          expectedBudget: AREA_BUDGET,
          whiteFraction: 1 - covered / (N * N),
          inside,
          fx: s.fx,
          boxes: s.boxes.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, aspect: b.w / b.h, area: b.w * b.h })),
        };
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
