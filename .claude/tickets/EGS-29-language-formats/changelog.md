# EGS-29 changelog

Part of HUB-22 (German course). Branch `EGS-29_language-formats`.

## What changed

- `seed/config/formats.md`: `language-a1` edited (one verb unit, kind `conjugation` listed), `language-a2` (5 units, 4 items per objective, 2 verb units) and `language-b1` (6 units, 2 articles per unit, 2 verb units) added. New optional format fields `verb_units` (default 0) and `verbs_per_unit` (default 6) in `src/shared/schemas.ts`.
- `src/shared/brief.ts`: with a `targetLang` and no `format`, `resolveBrief` picks `language-<cefr>` for A1, A2 and B1 (`language-a1` when there is no `cefr`). B2 fails with "no format for B2 yet" (until EGS-36), C1 and C2 with "out of scope (HUB-22)". A named format always wins; a brief without `targetLang` is unchanged. `ResolvedBrief` gets `verbUnits` (capped at the course's units) and `verbsPerUnit`. The stale "only quiz-arena" comment is fixed.
- `conjugation` handling: it does not exist as an authored kind until EGS-27. The formats list it (so EGS-27 needs no format change), and `resolveBrief` leaves it out of `itemKinds` (the kinds the item-writer is asked for and `checkItems` allows) with a `TODO(EGS-27)` in `brief.ts`. Once EGS-27 adds it to `AUTHORED_ITEM_KINDS` the filter does nothing. `tests/roles-config.test.ts` allows it in the seed file for the same reason.
- Curriculum: the unit schema gets an optional `verb: true`; the curriculum prompt gets `{{verb_units_note}}` (empty for a format without verb units); `checkCurriculum` fails when the number of marked units differs from `verbUnits`. The scope prompt gets the same variable and a `[VERB UNIT]` marker in the unit lines; the scope schema gets `verbs: [{inf, tense, level}]` (vocabulary may now be empty for a verb unit; `checkScope` requires verbs for verb units and vocabulary for the others). The item-writer sees the verbs in `{{scope}}`.
- Assemble: `pack.extensions.language = { verbUnits: [unit ids], verbsPerUnit }` for a language course with verb units.
- Docs: `docs/mcp-guide.md` (brief and formats). ROADMAP row.

## Seed-sync investigation (the live check depends on it)

The plan said seeds are copied only when absent. That is true only for `agents/` (the starter staff, kept as is on purpose; the ROADMAP "Later" line is about that). For everything else `initDataFolder` (`src/engine/store/dataFolder.ts`) already runs `syncSeedFile` (`src/engine/store/seedRefresh.ts`) at every start: a missing file is copied; a file that is still as it was seeded is updated; an edited file is kept and listed in `updateAvailable` (`.seed-hashes.json`).

So `config/formats.md` and `prompts/**` reach an existing `~/EduGames` at the next start of the app or the engine, without any manual step, **if** the data-folder copy was never edited. The catch: a data folder made before `.seed-hashes.json` existed has no recorded hash, and an unedited file is only recognised through `SEED_HISTORY`. Fix made: `SEED_HISTORY` now has the previous sha1 of `config/formats.md`, `prompts/curriculum-designer/curriculum.md` and `prompts/language-coach/scope.md` (the three seed files this ticket changes), so such a folder is updated too. `tests/seed-refresh.test.ts` lists the history keys.

Manual steps for the live check: (1) restart Edu Studio so `initDataFolder` runs; (2) look at `updateAvailable` in `~/EduGames/.seed-hashes.json`: any file listed there was edited by the user and was NOT updated (typical: `config/formats.md` if language-a1 was tuned). For those, copy the seed file over by hand (or merge `language-a2`, `language-b1` and the verb fields into the user's file); (3) the engine reloads `config/formats.md` within seconds, prompts are read at each job. Agents (`agents/`) are not touched by this ticket.

## Tests

- `tests/pipeline.test.ts`: `resolveBrief` per CEFR on the real seed formats (A1, A2, B1, B2 error, C1/C2 error, named format wins, non-language brief, verb-unit numbers, `conjugation` left out); a mock-provider pipeline run on `language-a2` (3 units) gives `extensions.language = {verbUnits: [u1, u2], verbsPerUnit: 6}` and verbs in `scope.json`.
- `tests/roles-config.test.ts` (formats), `tests/seed-refresh.test.ts` (history keys), `tests/pipeline-helpers.ts` (the mock curriculum-designer and language-coach understand verb units).
- The plan names `tests/edu-brief.test.ts`; the brief tests of this repo live in `tests/pipeline.test.ts`, so they were added there.

## Verification

- typecheck (node, web, player): clean. lint (eslint .): clean.
- Tests: the machine was saturated by parallel workers (100+ headless browsers), so the full `yarn test` could not be finished in one run (the first run had e2e bot tests time out; the later full runs never completed). What ran green: tests/pipeline, roles-config, seed-refresh, edu-authoring (64 tests); tests/edu-*.test.ts, seed-*, languages, models, custom-providers, clientsearch, pipeline-run, mcp-config (22 files, 369 of 370 tests pass); voice-pipeline and player-shell-picker.e2e (12 tests) pass alone.
- One failure, **not caused by this ticket**: tests/pipeline-run.test.ts "a restarted engine on the same folder finishes the run" (timeout waiting for the course to be published). It fails identically with this ticket's changes stashed (master).
- The e2e bot suites (bot*.e2e, live-quiz, classroom ...) were not re-run to the end: they do not touch brief, formats, prompts or seeds. yarn build was not run.

## DONE / NOT DONE / UNTESTED

- DONE formats `language-a1` (edited), `language-a2`, `language-b1`; `verb_units` / `verbs_per_unit` fields.
- DONE `resolveBrief`: `language-<cefr>`, B2 and C1/C2 errors, verb-unit numbers.
- DONE curriculum and scope prompts and checks carry verb units; `extensions.language` in the assembled pack.
- DONE seed-sync investigation and fix (history hashes); manual step documented above.
- DONE docs, ROADMAP row, tests.
- DONE `conjugation` handled without breaking validation (listed in formats, left out of the asked kinds until EGS-27).
- NOT DONE B2 format (EGS-36), the German rules text (EGS-30), the conjugation kind (EGS-27): out of this ticket.
- NOT DONE a clean full `yarn test` run (see Verification); the one failing test fails on master too.
- UNTESTED in the real app: a real data folder refresh (`~/EduGames` was not touched); a pipeline run with a real model on `language-a2`; the item-writer actually using the verbs in `{{scope}}`.
