# EGS-12: the RPG quest

Hub plan HUB-19 phase 5, third shell. Branch `EGS-12_rpg`, stacked on `EGS-11_mindmaze`. One commit (orchestrator). Built in parallel with the other shells in one checkout against `../EGS-10-encyclopedia/shell-contract.md` and `docs/player.md`, "Shells".

Theme `pixel` (pixel quest: night blue, gold, grass green, Pixelify Sans, stepped borders, `steps()` motion, `image-rendering: pixelated`). Inspired by Pokémon / JRPG battles. The frame story comes from the course (the narrative designer and Scriptorium write it later; fixtures hand-write it). Art is procedural until phase 6 (Pixel Studio tiles and sprites replace it: leave an asset slot for a tileset and for sprites, used when the section names them).

## Screens (`getState().screen`)

- `title` (kit), with the frame story's opening line and a pixel banner.
- `intro`: the frame story (a few lines, `story-next`, `story-skip`).
- `world`: a tile map drawn in Canvas 2D (procedural tiles from a seeded generator: grass, path, water, trees, walls, a gate; colours from the theme's CSS variables; crisp at every scale). The hero moves with the arrow keys / WASD and the on-screen pad (`move-up`, `move-down`, `move-left`, `move-right`); a `targets` list of buttons (`goto-<npcId>`, `goto-boss`, `goto-gate`) walks the hero there (shortest path, animated step by step unless reduced motion); `talk` when next to someone. The canvas has a text alternative: where you are and what is near (`surroundings`, `aria-live` polite). HUD: hero HP, area name (h1), quest log (`quest-log`), `inventory`, `to-areas`.
- `dialogue`: an NPC's lines (portrait slot, name, text, `dialogue-next`); the quest giver offers the quest (`accept-quest`).
- `battle`: a turn battle where the moves ARE answers: each turn asks a question (`ask`, context `battle`, the hud is the battle scene: the foe sprite and HP bar, the hero and HP bar, the streak). Right: the hero strikes, damage = base x the answer's score (partial credit counts) x (1 + 0.25 x the streak, up to x2), so correctness, combo and streak matter. Wrong: the foe strikes back (`feedback-effect` says how much). The foe falls at 0 HP. The hero at 0 HP faints and wakes at the inn with full HP; the quest stays, the foe's HP resets; never a dead end.
- `areas`: one area per unit (`area-<mapId>`, locked until the units it requires are mastered, stars).
- `inventory`: the facts learned (each right answer in battle adds the item's did-you-know, or its explanation, as a scroll: `scroll-<itemId>`; "an inventory of learned facts").
- `quest-done`: the unit's stars (first-try accuracy of the quest's battles), the gate it opens (2+ stars), `replay-quest` otherwise.
- `boss` battles are battles with a bigger foe; the last area's final boss mixes every unit (boss run); after it, the frame story's closing lines, then `end`.

## Quests per unit

A quest: talk to the giver, fight the battles (foes in the area: wandering or standing at fixed tiles), then the area boss (questions from the whole unit). The quest's run is one `session.startRun` over the unit's items (or the section's battle items); its first-try accuracy gives the stars.

## Course section `shells.config.rpg` (optional; automatic layout when missing)

```jsonc
{
  "hero": { "name": "rpg.hero" },
  "story": { "intro": ["rpg.story.1", "rpg.story.2"], "outro": ["rpg.story.end"] },
  "tileset": "rpg-tiles",            // optional image asset (phase 6); procedural tiles without it
  "areas": [{ "id": "a-sun", "unit": "u-sun-planets", "name": "rpg.a.sun",
    "map": ["##########", "#..T...~~#", "#..@..N..#", "#........G", "##########"],   // # wall, . floor, T tree, ~ water, @ start, N npc spot, B boss, G gate
    "npcs": [{ "id": "n-sage", "name": "rpg.n.sage", "at": [5, 2], "lines": ["rpg.n.sage.1", "rpg.n.sage.2"], "quest": true }],
    "foes": [{ "id": "f-flare", "name": "rpg.f.flare", "at": [7, 1], "hp": 200, "items": ["q-sun-tf", "q-sun-cloze"] }],
    "boss": { "id": "b-corona", "name": "rpg.b.corona", "at": [8, 3], "hp": 400 } }],
  "finalBoss": { "name": "rpg.final", "hp": 800, "size": 10 }
}
```

Automatic layout: an area per unit with a seeded procedural map (a walled field, a path, water and trees, always connected), a sage per unit as quest giver, a foe per objective, a boss; generic lines from the shell's strings.

## Lint codes (`RPG_`)

`RPG_AREA_UNIT_MISSING`, `RPG_UNIT_NO_AREA`, `RPG_MAP_RAGGED` (rows of different width), `RPG_MAP_NO_START`, `RPG_MAP_UNREACHABLE` (an NPC, foe, boss or the gate cannot be reached from the start on walkable tiles: BFS), `RPG_SPOT_BLOCKED` (someone stands on a wall or water), `RPG_NO_QUEST_GIVER`, `RPG_FOE_ITEM_MISSING`, `RPG_FOE_NO_ITEMS`, `RPG_DIALOGUE_EMPTY`, `RPG_QUEST_UNWINNABLE` (a battle whose foe cannot be beaten: no askable item); warnings `RPG_FOE_ITEM_OTHER_UNIT`, `RPG_NO_STORY`.

## Fixtures

`solar-system`: three areas (the Sun's court, the rocky road and the giants' sea, the icy moons), hand-written frame story (a young astronomer restoring the orrery of the solar system: true to the facts, no fantasy claims about science), quest givers whose lines teach, foes named after misconceptions ("the Flat Orbit", "the Hot-Mercury myth"). EN + HR.

## Bot driver `scripts/bot/rpg.mjs`

Debug helpers: `nextGoal()` (the next target: giver, foe, boss, gate, with its `goto-` id), `pathTo(id)`. perfect: each area in order: walk (keyboard mode: arrow keys for the first steps, `goto-` buttons for the rest), talk, accept, win every battle with right answers to 3 stars, then the final boss, the outro, `end`. wrong: every answer wrong: the hero faints and wakes at the inn (check `view.hp` restored and the quest still open), the foe is still there (no dead end), the review queue fills, no stars. random: finish within the bound. Axe on every distinct screen (title, intro, world, dialogue, battle question, feedback, inventory, quest-done, end).

## Done when

The common checks of `shell-contract.md` pass for `solar-system`, with screenshots in `.claude/temp/screens/phase5/rpg/`.

## Results (phase 5 resume run)

Checklist (evidence in numbers; "bot" = `node scripts/play.mjs <game> --shell rpg`, games built with the real player bundle):

- [x] Course side: schema, layout, tile logic, 11 error + 2 warning `RPG_*` codes, automatic layout (`src/shared/shells/rpg.ts`, `rpg-layout.ts`, `rpg-map.ts`; the typecheck error in `rpg-map.ts` fixed: the fallback grid is `string[][]`).
- [x] Player: `index.ts` (title, intro, areas, world, dialogue, battle, boss, quest-done, inventory, outro, end), `ui.ts` (HP line, battle scene, portrait), plus the existing `battle.ts`, `draw.ts`, `model.ts`, `sprites.ts`, `strings.ts` (EN + HR), `rpg.css`.
- [x] Fixture: `solar-system` has the authored section (3 areas, hand-written frame story, quest givers who teach, 9 foes named after misconceptions, 3 bosses, final boss, EN + HR) and `rpg` in `shells.enabled`, applied through `.claude/temp/fixture-section.mjs` (source `.claude/temp/fixtures/rpg/make-solar-system.mjs`).
- [x] Unit tests: `tests/player-rpg-logic.test.ts` (28: generator connectivity over 300 seeds x 5 foe counts, BFS, layouts of the 3 golden fixtures, battle maths, world model, sprites, HR parity), `tests/rpg-lint.test.ts` (18: golden fixtures clean incl. automatic layout, every code fires, validator, broken fixture).
- [x] Broken fixture `tests/fixtures/courses/broken-rpg/` + `EXPECTED.md` (11 error codes + 2 warnings, plus the validator's `UNKNOWN_ITEM`, `UNKNOWN_UNIT`).
- [x] Bot driver `scripts/bot/rpg.mjs` (`nextGoal()`, `pathTo(id)`, perfect / wrong / random, keyboard, axe) and `tests/bot-rpg.e2e.test.ts`.
- [x] Screenshots `.claude/temp/screens/phase5/rpg/solar-system-{desktop,mobile}/` (34 each), looked at and fixed (title banner centred, bullets off the walk-to list, quest log moved under the map, HP lines no longer repeat the foe's name, scrolls in two columns, softer boss glow, HP bars stacked on phones).
- [x] `player-doc.md` written (the section for `docs/player.md`).

Deviations from the plan text:

- Each battle has its own run (`session.startRun` over the foe's items; the area boss over every item of the unit) instead of one run for the whole quest; the quest's stars are the mean of the first-try scores of all its battles (a foe's first fight only), which is the same accuracy the single run would give. A foe whose questions run out while it still stands asks them again (those answers do not count).
- Added screens the plan only implied: `battle` (intro of a fight, `battle-start` / `battle-flee`), `boss` (the final boss's intro) and `outro` (the closing story).
- Foes stand at fixed tiles (no wandering). The hero's HP carries between fights (wins heal 40, entering an area and the inn restore all).
- The gate leads to the `areas` screen (next area, final boss), not straight into the next area.
- Phase-6 asset slot (tileset / sprites / portraits from the section) is coded (`Skin` in `draw.ts`) but UNTESTED with real images: the fixtures name none.

Verification (numbers):

- `tsc` (node, web, player projects): 0 errors in rpg files (errors of other shells in the shared tree not counted); eslint on the rpg paths, `scripts/bot/rpg.mjs` and the three rpg tests: 0 problems.
- `vitest` (EDU_TEST_PLAYER_OUT=.claude/temp/rpg-player): `tests/bot-rpg.e2e.test.ts` 17 + `tests/player-rpg-logic.test.ts` 28 + `tests/rpg-lint.test.ts` 18 = 63 passed; with `tests/edu-lint.test.ts tests/edu-course.test.ts tests/design-tokens.test.ts tests/player-shell-kit.test.ts` 386 of 387 passed in the first run (the one failure, a keyboard run on a generated map where a WASD step bumped into the giver, is fixed in the driver and the file passes on the second run).
- Bot (games: solar-system authored; solar-auto, capitals-auto, greetings-auto = automatic layout), all with 0 console errors: perfect 36 / 36 / 36 / 30 steps all right; wrong 4 steps (1 faint, `--rounds 2`: 2) ; random seed 1 acc .75: solar-auto 69 steps (15 wrong, 2 replays), capitals-auto 55 (13 wrong, 2 faints), greetings-auto 62 (14 wrong, 2 replays); keyboard + axe (solar-system): 742 key presses, 0 mouse clicks, 34 axe runs 0 critical / 0 serious / 0 moderate; (capitals-auto) 645 presses, 0 clicks, 32 axe runs, 0 violations.

## Orchestrator check (2026-10-30)

Committed alone on branch `EGS-12_rpg` (one commit, stacked; not pushed). This ticket's tree, checked in a clean worktree: `yarn typecheck` 0 errors, `yarn lint` 0 problems, `yarn test` 56 files, 1001 tests passing (the shell list in `tests/player-shell-kit.test.ts` is written per ticket). Changelog: `changelog.md`.
