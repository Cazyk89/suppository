import { useMemo, useRef, useState } from 'react';
import { go } from '../App';
import type { CityCanvasHandle, Tool } from '../components/CityCanvas';
import { CityCanvas } from '../components/CityCanvas';
import { Sheet, StatusBadge, fmt, useUnderlayImages } from '../components/common';
import { CAT_COLORS, CAT_LABELS, gridBounds, gridToWorld } from '../components/render';
import { displayName, hasDims, newDef } from '../lib/buildingDb';
import { cloneCity, connectivity, coordLabel, countCells, footprint, inBounds, isConnected, resizeCity, validateCity } from '../lib/grid';
import { effectiveQty, slug } from '../lib/inventory';
import { blobDelete, blobSet } from '../lib/storage';
import type { CityState, Placement, Underlay } from '../lib/types';
import { ROAD_1, ROAD_2, ROAD_NONE, TERRAIN_BLOCKED, TERRAIN_BUILDABLE, TERRAIN_UNKNOWN } from '../lib/types';
import { useStore } from '../state/store';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: '☝ Select', hint: 'Tap a building to inspect. Tap it again and drag to move. Drag empty space to pan.' },
  { id: 'place', label: '＋ Place', hint: 'Choose a building, then tap where it goes.' },
  { id: 'road', label: '▬ Road', hint: 'Drag to paint one-lane road. Two fingers pan/zoom.' },
  { id: 'road2', label: '▰ 2-lane', hint: 'Drag to paint two-lane road.' },
  { id: 'eraseRoad', label: '⌫ Road', hint: 'Drag to erase roads.' },
  { id: 'buildable', label: '■ Land', hint: 'Drag to mark tiles as buildable land.' },
  { id: 'expansion', label: '▣ Expansion', hint: 'Tap to mark a 4×4 expansion block as buildable (blocks align to the grid origin).' },
  { id: 'blocked', label: '▨ Blocked', hint: 'Drag to mark tiles as inaccessible terrain.' },
  { id: 'unknown', label: '◌ Unknown', hint: 'Drag to reset tiles to unknown.' },
  { id: 'wand', label: '✦ Detect', hint: 'Tap a tile on the screenshot: similar-coloured connected tiles are marked (roads/land detection).' },
  { id: 'pan', label: '✋ Pan', hint: 'Drag to pan. Pinch to zoom.' },
];

let uidN = 0;
const newUid = () => `p-${Date.now().toString(36)}-${(uidN++).toString(36)}`;

export function MyCity(_: { param?: string }) {
  const { project, update, getDef, baseline } = useStore();
  const city = project.city;
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [placing, setPlacing] = useState<{ defId: string; rot: 0 | 1; fromInventory: string | null } | null>(null);
  const [palette, setPalette] = useState(false);
  const [panel, setPanel] = useState<'none' | 'grid' | 'screens' | 'issues'>('none');
  const [wandTarget, setWandTarget] = useState<'road' | 'buildable' | 'blocked'>('road');
  const [wandTol, setWandTol] = useState(28);
  const [msg, setMsg] = useState('');
  const history = useRef<CityState[]>([]);
  const future = useRef<CityState[]>([]);
  const canvasRef = useRef<CityCanvasHandle>(null);
  const mode = project.viewMode;
  const underlayImgs = useUnderlayImages(project.underlays);

  const validation = useMemo(() => validateCity(city, getDef), [city, getDef]);
  const disc = useMemo(() => new Set(validation.disconnectedRoads), [validation]);
  const cells = countCells(city);

  const setCity = (fn: (c: CityState) => CityState, record = true) => {
    if (record) {
      history.current.push(city);
      if (history.current.length > 50) history.current.shift();
      future.current = [];
    }
    update((p) => ({ ...p, city: fn(p.city) }));
  };
  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    future.current.push(city);
    update((p) => ({ ...p, city: prev }));
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(city);
    update((p) => ({ ...p, city: next }));
  };

  const occupiedBy = (c: CityState, ignore?: string) => {
    const occ = new Set<number>();
    for (const p of c.placements) {
      if (p.uid === ignore) continue;
      const f = footprint(p, getDef(p.defId));
      if (!f) continue;
      for (let y = p.y; y < p.y + f.h; y++) for (let x = p.x; x < p.x + f.w; x++) occ.add(y * c.width + x);
    }
    return occ;
  };

  const canPlace = (defId: string, x: number, y: number, rot: 0 | 1, ignore?: string) => {
    const f = footprint({ uid: '', defId, x, y, rot, locked: false, origin: 'manual' }, getDef(defId)) ?? { w: 1, h: 1 };
    const occ = occupiedBy(city, ignore);
    for (let j = y; j < y + f.h; j++)
      for (let i = x; i < x + f.w; i++) {
        if (!inBounds(city, i, j)) return false;
        const k = j * city.width + i;
        if (occ.has(k) || city.roads[k] !== ROAD_NONE || city.terrain[k] === TERRAIN_BLOCKED) return false;
      }
    return true;
  };

  const paintCell = (c: CityState, x: number, y: number, occ: Set<number>) => {
    const apply = (i: number, j: number) => {
      if (!inBounds(c, i, j)) return;
      const k = j * c.width + i;
      switch (tool) {
        case 'buildable':
          c.terrain[k] = TERRAIN_BUILDABLE;
          break;
        case 'expansion':
          c.terrain[k] = TERRAIN_BUILDABLE;
          break;
        case 'blocked':
          if (occ.has(k)) return;
          c.terrain[k] = TERRAIN_BLOCKED;
          c.roads[k] = ROAD_NONE;
          break;
        case 'unknown':
          c.terrain[k] = TERRAIN_UNKNOWN;
          break;
        case 'road':
        case 'road2':
          if (occ.has(k) || c.terrain[k] === TERRAIN_BLOCKED) return;
          c.roads[k] = tool === 'road' ? ROAD_1 : ROAD_2;
          if (c.terrain[k] === TERRAIN_UNKNOWN) c.terrain[k] = TERRAIN_BUILDABLE;
          break;
        case 'eraseRoad':
          c.roads[k] = ROAD_NONE;
          break;
      }
    };
    if (tool === 'expansion') {
      const bx = Math.floor(x / 4) * 4;
      const by = Math.floor(y / 4) * 4;
      for (let j = by; j < by + 4; j++) for (let i = bx; i < bx + 4; i++) apply(i, j);
    } else apply(x, y);
  };

  const onPaint = (pts: { x: number; y: number }[], phase: 'start' | 'move' | 'end') => {
    if (phase === 'end' || !pts.length) return;
    setCity((c) => {
      const n = { ...c, terrain: c.terrain.slice(), roads: c.roads.slice() };
      const occ = occupiedBy(c);
      for (const p of pts) paintCell(n, p.x, p.y, occ);
      return n;
    }, phase === 'start');
  };

  const placedFromInv = (key: string) => city.placements.filter((p) => p.origin === 'inventory' && p.sourceRef === key).length;

  const onPlace = (x: number, y: number) => {
    if (!placing) return;
    if (!canPlace(placing.defId, x, y, placing.rot)) {
      setMsg('That spot overlaps a building, road, blocked land or the grid edge.');
      return;
    }
    if (placing.fromInventory) {
      const item = project.inventory.find((i) => i.key === placing.fromInventory);
      if (!item || placedFromInv(item.key) >= effectiveQty(item)) {
        setMsg('No more of this building left in inventory.');
        return;
      }
    }
    const p: Placement = {
      uid: newUid(),
      defId: placing.defId,
      x,
      y,
      rot: placing.rot,
      locked: getDef(placing.defId)?.protected ?? false,
      origin: placing.fromInventory ? 'inventory' : 'manual',
      sourceRef: placing.fromInventory ?? undefined,
    };
    setCity((c) => ({ ...c, placements: [...c.placements, p] }));
    setMsg(`Placed ${displayName(getDef(p.defId))} at ${coordLabel(x, y)}.`);
  };

  const onMove = (uid: string, x: number, y: number) => {
    const p = city.placements.find((q) => q.uid === uid);
    if (!p) return;
    if (!canPlace(p.defId, x, y, p.rot, uid)) {
      setMsg('Cannot move there: it overlaps something or leaves the grid.');
      return;
    }
    setCity((c) => ({ ...c, placements: c.placements.map((q) => (q.uid === uid ? { ...q, x, y } : q)) }));
  };

  const sel = city.placements.find((p) => p.uid === selected) ?? null;
  const selDef = sel ? getDef(sel.defId) : undefined;
  const conn = useMemo(() => connectivity(city, getDef), [city, getDef]);

  const editSel = (patch: Partial<Placement>) =>
    setCity((c) => ({ ...c, placements: c.placements.map((q) => (q.uid === selected ? { ...q, ...patch } : q)) }));

  // ---- Screenshot underlays ----
  const addScreenshot = async (files: FileList | null) => {
    if (!files) return;
    const b = gridBounds('iso', city.width, city.height);
    const added: Underlay[] = [];
    for (const f of Array.from(files)) {
      const key = `shot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await blobSet(key, f);
      const img = new Image();
      const url = URL.createObjectURL(f);
      img.src = url;
      await img.decode().catch(() => {});
      URL.revokeObjectURL(url);
      const scale = img.naturalWidth ? (b.maxX - b.minX) / img.naturalWidth : 1;
      added.push({ id: key, name: f.name, blobKey: key, visible: added.length === 0, opacity: 0.6, x: b.minX, y: b.minY, scale, rotation: 0 });
    }
    update((p) => ({ ...p, underlays: [...p.underlays.map((u) => ({ ...u, visible: added.length ? false : u.visible })), ...added], viewMode: 'iso' }));
    setPanel('screens');
  };
  const editUnderlay = (id: string, patch: Partial<Underlay>) =>
    update((p) => ({ ...p, underlays: p.underlays.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));

  // ---- Colour-based detection (magic wand) on the visible screenshot ----
  const sampler = useRef<{ key: string; data: ImageData } | null>(null);
  const onWand = (x: number, y: number) => {
    const top = [...underlayImgs].reverse().find((u) => u.u.visible);
    if (!top || mode !== 'iso') {
      setMsg('Show a screenshot (isometric view) to use detection.');
      return;
    }
    const { img, u } = top;
    if (sampler.current?.key !== u.blobKey) {
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const cx = cv.getContext('2d', { willReadFrequently: true })!;
      cx.drawImage(img, 0, 0);
      sampler.current = { key: u.blobKey, data: cx.getImageData(0, 0, cv.width, cv.height) };
    }
    const { data } = sampler.current;
    const rad = (-u.rotation * Math.PI) / 180;
    const sample = (gx: number, gy: number): [number, number, number] | null => {
      const [wx, wy] = gridToWorld('iso', gx + 0.5, gy + 0.5);
      const dx = wx - u.x;
      const dy = wy - u.y;
      const ix = Math.floor((dx * Math.cos(rad) - dy * Math.sin(rad)) / u.scale);
      const iy = Math.floor((dx * Math.sin(rad) + dy * Math.cos(rad)) / u.scale);
      if (ix < 0 || iy < 0 || ix >= data.width || iy >= data.height) return null;
      // Average a small patch to reduce texture noise.
      let r = 0, g = 0, b = 0, n = 0;
      for (let oy = -2; oy <= 2; oy++)
        for (let ox = -2; ox <= 2; ox++) {
          const px = Math.min(data.width - 1, Math.max(0, ix + ox));
          const py = Math.min(data.height - 1, Math.max(0, iy + oy));
          const k = (py * data.width + px) * 4;
          r += data.data[k];
          g += data.data[k + 1];
          b += data.data[k + 2];
          n++;
        }
      return [r / n, g / n, b / n];
    };
    const seed = sample(x, y);
    if (!seed) {
      setMsg('That tile is outside the screenshot.');
      return;
    }
    const seen = new Uint8Array(city.width * city.height);
    const hits: number[] = [];
    const stack = [[x, y]];
    seen[y * city.width + x] = 1;
    while (stack.length && hits.length < 5000) {
      const [cx, cy] = stack.pop()!;
      const s = sample(cx, cy);
      if (!s || Math.hypot(s[0] - seed[0], s[1] - seed[1], s[2] - seed[2]) > wandTol) continue;
      hits.push(cy * city.width + cx);
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (!inBounds(city, nx, ny) || seen[ny * city.width + nx]) continue;
        seen[ny * city.width + nx] = 1;
        stack.push([nx, ny]);
      }
    }
    const occ = occupiedBy(city);
    setCity((c) => {
      const n = { ...c, terrain: c.terrain.slice(), roads: c.roads.slice() };
      for (const k of hits) {
        if (wandTarget === 'road') {
          if (occ.has(k)) continue;
          n.roads[k] = ROAD_1;
          n.terrain[k] = TERRAIN_BUILDABLE;
        } else if (wandTarget === 'buildable') n.terrain[k] = TERRAIN_BUILDABLE;
        else if (!occ.has(k)) {
          n.terrain[k] = TERRAIN_BLOCKED;
          n.roads[k] = ROAD_NONE;
        }
      }
      return n;
    });
    setMsg(`Detected ${hits.length} tiles → ${wandTarget}. Undo if it spilled; lower the tolerance and retry.`);
  };

  const saveBaseline = () => {
    const id = `layout-${Date.now()}`;
    update((p) => ({
      ...p,
      baselineId: id,
      layouts: [
        ...p.layouts.map((l) => (l.kind === 'baseline' ? { ...l, kind: 'manual' as const } : l)),
        { id, name: `Baseline ${new Date().toLocaleDateString()}`, createdAt: new Date().toISOString(), city: cloneCity(p.city), kind: 'baseline' },
      ],
    }));
    setMsg('Saved the current city as the baseline. Scores now read 100 = this city.');
  };

  const toolHint = TOOLS.find((t) => t.id === tool)?.hint;
  const showUnderlays = mode === 'iso' ? underlayImgs : [];

  return (
    <div>
      <div className="row between">
        <h1 style={{ margin: 0 }}>My City</h1>
        <div className="row">
          <button className="sm" onClick={undo} disabled={!history.current.length}>↶ Undo</button>
          <button className="sm" onClick={redo} disabled={!future.current.length}>↷</button>
          <button className="sm" onClick={() => update((p) => ({ ...p, viewMode: p.viewMode === 'iso' ? 'top' : 'iso' }))}>
            {mode === 'iso' ? 'Top-down' : 'Isometric'}
          </button>
        </div>
      </div>

      <div className="toolbar" role="toolbar">
        {TOOLS.map((t) => (
          <button key={t.id} className={`sm ${tool === t.id ? 'on' : ''}`} onClick={() => {
            setTool(t.id);
            if (t.id === 'place' && !placing) setPalette(true);
          }}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="small muted" style={{ margin: '0 0 6px' }}>
        {toolHint}
        {tool === 'place' && placing && (
          <>
            {' '}Placing <b>{displayName(getDef(placing.defId))}</b>{' '}
            <button className="sm" onClick={() => setPalette(true)}>Change</button>{' '}
            {getDef(placing.defId)?.rotatable && <button className="sm" onClick={() => setPlacing({ ...placing, rot: placing.rot ? 0 : 1 })}>Rotate</button>}
          </>
        )}
      </p>
      {tool === 'wand' && (
        <div className="row small">
          Mark as
          <select value={wandTarget} onChange={(e) => setWandTarget(e.target.value as typeof wandTarget)}>
            <option value="road">Road</option>
            <option value="buildable">Buildable land</option>
            <option value="blocked">Blocked</option>
          </select>
          Tolerance
          <input type="range" min={5} max={90} value={wandTol} onChange={(e) => setWandTol(Number(e.target.value))} style={{ width: 120 }} />
          {wandTol}
        </div>
      )}

      <CityCanvas
        ref={canvasRef}
        city={city}
        getDef={getDef}
        mode={mode}
        tool={tool}
        selected={selected}
        bad={validation.badUids}
        disconnectedRoads={disc}
        underlays={showUnderlays}
        ghostDef={tool === 'place' && placing ? { defId: placing.defId, rot: placing.rot } : null}
        canPlace={(d, x, y, r) => canPlace(d, x, y, r)}
        onSelect={setSelected}
        onPaint={onPaint}
        onMove={onMove}
        onPlace={onPlace}
        onTapCell={onWand}
        height="62dvh"
      />
      {msg && <p className="small">{msg}</p>}

      <div className="legend" style={{ marginTop: 6 }}>
        {Object.entries(CAT_LABELS).map(([k, l]) => (
          <span key={k}><i style={{ background: CAT_COLORS[k as keyof typeof CAT_COLORS] }} />{l}</span>
        ))}
        <span><i style={{ background: '#e5534b' }} />Disconnected road</span>
        <span><i style={{ border: '2px dashed #ff4d4f' }} />Invalid / not connected</span>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={() => setPanel(panel === 'issues' ? 'none' : 'issues')}>
          {validation.issues.length ? `⚠ ${validation.issues.length} issues` : '✓ No issues'}
        </button>
        <button onClick={() => setPanel(panel === 'grid' ? 'none' : 'grid')}>Grid {city.width}×{city.height}</button>
        <button onClick={() => setPanel(panel === 'screens' ? 'none' : 'screens')}>Screenshots ({project.underlays.length})</button>
        <button className="primary" onClick={saveBaseline}>{baseline ? 'Update baseline' : 'Save as baseline'}</button>
      </div>
      <p className="small muted">
        {city.placements.length} buildings · {cells.buildable} buildable · {cells.unknown} unknown · {cells.blocked} blocked · {cells.roads} road · {cells.road2} two-lane road tiles
      </p>

      {panel === 'issues' && (
        <div className="card">
          {validation.issues.length === 0 ? <p>No overlaps, disconnected buildings or invalid tiles.</p> : (
            <ul className="small">
              {validation.issues.slice(0, 200).map((i, k) => (
                <li key={k}>
                  {i.uid ? <a href="#" onClick={(e) => { e.preventDefault(); setSelected(i.uid!); }}>{i.message}</a> : i.message}
                </li>
              ))}
            </ul>
          )}
          {validation.disconnectedRoads.length > 0 && <p className="small bad">{validation.disconnectedRoads.length} road tiles are not connected to the Town Hall (red).</p>}
        </div>
      )}

      {panel === 'grid' && <GridPanel city={city} setCity={setCity} />}

      {panel === 'screens' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Screenshots</h3>
          <p className="small muted">
            Import your reconstruction-mode screenshot first: it shows footprints and roads most clearly. Align it so the game's tile diamonds sit on the grid, then trace land, roads (or use ✦ Detect) and buildings. Screenshots are only shown in isometric view and stay on this device (and in backups).
          </p>
          <input type="file" accept="image/*" multiple onChange={(e) => addScreenshot(e.target.files)} />
          {project.underlays.map((u) => (
            <div key={u.id} className="card">
              <div className="row between">
                <label className="check">
                  <input type="checkbox" checked={u.visible} onChange={(e) => editUnderlay(u.id, { visible: e.target.checked })} />
                  {u.name}
                </label>
                <button className="sm danger" onClick={async () => {
                  await blobDelete(u.blobKey);
                  update((p) => ({ ...p, underlays: p.underlays.filter((x) => x.id !== u.id) }));
                }}>Remove</button>
              </div>
              <UnderlaySliders u={u} city={city} onChange={(patch) => editUnderlay(u.id, patch)} />
            </div>
          ))}
        </div>
      )}

      {palette && (
        <Palette
          onClose={() => setPalette(false)}
          onPick={(defId, fromInventory) => {
            setPlacing({ defId, rot: 0, fromInventory });
            setTool('place');
            setPalette(false);
          }}
          placedFromInv={placedFromInv}
        />
      )}

      {sel && (
        <Sheet onClose={() => setSelected(null)}>
          <h3 style={{ marginTop: 0 }}>{displayName(selDef)}</h3>
          <p className="small">
            At {coordLabel(sel.x, sel.y)} · {selDef?.width ?? '?'}×{selDef?.height ?? '?'} tiles{sel.rot ? ' (rotated)' : ''} · road: {selDef?.road ?? '?'} ·{' '}
            {isConnected(city, sel, selDef, conn) ? <span className="good">connected</span> : <span className="bad">not connected</span>} · origin: {sel.origin}
          </p>
          <p className="small">
            Size <StatusBadge s={selDef?.dimsStatus ?? 'unknown'} /> Stats <StatusBadge s={selDef?.statsStatus ?? 'unknown'} />
          </p>
          {!hasDims(selDef) && <p className="notice small">Size unknown — it is drawn as 1×1. Enter its size in the Building Database.</p>}
          <div className="row">
            <button className="sm" disabled={sel.locked} onClick={() => onMove(sel.uid, sel.x, sel.y - 1)}>↑</button>
            <button className="sm" disabled={sel.locked} onClick={() => onMove(sel.uid, sel.x, sel.y + 1)}>↓</button>
            <button className="sm" disabled={sel.locked} onClick={() => onMove(sel.uid, sel.x - 1, sel.y)}>←</button>
            <button className="sm" disabled={sel.locked} onClick={() => onMove(sel.uid, sel.x + 1, sel.y)}>→</button>
            {selDef?.rotatable && (
              <button className="sm" disabled={sel.locked} onClick={() => {
                const rot = sel.rot ? 0 : 1;
                if (canPlace(sel.defId, sel.x, sel.y, rot as 0 | 1, sel.uid)) editSel({ rot: rot as 0 | 1 });
                else setMsg('No room to rotate here.');
              }}>⟳ Rotate</button>
            )}
            <button className="sm" onClick={() => editSel({ locked: !sel.locked })}>{sel.locked ? '🔓 Unlock' : '🔒 Lock'}</button>
            <button className="sm" onClick={() => go('buildings', sel.defId)}>Edit stats/size</button>
            <button className="sm danger" onClick={() => {
              setCity((c) => ({ ...c, placements: c.placements.filter((q) => q.uid !== sel.uid) }));
              setSelected(null);
            }}>{sel.origin === 'inventory' ? 'Return to inventory' : 'Remove'}</button>
          </div>
          <p className="small muted">Locked buildings are never moved by the optimizer. Great Buildings and the Town Hall are protected by default.</p>
        </Sheet>
      )}
    </div>
  );
}

function GridPanel({ city, setCity }: { city: CityState; setCity: (fn: (c: CityState) => CityState) => void }) {
  const [w, setW] = useState(city.width);
  const [h, setH] = useState(city.height);
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Grid</h3>
      <p className="small muted">The real buildable boundary is not verified yet. Make the grid large enough to hold the whole city, then paint land. Shifting moves everything (land, roads, buildings).</p>
      <div className="fields">
        <label className="field">Width<input type="number" min={8} max={200} value={w} onChange={(e) => setW(Number(e.target.value))} /></label>
        <label className="field">Height<input type="number" min={8} max={200} value={h} onChange={(e) => setH(Number(e.target.value))} /></label>
        <label className="field">Shift right<input type="number" value={dx} onChange={(e) => setDx(Number(e.target.value))} /></label>
        <label className="field">Shift down<input type="number" value={dy} onChange={(e) => setDy(Number(e.target.value))} /></label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={() => setCity((c) => resizeCity(c, Math.max(8, Math.min(200, w)), Math.max(8, Math.min(200, h)), dx, dy))}>Apply</button>
        <button onClick={() => setCity((c) => ({ ...c, terrain: c.terrain.map((t) => (t === TERRAIN_UNKNOWN ? TERRAIN_BUILDABLE : t)) }))}>Mark all unknown as buildable</button>
        <button onClick={() => setCity((c) => ({ ...c, terrain: c.terrain.map((t) => (t === TERRAIN_UNKNOWN ? TERRAIN_BLOCKED : t)) }))}>Mark all unknown as blocked</button>
      </div>
    </div>
  );
}

function UnderlaySliders({ u, city, onChange }: { u: Underlay; city: CityState; onChange: (p: Partial<Underlay>) => void }) {
  const b = gridBounds('iso', city.width, city.height);
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const row = (label: string, value: number, min: number, max: number, step: number, key: keyof Underlay, f = (v: number) => v, inv = (v: number) => v) => (
    <label className="field">
      {label}: {fmt(value, 3)}
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <button className="sm" onClick={() => onChange({ [key]: f(inv(value) - step) })}>−</button>
        <input type="range" min={min} max={max} step={step} value={inv(value)} onChange={(e) => onChange({ [key]: f(Number(e.target.value)) })} />
        <button className="sm" onClick={() => onChange({ [key]: f(inv(value) + step) })}>＋</button>
      </div>
    </label>
  );
  return (
    <div className="stack">
      {row('Opacity', u.opacity, 0.05, 1, 0.05, 'opacity')}
      {row('Scale', u.scale, -4, 2, 0.005, 'scale', (v) => Math.exp(v), (v) => Math.log(v))}
      {row('Left/right', u.x, b.minX - span, b.maxX, 1, 'x')}
      {row('Up/down', u.y, b.minY - span, b.maxY, 1, 'y')}
      {row('Rotation°', u.rotation, -15, 15, 0.1, 'rotation')}
    </div>
  );
}

function Palette({ onClose, onPick, placedFromInv }: { onClose: () => void; onPick: (defId: string, fromInventory: string | null) => void; placedFromInv: (key: string) => number }) {
  const { project, update } = useStore();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'city' | 'inventory'>('city');
  const [dims, setDims] = useState<Record<string, { w: string; h: string }>>({});
  const ql = q.toLowerCase();
  const defs = project.buildings.filter((d) => !ql || d.name.toLowerCase().includes(ql)).sort((a, b) => {
    const rank = (k: string) => (k === 'townhall' ? 0 : k === 'greatbuilding' ? 1 : 2);
    return rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name);
  });
  const invItems = project.inventory.filter((i) => i.category === 'building' && i.defId && (!ql || i.rawName.toLowerCase().includes(ql)));

  const setDefDims = (id: string) => {
    const d = dims[id];
    const w = Number(d?.w);
    const h = Number(d?.h);
    if (!(w > 0 && h > 0)) return;
    update((p) => ({ ...p, buildings: p.buildings.map((b) => (b.id === id ? { ...b, width: w, height: h, dimsStatus: 'user' } : b)) }));
  };
  const addCustom = () => {
    const name = q.trim();
    if (!name) return;
    const id = slug(name);
    update((p) => (p.buildings.some((b) => b.id === id) ? p : { ...p, buildings: [...p.buildings, newDef({ id, name })] }));
  };

  const dimsInput = (id: string) => (
    <span className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
      <input style={{ width: 52 }} inputMode="numeric" placeholder="w" value={dims[id]?.w ?? ''} onChange={(e) => setDims({ ...dims, [id]: { ...dims[id], w: e.target.value } })} />
      ×
      <input style={{ width: 52 }} inputMode="numeric" placeholder="h" value={dims[id]?.h ?? ''} onChange={(e) => setDims({ ...dims, [id]: { ...dims[id], h: e.target.value } })} />
      <button className="sm" onClick={() => setDefDims(id)}>Set</button>
    </span>
  );

  return (
    <Sheet onClose={onClose}>
      <div className="row">
        <button className={`sm ${tab === 'city' ? 'on' : ''}`} onClick={() => setTab('city')}>Already in my city</button>
        <button className={`sm ${tab === 'inventory' ? 'on' : ''}`} onClick={() => setTab('inventory')}>From inventory</button>
      </div>
      <input placeholder="Search buildings" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginTop: 8 }} />
      {tab === 'city' ? (
        <div className="list">
          {defs.slice(0, 150).map((d) => (
            <div className="item" key={d.id}>
              <div className="name">
                {displayName(d)}
                <div className="small muted">{d.kind} · {hasDims(d) ? `${d.width}×${d.height}` : 'size unknown'}</div>
              </div>
              {!hasDims(d) && dimsInput(d.id)}
              <button className="sm primary" onClick={() => onPick(d.id, null)}>Place</button>
            </div>
          ))}
          {q && !defs.some((d) => d.name.toLowerCase() === ql) && (
            <div className="item"><div className="name">Not listed?</div><button className="sm" onClick={addCustom}>Add “{q}”</button></div>
          )}
        </div>
      ) : (
        <div className="list">
          {invItems.map((i) => {
            const left = effectiveQty(i) - placedFromInv(i.key);
            const d = project.buildings.find((b) => b.id === i.defId);
            return (
              <div className="item" key={i.key}>
                <div className="name">
                  {i.rawName}
                  <div className="small muted">{left} of {effectiveQty(i)} left · {hasDims(d) ? `${d!.width}×${d!.height}` : 'size unknown'}</div>
                </div>
                {!hasDims(d) && dimsInput(i.defId!)}
                <button className="sm primary" disabled={left <= 0} onClick={() => onPick(i.defId!, i.key)}>Place</button>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
