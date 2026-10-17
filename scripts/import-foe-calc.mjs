// Imports building data from foe-calc.com for the buildings in the inventory snapshot.
//
// foe-calc.com computes every building's values for a chosen era inside its compiled web app.
// This script downloads that app, runs its own data function for the era (no re-implementation
// of its formulas), keeps only buildings whose names match the inventory, and writes
// src/data/buildings.json. foe-calc.com texts are licensed CC BY-SA 3.0; the data is attributed in
// each record's source.
//
// Usage: node scripts/import-foe-calc.mjs [eraIndex=15] [path/to/elm.compiled.js]
//   eraIndex follows foe-calc's numbering (15 = Oceanic Future). Without a path the app is
//   downloaded with curl (which honours the HTTPS proxy).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const age = Number(process.argv[2] ?? 15);
const source = process.argv[3]
  ? readFileSync(process.argv[3], 'utf8')
  : execFileSync('curl', ['-sSfL', '-m', '120', 'https://foe-calc.com/dist/elm.compiled.js'], { encoding: 'utf8', maxBuffer: 64 << 20 });
const today = new Date().toISOString().slice(0, 10);

// Expose the internal functions we need just before Elm's export call.
const at = source.lastIndexOf('_Platform_export(');
if (at < 0) throw new Error('Unexpected foe-calc build: export call not found');
const patched =
  source.slice(0, at) +
  'scope.__fc = {gbv: $author$project$API$BuildingValues$getBuildingValues, toList: $elm$core$Dict$toList, tagInfo: $author$project$Components$Tags$tagInfo, intToAge: $author$project$Components$WorldSettings$intToAge};\n' +
  source.slice(at);
const ctx = { console, setTimeout, clearTimeout };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(patched, ctx);
const fc = ctx.__fc;
if (!fc) throw new Error('Could not access foe-calc data functions');

const elmList = (l) => {
  const out = [];
  while (l && l.b !== undefined && l.$ !== 0) {
    out.push(l.a);
    l = l.b;
  }
  return out;
};
const eraName = fc.intToAge(age);
const all = elmList(fc.toList(fc.gbv(age))).map((t) => {
  const b = t.b;
  return { ...b, tags: elmList(b.e).map((tg) => fc.tagInfo(tg).b.trim()) };
});

// Field letters in foe-calc's compiled code, decoded from its own column/field-name tables.
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const statsOf = (b) => {
  const s = {
    attAtk: num(b.j), attDef: num(b.k), defAtk: num(b.m), defDef: num(b.l),
    gbgAtk: num(b.t), gbgDef: num(b.w), gbgDefAtk: num(b.u), gbgDefDef: num(b.q),
    geAtk: num(b.o), geDef: num(b.p), geDefAtk: num(b.v), geDefDef: num(b.r),
    qiAtk: num(b.y), qiDef: num(b.C), qiDefAtk: num(b.z), qiDefDef: num(b.A),
    fp: num(b.h),
    // Current, previous and next era goods all count as goods.
    goods: num(b.i) + num(b.s) + num(b.F),
    guildGoods: num(b.x),
    units: num(b.B), coinBoost: num(b.N), supplyBoost: num(b.J), fpBoost: num(b.aD), diamonds: num(b.bE),
  };
  for (const k of Object.keys(s)) if (!s[k]) delete s[k];
  for (const k of Object.keys(s)) s[k] = Math.round(s[k] * 1000) / 1000;
  return s;
};

const norm = (s) => s.replace(/[‘’]/g, "'").replace(/Lv\.(\d)/, 'Lv. $1').replace(/\s+/g, ' ').trim().toLowerCase();
const byName = new Map(all.map((b) => [norm(b.c), b]));

// Inventory names that foe-calc lists under a slightly different name. Production-time variants
// assume the 24-hour production.
const ALIASES = {
  aviary: 'aviary (24h)',
  rosarium: 'rosarium (24h)',
  'forgotten temple - active': 'forgotten temple',
  'tourney grounds - active': 'tourney grounds',
};

// Same id scheme as the app (src/lib/inventory.ts slug + src/lib/buildingDb.ts defIdFor).
const slug = (s) => norm(s).replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const parse = (name) => {
  const n = name.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  let m = n.match(/^(.*?)\s*-\s*Lv\.?\s*(\d+)$/i);
  if (m) return { base: m[1].trim(), level: Number(m[2]), active: false };
  m = n.match(/^(.*?)\s*-\s*Active$/i);
  if (m) return { base: m[1].trim(), level: null, active: true };
  return { base: n, level: null, active: false };
};

const csv = readFileSync(root + 'src/data/inventory-snapshot.csv', 'utf8');
const invNames = csv
  .split(/\r?\n/)
  .map((l) => l.split(','))
  .filter((r) => r[0] === 'Buildings & Other Items')
  .map((r) => r[1]);

const records = [];
const sets = new Map();
const unmatched = [];
for (const name of invNames) {
  const key = norm(name);
  const b = byName.get(ALIASES[key] ?? key);
  if (!b) {
    unmatched.push(name);
    continue;
  }
  const p = parse(name);
  const id = slug(p.base) + (p.level ? `-lv${p.level}` : '') + (p.active ? '-active' : '');
  const setTag = b.tags.find((t) => t.startsWith('Set Part'));
  const setName = setTag?.split(':')[1]?.trim();
  if (setName) sets.set(slug(setName), { id: slug(setName), name: setName, tiers: [] });
  const record = {
    id,
    name: p.base,
    ...(p.level ? { level: p.level } : {}),
    ...(p.active ? { variant: 'Active' } : {}),
    era: eraName,
    kind: b.g === 'Decoration' ? 'decoration' : 'special',
    // foe-calc lists Length (b) and Width (f); width runs along the grid's x axis.
    width: b.f,
    height: b.b,
    dimsStatus: 'verified',
    road: b.d === 0 ? 'none' : 'road',
    rotatable: false,
    stats: statsOf(b),
    statsStatus: 'verified',
    ...(setName ? { setId: slug(setName) } : {}),
    source: `foe-calc.com building data (CC BY-SA 3.0), ${eraName}, retrieved ${today}${norm(b.c) !== key ? `, listed as “${b.c}”` : ''}`,
    notes: `foe-calc tags: ${b.tags.join(', ') || 'none'}. Values are per day at full production.`,
  };
  records.push(record);
}

const out = {
  about:
    'Building data shipped with the app. Generated by scripts/import-foe-calc.mjs from foe-calc.com (texts licensed CC BY-SA 3.0; building data originates from the game Forge of Empires by InnoGames). Only buildings named in the inventory snapshot are included. Values merge into a device database without overwriting anything entered by hand.',
  era: eraName,
  generated: today,
  buildings: records.sort((a, b) => a.id.localeCompare(b.id)),
  // Set membership is known; set bonus tiers are not provided by this source and stay empty.
  sets: [...sets.values()],
  unmatched: unmatched.sort(),
};
writeFileSync(root + 'src/data/buildings.json', JSON.stringify(out, null, 2) + '\n');
console.log(`${eraName}: ${all.length} foe-calc buildings; matched ${records.length} of ${invNames.length} inventory buildings; ${unmatched.length} unmatched.`);
