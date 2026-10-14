import type { RingLine, RingView } from '../data/rings';
import { advanceOf, BASE, BOX } from './glyphs';
import type { FontInfo } from './fonts';
import type { SceneRenderer, StripItem } from './scene';

/**
 * 동심원 링 배치 렌더러.
 *
 * 두 단계를 분리한다.
 *  1) 왜곡: 줄마다 자기 전용 오프스크린 텍스처(strip)에 기존 효과 파이프라인으로 가로 한 줄을 그린다.
 *     텍스처 가로 = 원둘레 방향, 세로 = 반지름 방향. 효과는 이 텍스처 안에서만 일어나므로 다른 링으로 번지지 않는다.
 *  2) 배치·공전: 텍스처를 가는 세로 조각으로 잘라, 기울어진 원판 위 원호에 원근 투영해 붙인다.
 *     각 조각은 투영된 세 꼭짓점으로 만든 아핀 변환으로 그린다(조각이 좁아 원근 오차가 작다).
 *
 * 좌표: 원판은 월드 xz 평면, 카메라는 위쪽 비스듬한 시점(tilt).
 *   화면 y ∝ -z·sin(tilt) / (D + z·cos(tilt)),  깊이 = D + z·cos(tilt)
 * 글자의 위쪽은 원의 바깥을 향한다 (앞쪽 글자는 뒤집혀 보이는 원판 위 타이포).
 */

interface Runtime {
  angle: number;
  fx: number;
}

interface Camera {
  cx: number;
  cy: number;
  f: number;
  D: number;
  sin: number;
  cos: number;
}

interface RingGeom {
  R: number;
  s: number;
}

const R0 = 1.45;
const GAP = 0.6;
const BASE_SIZE = GAP * 0.74;

export class RingScene {
  private rt = new Map<string, Runtime>();
  private strips = new Map<string, HTMLCanvasElement>();
  private epoch = -1;
  private hitCam: Camera | null = null;
  private hitRings: RingGeom[] = [];

  constructor(private sr: SceneRenderer, private fi: FontInfo) {
    // 개발 중 검증용: 줄별 독립 텍스처를 콘솔에서 확인
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

  private geometry(lines: RingLine[]): RingGeom[] {
    return lines.map((l, i) => {
      const R = R0 + i * GAP;
      const plain = l.text.replace(/[[\]]/g, '');
      const unit = [...plain].reduce((w, ch) => w + advanceOf(ch, 100, this.fi), 0) / 100;
      // 긴 가사는 원둘레의 86% 안에 들어가도록 글자 크기를 줄인다 (반복해서 채우지 않음)
      const s = Math.min(BASE_SIZE, (0.86 * 2 * Math.PI * R) / Math.max(0.1, unit));
      return { R, s };
    });
  }

  private camera(rect: { x: number; y: number; w: number; h: number }, Rmax: number, tilt: number): Camera {
    const e = (Math.max(8, Math.min(88, tilt)) * Math.PI) / 180;
    const sin = Math.sin(e);
    const cos = Math.cos(e);
    const D = Rmax * 2.8;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const x = Rmax * Math.cos(a);
      const z = Rmax * Math.sin(a);
      const dep = D + z * cos;
      const X = x / dep;
      const Y = (-z * sin) / dep;
      minX = Math.min(minX, X);
      maxX = Math.max(maxX, X);
      minY = Math.min(minY, Y);
      maxY = Math.max(maxY, Y);
    }
    const f = Math.min((rect.w * 0.94) / (maxX - minX), (rect.h * 0.86) / Math.max(1e-6, maxY - minY));
    return {
      f,
      D,
      sin,
      cos,
      cx: rect.x + rect.w / 2 - (f * (minX + maxX)) / 2,
      cy: rect.y + rect.h / 2 - (f * (minY + maxY)) / 2,
    };
  }

  draw(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    lines: RingLine[],
    view: RingView,
    selected: number,
    distort: boolean,
    itemsOf: (l: RingLine) => StripItem[],
  ) {
    if (lines.length === 0) return;
    const geo = this.geometry(lines);
    const Rmax = geo[geo.length - 1].R + BASE_SIZE * 1.4;
    const cam = this.camera(rect, Rmax, view.tilt);
    if (distort) {
      this.hitCam = cam;
      this.hitRings = geo;
    }
    const dpr = ctx.canvas.width / Math.max(1, ctx.canvas.clientWidth || ctx.canvas.width);
    const proj = (x: number, z: number): [number, number] => {
      const dep = cam.D + z * cam.cos;
      return [cam.cx + (cam.f * x) / dep, cam.cy + (cam.f * -z * cam.sin) / dep];
    };

    const items = lines.map(itemsOf);
    this.sr.setLoad(items.reduce((n, l) => n + l.filter((it) => it.style).length, 0));

    // 보조 궤도선 (모든 링: 옅은 점선, 선택 링: 얇은 실선 + 바깥 점선 + 번호)
    for (let i = 0; i < lines.length; i++) {
      const { R, s } = geo[i];
      const sel = i === selected;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.lineWidth = (sel ? 1.4 : 1) * dpr;
      ctx.strokeStyle = sel ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.2)';
      ctx.setLineDash(sel ? [] : [2 * dpr, 5 * dpr]);
      this.ellipse(ctx, proj, R - s * 0.16);
      if (sel) {
        ctx.setLineDash([1.5 * dpr, 4 * dpr]);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        this.ellipse(ctx, proj, R + s * 1.12);
        const [lx, ly] = proj(-(R + s * 0.5), 0);
        ctx.setLineDash([]);
        ctx.fillStyle = '#000';
        ctx.font = `600 ${11 * dpr}px -apple-system, "Apple SD Gothic Neo", sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1).padStart(2, '0'), lx - 8 * dpr, ly);
      }
    }
    ctx.setLineDash([]);

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const { R, s } = geo[i];
      const rt = this.rt.get(line.id) ?? { angle: 0, fx: 0 };
      // 텍스처 해상도: 이 링에서 가장 가까운(앞쪽) 지점의 화면 크기에 맞춘다
      const emPx = Math.max(14, Math.min(150, (s * cam.f) / (cam.D - R * cam.cos)));
      const k = s / emPx;
      const its = items[i];
      const baseW = its.reduce((w, it) => w + advanceOf(it.ch, emPx, this.fi), 0);
      // 꼬리·잔상이 잘리지 않을 여백. 단 원 한 바퀴를 넘기지는 않는다
      const room = Math.max(0, (2 * Math.PI * R) / k - baseW);
      const padX = Math.min(emPx * 4.5, room / 2);
      const padTop = emPx * 1.3;
      const padBottom = emPx * 1.6;
      const W = Math.ceil(baseW + 2 * padX);
      const H = Math.ceil(padTop + emPx * BOX + padBottom);
      const strip = this.stripFor(line.id, W, H);
      const sctx = strip.getContext('2d')!;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.globalAlpha = 1;
      sctx.imageSmoothingEnabled = false;
      sctx.clearRect(0, 0, strip.width, strip.height);
      const baseline = padTop + emPx * BASE;
      const total = this.sr.drawStripLine(sctx, its, emPx, padX, baseline, rt.fx, distort, i + 1, R / k, padX * 2 + baseW - padX * 0.2);
      const xc = padX + total / 2;
      const thetaC = -Math.PI / 2 + (line.layout.phase * Math.PI) / 180 + rt.angle;

      // 원호로 감아 붙이기
      ctx.globalAlpha = i === selected || selected < 0 ? 1 : 0.86;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const span = (W * k) / R;
      const segs = Math.max(16, Math.min(260, Math.ceil(span / 0.03)));
      const segW = W / segs;
      const bands = [0, H * 0.34, H * 0.67, H];
      const point = (xs: number, ys: number) => {
        const th = thetaC - ((xs - xc) * k) / R;
        const r = R + (baseline - ys) * k;
        return proj(r * Math.cos(th), r * Math.sin(th));
      };
      const ov = Math.min(1, segW * 0.12) + 0.35;
      for (let j = 0; j < segs; j++) {
        const x0 = j * segW;
        const x1 = Math.min(W, x0 + segW + ov);
        for (let b = 0; b < 3; b++) {
          const y0 = bands[b];
          const y1 = Math.min(H, bands[b + 1] + 0.5);
          const p00 = point(x0, y0);
          const p10 = point(x1, y0);
          const p01 = point(x0, y1);
          ctx.setTransform(p10[0] - p00[0], p10[1] - p00[1], p01[0] - p00[0], p01[1] - p00[1], p00[0], p00[1]);
          ctx.drawImage(strip, x0, y0, x1 - x0, y1 - y0, 0, 0, 1, 1);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.imageSmoothingEnabled = false;
  }

  private ellipse(ctx: CanvasRenderingContext2D, proj: (x: number, z: number) => [number, number], r: number) {
    ctx.beginPath();
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      const [x, y] = proj(r * Math.cos(a), r * Math.sin(a));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private stripFor(id: string, w: number, h: number) {
    let c = this.strips.get(id);
    if (!c) {
      c = document.createElement('canvas');
      this.strips.set(id, c);
    }
    // 크기가 커질 때만 다시 할당
    if (c.width < w || c.height < h || c.width > w * 2 || c.height > h * 2) {
      c.width = Math.max(1, w);
      c.height = Math.max(1, h);
    }
    return c;
  }

  /** 화면(디바이스 px) 좌표 → 링 번호. 원판 평면으로 역투영해 반지름으로 찾는다. 없으면 -1 */
  hit(px: number, py: number): number {
    const cam = this.hitCam;
    if (!cam || this.hitRings.length === 0) return -1;
    const v = (py - cam.cy) / cam.f;
    const den = v * cam.cos + cam.sin;
    if (Math.abs(den) < 1e-6) return -1;
    const z = (-v * cam.D) / den;
    const dep = cam.D + z * cam.cos;
    if (dep <= 0) return -1;
    const x = ((px - cam.cx) * dep) / cam.f;
    const r = Math.hypot(x, z);
    let best = -1;
    let bestD = GAP * 0.6;
    this.hitRings.forEach(({ R, s }, i) => {
      const mid = R + s * 0.45;
      const d = Math.abs(r - mid);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }
}
