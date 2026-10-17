// End-to-end smoke test at iPhone size: trace a small city, enter test stats, optimize, view plan.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/smoke.mjs [outDir]
// The building sizes/stats entered here are throwaway test values, not game data.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] || 'test-results';
mkdirSync(out, { recursive: true });
const base = process.env.APP_URL || 'http://localhost:4173/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const step = (s) => console.log('•', s);
const expectText = async (t) => {
  await page.getByText(t, { exact: false }).first().waitFor({ timeout: 10000 });
};

try {
await page.goto(base);
await expectText('1,299');
step('dashboard shows inventory total 1,299');
await shot('01-dashboard');

await page.goto(base + '#/inventory');
await expectText('Stored buildings');
for (const v of ['231', '278', '790']) await expectText(v);
step('inventory totals 231 / 278 / 790');
await shot('02-inventory');

// Load the city measured from the reconstruction screenshot (with aligned underlay).
await page.goto(base + '#/city');
await page.getByRole('button', { name: /^Grid / }).click();
await page.getByRole('button', { name: 'Load measured city', exact: true }).click();
await expectText('Loaded 2320 buildable tiles');
step('measured city loaded');

// A screenshot with the measured screenshot's pixel size is aligned to the grid automatically.
await page.getByRole('button', { name: /^Screenshots/ }).click();
const png = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 2576;
  c.height = 1184;
  c.getContext('2d').fillRect(0, 0, 10, 10);
  const b = await new Promise((r) => c.toBlob(r, 'image/png'));
  return Array.from(new Uint8Array(await b.arrayBuffer()));
});
await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'reconstruction.png', mimeType: 'image/png', buffer: Buffer.from(png) });
await expectText('Scale: 1.151');
await shot('03a-city-reference-iso');
step('same-size screenshot auto-aligned');

// Top-down view: draw a road down the column beside the Town Hall (x=6, y=4..60).
await page.getByRole('button', { name: 'Top-down' }).click();
await page.waitForTimeout(300);
const box = await page.locator('.city-canvas canvas').boundingBox();
const GW = 36, GH = 68;
const cell = (x, y) => {
  const t = Math.min((box.width - 32) / GW, (box.height - 32) / GH);
  const ox = box.x + (box.width - GW * t) / 2;
  const oy = box.y + (box.height - GH * t) / 2;
  return { x: ox + (x + 0.5) * t, y: oy + (y + 0.5) * t };
};
await page.getByRole('button', { name: '▬ Road' }).click();
let p = cell(6, 4);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
for (let y = 5; y <= 60; y++) {
  const q = cell(6, y);
  await page.mouse.move(q.x, q.y, { steps: 2 });
}
await page.mouse.up();
await shot('03-city-traced');

// Save as baseline.
await page.getByRole('button', { name: 'Save as baseline' }).click();
await expectText('Saved the current city as the baseline');
step('baseline saved');

// Enter test sizes/stats through the CSV import on the Buildings page.
await page.goto(base + '#/buildings');
const csv = [
  'id,name,width,height,road,statsStatus,fp,attAtk,attDef,goods',
  'aviary,Aviary,2,2,road,user,3,,,',
  'cider-garden,Cider Garden,2,3,none,user,,4,4,',
  'grilling-grove,Grilling Grove,3,3,road,user,1,2,2,30',
].join('\n');
await page.locator('input[type=file]').setInputFiles({ name: 'test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
await expectText('Imported 3 building rows');
step('test stats imported');
await shot('04-buildings');

// Bulk edit: select one stored building and set its road requirement.
await page.getByRole('button', { name: /^In inventory/ }).click();
await page.getByRole('button', { name: 'Select several…' }).click();
await page.locator('.card.list .item').first().click();
await page.getByLabel('Rotatable').selectOption('no');
await page.getByRole('button', { name: 'Apply to 1' }).click();
await expectText('Updated 1 building');
step('bulk edit applied');

await page.goto(base + '#/optimizer');
await page.getByRole('button', { name: 'GbG fighter' }).click();
await expectText('Military strength: 55');
await page.getByRole('button', { name: 'Balanced (default)' }).click();
await expectText('Military strength: 35');
await page.getByLabel('Max buildings moved/stored').fill('5');
step('presets and move budget');
await page.getByRole('button', { name: 'Generate layouts' }).click();
await expectText('Heuristic search');
step('optimizer finished');
await shot('05-optimizer');
const text = await page.locator('main').innerText();
writeFileSync(`${out}/optimizer.txt`, text);

await page.getByRole('button', { name: 'Save & view plan' }).click();
await expectText('Rebuilding plan');
await expectText('Ranked changes');
step('plan rendered');
await shot('06-plan');
await page.goto(base + '#/layouts');
await expectText('baseline');
await shot('07-layouts');

// Persistence: change settings and the city, close the page immediately, reopen, check everything.
await page.goto(base + '#/dashboard');
await page.getByLabel('Era').fill('Smoke Test Era');
await page.goto(base + '#/inventory');
await page.getByText('Refresh inventory').click();
await page.getByLabel(/Google Sheet link/).fill('https://docs.google.com/spreadsheets/d/smoke-test-sheet/edit');
await page.goto(base + '#/optimizer');
await page.getByRole('button', { name: 'Forge Point economy' }).click();
await page.goto(base + '#/city');
await page.getByRole('button', { name: '⌫ Road' }).click();
await page.waitForTimeout(200);
const roadCount = async (pg) => Number((await pg.locator('main').innerText()).match(/(\d+) road · /)?.[1]);
const before = await roadCount(page);
p = cell(6, 40);
await page.mouse.click(p.x, p.y); // erase one road tile, then close at once
await page.close({ runBeforeUnload: true });

const page2 = await ctx.newPage();
await page2.goto(base + '#/dashboard');
await page2.getByLabel('Era').waitFor();
if ((await page2.getByLabel('Era').inputValue()) !== 'Smoke Test Era') throw new Error('era not saved');
await page2.goto(base + '#/inventory');
await page2.getByText('Refresh inventory').click();
if ((await page2.getByLabel(/Google Sheet link/).inputValue()) !== 'smoke-test-sheet') throw new Error('sheet link not saved');
await page2.goto(base + '#/optimizer');
await page2.getByText('Forge Points: 60').first().waitFor({ timeout: 5000 });
await page2.goto(base + '#/city');
await page2.getByText(/ road · /).first().waitFor();
const roads = await roadCount(page2);
if (roads !== before - 1) throw new Error(`city edit not saved: expected ${before - 1} road tiles, got ${roads}`);
await page2.goto(base + '#/layouts');
await page2.getByText('baseline').first().waitFor();
step('era, sheet link, weights, city edit and layouts all survived an instant close');

} catch (e) {
  console.error('FAILED:', e.message.split('\n')[0]);
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  await browser.close();
  process.exit(1);
}
await browser.close();
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('Smoke test passed.');
