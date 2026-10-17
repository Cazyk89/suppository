import { emptyStats, statsOf } from './buildingDb';
import type { DefLookup } from './grid';
import { connectivity, footprint, inBounds, isConnected, perimeter } from './grid';
import type { BuildingDef, CityState, ModeRules, ModeWeights, OtherRates, Placement, SetDef, Settings, Stats, Weights } from './types';
import { STAT_KEYS } from './types';

export const DEFAULT_WEIGHTS: Weights = { military: 35, fp: 30, goods: 20, other: 15 };

/**
 * Default emphasis across military game modes. These are adjustable starting points, not game
 * data: GbG and GE are weighted highest because they are where attacking-army boosts are used most.
 */
export const DEFAULT_MODE_WEIGHTS: ModeWeights = { gbg: 35, ge: 25, qi: 20, pvp: 15, cityDefense: 5 };

export const DEFAULT_MODE_RULES: ModeRules = { qiUsesCityBoosts: false };

/**
 * Starting exchange rates into "other value" points. These are adjustable preferences (how much
 * the player cares about each resource), not game data.
 */
export const DEFAULT_OTHER_RATES: OtherRates = { units: 1, coinBoost: 0.2, supplyBoost: 0.2, fpBoost: 0.5, diamonds: 1 };

/**
 * One-tap priority presets. These are starting points for the player's own preferences, not game
 * data; "Balanced" is the agreed default.
 */
export const PRESETS: { id: string; name: string; weights: Weights; modeWeights: ModeWeights }[] = [
  { id: 'balanced', name: 'Balanced (default)', weights: { ...DEFAULT_WEIGHTS }, modeWeights: { ...DEFAULT_MODE_WEIGHTS } },
  { id: 'gbg', name: 'GbG fighter', weights: { military: 55, fp: 25, goods: 10, other: 10 }, modeWeights: { gbg: 70, ge: 15, qi: 5, pvp: 5, cityDefense: 5 } },
  { id: 'ge', name: 'Expedition', weights: { military: 55, fp: 25, goods: 10, other: 10 }, modeWeights: { gbg: 15, ge: 70, qi: 5, pvp: 5, cityDefense: 5 } },
  { id: 'qi', name: 'Quantum Incursions', weights: { military: 55, fp: 25, goods: 10, other: 10 }, modeWeights: { gbg: 10, ge: 10, qi: 70, pvp: 5, cityDefense: 5 } },
  { id: 'fp', name: 'Forge Point economy', weights: { military: 15, fp: 60, goods: 15, other: 10 }, modeWeights: { ...DEFAULT_MODE_WEIGHTS } },
];

export function addStats(a: Stats, b: Partial<Stats>, mult = 1): Stats {
  for (const k of STAT_KEYS) a[k] += (b[k] ?? 0) * mult;
  return a;
}

/** Effective attack/defense per mode from summed stats. */
export function militaryByMode(s: Stats, rules: ModeRules) {
  const qiBase = rules.qiUsesCityBoosts ? 1 : 0;
  return {
    gbg: { atk: s.attAtk + s.gbgAtk, def: s.attDef + s.gbgDef },
    ge: { atk: s.attAtk + s.geAtk, def: s.attDef + s.geDef },
    qi: { atk: s.qiAtk + qiBase * s.attAtk, def: s.qiDef + qiBase * s.attDef },
    pvp: { atk: s.attAtk, def: s.attDef },
    cityDefense: { atk: s.defAtk, def: s.defDef },
  };
}

/** One number for military strength: mode-weighted average of (attack + defense) / 2. */
export function militaryComposite(s: Stats, mw: ModeWeights, rules: ModeRules): number {
  const m = militaryByMode(s, rules);
  const total = mw.gbg + mw.ge + mw.qi + mw.pvp + mw.cityDefense || 1;
  let v = 0;
  for (const k of Object.keys(m) as (keyof typeof m)[]) v += (mw[k] / total) * ((m[k].atk + m[k].def) / 2);
  return v;
}

export interface CategoryValues {
  military: number;
  fp: number;
  goods: number;
  other: number;
}

export function categoryValues(s: Stats, settings: Settings): CategoryValues {
  return {
    military: militaryComposite(s, settings.modeWeights, settings.modeRules),
    fp: s.fp,
    // Guild goods count as goods: both feed the same "goods" priority.
    goods: s.goods + s.guildGoods,
    other: otherValue(s, settings.otherRates ?? DEFAULT_OTHER_RATES),
  };
}

export function otherValue(s: Stats, r: OtherRates): number {
  return s.other + s.units * r.units + s.coinBoost * r.coinBoost + s.supplyBoost * r.supplyBoost + s.fpBoost * r.fpBoost + s.diamonds * r.diamonds;
}

/**
 * Reference values that make categories comparable. Score 100 means "as good as the reference
 * city in every category". A category the reference city doesn't produce at all would otherwise
 * get an unbounded weight, so it falls back to `potential` (everything the player owns, placed or
 * stored, summed), and finally to 1.
 */
export function referenceFrom(values: CategoryValues, potential?: CategoryValues): CategoryValues {
  const pick = (k: keyof CategoryValues) => (values[k] > 1e-9 ? values[k] : Math.max(potential?.[k] ?? 0, 1));
  return { military: pick('military'), fp: pick('fp'), goods: pick('goods'), other: pick('other') };
}

/** Category totals if every scored building the player owns (placed + stored) were active. */
export function potentialValues(
  placedDefIds: string[],
  stored: { defId: string; qty: number }[],
  getDef: (id: string) => BuildingDef | undefined,
  settings: Settings,
): CategoryValues {
  const total = emptyStats();
  const add = (id: string, n: number) => {
    const d = getDef(id);
    if (d && d.statsStatus !== 'unknown') addStats(total, statsOf(d), n);
  };
  for (const id of placedDefIds) add(id, 1);
  for (const s of stored) add(s.defId, s.qty);
  return categoryValues(total, settings);
}

export function weightedScore(v: CategoryValues, ref: CategoryValues, w: Weights): number {
  const total = w.military + w.fp + w.goods + w.other || 1;
  return (
    (100 / total) *
    ((w.military * v.military) / ref.military + (w.fp * v.fp) / ref.fp + (w.goods * v.goods) / ref.goods + (w.other * v.other) / ref.other)
  );
}

export interface Evaluation {
  stats: Stats;
  values: CategoryValues;
  score: number;
  perBuilding: Map<string, { stats: Stats; connected: boolean; bonus: boolean }>;
  disconnected: string[];
  unscored: string[];
}

/** Adjacency: uids whose footprints share an edge. */
function adjacencyGraph(c: CityState, getDef: DefLookup, placements: Placement[]): Map<string, Set<string>> {
  const owner: (string | null)[] = new Array(c.width * c.height).fill(null);
  const g = new Map<string, Set<string>>();
  for (const p of placements) {
    g.set(p.uid, new Set());
    const f = footprint(p, getDef(p.defId));
    if (!f) continue;
    for (let y = p.y; y < p.y + f.h; y++) for (let x = p.x; x < p.x + f.w; x++) if (inBounds(c, x, y)) owner[y * c.width + x] = p.uid;
  }
  for (const p of placements) {
    const f = footprint(p, getDef(p.defId));
    if (!f) continue;
    for (const [x, y] of perimeter(p.x, p.y, f.w, f.h)) {
      if (!inBounds(c, x, y)) continue;
      const o = owner[y * c.width + x];
      if (o && o !== p.uid) {
        g.get(p.uid)!.add(o);
        g.get(o)?.add(p.uid);
      }
    }
  }
  return g;
}

/**
 * Evaluates a city: buildings that need a road but are not connected produce nothing, matching the
 * game. Set tiers apply per adjacent group of distinct members; chain links count only when they
 * touch a group containing the chain's start building.
 */
export function evaluateCity(
  c: CityState,
  getDef: DefLookup,
  settings: Settings,
  ref: CategoryValues | null,
  sets: SetDef[] = [],
): Evaluation {
  const conn = connectivity(c, getDef);
  const total = emptyStats();
  const perBuilding = new Map<string, { stats: Stats; connected: boolean; bonus: boolean }>();
  const disconnected: string[] = [];
  const unscored: string[] = [];
  const active: Placement[] = [];
  const hasTh = c.placements.some((p) => getDef(p.defId)?.kind === 'townhall');

  for (const p of c.placements) {
    const def = getDef(p.defId);
    if (!def || !footprint(p, def)) {
      unscored.push(p.uid);
      continue;
    }
    // Without a Town Hall connectivity is unknowable; score optimistically and let validation flag it.
    const ok = !hasTh || isConnected(c, p, def, conn);
    if (!ok) disconnected.push(p.uid);
    if (def.statsStatus === 'unknown') unscored.push(p.uid);
    const s = ok ? statsOf(def) : emptyStats();
    perBuilding.set(p.uid, { stats: s, connected: ok, bonus: false });
    if (ok) {
      addStats(total, s);
      active.push(p);
    }
  }

  const needsAdjacency = active.some((p) => {
    const d = getDef(p.defId);
    return d?.setId || d?.chainId;
  });
  if (needsAdjacency) {
    const g = adjacencyGraph(c, getDef, active);
    const byUid = new Map(active.map((p) => [p.uid, p]));
    // Sets: connected components of same-set members.
    for (const set of sets) {
      const members = active.filter((p) => getDef(p.defId)?.setId === set.id);
      const seen = new Set<string>();
      for (const m of members) {
        if (seen.has(m.uid)) continue;
        const comp: Placement[] = [];
        const stack = [m.uid];
        seen.add(m.uid);
        while (stack.length) {
          const u = stack.pop()!;
          comp.push(byUid.get(u)!);
          for (const v of g.get(u) ?? []) {
            const vp = byUid.get(v);
            if (vp && !seen.has(v) && getDef(vp.defId)?.setId === set.id) {
              seen.add(v);
              stack.push(v);
            }
          }
        }
        const distinct = new Set(comp.map((p) => p.defId)).size;
        for (const tier of set.tiers) {
          if (distinct >= tier.count) {
            addStats(total, tier.stats);
            perBuilding.get(comp[0].uid)!.bonus = true;
          }
        }
      }
    }
    // Chains: BFS from each start through links of the same chain.
    const linked = new Set<string>();
    for (const start of active) {
      const sd = getDef(start.defId);
      if (!sd?.chainId || sd.chainRole !== 'start') continue;
      const stack = [start.uid];
      const seen = new Set([start.uid]);
      while (stack.length) {
        const u = stack.pop()!;
        for (const v of g.get(u) ?? []) {
          const vd = getDef(byUid.get(v)!.defId);
          if (!seen.has(v) && vd?.chainId === sd.chainId && vd.chainRole === 'link') {
            seen.add(v);
            linked.add(v);
            stack.push(v);
          }
        }
      }
    }
    for (const uid of linked) {
      const d = getDef(byUid.get(uid)!.defId)!;
      if (d.chainBonus) {
        addStats(total, d.chainBonus);
        const pb = perBuilding.get(uid)!;
        addStats(pb.stats, d.chainBonus);
        pb.bonus = true;
      }
    }
  }

  const values = categoryValues(total, settings);
  const score = weightedScore(values, ref ?? referenceFrom(values), settings.weights);
  return { stats: total, values, score, perBuilding, disconnected, unscored };
}

/** Score contribution of one building's own stats (no set/chain effects). */
export function buildingValue(def: BuildingDef, settings: Settings, ref: CategoryValues): number {
  return weightedScore(categoryValues(statsOf(def), settings), ref, settings.weights);
}
