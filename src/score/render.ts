// 캔버스 그리기와 기존 요소 선택. 모든 좌표는 월드 단위(커버 = [-500,500]²)이고, 호출 전에 화면 변환이 걸려 있다.
import { drawBeads, drawKElem, drawKLine, drawSun, hitKElem } from './kandinsky';
import { drawCheer, drawRecord, drawSpray, drawSprayPuff, drawStamp, drawWord, hitWord } from './hiphop';
import { H_BRUSHES, K_BRUSHES, type Elem, type PathPt, type RibbonSlice, type Stroke, type Vec } from './stroke';

const K_ELEMS = new Set(['kcircle', 'vbar', 'pbar', 'bead']);

/** 이미 그린 요소 중 무엇을 집었는지 */
export type Target =
  | { stroke: number; kind: 'elem'; idx: number }
  | { stroke: number; kind: 'path'; idx: number }
  | { stroke: number; kind: 'slice'; idx: number };

/** 기존 요소를 누르거나 끌 때의 일시적 변형. 놓으면 스프링으로 0 으로 돌아간다 */
export interface Deform {
  target: Target;
  /** 끈 변위 (월드 단위, 제한됨) */
  dx: number;
  dy: number;
  /** 클릭 반응 스프링 값 (-1~1 근처) */
  pulse: number;
}

const GLYPH_FONT = (size: number) => `600 ${size.toFixed(1)}px Georgia, "Times New Roman", "Noto Serif", serif`;

// ---------------- 경로 유틸 ----------------

function normals(path: PathPt[], win: number) {
  const n = path.length;
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - win)];
    const b = path[Math.min(n - 1, i + win)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    out.push({ x: -(b.y - a.y) / len, y: (b.x - a.x) / len });
  }
  return out;
}

export function nearestPathIdx(path: PathPt[], p: Vec) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = (path[i].x - p.x) ** 2 + (path[i].y - p.y) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return { idx: best, dist: Math.sqrt(bd) };
}

/** 변형이 걸린 경로: 잡은 지점 주변만 가우시안으로 끌리고, 클릭 반응은 법선 방향 떨림 */
function deformedPath(st: Stroke, d: Deform | undefined, sigmaPts: number): PathPt[] {
  if (!d || d.target.kind !== 'path') return st.path;
  const c = d.target.idx;
  const nr = normals(st.path, 3);
  return st.path.map((p, i) => {
    const k = Math.exp(-(((i - c) / sigmaPts) ** 2));
    const wob = d.pulse * 16 * k;
    return { ...p, x: p.x + d.dx * k + nr[i].x * wob, y: p.y + d.dy * k + nr[i].y * wob };
  });
}

// ---------------- 이미지 스트레치 (직사각형 단면) ----------------

function sliceShift(st: Stroke, j: number, d: Deform | undefined): Vec {
  if (!d || d.target.kind !== 'slice') return { x: 0, y: 0 };
  const dist = Math.abs(j - d.target.idx);
  if (dist > 10) return { x: 0, y: 0 };
  const k = 1 - dist / 11;
  const s = st.ribbon!.slices[j];
  // 계단 느낌을 살리려 6 단위로 끊어 민다
  const q = (v: number) => Math.round(v / 6) * 6;
  const push = d.pulse * 22 * k;
  return { x: q(d.dx * k + (s.horiz ? 0 : push)), y: q(d.dy * k + (s.horiz ? push : 0)) };
}

function sliceRect(s: RibbonSlice, sh: Vec) {
  const w = s.horiz ? s.len : s.w;
  const h = s.horiz ? s.w : s.len;
  return { x: s.x + sh.x - w / 2, y: s.y + sh.y - h / 2, w, h };
}

function drawSlice(g: CanvasRenderingContext2D, s: RibbonSlice, sh: Vec) {
  const r = sliceRect(s, sh);
  const N = s.colors.length;
  // 단면 안의 줄: 진행 방향을 따라 길게 이어지는 색줄. 이음새가 보이지 않게 아주 조금 겹친다
  for (let k = 0; k < N; k++) {
    g.fillStyle = s.colors[k];
    if (s.horiz) g.fillRect(r.x, r.y + (k * r.h) / N, r.w, r.h / N + 0.6);
    else g.fillRect(r.x + (k * r.w) / N, r.y, r.w / N + 0.6, r.h);
  }
}

export function drawRibbon(g: CanvasRenderingContext2D, st: Stroke, d?: Deform) {
  const rb = st.ribbon;
  if (!rb) return;
  rb.slices.forEach((s, j) => drawSlice(g, s, sliceShift(st, j, d)));
}

// ---------------- 곡선 띠 ----------------

function bandOutline(path: PathPt[], widthOf: (i: number) => number, i0: number, i1: number) {
  const nr = normals(path, 3);
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = i0; i <= i1; i++) {
    const w = widthOf(i) / 2;
    left.push([path[i].x + nr[i].x * w, path[i].y + nr[i].y * w]);
    right.push([path[i].x - nr[i].x * w, path[i].y - nr[i].y * w]);
  }
  const p = new Path2D();
  left.forEach(([x, y], j) => (j ? p.lineTo(x, y) : p.moveTo(x, y)));
  for (let j = right.length - 1; j >= 0; j--) p.lineTo(right[j][0], right[j][1]);
  p.closePath();
  return p;
}

/** 곡선 띠 굵기: 가늘게 시작 → 중간에서 넓게 → 끝에서 다시 가늘게 */
export function bandWidth(path: PathPt[], i: number) {
  const total = path[path.length - 1].s;
  const s = path[i].s;
  const head = Math.min(1, s / 160);
  const tail = Math.min(1, (total - s) / 160);
  const ease = (x: number) => x * x * (3 - 2 * x);
  return Math.max(2, path[i].w * ease(head) * ease(Math.max(0, tail)));
}

function drawBand(g: CanvasRenderingContext2D, st: Stroke, d?: Deform) {
  if (st.path.length < 2) return;
  const path = deformedPath(st, d, 18);
  g.fillStyle = st.color;
  g.fill(bandOutline(path, (i) => bandWidth(st.path, i), 0, path.length - 1));
}

// ---------------- 코러스: 가는 곡선 + 글자 ----------------

/** 변형 중 글자의 위치·크기: 잡은 지점 근처 글자는 커지고 서로 간격이 벌어진다 */
function glyphPose(st: Stroke, e: Elem, path: PathPt[], d: Deform | undefined) {
  const base = nearestPathIdx(st.path, e).idx;
  const p = path[base];
  let x = e.x + (p.x - st.path[base].x);
  let y = e.y + (p.y - st.path[base].y);
  let scale = 1;
  if (d && d.target.kind === 'path') {
    const di = base - d.target.idx;
    const k = Math.exp(-((di / 30) ** 2));
    scale = 1 + 0.4 * Math.abs(d.pulse) * k + Math.min(0.3, Math.hypot(d.dx, d.dy) / 200) * k;
    // 간격 벌어짐: 잡은 지점에서 바깥쪽으로 경로 방향을 따라 밀기
    const spread = (Math.abs(d.pulse) * 14 + Math.hypot(d.dx, d.dy) * 0.25) * k * Math.sign(di || 1);
    x += Math.cos(e.angle) * spread;
    y += Math.sin(e.angle) * spread;
  }
  return { x, y, scale };
}

function drawGlyph(g: CanvasRenderingContext2D, e: Elem, x: number, y: number, size: number, color: string, boost = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(e.angle);
  g.font = GLYPH_FONT(size);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // 밝은 배경·어두운 커버 양쪽에서 읽히도록 얇은 밝은 테두리 + 진한 글자
  g.lineJoin = 'round';
  g.strokeStyle = boost > 0 ? `rgba(255,255,255,${0.6 + 0.4 * Math.min(1, boost)})` : 'rgba(247,246,242,0.85)';
  g.lineWidth = size * 0.14 + boost * 8;
  g.strokeText(e.ch!, 0, 0);
  g.fillStyle = color;
  g.fillText(e.ch!, 0, 0);
  g.restore();
}

function drawChoir(g: CanvasRenderingContext2D, st: Stroke, d?: Deform, glyphBoost?: (e: Elem) => number) {
  const path = deformedPath(st, d, 22);
  const glyphs = st.elems.filter((e) => e.type === 'glyph');
  const poses = glyphs.map((e) => ({ e, ...glyphPose(st, e, path, d) }));
  // 선은 글자 자리에서 끊겨 글자를 관통하지 않고 "글자가 선의 마디"가 되게
  g.strokeStyle = st.color;
  g.lineWidth = 3.2;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  let down = false;
  for (const p of path) {
    const inGap = poses.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < q.e.size * q.scale * 0.52);
    if (inGap) {
      down = false;
      continue;
    }
    if (!down) g.moveTo(p.x, p.y);
    else g.lineTo(p.x, p.y);
    down = true;
  }
  g.stroke();
  // 글자에서 뻗는 가는 곡선 가지
  for (const e of st.elems) if (e.type === 'ring') drawElem(g, e, st.color);
  for (const q of poses) {
    const b = glyphBoost ? glyphBoost(q.e) : 0;
    drawGlyph(g, q.e, q.x, q.y, q.e.size * q.scale * (1 + 0.35 * b), st.color, b);
  }
}

// ---------------- 벡터 요소 ----------------

function elemPath(g: CanvasRenderingContext2D, e: Elem, scale: number, spread = 1) {
  const s = e.size * scale;
  g.beginPath();
  switch (e.type) {
    case 'arc':
    case 'ring': {
      const a = e.arc!;
      g.arc(a.cx, a.cy, a.r * (e.type === 'ring' ? scale : 1), a.a0, a.a1, a.ccw);
      break;
    }
    case 'circle':
      g.arc(e.x, e.y, s, 0, Math.PI * 2);
      break;
    case 'triangle': {
      // 한쪽으로 기운 삼각형 (진행 방향을 가리킴)
      const pts = [
        [1.15, 0],
        [-0.6, 0.72],
        [-0.45, -0.8],
      ].map(([u, v]) => [e.x + (Math.cos(e.angle) * u - Math.sin(e.angle) * v) * s, e.y + (Math.sin(e.angle) * u + Math.cos(e.angle) * v) * s]);
      g.moveTo(pts[0][0], pts[0][1]);
      g.lineTo(pts[1][0], pts[1][1]);
      g.lineTo(pts[2][0], pts[2][1]);
      g.closePath();
      break;
    }
    case 'square': {
      const c = Math.cos(e.angle);
      const sn = Math.sin(e.angle);
      const pts = [
        [-1, -1],
        [1, -0.9],
        [1.05, 1],
        [-0.95, 1],
      ].map(([u, v]) => [e.x + (c * u - sn * v) * s * 0.5, e.y + (sn * u + c * v) * s * 0.5]);
      pts.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      break;
    }
    case 'hatch': {
      // 진행 방향을 따라 늘어선 짧은 평행선 (spread: 선 사이 간격 배율)
      const n = 3 + (e.variant % 2);
      const la = e.angle + 1.15 + (e.variant % 3) * 0.12;
      const lx = Math.cos(la);
      const ly = Math.sin(la);
      const tx = Math.cos(e.angle);
      const ty = Math.sin(e.angle);
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * 15 * scale * spread;
        const cx = e.x + tx * o;
        const cy = e.y + ty * o;
        g.moveTo(cx - (lx * s) / 2, cy - (ly * s) / 2);
        g.lineTo(cx + (lx * s) / 2, cy + (ly * s) / 2);
      }
      break;
    }
    case 'glyph':
      break;
  }
}

export function drawElem(g: CanvasRenderingContext2D, e: Elem, color: string, scale = 1, boost = 0, spread = 1) {
  if (e.type === 'glyph') return;
  if (K_ELEMS.has(e.type)) {
    // 칸딘스키 요소는 자기 색을 쓴다 (강조용 color 인자는 무시). scale·boost 로만 반응
    drawKElem(g, e, scale, boost, spread);
    return;
  }
  if (e.type === 'sun') {
    drawSun(g, e, scale - 1);
    return;
  }
  if (e.type === 'hword') return drawWord(g, e, scale);
  if (e.type === 'hcheer') return drawCheer(g, e, boost * 0.05, scale);
  if (e.type === 'hrecord') return drawRecord(g, e, e.angle, scale);
  if (e.type === 'hstamp') return drawStamp(g, e);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'miter';
  elemPath(g, e, scale, spread);
  if (e.type === 'circle') g.fill();
  else {
    g.lineWidth = e.weight + boost;
    g.stroke();
  }
  if (e.type === 'hatch') {
    // 굵은 선 하나 + 가로지르는 가는 선 (굵기 대비)
    const la = e.angle + 1.15 + (e.variant % 3) * 0.12;
    const L = e.size * scale;
    const o = ((e.variant % 2 ? 1 : -1) * 15 * scale * spread) / 2;
    g.beginPath();
    g.moveTo(e.x + Math.cos(e.angle) * o - (Math.cos(la) * L) / 2, e.y + Math.sin(e.angle) * o - (Math.sin(la) * L) / 2);
    g.lineTo(e.x + Math.cos(e.angle) * o + (Math.cos(la) * L) / 2, e.y + Math.sin(e.angle) * o + (Math.sin(la) * L) / 2);
    g.lineWidth = 7.5 + boost;
    g.stroke();
    const ca = e.angle - 0.28;
    const CL = L * 1.35;
    g.beginPath();
    g.moveTo(e.x - (Math.cos(ca) * CL) / 2, e.y - (Math.sin(ca) * CL) / 2);
    g.lineTo(e.x + (Math.cos(ca) * CL) / 2, e.y + (Math.sin(ca) * CL) / 2);
    g.lineWidth = 2.2 + boost * 0.5;
    g.stroke();
  }
}

/** 변형 중인 벡터 요소: 원호는 휘고 떨림, 사선은 벌어짐, 도형은 눌렸다 튀어나옴 */
function drawElemDeformed(g: CanvasRenderingContext2D, e: Elem, color: string, d: Deform) {
  const drag = Math.hypot(d.dx, d.dy);
  if (e.type === 'arc' && e.arc) {
    const a = e.arc;
    const bent: Elem = { ...e, arc: { ...a, cx: a.cx - d.dx * 0.5, cy: a.cy - d.dy * 0.5, r: a.r * (1 + 0.14 * d.pulse) + drag * 0.3 } };
    drawElem(g, bent, color, 1, Math.abs(d.pulse) * 3);
    return;
  }
  if (e.type === 'hatch') {
    drawElem(g, { ...e, x: e.x + d.dx * 0.3, y: e.y + d.dy * 0.3 }, color, 1, 0, 1 + 0.9 * Math.abs(d.pulse) + Math.min(1.2, drag / 50));
    return;
  }
  if (e.type === 'sun') {
    // 큰 원: 테두리가 숨쉬듯 커졌다 돌아온다 (위치는 그대로)
    drawSun(g, e, -d.pulse * 0.6 + Math.min(0.15, drag / 300));
    return;
  }
  if (e.type === 'vbar') {
    // 세로 막대: 눌리면 줄었다 늘어나고, 끝의 원이 커졌다 돌아옴
    drawKElem(g, { ...e, x: e.x + d.dx * 0.6, y: e.y + d.dy * 0.3 }, 1 - 0.25 * d.pulse, Math.abs(d.pulse) * 6);
    return;
  }
  if (e.type === 'pbar') {
    // 투시 막대: 좌우로 늘었다 돌아옴 (원래 투시는 유지)
    drawKElem(g, { ...e, quad: e.quad!.map((q) => ({ x: q.x + d.dx, y: q.y + d.dy })), x: e.x + d.dx, y: e.y + d.dy }, 1, 0, 1 - 0.2 * d.pulse);
    return;
  }
  // 도형: 클릭하면 눌렸다(작아짐) 튀어나오고, 끌면 따라오다가 놓으면 돌아온다
  drawElem(g, { ...e, x: e.x + d.dx, y: e.y + d.dy }, color, 1 - 0.3 * d.pulse);
}

/** 사각 점선: 잡은 지점 근처 사각형이 커졌다 벌어짐 */
function beadScaleFor(st: Stroke, d: Deform | undefined) {
  if (!d || d.target.kind !== 'path') return undefined;
  const c = st.path[d.target.idx];
  return (e: Elem) => {
    const k = Math.exp(-((Math.hypot(e.x - c.x, e.y - c.y) / 120) ** 2));
    return 1 + 0.45 * Math.abs(d.pulse) * k + Math.min(0.35, Math.hypot(d.dx, d.dy) / 140) * k;
  };
}

// ---------------- 스트로크 ----------------

/** 스트로크를 그린다. d 가 있으면 그 변형을 적용 */
export function drawStroke(g: CanvasRenderingContext2D, st: Stroke, d?: Deform, glyphBoost?: (e: Elem) => number) {
  if (H_BRUSHES.has(st.brush)) return drawHStroke(g, st, d);
  if (st.brush === 'ribbon') drawRibbon(g, st, d);
  else if (st.brush === 'kline') drawKLine(g, st, deformedPath(st, d, 22));
  else if (st.brush === 'beads') drawBeads(g, st, deformedPath(st, d, 22), beadScaleFor(st, d));
  else if (st.brush === 'band') drawBand(g, st, d);
  else if (st.brush === 'choir') drawChoir(g, st, d, glyphBoost);
  else
    st.elems.forEach((e, i) => {
      if (d && d.target.kind === 'elem' && d.target.idx === i) drawElemDeformed(g, e, st.color, d);
      else drawElem(g, e, st.color);
    });
}

/** 힙합 스트로크. 재연주 변형: 타이포는 눌렸다 튀어나옴, 인물은 흔들림, 레코드는 회전, 커버 단면은 밀렸다 복원 */
function drawHStroke(g: CanvasRenderingContext2D, st: Stroke, d?: Deform) {
  const target = d && d.target.kind === 'elem' ? d.target.idx : -1;
  switch (st.brush) {
    case 'hcover': {
      drawRibbon(g, st, d);
      const stamp = st.elems[0];
      if (stamp) drawStamp(g, stamp, d && d.target.kind === 'slice' && d.target.idx < 3 ? d.dx * 0.3 : 0, 0);
      return;
    }
    case 'htype':
      st.elems.forEach((e, i) => drawWord(g, e, i === target ? 1 - 0.28 * d!.pulse : 1));
      return;
    case 'hcheer':
      st.elems.forEach((e, i) => (i === target ? drawCheer(g, { ...e, x: e.x + d!.dx * 0.5, y: e.y + d!.dy * 0.5 }, d!.pulse) : drawCheer(g, e)));
      return;
    case 'hrecord': {
      const e = st.elems[0];
      if (e) drawRecord(g, e, e.angle + (d ? d.dx * 0.06 + d.pulse * 0.15 : 0));
      return;
    }
    case 'hspray':
      drawSpray(g, st, performance.now() / 1000);
      if (d) {
        const c = st.path[d.target.idx] ?? st.path[0];
        drawSprayPuff(g, st, { x: c.x + d.dx * 0.3, y: c.y + d.dy * 0.3 }, Math.min(1, Math.abs(d.pulse) + 0.3));
      }
      return;
  }
}

/** 레코드: 기록된 각도(지속음 파라미터 3번째 값)를 재생 시각에 맞춰 읽는다 */
function recordAngleAt(st: Stroke, local: number, L: number): number | null {
  const ch = st.audio?.chunks;
  if (!ch) return null;
  for (const c of ch) {
    if (!c.auto || local > c.length + 0.05) continue;
    const pts = c.auto;
    let i = 0;
    while (i < pts.length - 1 && pts[i + 1].t < local) i++;
    const a = pts[i];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const k = b.t > a.t ? Math.min(1, Math.max(0, (local - a.t) / (b.t - a.t))) : 0;
    return a.v[2] + (b.v[2] - a.v[2]) * k;
  }
  void L;
  return null;
}

function drawHHighlight(g: CanvasRenderingContext2D, st: Stroke, local: number, L: number) {
  switch (st.brush) {
    case 'htype':
      for (const e of st.elems) {
        const dt = local - (e.t % L);
        if (dt >= 0 && dt < 0.32) {
          const k = 1 - dt / 0.32;
          drawWord(g, e, 1 + 0.18 * k * k);
        }
      }
      return;
    case 'hcheer':
      for (const e of st.elems) {
        if (e.local == null) continue;
        const dt = local - e.local;
        if (dt >= 0 && dt < 0.35) drawCheer(g, e, Math.sin(dt * 40) * (1 - dt / 0.35), 1 + 0.08 * (1 - dt / 0.35));
      }
      return;
    case 'hrecord': {
      const e = st.elems[0];
      const a = recordAngleAt(st, local, L);
      // 기록된 손놀림 그대로 판이 앞뒤로 돈다
      if (e && a != null) drawRecord(g, e, a);
      return;
    }
    case 'hspray': {
      const path = st.path;
      for (let i = 0; i < path.length; i += 3) {
        const dt = local - (path[i].t % L);
        if (dt >= 0 && dt < 0.12) drawSprayPuff(g, st, path[i], 1 - dt / 0.12);
      }
      return;
    }
    case 'hcover':
      drawHighlightRibbon(g, st, local, L);
      return;
  }
}

function drawHighlightRibbon(g: CanvasRenderingContext2D, st: Stroke, local: number, L: number) {
  if (!st.ribbon) return;
  g.save();
  g.globalCompositeOperation = 'screen';
  g.fillStyle = 'rgba(255,255,255,0.5)';
  for (const s of st.ribbon.slices) {
    const tl = s.t % L;
    if (tl <= local && tl > local - 0.22) {
      const r = sliceRect(s, { x: 0, y: 0 });
      g.fillRect(r.x, r.y, r.w, r.h);
    }
  }
  g.restore();
}

/** 재생 강조: 지속음은 지금 울리는 구간만 경로를 따라 이동, 타격은 해당 도형만, 글자는 지나갈 때 하나씩 */
export function drawHighlight(g: CanvasRenderingContext2D, st: Stroke, local: number | null, L: number) {
  if (local == null) return;
  if (H_BRUSHES.has(st.brush)) return drawHHighlight(g, st, local, L);
  const win = 0.22;
  if (st.brush === 'kline' || st.brush === 'beads') {
    // 지금 울리는 경로 구간만: 실선은 그 구간이 굵어지고, 사각 점선은 지나가는 사각형이 하나씩 커진다
    const path = st.path;
    let i0 = -1;
    let i1 = -1;
    for (let i = 0; i < path.length; i++) {
      const tl = path[i].t % L;
      if (tl <= local && tl > local - win) {
        if (i0 < 0) i0 = i;
        i1 = i;
      }
    }
    if (st.brush === 'kline') {
      if (i0 >= 0) drawKLine(g, st, path, i0, i1);
    } else {
      drawBeads(g, { ...st, elems: st.elems.filter((e) => e.type === 'bead' && local - (e.t % L) >= 0 && local - (e.t % L) < 0.35) }, [], (e) => {
        const k = 1 - (local - (e.t % L)) / 0.35;
        return 1 + 0.45 * k * k;
      });
    }
    return;
  }
  if (st.brush === 'sun') {
    const e = st.elems[0];
    if (!e) return;
    const dur = Math.max(0.2, Math.min(L, st.duration));
    if (local <= dur + 0.25) drawSun(g, e, Math.max(0, 1 - local / 0.3) * 0.5, Math.min(1, local / dur));
    return;
  }
  if (st.brush === 'ribbon' && st.ribbon) {
    g.save();
    g.globalCompositeOperation = 'screen';
    g.fillStyle = 'rgba(255,255,255,0.5)';
    for (const s of st.ribbon.slices) {
      const tl = s.t % L;
      if (tl <= local && tl > local - win) {
        const r = sliceRect(s, { x: 0, y: 0 });
        g.fillRect(r.x, r.y, r.w, r.h);
      }
    }
    g.restore();
    return;
  }
  if (st.brush === 'band' || st.brush === 'choir') {
    const path = st.path;
    const runs: [number, number][] = [];
    for (let i = 0; i < path.length; i++) {
      const tl = path[i].t % L;
      if (tl <= local && tl > local - win) {
        const r = runs[runs.length - 1];
        if (r && r[1] === i - 1) r[1] = i;
        else runs.push([i, i]);
      }
    }
    for (const [a0, a1] of runs) {
      const i0 = Math.max(0, a0 - 1);
      const i1 = Math.min(path.length - 1, a1 + 1);
      g.save();
      if (st.brush === 'band') {
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.fill(bandOutline(path, (i) => bandWidth(path, i) * 1.25 + 4, i0, i1));
        g.fillStyle = st.color;
        g.fill(bandOutline(path, (i) => bandWidth(path, i) * 0.6, i0, i1));
      } else {
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.lineWidth = 9;
        g.lineCap = 'round';
        g.beginPath();
        for (let i = i0; i <= i1; i++) (i === i0 ? g.moveTo : g.lineTo).call(g, path[i].x, path[i].y);
        g.stroke();
        g.strokeStyle = st.color;
        g.lineWidth = 4;
        g.stroke();
      }
      g.restore();
    }
    if (st.brush === 'choir') {
      // 글자는 그 글자를 그린 시각이 지나갈 때 하나씩 커졌다 돌아온다
      for (const e of st.elems) {
        if (e.type !== 'glyph') continue;
        const dt = local - (e.t % L);
        if (dt >= 0 && dt < 0.35) {
          const k = 1 - dt / 0.35;
          drawGlyph(g, e, e.x, e.y, e.size * (1 + 0.3 * k * k), st.color, k);
        }
      }
    }
    return;
  }
  for (const e of st.elems) {
    if (e.local == null) continue;
    const dt = local - e.local;
    if (dt >= 0 && dt < 0.28) pulse(g, e, st.color, 1 - dt / 0.28);
  }
}

/** 발음 순간 짧게 커지고 강조 */
export function pulse(g: CanvasRenderingContext2D, e: Elem, color: string, k: number) {
  const amt = k * k;
  g.save();
  g.globalAlpha = 0.5 * amt;
  drawElem(g, e, '#ffffff', 1 + 0.6 * amt, 14 * amt);
  g.globalAlpha = 1;
  drawElem(g, e, color, 1 + 0.4 * amt, 4 * amt);
  g.restore();
}

// ---------------- 점광 ----------------

/**
 * 시작점 주변·초반 경로의 작은 점: 진한 보색 점 + 작은 밝은 중심 + 약한 번짐.
 * age: 마지막 발음(또는 그리기 시작)부터 지난 시간(초). 점마다 delay 만큼 늦게 반짝여 차례로 번진다.
 */
export function drawSparks(g: CanvasRenderingContext2D, st: Stroke, age: number) {
  for (const sp of st.sparks) {
    const a = age - sp.delay;
    const f = a >= 0 ? Math.exp(-a / 0.22) : 0;
    g.globalAlpha = 0.1 + 0.3 * f;
    g.fillStyle = st.color;
    g.beginPath();
    g.arc(sp.x, sp.y, sp.r * (2 + 1.2 * f), 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.85;
    g.beginPath();
    g.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.55 + 0.45 * f;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(sp.x, sp.y, sp.r * (0.32 + 0.4 * f), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

// ---------------- 선택 ----------------

/** 화면에 보이는 맨 위 요소부터 검사. tol: 월드 단위 여유 (얇은 선도 잡기 쉽게) */
export function hitTest(strokes: Stroke[], p: Vec, tol: number): Target | null {
  for (let si = strokes.length - 1; si >= 0; si--) {
    const st = strokes[si];
    if (H_BRUSHES.has(st.brush)) {
      const t = hitH(st, p, tol);
      if (t) return t;
      continue;
    }
    if (st.brush === 'kline' || st.brush === 'beads') {
      for (let k = st.elems.length - 1; k >= 0; k--) {
        const e = st.elems[k];
        if (e.type === 'bead' && Math.hypot(p.x - e.x, p.y - e.y) < e.size * 0.75 + tol * 0.5)
          return { stroke: st.id, kind: 'path', idx: nearestPathIdx(st.path, e).idx };
      }
      const { idx, dist } = nearestPathIdx(st.path, p);
      if (dist <= (st.lineWidth ?? 2) / 2 + tol) return { stroke: st.id, kind: 'path', idx };
      continue;
    }
    if (K_BRUSHES.has(st.brush)) {
      for (let k = st.elems.length - 1; k >= 0; k--) if (hitKElem(st.elems[k], p, tol)) return { stroke: st.id, kind: 'elem', idx: k };
      continue;
    }
    if (st.brush === 'ribbon' && st.ribbon) {
      const sl = st.ribbon.slices;
      for (let j = sl.length - 1; j >= 0; j--) {
        const r = sliceRect(sl[j], { x: 0, y: 0 });
        if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return { stroke: st.id, kind: 'slice', idx: j };
      }
      continue;
    }
    if (st.brush === 'band') {
      const { idx, dist } = nearestPathIdx(st.path, p);
      if (dist <= bandWidth(st.path, idx) / 2 + tol) return { stroke: st.id, kind: 'path', idx };
      continue;
    }
    if (st.brush === 'choir') {
      for (let k = st.elems.length - 1; k >= 0; k--) {
        const e = st.elems[k];
        if (e.type === 'glyph' && Math.hypot(p.x - e.x, p.y - e.y) < e.size * 0.6 + tol * 0.5)
          return { stroke: st.id, kind: 'path', idx: nearestPathIdx(st.path, e).idx };
      }
      const { idx, dist } = nearestPathIdx(st.path, p);
      if (dist <= 4 + tol) return { stroke: st.id, kind: 'path', idx };
      continue;
    }
    for (let k = st.elems.length - 1; k >= 0; k--) {
      const e = st.elems[k];
      if (!e.hit) continue;
      if (e.type === 'arc' && e.arc) {
        const a = e.arc;
        const d = Math.hypot(p.x - a.cx, p.y - a.cy);
        if (Math.abs(d - a.r) > e.weight / 2 + tol) continue;
        // 실제로 그려진 각도 범위 안인지
        const norm = (v: number) => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const ang = Math.atan2(p.y - a.cy, p.x - a.cx);
        const sweep = a.ccw ? norm(a.a0 - a.a1) : norm(a.a1 - a.a0);
        const at = a.ccw ? norm(a.a0 - ang) : norm(ang - a.a0);
        if (at <= sweep) return { stroke: st.id, kind: 'elem', idx: k };
        continue;
      }
      const reach = e.type === 'hatch' ? e.size * 0.75 : e.size + tol * 0.6;
      if (Math.hypot(p.x - e.x, p.y - e.y) <= reach) return { stroke: st.id, kind: 'elem', idx: k };
    }
  }
  return null;
}

function hitH(st: Stroke, p: Vec, tol: number): Target | null {
  const id = st.id;
  switch (st.brush) {
    case 'hcover': {
      const e = st.elems[0];
      if (e && Math.abs(p.x - e.x) <= e.size / 2 && Math.abs(p.y - e.y) <= e.size / 2) return { stroke: id, kind: 'slice', idx: 0 };
      const sl = st.ribbon?.slices ?? [];
      for (let j = sl.length - 1; j >= 0; j--) {
        const r = sliceRect(sl[j], { x: 0, y: 0 });
        if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return { stroke: id, kind: 'slice', idx: j };
      }
      return null;
    }
    case 'htype':
      for (let k = st.elems.length - 1; k >= 0; k--) if (hitWord(st.elems[k], p)) return { stroke: id, kind: 'elem', idx: k };
      return null;
    case 'hcheer':
      for (let k = st.elems.length - 1; k >= 0; k--) {
        const e = st.elems[k];
        if (Math.hypot(p.x - e.x, p.y - e.y) < e.size * 0.42 + tol * 0.3) return { stroke: id, kind: 'elem', idx: k };
      }
      return null;
    case 'hrecord': {
      const e = st.elems[0];
      return e && Math.hypot(p.x - e.x, p.y - e.y) <= e.size * 0.98 ? { stroke: id, kind: 'elem', idx: 0 } : null;
    }
    case 'hspray': {
      const { idx, dist } = nearestPathIdx(st.path, p);
      return dist <= 28 + tol ? { stroke: id, kind: 'path', idx } : null;
    }
  }
  return null;
}

/** 호버: 어떤 요소가 선택될지 은은하게 표시 */
export function drawHover(g: CanvasRenderingContext2D, st: Stroke, t: Target) {
  g.save();
  if (t.kind === 'slice' && st.ribbon) {
    const lo = Math.max(0, t.idx - 6);
    const hi = Math.min(st.ribbon.slices.length - 1, t.idx + 6);
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    for (let j = lo; j <= hi; j++) {
      const r = sliceRect(st.ribbon.slices[j], { x: 0, y: 0 });
      g.strokeRect(r.x, r.y, r.w, r.h);
    }
  } else if (H_BRUSHES.has(st.brush)) {
    g.strokeStyle = 'rgba(20,20,20,0.35)';
    g.lineWidth = 2;
    g.setLineDash([6, 5]);
    g.beginPath();
    if (t.kind === 'path') {
      const c = st.path[t.idx];
      g.arc(c.x, c.y, 34, 0, Math.PI * 2);
    } else if (t.kind === 'slice') {
      const e = st.elems[0];
      if (t.idx === 0 && e) g.rect(e.x - e.size / 2 - 5, e.y - e.size / 2 - 5, e.size + 10, e.size + 10);
      else if (st.ribbon) {
        const r = sliceRect(st.ribbon.slices[t.idx], { x: 0, y: 0 });
        g.rect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
      }
    } else {
      const e = st.elems[t.idx];
      if (e.type === 'hword') {
        const w = e.size * 0.98 * (e.ch?.length ?? 3);
        g.save();
        g.translate(e.x, e.y);
        g.rotate(e.angle);
        g.rect(-w / 2 - 6, -e.size * 0.45, w + 12, e.size * 0.9);
        g.restore();
      } else g.arc(e.x, e.y, e.type === 'hrecord' ? e.size + 8 : e.size * 0.48, 0, Math.PI * 2);
    }
    g.stroke();
  } else if (K_BRUSHES.has(st.brush)) {
    // 흰 캔버스: 회색 반투명 윤곽으로 은은하게
    g.strokeStyle = 'rgba(40,40,40,0.28)';
    g.lineWidth = 2;
    g.setLineDash([5, 5]);
    if (t.kind === 'path') {
      const lo = Math.max(0, t.idx - 20);
      const hi = Math.min(st.path.length - 1, t.idx + 20);
      g.lineWidth = (st.lineWidth ?? 2) + 14;
      g.setLineDash([]);
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(40,40,40,0.12)';
      g.beginPath();
      for (let i = lo; i <= hi; i++) (i === lo ? g.moveTo : g.lineTo).call(g, st.path[i].x, st.path[i].y);
      g.stroke();
    } else {
      const e = st.elems[t.idx];
      g.beginPath();
      if (e.type === 'pbar') {
        e.quad!.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
        g.closePath();
      } else if (e.type === 'vbar') g.rect(e.x - 9, e.y - e.size / 2 - 12, 18, e.size + 24);
      else g.arc(e.x, e.y, e.size + 8, 0, Math.PI * 2);
      g.stroke();
    }
  } else if (t.kind === 'path') {
    const lo = Math.max(0, t.idx - 18);
    const hi = Math.min(st.path.length - 1, t.idx + 18);
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = st.brush === 'band' ? bandWidth(st.path, t.idx) + 10 : 12;
    g.lineCap = 'round';
    g.globalAlpha = 0.45;
    g.beginPath();
    for (let i = lo; i <= hi; i++) (i === lo ? g.moveTo : g.lineTo).call(g, st.path[i].x, st.path[i].y);
    g.stroke();
  } else {
    const e = st.elems[t.idx];
    g.globalAlpha = 0.45;
    drawElem(g, e, '#ffffff', 1.08, 10);
    g.globalAlpha = 1;
    drawElem(g, e, st.color, 1.05);
  }
  g.restore();
}
