import { newDef } from './buildingDb';
import { makeCity } from './grid';
import { DEFAULT_MODE_RULES, DEFAULT_MODE_WEIGHTS, DEFAULT_WEIGHTS } from './scoring';
import type { BuildingDef, CityState, Settings } from './types';
import { TERRAIN_BUILDABLE } from './types';

export const settings: Settings = {
  era: 'Test',
  eraVerified: false,
  weights: { ...DEFAULT_WEIGHTS },
  modeWeights: { ...DEFAULT_MODE_WEIGHTS },
  modeRules: { ...DEFAULT_MODE_RULES },
  sheetId: '',
};

/** Synthetic test buildings. These are fixtures, not game data. */
export function fixtureDefs(): BuildingDef[] {
  return [
    newDef({ id: 'th', name: 'Town Hall', kind: 'townhall', width: 3, height: 3, road: 'none', protected: true, statsStatus: 'user', dimsStatus: 'user' }),
    newDef({ id: 'fp', name: 'FP maker', width: 2, height: 2, road: 'road', stats: { fp: 10 }, statsStatus: 'user', dimsStatus: 'user' }),
    newDef({ id: 'mil', name: 'Mil', width: 3, height: 2, road: 'none', rotatable: true, stats: { attAtk: 5, attDef: 5 }, statsStatus: 'user', dimsStatus: 'user' }),
    newDef({ id: 'deco', name: 'Deco', width: 1, height: 1, road: 'none', stats: { other: 1 }, statsStatus: 'user', dimsStatus: 'user' }),
    newDef({ id: 'mystery', name: 'Mystery', width: null, height: null }),
  ];
}

export function fixtureCity(w = 16, h = 16): CityState {
  const c = makeCity(w, h, TERRAIN_BUILDABLE);
  c.placements.push({ uid: 'th1', defId: 'th', x: 6, y: 6, rot: 0, locked: true, origin: 'baseline' });
  return c;
}
