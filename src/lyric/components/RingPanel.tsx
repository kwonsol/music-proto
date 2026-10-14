import type { ReactNode } from 'react';
import { EFFECTS, type EffectId, type EffectParams } from '../effects';
import { parseMarked } from '../data/lyrics';
import type { RingLine, RingView } from '../data/rings';
import { EffectControls, EffectGrid, Seg, Slider } from './Controls';

interface Props {
  lines: RingLine[];
  selected: number;
  draft: RingLine;
  dirty: boolean;
  view: RingView;
  onSelect: (i: number) => void;
  onDraft: (patch: Partial<RingLine>) => void;
  onEffect: (e: EffectId) => void;
  onParams: (p: Partial<EffectParams>) => void;
  onApply: () => void;
  onApplyNext: () => void;
  onRevert: () => void;
  onView: (v: Partial<RingView>) => void;
  onAddLine: () => void;
  onRemoveLine: () => void;
  onResetAll: () => void;
}

const num = (i: number) => String(i + 1).padStart(2, '0');

export function RingPanel(p: Props) {
  const n = p.lines.length;
  const d = p.draft;
  return (
    <>
      <section>
        <h3>
          가사 링 <small>원 클릭 또는 목록에서 선택</small>
        </h3>
        <ol className="rings">
          {p.lines.map((l, i) => {
            const shown = i === p.selected ? d : l;
            return (
              <li key={l.id} className={i === p.selected ? 'on' : ''} onClick={() => p.onSelect(i)}>
                <span className="time">{num(i)}</span>
                <span>
                  {marked(shown.text)}
                  <em>
                    {EFFECTS[shown.effect].label}
                    {i === p.selected && p.dirty ? ' · 미적용 변경' : l.applied ? ' · 적용됨' : ''}
                  </em>
                </span>
              </li>
            );
          })}
        </ol>
        <div className="row">
          <button className="chip" onClick={p.onAddLine}>
            + 줄 추가
          </button>
          <button className="chip" onClick={p.onRemoveLine} disabled={n <= 1}>
            선택 줄 삭제
          </button>
          <button className="chip" onClick={p.onResetAll}>
            예시로 초기화
          </button>
        </div>
      </section>

      <section className="ring-edit">
        <h3>
          선택한 원 {num(p.selected)} / {num(n - 1)}
          {p.dirty && <span className="dirty">미적용 변경 · 미리보기 중</span>}
        </h3>
        <div className="ring-text">{marked(d.text)}</div>
        <input className="ring-input" value={d.text} onChange={(e) => p.onDraft({ text: e.target.value })} spellCheck={false} placeholder="가사 한 줄 ([대괄호] = 효과 범위)" />
        <div className="row nav">
          <button className="btn" onClick={() => p.onSelect((p.selected - 1 + n) % n)}>
            ← 이전 줄
          </button>
          <button className="btn" onClick={() => p.onSelect((p.selected + 1) % n)}>
            다음 줄 →
          </button>
        </div>
        <div className="row nav">
          <button className="btn" onClick={p.onApply} disabled={!p.dirty}>
            적용
          </button>
          <button className="btn primary" onClick={p.onApplyNext}>
            적용 후 다음 줄 →
          </button>
        </div>
        {p.dirty && (
          <p className="note">
            적용하지 않고 이전/다음 줄로 이동하면 이 줄의 변경은 취소됩니다.{' '}
            <button className="linkbtn" onClick={p.onRevert}>
              지금 되돌리기
            </button>
          </p>
        )}
      </section>

      <section>
        <h3>이 줄의 효과</h3>
        <EffectGrid value={d.effect} onChange={p.onEffect} />
      </section>

      <section>
        <h3>
          조절 <small>{EFFECTS[d.effect].label}</small>
        </h3>
        <EffectControls effect={d.effect} params={d.params} onChange={p.onParams} />
      </section>

      <section>
        <h3>이 링의 회전</h3>
        <Slider label="공전 속도" value={d.rotation.speed} min={0} max={24} step={0.5} fmt={(v) => `${v.toFixed(1)}°/s`} onChange={(v) => p.onDraft({ rotation: { ...d.rotation, speed: v } })} />
        <Seg label="방향" value={String(d.rotation.dir)} options={[['1', '↺ 반시계'], ['-1', '↻ 시계']]} onChange={(v) => p.onDraft({ rotation: { ...d.rotation, dir: v === '1' ? 1 : -1 } })} />
      </section>

      <section>
        <h3>전체 보기</h3>
        <Slider label="기울기 (내려다보는 각도)" value={p.view.tilt} min={12} max={80} step={1} fmt={(v) => `${Math.round(v)}°`} onChange={(v) => p.onView({ tilt: v })} />
        <Slider label="전체 공전 배율" value={p.view.spin} min={0} max={3} step={0.05} fmt={(v) => (v === 0 ? '멈춤' : `×${v.toFixed(2)}`)} onChange={(v) => p.onView({ spin: v })} />
        <p className="note">공전을 멈춰도 각 줄의 왜곡은 계속 움직입니다. 줄별 설정은 이 브라우저에 자동 저장됩니다.</p>
      </section>
    </>
  );
}

function marked(text: string): ReactNode {
  const { text: plain, ranges } = parseMarked(text);
  const out: ReactNode[] = [];
  let pos = 0;
  for (const [a, b] of ranges) {
    out.push(plain.slice(pos, a));
    out.push(<mark key={a}>{plain.slice(a, b)}</mark>);
    pos = b;
  }
  out.push(plain.slice(pos));
  return <span className="ltext">{out}</span>;
}
