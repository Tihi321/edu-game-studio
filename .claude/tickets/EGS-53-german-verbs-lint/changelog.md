# EGS-53 changelog
Files: src/shared/lang/de/verbs.ts, rules.ts; src/engine/edu/lint.ts, pipeline-handlers.ts; seed/prompts/game-designer/design.md; seedRefresh.ts (SEED_HISTORY); tests de-verbs, edu-lint, seed-refresh.
- (a) DONE: sein du Konjunktiv II is wärst / wärest (hättest, wärt/wäret already right). Golden test.
- (b) DONE: the German rules prompt says sein, haben, werden, modals use their own form, never würde + sein/haben; lint table unchanged.
- (c) DONE (no new test; pipeline-run suite has one pre-existing failure on master, "restarted engine"): playtest_report and publish (and its skipModel) re-lint with a rebuild first and rewrite lint.json.
- (d) DONE: option/bank/near-miss comparison folds umlauts only for languages other than de. Test added.
- (e) NOT DONE, nothing to fix: checkArticles already rejects a wrong count (count: articlesPerUnit) on the first answer, for readings too; the B1 run's cause was not found in code.
- (f) DONE: the design step passes all four shells; the prompt describes them; old hash in SEED_HISTORY.
- Verbs: DONE (erheben, fördern, unterstützen, verkürzen, level B1; the table has no B2 level).
- (g) not in scope.
- UNTESTED: a live pipeline run.
