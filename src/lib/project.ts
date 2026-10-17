import snapshotCsv from '../data/inventory-snapshot.csv?raw';
import { linkInventoryToDefs, seedBuildings } from './buildingDb';
import { makeCity } from './grid';
import { parseInventoryCsv } from './inventory';
import { DEFAULT_MODE_RULES, DEFAULT_MODE_WEIGHTS, DEFAULT_WEIGHTS } from './scoring';
import { blobGet, blobKeys, blobSet, blobToDataUrl, dataUrlToBlob } from './storage';
import type { BuildingDef, Project } from './types';

export const PROJECT_VERSION = 1;
export const DEFAULT_SHEET_ID = '1fUDY5p0q-RZtxTtlghbNoumyuKd2T4rQlMFiipLjtcU';
/** Date the bundled inventory snapshot was exported from the Google Sheet. */
export const SNAPSHOT_DATE = '2026-10-17';

export function defaultProject(): Project {
  const parsed = parseInventoryCsv(snapshotCsv);
  const buildings = seedBuildings(parsed.items);
  return {
    version: PROJECT_VERSION,
    settings: {
      era: 'Oceanic Future',
      eraVerified: false,
      weights: { ...DEFAULT_WEIGHTS },
      modeWeights: { ...DEFAULT_MODE_WEIGHTS },
      modeRules: { ...DEFAULT_MODE_RULES },
      sheetId: DEFAULT_SHEET_ID,
    },
    inventory: parsed.items,
    inventoryMeta: { importedAt: SNAPSHOT_DATE, source: 'Bundled snapshot of “Forge of Empires — Combined Storage Inventory”', summary: parsed.reported },
    buildings,
    sets: [],
    recipes: [],
    // City size is not yet verified: start with an all-"unknown" grid the player paints and resizes.
    city: makeCity(64, 64),
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
  out.buildings = [...defs.values()];
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
