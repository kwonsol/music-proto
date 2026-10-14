// 커버 위 벡터 그래픽의 배치(viewBox 1000×1000)와 형태 계산.
// 큰 곡선 띠가 왼쪽 아래에서 오른쪽 위로 흐름을 만들고, 원호 묶음이 그 끝에서 교차하며,
// 작은 면·선 묶음이 가장자리에서 리듬을 보완한다. 인물 얼굴(중앙 왼쪽 위)은 비워 둔다.

export type Vec = { x: number; y: number };

export const RISER = {
  p0: { x: 120, y: 950 },
  p1: { x: 165, y: 700 },
  p2: { x: 520, y: 590 },
  p3: { x: 965, y: 300 },
  w0: 2.5,
  w1: 42,
  /** 최대로 당길 수 있는 거리 */
  maxPull: 240,
};

export const ECHO = {
  arcs: [
    { c: { x: 735, y: 255 }, r: 178, rot: 205, sweep: 300, w: 5 },
    { c: { x: 640, y: 330 }, r: 104, rot: 20, sweep: 290, w: 3.5 },
    { c: { x: 575, y: 205 }, r: 58, rot: 120, sweep: 250, w: 2.5 },
  ],
};

export const KICK = { c: { x: 222, y: 922 }, r: 36 };
export const PERC = { c: { x: 590, y: 902 }, r: 40, dot: 11 };
export const HATS = [
  { c: { x: 905, y: 565 }, s: 44, rot: -6 },
  { c: { x: 914, y: 636 }, s: 38, rot: 5 },
  { c: { x: 900, y: 712 }, s: 50, rot: -11 },
];
/** 짧은 사선 묶음 A (왼쪽 위): 평행선 4개 + 가로지르는 선 1개 */
export const STUTTER_A = { c: { x: 125, y: 215 }, angle: -62, len: 120, cross: { angle: 22, len: 150 } };
/** 짧은 사선 묶음 B (오른쪽 아래 장비 위): 부채꼴로 벌어지며 교차하는 선 5개 */
export const STUTTER_B = { c: { x: 760, y: 800 }, len: 128, angles: [-34, -22, -12, -2, 14] };

export const DECOR = {
  triangle: [
    { x: 470, y: 470 },
    { x: 990, y: 615 },
    { x: 640, y: 990 },
  ],
  ellipse: { c: { x: 330, y: 792 }, rx: 255, ry: 78, rot: -28 },
  line: { a: { x: 250, y: 995 }, b: { x: 700, y: 468 } },
  bar: { a: { x: 52, y: 92 }, b: { x: 92, y: 640 } },
};

export function bezier(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

export const BAND_SAMPLES = 72;

/**
 * 곡선 띠의 중심선 점들. tension(0~1): 중음에 따라 아주 살짝 더 휘게.
 * disp: 잡아당긴 변위(grabT 주변만 가우시안으로 늘어남)
 */
export function bandCenter(tension: number, grabT: number, disp: Vec): Vec[] {
  const { p0, p1, p2, p3 } = RISER;
  const q1 = { x: p1.x - 10 * tension, y: p1.y + 6 * tension };
  const q2 = { x: p2.x, y: p2.y + 16 * tension };
  const pts: Vec[] = [];
  for (let i = 0; i <= BAND_SAMPLES; i++) {
    const t = i / BAND_SAMPLES;
    const p = bezier(p0, q1, q2, p3, t);
    const k = Math.exp(-(((t - grabT) / 0.2) ** 2));
    pts.push({ x: p.x + disp.x * k, y: p.y + disp.y * k });
  }
  return pts;
}

/** 한쪽은 가늘고 반대쪽은 넓어지는 띠 외곽선 */
export function bandPath(center: Vec[], widthScale: number): string {
  const n = center.length;
  const left: Vec[] = [];
  const right: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = center[Math.max(0, i - 1)];
    const b = center[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const t = i / (n - 1);
    const w = (RISER.w0 + (RISER.w1 - RISER.w0) * Math.pow(t, 1.5)) * widthScale * 0.5;
    left.push({ x: center[i].x + nx * w, y: center[i].y + ny * w });
    right.push({ x: center[i].x - nx * w, y: center[i].y - ny * w });
  }
  const f = (p: Vec) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  return `M${left.map(f).join('L')}L${right.reverse().map(f).join('L')}Z`;
}

export function polyline(pts: Vec[]): string {
  return 'M' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L');
}

export function nearestT(center: Vec[], p: Vec): number {
  let best = 0;
  let bd = Infinity;
  center.forEach((c, i) => {
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best / (center.length - 1);
}

/** 끊어진 원호. rot: 시작각(도), sweep: 그리는 각도(도) */
export function arcPath(c: Vec, r: number, rot: number, sweep: number): string {
  const s = Math.max(10, Math.min(350, sweep));
  const a0 = (rot * Math.PI) / 180;
  const a1 = ((rot + s) * Math.PI) / 180;
  const x0 = c.x + r * Math.cos(a0);
  const y0 = c.y + r * Math.sin(a0);
  const x1 = c.x + r * Math.cos(a1);
  const y1 = c.y + r * Math.sin(a1);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r.toFixed(1)} ${r.toFixed(1)} 0 ${s > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

export function rad(deg: number) {
  return (deg * Math.PI) / 180;
}

/** 배경 휘도 측정용 대표 점들 */
export function samplePoints(): Record<string, Vec[]> {
  const band = bandCenter(0, 0.5, { x: 0, y: 0 }).filter((_, i) => i % 6 === 0);
  const arcs = ECHO.arcs.flatMap((a) =>
    Array.from({ length: 10 }, (_, i) => {
      const ang = rad(a.rot + (a.sweep * i) / 9);
      return { x: a.c.x + a.r * Math.cos(ang), y: a.c.y + a.r * Math.sin(ang) };
    }),
  );
  const tri = DECOR.triangle;
  return {
    riser: band,
    echo: arcs,
    kick: [KICK.c],
    perc: [PERC.c, { x: PERC.c.x + PERC.r, y: PERC.c.y }, { x: PERC.c.x - PERC.r, y: PERC.c.y }],
    hat: HATS.map((h) => h.c),
    stutterA: [STUTTER_A.c, { x: STUTTER_A.c.x - 40, y: STUTTER_A.c.y + 40 }, { x: STUTTER_A.c.x + 40, y: STUTTER_A.c.y - 40 }],
    stutterB: [STUTTER_B.c, { x: STUTTER_B.c.x + 50, y: STUTTER_B.c.y - 10 }, { x: STUTTER_B.c.x - 50, y: STUTTER_B.c.y + 10 }],
    triangle: tri,
    ellipse: [DECOR.ellipse.c, { x: DECOR.ellipse.c.x - 200, y: DECOR.ellipse.c.y + 100 }, { x: DECOR.ellipse.c.x + 200, y: DECOR.ellipse.c.y - 100 }],
    line: [DECOR.line.a, DECOR.line.b],
    bar: [DECOR.bar.a, DECOR.bar.b],
  };
}
