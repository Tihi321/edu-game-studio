# EGS-04: autoplay bot and golden-fixture playthroughs (phase 1, part 3)

Derived from the hub plan HUB-19 phase 1 steps 4 and 5. Branch: `EGS-04_autoplay-bot`, stacked on `EGS-03_player-runtime`.

## Goal

A headless bot that plays a built game from its answer key and proves it is playable, in three modes, with screenshots.

## Steps

- [x] `playwright` as a devDependency; Chromium installed with `npx playwright install chromium` (through `fnm exec --using=24`).
- [x] `scripts/play.mjs <build-dir> --mode perfect|wrong|random [--seed N] [--shots <dir>] [--viewport WxH] [--max-steps N]`:
  - opens `index.html` over `file://`, drives only through `data-testid`s, reads the answer key from `game-data.json`;
  - **perfect**: answers every item right and reaches the end screen with all units mastered;
  - **wrong**: answers every item wrong; asserts each item's explanation (per distractor) is shown and the review queue fills and is offered;
  - **random**: a seeded learner (e.g. 75 % right) finishes within the expected step count;
  - fails on any console error or page error; saves a screenshot per screen (title, unit map, each item kind, feedback, boss, review, end) to the shots folder; prints a JSON summary (steps, correct, wrong, screens, consoleErrors).
- [x] Vitest test (`tests/bot.e2e.test.ts` or similar, longer timeout) that builds both golden fixtures and runs the bot in all three modes on each; skipped with a clear message only if Chromium is not installed.
- [x] Screenshots of the quiz arena at desktop 1280x800 and mobile 390x844 saved under `.claude/temp/screens/phase1/` (gitignored).
- [x] README / docs: how to run the bot.

## Acceptance

Bot passes all three modes on both fixtures with 0 console errors; `yarn test` green including the e2e test; screenshot set exists.

## Results

Done 2026-10-29. Verified: `yarn typecheck` and `yarn lint` clean; `yarn test` 39 files, 594 tests passed (includes `tests/bot.e2e.test.ts`: 6 bot runs plus a bad-folder check; not skipped, Chromium launches).

- **Solver approach: (a)**, a read-only hook in the player bundle: `window.EduEngine.debug.solve(itemId)` / `.wrong(itemId)` (`src/player/debug.ts`; `solve` is the shared `solveItem`, `wrong` is a small per-kind switch), documented in `docs/player.md`. The bot needs no TS; a word bank in a cloze is answered from `game-data.json` (`bank-<gap>-<key>`).
- **Files:** `scripts/play.mjs` (new), `tests/bot.e2e.test.ts` (new), `src/player/debug.ts` (new), `src/player/engine.ts` + `types.ts` (hook), `docs/player.md`, `README.md` (Autoplay bot section, scripts row, layout), `package.json` (`play` script).
- **Step bound:** `maxSteps = ceil(6 * (units * roundLength + bossLength) * max(1, 0.75 / accuracy)^2)` (204 for both fixtures at 75 %); `--max-steps` overrides.
- **Runs (seed 1, 1280x800):** both fixtures, perfect 34 steps 34 right 0 wrong finished; wrong 24 steps all wrong, review queue filled and offered; random 62 steps (48 right, 14 wrong) finished; consoleErrors 0 in all six.
- **Screenshots:** `.claude/temp/screens/phase1/<fixture>-<desktop|mobile>/` (perfect + wrong, wrong with `--rounds 2`): 51, 51, 45, 45 PNGs. A sample was looked at (feedback with why, crossword, end screen, review at 390 px): nothing broken. Observation only: the desktop crossword leaves a large empty area left of the grid under the heading.
- **Deviations:** added `--rounds N` (wrong mode, rounds per unit, default 1) and `--verbose`; the JSON has extra fields (`ok, failures, maxSteps, checks, consoleWarnings, viewport`). Console warnings are counted but do not fail. No player bug blocked the bot.
- **Not done / untested:** the review round (`practice`) is not played by the bot (the review screen is opened and checked only); timer and language-switch paths are not driven; keyboard-only play is not covered (EGS-05).
