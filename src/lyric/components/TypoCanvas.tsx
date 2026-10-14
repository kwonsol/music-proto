import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { EFFECTS } from '../effects';
import { demoDuration, lineAt } from '../data/lyrics';
import { loadFonts, type FontInfo } from '../render/fonts';
import { SceneRenderer, type Clock, type SceneState } from '../render/scene';

interface Props {
  scene: SceneState;
  playing: boolean;
  clock: MutableRefObject<Clock>;
  /** 처음부터 재생·탐색 등 시계가 바뀌었음을 알리는 토큰 */
  clockToken: number;
  onFonts: (fi: FontInfo) => void;
  onDemoLine: (index: number) => void;
}

export function TypoCanvas({ scene, playing, clock, clockToken, onFonts, onDemoLine }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef(scene);
  const playingRef = useRef(playing);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const dirty = useRef(true);
  const lineRef = useRef(-1);
  const cbRef = useRef({ onFonts, onDemoLine });
  cbRef.current = { onFonts, onDemoLine };
  const [ready, setReady] = useState(false);

  sceneRef.current = scene;
  playingRef.current = playing;
  useEffect(() => {
    dirty.current = true;
  }, [scene, playing, clockToken]);

  // 폰트(필요한 한글 서브셋 포함)를 받은 뒤에만 측정·래스터화한다.
  const textKey = scene.input + '|' + scene.lyrics.map((l) => l.text).join('|');
  useEffect(() => {
    let alive = true;
    loadFonts(textKey).then((fi) => {
      if (!alive) return;
      rendererRef.current = new SceneRenderer(fi);
      dirty.current = true;
      setReady(true);
      cbRef.current.onFonts(fi);
    });
    return () => {
      alive = false;
    };
  }, [textKey]);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = wrap.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      dirty.current = true;
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // 시간 기반: 프레임률과 무관하게 실제 경과 시간만큼 진행 (탭 복귀 시 튐 방지로 상한)
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = sceneRef.current;
      if (playingRef.current) {
        clock.current.time += dt;
        clock.current.fx += dt * s.params.speed;
        dirty.current = true;
      }
      const r = rendererRef.current;
      if (!r || !dirty.current) return;
      dirty.current = false;
      const t0 = performance.now();
      r.render(ctx, canvas.width, canvas.height, s, clock.current);
      if (import.meta.env.DEV) (window as unknown as Record<string, number>).__lyricRenderMs = performance.now() - t0;
      updateHud(s);
    };
    const updateHud = (s: SceneState) => {
      const hud = hudRef.current;
      if (!hud) return;
      if (s.mode !== 'demo') {
        hud.style.display = 'none';
        return;
      }
      hud.style.display = '';
      const total = demoDuration(s.lyrics);
      const cur = lineAt(s.lyrics, clock.current.time);
      const t = ((clock.current.time % total) + total) % total;
      if (barRef.current) barRef.current.style.width = `${(t / total) * 100}%`;
      const idx = cur ? cur.index : -1;
      if (idx !== lineRef.current) {
        lineRef.current = idx;
        cbRef.current.onDemoLine(idx);
      }
      const info = hud.querySelector('.hud-info');
      if (info && cur) {
        const parts = cur.line.emphasis.map((e) => {
          const pr = s.presets[e.tag];
          const eff = EFFECTS[e.effect ?? pr.effect];
          return `‘${cur.line.text.slice(e.start, e.end)}’ · ${pr.label} → ${eff.label}`;
        });
        info.textContent = `${fmt(t)} / ${fmt(total)}   ${parts.join('  ')}   (수동 태그)`;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [clock]);

  return (
    <div className="typo-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} />
      {!ready && <div className="typo-loading">폰트 불러오는 중…</div>}
      {scene.compare && (
        <>
          <span className="tag tag-top">원본</span>
          <span className="tag tag-bottom">{scene.mode === 'demo' ? '왜곡 (프리셋)' : `왜곡 · ${EFFECTS[scene.effect].label}`}</span>
        </>
      )}
      <div className="hud" ref={hudRef} style={{ display: 'none' }}>
        <div className="hud-info" />
        <div className="hud-track">
          <div className="hud-bar" ref={barRef} />
        </div>
      </div>
    </div>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
