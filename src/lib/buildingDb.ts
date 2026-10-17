import { effectiveQty, slug } from './inventory';
import type { BuildingDef, InventoryItem, Stats, VerifyStatus } from './types';

/**
 * Great Building names (identity only). Dimensions, levels and bonuses are intentionally left
 * unknown: they must be entered from the player's own game or a verified source.
 */
export const GREAT_BUILDING_NAMES = [
  'Alcatraz', 'Arctic Orangery', 'Atlantis Museum', 'Atomium', 'Blue Galaxy', 'Cape Canaveral',
  'Capitol', 'Castel del Monte', 'Cathedral of Aachen', 'Chateau Frontenac', 'Colosseum',
  'Deal Castle', 'Dynamic Tower', 'Flying Island', 'Frauenkirche of Dresden', 'Gaea Statue',
  'Galata Tower', 'Hagia Sophia', 'Himeji Castle', 'Innovation Tower', 'Kraken',
  'Lighthouse of Alexandria', 'Lotus Temple', 'Notre Dame', 'Observatory', 'Oracle of Delphi',
  'Primeval Exhibition', 'Rain Forest Project', 'Royal Albert Hall', 'Saint Basil’s Cathedral',
  'Saint Mark’s Basilica', 'Seed Vault', 'Space Carrier', 'Space Needle', 'Star Gazer',
  'Statue of Zeus', 'Temple of Relics', 'Terracotta Army', 'The Arc', 'The Habitat',
  'The Virgo Project', 'Tower of Babel', 'Truce Tower', 'Voyager V1',
];

export function emptyStats(): Stats {
  return { attAtk: 0, attDef: 0, gbgAtk: 0, gbgDef: 0, geAtk: 0, geDef: 0, qiAtk: 0, qiDef: 0, defAtk: 0, defDef: 0, fp: 0, goods: 0, guildGoods: 0, other: 0 };
}

export function statsOf(def: BuildingDef): Stats {
  return { ...emptyStats(), ...def.stats };
}

export function hasDims(def: BuildingDef | undefined): def is BuildingDef & { width: number; height: number } {
  return !!def && typeof def.width === 'number' && typeof def.height === 'number' && def.width > 0 && def.height > 0;
}

export function defIdFor(baseName: string, level?: number | null, active?: boolean): string {
  return slug(baseName) + (level ? `-lv${level}` : '') + (active ? '-active' : '');
}

export function newDef(partial: Partial<BuildingDef> & { name: string }): BuildingDef {
  return {
    id: partial.id ?? slug(partial.name),
    kind: 'special',
    width: null,
    height: null,
    road: 'unknown',
    rotatable: false,
    stats: {},
    statsStatus: 'unknown',
    dimsStatus: 'unknown',
    ...partial,
  };
}

/** Initial database: Town Hall, Great Building names, and one entry per stored building. */
export function seedBuildings(inventory: InventoryItem[]): BuildingDef[] {
  const defs = new Map<string, BuildingDef>();
  defs.set('town-hall', newDef({ id: 'town-hall', name: 'Town Hall', kind: 'townhall', protected: true, road: 'none' }));
  for (const gb of GREAT_BUILDING_NAMES) {
    const id = 'gb-' + slug(gb);
    defs.set(id, newDef({ id, name: gb, kind: 'greatbuilding', protected: true }));
  }
  linkInventoryToDefs(inventory, defs);
  return [...defs.values()];
}

/** Creates (or reuses) a building definition for each stored building and records the mapping. */
export function linkInventoryToDefs(inventory: InventoryItem[], defs: Map<string, BuildingDef>): void {
  for (const item of inventory) {
    if (item.category !== 'building') continue;
    const id = item.defId ?? defIdFor(item.baseName, item.level, item.active);
    if (!defs.has(id)) {
      defs.set(
        id,
        newDef({
          id,
          name: item.baseName,
          level: item.level ?? null,
          variant: item.active ? 'Active' : undefined,
          notes: `Created from inventory item "${item.rawName}".`,
        }),
      );
    }
    item.defId = id;
  }
}

export function statusLabel(s: VerifyStatus): string {
  return s === 'verified' ? 'Verified' : s === 'user' ? 'User-entered' : 'Unknown';
}

export function displayName(def: BuildingDef | undefined): string {
  if (!def) return 'Unknown building';
  return def.name + (def.level ? ` (Lv. ${def.level})` : '') + (def.variant ? ` – ${def.variant}` : '');
}

/** How many of each building definition are available in storage. */
export function inventoryBuildingCounts(inventory: InventoryItem[]): Map<string, { qty: number; key: string }[]> {
  const m = new Map<string, { qty: number; key: string }[]>();
  for (const i of inventory) {
    if (i.category !== 'building' || !i.defId) continue;
    const q = effectiveQty(i);
    if (q <= 0) continue;
    const list = m.get(i.defId) ?? [];
    list.push({ qty: q, key: i.key });
    m.set(i.defId, list);
  }
  return m;
}
