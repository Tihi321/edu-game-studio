# EGS-14: the detective / escape room

Hub plan HUB-19 phase 5, fifth shell. Branch `EGS-14_detective`, stacked on `EGS-13_roleplay`. One commit (orchestrator). Built in parallel with the other shells in one checkout against `../EGS-10-encyclopedia/shell-contract.md` and `docs/player.md`, "Shells".

Inspired by Carmen Sandiego and Murdle. The logic puzzles are VN Studio's proven generator, already copied unchanged into this repo by EGS-01: `src/shared/puzzles/` (murdle, knights, testimony, logic, quiz; seeded PRNG; `generate()`, `verify()`: exactly one solution AND solvable by `deduce()` without guessing; `play.ts`: marks, `checkAccusation`, `checkSolution`, `hint`) with `src/shared/puzzle.ts` and its tests `tests/puzzles.test.ts` and fixtures `tests/fixtures/puzzles/`. Compare it once with VN Studio's `src/shared/puzzles/` (sibling repo `visual-novels-orchestrator`) (READ ONLY; the copy differs only in line endings and the header comment): record the comparison in your plan. Do NOT change the copied generator; build on it (a wrapper in `src/shared/shells/detective*.ts` or `src/player/shells/detective/`).

## New theme `noir`

Add `src/design/themes/noir.css` and its entry in `src/design/themes/index.ts` (at the end of `THEMES`, between `// @EGS-14-begin` / `// @EGS-14-end` lines; `ThemeId` already lists it): a case file on a desk at night (manila folders, a cork board with red string, typewritten labels, a desk lamp's warm pool of light), dark scheme, fonts already bundled in `src/design/fonts/` only (no new font download). Fill every colour and font slot of `tokens.css`; `tests/design-tokens.test.ts` checks the contrast pairs of every registered theme: make it pass. Give the shell `theme: 'noir'`.

## Clues are course facts

A case is a generated, proved puzzle whose entities are course things (planets, probes, astronomers; capitals, rivers, landmarks), named by catalog keys. Its clues are face-down cards; each card is turned by answering a course item (`ask`, context `clue`): right turns it (the card shows the puzzle clue and, under it, the fact it rests on: the item's did-you-know or explanation); wrong leaves it face-down with the explanation, and that card asks again later (retry) or with another item of the objective. Where the section gives an entity a fact-coded alias ("the planet with the fastest winds" for Neptune), the clue text uses the alias, so solving needs the course knowledge too (`renderText(p, names)` takes the names map). The learner marks the grid (`cell-<a>-<b>` cycling blank / no / yes, using `play.ts`), may ask for a deduction hint (`hint`, costs a star point), and accuses (`accuse`: pick one per category, `accuse-<category>-<entity>` then `accuse-submit`; `checkAccusation`). A wrong accusation says what is wrong in general terms and lets them try again: never a dead end.

## Escape rooms (one per unit) and the chase (geography)

- `rooms`: a unit's escape room is a locked door with a case on it; solving the case opens it; the unit's stars come from the first-try accuracy of its clue questions (minus nothing for hints: hints are help, not failure); 2+ stars unlock the units that require it. The last room (boss) is a case whose clues come from every unit.
- `chase` (Carmen-Sandiego style, for geography courses): a suspect flees across places (`places` with map pins). At each place a witness gives a clue that is a course fact about the NEXT place ("She asked the way to the river Vltava"): answer the clue item to hear it (context `clue`), then choose where to travel (`travel-<placeId>`, the right place among 2-4 decoys). Right: you follow the trail. Wrong: a cold trail costs an hour on the clock (`clock`) and brings you back to the last place; the trail is never lost. At the last place you catch the suspect (and the chase counts as the course's final challenge, or as a unit's challenge, as the section says).

## Screens (`getState().screen`)

`title` (kit), `office` (the case board: rooms per unit `room-<roomId>` with locks, stars, the chase `chase-start`), `case` (the case file: the story setup, the clue cards `clue-<n>` face-down or up, the grid, `hint`, accusation), `item` / `feedback` (kit `ask()`, context `clue`), `case-solved` (stars, the door opening, units unlocked), `chase` (the map with pins, the clock, the witness, `travel-<placeId>`), `caught`, `end` (kit).

## Course section `shells.config.detective` (required: `requiresSection: true`)

```jsonc
{
  "rooms": [{ "id": "room-sun", "unit": "u-sun-planets", "title": "det.room.sun", "story": "det.room.sun.story",
              "case": { "kind": "murdle", "size": 3, "seed": 11, "band": "easy",
                        "names": { "suspect-0": "det.n.galileo", "weapon-0": "det.n.telescope", "...": "..." },
                        "aliases": { "place-1": "det.alias.neptune" },
                        "items": ["q-sun-mcq", "q-sun-tf", "..."] } }],
  "final": "room-final",
  "chase": { "unit": "u-south", "suspect": "det.chase.suspect", "start": "p-paris",
             "places": [{ "id": "p-paris", "name": "det.p.paris", "x": 210, "y": 180 }],
             "route": [{ "from": "p-paris", "to": "p-vienna", "item": "e-vienna-river", "decoys": ["p-rome", "p-lisbon"] }],
             "map": "img-europe" }
}
```

Read the generator to see which entity ids a kind/size produces (`generate({ kind, size, seed, band })` returns categories with item ids); the `names` map gives each a catalog key. Generate at RUNTIME from the seed (deterministic), and prove at LINT time.

## Lint codes (`DET_`)

`DET_UNIT_NO_ROOM`, `DET_ROOM_UNIT_MISSING`, `DET_FINAL_MISSING`, `DET_PUZZLE_INVALID` (the generator throws for the kind/size/seed/band), `DET_PUZZLE_NOT_UNIQUE` / `DET_PUZZLE_UNSOLVABLE` (from `verify()`: not exactly one solution, or not solvable by deduction), `DET_NAME_MISSING` (an entity of the generated puzzle without a name key), `DET_CLUE_ITEM_MISSING`, `DET_TOO_FEW_CLUE_ITEMS` (fewer items than clue cards), `DET_CHASE_PLACE_MISSING`, `DET_CHASE_ROUTE_BROKEN` (the route does not lead from the start to the end through known places), `DET_CHASE_ITEM_MISSING`, `DET_CHASE_FEW_DECOYS` (fewer than 1 decoy); warning `DET_ALIAS_NOT_FACT` (an alias whose entity has no item asking about it).

## Proofs

A test proves every fixture case (`verify()` passes: unique and deducible) and a property test runs `generate` + `verify` over at least 200 seeds per kind and size the shell uses (murdle 3 and 4, logic 3 and 4, knights 3, testimony easy, quiz) and asserts every generated puzzle is unique and solvable (the generator retries internally; a seed that throws `PuzzleError` is allowed only if the shell then falls back to the next seed: test that fallback). Keep `tests/puzzles.test.ts` green and unchanged.

## Fixtures

- `solar-system`: three rooms (a space-station mystery per unit: who borrowed the telescope, which probe went where ...) and a final room; entities named after course things; aliases that are course facts.
- `european-capitals` (being written in parallel; wait for `.claude/temp/european-capitals.READY`): rooms per unit and the chase across 5-6 capitals with clue items from the course (rivers, landmarks).

## Bot driver `scripts/bot/detective.mjs`

Debug helpers: `solution()` (the case's answer for the accusation and the marks that solve the grid), `route()` (the next place of the chase). perfect: each room in order: turn every clue card with right answers, mark the grid from `solution()`, accuse right, 3 stars; the final room; the chase (geography fixture); `end`. wrong: every clue answer wrong: cards stay face-down, the review queue fills, a wrong accusation is rejected with a message and the case stays open (no dead end); the chase's wrong travel returns to the last place. random: finish within the bound. Keyboard mode, axe on every distinct screen.

## Done when

The common checks of `shell-contract.md` pass for `solar-system` and `european-capitals`, the puzzle proofs pass, with screenshots in `.claude/temp/screens/phase5/detective/`.

---

# Results (phase 5 resume, one implementer, uncommitted on `EGS-10_encyclopedia`)

## Comparison with VN Studio's generator (done once, read only)

`src/shared/puzzles/*.ts` (12 files) equals `visual-novels-orchestrator/src/shared/puzzles/*.ts` apart from line endings and the header comment of `index.ts` ("for Edu Studio"); `src/shared/puzzle.ts` differs only in the header comment (`edu_puzzles` for `vno_puzzles`). VN Studio's puzzle tests: `tests/puzzles.test.ts` is already copied (minus the `sdkPython` helper and the Ren'Py template block, which need VN Studio's engine); `puzzle-python`, `renpy-puzzle-emit`, `vn-puzzle-import`, `vn-puzzle-story` need its Python bridge, Ren'Py emitter and story engine, so no `tests/puzzles-*.test.ts` was copied. The generator is NOT changed; the shell builds on it in `src/shared/shells/detective-case.ts`.

## Checklist

- [x] Theme `noir` (`src/design/themes/noir.css` + registry entry + preview lines): `tests/design-tokens.test.ts` passes (all contrast pairs, shell stylesheets). DONE.
- [x] Course side `src/shared/shells/detective.ts` (schema, textRefs, assetRefs, validate, lint, 14 `DET_` codes) and `detective-case.ts` (case wrapper: `buildCase` proves with `verify()` and falls back to the next seed, at most 8; en/hr clue sentences with aliases; grid, accusation, hint helpers). Fixed the typecheck error at `detective-case.ts` (`answerOf` needs `murder`); English logic sentences say "goes with" (not "is"); "exactly 1 place apart" in the singular. DONE.
- [x] Proofs: `tests/detective-case.test.ts`: murdle 3 and 4, logic 3 and 4, 200 seeds each (bands rotating): unique AND deducible, 0 fallbacks; the seed fallback with a failing generator (PuzzleError, a puzzle that does not verify, all seeds fail -> throws after exactly 8 tries). `tests/puzzles.test.ts` is unchanged and green. Deviation: knights, testimony and quiz are not offered by the shell (the section schema allows murdle and logic only), so they have no property test here; the original `tests/puzzles.test.ts` covers them.
- [x] Player: `src/player/shells/detective/{index,model,board,map,grid,art,strings}.ts` + `detective.css`; screens title / office / case / item+feedback (context `clue`) / case-solved / chase / caught / end. DONE.
- [x] Fixtures through `fixture-section.mjs` (source `.claude/temp/fixtures/detective/make.mjs`): solar-system (3 unit rooms + final room, murdle 3 and 4, aliases that are course facts, EN + HR), european-capitals (murdle west and south, a logic grid for central, murdle final, the chase Dublin -> London -> Paris -> Prague -> Vienna -> Rome with 4 places of decoys and a witness line per leg). `detective` in `shells.enabled`. Both lint with 0 problems (0 errors, 0 warnings). DONE.
- [x] Broken fixture `tests/fixtures/courses/broken-detective/` + `EXPECTED.md` + `tests/detective-lint.test.ts` (exact codes of the forced build and of the lint; every `DET_` code documented; the three `DET_PUZZLE_*` codes fire with an injected builder, because the generator makes a proved puzzle for every section the schema allows).
- [x] Bot driver `scripts/bot/detective.mjs` and `tests/bot-detective.e2e.test.ts` (8 tests: per fixture perfect, keyboard + axe, wrong, random). DONE (numbers below).
- [x] Screenshots 1280x800 and 390x844 in `.claude/temp/screens/phase5/detective/{solar-system,european-capitals}-{desktop,mobile}/`; looked at, fixed: crime line wording, fact label on its own line, stamp margin over the title, door line, witness and map side by side on wide screens, logic grid row headers, "1 place apart". Best two: `european-capitals-desktop/perfect-15-case-grid-marked-murdle.png` (the case file with cards, grid, cork board and strings) and `european-capitals-desktop/perfect-34-chase-cold-trail.png` (map, cold trail, witness, travel choices).
- [x] `player-doc.md` (section for `docs/player.md`).

## Deviations

- Hints: the plan says both "costs a star point" and "minus nothing for hints: hints are help, not failure". Implemented the second (hints cost nothing; the solved screen shows how many were used), which is what `model.ts` already documented.
- A chase with `final: true` and a final room both exist in european-capitals; the file closes when either gives 1+ star (the final room and the chase both record boss stars; stars never go down). A chase with `unit` records into that unit.
- Wrong mode cannot reach the chase (it is behind mastery); the bot's perfect mode tries a decoy first on leg 1 and random mode now and then, and the unit test `tests/player-detective-model.test.ts` covers the cold trail, clock and catch.
- Crime line says "The crime happened in ..." (not "the body was found"): the course is for children.

## Verification (evidence)

See the final report of the run: typecheck (0 errors in detective files; other shells' test files showed errors of their own), eslint 0, vitest of my files and of `edu-lint`, `edu-course`, `design-tokens`, `player-shell-kit`, `puzzles`.

## Orchestrator check (2026-10-30)

Committed alone on branch `EGS-14_detective` (one commit, stacked; not pushed). This ticket's tree, checked in a clean worktree: `yarn typecheck` 0 errors, `yarn lint` 0 problems, `yarn test` 63 files, 1154 tests; yarn build ok passing (the shell list in `tests/player-shell-kit.test.ts` is written per ticket). Changelog: `changelog.md`.
