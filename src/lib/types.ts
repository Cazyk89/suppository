// Core data model. Every statistic that comes from the game carries a verification status so the
// UI and optimizer can tell user-entered or verified numbers apart from unknowns. Nothing here is
// pre-filled with guessed game data.

export type VerifyStatus = 'unknown' | 'user' | 'verified';

/** Additive bonuses / daily outputs for one building. Percentages are in percentage points. */
export interface Stats {
  /** Attacking army attack / defense that apply in every mode except QI (see ModeRules). */
  attAtk: number;
  attDef: number;
  /** Mode-specific attacking army bonuses. */
  gbgAtk: number;
  gbgDef: number;
  geAtk: number;
  geDef: number;
  qiAtk: number;
  qiDef: number;
  /** Defending army (city defense, relevant to PvP neighborhood). */
  defAtk: number;
  defDef: number;
  /** Forge Points per day. */
  fp: number;
  /** Goods per day (all eras combined, era-equivalent units). */
  goods: number;
  /** Guild goods per day. */
  guildGoods: number;
  /** Free-form value points for coins, supplies, units, fragments and other benefits. */
  other: number;
}

export const STAT_KEYS: (keyof Stats)[] = [
  'attAtk', 'attDef', 'gbgAtk', 'gbgDef', 'geAtk', 'geDef', 'qiAtk', 'qiDef',
  'defAtk', 'defDef', 'fp', 'goods', 'guildGoods', 'other',
];

export const STAT_LABELS: Record<keyof Stats, string> = {
  attAtk: 'Attacking attack %',
  attDef: 'Attacking defense %',
  gbgAtk: 'GbG attack %',
  gbgDef: 'GbG defense %',
  geAtk: 'GE attack %',
  geDef: 'GE defense %',
  qiAtk: 'QI attack %',
  qiDef: 'QI defense %',
  defAtk: 'Defending attack %',
  defDef: 'Defending defense %',
  fp: 'Forge Points / day',
  goods: 'Goods / day',
  guildGoods: 'Guild goods / day',
  other: 'Other value pts',
};

export type RoadReq = 'none' | 'road' | 'road2' | 'unknown';

export type BuildingKind =
  | 'townhall'
  | 'greatbuilding'
  | 'special'
  | 'residential'
  | 'production'
  | 'goods'
  | 'military'
  | 'cultural'
  | 'decoration'
  | 'other';

export interface BuildingDef {
  id: string;
  name: string;
  variant?: string;
  era?: string;
  level?: number | null;
  kind: BuildingKind;
  width: number | null;
  height: number | null;
  road: RoadReq;
  /** Whether the game allows rotating this footprint. Unknown is treated as "no". */
  rotatable: boolean;
  stats: Partial<Stats>;
  statsStatus: VerifyStatus;
  dimsStatus: VerifyStatus;
  source?: string;
  notes?: string;
  /** Set membership: adjacent (edge-touching) members of the same set unlock SetDef bonuses. */
  setId?: string;
  /** Chain membership. Links only receive `chainBonus` when touching a connected chain. */
  chainId?: string;
  chainRole?: 'start' | 'link';
  chainBonus?: Partial<Stats>;
  /** Never move/store this building (Great Buildings and Town Hall default to protected). */
  protected?: boolean;
}

export interface SetDef {
  id: string;
  name: string;
  /** Bonus granted when `count` distinct members are adjacent in one group. Cumulative tiers. */
  tiers: { count: number; stats: Partial<Stats> }[];
}

export type InvCategory = 'kit' | 'building' | 'boost' | 'other';
export type KitType = 'selection' | 'upgrade' | 'shrink' | 'chain' | 'other';

export interface InventoryItem {
  /** Stable key: normalized raw name. */
  key: string;
  rawName: string;
  category: InvCategory;
  subcategory?: string;
  kitType?: KitType;
  tier?: 'silver' | 'golden' | 'ascended' | null;
  baseName: string;
  level?: number | null;
  active?: boolean;
  /** Quantity from the last spreadsheet import. */
  quantity: number;
  /** Manual adjustment applied on top of the imported quantity. */
  adjust: number;
  /** Building database entry this item places directly (buildings only). */
  defId?: string;
  notes?: string;
}

/**
 * A user-defined conversion: consume inventory items, produce a building. Selection kits and
 * upgrade kits are never assumed to produce anything until a recipe says so.
 */
export interface Recipe {
  id: string;
  name: string;
  inputs: { key: string; qty: number }[];
  /** Placed building consumed by the recipe (e.g. an upgrade kit applied to a placed building). */
  consumesDefId?: string;
  outputDefId: string;
  enabled: boolean;
  notes?: string;
}

export const TERRAIN_UNKNOWN = 0;
export const TERRAIN_BUILDABLE = 1;
export const TERRAIN_BLOCKED = 2;

export const ROAD_NONE = 0;
export const ROAD_1 = 1;
export const ROAD_2 = 2;

export type PlacementOrigin = 'baseline' | 'inventory' | 'recipe' | 'manual';

export interface Placement {
  uid: string;
  defId: string;
  x: number;
  y: number;
  /** 1 = rotated 90° (width and height swapped). */
  rot: 0 | 1;
  locked: boolean;
  origin: PlacementOrigin;
  /** Inventory key or recipe id the building came from (for the rebuilding plan). */
  sourceRef?: string;
  /** Stored building consumed by the recipe that produced this placement. */
  consumedRef?: string;
}

export interface CityState {
  width: number;
  height: number;
  terrain: number[];
  roads: number[];
  placements: Placement[];
}

export interface Weights {
  military: number;
  fp: number;
  goods: number;
  other: number;
}

export interface ModeWeights {
  gbg: number;
  ge: number;
  qi: number;
  pvp: number;
  cityDefense: number;
}

export interface ModeRules {
  /** If false (default), QI military only counts QI-specific bonuses. */
  qiUsesCityBoosts: boolean;
}

export interface Settings {
  era: string;
  eraVerified: boolean;
  weights: Weights;
  modeWeights: ModeWeights;
  modeRules: ModeRules;
  sheetId: string;
}

export interface Underlay {
  id: string;
  name: string;
  blobKey: string;
  visible: boolean;
  opacity: number;
  /** World-space transform (grid units before zoom). */
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface SavedLayout {
  id: string;
  name: string;
  createdAt: string;
  city: CityState;
  notes?: string;
  kind: 'baseline' | 'optimized' | 'manual';
}

export interface Project {
  version: number;
  settings: Settings;
  inventory: InventoryItem[];
  inventoryMeta: { importedAt: string | null; source: string; summary?: Record<string, number> };
  buildings: BuildingDef[];
  sets: SetDef[];
  recipes: Recipe[];
  city: CityState;
  baselineId: string | null;
  layouts: SavedLayout[];
  underlays: Underlay[];
  viewMode: 'iso' | 'top';
}
