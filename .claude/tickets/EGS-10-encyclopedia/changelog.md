# EGS-10 changelog

## 2026-10-30 — EGS-10: the shell contract and the encyclopedia explorer

Outcome: every course can now be played in more than one game shell, chosen on the title screen. The first new shell, the encyclopedia explorer, plays `solar-system` and `european-capitals` in the perfect, wrong and random bot runs, keyboard only and under axe-core. Nobody has played it by hand yet.

### Repository `edu-game-studio`, branch `EGS-10_encyclopedia` (stacked on `EGS-05_design-system` c78d3b2)

The shell contract (shared by EGS-11 to EGS-14):
- `src/shared/shells/{index,types}.ts`: the registry of course-side shell definitions. Each definition has a zod section schema, text and asset refs, a validator and a shell lint. `validateCourse` (`src/shared/edu/validate.ts`) runs the sections, which can raise `SHELL_SCHEMA` and `UNKNOWN_*`, and checks their text keys. `lintGameData` (`src/engine/edu/lint.ts`) runs `lintShells`, which raises `SHELL_UNKNOWN` (a warning), `SHELL_SECTION_MISSING` and each shell's own codes, carrying the shell's severity.
- `src/player/kit/`: what every shell is built on.
  - `ShellSession`: edition, progress, answers, runs, stars, unlock and publish.
  - `ask()`: the question and feedback screen, which works in every shell.
  - `titleScreen` and `endScreen`, with the game-style picker.
  - `makeShellUi()` for each shell's own words.
  - `kit.css`, and a stub shell.
- `src/player/{engine,main,progress,round,state,types,i18n}.ts`:
  - `?shell=`, the remembered choice, `switchShell`, `playableShells` and `debug.shell`.
  - `progress.shells[<id>]`, with stars, finish and data per shell; export and import carry it, and old progress files still import.
  - `startPool()`.
  - The shell names in EN and HR.
- `src/player/shells/quiz-arena.ts`: the picker on the arena's title.
- `src/player/style/items.css`: `.btn` gets a 4 px hover area that moves with the button. The hover lift used to make a button jitter under a resting pointer, which was the cause of the old `bot.e2e` hr random-75 % flake. The fix was ported from the EGS-17 finding in the p3 worktree.
- Bot: `scripts/play.mjs` gets `--shell` and hands over to a driver registry in `scripts/bot/`:
  - `index.mjs`;
  - `quiz-arena.mjs`, the arena's driver moved out of `play.mjs` with its behaviour unchanged;
  - `generic.mjs`;
  - `encyclopedia.mjs`.
- Tests:
  - `tests/bot-helpers.ts`, `tests/player-shell-kit.test.ts`, `tests/player-shell-picker.e2e.test.ts`.
  - Shell stylesheet checks in `tests/design-tokens.test.ts`.
  - `tests/setup/player-bundle.ts` and `tests/bot.e2e.test.ts` honour `EDU_TEST_PLAYER_OUT`, so two test runs in one checkout no longer overwrite each other's bundle.
  - `tests/edu-course.test.ts`: the "unknown shells pass" case now uses ids that really are unknown.
  - `tests/edu-fixtures.ts` adds `european-capitals`.

The encyclopedia explorer:
- `src/player/shells/encyclopedia/*` (theme parchment): the screens explore, article, timeline, map, codex and hunts, plus item, feedback and end through the kit.
  - Search, cross-links, citations, page turns and a pinned clue.
  - Scavenger hunts whose answers are in the target articles.
  - A final hunt that mixes the units.
- `src/shared/shells/encyclopedia.ts`: the section schema, an automatic layout, and the `ENC_*` lint, including `ENC_HUNT_ITEM_DUPLICATE` and Croatian stemming for `ENC_ANSWER_NOT_IN_ARTICLE`.

Fixtures and docs:
- New fixture `tests/fixtures/courses/european-capitals/` (en and hr): history and geography, a preview of the pilot.
- Encyclopedia sections in `solar-system` (8 events, 9 pins, a hunt per unit) and `european-capitals` (12 events, 12 pins, 3 hunts).
- `tests/fixtures/courses/broken-encyclopedia/` with `EXPECTED.md`.
- `hr-a1-greetings`: the placeholder `roleplay` entry (`scenes: []`) is removed until its shell exists. EGS-13 adds the real one.
- `docs/player.md` "Shells" and "The encyclopedia explorer", `README.md`, `ROADMAP.md`, `tests/fixtures/courses/README.md`.

### Deviations
- The contract and all five shells were built in one checkout at the same time and split into one commit per ticket afterwards, using `@EGS-NN` line markers that were removed before committing. Each ticket's tree was type-checked, linted and tested on its own.
- The wrong and random mouse runs set `prefers-reduced-motion: reduce`, which keeps the page-turn waits short. The perfect and keyboard runs keep the motion and assert it.
- Four timeline events (Galileo 1610, Uranus 1781, Neptune 1846, Pluto 1930) were named by the plan but are not in the `solar-system` fact base.

### Verification
This ticket's tree, checked in a clean worktree:
- `yarn typecheck`: 0 errors.
- `yarn lint`: 0 problems.
- `yarn test`: 49 files, 871 tests, all passing. The first run had 870 passing; the 1 failure was the kit test's shell list, which is now written per ticket. That file was re-run afterwards.

From the implementer:
- 54 encyclopedia tests.
- Bot runs, all with 0 console errors:
  - perfect: `solar-system` 15/0, `european-capitals` 17/0, automatic layout 10/0.
  - wrong: 0/18, 0/24 and 0/6.
  - random: 23/10, 39/23 and 16/5.
  - keyboard only: 0 mouse clicks.
  - axe: 21, 21 and 17 runs, with 0 serious and 0 critical.
- A run at 360x740 had no horizontal overflow.
- Screenshots are in `.claude/temp/screens/phase5/encyclopedia/` (not committed).

Not run:
- A human play-through.
- Real screen readers.
- Browsers other than Chromium.
- The article audio slot, because no fixture has article audio.

### Follow-ups
- The pilot (EGS-09) is to be played in the encyclopedia.
- Saving a course's theme from the Game tab is still open (see ROADMAP "Later").

### Commit status
One local commit on `EGS-10_encyclopedia`. Not pushed.
