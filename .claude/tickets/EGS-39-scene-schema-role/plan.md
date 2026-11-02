# EGS-39 scene schema, checks, role and prompt (HUB-23)

Copied from the approved hub plan `HUB-23-edu-roleplay-generator/plan.md` (creative hub), section "EGS-39". Open questions D1 to D4 use the plan's defaults: Option A (reuse existing reply items and add new ones), fact-checker on scenes yes, roleplay on by default for the four language formats, scenes per level A1 1, A2 1 to 2, B1 and B2 2 plus a finale. Work is on the branch `EGS-39_roleplay-generator` together with EGS-56 (the user forbade commits, so both sit uncommitted on one branch).

## Task (from the plan)
- **Inputs:** research sections 1, 3, 4 and "Proposals"; D1 to D4.
- **Do:**
  1. [x] `sceneOutputSchema`: `speakers[]`, `scenes[]` with `lines[]` (say or reply, `next` explicit, `null` ends), `newItems[]` limited to mcq, typed, cloze, order (from B1), each with objective, prompt, explanation, `why` per wrong choice and a draft `accepted`.
  2. [x] `checkScenes()`, pure, returns `Problem[]`. Hard errors: dangling next, unknown speaker, unknown item, unreachable line, no end, no reply, say text or reply answers not German, reply with no help, say line equals a reply answer, du and Sie mixed, scene cefr above the course, scene size, too few typed replies, verb unit whose verbs never appear, vocabulary coverage below `ROLEPLAY_VOCAB_COVERAGE`, plus the checks of new items.
  3. [x] Role `scene-writer`: agent `seed/agents/scene-writer-nina-hartmann.md`, prompt `seed/prompts/scene-writer/scenes.md` with `{{language_rules}}`, level gates, scene count and length, output shape.
  4. [x] `PROMPT_VARS` entry `scene-writer/scenes`, `ROLES` (`src/shared/schemas.ts`), `KNOWN_ROLES` (`src/renderer/ui/roles.ts`), `seed/config/roles.md`, seed history for roles.md.
  5. [x] ROADMAP rows EGS-39 and EGS-55 to EGS-58.
- **Contract (EGS-55 codes against this):** `sceneOutputSchema`, `checkScenes(output, ctx)` / `sceneCheck(ctx)`, `SceneContext`, `SceneItemInfo`, `toRoleplaySection`, role id `scene-writer`, task names `scenes`, `scenes_check`, `scenes_revise`, `scenes_accepted`, `PROMPT_VARS['scene-writer/scenes']`, `ROLEPLAY_VOCAB_COVERAGE`.

## Acceptance and proofs
- S1 `checkScenes` accepts a good answer and reports each fault class: `tests/edu-scenes.test.ts` (golden German A1 answer plus a table of 11 broken ones).
- S2 prompt contract and seed delivery: the existing PROMPT_VARS table in `tests/edu-authoring.test.ts` now includes `scene-writer/scenes`; `tests/seed-refresh.test.ts` (new case) checks the scene-writer files reach a data folder and that a pre-HUB-23 roles.md is replaced.
- `yarn typecheck`, `yarn lint`, `yarn test`: see the changelog.
