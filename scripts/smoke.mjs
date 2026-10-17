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
await page.getByRole('button', { name: 'Load measured city + aligned screenshot' }).click();
await expectText('Loaded 2320 buildable tiles');
await page.waitForTimeout(500);
await shot('03a-city-reference-iso');
step('measured city + aligned screenshot loaded');

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

await page.goto(base + '#/optimizer');
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

// Persistence: reload and check the baseline survived.
await page.reload();
await expectText('baseline');
step('project persisted across reload');

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
