/**
 * City layout optimizer.
 *
 * Approach (heuristic, not exact): for several road strategies (keep existing roads, or generate a
 * fresh "comb" of road rows/columns at different spacings), pack buildings greedily by value
 * density into the best-contact position, prune roads nobody needs, refill freed tiles, then run a
 * seeded local search (remove/re-insert moves, accepted only when the weighted score does not
 * drop). Every candidate is checked by the same validator the editor uses.
 *
 * A fractional-knapsack upper bound (ignores road space and set/chain bonuses) is reported so the
 * gap to the best possible score is visible. Optimality is never claimed.
 */
import { emptyStats, hasDims, statsOf } from './buildingDb';
import { effectiveQty } from './inventory';
import type { DefLookup } from './grid';
import { cloneCity, connectedRoads, connectivity, footprint, inBounds, isConnected, perimeter, townHall, validateCity } from './grid';
import type { CategoryValues, Evaluation } from './scoring';
import { buildingValue, categoryValues, evaluateCity, weightedScore } from './scoring';
import type {
  BuildingDef, CityState, InventoryItem, Placement, PlacementOrigin, Recipe, SetDef, Settings, Stats,
} from './types';
import { ROAD_1, ROAD_2, ROAD_NONE, TERRAIN_BUILDABLE, TERRAIN_UNKNOWN } from './types';

export interface OptimizeOptions {
  /** 'rearrange': move any unlocked building. 'fill': keep every current building, only add. */
  mode: 'rearrange' | 'fill';
  useInventory: boolean;
  useRecipes: boolean;
  /** Also build on tiles whose terrain is still "unknown". Off by default. */
  allowUnknownTerrain: boolean;
  /** Try generated road layouts in addition to the existing road network. */
  generateRoads: boolean;
  iterations: number;
  seed: number;
  candidates: number;
}

export const DEFAULT_OPTIONS: OptimizeOptions = {
  mode: 'rearrange',
  useInventory: true,
  useRecipes: true,
  allowUnknownTerrain: false,
  generateRoads: true,
  iterations: 400,
  seed: 1,
  candidates: 3,
};

export interface OptimizeInput {
  city: CityState;
  defs: BuildingDef[];
  sets: SetDef[];
  settings: Settings;
  inventory: InventoryItem[];
  recipes: Recipe[];
  /** Category reference values (normally the baseline city's) so scores are comparable. */
  ref: CategoryValues;
  options: OptimizeOptions;
}

interface Unit {
  defId: string;
  origin: PlacementOrigin;
  sourceRef?: string;
  uid?: string;
  /** Stored building (inventory key) a recipe consumed to produce this unit. */
  consumedRef?: string;
  value: number;
  area: number;
}

export interface Candidate {
  id: string;
  name: string;
  city: CityState;
  score: number;
  values: CategoryValues;
  stats: Stats;
  placed: number;
  unplaced: { defId: string; count: number; reason: string }[];
  roadCells: number;
  freeCells: number;
  kitsUsed: { key: string; qty: number }[];
  recipesUsed: { recipeId: string; times: number }[];
  valid: boolean;
  issues: string[];
  trade: string[];
}

export interface OptimizeResult {
  candidates: Candidate[];
  baseline: { score: number; values: CategoryValues };
  upperBound: number;
  boundNote: string;
  excluded: { defId: string; count: number; reason: string }[];
  fixedCount: number;
  elapsedMs: number;
  notes: string[];
}

export type ProgressFn = (fraction: number, message: string) => void;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let uidCounter = 0;
function newUid(): string {
  uidCounter++;
  return `opt-${Date.now().toString(36)}-${uidCounter.toString(36)}`;
}

/** Working grid with fast rectangle-fit queries via a 2D prefix sum of blocked cells. */
class Grid {
  c: CityState;
  allowed: Uint8Array;
  occ: Int32Array;
  prefix: Int32Array;
  getDef: DefLookup;
  dirty = true;

  constructor(c: CityState, getDef: DefLookup, allowUnknown: boolean) {
    this.c = c;
    this.getDef = getDef;
    const n = c.width * c.height;
    this.allowed = new Uint8Array(n);
    for (let i = 0; i < n; i++)
      this.allowed[i] = c.terrain[i] === TERRAIN_BUILDABLE || (allowUnknown && c.terrain[i] === TERRAIN_UNKNOWN) ? 1 : 0;
    this.occ = new Int32Array(n).fill(-1);
    this.prefix = new Int32Array((c.width + 1) * (c.height + 1));
    this.rebuildOcc();
  }

  rebuildOcc() {
    this.occ.fill(-1);
    this.c.placements.forEach((p, idx) => this.mark(p, idx));
    this.dirty = true;
  }

  mark(p: Placement, idx: number) {
    const f = footprint(p, this.getDef(p.defId));
    if (!f) return;
    for (let y = p.y; y < p.y + f.h; y++)
      for (let x = p.x; x < p.x + f.w; x++) if (inBounds(this.c, x, y)) this.occ[y * this.c.width + x] = idx;
    this.dirty = true;
  }

  blocked(i: number): boolean {
    return !this.allowed[i] || this.c.roads[i] !== ROAD_NONE || this.occ[i] !== -1;
  }

  free(i: number): boolean {
    return !this.blocked(i);
  }

  ensurePrefix() {
    if (!this.dirty) return;
    const { width: W, height: H } = this.c;
    const P = this.prefix;
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        row += this.blocked(y * W + x) ? 1 : 0;
        P[(y + 1) * (W + 1) + x + 1] = P[y * (W + 1) + x + 1] + row;
      }
    }
    this.dirty = false;
  }

  fits(x: number, y: number, w: number, h: number): boolean {
    const { width: W, height: H } = this.c;
    if (x < 0 || y < 0 || x + w > W || y + h > H) return false;
    const P = this.prefix;
    const s = P[(y + h) * (W + 1) + x + w] - P[y * (W + 1) + x + w] - P[(y + h) * (W + 1) + x] + P[y * (W + 1) + x];
    return s === 0;
  }
}

function roadLevel(def: BuildingDef): 0 | 1 | 2 {
  if (def.road === 'none' || def.kind === 'townhall') return 0;
  return def.road === 'road2' ? 2 : 1;
}

/** Greedily places units; returns the units that could not be placed. */
function greedyPlace(g: Grid, units: Unit[], setIdOf: (defId: string) => string | undefined): Unit[] {
  const c = g.c;
  const W = c.width;
  // Roads do not change while placing, so connectivity is computed once.
  const conn = connectivity(c, g.getDef);
  const road1 = conn.road1;
  const road2 = conn.road2;
  const H = c.height;
  const left: Unit[] = [];
  // The grid only fills up during a pass, so a building type that failed once will fail again.
  const failed = new Set<string>();
  for (const u of units) {
    if (failed.has(u.defId)) {
      left.push(u);
      continue;
    }
    const def = g.getDef(u.defId)!;
    const lvl = roadLevel(def);
    const orients: [number, number, 0 | 1][] = [[def.width!, def.height!, 0]];
    if (def.rotatable && def.width !== def.height) orients.push([def.height!, def.width!, 1]);
    g.ensurePrefix();
    const sid = setIdOf(u.defId);
    let best: { x: number; y: number; rot: 0 | 1; s: number } | null = null;
    for (const [w, h, rot] of orients) {
      for (let y = 0; y + h <= c.height; y++)
        for (let x = 0; x + w <= W; x++) {
          if (!g.fits(x, y, w, h)) continue;
          let roadOk = lvl === 0;
          let contact = 0;
          let setTouch = 0;
          // Walk the perimeter inline (this is the hot loop; avoid allocating).
          const per = 2 * (w + h);
          for (let k = 0; k < per; k++) {
            let px: number;
            let py: number;
            if (k < w) [px, py] = [x + k, y - 1];
            else if (k < 2 * w) [px, py] = [x + k - w, y + h];
            else if (k < 2 * w + h) [px, py] = [x - 1, y + k - 2 * w];
            else [px, py] = [x + w, y + k - 2 * w - h];
            if (px < 0 || py < 0 || px >= W || py >= H) {
              contact++;
              continue;
            }
            const i = py * W + px;
            if (!roadOk && (lvl === 2 ? road2[i] : road1[i])) roadOk = true;
            if (g.blocked(i)) contact++;
            if (sid && g.occ[i] !== -1 && setIdOf(c.placements[g.occ[i]].defId) === sid) setTouch++;
          }
          if (!roadOk) continue;
          // Prefer tight packing; strongly prefer touching same-set buildings.
          const s = contact / (2 * (w + h)) + setTouch * 2;
          if (!best || s > best.s + 1e-9) best = { x, y, rot, s };
        }
    }
    if (!best) {
      failed.add(u.defId);
      left.push(u);
      continue;
    }
    const p: Placement = {
      uid: u.uid ?? newUid(),
      defId: u.defId,
      x: best.x,
      y: best.y,
      rot: best.rot,
      locked: false,
      origin: u.origin,
      sourceRef: u.sourceRef,
      consumedRef: u.consumedRef,
    };
    c.placements.push(p);
    g.mark(p, c.placements.length - 1);
  }
  return left;
}

/** Removes road cells that no building needs. Never disconnects a building that was connected. */
export function pruneRoads(c: CityState, getDef: DefLookup): number {
  const conn0 = connectivity(c, getDef);
  const W = c.width;
  // Precompute, for each connected road-needing building, its perimeter cells and road level.
  const needs: { cells: number[]; lvl: 1 | 2 }[] = [];
  for (const p of c.placements) {
    const def = getDef(p.defId);
    const f = footprint(p, def);
    if (!def || !f || roadLevel(def) === 0 || !isConnected(c, p, def, conn0)) continue;
    const cells: number[] = [];
    for (const [x, y] of perimeter(p.x, p.y, f.w, f.h)) if (inBounds(c, x, y)) cells.push(y * W + x);
    needs.push({ cells, lvl: roadLevel(def) as 1 | 2 });
  }
  const anyRoad2 = needs.some((n) => n.lvl === 2);
  const satisfied = () => {
    const r1 = connectedRoads(c, getDef, 1);
    const r2 = anyRoad2 ? connectedRoads(c, getDef, 2) : r1;
    return needs.every((n) => n.cells.some((i) => (n.lvl === 2 ? r2[i] : r1[i])));
  };
  let removed = 0;
  // Roads not connected to the Town Hall serve nothing.
  for (let i = 0; i < c.roads.length; i++)
    if (c.roads[i] !== ROAD_NONE && !conn0.road1[i]) {
      c.roads[i] = ROAD_NONE;
      removed++;
    }
  // A road tile touching neither a building nor the Town Hall, with at most one road neighbour, is
  // a dead end: removing it can never disconnect anything, so no connectivity check is needed.
  const touching = new Uint8Array(c.roads.length);
  for (const n of needs) for (const i of n.cells) touching[i] = 1;
  const th = townHall(c, getDef);
  const thf = th && footprint(th, getDef(th.defId));
  if (th && thf) for (const [x, y] of perimeter(th.x, th.y, thf.w, thf.h)) if (inBounds(c, x, y)) touching[y * W + x] = 1;
  const deg = (i: number) => {
    const x = i % W;
    const y = (i - x) / W;
    let d = 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]])
      if (inBounds(c, nx, ny) && c.roads[ny * W + nx] !== ROAD_NONE) d++;
    return d;
  };
  const tryRemove = (i: number): boolean => {
    const prev = c.roads[i];
    c.roads[i] = ROAD_NONE;
    if (satisfied()) return true;
    c.roads[i] = prev;
    return false;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < c.roads.length; i++) {
      if (c.roads[i] === ROAD_NONE || deg(i) > 1) continue;
      if (!touching[i]) {
        c.roads[i] = ROAD_NONE;
        removed++;
        changed = true;
      } else if (tryRemove(i)) {
        removed++;
        changed = true;
      }
    }
  }
  // One full pass for loops and redundant parallel roads.
  for (let i = 0; i < c.roads.length; i++) if (c.roads[i] !== ROAD_NONE && tryRemove(i)) removed++;
  return removed;
}

/**
 * Lays the shortest road (BFS over free tiles) from the Town Hall network to a placement.
 * Returns false if no path exists.
 */
function connectWithRoad(g: Grid, p: Placement): boolean {
  const c = g.c;
  const def = g.getDef(p.defId);
  const f = footprint(p, def);
  if (!def || !f) return false;
  const lvl = roadLevel(def);
  if (lvl === 0) return true;
  const th = townHall(c, g.getDef);
  const thf = th && footprint(th, g.getDef(th.defId));
  if (!th || !thf) return false;
  const W = c.width;
  const conn = connectivity(c, g.getDef);
  const net = lvl === 2 ? conn.road2 : conn.road1;
  const target = new Set<number>();
  for (const [x, y] of perimeter(p.x, p.y, f.w, f.h)) if (inBounds(c, x, y)) target.add(y * W + x);
  for (const t of target) if (net[t]) return true;
  const prev = new Int32Array(W * c.height).fill(-2);
  const queue: number[] = [];
  const passable = (i: number) => g.free(i) || (lvl === 2 && c.roads[i] === ROAD_1);
  for (let i = 0; i < net.length; i++)
    if (net[i]) {
      prev[i] = -1;
      queue.push(i);
    }
  for (const [x, y] of perimeter(th.x, th.y, thf.w, thf.h)) {
    if (!inBounds(c, x, y)) continue;
    const i = y * W + x;
    if (prev[i] === -2 && passable(i)) {
      prev[i] = -1;
      queue.push(i);
    }
  }
  let head = 0;
  let hit = -1;
  while (head < queue.length) {
    const i = queue[head++];
    if (target.has(i) && (net[i] || passable(i))) {
      hit = i;
      break;
    }
    const x = i % W;
    const y = (i - x) / W;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!inBounds(c, nx, ny)) continue;
      const j = ny * W + nx;
      if (prev[j] !== -2 || !passable(j)) continue;
      prev[j] = i;
      queue.push(j);
    }
  }
  if (hit < 0) return false;
  for (let i = hit; i !== -1; i = prev[i]) {
    if (c.roads[i] === ROAD_NONE || (lvl === 2 && c.roads[i] === ROAD_1)) c.roads[i] = lvl === 2 ? ROAD_2 : ROAD_1;
    if (prev[i] === -1) break;
  }
  g.dirty = true;
  return true;
}

/** Adds a comb of road lines (rows or columns `period` apart plus a trunk beside the Town Hall). */
function addComb(g: Grid, orient: 'h' | 'v', period: number, lanes: 1 | 2) {
  const c = g.c;
  const th = townHall(c, g.getDef);
  const f = th && footprint(th, g.getDef(th.defId));
  if (!th || !f) return;
  const W = c.width;
  const kind = lanes === 2 ? ROAD_2 : ROAD_1;
  const set = (x: number, y: number) => {
    if (!inBounds(c, x, y)) return;
    const i = y * W + x;
    if (g.free(i) || (kind === ROAD_2 && c.roads[i] === ROAD_1)) c.roads[i] = kind;
  };
  if (orient === 'h') {
    const trunkX = th.x - lanes;
    for (let y = 0; y < c.height; y++) for (let l = 0; l < lanes; l++) set(trunkX + l, y);
    const anchor = th.y - lanes;
    for (let y = 0; y < c.height; y++) {
      if ((((y - anchor) % period) + period) % period !== 0) continue;
      for (let x = 0; x < W; x++) for (let l = 0; l < lanes; l++) set(x, y + l);
    }
  } else {
    const trunkY = th.y - lanes;
    for (let x = 0; x < W; x++) for (let l = 0; l < lanes; l++) set(x, trunkY + l);
    const anchor = th.x - lanes;
    for (let x = 0; x < W; x++) {
      if ((((x - anchor) % period) + period) % period !== 0) continue;
      for (let y = 0; y < c.height; y++) for (let l = 0; l < lanes; l++) set(x + l, y);
    }
  }
  g.dirty = true;
}

interface Pool {
  units: Unit[];
  fixed: Placement[];
  excluded: { defId: string; count: number; reason: string }[];
  kitsUsed: Map<string, number>;
  recipesUsed: Map<string, number>;
}

function buildPool(input: OptimizeInput, getDef: DefLookup): Pool {
  const { city, settings, ref, options } = input;
  const fixed: Placement[] = [];
  const units: Unit[] = [];
  const excludedMap = new Map<string, { defId: string; count: number; reason: string }>();
  const exclude = (defId: string, reason: string) => {
    const k = defId + '|' + reason;
    const e = excludedMap.get(k) ?? { defId, count: 0, reason };
    e.count++;
    excludedMap.set(k, e);
  };
  const mkUnit = (defId: string, origin: PlacementOrigin, sourceRef?: string, uid?: string): Unit | null => {
    const def = getDef(defId);
    if (!def) return null;
    return { defId, origin, sourceRef, uid, value: buildingValue(def, settings, ref), area: def.width! * def.height! };
  };

  for (const p of city.placements) {
    const def = getDef(p.defId);
    const movable =
      options.mode === 'rearrange' && !p.locked && !def?.protected && hasDims(def) && def.statsStatus !== 'unknown' && def.road !== 'unknown';
    if (movable) {
      const u = mkUnit(p.defId, p.origin === 'baseline' ? 'baseline' : p.origin, p.sourceRef, p.uid);
      if (u) units.push(u);
    } else fixed.push({ ...p });
  }

  const kitsUsed = new Map<string, number>();
  const recipesUsed = new Map<string, number>();
  const invUnits: Unit[] = [];
  if (options.useInventory) {
    for (const item of input.inventory) {
      if (item.category !== 'building' || !item.defId) continue;
      const def = getDef(item.defId);
      const q = effectiveQty(item);
      for (let k = 0; k < q; k++) {
        if (!hasDims(def)) exclude(item.defId, 'size unknown');
        else if (def!.statsStatus === 'unknown') exclude(item.defId, 'statistics unknown');
        else if (def!.road === 'unknown') exclude(item.defId, 'road requirement unknown');
        else invUnits.push(mkUnit(item.defId, 'inventory', item.key)!);
      }
    }
  }

  if (options.useRecipes) {
    const avail = new Map(input.inventory.map((i) => [i.key, effectiveQty(i)]));
    const recipes = input.recipes
      .filter((r) => r.enabled)
      .map((r) => ({ r, def: getDef(r.outputDefId) }))
      .filter(({ r, def }) => {
        const ok = hasDims(def) && def!.statsStatus !== 'unknown' && def!.road !== 'unknown';
        if (!ok) exclude(r.outputDefId, 'recipe output size/stats/road unknown');
        return ok;
      })
      .sort((a, b) => buildingValue(b.def!, settings, ref) - buildingValue(a.def!, settings, ref));
    for (const { r } of recipes) {
      let times = 0;
      for (;;) {
        if (r.inputs.some((inp) => (avail.get(inp.key) ?? 0) < inp.qty)) break;
        let consumed: Unit | undefined;
        if (r.consumesDefId) {
          // Consume the lowest-value matching building from the pool (stored before placed).
          const cands = [...invUnits, ...units].filter((u) => u.defId === r.consumesDefId);
          if (!cands.length) break;
          consumed = cands.sort((a, b) => (a.origin === 'inventory' ? -1 : 1) - (b.origin === 'inventory' ? -1 : 1))[0];
        }
        // Only convert when the output is worth more than what it consumes.
        const out = mkUnit(r.outputDefId, 'recipe', r.id, consumed?.origin === 'inventory' ? undefined : consumed?.uid);
        if (!out || (consumed && out.value <= consumed.value)) break;
        if (consumed?.origin === 'inventory') out.consumedRef = consumed.sourceRef;
        for (const inp of r.inputs) {
          avail.set(inp.key, (avail.get(inp.key) ?? 0) - inp.qty);
          kitsUsed.set(inp.key, (kitsUsed.get(inp.key) ?? 0) + inp.qty);
        }
        if (consumed) {
          const arr = consumed.origin === 'inventory' ? invUnits : units;
          arr.splice(arr.indexOf(consumed), 1);
        }
        units.push(out);
        times++;
      }
      if (times) recipesUsed.set(r.id, times);
    }
    // Buildings taken from storage by recipes are already counted; the rest stay available.
  }
  units.push(...invUnits);
  return { units, fixed, excluded: [...excludedMap.values()], kitsUsed, recipesUsed };
}

function sortUnits(units: Unit[]): Unit[] {
  return units
    .filter((u) => u.value > 0)
    .sort((a, b) => b.value / b.area - a.value / a.area || b.area - a.area || (a.origin === 'baseline' ? -1 : 1));
}

interface StrategyResult {
  name: string;
  city: CityState;
  leftovers: Unit[];
  ev: Evaluation;
}

export function optimize(input: OptimizeInput, progress: ProgressFn = () => {}): OptimizeResult {
  const t0 = Date.now();
  const defMap = new Map(input.defs.map((d) => [d.id, d]));
  const getDef: DefLookup = (id) => defMap.get(id);
  const setIdOf = (id: string) => defMap.get(id)?.setId;
  const { settings, ref, options, sets } = input;
  const rng = mulberry32(options.seed || 1);
  const notes: string[] = [];

  const baseEval = evaluateCity(input.city, getDef, settings, ref, sets);
  const pool = buildPool(input, getDef);
  const ordered = sortUnits(pool.units);
  const zeroValue = pool.units.filter((u) => u.value <= 0);

  const hasTh = !!townHall(input.city, getDef);
  if (!hasTh) notes.push('No Town Hall is placed, so road connectivity could not be enforced. Place the Town Hall in My City.');

  const needsRoad2 = ordered.some((u) => getDef(u.defId)?.road === 'road2');
  const strategies: { name: string; roads: 'existing' | 'comb'; orient?: 'h' | 'v'; period?: number; lanes?: 1 | 2 }[] = [
    { name: 'Existing roads', roads: 'existing' },
  ];
  if (options.generateRoads && hasTh)
    for (const period of [5, 7, 9])
      for (const orient of ['h', 'v'] as const)
        strategies.push({
          name: `${orient === 'h' ? 'Horizontal' : 'Vertical'} road rows every ${period} tiles${needsRoad2 ? ' (two-lane)' : ''}`,
          roads: 'comb',
          orient,
          period: needsRoad2 ? period + 1 : period,
          lanes: needsRoad2 ? 2 : 1,
        });

  const runStrategy = (s: (typeof strategies)[number]): StrategyResult => {
    const c = cloneCity(input.city);
    c.placements = pool.fixed.map((p) => ({ ...p }));
    const g = new Grid(c, getDef, options.allowUnknownTerrain);
    if (s.roads === 'comb') {
      // Keep only roads that fixed buildings need, then lay the comb and reconnect.
      pruneRoads(c, getDef);
      g.dirty = true;
      addComb(g, s.orient!, s.period!, s.lanes!);
      for (const p of c.placements) connectWithRoad(g, p);
    }
    let left = greedyPlace(g, ordered, setIdOf);
    pruneRoads(c, getDef);
    g.dirty = true;
    left = greedyPlace(g, left, setIdOf);
    pruneRoads(c, getDef);
    return { name: s.name, city: c, leftovers: left, ev: evaluateCity(c, getDef, settings, ref, sets) };
  };

  const results: StrategyResult[] = [];
  strategies.forEach((s, i) => {
    progress((i / strategies.length) * 0.5, `Trying: ${s.name}`);
    results.push(runStrategy(s));
  });
  results.sort((a, b) => b.ev.score - a.ev.score);

  // Local search on the best few strategies.
  const fixedUids = new Set(pool.fixed.map((p) => p.uid));
  const improve = (r: StrategyResult, iters: number, base: number, span: number) => {
    let c = r.city;
    let left = r.leftovers;
    let best = r.ev.score;
    for (let it = 0; it < iters; it++) {
      if (it % 25 === 0) progress(base + (span * it) / iters, `Refining ${r.name} (score ${best.toFixed(1)})`);
      const movable = c.placements.filter((p) => !fixedUids.has(p.uid));
      if (!movable.length) break;
      const trial = cloneCity(c);
      // Remove 1–3 buildings, biased toward low value density.
      const k = 1 + Math.floor(rng() * 3);
      const removed: Unit[] = [];
      for (let j = 0; j < k; j++) {
        const pick = trial.placements.filter((p) => !fixedUids.has(p.uid));
        if (!pick.length) break;
        pick.sort((a, b) => density(a) - density(b));
        const idx = Math.floor(Math.pow(rng(), 2) * pick.length);
        const p = pick[idx];
        trial.placements.splice(trial.placements.indexOf(p), 1);
        const def = getDef(p.defId)!;
        removed.push({ defId: p.defId, origin: p.origin, sourceRef: p.sourceRef, consumedRef: p.consumedRef, uid: p.uid, value: buildingValue(def, settings, ref), area: def.width! * def.height! });
      }
      const g = new Grid(trial, getDef, options.allowUnknownTerrain);
      // Shuffle ties slightly so repeated moves explore different packings.
      const queue = sortUnits([...left, ...removed]).map((u) => ({ u, j: rng() * 0.15 }));
      queue.sort((a, b) => b.u.value / b.u.area + b.j - (a.u.value / a.u.area + a.j));
      let newLeft = greedyPlace(g, queue.map((q) => q.u), setIdOf);
      // Road pruning is the costliest step, so only do it occasionally during the search.
      if (rng() < 0.05) {
        pruneRoads(trial, getDef);
        g.dirty = true;
        newLeft = greedyPlace(g, newLeft, setIdOf);
      }
      const ev = evaluateCity(trial, getDef, settings, ref, sets);
      if (ev.score >= best - 1e-9) {
        c = trial;
        left = newLeft;
        best = ev.score;
        r.ev = ev;
      }
    }
    // Final prune + refill; keep it only if it doesn't lower the score.
    const fin = cloneCity(c);
    pruneRoads(fin, getDef);
    const fg = new Grid(fin, getDef, options.allowUnknownTerrain);
    const finLeft = greedyPlace(fg, sortUnits(left), setIdOf);
    const finEv = evaluateCity(fin, getDef, settings, ref, sets);
    if (finEv.score >= best - 1e-9) {
      c = fin;
      left = finLeft;
      r.ev = finEv;
    }
    r.city = c;
    r.leftovers = left;
  };
  const densityCache = new Map<string, number>();
  const density = (p: Placement) => {
    let v = densityCache.get(p.defId);
    if (v === undefined) {
      const d = getDef(p.defId)!;
      v = buildingValue(d, settings, ref) / (d.width! * d.height!);
      densityCache.set(p.defId, v);
    }
    return v;
  };

  const top = results.slice(0, Math.max(1, Math.min(options.candidates, results.length)));
  top.forEach((r, i) => improve(r, Math.round(options.iterations / top.length), 0.5 + (0.45 * i) / top.length, 0.45 / top.length));
  top.sort((a, b) => b.ev.score - a.ev.score);

  // Upper bound: fixed buildings' value + fractional knapsack of all positive units over free tiles.
  const boundCity = cloneCity(input.city);
  boundCity.placements = pool.fixed.map((p) => ({ ...p }));
  boundCity.roads.fill(ROAD_NONE);
  const bg = new Grid(boundCity, getDef, options.allowUnknownTerrain);
  let freeTiles = 0;
  for (let i = 0; i < bg.occ.length; i++) if (bg.free(i)) freeTiles++;
  // Fixed buildings scored as if connected: upper bound must not be lowered by removed roads.
  const fixedStats = emptyStats();
  for (const p of pool.fixed) {
    const d = getDef(p.defId);
    if (d && hasDims(d)) for (const [k, v] of Object.entries(statsOf(d))) fixedStats[k as keyof Stats] += v;
  }
  let bound = weightedScore(categoryValues(fixedStats, settings), ref, settings.weights);
  let cap = freeTiles;
  for (const u of ordered) {
    if (cap <= 0) break;
    const take = Math.min(1, cap / u.area);
    bound += u.value * take;
    cap -= u.area * take;
  }
  const usesBonuses = sets.length > 0 || input.defs.some((d) => d.chainId);

  const candidates: Candidate[] = top.map((r, i) => {
    const v = validateCity(r.city, getDef, !options.allowUnknownTerrain);
    const leftover = new Map<string, number>();
    for (const u of r.leftovers) leftover.set(u.defId, (leftover.get(u.defId) ?? 0) + 1);
    for (const u of zeroValue) leftover.set(u.defId, (leftover.get(u.defId) ?? 0) + 1);
    const zeroIds = new Set(zeroValue.map((u) => u.defId));
    let roads = 0;
    for (const x of r.city.roads) if (x !== ROAD_NONE) roads++;
    const g = new Grid(r.city, getDef, options.allowUnknownTerrain);
    let free = 0;
    for (let k = 0; k < g.occ.length; k++) if (g.free(k)) free++;
    // Count kits only for recipe outputs that actually got placed.
    const placedRecipe = new Map<string, number>();
    for (const p of r.city.placements) if (p.origin === 'recipe' && p.sourceRef) placedRecipe.set(p.sourceRef, (placedRecipe.get(p.sourceRef) ?? 0) + 1);
    const kits = new Map<string, number>();
    const recUsed: { recipeId: string; times: number }[] = [];
    for (const [rid, times] of placedRecipe) {
      const rec = input.recipes.find((x) => x.id === rid);
      if (!rec) continue;
      recUsed.push({ recipeId: rid, times });
      for (const inp of rec.inputs) kits.set(inp.key, (kits.get(inp.key) ?? 0) + inp.qty * times);
    }
    for (const p of r.city.placements) {
      if (p.origin === 'inventory' && p.sourceRef) kits.set(p.sourceRef, (kits.get(p.sourceRef) ?? 0) + 1);
      if (p.consumedRef) kits.set(p.consumedRef, (kits.get(p.consumedRef) ?? 0) + 1);
    }
    return {
      id: `cand-${i + 1}`,
      name: r.name,
      city: r.city,
      score: r.ev.score,
      values: r.ev.values,
      stats: r.ev.stats,
      placed: r.city.placements.length,
      unplaced: [...leftover].map(([defId, count]) => ({
        defId,
        count,
        reason: zeroIds.has(defId) ? 'no scored benefit' : 'no valid space with road access',
      })),
      roadCells: roads,
      freeCells: free,
      kitsUsed: [...kits].map(([key, qty]) => ({ key, qty })),
      recipesUsed: recUsed,
      valid: v.ok,
      issues: v.issues.map((x) => x.message),
      trade: [],
    };
  });

  // Trade-off notes relative to the best candidate and the baseline.
  const cats: (keyof CategoryValues)[] = ['military', 'fp', 'goods', 'other'];
  const label: Record<keyof CategoryValues, string> = { military: 'military', fp: 'Forge Points', goods: 'goods', other: 'other resources' };
  for (const cand of candidates) {
    for (const k of cats) {
      const b = baseEval.values[k];
      const d = cand.values[k] - b;
      if (Math.abs(d) > 1e-6) cand.trade.push(`${label[k]} ${d > 0 ? '+' : ''}${fmt(d)} vs. current (${fmt(b)} → ${fmt(cand.values[k])})`);
    }
    if (cand !== candidates[0]) {
      const best = candidates[0];
      const stronger = cats.filter((k) => cand.values[k] > best.values[k] + 1e-6).map((k) => label[k]);
      if (stronger.length) cand.trade.push(`Stronger than the top candidate in ${stronger.join(', ')}.`);
    }
    cand.trade.push(`${cand.roadCells} road tiles, ${cand.freeCells} free buildable tiles left.`);
  }

  if (pool.excluded.length) notes.push(`${pool.excluded.reduce((a, e) => a + e.count, 0)} stored or converted buildings were skipped because their size, road requirement or statistics are unknown.`);
  const fixedUnknown = pool.fixed.filter((p) => getDef(p.defId)?.statsStatus === 'unknown').length;
  if (fixedUnknown && options.mode === 'rearrange')
    notes.push(`${fixedUnknown} placed buildings have unknown statistics and were left exactly where they are.`);

  progress(1, 'Done');
  return {
    candidates,
    baseline: { score: baseEval.score, values: baseEval.values },
    upperBound: bound,
    boundNote: usesBonuses
      ? 'Upper bound ignores road space and set/chain bonuses, so it is a loose guide only.'
      : 'Upper bound ignores road space, so the true optimum is at or below it.',
    excluded: pool.excluded,
    fixedCount: pool.fixed.length,
    elapsedMs: Date.now() - t0,
    notes,
  };
}

function fmt(n: number): string {
  return Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
}
