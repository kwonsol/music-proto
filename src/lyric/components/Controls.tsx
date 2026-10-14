import { controlsOf, EFFECTS, EFFECT_IDS, type ControlKey, type EffectId, type EffectParams } from '../effects';

const MARK = ['①', '②', '③', '④', '⑤', '⑥', '⑦', 'A', 'B'];

export function EffectGrid({ value, onChange }: { value: EffectId; onChange: (e: EffectId) => void }) {
  return (
    <div className="effects">
      {EFFECT_IDS.map((id, i) => (
        <button key={id} className={value === id ? 'fx on' : 'fx'} onClick={() => onChange(id)}>
          <b>
            {MARK[i] ?? '•'} {EFFECTS[id].label}
          </b>
          <span>{EFFECTS[id].mood}</span>
        </button>
      ))}
    </div>
  );
}

const RANGES: Partial<Record<ControlKey, { min: number; max: number; step: number; fmt?: (v: number) => string }>> = {
  intensity: { min: 0, max: 1, step: 0.01 },
  speed: { min: 0.2, max: 3, step: 0.05, fmt: (v) => `×${v.toFixed(2)}` },
  range: { min: 0, max: 1, step: 0.01 },
  tail: { min: 0, max: 1, step: 0.01 },
  origin: { min: 0, max: 1, step: 0.01, fmt: (v) => (v < 0.15 ? '줄 앞' : v > 0.85 ? '줄 끝' : `${Math.round(v * 100)}%`) },
  sharp: { min: 0, max: 1, step: 0.01 },
};

/** 효과가 선언한 조절 항목만 보여준다 */
export function EffectControls({ effect, params, onChange }: { effect: EffectId; params: EffectParams; onChange: (p: Partial<EffectParams>) => void }) {
  return (
    <>
      {controlsOf(effect).map((c) => {
        if (c.key === 'direction') {
          return (
            <Seg key={c.key} label={c.label} value={params.direction} options={[['h', '↔ 가로'], ['v', '↕ 세로']]} onChange={(v) => onChange({ direction: v as 'h' | 'v' })} />
          );
        }
        if (c.key === 'spin') {
          return (
            <Seg key={c.key} label={c.label} value={String((params.spin ?? 1) >= 0 ? 1 : -1)} options={[['1', '↻ 시계'], ['-1', '↺ 반시계']]} onChange={(v) => onChange({ spin: +v })} />
          );
        }
        const r = RANGES[c.key]!;
        const v = (params[c.key] as number | undefined) ?? 0.5;
        return <Slider key={c.key} label={c.label} value={v} min={r.min} max={r.max} step={r.step} fmt={r.fmt} onChange={(x) => onChange({ [c.key]: x })} />;
      })}
    </>
  );
}

export function Slider(props: { label: string; value: number; min: number; max: number; step: number; fmt?: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>
        {props.label}
        <output>{props.fmt ? props.fmt(props.value) : Math.round(props.value * 100)}</output>
      </span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(+e.target.value)} />
    </label>
  );
}

export function Seg({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="slider">
      <span>{label}</span>
      <div className="seg small">
        {options.map(([v, text]) => (
          <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
