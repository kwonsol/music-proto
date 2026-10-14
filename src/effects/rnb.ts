/**
 * R&B — 유체형 물결.
 * 원본을 얇은 행으로 읽어 행마다 가로 변위를 준다. 변위는 큰 굴곡 + 중간 굴곡 + 잔물결을 겹치고(위상도 서로 왜곡),
 * 세로 위치마다 진폭 포락선이 달라 여러 겹의 S자 곡선이 만들어진다. 색과 반사광이 끊기지 않고 휘어진다.
 * option(모자이크)을 올리면 같은 파동을 셀 단위로 샘플링하는 모자이크 층이 겹친다 (검은 격자선 없음).
 */
import { clamp, lerp, noise1 } from '../lib/math';
import { blit } from './helpers';
import type { GenreEffect } from './types';

export const rnbEffect: GenreEffect = ({ ctx, src, rect, time, intensity: I, option: M }) => {
  const { x, y, w, h } = rect;
  blit(ctx, src, x, y, w, h, x, y, w, h);
  if (I <= 0.001) return;

  const D = Math.min(src.width, src.height);
  const k1 = (Math.PI * 2) / (D * 0.7);
  const k2 = (Math.PI * 2) / (D * 0.34);
  const k3 = (Math.PI * 2) / (D * 0.115);
  const k4 = (Math.PI * 2) / (D * 0.045);
  const t = time;

  /** 세로 위치 yy 에서의 가로 변위 */
  const disp = (yy: number) => {
    const env1 = 0.5 + 0.9 * noise1(yy / (D * 0.45) + t * 0.1, 3);
    const env2 = 0.4 + 1.0 * noise1(yy / (D * 0.2) - t * 0.13, 5);
    const warp = 1.3 * Math.sin(k2 * yy * 0.5 + t * 0.4);
    return (
      I *
      D *
      (0.2 * env1 * Math.sin(k1 * yy + t * 0.7 + warp) +
        0.075 * env2 * Math.sin(k2 * yy - t * 0.9 + 1.2) +
        0.016 * Math.sin(k3 * yy + t * 1.4 + warp * 0.5) +
        0.004 * Math.sin(k4 * yy - t * 2.1))
    );
  };

  const rh = 2;
  const y0 = Math.floor(y / rh) * rh;
  for (let yy = y0; yy < y + h; yy += rh) {
    const top = Math.max(yy, y);
    const hh = Math.min(yy + rh, y + h) - top;
    if (hh <= 0) continue;
    blit(ctx, src, x - disp(yy + rh / 2), top, w, hh, x, top, w, hh);
  }

  if (M > 0.03) {
    // 모자이크 층: 셀 위치와 샘플링 좌표가 같은 파동으로 함께 움직인다
    const cs = D * lerp(0.13, 0.035, clamp(M, 0, 1));
    const i0 = Math.floor((x - D * 0.2) / cs);
    const i1 = Math.ceil((x + w + D * 0.2) / cs);
    const j0 = Math.floor(y / cs);
    const j1 = Math.ceil((y + h) / cs);
    ctx.globalAlpha = clamp(M * 2, 0, 1);
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const cx = (i + 0.5) * cs;
        const cy = (j + 0.5) * cs;
        const dx = disp(cy);
        const dy = I * cs * 0.6 * Math.sin(k2 * cx + t * 0.5);
        const sxc = cx - dx * 0.6 + I * cs * 0.8 * Math.sin(k3 * cy + t * 0.8);
        blit(ctx, src, sxc - cs / 2, cy - cs / 2 + dy * 0.5, cs, cs, i * cs + dx, j * cs + dy, cs + 0.5, cs + 0.5);
      }
    }
    ctx.globalAlpha = 1;
  }
};
