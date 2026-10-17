import snapshotCsv from '../data/inventory-snapshot.csv?raw';
import { REFERENCE_DATE, REFERENCE_IMAGE, REFERENCE_ROWS, REFERENCE_TOWN_HALL, REFERENCE_UNDERLAY } from '../data/cityReference';
import { linkInventoryToDefs, seedBuildings } from './buildingDb';
import { makeCity } from './grid';
import { parseInventoryCsv } from './inventory';
import { DEFAULT_MODE_RULES, DEFAULT_MODE_WEIGHTS, DEFAULT_WEIGHTS } from './scoring';
import { blobGet, blobKeys, blobSet, blobToDataUrl, dataUrlToBlob } from './storage';
import type { BuildingDef, CityState, Project, Underlay } from './types';
import { TERRAIN_BLOCKED, TERRAIN_BUILDABLE } from './types';

export const PROJECT_VERSION = 1;
/** Date the bundled inventory snapshot was exported from the Google Sheet. */
export const SNAPSHOT_DATE = '2026-10-17';

/** City grid measured from the reconstruction screenshot, with the Town Hall at its estimated spot. */
export function referenceCity(): CityState {
  const height = REFERENCE_ROWS.length;
  const width = REFERENCE_ROWS[0].length;
  const c = makeCity(width, height);
  REFERENCE_ROWS.forEach((row, y) => {
    for (let x = 0; x < width; x++) c.terrain[y * width + x] = row[x] === '#' ? TERRAIN_BUILDABLE : TERRAIN_BLOCKED;
  });
  const th = REFERENCE_TOWN_HALL;
  c.placements.push({ uid: 'town-hall-1', defId: 'town-hall', x: th.x, y: th.y, rot: 0, locked: true, origin: 'baseline' });
  return c;
}

const TOWN_HALL_SOURCE = `Measured from the ${REFERENCE_DATE} reconstruction screenshot; confirmed by the player`;

/**
 * Applies the confirmed Town Hall size when it is still unknown or holds the earlier unconfirmed
 * screenshot estimate. A size the player typed in themselves is left alone.
 */
export function withReferenceTownHall(buildings: BuildingDef[]): BuildingDef[] {
  return buildings.map((b) =>
    b.id === 'town-hall' && (b.dimsStatus === 'unknown' || b.source?.startsWith('Estimated from the base plate'))
      ? { ...b, width: REFERENCE_TOWN_HALL.width, height: REFERENCE_TOWN_HALL.height, dimsStatus: 'verified', source: TOWN_HALL_SOURCE }
      : b,
  );
}

/** Stores the bundled reference screenshot and returns an underlay aligned to the reference grid. */
export async function referenceUnderlay(): Promise<Underlay> {
  const res = await fetch(REFERENCE_IMAGE);
  if (!res.ok) throw new Error(`Could not load the reference screenshot (HTTP ${res.status}).`);
  const blobKey = `reference-${REFERENCE_DATE}`;
  await blobSet(blobKey, await res.blob());
  return { id: blobKey, name: `Reconstruction screenshot ${REFERENCE_DATE}`, blobKey, visible: true, opacity: 0.6, ...REFERENCE_UNDERLAY };
}

export function defaultProject(): Project {
  const parsed = parseInventoryCsv(snapshotCsv);
  const buildings = withReferenceTownHall(seedBuildings(parsed.items));
  return {
    version: PROJECT_VERSION,
    settings: {
      era: 'Oceanic Future',
      eraVerified: false,
      weights: { ...DEFAULT_WEIGHTS },
      modeWeights: { ...DEFAULT_MODE_WEIGHTS },
      modeRules: { ...DEFAULT_MODE_RULES },
      // Entered by the player in the app and kept on the device only (the repository is public).
      sheetId: '',
    },
    inventory: parsed.items,
    inventoryMeta: { importedAt: SNAPSHOT_DATE, source: 'Bundled snapshot of “Forge of Empires — Combined Storage Inventory”', summary: parsed.reported },
    buildings,
    sets: [],
    recipes: [],
    // Buildable outline measured from the player's reconstruction screenshot (see cityReference.ts).
    city: referenceCity(),
    baselineId: null,
    layouts: [],
    underlays: [],
    viewMode: 'iso',
  };
}

/** Fills fields added in later versions and re-links inventory items to building entries. */
export function migrate(p: Project): Project {
  const d = defaultProject();
  const out: Project = { ...d, ...p, settings: { ...d.settings, ...p.settings } };
  out.settings.weights = { ...d.settings.weights, ...p.settings?.weights };
  out.settings.modeWeights = { ...d.settings.modeWeights, ...p.settings?.modeWeights };
  out.settings.modeRules = { ...d.settings.modeRules, ...p.settings?.modeRules };
  const defs = new Map<string, BuildingDef>(out.buildings.map((b) => [b.id, b]));
  linkInventoryToDefs(out.inventory, defs);
  out.buildings = withReferenceTownHall([...defs.values()]);
  out.version = PROJECT_VERSION;
  return out;
}

export interface Backup {
  app: 'foe-city-optimizer';
  exportedAt: string;
  project: Project;
  blobs: Record<string, string>;
}

export async function exportBackup(p: Project): Promise<string> {
  const blobs: Record<string, string> = {};
  for (const k of await blobKeys()) {
    const b = await blobGet(String(k));
    if (b) blobs[String(k)] = await blobToDataUrl(b);
  }
  const backup: Backup = { app: 'foe-city-optimizer', exportedAt: new Date().toISOString(), project: p, blobs };
  return JSON.stringify(backup);
}

export async function importBackup(text: string): Promise<Project> {
  const data = JSON.parse(text) as Backup;
  if (data.app !== 'foe-city-optimizer' || !data.project) throw new Error('Not a FoE City Optimizer backup file.');
  for (const [k, v] of Object.entries(data.blobs ?? {})) await blobSet(k, await dataUrlToBlob(v));
  return migrate(data.project);
}
