# Changelog: EGS-06

## 2026-10-29: the role engine, research and the fact base

Edu Studio now has the full content-role list, the review contract with quality gates, the research stack from Scriptorium, the course fact base and the fact-checker. The pipeline that uses them comes in EGS-08.

### edu-game-studio, branch `EGS-06_roles` (from `EGS-04_autoplay-bot`)

- `src/shared/schemas.ts`: `ROLES` (15 roles), `qualitySchema`, `formatsSchema`, `AUTHORED_ITEM_KINDS`, factory `research_limit_per_course` and `allow_unverified_facts`, search `wait_minutes`.
- `src/engine/engine.ts`: loads and reloads `quality.md` and `formats.md` (`getQuality`, `getFormats`); builds a `SearchService` (option `searchProviders` for test fakes); passes them to the course service.
- `src/engine/edu/course-meta.ts`, `service.ts`: `course.md` per course with `models` (role or `*`); `courseModel(slug, role)` puts it before the agent's model and the role list (cached, refreshed by mtime). `askResearcher`, `waitJob`, `registerHandlers`.
- `src/engine/review/scoring.ts`: review JSON `{verdict, scores, notes, problems}`, role dimensions, `countsAsRevise`, `weightedScore`, `decide` with must-pass and hard gates, `runReview`.
- `src/engine/research/{web,clientSearch,notes,service,handlers}.ts`: search providers (Tavily, Wikipedia, client-search; Brave and the others are stubs, off), research notes per course, `ResearchService.ask` with job ids `<slug>--research--q<hash>--r0`, the `research` handler ported from Scriptorium.
- `src/engine/edu/factbase.ts`: `factbase/{sources,facts,merged}.md`, stable `f<n>` ids and source numbers, merge with dedupe, unverified facts dropped by default, `toPack`, citation parsers.
- `src/engine/edu/fact-check.ts`: reference pre-check plus the model review.
- `src/engine/mcp/tools-research.ts`: `edu_ask_researcher`, `edu_factbase_get`; `tools-client.ts` tells the client when a task is a web search; `models/client.ts` gains `state(id)`; `registry.ts` reads `wait_minutes`.
- `src/engine/store/seedRefresh.ts`: `SEED_HISTORY` has the skeleton hashes of `roles.md` and `providers.md`.
- Seed: `config/{roles,providers}.md` updated, `config/{quality,formats}.md`, `prompts/_rules.md`, researcher and fact-checker prompts, three agents.
- `docs/mcp-guide.md`: "Research and the fact base".
- `src/renderer/ui/roles.ts`: `KNOWN_ROLES` mirrors `ROLES` (the only renderer change; keep equal in the phase-2 merge).
- Tests: `research`, `clientsearch`, `factbase`, `scoring`, `fact-check`, `course-model`, `roles-config` (new); `edu-mcp`, `models`, `seed-refresh` adapted.

### Deviations

- `courseModel` checks the mtime of `course.md` because the watcher does not cover `courses/`.
- Client web-search tasks are filed under the research job id, so `edu_wait` sees the job as waiting for the client.

### Verification

- `yarn typecheck`, `yarn lint`: pass. `yarn test`: 46 files, 674 tests passed (orchestrator re-run). In the implementer's runs the EGS-04 test `bot.e2e` hr random-75 % failed under load ("element is not stable") and passed alone; it passed in the orchestrator's run. Load-dependent flake of EGS-04, not touched.
- Not run: a live engine with a real search provider or a real client (EGS-08 live check).

### Status

Committed on `EGS-06_roles`.
