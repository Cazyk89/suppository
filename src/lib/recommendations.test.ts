import { describe, expect, it } from 'vitest';
import { cloneCity } from './grid';
import { inventoryShortfalls, rebuildPlan, recommend } from './recommendations';
import { referenceFrom } from './scoring';
import { fixtureCity, fixtureDefs, settings } from './testUtil';
import type { InventoryItem, Recipe } from './types';

const item = (key: string, quantity: number, category: InventoryItem['category'] = 'building'): InventoryItem => ({ key, rawName: key, baseName: key, category, quantity, adjust: 0 });

describe('recommendations', () => {
  const defs = fixtureDefs();
  const get = (id: string) => defs.find((d) => d.id === id);
  const base = fixtureCity();
  base.placements.push({ uid: 'old', defId: 'deco', x: 0, y: 0, rot: 0, locked: false, origin: 'baseline' });
  base.placements.push({ uid: 'stay', defId: 'mil', x: 10, y: 0, rot: 0, locked: false, origin: 'baseline' });
  const next = cloneCity(base);
  next.placements = next.placements.filter((p) => p.uid !== 'old');
  next.placements.find((p) => p.uid === 'stay')!.x = 12;
  next.placements.push({ uid: 'new', defId: 'mil', x: 0, y: 12, rot: 0, locked: false, origin: 'inventory', sourceRef: 'mil-item' });
  next.placements.push({ uid: 'kit', defId: 'mil', x: 4, y: 12, rot: 0, locked: false, origin: 'recipe', sourceRef: 'r1' });
  const recipes: Recipe[] = [{ id: 'r1', name: 'kit', inputs: [{ key: 'kit', qty: 2 }], outputDefId: 'mil', enabled: true }];
  const ref = referenceFrom({ military: 10, fp: 10, goods: 10, other: 10 });

  it('classifies keep/move/store/place/construct with reasons', () => {
    const recs = recommend(base, next, get, settings, ref, [item('mil-item', 1), item('kit', 2, 'kit'), item('store building', 3, 'boost')], recipes);
    const by = (uid: string) => recs.find((r) => r.uid === uid)!;
    expect(by('old').action).toBe('store');
    expect(by('old').reversible).toContain('3 Store Building');
    expect(by('stay').action).toBe('move');
    expect(by('new').action).toBe('place');
    expect(by('kit').action).toBe('construct');
    expect(by('kit').items).toContain('2 × kit');
    expect(by('th1').action).toBe('keep');
    const steps = rebuildPlan(base, next, recs, get);
    expect(steps[0].title).toBe('Back up first');
    expect(steps.some((s) => s.title.startsWith('Store 1 building'))).toBe(true);
  });

  it('reports inventory shortfalls when the plan needs more than is stored', () => {
    expect(inventoryShortfalls(base, next, [item('mil-item', 1), item('kit', 2, 'kit')], recipes)).toEqual([]);
    expect(inventoryShortfalls(base, next, [item('mil-item', 0), item('kit', 1, 'kit')], recipes)).toEqual([
      { key: 'mil-item', name: 'mil-item', needed: 1, available: 0 },
      { key: 'kit', name: 'kit', needed: 2, available: 1 },
    ]);
  });
});
