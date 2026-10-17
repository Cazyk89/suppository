import { describe, expect, it } from 'vitest';
import { validateCity } from './grid';
import { DEFAULT_OPTIONS, optimize } from './optimizer';
import { evaluateCity, referenceFrom } from './scoring';
import { fixtureCity, fixtureDefs, settings } from './testUtil';
import type { InventoryItem, Recipe } from './types';
import { ROAD_1 } from './types';

const inv = (key: string, defId: string | undefined, quantity: number, category: InventoryItem['category'] = 'building'): InventoryItem => ({
  key, rawName: key, baseName: key, category, quantity, adjust: 0, defId,
});

function run(extra: Partial<typeof DEFAULT_OPTIONS> = {}, inventory: InventoryItem[] = [], recipes: Recipe[] = []) {
  const defs = fixtureDefs();
  const city = fixtureCity();
  for (let x = 0; x <= 5; x++) city.roads[7 * city.width + x] = ROAD_1;
  city.placements.push({ uid: 'base-fp', defId: 'fp', x: 0, y: 8, rot: 0, locked: false, origin: 'baseline' });
  const get = (id: string) => defs.find((d) => d.id === id);
  const ref = referenceFrom(evaluateCity(city, get, settings, null).values);
  const res = optimize({
    city, defs, sets: [], settings, inventory, recipes, ref,
    options: { ...DEFAULT_OPTIONS, iterations: 60, ...extra },
  });
  return { res, get };
}

describe('optimizer', () => {
  it('produces valid layouts that never score below the current city', () => {
    const { res, get } = run({}, [inv('fp-item', 'fp', 6), inv('mil-item', 'mil', 4)]);
    expect(res.candidates.length).toBeGreaterThan(0);
    for (const c of res.candidates) {
      const v = validateCity(c.city, get, true);
      expect(v.issues).toEqual([]);
      expect(c.score).toBeGreaterThanOrEqual(res.baseline.score - 1e-9);
      expect(c.score).toBeLessThanOrEqual(res.upperBound + 1e-6);
    }
    expect(res.candidates[0].score).toBeGreaterThan(res.baseline.score);
  });

  it('never uses more stored buildings than exist', () => {
    const { res } = run({}, [inv('fp-item', 'fp', 2)]);
    for (const c of res.candidates) {
      expect(c.city.placements.filter((p) => p.origin === 'inventory').length).toBeLessThanOrEqual(2);
      const used = c.kitsUsed.find((k) => k.key === 'fp-item')?.qty ?? 0;
      expect(used).toBeLessThanOrEqual(2);
    }
  });

  it('skips buildings with unknown size and reports them', () => {
    const { res } = run({}, [inv('m', 'mystery', 3)]);
    expect(res.excluded).toEqual([{ defId: 'mystery', count: 3, reason: 'size unknown' }]);
  });

  it('keeps every building in fill mode', () => {
    const { res } = run({ mode: 'fill' }, [inv('deco-item', 'deco', 5)]);
    const top = res.candidates[0];
    const base = top.city.placements.find((p) => p.uid === 'base-fp')!;
    expect([base.x, base.y]).toEqual([0, 8]);
  });

  it('only applies recipes when inputs exist, and counts kits used', () => {
    const recipe: Recipe = { id: 'r1', name: 'kit→mil', inputs: [{ key: 'kit', qty: 1 }], outputDefId: 'mil', enabled: true };
    const { res } = run({}, [inv('kit', undefined, 2, 'kit')], [recipe]);
    const top = res.candidates[0];
    const made = top.city.placements.filter((p) => p.origin === 'recipe').length;
    expect(made).toBeLessThanOrEqual(2);
    expect(top.kitsUsed.find((k) => k.key === 'kit')?.qty ?? 0).toBe(made);
  });
});
