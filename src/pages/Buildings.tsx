import { useState } from 'react';
import { go } from '../App';
import { StatusBadge } from '../components/common';
import { displayName, hasDims, newDef } from '../lib/buildingDb';
import { parseCsv, toCsv } from '../lib/csv';
import { nameKey, slug } from '../lib/inventory';
import { download } from '../lib/storage';
import type { BuildingDef, BuildingKind, Recipe, RoadReq, SetDef, Stats, VerifyStatus } from '../lib/types';
import { STAT_KEYS, STAT_LABELS } from '../lib/types';
import { useStore } from '../state/store';

const KINDS: BuildingKind[] = ['townhall', 'greatbuilding', 'special', 'residential', 'production', 'goods', 'military', 'cultural', 'decoration', 'other'];
const ROADS: RoadReq[] = ['unknown', 'none', 'road', 'road2'];
const STATUSES: VerifyStatus[] = ['unknown', 'user', 'verified'];
const CSV_COLS = ['id', 'name', 'variant', 'era', 'level', 'kind', 'width', 'height', 'road', 'rotatable', 'dimsStatus', 'statsStatus', 'source', ...STAT_KEYS] as const;

type Filter = 'all' | 'city' | 'stored' | 'missing';

export function Buildings({ param }: { param?: string }) {
  const { project, update } = useStore();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('city');
  const [tab, setTab] = useState<'list' | 'sets' | 'recipes'>('list');
  const [msg, setMsg] = useState('');
  const editing = param ? project.buildings.find((b) => b.id === param) : undefined;

  const inCity = new Set(project.city.placements.map((p) => p.defId));
  const stored = new Set(project.inventory.filter((i) => i.category === 'building' && i.defId).map((i) => i.defId!));
  const missing = (d: BuildingDef) => !hasDims(d) || d.statsStatus === 'unknown' || d.road === 'unknown';
  const list = project.buildings
    .filter((d) => filter === 'all' || (filter === 'city' ? inCity.has(d.id) : filter === 'stored' ? stored.has(d.id) : missing(d) && (inCity.has(d.id) || stored.has(d.id))))
    .filter((d) => !q || d.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const exportCsv = () => {
    const rows: (string | number)[][] = [[...CSV_COLS]];
    for (const d of project.buildings) {
      const s = d.stats as Partial<Stats>;
      rows.push(CSV_COLS.map((c) => {
        if ((STAT_KEYS as string[]).includes(c)) return s[c as keyof Stats] ?? '';
        const v = (d as unknown as Record<string, unknown>)[c];
        return v === null || v === undefined ? '' : String(v);
      }));
    }
    download('foe-building-database.csv', toCsv(rows), 'text/csv');
  };

  const importCsv = async (file: File) => {
    const rows = parseCsv(await file.text());
    const head = rows[0]?.map((h) => h.trim());
    if (!head?.includes('name')) {
      setMsg('CSV needs a header row with at least a "name" column.');
      return;
    }
    // Count outside the state updater: React may run the updater after this function returns.
    const records = rows.slice(1).map((r) => {
      const rec: Record<string, string> = {};
      head.forEach((h, i) => (rec[h] = (r[i] ?? '').trim()));
      return rec;
    }).filter((rec) => rec.name);
    update((p) => {
      const defs = new Map(p.buildings.map((b) => [b.id, b]));
      for (const rec of records) {
        const id = rec.id || slug(rec.name);
        const d: BuildingDef = { ...(defs.get(id) ?? newDef({ id, name: rec.name })) };
        d.name = rec.name;
        if (rec.variant !== undefined) d.variant = rec.variant || undefined;
        if (rec.era !== undefined) d.era = rec.era || undefined;
        if (rec.level) d.level = Number(rec.level);
        if (KINDS.includes(rec.kind as BuildingKind)) d.kind = rec.kind as BuildingKind;
        if (rec.width) d.width = Number(rec.width);
        if (rec.height) d.height = Number(rec.height);
        if (ROADS.includes(rec.road as RoadReq)) d.road = rec.road as RoadReq;
        if (rec.rotatable) d.rotatable = rec.rotatable === 'true';
        if (STATUSES.includes(rec.dimsStatus as VerifyStatus)) d.dimsStatus = rec.dimsStatus as VerifyStatus;
        if (STATUSES.includes(rec.statsStatus as VerifyStatus)) d.statsStatus = rec.statsStatus as VerifyStatus;
        if (rec.source) d.source = rec.source;
        const stats: Partial<Stats> = { ...d.stats };
        let anyStat = false;
        for (const k of STAT_KEYS)
          if (rec[k] !== undefined && rec[k] !== '') {
            stats[k] = Number(rec[k]);
            anyStat = true;
          }
        d.stats = stats;
        if (anyStat && d.statsStatus === 'unknown') d.statsStatus = 'user';
        if (hasDims(d) && d.dimsStatus === 'unknown') d.dimsStatus = 'user';
        defs.set(id, d);
      }
      return { ...p, buildings: [...defs.values()] };
    });
    setMsg(`Imported ${records.length} building rows.`);
  };

  if (editing) return <Editor def={editing} />;

  return (
    <div>
      <h1>Building Database</h1>
      <p className="small muted">
        No statistics are pre-filled. Enter values from your game (building tooltip) or a verified source; each entry records whether it is unknown, user-entered or verified. The optimizer skips buildings whose size, road requirement or statistics are unknown.
      </p>
      <div className="row">
        {(['list', 'sets', 'recipes'] as const).map((t) => (
          <button key={t} className={`sm ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t === 'list' ? 'Buildings' : t === 'sets' ? 'Sets' : 'Kit recipes'}</button>
        ))}
      </div>
      {tab === 'sets' && <Sets />}
      {tab === 'recipes' && <Recipes />}
      {tab === 'list' && (
        <>
          <div className="row" style={{ margin: '8px 0' }}>
            {(['city', 'stored', 'missing', 'all'] as Filter[]).map((f) => (
              <button key={f} className={`sm ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
                {f === 'city' ? `In city (${inCity.size})` : f === 'stored' ? `In inventory (${stored.size})` : f === 'missing' ? 'Missing data' : `All (${project.buildings.length})`}
              </button>
            ))}
          </div>
          <div className="row">
            <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
            <button onClick={() => {
              const name = q.trim() || 'New building';
              const id = slug(name) + (project.buildings.some((b) => b.id === slug(name)) ? '-' + Date.now().toString(36) : '');
              update((p) => ({ ...p, buildings: [...p.buildings, newDef({ id, name })] }));
              go('buildings', id);
            }}>＋ Add</button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="sm" onClick={exportCsv}>Export CSV</button>
            <label className="btn sm">Import CSV<input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} /></label>
            <span className="small muted">Fill stats in a spreadsheet, then import.</span>
          </div>
          {msg && <p className="small">{msg}</p>}
          <div className="card list">
            {list.map((d) => (
              <a key={d.id} className="item" href={`#/buildings/${encodeURIComponent(d.id)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                <div className="name">
                  <div>{displayName(d)}</div>
                  <div className="small muted">{d.kind} · {hasDims(d) ? `${d.width}×${d.height}` : '?×?'} · road: {d.road}</div>
                </div>
                <div className="stack" style={{ alignItems: 'flex-end', gap: 2 }}>
                  <StatusBadge s={d.dimsStatus} />
                  <StatusBadge s={d.statsStatus} />
                </div>
              </a>
            ))}
            {!list.length && <p className="muted">Nothing here yet. Buildings you place in My City appear under “In city”.</p>}
          </div>
        </>
      )}
    </div>
  );
}

function Editor({ def }: { def: BuildingDef }) {
  const { project, update } = useStore();
  const [d, setD] = useState<BuildingDef>(def);
  const set = <K extends keyof BuildingDef>(k: K, v: BuildingDef[K]) => setD({ ...d, [k]: v });
  const setStat = (k: keyof Stats, v: string) => {
    const stats = { ...d.stats };
    if (v === '') delete stats[k];
    else stats[k] = Number(v);
    setD({ ...d, stats, statsStatus: d.statsStatus === 'unknown' ? 'user' : d.statsStatus });
  };
  const save = () => {
    const fixed = { ...d, dimsStatus: hasDims(d) && d.dimsStatus === 'unknown' ? ('user' as const) : d.dimsStatus };
    update((p) => ({ ...p, buildings: p.buildings.map((b) => (b.id === def.id ? fixed : b)) }));
    history.back();
  };
  const usedIn = project.city.placements.filter((p) => p.defId === def.id).length;
  const inv = project.inventory.filter((i) => i.defId === def.id);
  const num = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

  return (
    <div>
      <div className="row between">
        <h1 style={{ margin: 0 }}>{displayName(d)}</h1>
        <button className="sm" onClick={() => history.back()}>Back</button>
      </div>
      <p className="small muted">{usedIn} placed in city · {inv.map((i) => `${i.quantity} × “${i.rawName}” in inventory`).join(', ') || 'not in inventory'}</p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Identity</h3>
        <div className="fields">
          <label className="field">Name<input value={d.name} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="field">Variant<input value={d.variant ?? ''} onChange={(e) => set('variant', e.target.value || undefined)} /></label>
          <label className="field">Era<input value={d.era ?? ''} placeholder={project.settings.era} onChange={(e) => set('era', e.target.value || undefined)} /></label>
          <label className="field">Level<input inputMode="numeric" value={num(d.level)} onChange={(e) => set('level', e.target.value ? Number(e.target.value) : null)} /></label>
          <label className="field">Kind<select value={d.kind} onChange={(e) => set('kind', e.target.value as BuildingKind)}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Footprint & road</h3>
        <div className="fields">
          <label className="field">Width (tiles)<input inputMode="numeric" value={num(d.width)} onChange={(e) => set('width', e.target.value ? Number(e.target.value) : null)} /></label>
          <label className="field">Height (tiles)<input inputMode="numeric" value={num(d.height)} onChange={(e) => set('height', e.target.value ? Number(e.target.value) : null)} /></label>
          <label className="field">Road<select value={d.road} onChange={(e) => set('road', e.target.value as RoadReq)}>
            <option value="unknown">unknown</option><option value="none">no road needed</option><option value="road">road</option><option value="road2">two-lane road</option>
          </select></label>
          <label className="field">Size status<select value={d.dimsStatus} onChange={(e) => set('dimsStatus', e.target.value as VerifyStatus)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        </div>
        <label className="check"><input type="checkbox" checked={d.rotatable} onChange={(e) => set('rotatable', e.target.checked)} />Can be rotated in game</label>
        <label className="check"><input type="checkbox" checked={!!d.protected} onChange={(e) => set('protected', e.target.checked)} />Protected (never moved or stored)</label>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Statistics <span className="small muted">(per day / additive %, at this level and era; blank = 0)</span></h3>
        <div className="fields">
          {STAT_KEYS.map((k) => (
            <label key={k} className="field">{STAT_LABELS[k]}<input inputMode="decimal" value={d.stats[k] ?? ''} onChange={(e) => setStat(k, e.target.value)} /></label>
          ))}
          <label className="field">Stats status<select value={d.statsStatus} onChange={(e) => set('statsStatus', e.target.value as VerifyStatus)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        </div>
        <p className="small muted">“Other value pts” is your own scale for coins, supplies, units, fragments and similar; keep it consistent between buildings. Set status to “user” with all blanks for a building that genuinely gives nothing.</p>
        <label className="field">Source (e.g. “in-game tooltip, 2026-10”, wiki URL)<input value={d.source ?? ''} onChange={(e) => set('source', e.target.value || undefined)} /></label>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Sets & chains</h3>
        <div className="fields">
          <label className="field">Set<select value={d.setId ?? ''} onChange={(e) => set('setId', e.target.value || undefined)}>
            <option value="">—</option>{project.sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
          <label className="field">Chain id<input value={d.chainId ?? ''} onChange={(e) => set('chainId', e.target.value || undefined)} /></label>
          <label className="field">Chain role<select value={d.chainRole ?? ''} onChange={(e) => set('chainRole', (e.target.value || undefined) as BuildingDef['chainRole'])}>
            <option value="">—</option><option value="start">start</option><option value="link">link</option>
          </select></label>
        </div>
        {d.chainRole === 'link' && (
          <div className="fields" style={{ marginTop: 8 }}>
            {STAT_KEYS.map((k) => (
              <label key={k} className="field">Chain bonus: {STAT_LABELS[k]}<input inputMode="decimal" value={d.chainBonus?.[k] ?? ''} onChange={(e) => {
                const cb = { ...d.chainBonus };
                if (e.target.value === '') delete cb[k];
                else cb[k] = Number(e.target.value);
                set('chainBonus', cb);
              }} /></label>
            ))}
          </div>
        )}
      </div>

      <label className="field">Notes<textarea value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value || undefined)} /></label>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" onClick={save}>Save</button>
        <button onClick={() => history.back()}>Cancel</button>
        <span className="spacer" />
        <button className="danger" disabled={usedIn > 0 || inv.length > 0} onClick={() => {
          update((p) => ({ ...p, buildings: p.buildings.filter((b) => b.id !== def.id) }));
          history.back();
        }}>Delete</button>
      </div>
    </div>
  );
}

function Sets() {
  const { project, update } = useStore();
  const setSets = (fn: (s: SetDef[]) => SetDef[]) => update((p) => ({ ...p, sets: fn(p.sets) }));
  return (
    <div className="card">
      <p className="small muted">A set bonus applies when the given number of different set members touch each other (share an edge). Enter the bonus each tier adds on top of the previous one.</p>
      {project.sets.map((s) => (
        <div key={s.id} className="card">
          <div className="row">
            <input value={s.name} onChange={(e) => setSets((ss) => ss.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} />
            <span className="small muted">{project.buildings.filter((b) => b.setId === s.id).length} members</span>
            <button className="sm danger" onClick={() => setSets((ss) => ss.filter((x) => x.id !== s.id))}>Delete</button>
          </div>
          {s.tiers.map((t, ti) => (
            <div key={ti} className="row small" style={{ marginTop: 6 }}>
              <label className="field">Members<input style={{ width: 70 }} inputMode="numeric" value={t.count} onChange={(e) => setSets((ss) => ss.map((x) => (x.id === s.id ? { ...x, tiers: x.tiers.map((y, yi) => (yi === ti ? { ...y, count: Number(e.target.value) } : y)) } : x)))} /></label>
              {(['fp', 'goods', 'attAtk', 'attDef', 'other'] as (keyof Stats)[]).map((k) => (
                <label key={k} className="field">{STAT_LABELS[k]}<input style={{ width: 80 }} inputMode="decimal" value={t.stats[k] ?? ''} onChange={(e) => setSets((ss) => ss.map((x) => (x.id === s.id ? { ...x, tiers: x.tiers.map((y, yi) => (yi === ti ? { ...y, stats: { ...y.stats, [k]: e.target.value === '' ? undefined : Number(e.target.value) } } : y)) } : x)))} /></label>
              ))}
            </div>
          ))}
          <button className="sm" onClick={() => setSets((ss) => ss.map((x) => (x.id === s.id ? { ...x, tiers: [...x.tiers, { count: (x.tiers.at(-1)?.count ?? 1) + 1, stats: {} }] } : x)))}>＋ Tier</button>
        </div>
      ))}
      <button onClick={() => setSets((ss) => [...ss, { id: `set-${Date.now().toString(36)}`, name: 'New set', tiers: [{ count: 2, stats: {} }] }])}>＋ New set</button>
      <p className="small muted">Assign buildings to a set from each building's editor.</p>
    </div>
  );
}

function Recipes() {
  const { project, update } = useStore();
  const kits = project.inventory.filter((i) => i.category !== 'boost').sort((a, b) => a.rawName.localeCompare(b.rawName));
  const defs = [...project.buildings].sort((a, b) => a.name.localeCompare(b.name));
  const setR = (fn: (r: Recipe[]) => Recipe[]) => update((p) => ({ ...p, recipes: fn(p.recipes) }));
  const edit = (id: string, patch: Partial<Recipe>) => setR((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const unmapped = project.inventory.filter((i) => i.category === 'kit' && !project.recipes.some((r) => r.inputs.some((x) => x.key === i.key)));
  const quickAdd = (key: string) => {
    const item = project.inventory.find((i) => i.key === key)!;
    const guess = project.buildings.find((b) => nameKey(b.name) === nameKey(item.baseName));
    setR((rs) => [...rs, { id: `r-${Date.now().toString(36)}`, name: item.rawName, inputs: [{ key, qty: 1 }], outputDefId: guess?.id ?? '', enabled: false }]);
  };
  return (
    <div className="card">
      <p className="small muted">
        Kits are never assumed to produce anything. A recipe says what a kit (or several) turns into, and optionally which placed or stored building it consumes (for upgrade kits). A selection kit that offers several buildings can have one recipe per option; the optimizer picks at most what the kits allow. Recipes start disabled until you check them.
      </p>
      {project.recipes.map((r) => (
        <div key={r.id} className="card">
          <div className="row">
            <label className="check"><input type="checkbox" checked={r.enabled} onChange={(e) => edit(r.id, { enabled: e.target.checked })} />Enabled</label>
            <input value={r.name} onChange={(e) => edit(r.id, { name: e.target.value })} style={{ flex: 1 }} />
            <button className="sm danger" onClick={() => setR((rs) => rs.filter((x) => x.id !== r.id))}>Delete</button>
          </div>
          {r.inputs.map((inp, k) => (
            <div key={k} className="row small" style={{ marginTop: 6 }}>
              Uses
              <input style={{ width: 60 }} inputMode="numeric" value={inp.qty} onChange={(e) => edit(r.id, { inputs: r.inputs.map((x, xi) => (xi === k ? { ...x, qty: Number(e.target.value) } : x)) })} />
              ×
              <select value={inp.key} onChange={(e) => edit(r.id, { inputs: r.inputs.map((x, xi) => (xi === k ? { ...x, key: e.target.value } : x)) })}>
                {kits.map((i) => <option key={i.key} value={i.key}>{i.rawName}</option>)}
              </select>
              <button className="sm" onClick={() => edit(r.id, { inputs: r.inputs.filter((_, xi) => xi !== k) })}>✕</button>
            </div>
          ))}
          <button className="sm" onClick={() => edit(r.id, { inputs: [...r.inputs, { key: kits[0]?.key ?? '', qty: 1 }] })}>＋ Input</button>
          <div className="fields" style={{ marginTop: 8 }}>
            <label className="field">Consumes building (optional)<select value={r.consumesDefId ?? ''} onChange={(e) => edit(r.id, { consumesDefId: e.target.value || undefined })}>
              <option value="">— nothing —</option>{defs.map((d) => <option key={d.id} value={d.id}>{displayName(d)}</option>)}
            </select></label>
            <label className="field">Produces<select value={r.outputDefId} onChange={(e) => edit(r.id, { outputDefId: e.target.value })}>
              <option value="">— choose —</option>{defs.map((d) => <option key={d.id} value={d.id}>{displayName(d)}</option>)}
            </select></label>
          </div>
          {!r.outputDefId && <p className="small bad">Choose what this recipe produces.</p>}
        </div>
      ))}
      <h3>Kits without a recipe ({unmapped.length})</h3>
      <div className="list">
        {unmapped.map((i) => (
          <div key={i.key} className="item">
            <div className="name small">{i.quantity} × {i.rawName} <span className="badge">{i.kitType}</span></div>
            <button className="sm" onClick={() => quickAdd(i.key)}>Add recipe</button>
          </div>
        ))}
      </div>
    </div>
  );
}
