// 힙합 모드 그리기: 사진 콜라주(커버·인물·레코드), 굵은 타이포, 형광 스프레이.
import { IMG } from './assets';
import type { Elem, Stroke, Vec } from './stroke';

const WORD_FONT = (size: number) => `900 ${size.toFixed(1)}px "Arial Black", "Helvetica Neue", Arial, "Apple SD Gothic Neo", sans-serif`;

/** 1번 시작점의 작은 커버 (원본 비율 정사각형) */
export function drawStamp(g: CanvasRenderingContext2D, e: Elem, dx = 0, dy = 0) {
  const s = e.size;
  if (IMG.cover) g.drawImage(IMG.cover, e.x - s / 2 + dx, e.y - s / 2 + dy, s, s);
  else {
    g.fillStyle = '#161414';
    g.fillRect(e.x - s / 2 + dx, e.y - s / 2 + dy, s, s);
  }
}

/** 2번: 검정 볼드 산세리프 단어. 연결선·장식 곡선 없음 */
export function drawWord(g: CanvasRenderingContext2D, e: Elem, scale = 1) {
  g.save();
  g.translate(e.x, e.y);
  g.rotate(e.angle);
  g.font = WORD_FONT(e.size * scale);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#111111';
  g.fillText(e.ch ?? '', 0, 0);
  g.restore();
}

/** 3번: 환호 인물 사진 스탬프 (흰 배경 제거본). wobble: 짧게 흔들림 */
export function drawCheer(g: CanvasRenderingContext2D, e: Elem, wobble = 0, scale = 1) {
  const img = IMG.cheer;
  const h = e.size * scale;
  g.save();
  g.translate(e.x, e.y);
  g.rotate(e.angle + wobble * 0.25);
  if (img) {
    const w = (h * img.width) / img.height;
    g.drawImage(img, -w / 2, -h / 2, w, h);
  } else {
    g.fillStyle = '#ccc';
    g.fillRect(-h / 2, -h / 2, h, h);
  }
  g.restore();
}

/** 4번: 레코드판 (흰 배경 제거본, 홈·중앙 라벨 유지). 각도만큼 회전 */
export function drawRecord(g: CanvasRenderingContext2D, e: Elem, angle: number, scale = 1) {
  const img = IMG.record;
  const r = e.size * scale;
  g.save();
  g.translate(e.x, e.y);
  g.rotate(angle);
  if (img) g.drawImage(img, -r, -r, 2 * r, 2 * r);
  else {
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** 방울 하나의 현재 길이: 흐르다가 정해진 길이에서 멈춘다 (감속) */
function dripLen(d: { len: number; speed: number; born: number }, now: number) {
  const tEnd = (d.len / d.speed) * 1.6;
  const u = Math.min(1, Math.max(0, (now - d.born) / tEnd));
  return d.len * (1 - Math.pow(1 - u, 2.2));
}

/** 아직 흐르고 있는 방울이 있는지 (있으면 정적 레이어 대신 매 프레임 그린다) */
export function sprayFlowing(st: Stroke, now: number) {
  return !!st.spray?.drips.some((d) => now - d.born < (d.len / d.speed) * 1.6);
}

/** 5번: 형광 스프레이. 미세 입자 + 밀도 높은 중심 + 일부 지점에서 아래로 흐르는 방울 */
export function drawSpray(g: CanvasRenderingContext2D, st: Stroke, now: number) {
  const sp = st.spray;
  if (!sp) return;
  g.fillStyle = sp.color;
  g.globalAlpha = 0.5;
  const p = sp.pts;
  for (let i = 0; i < p.length; i += 3) {
    const r = p[i + 2];
    g.fillRect(p[i] - r / 2, p[i + 1] - r / 2, r, r);
  }
  g.globalAlpha = 0.92;
  // 방울: 경로와 관계없이 중력 방향(아래)으로만
  for (const d of sp.drips) {
    const L = dripLen(d, now);
    if (L < 1) continue;
    g.beginPath();
    g.moveTo(d.x - d.w / 2, d.y);
    g.lineTo(d.x - d.w * 0.35, d.y + L);
    g.arc(d.x, d.y + L, d.w * 0.5, Math.PI, 0, true); // 끝의 둥근 맺힘
    g.lineTo(d.x + d.w / 2, d.y);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;
}

/** 스프레이 재생 반응: 지금 울리는 경로 지점에 작은 분사 (그림에 누적되지 않음) */
export function drawSprayPuff(g: CanvasRenderingContext2D, st: Stroke, at: Vec, k: number) {
  if (!st.spray) return;
  g.fillStyle = st.spray.color;
  g.globalAlpha = 0.55 * k;
  for (let i = 0; i < 26; i++) {
    const a = i * 2.39996;
    const r = 6 + ((i * 37) % 23) * (0.6 + 0.6 * (1 - k));
    g.fillRect(at.x + Math.cos(a) * r - 1, at.y + Math.sin(a) * r - 1, 2.2, 2.2);
  }
  g.globalAlpha = 1;
}

// ---------------- 선택 ----------------

export function hitWord(e: Elem, p: Vec) {
  const c = Math.cos(-e.angle);
  const s = Math.sin(-e.angle);
  const lx = (p.x - e.x) * c - (p.y - e.y) * s;
  const ly = (p.x - e.x) * s + (p.y - e.y) * c;
  const w = e.size * 0.98 * (e.ch?.length ?? 3);
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= e.size * 0.42;
}
