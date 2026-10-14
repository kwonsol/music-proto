import { useEffect, useRef, useState } from 'react';
import { GENRE_IDS, type GenreId } from '../lib/genres';
import type { Ratios } from '../lib/ratios';
import { AREA_REL, BoxTracker, boxAreas, type Box, type GenreShare } from '../layout/boxes';
import type { Point } from '../layout/features';
import { drawFrame } from '../render/renderer';
import { buildSubject, type Subject } from '../subject/art';
import type { BBox } from '../subject/mask';
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
  /** 대상 실루엣 알파 마스크(이미지와 같은 좌표계) */
  mask: CanvasImageSource;
  /** 마스크의 정규화 경계 상자 */
  maskBBox: BBox;
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
  mode: 'pattern' | 'photo';
  resetToken: number;
  children?: React.ReactNode;
}

export function Stage(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const subjectRef = useRef<Subject | null>(null);
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

  // 대상을 캔버스 중앙에 고정 배치하고 마스크·아트 격자를 만든다 (박스는 이 위에서만 움직인다)
  useEffect(() => {
    const cv = canvasRef.current!;
    cv.width = pxW;
    cv.height = pxH;
    const img = props.image;
    subjectRef.current = img ? buildSubject(img, pxW, pxH) : null;
    rt.current.cfgKey = '';
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
      const subject = subjectRef.current;
      if (!cv || cv.width < 2 || !subject) return;

      const logicalH = LOGICAL_W / p.aspect;
      const shares: GenreShare[] = GENRE_IDS.filter((g) => (p.ratios[g] ?? 0) > 1e-9).map((g) => ({
        id: g,
        share: p.ratios[g] as number,
      }));
      const tracker = trackerRef.current;
      // 이미지·캔버스 비율이 바뀌면 박스를 새로 잡고, 비율만 바뀌면 박스 면적만 갱신한다
      const cfgKey = `${p.aspect}|${cv.width}x${cv.height}|${subject.src.dataset.v}`;
      if (cfgKey !== s.cfgKey) {
        s.cfgKey = cfgKey;
        s.ratiosRef = p.ratios;
        const k = LOGICAL_W / cv.width; // 캔버스 픽셀 -> 논리 좌표
        const bb = subject.bbox;
        // 기준점 후보: 실루엣 안쪽(외곽에서 4셀 이상)에 있는 특징점만 — 박스가 빈 곳을 잡지 않도록
        const art = subject.art;
        const cands: Point[] = [];
        for (const f of p.image?.features ?? []) {
          const m = subject.map(f.x, f.y);
          const ci = Math.floor(m.x / art.cell);
          const cj = Math.floor(m.y / art.cell);
          if (ci < 0 || cj < 0 || ci >= art.cols || cj >= art.rows) continue;
          if (art.depth[cj * art.cols + ci] >= 4) cands.push({ x: m.x * k, y: m.y * k, weight: f.weight });
        }
        // 부족하면 경계 상자 안의 균등 지점 중 실루엣 안쪽인 곳으로 보충
        for (const [fx, fy] of [[0.5, 0.5], [0.33, 0.4], [0.67, 0.4], [0.36, 0.68], [0.64, 0.68], [0.5, 0.3], [0.5, 0.78], [0.3, 0.55], [0.7, 0.55]]) {
          if (cands.length >= 8) break;
          const x = bb.x + fx * bb.w;
          const y = bb.y + fy * bb.h;
          const ci = Math.floor(x / art.cell);
          const cj = Math.floor(y / art.cell);
          if (art.depth[cj * art.cols + ci] >= 4) cands.push({ x: x * k, y: y * k, weight: 0.6 });
        }
        tracker.configure(
          LOGICAL_W,
          logicalH,
          { cx: (bb.x + bb.w / 2) * k, cy: (bb.y + bb.h / 2) * k, w: bb.w * k, h: bb.h * k },
          cands,
          shares,
        );
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
        subject,
        mode: p.mode,
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
        const sub = subjectRef.current;
        const kk = LOGICAL_W / (canvasRef.current?.width || LOGICAL_W);
        const subjArea = sub ? sub.bbox.w * kk * sub.bbox.h * kk : 1;
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
          budget: sum / subjArea,
          expectedBudget: AREA_REL,
          whiteFraction: 1 - covered / (N * N),
          inside,
          fx: s.fx,
          boxes: s.boxes.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, aspect: b.w / b.h, area: b.w * b.h })),
        };
      },
      clipSelfTest,
      /** 박스·테두리를 끈 상태에서: 실루엣(계단 외곽) 밖에 흰색이 아닌 픽셀이 있는지, 대상 경계 상자 */
      leakCheck() {
        const cv = canvasRef.current;
        const sub = subjectRef.current;
        if (!cv || !sub) return null;
        const d = cv.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, cv.width, cv.height).data;
        const a = sub.art;
        let leak = 0;
        let inside = 0;
        let nonWhiteInside = 0;
        for (let y = 0; y < cv.height; y++)
          for (let x = 0; x < cv.width; x++) {
            const o = (y * cv.width + x) * 4;
            const white = d[o] > 250 && d[o + 1] > 250 && d[o + 2] > 250;
            const ci = Math.floor(x / a.cell);
            const cj = Math.floor(y / a.cell);
            const ins = a.inside[cj * a.cols + ci] === 1;
            if (!ins && !white) leak++;
            if (ins) {
              inside++;
              if (!white) nonWhiteInside++;
            }
          }
        return { leak, insidePx: inside, nonWhiteInside, bbox: sub.bbox };
      },
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
