# EGS-55 changelog

Code
- `src/engine/edu/pipeline.ts`: stage `scenes` between `accepted` and `design` in `STAGES`; `STAGE_OF` (`scenes`, `scenes_check`, `scenes_revise`, `scenes_accepted`); `STAGE_FILES` (`scenes/`, `reviews/scenes_check-*`); the driver after the unit loop (`scenesFlow`, `sceneFlow`, `noScenes`); `sceneCheckName`. Step keys: `scenes:<unit>`, `scenes_check[-k2]:<unit>`, `scenes_revise-k2:<unit>`, `scenes_accepted:<unit>`, and for the finale `scenes:all`, `scenes_check:all` (the same `scenes:all` key is the one skipped step of a course with no scenes).
- `src/engine/edu/pipeline-handlers.ts`: handlers `scenes`, `scenes_check`, `scenes_revise`, `scenes_accepted`; the input builder `sceneCall` (unit title and summary, objectives, scope, the unit's reply items with canonical answers, speakers, `{{language_rules}}`, counts, prefixes) and the `SceneContext` for `checkScenes`; `renderSceneForReview` (exported, next to `renderItemForCheck`); `roleplayFor` hands the section to assemble.
- `src/engine/edu/scenes-stage.ts` (new, pure): `StoredScenes`, reply candidates, `itemInfo`/`itemLine`, `lateItems` (accepted merged, tag `scene`), `mergeSpeakers`, `deriveGarden`.
- `src/engine/edu/assemble.ts`: `AssembleInput.roleplay`; late items appended; roleplay section, catalogs (German to the target catalog, the rest to the source catalog), `roleplay` enabled; a designer that names `roleplay` for a course with no scenes only gets it recorded in `requestedShells`.
- `src/engine/edu/authoring.ts`: `PIPELINE_SHELLS += 'roleplay'` and its comment; `PROMPT_VARS['scene-writer/scenes_revise']`.
- `src/shared/schemas.ts` (format fields `roleplay`, `scenes_per_unit`), `src/shared/brief.ts` (brief field `roleplay`, `ResolvedBrief.roleplay` / `scenesPerUnit`).
- Seeds: `seed/prompts/scene-writer/scenes_revise.md` (new), `seed/config/formats.md` (`roleplay: true`, `scenes_per_unit` on `language-a1` to `language-b2`, a doc bullet), `seed/prompts/game-designer/design.md` (the role-play shell for language courses), `src/engine/store/seedRefresh.ts` (history entries for formats.md and design.md), `src/engine/store/seedMigrations.ts` (`roles-scene-writer-v1`: an edited roles.md without the scene-writer role gets the seed's entry, once).
- Docs: `docs/mcp-guide.md` (steps, brief field, restart stages, "Role-play scenes"), `docs/design.md` (role row), `docs/player.md` ("Generated sections").

Tests
- `tests/pipeline-helpers.ts`: a scene-writer mock (unit and finale, revise), a scenes_check branch of the fact-checker mock with the knob `sceneCheck`; the coach mock's second accepted variant is now `<answer> ja` (the old `<answer>!` normalised to the same text and was dropped by the merge).
- `tests/pipeline.test.ts`: two new cases (P1 + restart idempotence; `roleplay: false` skip + old `steps.json`) and two assertions added to the whole-pipeline case (`scenes:all` skipped with "not a language course", no scene-writer call).
- `tests/seed-refresh.test.ts` (one case extended: formats.md and design.md history, the new prompt), `tests/seed-migrations.test.ts` (one new case for the roles.md migration; the recorded-migration lists gained the new id).
- The existing German pipeline tests (editions, B2 readings, A2) now run the stage on the mock and still pass unchanged.

Decisions and deviations
- Only German courses get scenes (`noScenes`: `targetLang` must be `de`; the prompt's level gates, the register check and the verb tables are German). Any other language course records `scenes:all` as skipped ("role-play scenes are written for German courses only"). The plan says "language courses"; the brief and format flags are generic, the stage is not.
- The finale also goes through `scenes_check` and, when sent back, one `scenes_revise` (the plan only names the writer call). It adds no `scenes_accepted` (no new items).
- A new prompt `scene-writer/scenes_revise` (not in the plan's file list): the revise call needs the previous answer and the reviewer's problems; it is a copy of `scenes` plus two variables.
- Units are written in parallel, so each unit call lists its own speakers; `mergeSpeakers` keeps the first per id and one learner. The finale gets the merged list as known speakers.
- The reviewer's verdict on scenes is not part of the publisher's decision (`P.decision`), only the unit gate in the flow.
- `roleplay` reaches `shells.enabled` from assemble (section exists), not through the game-designer: confirmed by the test, where the mock designer names only `quiz-arena` and `rpg`. `normalizeDesign` itself is unchanged.
- The migration for an edited roles.md was cheap (one migration, one test), so it was added; EGS-39's open note is closed.
- Garden: "13 or more per course" of the plan is not enforced (a word needs a scene occurrence and an answering item; the cap is 6 per unit).

Notes for EGS-57 (German fixture `de-roleplay-a1`, bot)
- Shape of `shells.config.roleplay`: `speakers[{id, name: 'rp.sp.<id>', learner}]` (one learner), `scenes[]` with ids `<unit>-<name>` and `unit`, then the finale with id `finale`, no `unit`, `finale: 'finale'`; lines `l1..ln`, each `next` explicit, last `null`; say lines `{say, text: 'rp.sc.<scene>.<line>', translation: '...<line>.tr', listen: false}`; replies `{reply, help: '...<line>.help', next}` (`youSay` only if the writer gave one: `rp.sc.<scene>.<line>.you`). No audio, no portraits.
- Catalogs: German `text`, `youSay` and the garden word `rp.w.<slug>` in `de.json`; names `rp.sp.*`, titles, settings, `.tr`, `.help`, garden `rp.w.<slug>.gloss` in the source catalog (hr) and, translated, in the other edition (en). Late reply items: `rp-<unit>-<n>`, tag `scene`, `taught: true` (answers in `de.json`, typed answers with an accepted list).
- Garden: `{id: 'w-<slug>', text, gloss, item}`; may be short (only vocabulary that occurs in a scene and is the answer, or part of the answer, of an item of the unit).
- A unit has 8 to 12 lines and 3 to 5 replies per scene (A1: one scene per unit), the finale 10 to 14 lines and 4 to 6 replies, at least one typed reply per unit; the scene `cefr` is the course level.
- The lint of a generated course should have 0 errors (the section is built to pass `validateCourse` and every `RP_*` error check; proven on the mock team only).

DONE: stage, handlers, late items, garden, assemble, `PIPELINE_SHELLS`, formats, brief field, schemas, design prompt, seed history, roles.md migration, docs, tests P1 and P2, `yarn typecheck`, `yarn lint`, `yarn test` (518 tests in 91 files, green on two runs; a first cold run had 10 timeouts of the 15 s limit in pipeline tests that pass alone and on the next runs).
NOT DONE: German fixture and bot (EGS-57); scene audio and portraits (out of scope of HUB-23).
UNTESTED: a real model writing scenes against the two prompts; the quality of the generated German; the client-model loop (`edu_wait`, `edu_get_task`) over the new tasks (the mock-team client-loop test covers a non-language course only); `yarn build` and `yarn test:e2e` (not run: no player or bot change); an upgrade of a real old data folder (the migration is tested on a temp folder).
