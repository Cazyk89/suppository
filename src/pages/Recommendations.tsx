import { useMemo, useState } from 'react';
import { CityCanvas } from '../components/CityCanvas';
import { CategoryTable, fmt } from '../components/common';
import { renderLayoutPng, themeFromCss } from '../components/render';
import type { Action } from '../lib/recommendations';
import { planToText, rebuildPlan, recommend } from '../lib/recommendations';
import { evaluateCity } from '../lib/scoring';
import { download } from '../lib/storage';
import { useStore } from '../state/store';

const ACTION_LABEL: Record<Action, string> = { upgrade: 'Upgrade', construct: 'Construct', place: 'Place', store: 'Store', move: 'Move', keep: 'Keep' };

export function Recommendations({ param }: { param?: string }) {
  const { project, getDef, ref, baseline } = useStore();
  const candidates = project.layouts.filter((l) => l.id !== project.baselineId);
  const [layoutId, setLayoutId] = useState(param ?? candidates.at(-1)?.id ?? '');
  const [filter, setFilter] = useState<Action | 'changes'>('changes');
  const layout = project.layouts.find((l) => l.id === layoutId);
  const base = baseline ?? project.city;

  const recs = useMemo(
    () => (layout ? recommend(base, layout.city, getDef, project.settings, ref, project.inventory, project.recipes) : []),
    [layout, base, getDef, project.settings, ref, project.inventory, project.recipes],
  );
  const steps = useMemo(() => (layout ? rebuildPlan(base, layout.city, recs, getDef) : []), [layout, base, recs, getDef]);
  if (!candidates.length || !layout)
    return (
      <div>
        <h1>Recommendations</h1>
        <p>No proposed layout yet. Run the <a href="#/optimizer">Optimizer</a> and save a candidate, or save a manual layout in <a href="#/layouts">Layouts</a>.</p>
      </div>
    );

  const evBase = evaluateCity(base, getDef, project.settings, ref, project.sets);
  const evNew = evaluateCity(layout.city, getDef, project.settings, ref, project.sets);
  const shown = recs.filter((r) => (filter === 'changes' ? r.action !== 'keep' : r.action === filter));
  const counts = recs.reduce<Record<string, number>>((m, r) => ((m[r.action] = (m[r.action] ?? 0) + 1), m), {});

  return (
    <div>
      <h1>Recommendations</h1>
      <label className="field">
        Proposed layout
        <select value={layoutId} onChange={(e) => setLayoutId(e.target.value)}>
          {candidates.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      <p className="small muted">Compared with {baseline ? 'your saved baseline' : 'the current My City layout (no baseline saved)'}.</p>

      <div className="grid2">
        <div className="stat"><div className="v">{fmt(evBase.score)} → {fmt(evNew.score)}</div><div className="l">Weighted score</div></div>
        <div className="stat"><div className="v">{(counts.place ?? 0) + (counts.construct ?? 0)}</div><div className="l">Buildings added</div></div>
        <div className="stat"><div className="v">{counts.store ?? 0}</div><div className="l">Buildings stored</div></div>
        <div className="stat"><div className="v">{counts.move ?? 0}</div><div className="l">Buildings moved</div></div>
      </div>
      <div className="card"><CategoryTable base={evBase.values} next={evNew.values} /></div>

      <CityCanvas city={layout.city} getDef={getDef} mode={project.viewMode} diffAgainst={base} height="45dvh" />
      <div className="legend"><span><i style={{ border: '3px solid #2ea043' }} />New</span><span><i style={{ border: '3px solid #58a6ff' }} />Moved/upgraded</span></div>

      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={async () => download(`${layout.name}.png`, await renderLayoutPng(layout.city, getDef, project.viewMode, themeFromCss(), base))}>Export image</button>
        <button onClick={() => download(`${layout.name} - rebuilding plan.md`, planToText(layout.name, steps, recs), 'text/markdown')}>Export instructions</button>
      </div>

      <h2>Rebuilding plan</h2>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={i}>
            <b>{s.title}</b>
            <ul className="small">{s.details.map((d, k) => <li key={k}>{d}</li>)}</ul>
          </li>
        ))}
      </ol>

      <h2>Ranked changes</h2>
      <div className="row">
        <button className={`sm ${filter === 'changes' ? 'on' : ''}`} onClick={() => setFilter('changes')}>All changes</button>
        {(Object.keys(ACTION_LABEL) as Action[]).filter((a) => counts[a]).map((a) => (
          <button key={a} className={`sm ${filter === a ? 'on' : ''}`} onClick={() => setFilter(a)}>{ACTION_LABEL[a]} ({counts[a]})</button>
        ))}
      </div>
      <div className="list card">
        {shown.map((r) => (
          <details key={r.uid + r.action} className="item" style={{ display: 'block' }}>
            <summary>
              <span className="badge">{ACTION_LABEL[r.action]}</span>&nbsp;{r.title}
              <span className="spacer" />
              <span className={r.impact > 0 ? 'good' : r.impact < 0 ? 'bad' : 'muted'}>&nbsp;{r.impact > 0 ? '+' : ''}{fmt(r.impact, 2)}</span>
            </summary>
            <div className="small stack" style={{ gap: 4, padding: '4px 0 8px' }}>
              <div><b>Why:</b> {r.why}</div>
              <div><b>Estimated change:</b> {r.impact > 0 ? '+' : ''}{fmt(r.impact, 2)} score points (own statistics only; set/chain effects are in the total above)</div>
              <div><b>Tiles:</b> {r.action === 'store' ? `${r.tiles} freed` : r.action === 'upgrade' ? `${r.tiles >= 0 ? '+' : ''}${r.tiles}` : r.tiles ? `${r.tiles} used` : '0'}{r.from ? ` · from ${r.from}` : ''}{r.to ? ` · to ${r.to}` : ''}</div>
              {r.items.length > 0 && <div><b>Items:</b> {r.items.join('; ')}</div>}
              <div><b>Reversible:</b> {r.reversible}</div>
              {r.risk.length > 0 && <div className="warn"><b>Uncertainty:</b> {r.risk.join(' ')}</div>}
            </div>
          </details>
        ))}
        {!shown.length && <p className="muted">No changes of this type.</p>}
      </div>
    </div>
  );
}
