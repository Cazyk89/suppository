import { describe, expect, it } from 'vitest';
import { REFERENCE_ROWS, REFERENCE_TOWN_HALL } from '../data/cityReference';
import { countCells, validateCity } from './grid';
import { defaultProject, referenceCity } from './project';

describe('reference city from the screenshot', () => {
  it('has whole 4×4 expansions and 2,320 buildable tiles', () => {
    const c = referenceCity();
    expect(c.width).toBe(36);
    expect(c.height).toBe(68);
    expect(countCells(c).buildable).toBe(2320);
    expect(countCells(c).buildable % 16).toBe(0);
    // Each 4×4 block (aligned to the grid origin) is all-or-nothing.
    for (let by = 0; by < c.height; by += 4)
      for (let bx = 0; bx < c.width; bx += 4) {
        const block = REFERENCE_ROWS.slice(by, by + 4).map((r) => r.slice(bx, bx + 4)).join('');
        expect(['################', '................']).toContain(block);
      }
  });

  it('places the Town Hall on buildable land without layout issues', () => {
    const p = defaultProject();
    const get = (id: string) => p.buildings.find((b) => b.id === id);
    expect(get('town-hall')).toMatchObject({ width: REFERENCE_TOWN_HALL.width, height: REFERENCE_TOWN_HALL.height, dimsStatus: 'user' });
    expect(validateCity(p.city, get, true).issues).toEqual([]);
  });
});
