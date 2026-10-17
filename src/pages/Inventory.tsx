import { useMemo, useState } from 'react';
import { go } from '../App';
import { linkInventoryToDefs } from '../lib/buildingDb';
import { toCsv } from '../lib/csv';
import { effectiveQty, extractSheetId, inventoryTotals, mergeInventory, parseInventoryCsv, sheetCsvUrl } from '../lib/inventory';
import { download } from '../lib/storage';
import type { BuildingDef, InvCategory, Project } from '../lib/types';
import { useStore } from '../state/store';

const CATS: { id: InvCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'building', label: 'Buildings' },
  { id: 'kit', label: 'Kits' },
  { id: 'boost', label: 'Boosts' },
];

export function Inventory(_: { param?: string }) {
  const { project, update } = useStore();
  const [cat, setCat] = useState<InvCategory | 'all'>('all');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [paste, setPaste] = useState('');
  const [sheetInput, setSheetInput] = useState(project.settings.sheetId);
  const totals = inventoryTotals(project.inventory);
  const reported = project.inventoryMeta.summary ?? {};

  const placedCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of project.city.placements) if (p.origin === 'inventory' && p.sourceRef) m.set(p.sourceRef, (m.get(p.sourceRef) ?? 0) + 1);
    return m;
  }, [project.city]);
  const recipeUse = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of project.recipes) for (const i of r.inputs) m.set(i.key, (m.get(i.key) ?? 0) + 1);
    return m;
  }, [project.recipes]);

  const applyImport = (text: string, source: string) => {
    const parsed = parseInventoryCsv(text);
    if (!parsed.items.length) {
      setStatus('No inventory rows found. Expected columns: Category, Item Name, Quantity.');
      return;
    }
    update((p): Project => {
      const inventory = mergeInventory(p.inventory, parsed.items);
      const defs = new Map<string, BuildingDef>(p.buildings.map((b) => [b.id, b]));
      linkInventoryToDefs(inventory, defs);
      return {
        ...p,
        inventory,
        buildings: [...defs.values()],
        inventoryMeta: { importedAt: new Date().toISOString(), source, summary: parsed.reported },
      };
    });
    const t = inventoryTotals(parsed.items);
    setStatus(`Imported ${parsed.items.length} items (${t.total} total) from ${source}.${parsed.warnings.length ? ' Warnings: ' + parsed.warnings.join('; ') : ''}`);
  };

  const refreshFromSheet = async () => {
    const id = extractSheetId(sheetInput);
    if (!id) {
      setStatus('Paste your Google Sheet link first. It is saved on this device only.');
      return;
    }
    update((p) => ({ ...p, settings: { ...p.settings, sheetId: id } }));
    setStatus('Fetching from Google Sheets…');
    try {
      const res = await fetch(sheetCsvUrl(id));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (/^\s*</.test(text)) throw new Error('Google returned a sign-in page');
      applyImport(text, 'Google Sheets (live)');
    } catch (e) {
      setStatus(
        `Could not read the sheet directly (${(e as Error).message}). The sheet must be shared as “Anyone with the link can view”. Otherwise use File → Download → CSV in Google Sheets and upload the file below. The original sheet is never modified.`,
      );
    }
  };

  const items = project.inventory
    .filter((i) => cat === 'all' || i.category === cat)
    .filter((i) => !q || i.rawName.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.category.localeCompare(b.category) || a.rawName.localeCompare(b.rawName));

  const adjust = (key: string, d: number) =>
    update((p) => ({ ...p, inventory: p.inventory.map((i) => (i.key === key ? { ...i, adjust: i.adjust + d } : i)) }));

  const exportCsv = () => {
    const rows: (string | number)[][] = [['Category', 'Item Name', 'Imported Quantity', 'Adjustment', 'Effective Quantity', 'Placed In City', 'Kit Type', 'Level', 'Building Id']];
    for (const i of project.inventory)
      rows.push([i.category, i.rawName, i.quantity, i.adjust, effectiveQty(i), placedCount.get(i.key) ?? 0, i.kitType ?? '', i.level ?? '', i.defId ?? '']);
    download('foe-inventory.csv', toCsv(rows), 'text/csv');
  };

  return (
    <div>
      <h1>Inventory</h1>
      <div className="grid2">
        <div className="stat"><div className="v">{totals.building}</div><div className="l">Stored buildings{reported['Buildings & Other Items'] !== undefined ? ` (sheet: ${reported['Buildings & Other Items']})` : ''}</div></div>
        <div className="stat"><div className="v">{totals.kit}</div><div className="l">Selection & upgrade kits{reported['Selection & Upgrade Kits'] !== undefined ? ` (sheet: ${reported['Selection & Upgrade Kits']})` : ''}</div></div>
        <div className="stat"><div className="v">{totals.boost}</div><div className="l">Boosts & consumables{reported['Boosts'] !== undefined ? ` (sheet: ${reported['Boosts']})` : ''}</div></div>
        <div className="stat"><div className="v">{totals.total}</div><div className="l">Total · {totals.distinct} distinct{reported['Grand Total Items'] !== undefined ? ` (sheet: ${reported['Grand Total Items']} / ${reported['Distinct Item Names']})` : ''}</div></div>
      </div>
      <p className="small muted">
        Source: {project.inventoryMeta.source} · imported {project.inventoryMeta.importedAt ? new Date(project.inventoryMeta.importedAt).toLocaleString() : 'never'}. Manual adjustments are kept across refreshes.
      </p>

      <details className="card">
        <summary>Refresh inventory</summary>
        <div className="stack">
          <label className="field">
            Google Sheet link or ID (saved on this device only)
            <input value={sheetInput} placeholder="https://docs.google.com/spreadsheets/d/…" onChange={(e) => setSheetInput(e.target.value)} />
          </label>
          <div className="row">
            <button className="primary" onClick={refreshFromSheet}>Refresh from Google Sheets</button>
            <label className="btn">
              Upload CSV
              <input type="file" accept=".csv,text/csv" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) applyImport(await f.text(), f.name);
              }} />
            </label>
            <button onClick={exportCsv}>Export CSV</button>
          </div>
          <textarea placeholder="…or paste CSV rows here (Category, Item Name, Quantity)" value={paste} onChange={(e) => setPaste(e.target.value)} />
          <div><button disabled={!paste.trim()} onClick={() => applyImport(paste, 'pasted CSV')}>Import pasted CSV</button></div>
        </div>
      </details>
      {status && <p className="notice info small">{status}</p>}

      <div className="row" style={{ margin: '8px 0' }}>
        {CATS.map((c) => (
          <button key={c.id} className={`sm ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(c.id)}>{c.label}</button>
        ))}
      </div>
      <input placeholder="Search inventory" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }} />

      <div className="card list">
        {items.map((i) => {
          const placed = placedCount.get(i.key) ?? 0;
          const eff = effectiveQty(i);
          return (
            <div className="item" key={i.key}>
              <div className="name">
                <div>{i.rawName}</div>
                <div className="small muted row" style={{ gap: 4 }}>
                  <span className="badge">{i.category === 'kit' ? `${i.kitType} kit` : i.category}</span>
                  {i.tier && <span className="badge">{i.tier}</span>}
                  {i.level ? <span className="badge">Lv. {i.level}</span> : null}
                  {i.active && <span className="badge">active</span>}
                  {i.category === 'kit' && (recipeUse.get(i.key) ? <span className="badge good">{recipeUse.get(i.key)} recipe(s)</span> : <span className="badge warn">no recipe — not used</span>)}
                  {placed > 0 && <span className="badge">{placed} placed in city</span>}
                  {placed > eff && <span className="badge bad">over-used!</span>}
                  {i.category === 'building' && i.defId && <a href="#" onClick={(e) => { e.preventDefault(); go('buildings', i.defId); }}>stats</a>}
                </div>
              </div>
              <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                <button className="sm icon-btn" onClick={() => adjust(i.key, -1)} aria-label="Decrease">−</button>
                <div style={{ minWidth: 42, textAlign: 'center' }}>
                  <b>{eff}</b>
                  {i.adjust !== 0 && <div className="small muted">{i.quantity}{i.adjust > 0 ? '+' : ''}{i.adjust}</div>}
                </div>
                <button className="sm icon-btn" onClick={() => adjust(i.key, 1)} aria-label="Increase">＋</button>
              </div>
            </div>
          );
        })}
        {!items.length && <p className="muted">No items match.</p>}
      </div>
    </div>
  );
}
