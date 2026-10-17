import { hasDims } from './buildingDb';
import type { BuildingDef, CityState, Placement } from './types';
import { ROAD_1, ROAD_2, ROAD_NONE, TERRAIN_BUILDABLE, TERRAIN_UNKNOWN } from './types';

export type DefLookup = (id: string) => BuildingDef | undefined;

export function makeCity(width: number, height: number, terrain = TERRAIN_UNKNOWN): CityState {
  return {
    width,
    height,
    terrain: new Array(width * height).fill(terrain),
    roads: new Array(width * height).fill(ROAD_NONE),
    placements: [],
  };
}

export function cloneCity(c: CityState): CityState {
  return {
    width: c.width,
    height: c.height,
    terrain: c.terrain.slice(),
    roads: c.roads.slice(),
    placements: c.placements.map((p) => ({ ...p })),
  };
}

/** Resizes the grid, keeping content anchored at the top-left and shifting by (dx, dy). */
export function resizeCity(c: CityState, width: number, height: number, dx = 0, dy = 0): CityState {
  const out = makeCity(width, height);
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      out.terrain[ny * width + nx] = c.terrain[y * c.width + x];
      out.roads[ny * width + nx] = c.roads[y * c.width + x];
    }
  out.placements = c.placements.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  return out;
}

export function footprint(p: Placement, def: BuildingDef | undefined): { w: number; h: number } | null {
  if (!hasDims(def)) return null;
  return p.rot ? { w: def.height, h: def.width } : { w: def.width, h: def.height };
}

export function inBounds(c: CityState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < c.width && y < c.height;
}

/** Cell index -> placement uid, for occupied cells. */
export function occupancy(c: CityState, getDef: DefLookup): (string | null)[] {
  const occ: (string | null)[] = new Array(c.width * c.height).fill(null);
  for (const p of c.placements) {
    const f = footprint(p, getDef(p.defId));
    if (!f) continue;
    for (let y = p.y; y < p.y + f.h; y++)
      for (let x = p.x; x < p.x + f.w; x++) if (inBounds(c, x, y) && occ[y * c.width + x] === null) occ[y * c.width + x] = p.uid;
  }
  return occ;
}

export function placementAt(c: CityState, getDef: DefLookup, x: number, y: number): Placement | undefined {
  for (let i = c.placements.length - 1; i >= 0; i--) {
    const p = c.placements[i];
    const f = footprint(p, getDef(p.defId));
    if (f && x >= p.x && y >= p.y && x < p.x + f.w && y < p.y + f.h) return p;
  }
  return undefined;
}

/** Cells edge-adjacent to a rectangle (outside it). */
export function perimeter(x: number, y: number, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = x; i < x + w; i++) out.push([i, y - 1], [i, y + h]);
  for (let j = y; j < y + h; j++) out.push([x - 1, j], [x + w, j]);
  return out;
}

export function townHall(c: CityState, getDef: DefLookup): Placement | undefined {
  return c.placements.find((p) => getDef(p.defId)?.kind === 'townhall');
}

/**
 * Road cells connected to the Town Hall. `level` 1 = any road, 2 = only two-lane roads (a
 * two-lane connection must run through two-lane road all the way to the Town Hall).
 */
export function connectedRoads(c: CityState, getDef: DefLookup, level: 1 | 2 = 1): Uint8Array {
  const seen = new Uint8Array(c.width * c.height);
  const th = townHall(c, getDef);
  const f = th && footprint(th, getDef(th.defId));
  if (!th || !f) return seen;
  const ok = (i: number) => (level === 1 ? c.roads[i] !== ROAD_NONE : c.roads[i] === ROAD_2);
  const queue: number[] = [];
  for (const [x, y] of perimeter(th.x, th.y, f.w, f.h)) {
    if (!inBounds(c, x, y)) continue;
    const i = y * c.width + x;
    if (ok(i) && !seen[i]) {
      seen[i] = 1;
      queue.push(i);
    }
  }
  const W = c.width;
  const H = c.height;
  const visit = (j: number) => {
    if (!seen[j] && ok(j)) {
      seen[j] = 1;
      queue.push(j);
    }
  };
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % W;
    if (x + 1 < W) visit(i + 1);
    if (x > 0) visit(i - 1);
    if (i + W < W * H) visit(i + W);
    if (i >= W) visit(i - W);
  }
  return seen;
}

export interface Connectivity {
  road1: Uint8Array;
  road2: Uint8Array;
}

export function connectivity(c: CityState, getDef: DefLookup): Connectivity {
  return { road1: connectedRoads(c, getDef, 1), road2: connectedRoads(c, getDef, 2) };
}

/** True if a placed building's road requirement is met. Unknown requirements count as "road". */
export function isConnected(c: CityState, p: Placement, def: BuildingDef | undefined, conn: Connectivity): boolean {
  if (!def) return false;
  if (def.road === 'none' || def.kind === 'townhall') return true;
  const f = footprint(p, def);
  if (!f) return false;
  const net = def.road === 'road2' ? conn.road2 : conn.road1;
  for (const [x, y] of perimeter(p.x, p.y, f.w, f.h)) if (inBounds(c, x, y) && net[y * c.width + x]) return true;
  return false;
}

export type IssueType = 'no-dims' | 'out-of-bounds' | 'overlap' | 'on-road' | 'not-buildable' | 'disconnected' | 'no-townhall';

export interface Issue {
  type: IssueType;
  uid?: string;
  cell?: number;
  message: string;
}

export interface Validation {
  issues: Issue[];
  disconnectedRoads: number[];
  badUids: Set<string>;
  ok: boolean;
}

/** Full layout validation. `strictTerrain` treats unknown terrain as not buildable. */
export function validateCity(c: CityState, getDef: DefLookup, strictTerrain = false): Validation {
  const issues: Issue[] = [];
  const badUids = new Set<string>();
  const owner: (string | null)[] = new Array(c.width * c.height).fill(null);
  const conn = connectivity(c, getDef);
  const th = townHall(c, getDef);
  if (!th) issues.push({ type: 'no-townhall', message: 'No Town Hall placed: road connectivity cannot be checked.' });

  for (const p of c.placements) {
    const def = getDef(p.defId);
    const f = footprint(p, def);
    const label = def?.name ?? p.defId;
    if (!f) {
      issues.push({ type: 'no-dims', uid: p.uid, message: `${label}: size unknown (enter width × height).` });
      badUids.add(p.uid);
      continue;
    }
    let oob = false;
    let overlap = false;
    let onRoad = false;
    let bad = false;
    for (let y = p.y; y < p.y + f.h; y++)
      for (let x = p.x; x < p.x + f.w; x++) {
        if (!inBounds(c, x, y)) {
          oob = true;
          continue;
        }
        const i = y * c.width + x;
        if (owner[i] && owner[i] !== p.uid) overlap = true;
        owner[i] = p.uid;
        if (c.roads[i] !== ROAD_NONE) onRoad = true;
        const t = c.terrain[i];
        if (t !== TERRAIN_BUILDABLE && (strictTerrain || t !== TERRAIN_UNKNOWN)) bad = true;
      }
    if (oob) issues.push({ type: 'out-of-bounds', uid: p.uid, message: `${label} extends outside the city grid.` });
    if (overlap) issues.push({ type: 'overlap', uid: p.uid, message: `${label} overlaps another building.` });
    if (onRoad) issues.push({ type: 'on-road', uid: p.uid, message: `${label} sits on a road tile.` });
    if (bad) issues.push({ type: 'not-buildable', uid: p.uid, message: `${label} covers land that is not buildable.` });
    if (th && !isConnected(c, p, def, conn))
      issues.push({
        type: 'disconnected',
        uid: p.uid,
        message: `${label} is not connected to the Town Hall by ${def?.road === 'road2' ? 'two-lane road' : 'road'}.`,
      });
    if (oob || overlap || onRoad || bad || (th && !isConnected(c, p, def, conn))) badUids.add(p.uid);
  }

  const disconnectedRoads: number[] = [];
  if (th) for (let i = 0; i < c.roads.length; i++) if (c.roads[i] !== ROAD_NONE && !conn.road1[i]) disconnectedRoads.push(i);
  return { issues, disconnectedRoads, badUids, ok: issues.length === 0 };
}

export function countCells(c: CityState) {
  let buildable = 0;
  let unknown = 0;
  let blocked = 0;
  let roads = 0;
  let road2 = 0;
  for (let i = 0; i < c.terrain.length; i++) {
    if (c.terrain[i] === TERRAIN_BUILDABLE) buildable++;
    else if (c.terrain[i] === TERRAIN_UNKNOWN) unknown++;
    else blocked++;
    if (c.roads[i] === ROAD_1) roads++;
    if (c.roads[i] === ROAD_2) road2++;
  }
  return { buildable, unknown, blocked, roads, road2 };
}

export function occupiedArea(c: CityState, getDef: DefLookup): number {
  let a = 0;
  for (const p of c.placements) {
    const f = footprint(p, getDef(p.defId));
    if (f) a += f.w * f.h;
  }
  return a;
}

/** Coordinates as shown to the player: column letters are avoided; 1-based (col, row). */
export function coordLabel(x: number, y: number): string {
  return `(${x + 1}, ${y + 1})`;
}
