import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from './components/Panel';
import { TypoCanvas } from './components/TypoCanvas';
import { EFFECTS, type EffectId, type EffectParams } from './effects';
import { EXAMPLES } from './data/examples';
import { DEMO_LYRICS } from './data/lyrics';
import { DEFAULT_PRESETS, type DirectionPreset, type SemanticTag } from './data/presets';
import type { FontInfo } from './render/fonts';
import type { Clock, Mode, SceneState, Theme } from './render/scene';

/** 처음 열었을 때 효과가 충분히 드러나는 값 */
const defaultParams = (effect: EffectId): EffectParams => ({
  intensity: 0.85,
  speed: 1,
  range: 0.6,
  direction: EFFECTS[effect].defaultDirection,
});

export default function LyricApp() {
  const [mode, setMode] = useState<Mode>('single');
  const [effect, setEffect] = useState<EffectId>('stretch');
  const [input, setInput] = useState(EXAMPLES.stretch[0]);
  const [params, setParams] = useState<EffectParams>(() => defaultParams('stretch'));
  const [playing, setPlaying] = useState(true);
  const [compare, setCompare] = useState(false);
  const [theme, setTheme] = useState<Theme>('yellow');
  const [presets, setPresets] = useState(DEFAULT_PRESETS);
  const [demoLine, setDemoLine] = useState(-1);
  const [fonts, setFonts] = useState<FontInfo | null>(null);
  const [clockToken, setClockToken] = useState(0);
  const clock = useRef<Clock>({ time: 0, fx: 0 });

  const scene: SceneState = useMemo(
    () => ({ mode, input, effect, params, compare, theme, presets, lyrics: DEMO_LYRICS }),
    [mode, input, effect, params, compare, theme, presets],
  );

  const restart = useCallback(() => {
    clock.current.time = 0;
    clock.current.fx = 0;
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
        <TypoCanvas scene={scene} playing={playing} clock={clock} clockToken={clockToken} onFonts={setFonts} onDemoLine={setDemoLine} />
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
          setParams((p) => ({ ...p, direction: EFFECTS[e].defaultDirection }));
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
        onSeek={(t) => {
          clock.current.time = t;
          setClockToken((n) => n + 1);
        }}
      />
    </div>
  );
}
