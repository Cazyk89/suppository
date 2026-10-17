import { describe, expect, it } from 'vitest';
import { newDef } from './buildingDb';
import { categoryValues, evaluateCity, militaryByMode, referenceFrom, weightedScore } from './scoring';
import { fixtureCity, fixtureDefs, settings } from './testUtil';
import { emptyStats } from './buildingDb';
import { ROAD_1 } from './types';

describe('scoring', () => {
  it('scores the reference city as 100', () => {
    const v = { military: 40, fp: 120, goods: 900, other: 50 };
    expect(weightedScore(v, referenceFrom(v), settings.weights)).toBeCloseTo(100);
  });

  it('falls back to potential when the reference city lacks a category', () => {
    const ref = referenceFrom({ military: 10, fp: 0, goods: 0, other: 0 }, { military: 50, fp: 80, goods: 0, other: 0 });
    expect(ref).toEqual({ military: 10, fp: 80, goods: 1, other: 1 });
  });

  it('keeps QI separate from general attacking bonuses unless enabled', () => {
    const s = { ...emptyStats(), attAtk: 10, qiAtk: 5 };
    expect(militaryByMode(s, { qiUsesCityBoosts: false }).qi.atk).toBe(5);
    expect(militaryByMode(s, { qiUsesCityBoosts: true }).qi.atk).toBe(15);
    expect(militaryByMode(s, { qiUsesCityBoosts: false }).gbg.atk).toBe(10);
  });

  it('gives disconnected buildings no output', () => {
    const defs = fixtureDefs();
    const get = (id: string) => defs.find((d) => d.id === id);
    const c = fixtureCity();
    c.placements.push({ uid: 'a', defId: 'fp', x: 0, y: 0, rot: 0, locked: false, origin: 'manual' });
    expect(evaluateCity(c, get, settings, null).stats.fp).toBe(0);
    for (let x = 0; x <= 5; x++) c.roads[2 * c.width + x] = ROAD_1;
    for (let y = 2; y <= 7; y++) c.roads[y * c.width + 5] = ROAD_1;
    expect(evaluateCity(c, get, settings, null).stats.fp).toBe(10);
  });

  it('applies set tiers to adjacent distinct members and chain bonuses to linked buildings', () => {
    const defs = [
      ...fixtureDefs(),
      newDef({ id: 's1', name: 'S1', width: 1, height: 1, road: 'none', setId: 'set', statsStatus: 'user', dimsStatus: 'user' }),
      newDef({ id: 's2', name: 'S2', width: 1, height: 1, road: 'none', setId: 'set', statsStatus: 'user', dimsStatus: 'user' }),
      newDef({ id: 'cs', name: 'Start', width: 1, height: 1, road: 'none', chainId: 'ch', chainRole: 'start', statsStatus: 'user', dimsStatus: 'user' }),
      newDef({ id: 'cl', name: 'Link', width: 1, height: 1, road: 'none', chainId: 'ch', chainRole: 'link', chainBonus: { fp: 7 }, statsStatus: 'user', dimsStatus: 'user' }),
    ];
    const get = (id: string) => defs.find((d) => d.id === id);
    const sets = [{ id: 'set', name: 'Set', tiers: [{ count: 2, stats: { goods: 50 } }] }];
    const c = fixtureCity();
    c.placements.push({ uid: 'a', defId: 's1', x: 0, y: 0, rot: 0, locked: false, origin: 'manual' });
    c.placements.push({ uid: 'b', defId: 's2', x: 1, y: 0, rot: 0, locked: false, origin: 'manual' });
    c.placements.push({ uid: 'c', defId: 'cs', x: 0, y: 5, rot: 0, locked: false, origin: 'manual' });
    c.placements.push({ uid: 'd', defId: 'cl', x: 1, y: 5, rot: 0, locked: false, origin: 'manual' });
    c.placements.push({ uid: 'e', defId: 'cl', x: 3, y: 5, rot: 0, locked: false, origin: 'manual' }); // not touching
    const ev = evaluateCity(c, get, settings, null, sets);
    expect(ev.stats.goods).toBe(50);
    expect(ev.stats.fp).toBe(7);
    expect(categoryValues(ev.stats, settings).goods).toBe(50);
  });
});
