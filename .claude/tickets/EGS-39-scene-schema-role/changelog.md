# EGS-39 changelog

- `src/engine/edu/scenes.ts` (new): `sceneOutputSchema`, `checkScenes`, `sceneCheck`, `toRoleplaySection`, `looksNotGerman`, constants (`SCENE_LINES` 8 to 12, `SCENE_REPLIES` 3 to 5, `FINALE_LINES` 10 to 14, `FINALE_REPLIES` 4 to 6, `defaultScenesPerUnit`, `sceneItemKinds`, `SCENE_TASKS`, `SCENE_WRITER_ROLE`).
- `src/shared/shells/roleplay.ts`: exports `ROLEPLAY_VOCAB_COVERAGE` (0.5), used by `checkScenes` and the EGS-56 lint.
- `src/shared/lang/de/register.ts` (new): `registerOf` (du / Sie), shared with the EGS-56 lint.
- `src/engine/edu/authoring.ts`: `ident` exported; `PROMPT_VARS['scene-writer/scenes']`.
- `src/shared/schemas.ts` (`ROLES`), `src/renderer/ui/roles.ts` (`KNOWN_ROLES`), `seed/config/roles.md` (role + body), `seed/agents/scene-writer-nina-hartmann.md`, `seed/prompts/scene-writer/scenes.md`.
- `src/engine/store/seedRefresh.ts`: roles.md history gets the pre-scene-writer hash.
- Docs: `docs/design.md` (role table). ROADMAP rows EGS-39, EGS-55 to EGS-58.
- Tests: `tests/edu-scenes.test.ts` (new: golden + 11 broken answers + a verb case, 13 tests), `tests/seed-refresh.test.ts` (one new case), the existing PROMPT_VARS table of `tests/edu-authoring.test.ts` covers the new prompt.

Deviations: the plan lists an `askRole` check helper `sceneCheck` in `authoring.ts`; it is in `scenes.ts` (scenes.ts imports authoring.ts, so the reverse import would be a cycle). No seed migration for an edited roles.md (see notes).

Notes for EGS-55: an edited roles.md without `scene-writer` gets an empty model list for the role (the course model `client/claude-code` still works); the stage may want a seed migration adding the role.

DONE: schema, checks, role, agent, prompt, PROMPT_VARS, seed history, ROADMAP rows, tests. NOT DONE: pipeline wiring (EGS-55). UNTESTED: a real model writing scenes against the prompt; the quality of the generated German; an upgrade of a real old data folder.
