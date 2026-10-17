import { describe, expect, it } from 'vitest';
import { newDef } from './buildingDb';
import { makeCity, validateCity } from './grid';
import { DEFAULT_OPTIONS, optimize } from './optimizer';
import { evaluateCity, referenceFrom } from './scoring';
import { settings } from './testUtil';
import type { BuildingDef, InventoryItem } from './types';
import { ROAD_1, TERRAIN_BLOCKED, TERRAIN_BUILDABLE } from './types';

// Synthetic scale test: sizes and stats are random fixtures, not game data.
describe('optimizer at city scale', () => {
  it('handles a 64×64 city with ~250 buildings in reasonable time', () => {
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const defs: BuildingDef[] = [newDef({ id: 'th', name: 'TH', kind: 'townhall', width: 6, height: 5, road: 'none', statsStatus: 'user', dimsStatus: 'user', protected: true })];
    const inv: InventoryItem[] = [];
    for (let i = 0; i < 60; i++) {
      const w = 1 + Math.floor(rnd() * 4);
      const h = 1 + Math.floor(rnd() * 4);
      defs.push(newDef({
        id: `b${i}`, name: `B${i}`, width: w, height: h, road: rnd() < 0.3 ? 'none' : rnd() < 0.85 ? 'road' : 'road2', rotatable: rnd() < 0.5,
        stats: { fp: Math.floor(rnd() * 10), attAtk: Math.floor(rnd() * 8), attDef: Math.floor(rnd() * 8), goods: Math.floor(rnd() * 40) },
        statsStatus: 'user', dimsStatus: 'user',
      }));
      inv.push({ key: `k${i}`, rawName: `B${i}`, baseName: `B${i}`, category: 'building', quantity: 1 + Math.floor(rnd() * 6), adjust: 0, defId: `b${i}` });
    }
    const city = makeCity(64, 64, TERRAIN_BUILDABLE);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (x + y < 14 || x - y > 50) city.terrain[y * 64 + x] = TERRAIN_BLOCKED;
    city.placements.push({ uid: 'th', defId: 'th', x: 30, y: 30, rot: 0, locked: true, origin: 'baseline' });
    for (let x = 10; x < 60; x++) city.roads[29 * 64 + x] = ROAD_1;
    const get = (id: string) => defs.find((d) => d.id === id);
    const ref = referenceFrom(evaluateCity(city, get, settings, null).values);
    const t0 = Date.now();
    const res = optimize({ city, defs, sets: [], settings, inventory: inv, recipes: [], ref, options: { ...DEFAULT_OPTIONS, iterations: 200 } });
    const ms = Date.now() - t0;
    console.log(`perf: ${ms} ms, best ${res.candidates[0].score.toFixed(1)}, bound ${res.upperBound.toFixed(1)}, placed ${res.candidates[0].placed}, roads ${res.candidates[0].roadCells}`);
    for (const c of res.candidates) expect(validateCity(c.city, get, true).issues).toEqual([]);
    expect(ms).toBeLessThan(60000);
  }, 120000);
});
