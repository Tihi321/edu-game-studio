# Changelog: EGS-07

## 2026-10-29: the content roles, their prompts and output contracts

Every content role has a seeded agent and prompts; every role answer is checked by a zod schema plus a context check, and pure code turns the answers into a course pack that validates, builds and lints clean.

### edu-game-studio, branch `EGS-07_content-roles` (on `EGS-06_roles`)

- `src/engine/edu/authoring.ts`: schemas and `check...()` functions for every role task, `askRole` (repair round for schema issues, one more round with the check problems in words), apply/merge helpers (`applyDistractors`, `applyExplain`, `mergeAccepted`, `applyPolish`, `mergeRevision`, `normalizeDesign`, `numberCitations`), `PROMPT_VARS`.
- `src/engine/edu/assemble.ts`: `assembleCourse` (pack + catalogs with the plan's key names, `extensions.facts` on items, `extensions.pipeline` on the pack, numbered article citations, taught-language answers in the target catalog), `renderCourseForReview`.
- `src/engine/edu/store.ts`: `CourseStore.writeAssembled` (refuses any validation problem).
- `src/engine/edu/lint.ts`: `ITEM_NO_FACT`, `ARTICLE_NO_CITATION` (pipeline packs only).
- `src/engine/edu/playtest.ts`: the bot as learner personas (perfect, wrong, 0.9, 0.75, 0.55), `ChromiumMissingError`, `playtestDigest`.
- `src/engine/studios/scriptorium.ts`, `studios/config.ts`, `seed/config/studios.md`: Scriptorium MCP client (`add_story`, `wait_for_book`), never started.
- `src/engine/engine.ts`, `edu/service.ts`: engine options `scriptorium`, `playtest` (fakes), `edu.scriptorium()`, `edu.playtest(slug)`.
- `src/engine/review/scoring.ts`: `reviewBodyFor(role)`; `store/seedRefresh.ts`: studios.md history hash.
- Seed: 13 agents (all roles covered), 18 prompts.
- `docs/mcp-guide.md`: lint codes.
- Tests: `edu-authoring`, `edu-assemble`, `edu-playtest` (real bot when Chromium launches), `scriptorium` (fake MCP server), fixture helper; `roles-config`, `seed-refresh` adapted.

### Deviations

- Revise rounds return only corrected entries (`mergeRevision`).
- New optional `taught: true` on authored items for language courses.
- Cloze markers in prompts come from the `gap_marker` variable.
- Research questions name the unit by number (units have no ids yet then).

### Verification

- `yarn typecheck`, `yarn lint`: pass. `yarn test`: 50 files, 727 tests passed (orchestrator run). The implementer's full runs hit the EGS-04 `bot.e2e` hr random-75 % flake (passes alone; passed in the orchestrator run).
- Not run: a real model or the real Scriptorium.

### Status

Committed on `EGS-07_content-roles`.
