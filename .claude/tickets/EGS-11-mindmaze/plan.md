# EGS-11: the MindMaze castle

Hub plan HUB-19 phase 5, second shell. Branch `EGS-11_mindmaze`, stacked on `EGS-10_encyclopedia`. One commit (orchestrator). Built in parallel with EGS-10, -12, -13, -14 in one checkout against the contract in `../EGS-10-encyclopedia/shell-contract.md` and `docs/player.md`, "Shells".

Theme `castle` (castle stone and torchlight: Cinzel titles over Alegreya, torch amber, ember, doors that swing open, a flickering torch glow that stops under reduced motion). Inspired by Encarta MindMaze: you walk a castle of rooms, every door is a question, the topic decides the wing, characters in the rooms help, and the throne room opens at mastery.

## Screens (`getState().screen`)

- `title` (kit), with the castle as art (an SVG gatehouse, not a stock picture).
- `castle`: the overview: the wings (one per unit, `wing-<wingId>` buttons, `data-locked` until the wings of the units it requires are mastered, stars, the key when won) and the throne room (`throne`, locked until every wing has its key). A mini-map of the whole castle.
- `room`: you stand in a room: its name (h1), its description, the character in it (portrait slot, name, `talk` shows their line and `hint` their hint for the doors of this room: from the section, else the hint of the door's item), the doors (`door-<toRoomId>`: `data-state` = `locked` | `open`; a locked door, pressed, asks its question; an open one walks you through), `back` to the room you came from, `to-castle`, the torches left (`torches`, with a flame per torch), the wing's mini-map (`minimap`, SVG: rooms, open and locked doors, you are here; also readable as a list). In the key room: the wing key (`take-key`).
- `item` / `feedback` (kit `ask()`, context `door` or `throne`): the hud shows the door (carved arch) and the torches.
- `wing-done`: the wing's summary: stars (first-try accuracy of the wing run), the key won (2+ stars) or crumbling (fewer: "walk the wing again": the doors close, `retry-wing`), the units it unlocked.
- `throne`: the throne room: a final gauntlet of mixed questions (boss run over all units' items); 1+ star wins the crown; then `end`.

## The door loop (intrinsic integration: the door IS the question)

- Each door has a pool of items (section, else the items of the room's objective). Pressing a locked door asks the next item of the wing run (`session.next(run)` restricted to the door's pool when possible: write a small helper in your folder that picks from the pool with the run's state, or keep one run per door; the in-run retry rule must hold: a missed item comes back after 2-4 other questions).
- Right: the door swings open and stays open for this walk; you walk through. Wrong: the feedback explains; you lose a torch (`feedback-effect`: "Your torch gutters: 2 left"); the door stays shut and will ask a different question next time. At 0 torches the castle's ghost leads you back to the wing's entrance hall and relights your torches (the opened doors stay open): sent around, never a dead end, never a lock-out.
- Reaching the key room with the wing run done: `wing-done` with the stars; a wing is mastered at 2+ stars (`recordUnit`), which unlocks the wings of the units that require it.
- Characters react: on a right answer streak or a miss their line changes (two lines per character in the section, else from the shell's strings).

## Course section `shells.config.mindmaze` (optional; automatic layout when missing)

```jsonc
{
  "torches": 3,
  "wings": [{ "id": "w-sun", "unit": "u-sun-planets", "name": "maze.w.sun", "entry": "r-hall",
    "rooms": [{ "id": "r-hall", "name": "maze.r.hall", "description": "maze.r.hall.desc",
                "character": { "name": "maze.c.astronomer", "line": "maze.c.astronomer.line", "hint": "maze.c.astronomer.hint" },
                "doors": [{ "to": "r-orrery", "items": ["q-order-mcq", "q-order-seq"] }] },
              { "id": "r-orrery", "name": "...", "doors": [...], "key": true }] }],
  "throne": { "name": "maze.throne", "description": "maze.throne.desc", "size": 8 }
}
```

Automatic layout: a wing per unit; an entrance hall, a room per objective (named after the objective's text), a key room; doors in a chain with one side loop so there are two routes; door pools from the objective's items.

## Lint codes (`MAZE_`)

`MAZE_WING_UNIT_MISSING`, `MAZE_UNIT_NO_WING` (a unit no wing covers: it could never be mastered), `MAZE_ENTRY_MISSING`, `MAZE_DOOR_TARGET_MISSING`, `MAZE_DOOR_NO_ITEMS`, `MAZE_DOOR_ITEM_MISSING`, `MAZE_ROOM_UNREACHABLE` (BFS from the entry), `MAZE_NO_KEY_ROOM`, `MAZE_KEY_UNREACHABLE`, `MAZE_DEAD_END` (a room from which the key room cannot be reached); warning `MAZE_DOOR_ITEM_OTHER_UNIT`, `MAZE_TOO_FEW_TORCHES` (< 1).

## Fixtures

- `solar-system`: three wings (the Sun and planets, rocky and giant planets, moons and beyond), 4-5 rooms each with characters (an astronomer, a probe engineer ...) whose lines and hints are true to the course facts, doors drawing on all the unit's items. EN + HR.
- `european-capitals` (being written in parallel; wait for `.claude/temp/european-capitals.READY`): wings by region, rooms as palaces and squares of the capitals.

## Bot driver `scripts/bot/mindmaze.mjs`

Use a debug helper `route()` (the next door on the shortest path to the key room, through open doors first) and `view`. perfect: every wing in prerequisite order to 3 stars, the throne, `end`; the torches never drop. wrong: answer every door wrong in the first wing: the torches run out, you are led back to the entrance (screen and `view.room` check), the doors are still answerable (no dead end), the review queue fills, no key is won. random: finish within the bound. Keyboard mode, axe on every distinct screen.

## Done when

The common checks of `shell-contract.md` pass for `solar-system` and `european-capitals`, with screenshots in `.claude/temp/screens/phase5/mindmaze/`.

## Results (phase 5 resume run)

Status: DONE for everything below except the items listed under "Not done / untested". Evidence from this run (Node 24, `EDU_TEST_PLAYER_OUT=.claude/temp/mindmaze-player`).

- [x] Player side (`src/player/shells/mindmaze/{index,art,layout,walk,strings}.ts`, `mindmaze.css`): reviewed against this plan, finished. Fixed: the `MazeSection` import (the type is `MindmazeSection`), the `hintBtn` null error, a ghost notice that stayed on screen after the next wrong answer (the walk clears `ghosted` on every answer), automatic room names now drop the objective's trailing full stop.
- [x] Course side (`src/shared/shells/mindmaze.ts`): every plan code present, plus `MAZE_OBJECTIVE_MISSING`, `MAZE_DUPLICATE`, `MAZE_KEY_AT_ENTRY` (extra); `AUTO_CHARS` lint error fixed (now a type alias); the automatic layout is linted (section undefined or a unit no authored wing covers); `MAZE_UNIT_NO_WING` message corrected (the shell still builds an automatic wing for that unit).
- [x] Bot driver `scripts/bot/mindmaze.mjs` (was the 2-line stub): `route()`, `view()`, `maze()` helpers; perfect, wrong, random, keyboard, axe.
- [x] Fixtures: `solar-system` (3 wings x 6 rooms, 18 characters, EN + HR) and `european-capitals` (West / Central / South wings, rooms as palaces and squares, 18 characters, EN + HR), both through `.claude/temp/fixture-section.mjs` (`mindmaze` in `shells.enabled`); each unit's items are all asked at some door; two routes per wing, 4 doors on the shortest.
- [x] Unit tests: `tests/mindmaze-maze.test.ts` (schema, golden fixtures lint clean, automatic layout on all 3 fixtures, graph and route, every MAZE_ code fires on a broken variant), `tests/player-mindmaze-walk.test.ts` (walk, ghost, pickForDoor, maps), `tests/mindmaze-lint.test.ts` (golden fixtures build and lint clean, broken fixture). 50 tests.
- [x] Broken fixture `tests/fixtures/courses/broken-mindmaze/` + `EXPECTED.md`: all 15 MAZE_ codes (13 errors + 2 warnings) asserted exactly.
- [x] `tests/bot-mindmaze.e2e.test.ts`: 3 cases (solar-system, european-capitals, solar-system without its section = automatic layout) x (perfect, keyboard + axe, axe, wrong, random) = 15 tests, all pass. Whole run of my files + `edu-lint`, `edu-course`, `design-tokens`, `player-shell-kit`: 8 files, 389 tests, all pass.
- [x] Screenshots 1280x800 and 390x844 of every distinct screen: `.claude/temp/screens/phase5/mindmaze/{solar-system,european-capitals,solar-system-auto}-{desktop,mobile}/` (title, castle, room, item kinds, feedback right and wrong, key room, wing-done (also the crumbling one, random seed 11 at 45 %), castle with every key, throne intro and result, ghost scene, end). Looked at them; best: `european-capitals-mobile/perfect-03-room.png` and `solar-system-desktop/wrong-10-room-ghost.png`.
- [x] `player-doc.md` written.
- [x] Reduced motion (the torch flicker is `animation: none` with `prefers-reduced-motion: reduce`), 360 px (no horizontal scroll, no button under 44 px) checked in Chromium.

Bot (seed 1 perfect and keyboard, 2 wrong with 1 round, 3 random at 75 %, 4 axe), all 0 console errors, 0 failures:

| Game | perfect | wrong | random | keyboard (0 clicks) | axe (serious / critical) |
|---|---|---|---|---|---|
| solar-system | pass, 20 answers, 3 keys, crown | pass, 6 wrong, 2 ghost scenes | pass, 36 answers (28 right) | pass, 243-361 key presses | 0 / 0 (26-32 runs) |
| european-capitals | pass, 20 answers | pass, 6 wrong, 2 ghosts | pass, 36 answers (28 right) | pass | 0 / 0 |
| solar-system, automatic layout | pass, 21 answers | pass, 6 wrong, 2 ghosts | pass, 26 answers (21 right) | pass | 0 / 0 |

(`maxSteps` 142 for every game. A 45 % learner seed 11 on solar-system also finishes: 156 answers, 18 ghost scenes, within the same bound after factor 2.78.)

Deviations from the plan text:

- Wings have 6 rooms (hall, 4 rooms, key room) with one two-route diamond instead of "4-5 rooms": the shortest route is then 4 doors so a wing's stars rest on 4+ answers (an automatic wing has the same minimum, `AUTO_MIN_DOORS`).
- `throne.character` was in the schema but nothing drew it: removed (schema, text refs, asset refs, resolve) instead of leaving dead configuration.
- Extra lint codes `MAZE_OBJECTIVE_MISSING`, `MAZE_DUPLICATE`, `MAZE_KEY_AT_ENTRY`.
- The throne gauntlet relights all torches when the last one goes out (never lost, only harder to earn stars in); the plan only specified the wing ghost.

Not done / untested: not played by a human in the real browser or on a phone; Croatian text not looked at on screen (the strings table and the fixture catalogs are complete in both languages, checked by tests); no sound cue added (the shell fires the kit's `unit-complete` and `boss` cues only).

## Orchestrator check (2026-10-30)

Committed alone on branch `EGS-11_mindmaze` (one commit, stacked; not pushed). This ticket's tree, checked in a clean worktree: `yarn typecheck` 0 errors, `yarn lint` 0 problems, `yarn test` 53 files, 937 tests passing (the shell list in `tests/player-shell-kit.test.ts` is written per ticket). Changelog: `changelog.md`.
