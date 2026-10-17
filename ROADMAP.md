# Roadmap & To-do

Live app: https://cazyk89.github.io/suppository/ · Details of how things work: [README](README.md)

This repository is public. Personal details (Google account, sheet link, player name, world) are
never committed: the sheet link is entered in the app and stays on the device, and project data
lives in the browser's storage and in backup files you keep yourself.

## Where things stand

| Phase | Goal | Status |
| --- | --- | --- |
| 0. Foundation | Installable app, inventory import, grid editor, optimizer, plan | ✅ Done |
| 1. City grid | Real buildable outline and Town Hall | ✅ Done (2,320 tiles, Town Hall 6 × 8 verified) |
| 2. Building data | Size, road and bonuses for every building that matters | ⏳ **Next — waiting on building screenshots** |
| 3. Current layout | Re-create today's city as the baseline | ⬜ Not started |
| 4. First optimized city | Generate, check in game, rebuild | ⬜ Not started |
| 5. Better optimizer | Smarter roads, sets/chains, exact solver option | ⬜ Planned |
| 6. Quality of life | Faster data entry, iPhone polish, sync | ⬜ Planned |

## Phase 2 — Building data (next)

The optimizer only places buildings whose size, road requirement and bonuses are known. Nothing is
guessed. Values from screenshots go into `src/data/buildings.json`, which ships with the app and fills
in each device's database without overwriting anything entered by hand.

- [x] Bundled building data file with safe merge (ready for the screenshots)

- [ ] Player sends screenshots of building info panels (in-city buildings first, then stored ones)
- [ ] Enter size, road requirement and bonuses for every building currently in the city
- [ ] Enter the same for stored buildings worth considering (start with military and Forge Point ones)
- [ ] Record the source of each value and mark it *verified* once checked against the game
- [ ] Confirm era-dependent values match the current era (recorded as Oceanic Future, **unverified**)
- [ ] Enter Great Buildings with their footprints and current levels (bonuses as shown in game)
- [ ] Define set and chain groups and their bonus tiers
- [ ] Add kit recipes for the selection/upgrade kits worth using (what each kit can become)
- [ ] Decide which buildings must never move (lock / protect)

## Phase 3 — Current layout (baseline)

- [ ] Place every current building on the grid (the reconstruction screenshot has them stripped, so
      positions come from a normal city screenshot or from memory)
- [ ] Trace roads and two-lane roads
- [ ] Fix everything the validator flags (overlaps, disconnected buildings, red roads)
- [ ] Compare app totals with the in-game boost overview; correct any building stats that differ
- [ ] Save as baseline and export a backup

## Phase 4 — First optimized city

- [ ] Run the optimizer with the default weights (military 35 · Forge Points 30 · goods 20 · other 15)
- [ ] Review the top candidates and the gap to the upper bound
- [ ] Sanity-check the plan in game (sizes, road access) before moving anything
- [ ] Rebuild using the plan, then re-import inventory and update the baseline
- [ ] Note what the optimizer got wrong and feed it back into this list

## Phase 5 — Optimizer improvements

- [x] Mixed road networks: two-lane trunk with one-lane branches
- [x] Generated trunk road goes on whichever side of the Town Hall has room (it sits on the map edge)
- [ ] Model two-lane roads as 2 × 2 pieces, as the game does
- [ ] Set- and chain-aware placement (place groups together instead of only scoring them)
- [ ] Exact or near-exact solver option (CP-SAT / integer programming) for smaller areas, with a
      proven optimality gap
- [x] Move budget: limit how many existing buildings a plan may move, store or upgrade
- [x] Priority presets: Balanced (default), GbG, Expedition, Quantum Incursions, Forge Point economy
- [ ] Faster search on phones (profiling on a real iPhone)

## Phase 6 — Quality of life

- [ ] Test the installed app on an iPhone (touch gestures, safe areas, offline use, storage)
- [ ] Faster stat entry: a paste-friendly form, or reading values from info-panel screenshots
- [x] Bulk edit in the Building Database (road requirement, kind, rotatable, protected)
- [x] Warn when a saved plan needs stored items the inventory no longer has
- [ ] Optional signed-in Google Sheets refresh (today the sheet must be link-shared, or uploaded as CSV)
- [ ] Optional cloud backup (today: manual JSON export/import)
- [ ] Undo in the Building Database and Inventory pages
- [ ] Short in-app walkthrough for first use

## Known limitations

- Building recognition from screenshots is not automatic; only road/land colour detection exists.
- Rotation is off unless a building is marked rotatable.
- Statistics are whatever is entered — the app cannot read the game.

## Done

- [x] Installable iPhone web app, deployed to GitHub Pages on every push
- [x] Inventory import: 278 kits, 231 stored buildings, 790 boosts (1,299 items) — matches the sheet totals
- [x] Live sheet refresh, CSV upload/paste, manual adjustments kept across refreshes
- [x] City grid editor: isometric/top-down, screenshot underlay, painting tools, colour detection, undo
- [x] Placement validation: overlaps, terrain, road connection to the Town Hall
- [x] City outline measured from the reconstruction screenshot (2,320 tiles in 36 × 68)
- [x] Town Hall placed, 6 × 8 confirmed
- [x] Building database with verification status per value; CSV export/import
- [x] Sets, chains and kit recipes
- [x] Optimizer with road generation, pruning, local search and an upper bound
- [x] Ranked recommendations and step-by-step rebuilding plan; image and text export
- [x] Saved layouts, comparison, JSON backup/restore
- [x] Automated tests, iPhone-size end-to-end test, CI
