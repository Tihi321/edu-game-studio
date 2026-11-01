# EGS-27 changelog

## What changed
- `src/shared/course.ts`: `conjugationSchema` (verb, tense, forms with person / label / answer / given, `ask`, `strictDiacritics`), added to the built-in kinds and union. `src/shared/schemas.ts`: `AUTHORED_ITEM_KINDS` + `conjugation`. `src/shared/brief.ts`: the `TODO(EGS-27)` is gone (the filter now only drops kinds the item-writer cannot author).
- `src/shared/edu/checkers.ts` `checkConjugation` + `askedForms`, `kinds.ts` kind def (textRefs, `CONJ_NOTHING_ASKED`). Per form: `matchAnswer` with typos off, `lang` from the context; score = right / asked; `expected` holds every canonical form.
- Authoring: `authoring.ts` `conjugationItem` (forms with `accepted`, `given`, `ask`), `assemble.ts` (catalog keys `item.<id>.verb`, `.form.<person>`, `.form.<person>.label`; German pronoun labels from `PRONOUN_LABELS`; taught content in `de.json`), `pipeline-handlers.ts` (`renderItemForCheck`), `mcp/tools-course.ts` description, `docs/mcp-guide.md`.
- Lint: `lint-conjugation.ts` now also reports `CONJ_PERSON_DUPLICATE`, `CONJ_ASK_TOO_MANY`, `CONJ_IMPERATIVE_PERSON` (de only), `CONJ_FORM_DUPLICATE_AMBIGUOUS` (warning); the EGS-28 checks are connected to the real kind (field names unchanged).
- Player: `items/conjugation.ts` (table, tense badge, letter buttons, mic, Enter moves on, marks and the right form per person), `feedback.ts` (answer lines, `fb.detail.forms`), `debug.ts`, `round.ts` (`gradeOf`: some right, score >= 0.5 -> hard; `timerApplies` false), `i18n.ts` (en, hr), `style/items.css`, `scripts/play.mjs` (bot).
- Studio: `ItemEditor.tsx` tense, `ask` and "given" controls, `lib/items.ts` labels and patch (a removed field is `null`).
- Live quiz: unchanged on purpose; `LIVE_KINDS` already excludes the kind (test added).
- Fixture `tests/fixtures/courses/de-verbs-a1` (hr + en, target de, 5 items) and tests `conjugation.test.ts`, `bot-conjugation.e2e.test.ts`.
- Engine code changed: none of the copied engine beyond the lines above.

## Honest limits
- The German forms in the fixture are written by hand and checked by the EGS-28 table, not reviewed by a native speaker.
- A learner typing the pronoun too ("ich gehe") is wrong by the rules of the plan (the answer is the form without the pronoun); the label beside the input makes this clear.
- The `de` UI table is EGS-34; the tense badge uses en and hr strings.

## Status
- DONE: `conjugation` kind: schema, checker (typos off, lang from context, per-person detail), kind def, authoring, assemble (taught forms in `de.json`), review text, MCP description and guide, four structural lint codes plus the EGS-28 checks on the real kind, player renderer and feedback, grade and timer rules, bot support, studio editor form, live-quiz skip (tested), fixture `de-verbs-a1`, ROADMAP row, docs.
- DONE: tests: `tests/conjugation.test.ts` (19), `tests/bot-conjugation.e2e.test.ts` (4: perfect, wrong, random, keyboard + axe); `pipeline.test.ts` and `edu-course.test.ts` updated for the 14th kind. Full suite with `--maxWorkers=2`: 1889 tests, the only failure left is `tests/pipeline-run.test.ts` restart (times out on master too).
- DONE: `tsc` node / web / player, eslint (0 warnings), `electron-vite build` and the engine vite build.
- NOT DONE: Konjunktiv / B2 tenses (a later ticket); the `de` UI table (EGS-34); the item-writer prompt text for conjugation (EGS-30).
- UNTESTED: the studio form in the real app (only the editor model is tested; no renderer test of the React form); `yarn build` as one command (yarn is not on PATH here: the two halves were run directly); a human playing it; real German review of the fixture forms.
