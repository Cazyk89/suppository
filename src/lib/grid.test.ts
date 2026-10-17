import { describe, expect, it } from 'vitest';
import { connectivity, isConnected, validateCity } from './grid';
import { fixtureCity, fixtureDefs } from './testUtil';
import { ROAD_1, ROAD_2, TERRAIN_BLOCKED } from './types';

const defs = new Map(fixtureDefs().map((d) => [d.id, d]));
const get = (id: string) => defs.get(id);

describe('grid validation', () => {
  it('detects connection through roads to the Town Hall', () => {
    const c = fixtureCity();
    // Road runs left from the Town Hall's west side at row 7.
    for (let x = 2; x <= 5; x++) c.roads[7 * c.width + x] = ROAD_1;
    c.placements.push({ uid: 'a', defId: 'fp', x: 2, y: 8, rot: 0, locked: false, origin: 'manual' });
    c.placements.push({ uid: 'b', defId: 'fp', x: 0, y: 12, rot: 0, locked: false, origin: 'manual' });
    const v = validateCity(c, get);
    expect(v.badUids.has('a')).toBe(false);
    expect(v.badUids.has('b')).toBe(true);
    expect(v.issues.find((i) => i.uid === 'b')?.type).toBe('disconnected');
  });

  it('requires two-lane roads all the way for road2 buildings', () => {
    const c = fixtureCity();
    defs.set('r2', { ...defs.get('fp')!, id: 'r2', road: 'road2' });
    c.roads[7 * c.width + 5] = ROAD_1;
    c.roads[7 * c.width + 4] = ROAD_2;
    const p = { uid: 'z', defId: 'r2', x: 3, y: 8, rot: 0 as const, locked: false, origin: 'manual' as const };
    c.placements.push(p);
    expect(isConnected(c, p, defs.get('r2'), connectivity(c, get))).toBe(false);
    c.roads[7 * c.width + 5] = ROAD_2;
    expect(isConnected(c, p, defs.get('r2'), connectivity(c, get))).toBe(true);
  });

  it('flags overlap, roads under buildings, blocked land and unknown sizes', () => {
    const c = fixtureCity();
    c.placements.push({ uid: 'm1', defId: 'mil', x: 0, y: 0, rot: 0, locked: false, origin: 'manual' });
    c.placements.push({ uid: 'm2', defId: 'mil', x: 1, y: 1, rot: 0, locked: false, origin: 'manual' });
    c.terrain[15 * c.width + 15] = TERRAIN_BLOCKED;
    c.placements.push({ uid: 'd', defId: 'deco', x: 15, y: 15, rot: 0, locked: false, origin: 'manual' });
    c.roads[0 * c.width + 10] = ROAD_1;
    c.placements.push({ uid: 'd2', defId: 'deco', x: 10, y: 0, rot: 0, locked: false, origin: 'manual' });
    c.placements.push({ uid: 'q', defId: 'mystery', x: 12, y: 12, rot: 0, locked: false, origin: 'manual' });
    const types = validateCity(c, get).issues.map((i) => i.type);
    expect(types).toContain('overlap');
    expect(types).toContain('not-buildable');
    expect(types).toContain('on-road');
    expect(types).toContain('no-dims');
    expect(validateCity(c, get).disconnectedRoads).toEqual([10]);
  });
});

describe('road pruning', () => {
  it('never removes the road tiles that anchor the network at the Town Hall', async () => {
    const { pruneRoads } = await import('./optimizer');
    const { newDef } = await import('./buildingDb');
    const { makeCity } = await import('./grid');
    const ds = [newDef({ id: 'th', name: 'TH', kind: 'townhall', width: 3, height: 3, road: 'none' }), newDef({ id: 'b', name: 'B', width: 1, height: 1, road: 'road' })];
    const g = (id: string) => ds.find((d) => d.id === id);
    const c = makeCity(12, 12, 1);
    c.placements.push({ uid: 'th', defId: 'th', x: 0, y: 0, rot: 0, locked: true, origin: 'baseline' });
    for (let x = 0; x < 12; x++) c.roads[3 * 12 + x] = ROAD_1;
    c.placements.push({ uid: 'b1', defId: 'b', x: 10, y: 4, rot: 0, locked: false, origin: 'manual' });
    expect(pruneRoads(c, g)).toBe(3); // x=11 dead end, plus x=0,1 (x=2 still touches the Town Hall)
    expect(validateCity(c, g).issues).toEqual([]);
  });
});
