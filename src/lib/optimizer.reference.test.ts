import { describe, expect, it } from 'vitest';
import { newDef } from './buildingDb';
import { validateCity } from './grid';
import { DEFAULT_OPTIONS, optimize } from './optimizer';
import { defaultProject, referenceCity } from './project';
import { evaluateCity, referenceFrom } from './scoring';
import type { BuildingDef, InventoryItem } from './types';
import { ROAD_2 } from './types';

// Synthetic buildings (fixtures, not game data) on the real measured city grid.
describe('optimizer on the measured city grid', () => {
  const p = defaultProject();
  const defs: BuildingDef[] = [
    p.buildings.find((b) => b.id === 'town-hall')!,
    newDef({ id: 'one', name: 'One-lane 3x3', width: 3, height: 3, road: 'road', stats: { fp: 6 }, statsStatus: 'user', dimsStatus: 'user' }),
    newDef({ id: 'two', name: 'Two-lane 4x4', width: 4, height: 4, road: 'road2', stats: { goods: 200 }, statsStatus: 'user', dimsStatus: 'user' }),
    newDef({ id: 'free', name: 'No-road 2x2', width: 2, height: 2, road: 'none', stats: { attAtk: 3, attDef: 3 }, statsStatus: 'user', dimsStatus: 'user' }),
  ];
  const inv: InventoryItem[] = [
    { key: 'one', rawName: 'one', baseName: 'one', category: 'building', quantity: 140, adjust: 0, defId: 'one' },
    { key: 'two', rawName: 'two', baseName: 'two', category: 'building', quantity: 30, adjust: 0, defId: 'two' },
    { key: 'free', rawName: 'free', baseName: 'free', category: 'building', quantity: 200, adjust: 0, defId: 'free' },
  ];
  const get = (id: string) => defs.find((d) => d.id === id);
  const city = referenceCity();
  const ref = referenceFrom(evaluateCity(city, get, p.settings, null).values, { military: 100, fp: 100, goods: 1000, other: 1 });
  const res = optimize({ city, defs, sets: [], settings: p.settings, inventory: inv, recipes: [], ref, options: { ...DEFAULT_OPTIONS, iterations: 120 } });

  it('produces valid layouts with both one- and two-lane buildings connected', () => {
    for (const c of res.candidates) expect(validateCity(c.city, get, true).issues).toEqual([]);
    const top = res.candidates[0];
    const placed = (id: string) => top.city.placements.filter((q) => q.defId === id).length;
    console.log(`best ${top.name}: score ${top.score.toFixed(1)} / bound ${res.upperBound.toFixed(1)}; one ${placed('one')}, two ${placed('two')}, free ${placed('free')}; roads ${top.roadCells} (two-lane ${top.city.roads.filter((r) => r === ROAD_2).length}); ${res.elapsedMs} ms`);
    expect(placed('two')).toBeGreaterThan(0);
    expect(placed('one')).toBeGreaterThan(20);
  });
}, 60000);
