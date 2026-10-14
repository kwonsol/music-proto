import type { ReactNode } from 'react';
import { EFFECTS, EFFECT_IDS, type EffectId, type EffectParams } from '../effects';
import { EffectControls, EffectGrid } from './Controls';
import { EXAMPLES } from '../data/examples';
import type { LyricLine } from '../data/lyrics';
import { SEMANTIC_TAGS, type DirectionPreset, type SemanticTag } from '../data/presets';
import type { FontInfo } from '../render/fonts';
import type { Mode, Theme } from '../render/scene';

interface Props {
  mode: Mode;
  input: string;
  effect: EffectId;
  params: EffectParams;
  playing: boolean;
  compare: boolean;
  theme: Theme;
  presets: Record<SemanticTag, DirectionPreset>;
  lyrics: LyricLine[];
  demoLine: number;
  fonts: FontInfo | null;
  onMode: (m: Mode) => void;
  onInput: (s: string) => void;
  onEffect: (e: EffectId) => void;
  onParams: (p: Partial<EffectParams>) => void;
  onPlaying: (v: boolean) => void;
  onRestart: () => void;
  onCompare: (v: boolean) => void;
  onTheme: (t: Theme) => void;
  onPreset: (tag: SemanticTag, p: Partial<DirectionPreset>) => void;
  onResetPresets: () => void;
  onSeek: (time: number) => void;
  /** 링 편집 모드 패널 */
  ringPanel: ReactNode;
}

const MODES: [Mode, string][] = [
  ['ring', '링 편집'],
  ['single', '크게 보기'],
  ['repeat', '반복 배열'],
  ['demo', '가사 데모'],
];

export function Panel(p: Props) {
  const demo = p.mode === 'demo';
  const flat = p.mode === 'single' || p.mode === 'repeat';
  return (
    <aside className="lp-panel">
      <header className="lp-head">
        <strong>Lyric Typo Distortion</strong>
        <span>가사 의미 → 획 변형 프로토타입</span>
      </header>

      <section>
        <h3>보기</h3>
        <div className="seg">
          {MODES.map(([m, label]) => (
            <button key={m} className={p.mode === m ? 'on' : ''} onClick={() => p.onMode(m)}>
              {label}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => p.onPlaying(!p.playing)}>
            {p.playing ? '❚❚ 일시정지' : '▶ 재생'}
          </button>
          <button className="btn" onClick={p.onRestart}>
            ⟲ 처음부터
          </button>
        </div>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={p.compare} onChange={(e) => p.onCompare(e.target.checked)} />
            원본과 비교
          </label>
          <div className="seg small">
            <button className={p.theme === 'white' ? 'on' : ''} onClick={() => p.onTheme('white')}>
              흰 배경
            </button>
            <button className={p.theme === 'yellow' ? 'on' : ''} onClick={() => p.onTheme('yellow')}>
              노란 배경
            </button>
          </div>
        </div>
      </section>

      {p.mode === 'ring' && p.ringPanel}

      {flat && (
        <>
          <section>
            <h3>
              텍스트 <small>[대괄호] = 효과 적용 범위</small>
            </h3>
            <textarea value={p.input} rows={2} onChange={(e) => p.onInput(e.target.value)} spellCheck={false} />
            <div className="row">
              <button className="chip" onClick={() => p.onInput(EXAMPLES[p.effect][0])}>
                예시 (한글)
              </button>
              <button className="chip" onClick={() => p.onInput(EXAMPLES[p.effect][1])}>
                예시 (EN)
              </button>
              <button className="chip" onClick={() => p.onInput('그 말이 아직도 [마음 한가운데]에 남아서 오늘 밤도 [흔들려]')}>
                긴 문장
              </button>
            </div>
          </section>

          <section>
            <h3>효과</h3>
            <EffectGrid value={p.effect} onChange={p.onEffect} />
          </section>

          <section>
            <h3>조절</h3>
            <EffectControls effect={p.effect} params={p.params} onChange={p.onParams} />
          </section>
        </>
      )}

      {demo && (
        <>
          <section>
            <h3>
              예시 가사 <small>클릭 → 해당 줄로 이동</small>
            </h3>
            <ol className="lyrics">
              {p.lyrics.map((l, i) => (
                <li key={l.id} className={i === p.demoLine ? 'on' : ''} onClick={() => p.onSeek(l.start + 0.001)}>
                  <span className="time">{l.start.toFixed(1)}s</span>
                  <span>
                    {highlight(l)}
                    <em>{l.emphasis.map((e) => p.presets[e.tag].label).join(', ')}</em>
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h3>
              연출 프리셋 <small>의미 태그 → 효과 (수정 가능)</small>
            </h3>
            <div className="presets">
              {SEMANTIC_TAGS.map((tag) => {
                const pr = p.presets[tag];
                return (
                  <div key={tag} className="preset">
                    <span className="plabel">{pr.label}</span>
                    <select value={pr.effect} onChange={(e) => p.onPreset(tag, { effect: e.target.value as EffectId, direction: EFFECTS[e.target.value as EffectId].defaultDirection })}>
                      {EFFECT_IDS.map((id) => (
                        <option key={id} value={id}>
                          {EFFECTS[id].label}
                        </option>
                      ))}
                    </select>
                    <input type="range" min={0} max={1} step={0.01} value={pr.intensity} title={`강도 ${pr.intensity.toFixed(2)}`} onChange={(e) => p.onPreset(tag, { intensity: +e.target.value })} />
                  </div>
                );
              })}
            </div>
            <button className="chip" onClick={p.onResetPresets}>
              프리셋 초기화
            </button>
            <p className="note">태그는 사람이 직접 지정한 값입니다. 자동 의미 분석은 사용하지 않습니다.</p>
          </section>
        </>
      )}

      <footer className="note">
        폰트: Anton {p.fonts ? (p.fonts.latinOk ? '✓' : '✕ (대체 서체)') : '…'} · Noto Sans KR Black{' '}
        {p.fonts ? (p.fonts.hangulOk ? '✓ 한글 글리프 확인' : '✕ (대체 서체)') : '…'}
        <br />
        스페이스바: 재생/일시정지
      </footer>
    </aside>
  );
}

function highlight(l: LyricLine) {
  const out: ReactNode[] = [];
  let pos = 0;
  for (const e of [...l.emphasis].sort((a, b) => a.start - b.start)) {
    out.push(l.text.slice(pos, e.start));
    out.push(<mark key={e.start}>{l.text.slice(e.start, e.end)}</mark>);
    pos = e.end;
  }
  out.push(l.text.slice(pos));
  return <span className="ltext">{out}</span>;
}
