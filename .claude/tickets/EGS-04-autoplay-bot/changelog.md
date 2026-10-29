# EGS-04 changelog

## 2026-10-29: EGS-04 autoplay bot plays both golden fixtures in three modes with 0 console errors

Branch `EGS-04_autoplay-bot` (stacked on `EGS-03_player-runtime`).

### What changed

- `scripts/play.mjs`: headless Chromium (Playwright) bot over `file://` with `?seed=N`; modes `perfect` (all units to 3 stars, boss, end screen, review queue stays empty), `wrong` (checks feedback, the chosen distractor's `why`, the answer and explanation, the review queue and the review screen), `random` (seeded learner at `--accuracy`, must finish within `maxSteps = ceil(6 * (units * roundLength + bossLength) * max(1, 0.75/accuracy)^2)`); fails on console errors, page errors, failed local requests, stuck screens and horizontal overflow; screenshots per screen and item kind; JSON summary; options `--shots`, `--viewport`, `--max-steps`, `--rounds`, `--verbose`, `--json`.
- `src/player/debug.ts` + `engine.ts` + `types.ts`: read-only `window.EduEngine.debug.solve(itemId)` / `.wrong(itemId)` (shared `solveItem` in the page) so the bot needs no TS.
- `tests/bot.e2e.test.ts`: builds both fixtures with the real player bundle and runs the bot in all three modes on each (6 runs) plus a bad-folder check.
- `package.json` (`play` script), `README.md` (Autoplay bot section, status), `docs/player.md` (debug hook), `ROADMAP.md` (phase 0 and 1 moved to Done).

### Deviations

- Extra options `--rounds` and `--verbose`; console warnings are counted, not failed.
- The bot opens the review screen but does not play the practice round; timer, language switch and keyboard-only play are not driven (keyboard-only bot play is EGS-05).

### Verification

- `yarn typecheck` exit 0, `yarn lint` exit 0, `yarn test` 39 files / 594 tests passed incl. the e2e (orchestrator re-run); `yarn build` (Electron) succeeded.
- Bot (seed 1, 1280x800): solar-system and hr-a1-greetings each: perfect 34 steps, 34 right, finished; wrong 24 steps, all wrong, review queue filled and offered; random 62 steps (48 right, 14 wrong), finished; consoleErrors 0 in all six.
- Screenshots (gitignored): `.claude/temp/screens/phase1/{solar-system,hr-a1-greetings}-{desktop,mobile}/` (51, 51, 45, 45 PNGs), sampled and looked at.
- Orchestrator: `node out/engine/index.js --mcp-only` with `EDU_DATA` under `.claude/temp/` listened on 7463; real HTTP `initialize` + `tools/list` returned 27 `edu_*` tools; `edu_import_course`, `edu_build`, `edu_lint` on solar-system over HTTP all ok (0 errors); stopped, port free, no `~/EduGames` created.

Not run: `yarn dev` window opened interactively; real audio output; touch devices.

### Commit status

Committed as one commit on `EGS-04_autoplay-bot` (not pushed).
