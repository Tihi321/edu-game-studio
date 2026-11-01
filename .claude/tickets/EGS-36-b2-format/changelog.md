# EGS-36 changelog: B2 format, readings, glossary harvest, self-check

- Format `language-b2` (6 units, 3 objectives, 5 items, 2 readings per unit, 1 verb unit); new format fields `reading`, `reading_words`, `glossary_per_text`; `language-b1` reads too (200-400 words, 6-12 glosses). `resolveBrief`: B2 selects `language-b2`, C1/C2 still error.
- Prompt `subject-expert/reading.md` (used when the format has `reading: true` in a language course); readings are German, in the target catalog; assemble writes `shells.config.encyclopedia.glossary` (terms/lemmas to `de`, glosses/notes to the source catalog), `reader: true`, enables the encyclopedia shell, records `extensions.language.reading`.
- Authored items get `passage`, `tags`, `grammar` (for EGS-37's lint); checks for tfng options, passage links, self-check model answers, 4 items per reading; item-writer gets `reading_note` and numbered paragraphs.
- Pipeline step `harvest` (after the audience reviews, before voice/editions; skipped without readings): `src/engine/edu/harvest.ts`, ids `<articleId>-gl-<n>`, tag `gloss`, `extensions.gloss`; idempotent; honours `glossOff`. Player: hidden cards are not asked (`canAsk`, `startRound exclude`).
- Self-check flashcards show `selfcheck.hint` (en, hr) and are graded only by the learner.
- Lint (new file `lint-reading.ts`): READING_LENGTH, READING_SENTENCE_LENGTH, READING_ITEM_NO_PASSAGE, READING_ITEM_COUNT, TFNG_OPTIONS, SELFCHECK_NO_MODEL.
- B2 rules text in `src/shared/lang/de/rules-b2.ts` (code, like `rules.ts`, not a seed file), appended by `languageRulesText(.., cefr)`.
- Changed engine code outside the ticket: `voice.ts` derived listening items no longer inherit the tags reading/tfng/self-check/gloss (they tripped READING_ITEM_NO_PASSAGE); fixture `de-b2-reading` tfng items got `shuffle: false`.

## Status
- DONE: format and brief; reading prompt and assembly; harvest step (deterministic, idempotent, glossOff); self-check hint and R5; six lint codes each with a failing test; mock-provider B2 run (readings 300-800 words, glossaries, 40 harvested cards, lint clean); B2 rules text.
- NOT DONE: hr/en `de` UI string for `selfcheck.hint` (de table is EGS-34); `glossOff` is not read by the engine from a learner's file (only by the player and the `harvest` option).
- UNTESTED: real model output (readings are mock text), a real player session of the harvested deck and self-check card in the browser, whether the German is really B2 (not natively reviewed). Existing data folders keep their old `formats.md` until it is refreshed.
