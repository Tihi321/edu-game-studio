# EGS-37 changelog

## What changed
- `src/shared/lang/de/grammar.ts` (new): 22 connectors in three word-order classes (verb-final, inversion, coordinating), `findConnector` / `connectorClass`, the relative pronoun table (m, f, n, pl x nom, acc, dat, gen) and `relativePronoun(gender, case, prep?)`.
- `src/shared/lang/de/verbs.ts`: `conjugate` knows `passiv-praesens`, `passiv-praeteritum`, `perfekt-passiv`, `konjunktiv2-vergangenheit` and, as a stretch, `konjunktiv1` and `konjunktiv1-vergangenheit`. Passiv exists only for transitive verbs (`hasPassiv`: not sein-aux, modal, reflexive or a short stative list); the others return []. `tenseForCefr` returns `B2` for them.
- `src/engine/edu/lint-grammar.ts` (new, wired in `lint.ts`): `GRAMMAR_FORM_MISMATCH` (relative-pronoun cloze), `GRAMMAR_CONNECTOR_CLASS` (connector cloze and connector sort-groups), `GRAMMAR_TRANSFORM_ONE_ANSWER` (warning), all driven by `extensions.grammar`. `lint-conjugation.ts` takes its tense list from `DE_TENSES`, so the B2 tenses get `CONJ_FORM_MISMATCH` and `CONJ_TENSE_LEVEL`.
- `src/shared/lang/de/rules-b2.ts` (new): B2 prompt text; `rulesFor('de')` appends it to the base rules (one line in `index.ts`; `rules.ts` is untouched so EGS-30 merges by hand).
- Player: tense badge labels for the new ids (en, hr) in `i18n.ts`, `TENSE_KEYS` in `items/conjugation.ts`.
- Docs: `docs/mcp-guide.md`, `ROADMAP.md` row.
- Tests: `tests/de-grammar.test.ts` (26 Passiv, 23 Konjunktiv II past, 21 + 8 Konjunktiv I goldens, full relative table, every connector class), new describe in `tests/edu-lint.test.ts`.

## Honest limits
- The tables are model-written and NOT reviewed by a native speaker; goldens follow from rules (Passiv = werden + Partizip II, K2 past = hätte / wäre + Partizip II, K1 = stem + endings). Variants such as "du wärest" are accepted after the canonical form.
- Konjunktiv I: only the present and the past (sei / habe + Partizip II); no Konjunktiv I of the Passiv or Futur. Verbs in -ern use the plain rule (wandere).
- The Passiv exclusion list is a judgement (e.g. "bekommen", "kennen" excluded).
- Item patterns are enforced only for items that carry `extensions.grammar`; a model that omits it escapes the checks.
- The prompts that use the rules are written by EGS-36 / EGS-30; this ticket only provides the text.

## Status
- DONE: connector table, relative pronoun table, four required tenses, lint codes, B2 rules text and hook, goldens, docs, ROADMAP row.
- DONE (stretch): Konjunktiv I, its goldens pass.
- NOT DONE: native-speaker review.
- UNTESTED: a pipeline run producing B2 grammar items; the player showing the new tense labels in the real app.
