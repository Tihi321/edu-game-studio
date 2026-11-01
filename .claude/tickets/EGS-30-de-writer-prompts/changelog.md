# EGS-30 changelog: German grammar rules in the writer prompts

## Changed
- `src/shared/lang/de/rules.ts`: the placeholder of EGS-28 is replaced by the real rules text (`DE_PROMPT_RULES`: nouns and articles, cases by level, verbs, sentences, spelling, register, accepted answers, misconceptions of Croatian and English speakers, sources, feedback) and `DE_ITEM_SHAPES` (the authored `conjugation` shape with an example; the example is parsed by `authoredItemSchema` in a test).
- Where the text lives: in code (`rules.ts`), not in `seed/config/language-rules/de.md`. Reason: it is bundled with the engine, so it needs no seed refresh and cannot drift from the lint, which the text names (CONJ_* codes). The plan allowed either.
- `src/shared/lang/index.ts`: `LanguageRules.itemShapes?`, `languageRulesText(targetLang, forWriter)` (rules, plus the item shapes for the item-writer; empty string for a language without rules).
- `src/engine/edu/authoring.ts`: `language_rules` added to the `PROMPT_VARS` of item-writer `items` / `items_revise`, language-coach `scope` / `accepted`, misconception-designer `distractors`, explainer `explain`.
- `src/engine/edu/pipeline-handlers.ts`: a `rules(h, forWriter)` helper fills the variable in the items, items_revise, scope, accepted, distractors, explain handlers and passes `languageRules` to the fact check. `src/engine/edu/fact-check.ts`: `FactCheckInput.languageRules`, variable `language_rules` of `fact-checker/fact_check`.
- Prompts (`seed/prompts/...`): a "Language rules" block with `{{language_rules}}` in the seven prompts above and `fact_check.md`, each telling the role which part to use; agent `language-coach-ines-markovic.md` mentions the rules.
- `src/engine/store/seedRefresh.ts`: `SEED_HISTORY` gets the hashes of the previous versions of the seven prompts and the agent, so an untouched data folder is updated and an edited one is only flagged.
- Tests: `tests/edu-authoring.test.ts` (rendered prompts for `de`: rules, plus the conjugation shape for the item-writer only; for `hr`, `en`, none: neither; the example item is valid), `tests/roles-config.test.ts` (fact-check variables), `tests/seed-refresh.test.ts` (history keys). Docs: `docs/mcp-guide.md` (Languages), ROADMAP row.
- Hub plan note: the plan's example puts `given` persons outside `forms`; the real schema (EGS-27) requires them to be in `forms`, so the prompt shows them inside.

## Verification
typecheck (node, web, player) and eslint clean; `edu-authoring`, `roles-config`, `seed-refresh`, `de-verbs` pass; the pipeline and edu test files were run at 2 workers (335 tests, 334 pass; the one failure is the known `pipeline-run` restart timeout of master).

## Status
- DONE: rules text; `{{language_rules}}` in all handlers and prompts; conjugation shape in the item-writer prompt; empty for other languages; seed refresh history; tests; docs; ROADMAP.
- NOT DONE: a native-speaker review of the German rules text and examples (none available); the review renderer needed no change (it already renders `conjugation` from EGS-27).
- UNTESTED: a real model run with the rules (mock provider only); whether a live data folder with edited prompts gets the new block (only flagged as an update, by design).
