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

// Grid: 20×20, all buildable.
await page.goto(base + '#/city');
await page.getByRole('button', { name: /^Grid / }).click();
await page.getByLabel('Width').fill('20');
await page.getByLabel('Height').fill('20');
await page.getByRole('button', { name: 'Apply' }).click();
await page.getByRole('button', { name: 'Mark all unknown as buildable' }).click();
await page.getByRole('button', { name: 'Top-down' }).click();
step('grid set to 20×20 buildable');

// Town Hall 3×3 at the centre.
await page.getByRole('button', { name: '＋ Place' }).click();
await page.getByPlaceholder('Search buildings').fill('Town Hall');
await page.getByPlaceholder('w', { exact: true }).first().fill('3');
await page.getByPlaceholder('h', { exact: true }).first().fill('3');
await page.getByRole('button', { name: 'Set' }).first().click();
await page.getByRole('button', { name: 'Place' }).last().click();
const box = await page.locator('.city-canvas canvas').boundingBox();
const cell = (x, y) => {
  // Top-down fit: grid 20×20 centred in the canvas.
  const size = Math.min(box.width - 32, box.height - 32);
  const t = size / 20;
  const ox = box.x + (box.width - size) / 2;
  const oy = box.y + (box.height - size) / 2;
  return { x: ox + (x + 0.5) * t, y: oy + (y + 0.5) * t };
};
let p = cell(9, 9);
await page.mouse.click(p.x, p.y);
await expectText('Placed Town Hall');
step('Town Hall placed');

// One road row left of the Town Hall at row 10 (x 0..7).
await page.getByRole('button', { name: '▬ Road' }).click();
p = cell(0, 10);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
for (let x = 1; x <= 7; x++) {
  const q = cell(x, 10);
  await page.mouse.move(q.x, q.y, { steps: 2 });
}
await page.mouse.up();
await expectText('road');
await shot('03-city-traced');

// Save as baseline.
await page.getByRole('button', { name: 'Save as baseline' }).click();
await expectText('Saved the current city as the baseline');
step('baseline saved');

// Enter test sizes/stats through the CSV import on the Buildings page.
await page.goto(base + '#/buildings');
const csv = [
  'id,name,width,height,road,statsStatus,fp,attAtk,attDef,goods',
  'town-hall,Town Hall,3,3,none,user,,,,',
  'aviary,Aviary,2,2,road,user,3,,,',
  'cider-garden,Cider Garden,2,3,none,user,,4,4,',
  'grilling-grove,Grilling Grove,3,3,road,user,1,2,2,30',
].join('\n');
await page.locator('input[type=file]').setInputFiles({ name: 'test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
await expectText('Imported 4 building rows');
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
