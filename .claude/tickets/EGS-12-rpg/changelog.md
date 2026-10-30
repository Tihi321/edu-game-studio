# EGS-12 changelog

## 2026-10-30 — EGS-12: the RPG quest

Outcome: the RPG quest shell plays the authored `solar-system` section and the automatic layout of every course. The world is our own Canvas 2D tile map. The bot passes the perfect, wrong and random runs, keyboard-only play and axe-core. No human has played it yet.

### Repository `edu-game-studio`, branch `EGS-12_rpg` (stacked on `EGS-11_mindmaze`)

- **`src/player/shells/rpg/`** (theme `pixel`): `index.ts` (the shell), `ui.ts`, `battle.ts`, `draw.ts`, `model.ts`, `sprites.ts`, `strings.ts`, `rpg.css`.
  - **Screens:** title, intro, areas, world, dialogue, battle, item and feedback (context `battle` or `boss`), quest-done, inventory, boss, outro and end.
  - **World:** a seeded procedural tile map drawn with Canvas 2D in the theme's colours, pixel-crisp.
  - **Movement:** arrow keys, WASD, an on-screen pad and `goto-` buttons that walk the shortest path. There is a text alternative (`surroundings`) and a quest log.
  - **Battle:** the moves are answers. Damage = 100 × the answer's score × the streak multiplier (up to ×2). When the hero faints, they wake at the inn with full HP; the quest and the foe stay, so it is never a dead end.
  - **Rewards:** scrolls of learned facts.
  - **Bosses:** an area boss per unit and a final boss that mixes every unit.
  - **Phase-6 image slots:** a tileset, sprites and portraits.
- **`src/shared/shells/{rpg,rpg-layout,rpg-map}.ts`:**
  - The section schema, the map parser, a BFS, and the automatic layout, which is always connected.
  - The `RPG_*` lint: 11 errors and 2 warnings.
  - The fallback grid type in `rpg-map.ts` was fixed; it was a typecheck error.
- **Bot driver** `scripts/bot/rpg.mjs`: the `nextGoal()`, `pathTo(id)`, `layout()` and `view()` helpers.
- **Registration:** `scripts/bot/index.mjs`, `src/player/main.ts` and `src/shared/shells/index.ts`.
- **Fixtures:**
  - The `solar-system` rpg section has 3 hand-written areas. Its frame story is a young astronomer restarting the orrery, true to the facts. It has quest givers who teach, 9 foes named after misconceptions, 3 bosses and a final boss, in EN and HR.
  - New: `tests/fixtures/courses/broken-rpg/` with `EXPECTED.md`.
- **Tests:** `tests/player-rpg-logic.test.ts`, `tests/rpg-lint.test.ts`, `tests/bot-rpg.e2e.test.ts`.
- **Docs:** `docs/player.md` "The RPG quest", `README.md`, `ROADMAP.md` (adds a Later item: the Scriptorium frame story and Pixel Studio art), `tests/fixtures/courses/README.md`.

### Deviations
- **Battles and runs:** each battle has its own run. A quest's stars are the mean first-try score over its battles.
- **Screens:** `battle`, `boss` and `outro` are explicit screens.
- **Foes and HP:** foes stand on fixed tiles. HP carries between fights: a win heals 40, and entering an area or the inn restores it fully.
- **Gate:** the gate leads to the `areas` screen.
- **Frame story:** hand-written in the fixture. Scriptorium was not used, because it was not started.
- **Test file name:** the logic test is named `player-*`, so that it is type-checked with the DOM lib.

### Verification
- **Clean worktree, this ticket's tree:**
  - `yarn typecheck`: 0 errors.
  - `yarn lint`: 0 problems.
  - `yarn test`: 56 files, 1001 tests. The first run passed 1000; the one failure was the kit test's shell list, now written per ticket and re-run.
- **Implementer's unit tests:** 28 logic tests, including connectivity over 300 seeds × 5 foe counts, and 18 lint tests.
- **Bot table, 0 console errors throughout:**

  | Course | Perfect | Wrong | Random |
  |---|---|---|---|
  | `solar-system` | 36 right: 13 battles, 21 scrolls, 0 faints | faints and wakes at the inn | seeded runs finish |
  | Auto layouts of solar, capitals, greetings | pass | pass | pass |

  - Keyboard-only runs: 742 and 645 key presses, 0 mouse clicks.
  - axe: 34 and 32 runs, 0 violations.
- **Screenshots:** `.claude/temp/screens/phase5/rpg/` (not committed).
- **Not run:**
  - the phase-6 image slots with real images;
  - reduced-motion walking in a browser;
  - a human play-through.

### Commit status
One local commit on `EGS-12_rpg`. Not pushed.
