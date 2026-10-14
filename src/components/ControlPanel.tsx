import { GENRE_IDS, GENRE_LABEL, type GenreId } from '../lib/genres';
import { formatPct, type Ratios } from '../lib/ratios';

interface Props {
  hasImage: boolean;
  ratios: Ratios;
  intensity: Record<GenreId, number>;
  options: Record<GenreId, number>;
  freq: number;
  playing: boolean;
  showBoxes: boolean;
  mode: 'pattern' | 'photo';
  onMode: (m: 'pattern' | 'photo') => void;
  onUpload: (file: File) => void;
  onSample: () => void;
  onToggle: (id: GenreId) => void;
  onRatio: (id: GenreId, v: number) => void;
  onIntensity: (id: GenreId, v: number) => void;
  onOption: (id: GenreId, v: number) => void;
  onFreq: (v: number) => void;
  onPlaying: (v: boolean) => void;
  onShowBoxes: (v: boolean) => void;
  onReset: () => void;
}

const OPTION_LABEL: Partial<Record<GenreId, string>> = { hiphop: '기울기', rnb: '모자이크' };

export function ControlPanel(p: Props) {
  const selectedCount = GENRE_IDS.filter((g) => p.ratios[g] !== undefined).length;
  const allZero = selectedCount > 0 && GENRE_IDS.every((g) => (p.ratios[g] ?? 0) === 0);

  return (
    <aside className="panel">
      <div className="row">
        <label className="btn primary">
          {p.hasImage ? '이미지 교체' : '이미지 업로드'}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) p.onUpload(f);
              e.target.value = '';
            }}
          />
        </label>
        <button className="btn" onClick={p.onSample}>
          기본 사진
        </button>
        <button className="btn" onClick={() => p.onPlaying(!p.playing)} aria-pressed={!p.playing}>
          {p.playing ? '일시정지' : '재생'}
        </button>
      </div>

      <div className="seg" role="group" aria-label="표현 방식">
        <button className={p.mode === 'photo' ? 'on' : ''} onClick={() => p.onMode('photo')} aria-pressed={p.mode === 'photo'}>
          사진
        </button>
        <button className={p.mode === 'pattern' ? 'on' : ''} onClick={() => p.onMode('pattern')} aria-pressed={p.mode === 'pattern'}>
          패턴
        </button>
      </div>

      <section>
        <h2>
          장르 <small>선택 합계 {selectedCount ? '100%' : '—'}</small>
        </h2>
        {GENRE_IDS.map((g) => {
          const v = p.ratios[g];
          const on = v !== undefined;
          return (
            <div key={g} className={`genre ${on ? '' : 'off'}`}>
              <div className="genre-head">
                <label className="check">
                  <input type="checkbox" checked={on} onChange={() => p.onToggle(g)} />
                  <span className={`dot ${g}`} />
                  {GENRE_LABEL[g]}
                </label>
                <span className="num">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    disabled={!on || selectedCount === 1}
                    value={on ? formatPct(v) : ''}
                    onChange={(e) => p.onRatio(g, parseFloat(e.target.value))}
                    aria-label={`${GENRE_LABEL[g]} 비율`}
                  />
                  %
                </span>
              </div>
              <div className="sliders">
                <label title="면적 비율">
                  <span>비율</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    disabled={!on || selectedCount === 1}
                    value={on ? v : 0}
                    onChange={(e) => p.onRatio(g, Number(e.target.value))}
                  />
                </label>
                <label title="왜곡 강도">
                  <span>강도</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    disabled={!on}
                    value={p.intensity[g]}
                    onChange={(e) => p.onIntensity(g, Number(e.target.value))}
                  />
                </label>
                {OPTION_LABEL[g] && (
                  <label title={OPTION_LABEL[g]}>
                    <span>{OPTION_LABEL[g]}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      disabled={!on}
                      value={p.options[g]}
                      onChange={(e) => p.onOption(g, Number(e.target.value))}
                    />
                  </label>
                )}
              </div>
            </div>
          );
        })}
        {selectedCount === 0 && <p className="hint">장르를 하나 이상 선택하면 왜곡이 시작됩니다.</p>}
        {allZero && <p className="hint">모든 비율이 0% 입니다. 한 장르의 비율을 올려 주세요.</p>}
      </section>

      <section>
        <label className="speed">
          <span>구획 전환 빈도</span>
          <b>{p.freq.toFixed(2)}×</b>
          <input
            type="range"
            min={0}
            max={3}
            step={0.05}
            value={p.freq}
            onChange={(e) => p.onFreq(Number(e.target.value))}
          />
        </label>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={p.showBoxes} onChange={(e) => p.onShowBoxes(e.target.checked)} />
            테두리·라벨
          </label>
          <button className="btn" onClick={p.onReset}>
            초기화
          </button>
        </div>
      </section>
    </aside>
  );
}
