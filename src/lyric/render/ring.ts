import type { RingLine, RingView } from '../data/rings';
import { advanceOf, BASE, BOX } from './glyphs';
import type { FontInfo } from './fonts';
import { ringItems, type SceneRenderer } from './scene';

/**
 * 중심을 공유하는 3D 링 렌더러.
 *
 * 두 단계를 분리한다.
 *  1) 왜곡: 줄마다 전용 오프스크린 텍스처(strip)에 기존 효과 파이프라인으로 가로 한 줄을 그린다.
 *     효과는 그 텍스처 안에서만 일어나므로 다른 링으로 번지지 않는다.
 *  2) 배치·공전: 텍스처를 가는 조각으로 잘라 3D 공간에 세운다.
 *     - 텍스처 가로 → 원의 접선 방향, 텍스처 세로 → 그 링 평면의 법선 방향 (글자가 원둘레에 꽂힌 표지판처럼 선다)
 *     - 링마다 고정된 기울기·축으로 평면이 달라 서로 교차한다
 *     - 각 조각은 원근 투영된 세 꼭짓점으로 만든 아핀 변환으로 그린다.
 *       뒤쪽에서는 변환이 뒤집혀 글자 뒷면이 그대로 보인다 (양면 렌더링)
 *     - 모든 링의 조각을 깊이 순(먼 것부터)으로 정렬해 그려, 앞 글자가 뒤 글자를 가린다
 */

type V3 = [number, number, number];

interface Runtime {
  angle: number;
  fx: number;
}

interface Piece {
  strip: HTMLCanvasElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  m: [number, number, number, number, number, number];
  depth: number;
  alpha: number;
}

const R0 = 1.15;
const GAP = 0.3;
const BASE_SIZE = 0.24;
const MAX_SIZE = 0.27;

const add = (a: V3, b: V3, c: V3): V3 => [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
const mul = (v: V3, k: number): V3 => [v[0] * k, v[1] * k, v[2] * k];

/** 축 d(단위벡터) 둘레로 v 를 a 라디안 회전 (Rodrigues) */
function rotate(v: V3, d: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dot = d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
  const cross: V3 = [d[1] * v[2] - d[2] * v[1], d[2] * v[0] - d[0] * v[2], d[0] * v[1] - d[1] * v[0]];
  return [
    v[0] * c + cross[0] * s + d[0] * dot * (1 - c),
    v[1] * c + cross[1] * s + d[1] * dot * (1 - c),
    v[2] * c + cross[2] * s + d[2] * dot * (1 - c),
  ];
}

/** 링 평면 좌표계: U, V = 평면 안의 두 축, N = 법선 */
export function ringFrame(tiltDeg: number, axisDeg: number): { U: V3; V: V3; N: V3 } {
  const b = (axisDeg * Math.PI) / 180;
  const d: V3 = [Math.cos(b), 0, Math.sin(b)];
  const a = (tiltDeg * Math.PI) / 180;
  return { U: rotate([1, 0, 0], d, a), V: rotate([0, 0, 1], d, a), N: rotate([0, 1, 0], d, a) };
}

export class RingScene {
  private rt = new Map<string, Runtime>();
  private strips = new Map<string, HTMLCanvasElement>();
  private epoch = -1;
  private hitPts: [number, number, number][] = [];

  constructor(private sr: SceneRenderer, private fi: FontInfo) {
    // 개발 중 검증용: 줄별 독립 텍스처와 누적 시간을 콘솔에서 확인
    if (import.meta.env.DEV) Object.assign(window, { __ringStrips: this.strips, __ringRuntime: this.rt });
  }

  /**
   * 링 공전 각도와 줄별 효과 시간을 누적한다. 프레임마다 한 번만 호출.
   * 편집으로 설정이 바뀌어도 누적값은 유지 → 회전·애니메이션이 처음부터 다시 시작하지 않는다.
   */
  advance(lines: RingLine[], view: RingView, dt: number, epoch: number) {
    if (epoch !== this.epoch) {
      this.rt.clear();
      this.epoch = epoch;
    }
    for (const l of lines) {
      let r = this.rt.get(l.id);
      if (!r) {
        r = { angle: 0, fx: 0 };
        this.rt.set(l.id, r);
      }
      r.angle += ((dt * l.rotation.speed * l.rotation.dir * view.spin) / 180) * Math.PI;
      r.fx += dt * l.params.speed;
    }
  }

  draw(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, lines: RingLine[], view: RingView, selected: number, distort: boolean) {
    if (lines.length === 0) return;
    const items = lines.map((l) => ringItems(l, distort));
    this.sr.setLoad(items.reduce((n, l) => n + l.filter((it) => it.style).length, 0));

    // 링별 고정 기하: 반지름, 평면, 기본 글자 크기 (긴 가사는 원둘레의 90% 안으로 줄인다)
    const geo = lines.map((l, i) => {
      const R = R0 + i * GAP;
      const unit = items[i].reduce((w, it) => w + advanceOf(it.ch, 100, this.fi) * (it.scale ?? 1), 0) / 100;
      // 둘레의 약 2/3 를 채우는 크기를 기준으로 (상한 있음), 링별 배율을 곱하고 한 바퀴를 넘지 않게 제한
      const circ = 2 * Math.PI * R;
      const fill = Math.min(MAX_SIZE, (0.66 * circ) / Math.max(0.1, unit));
      const s = Math.min(fill * (l.layout.scale ?? 1), (0.9 * circ) / Math.max(0.1, unit));
      return { R, s, ...ringFrame(l.layout.tilt ?? 0, l.layout.axis ?? 0) };
    });

    const e = (Math.max(5, Math.min(85, view.tilt)) * Math.PI) / 180;
    const sin = Math.sin(e);
    const cos = Math.cos(e);
    const Rmax = geo[geo.length - 1].R + BASE_SIZE;
    const D = Rmax * 3.6;
    // 카메라: 위쪽 비스듬한 시점. 높이(y)가 클수록 가깝고 화면 위쪽
    const raw = (p: V3): [number, number, number] => {
      const dep = D + p[2] * cos - p[1] * sin;
      return [p[0] / dep, -(p[2] * sin + p[1] * cos) / dep, dep];
    };
    // 화면 맞춤: 모든 링의 바닥선과 글자 윗선을 투영해 경계 상자를 구한다
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const g of geo) {
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        for (const h of [0, g.s * 1.1]) {
          const [X, Y] = raw(add(mul(g.U, g.R * Math.cos(a)), mul(g.V, g.R * Math.sin(a)), mul(g.N, h)));
          minX = Math.min(minX, X);
          maxX = Math.max(maxX, X);
          minY = Math.min(minY, Y);
          maxY = Math.max(maxY, Y);
        }
      }
    }
    const f = Math.min((rect.w * 0.95) / (maxX - minX), (rect.h * 0.9) / Math.max(1e-6, maxY - minY));
    const cx = rect.x + rect.w / 2 - (f * (minX + maxX)) / 2;
    const cy = rect.y + rect.h / 2 - (f * (minY + maxY)) / 2;
    const proj = (p: V3): [number, number, number] => {
      const [X, Y, dep] = raw(p);
      return [cx + f * X, cy + f * Y, dep];
    };
    const dpr = ctx.canvas.width / Math.max(1, ctx.canvas.clientWidth || ctx.canvas.width);

    // 보조 궤도선: 타이포가 중심이 되도록 아주 옅게. 선택 링만 얇은 실선 + 번호
    for (let i = 0; i < lines.length; i++) {
      const g = geo[i];
      const sel = i === selected;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.lineWidth = (sel ? 1.2 : 0.8) * dpr;
      ctx.strokeStyle = sel ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.09)';
      ctx.setLineDash(sel ? [] : [2 * dpr, 6 * dpr]);
      ctx.beginPath();
      let left: [number, number] = [Infinity, 0];
      for (let k = 0; k <= 128; k++) {
        const a = (k / 128) * Math.PI * 2;
        const [x, y] = proj(add(mul(g.U, g.R * Math.cos(a)), mul(g.V, g.R * Math.sin(a)), mul(g.N, -g.s * 0.12)));
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        if (x < left[0]) left = [x, y];
      }
      ctx.stroke();
      if (sel) {
        ctx.fillStyle = '#000';
        ctx.font = `600 ${11 * dpr}px -apple-system, "Apple SD Gothic Neo", sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1).padStart(2, '0'), left[0] - 8 * dpr, left[1]);
      }
    }
    ctx.setLineDash([]);

    // 1) 줄별 텍스처 그리기  2) 3D 조각 목록 만들기
    const pieces: Piece[] = [];
    this.hitPts = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const g = geo[i];
      const its = items[i];
      const rt = this.rt.get(line.id) ?? { angle: 0, fx: 0 };
      // 텍스처 해상도: 이 링이 가장 가까이 올 때의 화면 크기 기준
      const emPx = Math.max(12, Math.min(140, (g.s * f) / Math.max(D * 0.3, D - g.R - g.s)));
      const k = g.s / emPx;
      const maxScale = its.reduce((m, it) => Math.max(m, it.scale ?? 1), 1);
      const baseW = its.reduce((w, it) => w + advanceOf(it.ch, emPx * (it.scale ?? 1), this.fi), 0);
      // 꼬리·잔상이 잘리지 않을 여백. 단 원 한 바퀴를 넘기지는 않는다
      const room = Math.max(0, (2 * Math.PI * g.R) / k - baseW);
      const padX = Math.min(emPx * 4.5, room / 2);
      const padTop = emPx * maxScale * 1.25;
      const padBottom = emPx * 1.5;
      const baseline = padTop + emPx * maxScale * BASE;
      const W = Math.ceil(baseW + 2 * padX);
      const H = Math.ceil(baseline + emPx * maxScale * (BOX - BASE) + padBottom);
      const strip = this.stripFor(line.id, W, H);
      const sctx = strip.getContext('2d')!;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.globalAlpha = 1;
      sctx.imageSmoothingEnabled = false;
      sctx.clearRect(0, 0, strip.width, strip.height);
      const total = this.sr.drawStripLine(sctx, its, emPx, padX, baseline, rt.fx, distort, i + 1, g.R / k, padX * 1.8 + baseW);
      const xc = padX + total / 2;
      const thetaC = -Math.PI / 2 + (line.layout.phase * Math.PI) / 180 + rt.angle;

      // 텍스처 좌표 → 3D: 가로는 접선(원둘레를 따라), 세로는 링 평면의 법선(위로 선다)
      const point = (xs: number, ys: number) => {
        const th = thetaC + ((xs - xc) * k) / g.R;
        const h = (baseline - ys) * k;
        return proj(add(mul(g.U, g.R * Math.cos(th)), mul(g.V, g.R * Math.sin(th)), mul(g.N, h)));
      };
      const span = (W * k) / g.R;
      const segs = Math.max(16, Math.min(220, Math.ceil(span / 0.035)));
      const segW = W / segs;
      const bands = [0, H * 0.34, H * 0.67, H];
      const ov = Math.min(1, segW * 0.12) + 0.35;
      const alpha = i === selected || selected < 0 ? 1 : 0.9;
      for (let j = 0; j < segs; j++) {
        const x0 = j * segW;
        const x1 = Math.min(W, x0 + segW + ov);
        for (let b = 0; b < 3; b++) {
          const y0 = bands[b];
          const y1 = Math.min(H, bands[b + 1] + 0.5);
          const p00 = point(x0, y0);
          const p10 = point(x1, y0);
          const p01 = point(x0, y1);
          const pc = point((x0 + x1) / 2, (y0 + y1) / 2);
          pieces.push({
            strip,
            sx: x0,
            sy: y0,
            sw: x1 - x0,
            sh: y1 - y0,
            m: [p10[0] - p00[0], p10[1] - p00[1], p01[0] - p00[0], p01[1] - p00[1], p00[0], p00[1]],
            depth: pc[2],
            alpha,
          });
          if (b === 2 && j % 2 === 0) this.hitPts.push([pc[0], pc[1], i]);
        }
      }
    }

    // 깊이 정렬: 먼 조각부터 → 앞 글자가 뒤 글자를 가린다
    pieces.sort((a, b) => b.depth - a.depth);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const p of pieces) {
      ctx.globalAlpha = p.alpha;
      ctx.setTransform(p.m[0], p.m[1], p.m[2], p.m[3], p.m[4], p.m[5]);
      ctx.drawImage(p.strip, p.sx, p.sy, p.sw, p.sh, 0, 0, 1, 1);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
  }

  private stripFor(id: string, w: number, h: number) {
    let c = this.strips.get(id);
    if (!c) {
      c = document.createElement('canvas');
      this.strips.set(id, c);
    }
    if (c.width < w || c.height < h || c.width > w * 2 || c.height > h * 2) {
      c.width = Math.max(1, w);
      c.height = Math.max(1, h);
    }
    return c;
  }

  /** 화면(디바이스 px) 좌표 → 가장 가까운 링 글자 띠의 번호. 없으면 -1 */
  hit(px: number, py: number): number {
    let best = -1;
    let bestD = Infinity;
    for (const [x, y, i] of this.hitPts) {
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return bestD < 80 * 80 ? best : -1;
  }
}
