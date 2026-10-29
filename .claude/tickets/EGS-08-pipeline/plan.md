# EGS-08: the content pipeline, `edu_run_pipeline` and its MCP tools

Phase 3 of `HUB-19`, third ticket. Branch `EGS-08_pipeline`, stacked on `EGS-07_content-roles`. One commit.

## Goal

From a brief to a published, playable course, through the roles of EGS-06 and EGS-07, as file jobs in the queue: deterministic ids, resumable after a restart or a second `edu_run_pipeline`, revise loops up to `max_rounds`, must-pass gates that stop the publish. Art, music and voice are typed hooks that phase 6 fills; now they are recorded as `skipped`.

## The brief (`src/shared/brief.ts`, zod)

`{topic, audience, age?: number, level?: string, cefr?: A1..C2, sourceLang (default en), languages (default [sourceLang]), targetLang?, shells (default [quiz-arena]), format? (id in config/formats.md, default quick), units? (overrides the format, 1-12), objectivesPerUnit?, itemsPerObjective?, kids? (default: age < 13), story: none|frame|scriptorium (default none), model?: provider/model (written to course.md models['*']), notes?}`. `languages` other than `sourceLang` are recorded; their editions come from Book Translator later (EGS-18): the step `editions` is `skipped` with that reason and the pack's `languages` is `[sourceLang]`.

## Files of a course

`courses/<slug>/course.md` (frontmatter: `brief`, `models`, `run`, `stage`: draft|running|blocked|published|failed; body: the run log the director's summary is appended to), `research/`, `factbase/` (EGS-06), `pipeline/` (one JSON file per step output: `plan.json`, `curriculum.json`, `scope.json`, `units/<unit>/{articles,items,distractors,explain,accepted}.json`, `reviews/<step>-<unit|course>-k<round>-<role>.json`, `design.json`, `story.json`, `playtest.json`, `publish.json`, `steps.json` = `{run, steps: {<step id>: {status: queued|done|skipped|failed|blocked, round, note, at}}}`), then `course/` (pack and text, written by `assemble`) and `build/`.

## Steps and jobs (`src/engine/edu/pipeline.ts`, handlers in `src/engine/edu/pipeline-handlers.ts`)

Job id `<slug>--<task>--<unit or all>--r<run>`; a revise round k >= 2 is `<slug>--<task>-k<k>--<unit>--r<run>`. Research jobs are `<slug>--research--q<hash>--r0` (EGS-06). Every handler writes its step output, updates `steps.json`, then calls `advance(slug)`.

```
plan_brief (director)
  -> research x N (researcher)          one job per question, in parallel
  -> factbase (no model)                mergeNotes; fails when no usable fact
  -> curriculum (curriculum-designer)
  -> scope (language-coach)             language courses only, else skipped
  -> per unit, in parallel:
       articles (subject-expert) -> items (item-writer) -> distractors (misconception-designer)
       -> fact_check (fact-checker, must pass)
            revise and k < max_rounds: articles_revise / items_revise (problems by ref) -> distractors -> fact_check k+1
            revise at max_rounds: unit blocked (must-pass failed)
       -> explain (explainer) -> accepted (language-coach, language courses; else skipped)
  -> design (game-designer)             when every unit is done
  -> story (narrative-designer)         frame or the Scriptorium hand-off; none -> skipped
  -> art, music, voice                  typed hooks (MediaHook), recorded skipped: "phase 6 (EGS-15..17)"
  -> assemble (no model)                writes course/pack.json and text via the course store; must validate clean
  -> audience review: accessibility-reviewer, child-safety-reviewer (kids only) in parallel (must pass)
       revise and k < max_rounds: polish (explainer: flagged text keys only) -> assemble -> review k+1
  -> build (no model) -> lint (no model, errors = hard gate)
  -> playtest (bot personas, then the playtester's report)   bot failure = hard gate
  -> publish (decide(): must-pass, threshold, hard gates; the publisher writes the blurb only when it passes)
  -> summarize (director: summarize_run, appended to course.md)   runs also after a block, to explain it
```

- `advance(slug)` derives the next jobs from `steps.json` and the files, never from memory, and enqueues them (idempotent: deterministic ids). It is what makes a run resumable: `edu_run_pipeline` on a course with a run in progress calls `advance` again; finished steps are not redone.
- Reviewers get `avoid_family` = the model family that wrote the reviewed content (recorded in the step entry from `ctx.model`).
- A failed job (scheduler `failed/`) leaves its dependants queued and blocked; `edu_status` shows the step as failed with the failure text, `edu_wait` returns (existing `waitIdle` handles blocked chains). `edu_run_pipeline {slug, retry: true}` requeues the failed jobs of the current run (`jobs.retry`).
- `restart: true` (optional `from: <step>`) starts run n+1: clears the step outputs from that step on and enqueues from there.
- A blocked gate sets `stage: blocked` with the reasons in `publish.json` and `steps.json`; no `published` flag, no `release` marker.
- Published: `stage: published`, `publish.json {published: true, score, byDimension, blurb, at}`.

## MCP tools

- `edu_create_course` accepts a `brief` (then `slug` defaults to `courseSlug(topic)`, `title` to the topic, languages / sourceLang / subject / audience / targetLang / cefr from the brief) and writes `course.md`; the old arguments still work.
- `edu_run_pipeline {slug, brief?, restart?, from?, retry?}`: creates the course from the brief when it does not exist, writes the brief, starts or resumes the run; returns `{slug, run, enqueued: [job ids], steps}`.
- `edu_status {slug}` gains `pipeline: {run, stage, steps, blockedBy?}`; `edu_wait` returns the same `pipeline` block.
- `edu_get_task`, `edu_submit_task`, `edu_release_task`, `edu_client_tasks` (exist), `edu_ask_researcher`, `edu_factbase_get` (EGS-06).
- `docs/mcp-guide.md`: a "Make a course from a brief" section (the brief fields, the steps, job ids, gates and loops, how to resume, the client-provider loop with the `model: client/claude-code` brief field and the `searcher` tasks), the status line updated to EGS-08.

## Tests (`tests/pipeline.test.ts`, mock provider, fake search provider, fake playtest except where noted)

- The whole pipeline on a fixture brief (2 units, quick format, story frame) reaches `published`; the pack validates, `edu_lint` is clean, every item has `extensions.facts` that exist in the factbase, every article cites; with Chromium installed the real bot passes on the build (else that part is skipped with a message).
- A fact-check `revise` in round 1 sends the unit to `items_revise`, round 2 passes, the course publishes; the job ids of round 2 have `-k2`.
- A must-pass reviewer that always says `revise` stops the publish after `max_rounds`: `stage: blocked`, `publish.json.published` false, the reasons name the role.
- Lint errors and a failed bot are hard gates (fake playtest returning `ok: false`).
- Resume: stop the engine in the middle (after `curriculum`), start a new engine on the same folder, `edu_run_pipeline` again finishes without redoing finished steps (no second `curriculum` call to the mock).
- Story `scriptorium` with the fake client: `handOffStory` called once; with the client down the step is skipped and the run still publishes.
- The MCP tools: `edu_run_pipeline` from a brief, `edu_status` pipeline block, and the client loop: with `model: client/claude-code` in the brief the jobs wait in the client queue and a scripted "client" that answers `edu_get_task` with the mock answers drives the run to `published`.

## Live check (after the tests): see the HUB-19 brief

Headless engine on port 7473 (`EDU_MCP_PORT`), `EDU_DATA` = `.claude/temp/live-egs08`, `EDU_SHARED_KEYS=0`, search order `[client-search]` in that data folder; a 2-unit course on "The Roman Empire" (en), model `client/claude-code`; the orchestrator answers every task over MCP until `published`; build, lint clean, bot passes; the engine is stopped afterwards. Recorded in `run-log.md` next to this plan.

## Acceptance

`yarn typecheck`, `yarn lint`, `yarn test` pass; the tests above exist and pass; the live check is recorded.

## Results

Implemented by the EGS-08 implementer in the worktree `edu-game-studio-p3` on branch `EGS-08_pipeline` (not committed: the orchestrator commits). The "Live check" is the orchestrator's and was not run.

### What was built

- **The brief: DONE.** `src/shared/brief.ts`: `briefSchema` (topic, audience, age, level, cefr, sourceLang, languages, targetLang, shells, format, units, objectivesPerUnit, itemsPerObjective, kids, story none|frame|scriptorium, model, notes) and `resolveBrief(brief, formats)` (format default `quick`, `language-a1` with a `targetLang`; kids from age < 13; the brief over the format). Other `languages` are recorded, the step `editions` is skipped (pack languages = [sourceLang]).
- **State and driver: DONE.** `src/engine/edu/pipeline.ts`: `Pipeline` (`EduService.pipeline`): `start(slug, {restart, from, retry})`, `advance(slug)` (derives the next jobs from `pipeline/steps.json`, the output files and the queue; idempotent, serialised per course; called after every step), `markDone/markSkipped/markBlocked`, `status(slug)` (the `pipeline` block), `decision(slug)`, `flagged(...)`, `publishDecision(reviews, quality, lint, playtest)` (pure: `decide` with the hard gates lint and playtest). Step key `<task>[-k<round>]:<unit|all>`, job id `<slug>--<task>[-k<round>]--<unit|all>--r<run>`, research `<slug>--research--q<hash>--r0`. `MEDIA_HOOKS` (art, music, voice) are recorded as skipped ("phase 6").
- **Handlers: DONE.** `src/engine/edu/pipeline-handlers.ts`, one per task: plan, factbase (no model, fails with a clear message when there is no usable fact), curriculum, scope, articles, items, distractors, fact_check, articles_revise, items_revise, explain, accepted, design, story (frame, or the Scriptorium hand-off; a Scriptorium that is down skips the step), assemble (no model, `CourseStore.writeAssembled`), review_accessibility, review_child_safety, polish, build, lint, playtest (no model, `EduService.playtest`), playtest_report, publish, summarize. Each handler writes its output file, marks its step and calls `advance`. A job of an older run, or of a step that is already finished (the engine stopped right after it), does nothing. `registerResearchHandlers` got an `after` callback so a finished research question marks its step and advances.
- **Flow: DONE.** Per unit articles -> items -> distractors -> fact_check; revise and k < max_rounds: articles_revise / items_revise (only flagged ids change, `mergeRevision`), distractors, fact_check k+1 (job ids `-k2`); a must-pass revise at max_rounds blocks the unit (the other units go on, then the director summarizes). Audience reviews after assemble; a revise goes polish-k+1 -> assemble-k+1 -> review k+1. publish: `decide()`; only a passing course gets the publisher's blurb (`skipModel` keeps the model out otherwise); blocked runs get `publish.json {published: false, reasons}` and step `publish:all` blocked. `summarize` runs after published and after a block.
- **MCP: DONE.** `edu_run_pipeline {slug?, brief?, restart?, from?, retry?}` (`src/engine/mcp/tools-pipeline.ts`, `EduService.runPipeline` / `createFromBrief`): creates the course from a brief in one call (slug from the topic, `course.md` with `brief`, `models["*"]` from `brief.model`, unknown model/format refused with a message), then starts, resumes, retries or restarts. `edu_create_course` accepts a `brief` (the old arguments still work). `edu_status {slug}` and `edu_wait` gain `pipeline: {run, stage, steps, failed?, blockedBy?, next}`.
- **Docs: DONE.** `docs/mcp-guide.md`: status line EGS-08, the tool table, a section "Make a course from a brief" (brief fields, steps, job ids, gates and loops, files, looking, resume/retry/restart, the client loop with the search order), the server instructions name the tool.
- **Not done (not required):** a CLI command `run-pipeline <slug>` (the pipeline needs a running engine and its queue; the MCP tool and the app start it).

### Verification (all run in `edu-game-studio-p3`)

- `yarn typecheck`, `yarn lint`, `yarn build:engine`: pass.
- `yarn test`: 52 files, 746 tests; 745 pass. The one failure is EGS-04's flaky `tests/bot.e2e.test.ts` > hr-a1-greetings > "random: a seeded 75 % learner ..." (passes alone; failed the same way before EGS-06). Before this ticket: 50 files / 727 tests; now +2 files (`pipeline.test.ts`, `pipeline-run.test.ts`) and +19 tests, plus the new helpers `tests/pipeline-helpers.ts` (a scripted course author for the mock provider that answers every role by reading its prompt).
- Covered: the whole pipeline to `published` on a fixture brief (2 units, quick format; pack validates with 0 problems, lint clean, every item has `extensions.facts` that exist in the fact base, every article cites, the research asked 4 questions, each role called once as expected); a children's course (child-safety review); a language course (scope, accepted answers, taught answers in the target catalog); a fact-check revise in round 1 (`-k2` job ids, articles_revise skipped, round 2 passes); a must-pass reviewer that always revises (blocked after max_rounds, the other unit finishes, summary written, no publish); an audience revise (polish, assemble-k2, review-k2 pass, polished text in the catalog); a never-passing audience reviewer (blocked); a failed autoplay bot (hard gate, blurb never asked); the pure `publishDecision` gates (lint errors, a failed or missing bot, must-pass); resume (engine stopped after the curriculum, a new engine on the same folder, `edu_run_pipeline {slug}`: no second plan, curriculum or publish call); a job that fails for good (stage `failed`, the failure text in `edu_status`, `retry: true` finishes); `restart: true, from: "items"` (run 2, new job ids from that stage, earlier steps kept); story `frame`, `scriptorium` (hand-off called once) and Scriptorium down (step skipped, still published); the MCP tools' error messages; the client loop (brief `model: client/claude-code`: every role task waits, `edu_wait` returns with `clientTasks` each time, each task's text is self-contained with a schema, answered with `edu_get_task` / `edu_submit_task` until published, 12 roles seen); and, only when Chromium launches (it did here), the whole pipeline with the real autoplay bot (perfect and the 75 % learner, 0 console errors).
- No test reaches the network (fake search provider, fake `fetchPage`, fake Scriptorium) or starts an app.

### Deviations and notes

- Steps that need no model (factbase, assemble, build, lint, playtest) are jobs of the `director` / `playtester` roles with the scheduler option `noModel`, so they need an agent of that role (the seed has both). The playtest is two jobs: `playtest` (the bot, no model) then `playtest_report` (the playtester's model call), so a long bot run holds no model slot.
- `steps.json` records `queued`, `done`, `skipped`, `blocked`; `running` and `failed` are derived from the job files when `status` is read (the scheduler has no hook for a job that fails for good).
- Research questions are asked by `advance` (idempotent) and each is a step `research:q<hash>`; at most `research_questions_per_unit` per unit are used; `limit` and `no-researcher` mark the question skipped with the reason.
- A fact-check review that names no known item or article id flags every item of the unit for the revise round.
- A polish round with no resolvable text key changes nothing (the reviewers are asked again; `max_rounds` bounds it).
- A prompt tweak: `seed/prompts/item-writer/items.md` no longer prints an empty "phrases in ;" in a course that teaches no language.
- Not run: the live check (a real engine, a real Claude client, the real search): left to the orchestrator.

### For the live run

- Brief: `{topic: "The Roman Empire", audience: "teenagers", sourceLang: "en", units: 2, model: "client/claude-code", story: "none"}` (age optional; with `age` under 13 the child-safety review is added). One call: `edu_run_pipeline {brief}` creates `courses/the-roman-empire/`, writes `course.md` (`brief`, `models: {"*": client/claude-code}`) and enqueues the plan.
- Web search by the client: in the data folder's `config/providers.md` set `search_order: [client-search]` (the `client-search` provider is `enabled: true` in the seed; a change is picked up without a restart). Research jobs then post `searcher` / `web_search` tasks (`edu_get_task {role: "searcher"}`, answer `{results: [{title, url, content}]}` with content of at least 300 characters, else the engine downloads the page itself).
- The loop: `edu_wait {slug}` returns when a model call or a search waits (`clientTasks`, `hint`), `edu_get_task` / `edu_submit_task` until `none`, `edu_wait` again, until `edu_status {slug}` says `pipeline.stage` is `published` or `blocked`. About 30 to 40 tasks for 2 quick units.
- The playtest step runs the real bot (needs Chromium; `EDU_PLAY_SCRIPT` and `EDU_PLAYER_DIR` override the script and the player bundle). Five learners, two at a time.
- Environment: `EDU_DATA` (data folder), `EDU_MCP_PORT`, `EDU_MCP_TOKEN`, `EDU_SHARED_KEYS=0` as in the plan, `EDU_AUTOSTART=0` keeps studios from being started (the pipeline does not use them yet).
- After a block: `edu_status` shows `blockedBy` and `next`; `edu_run_pipeline {slug, restart: true, from: "<stage>"}` redoes from a stage; after a failed job `{slug, retry: true}`.

### Files outside src/engine, seed, docs and tests

`src/shared/brief.ts` (new shared file, in the owned set). Nothing else; renderer untouched.

### Live check (orchestrator, 2026-10-29): DONE

Headless engine on port 7473, fresh data folder in `.claude/temp/live-egs08`, `EDU_SHARED_KEYS=0`, search order `[client-search]` (Tavily and Wikipedia off), brief `model: client/claude-code`. A 2-unit course "The Roman Empire" (en) went from `edu_run_pipeline {brief}` to `published` with 30 client tasks answered by the orchestrator (26 model calls, 4 web searches; $0). Fact-check passed in round 1; the accessibility review asked for a revise and the polish loop (polish-k2, assemble-k2, review-k2) passed live. Lint clean (0 errors, 0 warnings); the bot's five learners passed, and a hand run of the bot (perfect, random 0.75) passed with 0 console errors; every one of the 20 items names existing fact-base ids. The engine was stopped afterwards. The search answers came from the orchestrator's own knowledge, attributed to named Wikipedia and Britannica pages, not fetched. Details and follow-ups: `run-log.md`.
