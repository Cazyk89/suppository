import { describe, expect, it } from 'vitest';
import { newDef } from './buildingDb';
import { bundleProblems, bundleRev, BUNDLED_BUILDINGS, mergeBundled } from './bundled';
import type { BundledDef } from './bundled';

const bundle: BundledDef[] = [
  { id: 'aviary', name: 'Aviary', width: 2, height: 2, dimsStatus: 'verified', road: 'road', stats: { fp: 3 }, statsStatus: 'verified', source: 'test fixture' },
];

describe('bundled building data', () => {
  it('the shipped file is well-formed', () => {
    expect(bundleProblems()).toEqual([]);
    expect(Array.isArray(BUNDLED_BUILDINGS)).toBe(true);
  });

  it('fills a building the player has not touched and tags it', () => {
    const { buildings } = mergeBundled([newDef({ id: 'aviary', name: 'Aviary' })], [], bundle, []);
    expect(buildings[0]).toMatchObject({ width: 2, height: 2, road: 'road', statsStatus: 'verified', stats: { fp: 3 } });
  });

  it('adds bundled buildings that do not exist yet', () => {
    const { buildings } = mergeBundled([], [], bundle, []);
    expect(buildings[0].bundled).toBe(bundleRev(bundle[0]));
  });

  it('never overwrites values the player entered', () => {
    const mine = newDef({ id: 'aviary', name: 'Aviary', width: 3, height: 1, dimsStatus: 'user', stats: { fp: 9 }, statsStatus: 'user' });
    const { buildings } = mergeBundled([mine], [], bundle, []);
    expect(buildings[0]).toMatchObject({ width: 3, height: 1, stats: { fp: 9 }, statsStatus: 'user', road: 'road' });
  });

  it('refreshes untouched bundled copies when the bundle changes, but not edited ones', () => {
    const first = mergeBundled([], [], bundle, []).buildings;
    const updated: BundledDef[] = [{ ...bundle[0], stats: { fp: 4 } }];
    expect(mergeBundled(first, [], updated, []).buildings[0].stats).toEqual({ fp: 4 });
    const edited = first.map((b) => ({ ...b, bundled: undefined, stats: { fp: 7 } }));
    expect(mergeBundled(edited, [], updated, []).buildings[0].stats).toEqual({ fp: 7 });
  });

  it('flags bad records', () => {
    expect(bundleProblems([{ id: 'x', name: 'X', width: 2 } as BundledDef, { id: 'y', name: 'Y', statsStatus: 'verified' }])).toHaveLength(2);
  });
});
