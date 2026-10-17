import { go } from '../App';
import { CategoryTable, fmt } from '../components/common';
import { hasDims } from '../lib/buildingDb';
import { countCells, townHall, validateCity } from '../lib/grid';
import { inventoryTotals } from '../lib/inventory';
import { evaluateCity } from '../lib/scoring';
import { useStore } from '../state/store';

export function Dashboard(_: { param?: string }) {
  const { project, getDef, ref, baseline, update } = useStore();
  const { city, settings } = project;
  const ev = evaluateCity(city, getDef, settings, ref, project.sets);
  const cells = countCells(city);
  const val = validateCity(city, getDef);
  const inv = inventoryTotals(project.inventory);
  const placedDefs = new Set(city.placements.map((p) => p.defId));
  const placedKnown = [...placedDefs].filter((id) => {
    const d = getDef(id);
    return hasDims(d) && d.statsStatus !== 'unknown';
  }).length;
  const storedDefs = new Set(project.inventory.filter((i) => i.category === 'building' && i.defId).map((i) => i.defId!));
  const storedKnown = [...storedDefs].filter((id) => {
    const d = getDef(id);
    return hasDims(d) && d.statsStatus !== 'unknown' && d.road !== 'unknown';
  }).length;
  const hasTh = !!townHall(city, getDef);
  const unmappedKits = project.inventory.filter((i) => i.category === 'kit' && !project.recipes.some((r) => r.inputs.some((x) => x.key === i.key))).length;

  const steps = [
    { done: settings.eraVerified, text: `Confirm your era (currently “${settings.era}”, ${settings.eraVerified ? 'verified' : 'not verified'})`, to: 'dashboard' as const },
    { done: cells.unknown < city.terrain.length * 0.5 && cells.buildable > 0, text: 'Trace your city: import the reconstruction screenshot and paint buildable land and roads', to: 'city' as const },
    { done: hasTh, text: 'Place the Town Hall (needed for road connectivity)', to: 'city' as const },
    { done: city.placements.length > 5, text: 'Place your existing buildings on the grid', to: 'city' as const },
    { done: placedDefs.size > 0 && placedKnown === placedDefs.size, text: `Enter size and statistics for buildings in your city (${placedKnown}/${placedDefs.size} done)`, to: 'buildings' as const },
    { done: !!baseline, text: 'Save the traced city as your baseline', to: 'city' as const },
    { done: storedKnown > 0, text: `Enter size/stats for stored buildings you might place (${storedKnown}/${storedDefs.size} ready)`, to: 'buildings' as const },
    { done: project.recipes.length > 0, text: `Optional: map selection/upgrade kits to buildings (${unmappedKits} kits unmapped)`, to: 'buildings' as const },
    { done: project.layouts.some((l) => l.kind === 'optimized'), text: 'Run the optimizer and save a candidate layout', to: 'optimizer' as const },
  ];

  return (
    <div>
      <h1>Dashboard</h1>
      <div className="grid2">
        <div className="stat">
          <div className="v">{fmt(ev.score)}</div>
          <div className="l">Weighted score ({baseline ? '100 = saved baseline' : '100 = this city; save a baseline to compare'})</div>
        </div>
        <div className="stat">
          <div className="v">{city.placements.length}</div>
          <div className="l">Buildings placed · {ev.unscored.length} without stats</div>
        </div>
        <div className="stat">
          <div className="v">{cells.buildable}</div>
          <div className="l">Buildable tiles · {cells.unknown} unknown</div>
        </div>
        <div className="stat">
          <div className="v">{inv.total.toLocaleString()}</div>
          <div className="l">Inventory items ({inv.distinct} distinct)</div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>City performance</h2>
        <CategoryTable base={ev.values} />
        <p className="small muted">
          Totals only include buildings with entered statistics that are connected to the Town Hall. Weights: military {settings.weights.military}%, Forge Points {settings.weights.fp}%, goods {settings.weights.goods}%, other {settings.weights.other}%.
        </p>
        {val.issues.length > 0 && (
          <p className="warn small">
            {val.issues.length} layout issue{val.issues.length === 1 ? '' : 's'} in My City.{' '}
            <a href="#/city">Review</a>
          </p>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Getting to a first optimized layout</h2>
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={i}>
              <span className={s.done ? 'good' : ''}>{s.done ? '✓ ' : ''}</span>
              <a href={`#/${s.to}`} onClick={(e) => { e.preventDefault(); go(s.to); }}>{s.text}</a>
            </li>
          ))}
        </ol>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Era</h2>
        <div className="row">
          <input value={settings.era} onChange={(e) => update((p) => ({ ...p, settings: { ...p.settings, era: e.target.value, eraVerified: false } }))} aria-label="Era" />
          <label className="check">
            <input type="checkbox" checked={settings.eraVerified} onChange={(e) => update((p) => ({ ...p, settings: { ...p.settings, eraVerified: e.target.checked } }))} />
            Verified in game
          </label>
        </div>
        <p className="small muted">The previous session recorded Oceanic Future; confirm it in game. Era-dependent statistics you enter should match this era.</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Opportunities</h2>
        <ul>
          <li>{inv.building} stored buildings ({storedDefs.size} types), {storedKnown} ready for the optimizer.</li>
          <li>{inv.kit} selection/upgrade kits — the optimizer only uses kits through recipes you define.</li>
          <li>{fmt(project.inventory.find((i) => i.key === 'store building')?.quantity ?? 0, 0)} Store Building items available for storing buildings.</li>
          <li>{cells.unknown > 0 ? `${cells.unknown} tiles still marked unknown — painting them as buildable or blocked improves the result.` : 'Every tile is classified.'}</li>
        </ul>
      </div>
    </div>
  );
}
