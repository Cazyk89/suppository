import { useEffect, useRef, useState } from 'react';
import { go } from '../App';
import { CityCanvas } from '../components/CityCanvas';
import { CategoryTable, fmt } from '../components/common';
import { displayName, hasDims } from '../lib/buildingDb';
import { cloneCity, countCells, townHall } from '../lib/grid';
import type { OptimizeInput, OptimizeOptions, OptimizeResult } from '../lib/optimizer';
import { DEFAULT_OPTIONS } from '../lib/optimizer';
import { DEFAULT_MODE_WEIGHTS, DEFAULT_WEIGHTS, PRESETS, evaluateCity } from '../lib/scoring';
import type { ModeWeights, Weights } from '../lib/types';
import { useStore } from '../state/store';

const W_LABELS: Record<keyof Weights, string> = { military: 'Military strength', fp: 'Forge Points', goods: 'Goods', other: 'Resources & other' };
const M_LABELS: Record<keyof ModeWeights, string> = { gbg: 'Guild Battlegrounds', ge: 'Guild Expedition', qi: 'Quantum Incursions', pvp: 'PvP / neighborhood', cityDefense: 'City defense (defending army)' };

// Results are kept for the session so switching tabs doesn't lose them.
let lastResult: OptimizeResult | null = null;

export function Optimizer(_: { param?: string }) {
  const { project, update, getDef, ref, baseline } = useStore();
  const { settings } = project;
  const [opts, setOpts] = useState<OptimizeOptions>({ ...DEFAULT_OPTIONS });
  const [running, setRunning] = useState<{ fraction: number; message: string } | null>(null);
  const [result, setResult] = useState<OptimizeResult | null>(lastResult);
  const [pick, setPick] = useState(0);
  const [err, setErr] = useState('');
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);

  const source = baseline ?? project.city;
  const hasTh = !!townHall(source, getDef);
  const cells = countCells(source);
  const unknownPlaced = source.placements.filter((p) => getDef(p.defId)?.statsStatus === 'unknown').length;
  const readyStored = project.inventory.filter((i) => {
    const d = i.defId ? getDef(i.defId) : undefined;
    return i.category === 'building' && hasDims(d) && d.statsStatus !== 'unknown' && d.road !== 'unknown';
  }).length;

  const setWeight = (k: keyof Weights, v: number) => update((p) => ({ ...p, settings: { ...p.settings, weights: { ...p.settings.weights, [k]: v } } }));
  const setMode = (k: keyof ModeWeights, v: number) => update((p) => ({ ...p, settings: { ...p.settings, modeWeights: { ...p.settings.modeWeights, [k]: v } } }));
  const wTotal = Object.values(settings.weights).reduce((a, b) => a + b, 0);

  const run = () => {
    setErr('');
    worker.current?.terminate();
    const w = new Worker(new URL('../lib/optimizer.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setRunning({ fraction: 0, message: 'Starting…' });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') setRunning({ fraction: m.fraction, message: m.message });
      else if (m.type === 'done') {
        lastResult = m.result;
        setResult(m.result);
        setPick(0);
        setRunning(null);
        w.terminate();
      } else if (m.type === 'error') {
        setErr(m.message);
        setRunning(null);
        w.terminate();
      }
    };
    w.onerror = (e) => {
      setErr(e.message || 'Optimizer failed');
      setRunning(null);
    };
    const input: OptimizeInput = {
      city: source,
      defs: project.buildings,
      sets: project.sets,
      settings,
      inventory: project.inventory,
      recipes: project.recipes,
      ref,
      options: opts,
    };
    w.postMessage(input);
  };

  const cand = result?.candidates[pick];
  const saveCandidate = (andGo: boolean) => {
    if (!cand) return;
    const id = `layout-${Date.now()}`;
    update((p) => ({
      ...p,
      layouts: [...p.layouts, { id, name: `${cand.name} · score ${fmt(cand.score)}`, createdAt: new Date().toISOString(), city: cloneCity(cand.city), kind: 'optimized', notes: cand.trade.join('\n') }],
    }));
    if (andGo) go('plan', id);
  };

  return (
    <div>
      <h1>Optimizer</h1>
      {!baseline && <p className="notice small">No baseline saved: the optimizer starts from the current My City layout. Save a baseline in My City so comparisons stay fixed.</p>}
      {!hasTh && <p className="notice bad small">No Town Hall placed: road connections can't be checked. Place it in My City first.</p>}
      {cells.buildable === 0 && <p className="notice bad small">No buildable land is marked. Paint your city's land in My City (or enable “use unknown tiles”).</p>}
      {unknownPlaced > 0 && <p className="notice small">{unknownPlaced} placed buildings have unknown statistics; they stay where they are. <a href="#/buildings">Enter stats</a></p>}
      <p className="small muted">{readyStored} stored building types have size, road and stats entered and can be placed from inventory.</p>

      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Priorities</h2>
          <button className="sm" onClick={() => update((p) => ({ ...p, settings: { ...p.settings, weights: { ...DEFAULT_WEIGHTS }, modeWeights: { ...DEFAULT_MODE_WEIGHTS } } }))}>Reset to 35/30/20/15</button>
        </div>
        <div className="row" style={{ margin: '8px 0' }}>
          {PRESETS.map((pr) => {
            const on = JSON.stringify(pr.weights) === JSON.stringify(settings.weights) && JSON.stringify(pr.modeWeights) === JSON.stringify(settings.modeWeights);
            return (
              <button key={pr.id} className={`sm ${on ? 'on' : ''}`} onClick={() => update((p) => ({ ...p, settings: { ...p.settings, weights: { ...pr.weights }, modeWeights: { ...pr.modeWeights } } }))}>
                {pr.name}
              </button>
            );
          })}
        </div>
        {(Object.keys(W_LABELS) as (keyof Weights)[]).map((k) => (
          <label className="field" key={k}>
            {W_LABELS[k]}: {settings.weights[k]} ({fmt((100 * settings.weights[k]) / (wTotal || 1), 0)}%)
            <input type="range" min={0} max={100} value={settings.weights[k]} onChange={(e) => setWeight(k, Number(e.target.value))} />
          </label>
        ))}
        <details>
          <summary>Military by game mode</summary>
          <p className="small muted">How much each mode counts inside the military score. Mode-specific bonuses (e.g. “attack in GbG”) only count for that mode.</p>
          {(Object.keys(M_LABELS) as (keyof ModeWeights)[]).map((k) => (
            <label className="field" key={k}>
              {M_LABELS[k]}: {settings.modeWeights[k]}
              <input type="range" min={0} max={100} value={settings.modeWeights[k]} onChange={(e) => setMode(k, Number(e.target.value))} />
            </label>
          ))}
          <label className="check small">
            <input type="checkbox" checked={settings.modeRules.qiUsesCityBoosts} onChange={(e) => update((p) => ({ ...p, settings: { ...p.settings, modeRules: { qiUsesCityBoosts: e.target.checked } } }))} />
            General attacking-army bonuses also apply in QI (off: only QI-specific bonuses count)
          </label>
        </details>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Constraints</h2>
        <div className="stack">
          <label className="field">
            Mode
            <select value={opts.mode} onChange={(e) => setOpts({ ...opts, mode: e.target.value as OptimizeOptions['mode'] })}>
              <option value="rearrange">Rearrange: move/store any unlocked building</option>
              <option value="fill">Fill only: keep every building, add into free space</option>
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={opts.useInventory} onChange={(e) => setOpts({ ...opts, useInventory: e.target.checked })} />Place buildings from inventory</label>
          <label className="check"><input type="checkbox" checked={opts.useRecipes} onChange={(e) => setOpts({ ...opts, useRecipes: e.target.checked })} />Use kit recipes ({project.recipes.filter((r) => r.enabled).length} enabled)</label>
          <label className="check"><input type="checkbox" checked={opts.generateRoads} onChange={(e) => setOpts({ ...opts, generateRoads: e.target.checked })} />Also try new road layouts</label>
          <label className="check"><input type="checkbox" checked={opts.allowUnknownTerrain} onChange={(e) => setOpts({ ...opts, allowUnknownTerrain: e.target.checked })} />Build on tiles marked “unknown”</label>
          <div className="fields">
            <label className="field">Search effort<input type="number" min={0} max={5000} value={opts.iterations} onChange={(e) => setOpts({ ...opts, iterations: Number(e.target.value) })} /></label>
            <label className="field">Random seed<input type="number" value={opts.seed} onChange={(e) => setOpts({ ...opts, seed: Number(e.target.value) })} /></label>
            <label className="field">Candidates<input type="number" min={1} max={6} value={opts.candidates} onChange={(e) => setOpts({ ...opts, candidates: Number(e.target.value) })} /></label>
            <label className="field">Max buildings moved/stored<input type="number" min={0} placeholder="no limit" value={opts.maxMoves ?? ''} disabled={opts.mode === 'fill'} onChange={(e) => setOpts({ ...opts, maxMoves: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })} /></label>
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" onClick={run} disabled={!!running}>{running ? 'Optimizing…' : 'Generate layouts'}</button>
          {running && <button onClick={() => { worker.current?.terminate(); setRunning(null); }}>Cancel</button>}
        </div>
        {running && (
          <div style={{ marginTop: 8 }}>
            <div className="bar"><span style={{ width: `${Math.round(running.fraction * 100)}%` }} /></div>
            <p className="small muted">{running.message}</p>
          </div>
        )}
        {err && <p className="bad">{err}</p>}
      </div>

      {result && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Results</h2>
          <p className="small muted">
            Heuristic search in {fmt(result.elapsedMs / 1000, 1)} s. Current score {fmt(result.baseline.score)}; best found {fmt(result.candidates[0]?.score ?? 0)}; upper bound {fmt(result.upperBound)}. {result.boundNote} Results are not proven optimal.
          </p>
          {result.notes.map((n, i) => <p key={i} className="notice small">{n}</p>)}
          <div className="row">
            {result.candidates.map((c, i) => (
              <button key={c.id} className={`sm ${pick === i ? 'on' : ''}`} onClick={() => setPick(i)}>
                #{i + 1} · {fmt(c.score)}{c.valid ? '' : ' ⚠'}
              </button>
            ))}
          </div>
          {cand && (
            <>
              <h3>{cand.name}</h3>
              <CityCanvas city={cand.city} getDef={getDef} mode={project.viewMode} diffAgainst={source} height="50dvh" />
              <div className="legend"><span><i style={{ border: '3px solid #2ea043' }} />New</span><span><i style={{ border: '3px solid #58a6ff' }} />Moved/upgraded</span></div>
              <CategoryTable base={evaluateCity(source, getDef, settings, ref, project.sets).values} next={cand.values} />
              <ul className="small">{cand.trade.map((t, i) => <li key={i}>{t}</li>)}</ul>
              {!cand.valid && <div className="notice bad small">Validation issues: {cand.issues.slice(0, 5).join(' ')}</div>}
              {cand.kitsUsed.length > 0 && (
                <details>
                  <summary>Inventory used ({cand.kitsUsed.reduce((a, k) => a + k.qty, 0)} items)</summary>
                  <ul className="small">{cand.kitsUsed.map((k) => <li key={k.key}>{k.qty} × {project.inventory.find((i) => i.key === k.key)?.rawName ?? k.key}</li>)}</ul>
                </details>
              )}
              {cand.unplaced.length > 0 && (
                <details>
                  <summary>Not placed ({cand.unplaced.reduce((a, u) => a + u.count, 0)})</summary>
                  <ul className="small">{cand.unplaced.map((u) => <li key={u.defId + u.reason}>{u.count} × {displayName(getDef(u.defId))} — {u.reason}</li>)}</ul>
                </details>
              )}
              {result.excluded.length > 0 && (
                <details>
                  <summary>Skipped: missing data ({result.excluded.reduce((a, u) => a + u.count, 0)})</summary>
                  <ul className="small">{result.excluded.map((u) => <li key={u.defId + u.reason}>{u.count} × <a href={`#/buildings/${encodeURIComponent(u.defId)}`}>{displayName(getDef(u.defId))}</a> — {u.reason}</li>)}</ul>
                </details>
              )}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="primary" onClick={() => saveCandidate(true)}>Save & view plan</button>
                <button onClick={() => saveCandidate(false)}>Save layout</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
