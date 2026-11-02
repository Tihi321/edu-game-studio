# EGS-57 changelog

- NEW `tests/fixtures/courses/de-roleplay-a1/course/` (`pack.json`, `text/de.json`, `text/hr.json`, `text/en.json`): the shape the scene generator writes (finale id `finale` with no `unit`, unit scene ids `<unit>-<name>`, lines `l1..ln` with explicit `next`, `rp.sc.<scene>.<line>` / `.tr` / `.help` / `.you`, speakers `rp.sp.<id>`, garden `w-<slug>` with `rp.w.<slug>` in `de.json` and `.gloss` in hr and en). German in `de.json` only. Lints with 0 errors and 0 shell problems (RP_* warnings included). The German is model-written, no native review.
- `tests/bot-roleplay.e2e.test.ts`: `de-roleplay-a1` added to `CASES`; per-case `keys`, `clips`, `watering`; the German case also runs `wrong` and `random`. Timeouts 240 s.
- `tests/lint.test.ts`: fixture added to the golden "lints with no shell problem" list.
- `tests/fixtures/courses/README.md`, `docs/player.md`, `docs/mcp-guide.md`, `ROADMAP.md` (EGS-57 row; EGS-58 noted as reserved, not needed unless the live check finds something).
- `scripts/bot/roleplay.mjs`: not touched. EGS-58: not needed so far.

## Verification
- `yarn typecheck` and `yarn lint`: pass.
- `yarn test`: first run 4 failed (15 s timeouts in the pipeline-run tests, load), second run 91 files and 518 tests pass.
- `yarn test:e2e tests/bot-roleplay.e2e.test.ts`: 6 of 6 pass (hr: perfect, keyboard+axe; de: perfect, keyboard+axe, wrong, random). An earlier run of the same file failed on my own expectations (clips, presses, recovery 8 not 12, gardenRuns), fixed in the test, not in the bot.
- `yarn vitest run tests/lint.test.ts -t "golden fixtures"`: 3 pass.

## Status
- DONE: fixture; e2e perfect, keyboard-only + axe, wrong, random on it; docs; roadmap rows.
- UNTESTED: the real generated German (live check), a human playing, the `letter-<char>` buttons pressed by a bot, the Croatian and English texts reviewed by a native speaker.
