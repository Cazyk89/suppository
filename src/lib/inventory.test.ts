import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inventoryTotals, mergeInventory, parseBuildingName, parseInventoryCsv } from './inventory';

const csv = readFileSync(new URL('../data/inventory-snapshot.csv', import.meta.url), 'utf8');

describe('inventory import', () => {
  const parsed = parseInventoryCsv(csv);

  it('matches the totals the spreadsheet reports', () => {
    const t = inventoryTotals(parsed.items);
    expect(t.kit).toBe(278);
    expect(t.building).toBe(231);
    expect(t.boost).toBe(790);
    expect(t.total).toBe(1299);
    expect(t.distinct).toBe(276);
    expect(parsed.reported['Grand Total Items']).toBe(1299);
    expect(parsed.reported['Distinct Item Names']).toBe(276);
    expect(parsed.warnings).toEqual([]);
  });

  it('classifies kits', () => {
    const by = (n: string) => parsed.items.find((i) => i.rawName === n)!;
    expect(by('Camelot Selection Kit').kitType).toBe('selection');
    expect(by('Camelot Selection Kit').baseName).toBe('Camelot');
    expect(by('Grand Bridge Upgrade').kitType).toBe('upgrade');
    expect(by('Rogue Hideout Shrink Kit').kitType).toBe('shrink');
    expect(by('Feathered Serpent Statue Chain Kit').kitType).toBe('chain');
    expect(by('Gothic Tower Golden Selection Kit').tier).toBe('golden');
    expect(by('QI 2026 Middle Ages Epic Selection Kit 3').kitType).toBe('selection');
    expect(by('Self-Aid Kit').category).toBe('boost');
  });

  it('parses building levels and states', () => {
    expect(parseBuildingName('Harvest Barn - Lv. 4')).toEqual({ baseName: 'Harvest Barn', level: 4, active: false });
    expect(parseBuildingName('Berserkers Aim - Lv.1')).toEqual({ baseName: 'Berserkers Aim', level: 1, active: false });
    expect(parseBuildingName('Daunting Tower - Active')).toEqual({ baseName: 'Daunting Tower', level: null, active: true });
  });

  it('keeps manual adjustments and mappings on refresh', () => {
    const old = parsed.items.map((i) => (i.rawName === 'Aviary' ? { ...i, adjust: -1, defId: 'aviary' } : i));
    const fresh = parseInventoryCsv(csv.replace('Aviary,4', 'Aviary,6')).items;
    const merged = mergeInventory(old, fresh);
    const a = merged.find((i) => i.rawName === 'Aviary')!;
    expect(a.quantity).toBe(6);
    expect(a.adjust).toBe(-1);
    expect(a.defId).toBe('aviary');
  });

  it('merges duplicate rows instead of double counting', () => {
    const p = parseInventoryCsv('Category,Item Name,Quantity\nBuildings & Other Items,Aviary,2\nBuildings & Other Items,Aviary,3\n');
    expect(p.items).toHaveLength(1);
    expect(p.items[0].quantity).toBe(5);
  });
});
