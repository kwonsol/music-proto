/**
 * Pop — 입체 큐브.
 * 구획 중심에서 바깥으로 갈수록 커지는 (불균일한) 격자를 만들고, 각 칸을 서로 다른 깊이의 블록으로 밀어 올린다.
 * 깊이는 크기·바깥 거리에 비례해 외곽 블록일수록 크게 돌출한다.
 * 앞면은 밀려난 위치의 원본을 그대로 보여 곡면과 윤곽이 이어지고, 윗면·옆면은 원본 조각을 평행사변형으로 눕히고 명암을 입힌다.
 */
import { clamp, hash2, lerp } from '../lib/math';
import { blit, blitAffine } from './helpers';
import type { GenreEffect } from './types';

interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

/** 중심에서 바깥으로 갈수록 커지고, 단계마다 크기가 불균일하게 흔들리는 분할점 */
function breaks(center: number, lo: number, hi: number, minS: number, maxS: number, reach: number, seed: number): number[] {
  const size = (d: number, n: number) =>
    lerp(minS, maxS, Math.pow(clamp(d / reach, 0, 1), 1.1)) * (0.7 + 0.65 * hash2(n, seed));
  const pts = [center];
  for (let p = center, n = 0; p < hi && n < 90; n++) pts.push((p += size(p - center, n)));
  for (let p = center, n = 0; p > lo && n < 90; n++) pts.unshift((p -= size(center - p, -n - 1)));
  return pts;
}

export const popEffect: GenreEffect = ({ ctx, src, rect, time, intensity: I }) => {
  const { x, y, w, h } = rect;
  blit(ctx, src, x, y, w, h, x, y, w, h);
  if (I <= 0.001) return;

  const Dc = Math.min(src.width, src.height);
  const minS = Math.max(6, Dc * 0.013, Math.sqrt((w * h) / 1300));
  const maxS = Math.max(minS * 2, Math.min(Math.min(w, h) * 0.5, Dc * lerp(0.05, 0.22, I)));
  const cx = x + w * (0.5 + 0.16 * Math.sin(time * 0.37));
  const cy = y + h * (0.5 + 0.16 * Math.cos(time * 0.29));
  const reach = Math.max(cx - x, x + w - cx, cy - y, y + h - cy);
  const xs = breaks(cx, x - maxS, x + w + maxS, minS, maxS, reach, 11);
  const ys = breaks(cy, y - maxS, y + h + maxS, minS, maxS, reach, 23);
  const ci = xs.indexOf(cx);
  const cj = ys.indexOf(cy);

  const ang = -0.8 + 0.3 * Math.sin(time * 0.33);
  const dirX = Math.cos(ang);
  const dirY = Math.sin(ang);
  const cells: Cell[] = [];
  for (let j = 0; j < ys.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      if (xs[i + 1] < x - maxS || xs[i] > x + w + maxS || ys[j + 1] < y - maxS || ys[j] > y + h + maxS) continue;
      const cw = xs[i + 1] - xs[i];
      const ch = ys[j + 1] - ys[j];
      const hv = hash2(i - ci, j - cj);
      const bob = 0.8 + 0.2 * Math.sin(time * 1.1 + hv * 6.28);
      // 바깥일수록 더 높이 솟는다
      const rad = clamp(Math.hypot(xs[i] + cw / 2 - cx, ys[j] + ch / 2 - cy) / reach, 0, 1);
      const depth = Math.min(cw, ch) * I * 1.7 * (0.25 + 0.75 * hv) * (0.2 + 0.8 * rad) * bob;
      cells.push({ x: xs[i], y: ys[j], w: cw, h: ch, depth });
    }
  }
  cells.sort((a, b) => a.depth - b.depth); // 높은 블록이 위에 온다

  for (const c of cells) {
    const dx = dirX * c.depth;
    const dy = dirY * c.depth;
    if (c.depth >= 1.5) {
      // 윗면(또는 아랫면)
      const ty = dy < 0 ? c.y : c.y + c.h;
      const t = Math.max(1, Math.min(Math.abs(dy), c.h));
      blitAffine(ctx, src, c.x, dy < 0 ? c.y : c.y + c.h - t, c.w, t, c.x, ty, c.w, 0, dx, dy);
      ctx.fillStyle = 'rgba(255,255,255,0.26)';
      ctx.beginPath();
      ctx.moveTo(c.x, ty);
      ctx.lineTo(c.x + c.w, ty);
      ctx.lineTo(c.x + c.w + dx, ty + dy);
      ctx.lineTo(c.x + dx, ty + dy);
      ctx.fill();
      // 옆면
      const tx = dx > 0 ? c.x + c.w : c.x;
      const tw = Math.max(1, Math.min(Math.abs(dx), c.w));
      blitAffine(ctx, src, dx > 0 ? c.x + c.w - tw : c.x, c.y, tw, c.h, tx, c.y, dx, dy, 0, c.h);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.moveTo(tx, c.y);
      ctx.lineTo(tx + dx, c.y + dy);
      ctx.lineTo(tx + dx, c.y + c.h + dy);
      ctx.lineTo(tx, c.y + c.h);
      ctx.fill();
    }
    if (c.depth >= 1.5) {
      // 앞면 아래·왼쪽 접촉 그림자: 블록이 떠 있는 느낌
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(c.x + dx - 1, c.y + dy + c.h, c.w + 1, 2);
      ctx.fillRect(c.x + dx - 2, c.y + dy, 2, c.h);
    }
    // 앞면: 자기 위치와 밀려난 위치의 중간 지점 텍스처를 사용 → 곡면·윤곽은 이어지고 블록 경계는 또렷해진다
    blit(ctx, src, c.x + dx * 0.4, c.y + dy * 0.4, c.w, c.h, c.x + dx, c.y + dy, c.w, c.h);
    if (c.depth >= 5) {
      // 앞면 가장자리 하이라이트(윗/왼쪽)와 어두운 모서리(아래/오른쪽)
      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      ctx.fillRect(c.x + dx, c.y + dy, c.w, 1.5);
      ctx.fillRect(c.x + dx, c.y + dy, 1.5, c.h);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(c.x + dx, c.y + dy + c.h - 1.5, c.w, 1.5);
      ctx.fillRect(c.x + dx + c.w - 1.5, c.y + dy, 1.5, c.h);
    }
  }
};
