import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from './components/Panel';
import { RingPanel } from './components/RingPanel';
import { TypoCanvas } from './components/TypoCanvas';
import { defaultParams, EFFECTS, type EffectId, type EffectParams } from './effects';
import { DEFAULT_RINGS, DEFAULT_VIEW, loadRings, newRingId, saveRings, type RingLine, type RingView } from './data/rings';
import { EXAMPLES } from './data/examples';
import { DEMO_LYRICS } from './data/lyrics';
import { DEFAULT_PRESETS, type DirectionPreset, type SemanticTag } from './data/presets';
import type { FontInfo } from './render/fonts';
import type { Clock, Mode, SceneState, Theme } from './render/scene';

export default function LyricApp() {
  const [mode, setMode] = useState<Mode>('ring');
  const [effect, setEffect] = useState<EffectId>('stretch');
  const [input, setInput] = useState(EXAMPLES.stretch[0]);
  const [params, setParams] = useState<EffectParams>(() => defaultParams('stretch'));
  const [playing, setPlaying] = useState(true);
  const [compare, setCompare] = useState(false);
  const [theme, setTheme] = useState<Theme>('white');
  const [presets, setPresets] = useState(DEFAULT_PRESETS);
  const [demoLine, setDemoLine] = useState(-1);
  const [fonts, setFonts] = useState<FontInfo | null>(null);
  const [clockToken, setClockToken] = useState(0);
  const clock = useRef<Clock>({ time: 0, fx: 0, dt: 0, epoch: 0 });

  // ── 링 편집: rings = 적용(확정)된 줄들, draft = 선택한 줄의 미리보기 값 ──
  const [stored] = useState(loadRings);
  const [rings, setRings] = useState<RingLine[]>(stored.lines);
  const [selected, setSelected] = useState(stored.selected);
  const [view, setView] = useState<RingView>(stored.view);
  const [draft, setDraft] = useState<RingLine>(stored.lines[stored.selected]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(rings[selected]);

  useEffect(() => saveRings({ lines: rings, selected, view }), [rings, selected, view]);

  const select = useCallback(
    (i: number, from: RingLine[] = rings) => {
      const k = Math.max(0, Math.min(from.length - 1, i));
      setSelected(k);
      setDraft(from[k]);
    },
    [rings],
  );
  const commit = () => {
    const next = rings.map((l, i) => (i === selected ? { ...draft, applied: true } : l));
    setRings(next);
    setDraft(next[selected]);
    return next;
  };
  const ringLines = useMemo(() => rings.map((l, i) => (i === selected ? draft : l)), [rings, selected, draft]);

  const scene: SceneState = useMemo(
    () => ({ mode, input, effect, params, compare, theme, presets, lyrics: DEMO_LYRICS, ring: { lines: ringLines, selected, view } }),
    [mode, input, effect, params, compare, theme, presets, ringLines, selected, view],
  );

  const restart = useCallback(() => {
    clock.current.time = 0;
    clock.current.fx = 0;
    clock.current.epoch += 1;
    setClockToken((n) => n + 1);
  }, []);

  // 개발 중 검증용: 콘솔에서 __lyricSeek(효과시간, 재생시간) 으로 특정 순간을 고정해 볼 수 있다
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__lyricSeek = (fx: number, time = fx) => {
      clock.current.fx = fx;
      clock.current.time = time;
      setClockToken((n) => n + 1);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code === 'Space' && tag !== 'TEXTAREA' && tag !== 'INPUT' && tag !== 'SELECT') {
        e.preventDefault();
        setPlaying((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="lp-app">
      <main className="lp-stage">
        <TypoCanvas scene={scene} playing={playing} clock={clock} clockToken={clockToken} onFonts={setFonts} onDemoLine={setDemoLine} onRingClick={(i) => select(i)} />
      </main>
      <Panel
        mode={mode}
        input={input}
        effect={effect}
        params={params}
        playing={playing}
        compare={compare}
        theme={theme}
        presets={presets}
        lyrics={DEMO_LYRICS}
        demoLine={demoLine}
        fonts={fonts}
        onMode={(m) => {
          setMode(m);
          if (m === 'demo') restart();
        }}
        onInput={setInput}
        onEffect={(e) => {
          setEffect(e);
          setParams((p) => ({ ...p, direction: EFFECTS[e].defaultDirection, ...EFFECTS[e].defaults }));
          // 효과를 바꾸면 원형부터 다시 보이도록 효과 시계를 되돌린다
          clock.current.fx = 0;
          setClockToken((n) => n + 1);
        }}
        onParams={(p) => setParams((cur) => ({ ...cur, ...p }))}
        onPlaying={setPlaying}
        onRestart={restart}
        onCompare={setCompare}
        onTheme={setTheme}
        onPreset={(tag: SemanticTag, p: Partial<DirectionPreset>) => setPresets((cur) => ({ ...cur, [tag]: { ...cur[tag], ...p } }))}
        onResetPresets={() => setPresets(DEFAULT_PRESETS)}
        ringPanel={
          <RingPanel
            lines={rings}
            selected={selected}
            draft={draft}
            dirty={dirty}
            view={view}
            onSelect={(i) => select(i)}
            onDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onEffect={(e) => setDraft((d) => ({ ...d, effect: e, params: defaultParams(e) }))}
            onParams={(p) => setDraft((d) => ({ ...d, params: { ...d.params, ...p } }))}
            onApply={commit}
            onApplyNext={() => {
              const next = commit();
              select((selected + 1) % next.length, next);
            }}
            onRevert={() => setDraft(rings[selected])}
            onView={(v) => setView((cur) => ({ ...cur, ...v }))}
            onAddLine={() => {
              const line: RingLine = {
                id: newRingId(),
                text: '새 가사 [한 줄]',
                layout: { phase: (rings.length * 77) % 360 },
                rotation: { speed: 4, dir: rings.length % 2 ? -1 : 1 },
                effect: 'wave',
                params: defaultParams('wave'),
                applied: false,
              };
              const next = [...rings, line];
              setRings(next);
              select(next.length - 1, next);
            }}
            onRemoveLine={() => {
              if (rings.length <= 1) return;
              const next = rings.filter((_, i) => i !== selected);
              setRings(next);
              select(Math.min(selected, next.length - 1), next);
            }}
            onResetAll={() => {
              setRings(DEFAULT_RINGS);
              setView(DEFAULT_VIEW);
              select(0, DEFAULT_RINGS);
            }}
          />
        }
        onSeek={(t) => {
          clock.current.time = t;
          setClockToken((n) => n + 1);
        }}
      />
    </div>
  );
}
