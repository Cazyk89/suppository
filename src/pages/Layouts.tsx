import { useState } from 'react';
import { go } from '../App';
import { CityCanvas } from '../components/CityCanvas';
import { CategoryTable, fmt } from '../components/common';
import { renderLayoutPng, themeFromCss } from '../components/render';
import { cloneCity } from '../lib/grid';
import { defaultProject, exportBackup, importBackup } from '../lib/project';
import { evaluateCity } from '../lib/scoring';
import { inventoryShortfalls } from '../lib/recommendations';
import { download } from '../lib/storage';
import { useStore } from '../state/store';

export function Layouts(_: { param?: string }) {
  const { project, update, replace, getDef, ref, persistent, baseline } = useStore();
  const [a, setA] = useState(project.baselineId ?? project.layouts[0]?.id ?? '');
  const [b, setB] = useState(project.layouts.at(-1)?.id ?? '');
  const [msg, setMsg] = useState('');
  const la = project.layouts.find((l) => l.id === a);
  const lb = project.layouts.find((l) => l.id === b);

  const saveCurrent = () => {
    const name = prompt('Name for this layout', `My City ${new Date().toLocaleString()}`);
    if (!name) return;
    update((p) => ({ ...p, layouts: [...p.layouts, { id: `layout-${Date.now()}`, name, createdAt: new Date().toISOString(), city: cloneCity(p.city), kind: 'manual' }] }));
  };

  return (
    <div>
      <h1>Saved Layouts</h1>
      <div className="row">
        <button className="primary" onClick={saveCurrent}>Save current city as layout</button>
      </div>
      <div className="card list">
        {project.layouts.map((l) => {
          const ev = evaluateCity(l.city, getDef, project.settings, ref, project.sets);
          const short = l.id !== project.baselineId ? inventoryShortfalls(baseline ?? project.city, l.city, project.inventory, project.recipes).length : 0;
          return (
            <div key={l.id} className="item" style={{ flexWrap: 'wrap' }}>
              <div className="name">
                <div>{l.name} {l.id === project.baselineId && <span className="badge good">baseline</span>} <span className="badge">{l.kind}</span>{short > 0 && <span className="badge bad">needs items you no longer have</span>}</div>
                <div className="small muted">{new Date(l.createdAt).toLocaleString()} · score {fmt(ev.score)} · {l.city.placements.length} buildings</div>
              </div>
              <div className="row">
                <button className="sm" onClick={() => {
                  if (!confirm(`Replace the My City layout with “${l.name}”? Save the current one first if you need it.`)) return;
                  update((p) => ({ ...p, city: cloneCity(l.city) }));
                  go('city');
                }}>Open in My City</button>
                {l.id !== project.baselineId && <button className="sm" onClick={() => go('plan', l.id)}>Plan</button>}
                {l.id !== project.baselineId && <button className="sm" onClick={() => update((p) => ({ ...p, baselineId: l.id }))}>Set baseline</button>}
                <button className="sm" onClick={async () => download(`${l.name}.png`, await renderLayoutPng(l.city, getDef, project.viewMode, themeFromCss()))}>PNG</button>
                <button className="sm" onClick={() => {
                  const name = prompt('Rename', l.name);
                  if (name) update((p) => ({ ...p, layouts: p.layouts.map((x) => (x.id === l.id ? { ...x, name } : x)) }));
                }}>Rename</button>
                <button className="sm danger" onClick={() => {
                  if (confirm(`Delete “${l.name}”?`)) update((p) => ({ ...p, layouts: p.layouts.filter((x) => x.id !== l.id), baselineId: p.baselineId === l.id ? null : p.baselineId }));
                }}>Delete</button>
              </div>
            </div>
          );
        })}
        {!project.layouts.length && <p className="muted">No saved layouts yet.</p>}
      </div>

      {project.layouts.length >= 2 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Compare</h2>
          <div className="fields">
            <label className="field">Before<select value={a} onChange={(e) => setA(e.target.value)}>{project.layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <label className="field">After<select value={b} onChange={(e) => setB(e.target.value)}>{project.layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          </div>
          {la && lb && (
            <>
              <CategoryTable base={evaluateCity(la.city, getDef, project.settings, ref, project.sets).values} next={evaluateCity(lb.city, getDef, project.settings, ref, project.sets).values} />
              <div className="split" style={{ marginTop: 8 }}>
                <div><h3>Before</h3><CityCanvas city={la.city} getDef={getDef} mode={project.viewMode} height="40dvh" /></div>
                <div><h3>After</h3><CityCanvas city={lb.city} getDef={getDef} mode={project.viewMode} diffAgainst={la.city} height="40dvh" /></div>
              </div>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Backup & restore</h2>
        <p className="small muted">
          Everything is stored on this device only (IndexedDB{persistent ? ', persistent' : ''}). On iPhone, add the app to your Home Screen and export a backup regularly — Safari may clear website data that hasn't been used for a while.
        </p>
        <div className="row">
          <button onClick={async () => download(`foe-optimizer-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup(project), 'application/json')}>Export backup</button>
          <label className="btn">Restore backup<input type="file" accept="application/json,.json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const p = await importBackup(await f.text());
              if (confirm('Replace the current project with this backup?')) {
                replace(p);
                setMsg('Backup restored.');
              }
            } catch (err) {
              setMsg((err as Error).message);
            }
          }} /></label>
          <button className="danger" onClick={() => {
            if (confirm('Reset the whole project to defaults? Export a backup first.')) replace(defaultProject());
          }}>Reset project</button>
        </div>
        {msg && <p className="small">{msg}</p>}
      </div>
    </div>
  );
}
