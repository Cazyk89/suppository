/**
 * Building data that ships with the app (src/data/buildings.json).
 *
 * Merge rules, so the player never loses their own work:
 * - A building the player hasn't filled in takes the bundled values.
 * - Each field group (size, road, statistics) is filled independently, only where it is unknown.
 * - Records that came wholly from the bundle are tagged with the bundle revision; when the bundled
 *   record changes, they are refreshed. Editing a building in the app removes the tag, after which
 *   the bundle never touches it again.
 */
import data from '../data/buildings.json';
import { newDef } from './buildingDb';
import type { BuildingDef, SetDef } from './types';

export type BundledDef = Partial<BuildingDef> & { id: string; name: string };

export const BUNDLED_BUILDINGS = data.buildings as BundledDef[];
export const BUNDLED_SETS = data.sets as SetDef[];

/** Short stable fingerprint of a bundled record, used to detect updates. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

export function bundleRev(b: BundledDef): string {
  const s = stableJson(b);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function fromBundle(b: BundledDef): BuildingDef {
  return { ...newDef(b), ...b, bundled: bundleRev(b) };
}

export function mergeBundled(buildings: BuildingDef[], sets: SetDef[], bundle = BUNDLED_BUILDINGS, bundleSets = BUNDLED_SETS) {
  const byId = new Map(buildings.map((b) => [b.id, b]));
  for (const b of bundle) {
    const cur = byId.get(b.id);
    const rev = bundleRev(b);
    if (!cur) {
      byId.set(b.id, fromBundle(b));
      continue;
    }
    if (cur.bundled === rev) continue;
    if (cur.bundled) {
      // Untouched copy of an older bundled record: refresh it, keeping in-app-only flags.
      byId.set(b.id, { ...fromBundle(b), protected: cur.protected ?? b.protected });
      continue;
    }
    // Player-owned record: fill only the groups that are still unknown.
    const next = { ...cur };
    if (cur.dimsStatus === 'unknown' && b.width && b.height) {
      next.width = b.width;
      next.height = b.height;
      next.dimsStatus = b.dimsStatus ?? 'user';
      if (b.rotatable !== undefined) next.rotatable = b.rotatable;
    }
    if (cur.road === 'unknown' && b.road && b.road !== 'unknown') next.road = b.road;
    if (cur.statsStatus === 'unknown' && b.statsStatus && b.statsStatus !== 'unknown') {
      next.stats = { ...b.stats };
      next.statsStatus = b.statsStatus;
      if (b.chainBonus) next.chainBonus = b.chainBonus;
    }
    for (const k of ['era', 'variant', 'setId', 'chainId', 'chainRole'] as const) if (next[k] === undefined && b[k] !== undefined) (next as Record<string, unknown>)[k] = b[k];
    if (next.kind === 'special' && b.kind) next.kind = b.kind;
    if (!next.source && b.source) next.source = b.source;
    byId.set(b.id, next);
  }
  const setIds = new Set(sets.map((s) => s.id));
  return { buildings: [...byId.values()], sets: [...sets, ...bundleSets.filter((s) => !setIds.has(s.id))] };
}

/** Problems with the bundled file itself (checked by tests). */
export function bundleProblems(bundle = BUNDLED_BUILDINGS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const b of bundle) {
    if (!b.id || !b.name) out.push(`record without id/name: ${JSON.stringify(b)}`);
    if (seen.has(b.id)) out.push(`duplicate id ${b.id}`);
    seen.add(b.id);
    if ((b.width === undefined) !== (b.height === undefined)) out.push(`${b.id}: width and height must be given together`);
    else if (b.width !== undefined && !(Number.isInteger(b.width) && b.width! > 0 && Number.isInteger(b.height) && b.height! > 0)) out.push(`${b.id}: bad size`);
    if (b.statsStatus && b.statsStatus !== 'unknown' && !b.source) out.push(`${b.id}: statistics need a source`);
    if (b.dimsStatus && b.dimsStatus !== 'unknown' && !b.source) out.push(`${b.id}: size needs a source`);
  }
  return out;
}
