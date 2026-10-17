import { parseCsv } from './csv';
import type { InvCategory, InventoryItem, KitType } from './types';

/** Normalizes curly quotes, dashes and spacing so names from different sources match. */
export function normalizeName(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameKey(s: string): string {
  return normalizeName(s).toLowerCase();
}

export function slug(s: string): string {
  return nameKey(s)
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function categoryOf(label: string): InvCategory | null {
  const l = label.toLowerCase();
  if (l.startsWith('selection') || l.includes('kit')) return 'kit';
  if (l.startsWith('building')) return 'building';
  if (l.startsWith('boost') || l.includes('consumable')) return 'boost';
  return null;
}

function classifyKit(name: string): Pick<InventoryItem, 'kitType' | 'tier' | 'baseName'> {
  const n = normalizeName(name);
  let kitType: KitType = 'other';
  if (/selection kit/i.test(n) || /\bkit \d+$/i.test(n)) kitType = 'selection';
  else if (/upgrade( kit)?/i.test(n)) kitType = 'upgrade';
  else if (/shrink kit/i.test(n)) kitType = 'shrink';
  else if (/chain kit/i.test(n)) kitType = 'chain';
  const tier = /\bgolden\b/i.test(n) ? 'golden' : /\bsilver\b/i.test(n) ? 'silver' : /^ascended\b/i.test(n) ? 'ascended' : null;
  const baseName = n
    .replace(/\s+(golden|silver)?\s*(selection|upgrade|shrink|chain)( kit)?(\s+\d+)?$/i, '')
    .replace(/\s+kit$/i, '')
    .trim();
  return { kitType, tier, baseName };
}

/** Splits "Harvest Barn - Lv. 4" / "Daunting Tower - Active" into base name, level and state. */
export function parseBuildingName(name: string): { baseName: string; level: number | null; active: boolean } {
  const n = normalizeName(name);
  const lv = n.match(/^(.*?)\s*-\s*Lv\.?\s*(\d+)$/i);
  if (lv) return { baseName: lv[1].trim(), level: Number(lv[2]), active: false };
  const act = n.match(/^(.*?)\s*-\s*Active$/i);
  if (act) return { baseName: act[1].trim(), level: null, active: true };
  return { baseName: n, level: null, active: false };
}

export interface ParsedInventory {
  items: InventoryItem[];
  /** Totals reported by the sheet itself ("Kit total", "Grand Total Items", ...). */
  reported: Record<string, number>;
  warnings: string[];
}

/**
 * Parses the "Combined Storage Inventory" export. The sheet mixes two row shapes:
 *   Category, Item Name, Quantity            (kits, buildings)
 *   Category, Subcategory, Item Name, Qty    (boosts)
 * plus "... Total" and "Summary" rows that are recorded but not imported as items.
 */
export function parseInventoryCsv(text: string): ParsedInventory {
  const rows = parseCsv(text);
  const byKey = new Map<string, InventoryItem>();
  const reported: Record<string, number> = {};
  const warnings: string[] = [];

  rows.forEach((raw, idx) => {
    const r = raw.map((c) => c.trim());
    if (r.every((c) => c === '')) return;
    if (idx === 0 && /category/i.test(r[0]) && /name/i.test(r[1] ?? '')) return;

    if (/^summary$/i.test(r[0])) {
      const v = Number(r[2]);
      if (r[1] && Number.isFinite(v)) reported[r[1]] = v;
      return;
    }
    if (/total$/i.test(r[0]) || /total$/i.test(r[1] ?? '')) {
      const v = Number(r[3] || r[2]);
      if (Number.isFinite(v)) reported[r[0].replace(/\s*total$/i, '') || r[1]] = v;
      return;
    }

    const category = categoryOf(r[0]);
    if (!category) {
      warnings.push(`Row ${idx + 1}: unrecognized category "${r[0]}"`);
      return;
    }
    // Four-column shape: numeric qty in column 4 and column 3 is not a number.
    let subcategory: string | undefined;
    let name: string;
    let qty: number;
    if (r[3] !== undefined && r[3] !== '' && Number.isFinite(Number(r[3])) && !Number.isFinite(Number(r[2]))) {
      subcategory = r[1];
      name = r[2];
      qty = Number(r[3]);
    } else {
      name = r[1];
      qty = Number(r[2]);
    }
    if (!name) return;
    if (!Number.isFinite(qty)) {
      warnings.push(`Row ${idx + 1}: "${name}" has a non-numeric quantity "${r[2]}"`);
      return;
    }

    const key = nameKey(name);
    const existing = byKey.get(key);
    if (existing) {
      // The same item listed twice: add quantities instead of double-creating it.
      existing.quantity += qty;
      warnings.push(`Row ${idx + 1}: duplicate "${name}" merged`);
      return;
    }
    const item: InventoryItem = {
      key,
      rawName: name,
      category,
      subcategory,
      baseName: normalizeName(name),
      quantity: qty,
      adjust: 0,
    };
    if (category === 'kit') Object.assign(item, classifyKit(name));
    if (category === 'building') {
      const p = parseBuildingName(name);
      item.baseName = p.baseName;
      item.level = p.level;
      item.active = p.active;
    }
    byKey.set(key, item);
  });

  return { items: [...byKey.values()], reported, warnings };
}

export function effectiveQty(i: InventoryItem): number {
  return Math.max(0, i.quantity + i.adjust);
}

/**
 * Merges a fresh import into the existing inventory, keeping manual adjustments, notes and
 * building mappings. Items no longer in the sheet are kept at quantity 0 so mappings survive.
 */
export function mergeInventory(old: InventoryItem[], fresh: InventoryItem[]): InventoryItem[] {
  const prev = new Map(old.map((i) => [i.key, i]));
  const out = fresh.map((f) => {
    const p = prev.get(f.key);
    return p ? { ...f, adjust: p.adjust, notes: p.notes, defId: p.defId ?? f.defId } : f;
  });
  const freshKeys = new Set(fresh.map((f) => f.key));
  for (const p of old) if (!freshKeys.has(p.key)) out.push({ ...p, quantity: 0 });
  return out;
}

export function inventoryTotals(items: InventoryItem[]) {
  const t = { kit: 0, building: 0, boost: 0, other: 0, distinct: items.length, total: 0 };
  for (const i of items) {
    t[i.category] += i.quantity;
    t.total += i.quantity;
  }
  return t;
}

export function sheetCsvUrl(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv`;
}

export function extractSheetId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : input.trim();
}
