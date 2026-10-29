# Changelog: EGS-08

## 2026-10-29: the content pipeline and its MCP tools

`edu_run_pipeline` turns a brief into a published, playable course through the content roles, as resumable file jobs with revise loops and gates. A live run with Claude as the client published a 2-unit "Roman Empire" course for $0.

### edu-game-studio, branch `EGS-08_pipeline` (on `EGS-07_content-roles`)

- `src/shared/brief.ts`: `briefSchema`, `resolveBrief` (format defaults, kids from age, editions recorded).
- `src/engine/edu/pipeline.ts`: state in `pipeline/steps.json`, `advance` (derives next jobs from files, idempotent, serialised per course), status block, `publishDecision` (must-pass, threshold, lint and bot as hard gates), media hooks recorded as skipped.
- `src/engine/edu/pipeline-handlers.ts`: one handler per task (plan, factbase, curriculum, scope, articles, items, distractors, fact_check, articles_revise, items_revise, explain, accepted, design, story, assemble, review_accessibility, review_child_safety, polish, build, lint, playtest, playtest_report, publish, summarize). Job ids `<slug>--<task>[-k<round>]--<unit|all>--r<run>`.
- `src/engine/edu/service.ts`: `pipeline`, `createFromBrief`, `runPipeline` (start, resume, `retry`, `restart` with `from`), research hook.
- `src/engine/mcp/tools-pipeline.ts`, `tools.ts`, `tools-course.ts`, `server.ts`: `edu_run_pipeline`; `edu_create_course` takes a `brief`; `edu_status` and `edu_wait` return a `pipeline` block.
- `src/engine/research/handlers.ts`: `after` callback; `src/engine/edu/authoring.ts`: objectives-per-unit check.
- `seed/prompts/item-writer/items.md`: no empty taught-language line in other courses.
- `docs/mcp-guide.md`: "Make a course from a brief", tool table, status line.
- `README.md`, `ROADMAP.md`: phase 3 status, Done rows for EGS-06 to EGS-08.
- Tests: `pipeline.test.ts`, `pipeline-run.test.ts`, `pipeline-helpers.ts` (a scripted author for the mock model); `edu-mcp`, `research-helpers` adapted.

### Deviations

- No-model steps are jobs of the `director` / `playtester` roles with `noModel`; the playtest is two jobs (bot, then the report).
- `running` and `failed` step states are derived from job files when status is read.
- A fact-check review that names no known id flags every item of the unit.
- No CLI `run-pipeline` (the pipeline needs the engine's queue; the MCP tool starts it).

### Verification

- `yarn typecheck`, `yarn lint`: pass. `yarn test`: 52 files, 746 tests passed (orchestrator run; the implementer's runs had the known EGS-04 `bot.e2e` flake once per full run, passing alone).
- Mock tests: whole pipeline to published (pack validates, lint clean, every item cites existing facts, every article cites; real bot when Chromium launches, it did), fact-check revise passing in round 2 (`-k2` ids), must-pass failure blocking the publish, lint and bot hard gates, resume after an engine restart, retry, restart from a stage, story frame / Scriptorium fake / Scriptorium down, the client loop end to end.
- Live (`run-log.md`): headless engine on 7473, client provider, client search; 30 tasks; fact-check pass, accessibility revise -> polish -> pass; lint 0/0; bot learners passed; 20/20 items cite fact ids; $0; engine stopped.
- Not run: a real web search, a local or paid model, the real Scriptorium, a human playing the course.

### Follow-ups

- Parallel units cannot relate to each other's articles (one repair round seen live).
- The curriculum check does not catch an objective verb ("name its causes") that its facts cannot support.

### Status

Committed on `EGS-08_pipeline`.
