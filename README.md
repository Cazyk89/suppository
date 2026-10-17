# Forge of Empires City Optimizer

An iPhone-first Progressive Web App that reconstructs your Forge of Empires city on a tile grid,
imports your storage inventory from Google Sheets, and generates valid, road-connected layouts that
maximize a weighted score (default **military 35% · Forge Points 30% · goods 20% · other 15%**),
then turns the best layout into a ranked, step-by-step rebuilding plan.

It never touches your game account: every change is something you carry out yourself in game.

## Status

| Area | State |
| --- | --- |
| Inventory import | **Done.** Bundled snapshot of “Forge of Empires — Combined Storage Inventory” (exported 2026-10-17): 278 kits, 231 stored buildings, 790 boosts/consumables, 276 distinct names, 1,299 items — matches the sheet's own totals (unit-tested). Live refresh from Google Sheets, CSV upload or paste; manual adjustments survive refreshes. The sheet itself is never modified. |
| City grid | **Measured.** From the stripped reconstruction-mode screenshot (2026-10-17, `public/reference/`): 2,320 buildable tiles (145 expansions) in a 36 × 68 area, snapped to 4×4 expansions, with the screenshot pre-aligned as an underlay. The Town Hall is placed at its spot with an **estimated 6 × 8** footprint (from its base plate) — confirm in game. Buildings are not placed yet (the city was stripped). |
| Building database | **Structure done, statistics not yet entered.** One entry per stored building (auto-created from the inventory), the Town Hall and Great Building names. No sizes or bonuses are bundled — every value is entered by you and tagged *unknown / user-entered / verified* with a source. |
| Optimizer | **Done.** Heuristic search, runs in a Web Worker. Validated against the same rules as the editor; reports an upper bound and never claims optimality. |
| Recommendations & plan | **Done.** Keep / move / store / place / upgrade / construct, each with reason, score change, tiles, items, reversibility and uncertainty; ordered rebuilding steps; Markdown and PNG export. |
| Era | Recorded as **Oceanic Future — unverified**. Confirm it on the Dashboard. |

## Using it

1. **Dashboard** — confirm your era. The checklist shows what data is still missing.
2. **My City**
   - A fresh install starts with the measured grid. *Grid → Load measured city + aligned screenshot* restores it with the screenshot underneath.
   - *Screenshots*: import further screenshots if needed. Adjust scale/position/rotation until the game's tile diamonds sit on the grid (isometric view).
   - Paint *Land*, *Blocked*, *Road* and *2-lane* road, or use **✦ Detect**: tap a road (or land) tile on the screenshot and similar-coloured connected tiles are marked; undo and lower the tolerance if it spills.
   - *Place* the Town Hall, Great Buildings and every other building. Unknown sizes can be typed straight into the palette.
   - Red dashed outlines = overlapping / off-land / not connected; red road tiles = not connected to the Town Hall.
   - **Save as baseline** when the city matches the game. Scores then read *100 = baseline*.
3. **Buildings** — enter width × height, road requirement and bonuses (from the in-game tooltip) for buildings in your city and the stored ones you'd consider placing. *Export CSV* → fill in a spreadsheet → *Import CSV* is the fast way. Sets, chains and kit recipes are defined here too.
   - **Kit recipes**: selection/upgrade kits are never assumed to produce anything. A recipe states “these kits (and optionally this placed/stored building) → this building”. Recipes start disabled.
4. **Optimize** — adjust weights and per-mode military emphasis (GbG / GE / QI / PvP / city defense), choose *Rearrange* or *Fill only*, and generate. Compare candidates and save one.
5. **Plan** — ranked changes and the rebuilding sequence (non-disruptive placements first, stores, then a single reconstruction-mode pass).
6. **Layouts** — saved layouts, before/after comparison, PNG export, and **JSON backup/restore** (includes screenshots).

## How the optimizer works

* Locked buildings, protected buildings (Town Hall, Great Buildings) and any placed building whose statistics are unknown stay exactly where they are. Stored buildings with unknown size, road requirement or statistics are skipped and listed.
* Road strategies: keep existing roads, plus generated “comb” networks (rows or columns every 5/7/9 tiles with a trunk beside the Town Hall; two-lane when any candidate needs it).
* For each strategy: greedy placement by value per tile into the tightest-fitting valid spot (road access required where applicable, set members pulled together), prune every road tile no building needs, refill the freed tiles.
* Seeded local search on the best strategies: remove 1–3 low-density buildings and re-pack; keep only changes that don't lower the score.
* Upper bound: fractional knapsack of all candidate buildings over all free tiles, ignoring road space (and set/chain bonuses when present). The gap to it is shown with every run.
* Military score = mode-weighted average of (attack + defense)/2, where GbG = general + GbG-specific, GE = general + GE-specific, QI = QI-specific only (toggle to include general), PvP = general, city defense = defending army.
* Categories are normalized by the baseline city (or, for a category the baseline lacks, by everything you own), so the weights compare like with like.

## Known limitations

* No automatic building recognition from screenshots — only colour-based road/land detection plus manual tracing.
* Two-lane roads are modelled per tile, not as 2×2 road pieces.
* Rotation is off unless you mark a building rotatable.
* *Expansion* tool blocks align to the grid origin; shift the grid (Grid panel) if your expansions are offset.
* Live Google Sheets refresh only works if the sheet is shared “anyone with the link can view”; otherwise download it as CSV and upload.
* All data is stored on-device (IndexedDB). Export backups regularly, especially on iOS.

## Development

```bash
npm install
npm run dev          # local dev server
npm test             # unit tests (inventory totals, grid rules, scoring, optimizer validity & scale)
npm run typecheck
npm run build        # static PWA in dist/

# End-to-end smoke test at iPhone 14 size (traces a tiny city, optimizes, renders the plan):
npm run build && npx vite preview --port 4173 &
CHROMIUM_PATH=/path/to/chromium npm run smoke
```

To use it on an iPhone, host `dist/` on any static HTTPS host (the *Deploy to GitHub Pages* workflow does this once Pages is enabled with “Source: GitHub Actions”), open it in Safari and choose **Share → Add to Home Screen**.

Code map: `src/lib` holds the pure logic (`inventory`, `grid`, `scoring`, `optimizer`, `recommendations`, `project`), `src/components` the canvas renderer/editor, `src/pages` one file per app section, `src/data/inventory-snapshot.csv` the bundled sheet export.
