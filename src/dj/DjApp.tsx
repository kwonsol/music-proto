import { useEffect, useRef, useState } from 'react';
import { DjEngine } from './audio/engine';
import { ASSETS, MIX } from './config';
import { Art } from './graphics/Art';
import { buildPalette, type CoverPalette } from './graphics/colors';
import { hslCss } from './graphics/palette';

function confidenceLabel(c: number) {
  return c > 0.6 ? '높음' : c > 0.3 ? '보통' : '낮음';
}

export default function DjApp() {
  const [engine, setEngine] = useState<DjEngine | null>(null);
  const [palette, setPalette] = useState<CoverPalette | null>(null);
  const [coverReady, setCoverReady] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [songVol, setSongVol] = useState(MIX.songDefault);
  const [playVol, setPlayVol] = useState(MIX.playDefault);
  const [metro, setMetro] = useState(false);
  const beatRef = useRef<HTMLDivElement>(null);
  const addError = (msg: string) => setErrors((e) => (e.includes(msg) ? e : [...e, msg]));

  // 커버: 한 번 불러와서 팔레트를 만든다 (이후 유지)
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setCoverReady(true);
      try {
        setPalette((p) => p ?? buildPalette(img));
      } catch (err) {
        addError(`팔레트 생성 실패: ${(err as Error).message}`);
      }
    };
    img.onerror = () => addError(`커버 이미지 파일이 없습니다: public${ASSETS.cover}`);
    img.src = ASSETS.cover;
  }, []);

  // 음원: 디코딩 + 박자·샘플 분석
  useEffect(() => {
    let alive = true;
    let made: DjEngine | null = null;
    (async () => {
      try {
        const head = await fetch(ASSETS.song, { method: 'HEAD' });
        const type = head.headers.get('content-type') ?? '';
        if (!head.ok || type.includes('text/html')) throw new Error(`음원 파일이 없습니다: public${ASSETS.song}`);
        made = await DjEngine.load(ASSETS.song);
        if (!alive) return made.dispose();
        made.setOnEnded(() => setPlaying(false));
        setEngine(made);
        // 개발 중 콘솔에서 박자·예약 상태를 확인하기 위한 핸들
        if (import.meta.env.DEV) (window as unknown as { __dj: DjEngine }).__dj = made;
      } catch (err) {
        if (alive) addError((err as Error).message || '음원을 디코딩하지 못했습니다');
      }
    })();
    return () => {
      alive = false;
      made?.dispose();
    };
  }, []);

  useEffect(() => engine?.setSongVolume(songVol), [engine, songVol]);
  useEffect(() => engine?.setPlayVolume(playVol), [engine, playVol]);
  useEffect(() => engine?.setMetronome(metro), [engine, metro]);

  // 박 표시: 실제로 들리는 시각 기준
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const el = beatRef.current;
      if (el && engine) {
        const { phase, beatInBar } = engine.beatPos(engine.audibleTime());
        const dots = el.children;
        for (let i = 0; i < dots.length; i++) {
          const on = engine.playing && i === beatInBar;
          (dots[i] as HTMLElement).style.opacity = on ? String(1 - phase * 0.7) : '0.18';
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  const toggle = async () => {
    if (!engine) return;
    if (engine.playing) {
      engine.pause();
      setPlaying(false);
    } else {
      await engine.play();
      setPlaying(true);
    }
  };

  const restart = async () => {
    if (!engine) return;
    await engine.restart();
    setPlaying(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        void toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const t = engine?.tempo;
  const accent = palette ? hslCss(palette.entries[0].color) : '#9ad';

  return (
    <div className="dj" style={{ ['--accent' as string]: accent }}>
      <div className="dj-stage">
        {coverReady && <img src={ASSETS.cover} alt="앨범커버: 헤드폰을 쓴 모차르트와 DJ 장비" draggable={false} />}
        {palette && <Art engine={engine} colors={palette.colors} />}
        {!engine && !errors.length && <div className="dj-loading">음원 분석 중…</div>}
      </div>

      <div className="dj-bar">
        <button className="dj-play" onClick={toggle} disabled={!engine} aria-label={playing ? '일시정지' : '재생'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="dj-small" onClick={restart} disabled={!engine} title="처음부터">
          ↺
        </button>
        <label className="dj-vol">
          원곡
          <input type="range" min={0} max={1} step={0.01} value={songVol} onChange={(e) => setSongVol(+e.target.value)} />
        </label>
        <label className="dj-vol">
          연주
          <input type="range" min={0} max={1.2} step={0.01} value={playVol} onChange={(e) => setPlayVol(+e.target.value)} />
        </label>
        <div className="dj-beat" ref={beatRef} aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </div>
        {t && (
          <button
            className={`dj-tempo ${metro ? 'on' : ''}`}
            onClick={() => setMetro((v) => !v)}
            title={
              `박 확인용 클릭 켜기/끄기\n` +
              `${t.source === 'auto' ? '자동 추정' : '코드 설정값'} · 신뢰도 ${confidenceLabel(t.confidence)}` +
              (t.alternatives.length ? `\n다른 후보: ${t.alternatives.map((a) => a.toFixed(1)).join(', ')} BPM` : '')
            }
          >
            {t.bpm.toFixed(1)} BPM{t.source === 'auto' ? ' (추정)' : ''}
            {t.ambiguous && <span className="warn"> · 반박/두 배 불확실</span>}
            <span className="metro">{metro ? ' · 클릭 ON' : ''}</span>
          </button>
        )}
      </div>

      <ul className="dj-help">
        <li>
          <b>점·원·작은 사각형</b> 클릭 = 킥·퍼커션·하이햇, 누르고 있으면 박자에 맞춰 반복
        </li>
        <li>
          <b>짧은 사선 묶음</b> 클릭 = 원곡 조각, 누른 채 위/아래로 끌면 1/8 ~ 1박 스터터
        </li>
        <li>
          <b>긴 곡선 띠</b> 잡아당기면 상승 효과, 놓으면 악센트
        </li>
        <li>
          <b>큰 원호</b> 누르고 있으면 에코, 좌우 = 피드백 · 위아래 = 음색
        </li>
      </ul>

      {errors.length > 0 && (
        <div className="dj-errors" role="alert">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
    </div>
  );
}
