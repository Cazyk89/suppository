import { displayName, hasDims } from './buildingDb';
import { effectiveQty } from './inventory';
import type { DefLookup } from './grid';
import { coordLabel, footprint } from './grid';
import type { CategoryValues } from './scoring';
import { buildingValue } from './scoring';
import type { BuildingDef, CityState, InventoryItem, Placement, Recipe, Settings } from './types';
import { ROAD_NONE } from './types';

export type Action = 'keep' | 'move' | 'store' | 'place' | 'upgrade' | 'construct';

export interface Recommendation {
  action: Action;
  uid: string;
  defId: string;
  title: string;
  why: string;
  impact: number;
  tiles: number;
  items: string[];
  reversible: string;
  risk: string[];
  from?: string;
  to?: string;
}

function riskFor(def: BuildingDef | undefined): string[] {
  const r: string[] = [];
  if (!def) return ['Building is not in the database.'];
  if (def.statsStatus !== 'verified') r.push(`Statistics are ${def.statsStatus === 'user' ? 'user-entered, not verified' : 'unknown'}.`);
  if (def.dimsStatus !== 'verified') r.push(`Size is ${def.dimsStatus === 'user' ? 'user-entered, not verified' : 'unknown'}.`);
  if (def.road === 'unknown') r.push('Road requirement unknown.');
  return r;
}

function area(p: Placement, def: BuildingDef | undefined): number {
  const f = footprint(p, def);
  return f ? f.w * f.h : 0;
}

/** Compares the baseline city with a proposed layout and explains each change. */
export function recommend(
  baseline: CityState,
  proposed: CityState,
  getDef: DefLookup,
  settings: Settings,
  ref: CategoryValues,
  inventory: InventoryItem[],
  recipes: Recipe[],
): Recommendation[] {
  const invByKey = new Map(inventory.map((i) => [i.key, i]));
  const storeKits = inventory.find((i) => i.key === 'store building');
  const storeHave = storeKits ? effectiveQty(storeKits) : 0;
  const base = new Map(baseline.placements.map((p) => [p.uid, p]));
  const prop = new Map(proposed.placements.map((p) => [p.uid, p]));
  const out: Recommendation[] = [];
  const val = (def: BuildingDef | undefined) => (def && hasDims(def) ? buildingValue(def, settings, ref) : 0);

  for (const p of baseline.placements) {
    const def = getDef(p.defId);
    const q = prop.get(p.uid);
    const name = displayName(def);
    if (!q) {
      out.push({
        action: 'store',
        uid: p.uid,
        defId: p.defId,
        title: `Store ${name}`,
        why:
          val(def) <= 0
            ? 'It contributes nothing to the weighted priorities, and its tiles are better used by other buildings.'
            : 'Its tiles produce more value when used by the buildings placed there in this layout.',
        impact: -val(def),
        tiles: area(p, def),
        items: ['1 × Store Building (special buildings); some buildings can only be sold or deleted'],
        reversible: `Yes – it goes back to inventory. You have ${storeHave} Store Building item${storeHave === 1 ? '' : 's'}.`,
        risk: riskFor(def),
        from: coordLabel(p.x, p.y),
      });
      continue;
    }
    if (q.defId !== p.defId) {
      const nd = getDef(q.defId);
      const rec = recipes.find((r) => r.id === q.sourceRef);
      out.push({
        action: 'upgrade',
        uid: p.uid,
        defId: q.defId,
        title: `Upgrade ${name} → ${displayName(nd)}`,
        why: `Upgrading adds value without using extra tiles${area(q, nd) !== area(p, def) ? ' (footprint changes)' : ''}.`,
        impact: val(nd) - val(def),
        tiles: area(q, nd) - area(p, def),
        items: rec ? rec.inputs.map((i) => `${i.qty} × ${invByKey.get(i.key)?.rawName ?? i.key}`) : [],
        reversible: 'No – upgrade kits are consumed.',
        risk: riskFor(nd),
        from: coordLabel(p.x, p.y),
        to: coordLabel(q.x, q.y),
      });
      continue;
    }
    const moved = q.x !== p.x || q.y !== p.y || q.rot !== p.rot;
    out.push({
      action: moved ? 'move' : 'keep',
      uid: p.uid,
      defId: p.defId,
      title: `${moved ? 'Move' : 'Keep'} ${name}`,
      why: moved ? 'Moving it frees or consolidates space and road access for the new layout.' : 'Already in the right place.',
      impact: 0,
      tiles: 0,
      items: [],
      reversible: moved ? 'Yes – moves are free in reconstruction mode.' : '—',
      risk: moved ? riskFor(def).filter((r) => r.startsWith('Size')) : [],
      from: coordLabel(p.x, p.y),
      to: coordLabel(q.x, q.y),
    });
  }

  for (const q of proposed.placements) {
    if (base.has(q.uid)) continue;
    const def = getDef(q.defId);
    const name = displayName(def);
    if (q.origin === 'recipe') {
      const rec = recipes.find((r) => r.id === q.sourceRef);
      const items = rec ? rec.inputs.map((i) => `${i.qty} × ${invByKey.get(i.key)?.rawName ?? i.key}`) : [];
      if (q.consumedRef) items.push(`1 × ${invByKey.get(q.consumedRef)?.rawName ?? q.consumedRef} (from storage)`);
      out.push({
        action: 'construct',
        uid: q.uid,
        defId: q.defId,
        title: `Create and place ${name}`,
        why: `Converting kits${rec ? ` via “${rec.name}”` : ''} yields a building whose value per tile beats the alternatives.`,
        impact: val(def),
        tiles: area(q, def),
        items,
        reversible: 'Partly – the building can be stored, but kits used are gone.',
        risk: riskFor(def),
        to: coordLabel(q.x, q.y),
      });
    } else {
      out.push({
        action: 'place',
        uid: q.uid,
        defId: q.defId,
        title: `Place ${name} from inventory`,
        why: 'Unused building in storage that adds value in free or reclaimed tiles.',
        impact: val(def),
        tiles: area(q, def),
        items: [`1 × ${invByKey.get(q.sourceRef ?? '')?.rawName ?? name} (inventory)`],
        reversible: 'Yes, with a Store Building item.',
        risk: riskFor(def),
        to: coordLabel(q.x, q.y),
      });
    }
  }

  const order: Record<Action, number> = { upgrade: 0, construct: 1, place: 2, store: 3, move: 4, keep: 5 };
  return out.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact) || order[a.action] - order[b.action]);
}

export interface PlanStep {
  title: string;
  details: string[];
}

/** Ordered, low-disruption rebuilding steps for the player to execute manually in the game. */
export function rebuildPlan(
  baseline: CityState,
  proposed: CityState,
  recs: Recommendation[],
  getDef: DefLookup,
): PlanStep[] {
  const steps: PlanStep[] = [];
  const W = proposed.width;
  steps.push({
    title: 'Back up first',
    details: [
      'Export a project backup (Saved Layouts → Export backup) and keep a screenshot of your current city.',
      'This plan never changes your game account; you carry out each step yourself.',
    ],
  });

  // Non-disruptive additions: target tiles are already free (no building, no road) in the baseline.
  const baseOcc = new Set<number>();
  for (const p of baseline.placements) {
    const f = footprint(p, getDef(p.defId));
    if (!f) continue;
    for (let y = p.y; y < p.y + f.h; y++) for (let x = p.x; x < p.x + f.w; x++) baseOcc.add(y * baseline.width + x);
  }
  const propRoads = new Set<number>();
  for (let i = 0; i < proposed.roads.length; i++) if (proposed.roads[i] !== ROAD_NONE) propRoads.add(i);
  const easy: string[] = [];
  const hard: Recommendation[] = [];
  for (const r of recs.filter((x) => x.action === 'place' || x.action === 'construct')) {
    const q = proposed.placements.find((p) => p.uid === r.uid)!;
    const f = footprint(q, getDef(q.defId));
    let free = !!f;
    if (f)
      for (let y = q.y; y < q.y + f.h && free; y++)
        for (let x = q.x; x < q.x + f.w; x++) {
          const i = y * W + x;
          if (baseOcc.has(i) || baseline.roads[i] !== ROAD_NONE) {
            free = false;
            break;
          }
        }
    if (free) easy.push(`${r.title} at ${r.to}`);
    else hard.push(r);
  }
  const ups = recs.filter((r) => r.action === 'upgrade');
  if (ups.length) steps.push({ title: 'Apply upgrades in place', details: ups.map((r) => `${r.title} at ${r.from} — uses ${r.items.join(', ') || 'see recipe'}`) });
  if (easy.length) steps.push({ title: 'Place buildings that fit without moving anything', details: easy });

  const stores = recs.filter((r) => r.action === 'store');
  if (stores.length)
    steps.push({
      title: `Store ${stores.length} building${stores.length === 1 ? '' : 's'}`,
      details: [
        ...stores.map((r) => `${r.title.replace(/^Store /, '')} at ${r.from}`),
        `Needs up to ${stores.length} Store Building item${stores.length === 1 ? '' : 's'} (check which buildings require one in game).`,
      ],
    });

  const moves = recs.filter((r) => r.action === 'move');
  let roadsAdded = 0;
  let roadsRemoved = 0;
  for (let i = 0; i < proposed.roads.length; i++) {
    const a = baseline.roads[i] !== ROAD_NONE;
    const b = proposed.roads[i] !== ROAD_NONE;
    if (b && !a) roadsAdded++;
    if (a && !b) roadsRemoved++;
  }
  if (moves.length || hard.length || roadsAdded || roadsRemoved) {
    // Top-to-bottom, left-to-right so the player sweeps the city once.
    const pos = (s?: string) => {
      const m = s?.match(/\((\d+), (\d+)\)/);
      return m ? Number(m[2]) * 10000 + Number(m[1]) : 0;
    };
    steps.push({
      title: 'Use reconstruction mode for the rearrangement',
      details: [
        'Open reconstruction mode: buildings moved to its side panel are not stored and need no Store Building items.',
        `Lift the ${moves.length} building${moves.length === 1 ? '' : 's'} that move into the panel first.`,
        roadsRemoved ? `Remove ${roadsRemoved} road tile${roadsRemoved === 1 ? '' : 's'} (shown in the comparison).` : '',
        roadsAdded ? `Lay ${roadsAdded} new road tile${roadsAdded === 1 ? '' : 's'} (shown in the comparison).` : '',
        ...moves.sort((a, b) => pos(a.to) - pos(b.to)).map((r) => `${r.title.replace(/^Move /, '')}: ${r.from} → ${r.to}`),
        ...hard.sort((a, b) => pos(a.to) - pos(b.to)).map((r) => `${r.title} at ${r.to}`),
        'Confirm reconstruction only when the side panel is empty.',
      ].filter(Boolean),
    });
  }
  steps.push({
    title: 'Verify',
    details: [
      'Check every building shows no “not connected” icon.',
      'Compare boosts in your city overview with the predicted totals; update any statistics that differ in the Building Database.',
    ],
  });
  return steps;
}

export function planToText(title: string, steps: PlanStep[], recs: Recommendation[]): string {
  const lines = [`# ${title}`, '', `Generated ${new Date().toLocaleString()}`, '', '## Rebuilding steps', ''];
  steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title}`);
    for (const d of s.details) lines.push(`   - ${d}`);
  });
  lines.push('', '## Recommendations', '');
  for (const r of recs.filter((x) => x.action !== 'keep')) {
    lines.push(`- **${r.title}** (${r.impact >= 0 ? '+' : ''}${r.impact.toFixed(2)} score, ${r.tiles} tiles)`);
    lines.push(`  - Why: ${r.why}`);
    if (r.items.length) lines.push(`  - Items: ${r.items.join('; ')}`);
    lines.push(`  - Reversible: ${r.reversible}`);
    if (r.risk.length) lines.push(`  - Uncertainty: ${r.risk.join(' ')}`);
  }
  return lines.join('\n');
}

export interface Shortfall {
  key: string;
  name: string;
  needed: number;
  available: number;
}

/**
 * Stored items a proposed layout needs (new placements from storage, buildings consumed by
 * recipes, and recipe inputs) compared with what the inventory holds now. Non-empty means the plan
 * was made with an older inventory and should be re-run.
 */
export function inventoryShortfalls(baseline: CityState, proposed: CityState, inventory: InventoryItem[], recipes: Recipe[]): Shortfall[] {
  const before = new Set(baseline.placements.map((p) => p.uid));
  const need = new Map<string, number>();
  const add = (k: string, n: number) => need.set(k, (need.get(k) ?? 0) + n);
  for (const p of proposed.placements) {
    if (before.has(p.uid) && p.origin !== 'recipe') continue;
    if (p.origin === 'inventory' && p.sourceRef) add(p.sourceRef, 1);
    if (p.consumedRef) add(p.consumedRef, 1);
    if (p.origin === 'recipe') {
      const r = recipes.find((x) => x.id === p.sourceRef);
      for (const i of r?.inputs ?? []) add(i.key, i.qty);
    }
  }
  const byKey = new Map(inventory.map((i) => [i.key, i]));
  const out: Shortfall[] = [];
  for (const [key, needed] of need) {
    const item = byKey.get(key);
    const available = item ? effectiveQty(item) : 0;
    if (needed > available) out.push({ key, name: item?.rawName ?? key, needed, available });
  }
  return out;
}
