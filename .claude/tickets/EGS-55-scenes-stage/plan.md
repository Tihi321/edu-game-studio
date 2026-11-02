# EGS-55 pipeline stage `scenes`, late items and assemble (HUB-23)

Copied from the approved hub plan `HUB-23-edu-roleplay-generator/plan.md`, section "EGS-55". On the branch `EGS-39_roleplay-generator` with EGS-39 and EGS-56 (uncommitted, the user forbade commits). Open-question defaults D1 to D4 of the plan apply.

## Task (from the plan)
- **Inputs:** EGS-39 contract; findings 3 to 6; `pipeline.ts` unit loop and the `design` step.
- **Do:**
  1. [x] Stage order `... accepted, scenes, design ...`. The stage runs after the per-unit loop has finished for every unit and only when `R.language` and the format/brief allow role-play. Per unit: `scenes` (scene-writer) -> `scenes_check` (fact-checker, D2) -> at most one `scenes_revise` when the check says revise (must-pass gate pattern; a second failure blocks with a note) -> `scenes_accepted` (language-coach `accepted` task for the new typed items only, by `ref`). Then one `scenes` call for the finale over the units' reply items (ids reused, no new items).
  2. [x] Late items: the writer delivers `explanation`, a `why` per wrong choice and a draft `accepted` (the explainer is not re-run). Checks that replace the skipped steps: the authored-item schema, `scenes_check`, `scenes_accepted`, the normal lint. Tag `scene`, ids `rp-<unit>-<n>`, stored in `scenes/<unit>.json` (not in the unit's items file).
  3. [x] Garden in code: per unit, scope vocabulary words that occur in its scenes and have an item that answers them; up to 6 per unit; deterministic.
  4. [x] Assemble: late items merged with `put()`, German to the target catalog (`it.taught && tgt` route), prompts/whys to the source catalog, `shells.config.roleplay` (`speakers`, `scenes`, `garden`, `finale`), `roleplay` added to `shells.enabled`, never in `requestedShells` when the section exists. Catalog keys as the `hr-a1-greetings` fixture names them.
  5. [x] `PIPELINE_SHELLS += 'roleplay'` (and the comment), design prompt, formats (`roleplay`, `scenes_per_unit`), brief field `roleplay`, docs, seed history.
  6. [x] Resume/restart: `restart: true, from: 'scenes'` reruns only the new tasks; an old run without the stage resumes without error; a non-language course records `skip` with the reason "not a language course".
- **Outputs:** [x] pipeline code, handlers, assemble, prompt/format/seed changes, docs, tests, ROADMAP row.
- **Contract:** `shells.config.roleplay` as in `src/shared/shells/roleplay.ts`; format fields `roleplay`, `scenes_per_unit`; brief field `roleplay`; item tag `scene`.

## Acceptance (from the plan) and result
- P1 the stage writes a valid German section: DONE, `tests/pipeline.test.ts` ("a German A1 course gets a valid role-play section ..."), mock provider.
- P2 restart and skip: DONE, same file (restart from `scenes` gives the same scene files byte for byte, the same section and item ids; a non-language course skips with "not a language course" in the existing whole-pipeline test; `roleplay: false` skips with its reason; a `steps.json` without the stage and without `resolved.roleplay` resumes).

## Decisions and deviations
See `changelog.md`.
