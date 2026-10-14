// 칸딘스키 모드 그리기. 번짐·광택·그림자 없이 선명한 평면 벡터 (불투명 색면 + 가는 선).
import { KPAL } from './modes';
import type { Elem, PathPt, Stroke, Vec } from './stroke';

/** 잔떨림을 줄이면서 큰 굴곡은 유지 (Chaikin 2회) */
export function chaikin(pts: { x: number; y: number }[], iters = 2) {
  let p = pts;
  for (let k = 0; k < iters && p.length > 2; k++) {
    const q: { x: number; y: number }[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      q.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

function polyPath(g: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
}

// ---------------- 요소 ----------------

/** 1·2·3·5번 요소. scale·boost 는 발음·재연주 반응용 */
export function drawKElem(g: CanvasRenderingContext2D, e: Elem, scale = 1, boost = 0, spread = 1) {
  const color = e.color ?? KPAL.black;
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  switch (e.type) {
    case 'kcircle': {
      // 원 자체는 찌그러뜨리지 않는다
      g.beginPath();
      g.arc(e.x, e.y, Math.max(1, e.size * scale), 0, Math.PI * 2);
      if (e.fill) {
        g.fillStyle = color;
        g.fill();
      } else {
        g.strokeStyle = color;
        g.lineWidth = e.weight + boost;
        g.stroke();
      }
      return;
    }
    case 'vbar': {
      const L = e.size * scale;
      const top = e.y - L / 2;
      const bot = e.y + L / 2;
      g.strokeStyle = color;
      g.lineWidth = e.weight + boost * 0.5;
      g.beginPath();
      g.moveTo(e.x, top);
      g.lineTo(e.x, bot);
      g.stroke();
      // 끝에 붙은 원: 막대 끝과 실제로 겹치게 (떨어진 장식 X)
      const d = e.dots;
      if (d) {
        g.fillStyle = d.color;
        const k = 1 + boost * 0.06;
        if (d.top) {
          g.beginPath();
          g.arc(e.x, top - d.top * 0.75 * k, d.top * k, 0, Math.PI * 2);
          g.fill();
        }
        if (d.bot) {
          g.beginPath();
          g.arc(e.x, bot + d.bot * 0.75 * k, d.bot * k, 0, Math.PI * 2);
          g.fill();
        }
      }
      return;
    }
    case 'pbar': {
      const q = e.quad!;
      const pts = q.map((p) => ({ x: e.x + (p.x - e.x) * scale * spread, y: e.y + (p.y - e.y) * scale }));
      polyPath(g, pts);
      g.closePath();
      if (e.fill) {
        g.fillStyle = color;
        g.fill();
      } else {
        g.strokeStyle = color;
        g.lineWidth = e.weight + boost * 0.5;
        g.stroke();
      }
      return;
    }
    case 'bead': {
      drawBead(g, e.x, e.y, e.size * scale, e.angle, color);
      return;
    }
  }
}

/** 마름모 사각형 + 내부의 촘촘한 격자 (짙은 보라와 밝은 빈틈이 교차) */
function drawBead(g: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number, color: string) {
  const h = size / 2;
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.beginPath();
  g.rect(-h, -h, size, size);
  g.fillStyle = color;
  g.fill();
  g.clip();
  g.strokeStyle = 'rgba(255,255,255,0.62)';
  g.lineWidth = 1.1;
  g.beginPath();
  for (let v = -h + 2.6; v < h; v += 3.6) {
    g.moveTo(v, -h);
    g.lineTo(v, h);
    g.moveTo(-h, v);
    g.lineTo(h, v);
  }
  g.stroke();
  g.restore();
}

// ---------------- 4번 실선 ----------------

export function drawKLine(g: CanvasRenderingContext2D, st: Stroke, path: PathPt[], boostFrom = -1, boostTo = -1) {
  if (path.length < 2) return;
  const pts = chaikin(path);
  g.strokeStyle = st.color;
  g.lineWidth = st.lineWidth ?? 3;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  polyPath(g, pts);
  g.stroke();
  if (st.arrow) {
    const b = pts[pts.length - 1];
    const a = pts[Math.max(0, pts.length - 6)];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const s = 16;
    g.fillStyle = st.color;
    g.beginPath();
    g.moveTo(b.x + Math.cos(ang) * 4, b.y + Math.sin(ang) * 4);
    g.lineTo(b.x - Math.cos(ang - 0.42) * s, b.y - Math.sin(ang - 0.42) * s);
    g.lineTo(b.x - Math.cos(ang + 0.42) * s, b.y - Math.sin(ang + 0.42) * s);
    g.closePath();
    g.fill();
  }
  // 재생 강조: 지금 울리는 구간만 굵게
  if (boostFrom >= 0 && boostTo > boostFrom) {
    g.lineWidth = (st.lineWidth ?? 3) * 2.4 + 3;
    polyPath(g, chaikin(path.slice(boostFrom, boostTo + 1), 1));
    g.stroke();
  }
}

// ---------------- 5번 사각 점선 ----------------

export function drawBeads(g: CanvasRenderingContext2D, st: Stroke, path: PathPt[], beadScale?: (e: Elem) => number) {
  if (path.length > 1) {
    g.save();
    g.strokeStyle = KPAL.purple;
    g.globalAlpha = 0.75;
    g.lineWidth = 1.4;
    g.setLineDash([6, 6]);
    polyPath(g, chaikin(path, 1));
    g.stroke();
    g.restore();
  }
  // 점선이 각 사각형의 중심을 지나도록 사각형은 경로 위 점에 놓여 있다
  for (const e of st.elems) {
    if (e.type !== 'bead') continue;
    const k = beadScale ? beadScale(e) : 1;
    drawBead(g, e.x, e.y, e.size * k, e.angle, e.color ?? KPAL.purple);
  }
}

// ---------------- 6번 큰 노란 원 구성 ----------------

/** 붉은 계단형 색면 (원 반지름 1 기준 좌표). 레퍼런스 첫 번째 큰 원의 오른쪽 위 덩어리 */
const RED_BLOB: [number, number][] = [
  [0.3, -0.62], [0.44, -0.62], [0.44, -0.68], [0.58, -0.68], [0.58, -0.6], [0.66, -0.6], [0.66, -0.5],
  [0.72, -0.5], [0.72, -0.38], [0.62, -0.38], [0.62, -0.3], [0.5, -0.3], [0.5, -0.22], [0.36, -0.22],
  [0.36, -0.3], [0.24, -0.3], [0.24, -0.42], [0.16, -0.42], [0.16, -0.52], [0.3, -0.52],
];
const RED_SMALL: [number, number][] = [
  [0.3, 0.04], [0.38, 0.04], [0.38, 0.11], [0.44, 0.11], [0.44, 0.22], [0.34, 0.22], [0.34, 0.15], [0.27, 0.15],
];

function diagGrid(g: CanvasRenderingContext2D, R: number, step: number) {
  g.beginPath();
  for (let v = -2 * R; v <= 2 * R; v += step) {
    g.moveTo(v - R, -R);
    g.lineTo(v + R, R);
    g.moveTo(v + R, -R);
    g.lineTo(v - R, R);
  }
  g.stroke();
}

/**
 * 큰 노란 원: 굵은 노란 테두리(일부 끊김) + 성긴 노란 대각 격자 + 중앙 구조(초록 동심원·연두 색면·평행선)
 * + 붉은 계단형 격자 색면 + 작은 보라·분홍 막대. 내부는 원 안에 클리핑, 테두리만 바깥에.
 * 비율은 레퍼런스에 고정하고, 스트로크 번호로 좌우 반전·테두리 끊김 위치만 제한적으로 바꾼다.
 * sweep: 재생 강조용 (0~1, 테두리를 따라 도는 굵은 구간)
 */
export function drawSun(g: CanvasRenderingContext2D, e: Elem, pulse = 0, sweep = -1) {
  const R = e.size * (1 + 0.06 * pulse);
  const v = e.variant;
  const flip = v % 2 ? -1 : 1;
  const rot = ((v * 47) % 360) * (Math.PI / 180);
  g.save();
  g.translate(e.x, e.y);

  // ---- 내부 (클리핑) ----
  g.save();
  g.beginPath();
  g.arc(0, 0, R * 0.965, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = 'rgba(230,216,58,0.10)';
  g.fillRect(-R, -R, 2 * R, 2 * R);
  g.strokeStyle = 'rgba(214,196,40,0.55)';
  g.lineWidth = Math.max(0.8, R * 0.005);
  diagGrid(g, R, Math.max(7, R * 0.05));

  g.scale(flip, 1);
  // 붉은 계단형 색면 + 그 안의 격자
  for (const blob of [RED_BLOB, RED_SMALL]) {
    g.save();
    polyPath(g, blob.map(([x, y]) => ({ x: x * R, y: y * R })));
    g.closePath();
    g.fillStyle = KPAL.red;
    g.fill();
    g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.lineWidth = Math.max(0.6, R * 0.004);
    diagGrid(g, R, Math.max(4, R * 0.022));
    g.restore();
  }

  // 중앙 구조 (원 전체보다 충분히 작게, 살짝 위)
  g.translate(-0.02 * R, -0.04 * R);
  const c = R;
  // 짙은 점선 원
  g.save();
  g.setLineDash([Math.max(3, c * 0.012), Math.max(3, c * 0.012)]);
  g.strokeStyle = KPAL.black;
  g.lineWidth = Math.max(1, c * 0.004);
  g.beginPath();
  g.arc(0, 0, c * 0.44, 0, Math.PI * 2);
  g.stroke();
  g.restore();
  // 연두 격자 원판(부분 투명) + 초록 동심원
  g.save();
  g.beginPath();
  g.arc(0, -c * 0.02, c * 0.27, 0, Math.PI * 2);
  g.fillStyle = 'rgba(198,224,92,0.35)';
  g.fill();
  g.clip();
  g.strokeStyle = 'rgba(120,170,40,0.5)';
  g.lineWidth = Math.max(0.6, c * 0.003);
  diagGrid(g, c, Math.max(4, c * 0.025));
  g.restore();
  g.strokeStyle = KPAL.green;
  g.lineWidth = Math.max(1.5, c * 0.007);
  for (const r of [0.36, 0.2]) {
    g.beginPath();
    g.arc(0, 0, c * r, 0, Math.PI * 2);
    g.stroke();
  }
  // 부분 원호
  g.beginPath();
  g.arc(0, 0, c * 0.5, Math.PI * 1.05, Math.PI * 1.7);
  g.stroke();
  g.beginPath();
  g.arc(c * 0.04, c * 0.05, c * 0.56, Math.PI * 0.1, Math.PI * 0.45);
  g.stroke();
  // 연두 사각 색면 + 가는 세로선
  const rx = -0.2 * c;
  const ry = -0.02 * c;
  const rw = 0.4 * c;
  const rh = 0.24 * c;
  g.fillStyle = KPAL.lime;
  g.fillRect(rx, ry, rw, rh);
  g.strokeStyle = 'rgba(110,160,30,0.7)';
  g.lineWidth = Math.max(0.6, c * 0.003);
  g.beginPath();
  for (let x = rx + c * 0.02; x < rx + rw; x += Math.max(3, c * 0.018)) {
    g.moveTo(x, ry);
    g.lineTo(x, ry + rh);
  }
  g.stroke();
  // 분홍 세로 막대 (중앙 아래, 하나만)
  g.fillStyle = KPAL.magenta;
  g.fillRect(-0.025 * c, 0.1 * c, 0.05 * c, 0.3 * c);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  for (let x = -0.015 * c; x < 0.025 * c; x += Math.max(2.5, c * 0.012)) {
    g.moveTo(x, 0.1 * c);
    g.lineTo(x, 0.4 * c);
  }
  g.stroke();
  // 검정 평행선 묶음 (중앙 구조 양옆)
  g.strokeStyle = KPAL.black;
  g.lineWidth = Math.max(0.7, c * 0.0035);
  g.beginPath();
  for (const side of [-1, 1]) {
    for (let k = 0; k < 9; k++) {
      const x = side * (0.3 * c + k * c * 0.012);
      g.moveTo(x, -0.2 * c);
      g.lineTo(x, 0.2 * c);
    }
  }
  g.stroke();
  // 작은 보라 세로 막대 (제한적으로 둘)
  g.fillStyle = KPAL.purple;
  g.fillRect(-0.62 * c, 0.28 * c, 0.022 * c, 0.12 * c);
  g.fillRect(-0.58 * c, 0.3 * c, 0.022 * c, 0.09 * c);
  g.restore();

  // ---- 외곽 노란 테두리: 내부 선보다 확실히 굵게, 몇 군데 끊김 ----
  const w = Math.max(9, R * 0.075);
  g.strokeStyle = KPAL.yellow;
  g.lineWidth = w;
  g.lineCap = 'butt';
  const gaps: [number, number][] = [
    [0.35, 0.47],
    [1.9, 1.96],
    [4.3, 4.62],
  ];
  let a = 0;
  for (const [g0, g1] of gaps) {
    g.beginPath();
    g.arc(0, 0, R, rot + a, rot + g0);
    g.stroke();
    a = g1;
  }
  g.beginPath();
  g.arc(0, 0, R, rot + a, rot + Math.PI * 2 + 0.35);
  g.stroke();
  // 재생 강조: 테두리를 따라 도는 굵은 구간 (발성 진행)
  if (sweep >= 0) {
    g.lineWidth = w * 1.7;
    g.strokeStyle = KPAL.black;
    g.globalAlpha = 0.85;
    const a0 = rot + sweep * Math.PI * 2;
    g.beginPath();
    g.arc(0, 0, R + w * 0.1, a0, a0 + 0.35);
    g.stroke();
    g.globalAlpha = 1;
  }
  g.restore();
}

// ---------------- 선택 ----------------

export function pointInQuad(p: Vec, q: Vec[]) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if (q[i].y > p.y !== q[j].y > p.y && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
  }
  return inside;
}

export function hitKElem(e: Elem, p: Vec, tol: number): boolean {
  switch (e.type) {
    case 'kcircle':
      return Math.hypot(p.x - e.x, p.y - e.y) <= e.size + tol * 0.6;
    case 'vbar': {
      const extra = Math.max(e.dots?.top ?? 0, e.dots?.bot ?? 0) * 2;
      return Math.abs(p.x - e.x) <= e.weight / 2 + tol && Math.abs(p.y - e.y) <= e.size / 2 + extra;
    }
    case 'pbar':
      return pointInQuad(p, e.quad!) || Math.hypot(p.x - e.x, p.y - e.y) < tol;
    case 'sun':
      return Math.hypot(p.x - e.x, p.y - e.y) <= e.size + tol;
    default:
      return false;
  }
}
