import { describe, expect, it } from 'vitest';
import { hasDims } from './buildingDb';
import { effectiveQty } from './inventory';
import { validateCity } from './grid';
import { DEFAULT_OPTIONS, optimize } from './optimizer';
import { defaultProject } from './project';
import { evaluateCity, potentialValues, referenceFrom } from './scoring';

// End-to-end on the real project: measured city grid, inventory snapshot, bundled building data.
describe('optimizer on the real project data', () => {
  it('fills the measured city from storage with a valid layout', () => {
    const p = defaultProject();
    const get = (id: string) => p.buildings.find((b) => b.id === id);
    const ready = p.inventory.filter((i) => i.category === 'building' && i.defId && hasDims(get(i.defId)) && get(i.defId)!.statsStatus !== 'unknown');
    const potential = potentialValues([], ready.map((i) => ({ defId: i.defId!, qty: effectiveQty(i) })), get, p.settings);
    const ref = referenceFrom(evaluateCity(p.city, get, p.settings, null).values, potential);
    const res = optimize({ city: p.city, defs: p.buildings, sets: p.sets, settings: p.settings, inventory: p.inventory, recipes: [], ref, options: { ...DEFAULT_OPTIONS, iterations: 150 } });
    const top = res.candidates[0];
    const placedFromInv = top.city.placements.filter((q) => q.origin === 'inventory').length;
    console.log(
      `ready types ${ready.length}, stored units ${ready.reduce((a, i) => a + effectiveQty(i), 0)}; best "${top.name}" score ${top.score.toFixed(1)} (bound ${res.upperBound.toFixed(1)}), placed ${placedFromInv}, unplaced ${top.unplaced.reduce((a, u) => a + u.count, 0)}, roads ${top.roadCells}, free ${top.freeCells}, ${res.elapsedMs} ms`,
    );
    console.log('values', JSON.stringify(top.values));
    for (const c of res.candidates) expect(validateCity(c.city, get, true).issues).toEqual([]);
    expect(placedFromInv).toBeGreaterThan(50);
  }, 120000);
});
