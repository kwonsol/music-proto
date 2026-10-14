/** 샘플 이미지: 하늘색 배경 위의 붉은 사과 형태 (업로드 없이 체험/검증용) */
export function makeSampleImage(w = 1200, h = 900): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#46c3ff');
  bg.addColorStop(1, '#1b8de0');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  const cx = w * 0.5;
  const cy = h * 0.55;
  const r = h * 0.36;
  const body = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.15);
  body.addColorStop(0, '#ff6a5a');
  body.addColorStop(0.45, '#c8101a');
  body.addColorStop(1, '#5a0509');
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(cx, cy - r * 0.78);
  g.bezierCurveTo(cx + r * 0.5, cy - r * 1.15, cx + r * 1.3, cy - r * 0.55, cx + r * 1.05, cy + r * 0.25);
  g.bezierCurveTo(cx + r * 0.85, cy + r * 1.0, cx + r * 0.3, cy + r * 1.1, cx, cy + r * 0.95);
  g.bezierCurveTo(cx - r * 0.3, cy + r * 1.1, cx - r * 0.85, cy + r * 1.0, cx - r * 1.05, cy + r * 0.25);
  g.bezierCurveTo(cx - r * 1.3, cy - r * 0.55, cx - r * 0.5, cy - r * 1.15, cx, cy - r * 0.78);
  g.fill();

  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.ellipse(cx - r * 0.45, cy - r * 0.35, r * 0.2, r * 0.32, -0.6, 0, Math.PI * 2);
  g.fill();

  g.strokeStyle = '#3d1d0a';
  g.lineWidth = r * 0.07;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx, cy - r * 0.7);
  g.quadraticCurveTo(cx + r * 0.05, cy - r * 1.0, cx + r * 0.25, cy - r * 1.2);
  g.stroke();
  g.fillStyle = '#2f9a3a';
  g.beginPath();
  g.ellipse(cx + r * 0.5, cy - r * 1.15, r * 0.3, r * 0.14, -0.45, 0, Math.PI * 2);
  g.fill();
  return c;
}
