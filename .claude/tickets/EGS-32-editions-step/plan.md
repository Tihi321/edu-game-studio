# EGS-32 Editions in the pipeline (hr + en from one run)

Ticket of the hub plan HUB-22 (`creative-hub/.claude/tickets/HUB-22-edu-start-screen-german/plan.md`). Branch `EGS-32_editions-step`.

## Block from the plan

- **Inputs:** Finding 1 (the data model already holds hr + en editions of one course: `coursePackSchema` has `languages`, `makeTextResolver` falls back to the target-language catalog, `validateCourse` needs a catalog per edition and for the target; what was missing is the pipeline); brief fields `sourceLang`, `languages`.
- **Do:** make the `editions` step real. After `assemble`, for each edition language other than `sourceLang`, a `translator` role (model from `course.md`, `client/claude-code` in the live check) translates **only** the source-edition catalog: every string of `text/<sourceLang>.json`, **excluding** keys that live in the target-language catalog (the taught phrases are not translated), keeping `{{gap}}` markers, `{placeholders}` and keys; `accepted` lists of non-taught keys are translated too. The output is validated (`validateCourse`), the missing keys are re-asked once (repair round), and `pack.languages = [sourceLang, ...editions]`. The player's language picker then offers hr and en. Book Translator stays a manual alternative (documented); the step does not call it. The step is skipped when there is one language.
- **Outputs:** step, handler, prompt, role, docs, tests with the mock provider (hr -> en; validate and lint clean; the taught `de.json` untouched; a run with a missing key repairs), ROADMAP row (also fix the duplicate EGS-18 placeholder row).
- **Contract:** `pack.languages` lists the editions; `text/<lang>.json` exists for each edition and for `targetLang`; lint reports a missing key per edition with `(in en)`.

## Decisions taken while building it

- **Where in the run.** After `voice_generate` and before `build` (the plan says "after assemble, before build"). Reason: the voice step re-links the pack and can add text (alt texts, derived listening items) to the source catalog only; an edition made earlier would lack those keys and the merge would be refused. New stage `editions` (between `voice` and `build`) so `restart from: editions` works.
- **`assemble` stays single-language** (the plan listed `assemble.ts:210` `languages: [sourceLang, ...editions]`): `writeAssembled` validates the pack, which needs every edition catalog, and the translation needs the final text. The step adds the editions with the new `CourseStore.addEditions` (validate first, then write; nothing is written on a problem). `writeAssembled` now removes catalogs of languages the new pack no longer lists, so a restart from assemble is valid.
- **An edition that is the taught language** (for example `languages: [en, hr]` with `targetLang: hr`) is not an edition: its catalog holds only the taught phrases. It is skipped.
- New role `translator` (ROLES, picker list, `config/roles.md`, a seeded agent, prompt `translator/edition`), variables in `PROMPT_VARS`.

## Files

`src/engine/edu/editions.ts` (new, pure: entries, chunks, schema, check, apply), `pipeline.ts`, `pipeline-handlers.ts`, `store.ts`, `authoring.ts` (PROMPT_VARS), `src/shared/schemas.ts`, `src/renderer/ui/roles.ts`, `seed/prompts/translator/edition.md`, `seed/agents/translator-lucia-ferrante.md`, `seed/config/roles.md`, docs (`mcp-guide.md`, `design.md`), comments (`brief.ts`, `assemble.ts`, EditionsTab text), `ROADMAP.md`, tests (`edu-editions.test.ts`, `edu-lint.test.ts`, `roles-config.test.ts`, `pipeline-helpers.ts`).
