# EGS-07: the content roles, their prompts and output contracts

Phase 3 of `HUB-19`, second ticket. Branch `EGS-07_content-roles`, stacked on `EGS-06_roles`. One commit.

## Goal

Every content role exists as a seeded agent with a persona and prompt templates, and every role's answer is a JSON object checked by a zod schema and turned into course-pack data by pure, tested code. Items carry answer keys, a `why` per distractor and the fact ids they rest on; articles cite fact-base ids. The EGS-08 pipeline only wires these functions into jobs.

## Roles, tasks and outputs

Seed one agent per role (`seed/agents/<role>-<first>-<last>.md`, an invented name, a short persona: what they care about, how they write; two item-writers is fine) and the prompts `seed/prompts/<role>/<task>.md` (frontmatter `kind: prompt, role, task`; body with `{{vars}}`; it ends with the exact JSON shape). Each prompt names the variables it uses; a test checks that every variable a handler passes is used and every `{{var}}` in a template is passed.

| Role | Task(s) | Output (zod, in `src/engine/edu/authoring.ts`) |
|---|---|---|
| director | `plan_brief` | `{title, summary, units: [{title, focus}], research: [{question, unit}]}` (units = the brief's count; 1-3 research questions per unit) ; `summarize_run` exists (keep) |
| curriculum-designer | `curriculum` | `{units: [{id, title, summary, requires}], objectives: [{id, unit, bloom, text, facts: [fact ids]}]}`; checks: ids valid and unique, `requires` acyclic and known, every objective has >= 1 existing fact, every unit >= 1 objective |
| language-coach | `scope` (language courses), `accepted` | `scope`: per unit `{vocabulary: [{term, gloss}], grammar: [string]}` (CEFR-pitched) stored for the item-writer; `accepted`: `{answers: [{ref, accepted: [..]}]}` alternatives for typed/cloze answers (code merges, keeps the canonical first) |
| subject-expert | `articles`, `articles_revise` | `{articles: [{id, unit, title, body, related: []}]}`; the body cites `[fN]`; code: every citation exists, >= 1 per article, citations array = cited ids in order of first use |
| item-writer | `items`, `items_revise` | `{items: [AuthoredItem]}` (below); code: >= 2 distinct kinds per objective, every item has `facts` (>= 1, existing), answer keys valid, unique ids, objective known |
| misconception-designer | `distractors` | `{items: [{id, options?: [{id, text, why}], why?}]}`: replaces the distractors of choice items (mcq, multi-select) and the `why` of true-false; code keeps every right option (id and text) unchanged, requires a `why` for every wrong option and at least 2 distractors for an mcq |
| explainer | `explain`, `polish` | `explain`: `{items: [{id, explanation, hint?, didYouKnow?, didYouKnowFact?}]}` (a `didYouKnow` must name an existing fact id); `polish`: `{strings: {<text key>: text}}` only for the keys a reviewer flagged (code drops other keys) |
| fact-checker | `fact_check` (EGS-06) | review JSON |
| accessibility-reviewer | `review` | review JSON, scores `accessibility`, `readability` (reading level for the audience, plain wording, no meaning carried by colour only, alt text present for every image asset, answers not given away by length) |
| child-safety-reviewer | `review` | review JSON, score `age_fit`; reviews only kids' courses (the brief's `kids`) |
| game-designer | `design` | `{shells: [shell ids], quizArena: {roundLength, bossLength, timerSeconds?}, difficulty: [{item, difficulty 1-5}], notes}`; code clamps to the player's limits (round 3-12, boss 4-20), keeps only known shells (`quiz-arena` now; others are recorded in `shells.config` for later tickets) |
| narrative-designer | `frame`, `scriptorium_brief` | `frame`: `{premise, characters: [{name, role, description}], intro, outro, unitBeats: [{unit, beat}]}` -> `pack.extensions.story` + catalog keys `story.*`; `scriptorium_brief`: `{idea, audience, length}` for the hand-off below |
| playtester | `report` | review JSON plus `deadEnds: [string]`, scores `flow`, `difficulty`; input: the bot summaries of the learner personas |
| publisher | `publish` | `{blurb, notes}` (the decision itself is code: `decide()`) |

`AuthoredItem` (inline text, converted to catalog keys by code): common `{id, objective, kind, prompt, explanation, facts: [fact ids] (min 1), hint?, didYouKnow?, difficulty?}` plus per kind: `mcq {options: [{id, text, why?}], answer}`, `true-false {answer: boolean, why?}`, `multi-select {options, answers}`, `cloze {text with {{gapId}}, gaps: [{id, accepted: [..], bank?: [..]}]}`, `typed {accepted: [..]}`, `match-pairs {pairs: [{id, left, right}]}`, `order {items: [{id, text, when?}], timeline?}`, `sort-groups {groups: [{id, title}], items: [{id, text, group, why?}]}`, `flashcard {back}`. (Hotspot and listening need assets: phase 6. Crossword and word search are built by code later.)

## Assembly (pure functions, `src/engine/edu/assemble.ts`)

`assembleCourse({brief, plan, factbase, curriculum, articles, items, explain, accepted, design, story}) -> {pack, catalogs}`: builds the pack and the source-language catalog (and the target-language catalog for a language course: accepted answers of the taught language go there). Key names: `course.title`, `unit.<id>.title|summary`, `obj.<id>.text`, `item.<id>.prompt|expl|hint|dyk|why`, `item.<id>.opt.<optId>` and `.why`, `item.<id>.text` (cloze), `item.<id>.gap.<gapId>` (accepted), `item.<id>.answer` (typed accepted), `item.<id>.pair.<pid>.l|r`, `item.<id>.step.<sid>` and `.when`, `item.<id>.group.<gid>`, `item.<id>.entry.<eid>` and `.why`, `item.<id>.back`, `art.<id>.title|body`, `fact.<id>.claim`, `story.*`. Every item gets `extensions.facts` (its fact ids) and `tags: ['unit:<id>']`; objectives get `facts`; the pack gets `factbase` from `factbase.toPack`, `encyclopedia.articles` with `citations`, `extensions.pipeline: {run, generatedBy: 'edu-pipeline', brief}`. Article bodies: `[fN]` markers become `[1]`, `[2]` in order of `citations`. The result must pass `validateCourse` with no problem at all; a test assembles a fixture of authored outputs into a pack that validates, builds and lints clean (`svc.courses` import + build + lint with the fake player bundle, as the EGS-03 tests do).

## Lint addition (`src/engine/edu/lint.ts`)

`ITEM_NO_FACT` (error): in a pack made by the pipeline (`extensions.pipeline` present) an item without `extensions.facts`, or with a fact id that is not in `factbase`. `ARTICLE_NO_CITATION` (error, same condition): an article without citations or citing an unknown fact. Hand-made packs (the golden fixtures) are not affected. Add both to the lint table in `docs/mcp-guide.md`.

## Scriptorium hand-off (`src/engine/studios/scriptorium.ts`)

A small MCP-over-HTTP client (reuse `studios/mcp-http.ts`) for Scriptorium at `http://127.0.0.1:7341/mcp` (`config/studios.md` `scriptorium.url`, override `EDU_SCRIPTORIUM_URL`). `status()` (is it up), `handOffStory({idea, audience, length})` -> calls Scriptorium's story tool (read the tool names and arguments in `../scriptorium/src/engine/mcp/tools.ts`: `add_story` / `get_book` / `wait_for_book`; do not guess) and returns the book slug. **Never start Scriptorium** (it is not in the autostart list; a down Scriptorium makes the story step `skipped` with the reason). Only used when the brief asks for `story: "scriptorium"`. A fake in the tests; no test calls the real one.

## Playtest runner (`src/engine/edu/playtest.ts`)

Runs the autoplay bot (`scripts/play.mjs`, the same Node that runs the engine, `--json`) on a build folder for learner personas: `perfect` (must finish), `wrong` (explanations shown, review queue fills), `random` at accuracy 0.9 (strong), 0.75 (average) and 0.55 (struggling) with fixed seeds. Returns the summaries plus `ok` (perfect and wrong pass, every random run finishes, 0 console errors in all). Injectable (`EduDeps.playtest`) so tests can use a fake; one test uses the real runner when Chromium is installed (skip with a message otherwise, as `bot.e2e.test.ts` does). Exit code 3 (no Chromium) -> a clear "install Chromium: yarn playwright install chromium" failure, not a crash.

## Tests

Schema and converter tests for every role output (good fixture passes; each rule above rejects a bad one with a readable message that the repair round can send back); the assembly fixture; the prompt variable check; every role in `ROLES` has an agent and its prompts; the lint additions; the Scriptorium client against a fake MCP server; the playtest runner (fake plus the real one when Chromium is there).

## Acceptance

`yarn typecheck`, `yarn lint`, `yarn test` pass. The seeded data folder has an agent for every role.

## Results

Implemented by the EGS-07 implementer in the worktree `edu-game-studio-p3` on branch `EGS-07_content-roles` (not committed: the orchestrator commits).

### What was built

- **Output contracts and checks: DONE.** `src/engine/edu/authoring.ts` has a zod schema for every role answer (`planSchema`, `curriculumSchema`, `scopeSchema`, `acceptedSchema`, `articlesSchema`, `itemsSchema` / `authoredItemSchema` for the nine authored kinds, `distractorsSchema`, `explainSchema`, `polishSchema`, `designSchema`, `frameSchema`, `scriptoriumBriefSchema`, `playtestReportSchema`, `publishSchema`) and, for what a schema cannot see, `check...()` functions returning `Problem[]` (`{ref, issue, fix?}`): `checkPlan`, `checkCurriculum`, `checkScope`, `checkAccepted`, `checkArticles`, `checkItems`, `checkDistractors`, `checkExplain`, `checkFrame`. Pure apply and merge functions: `applyDistractors`, `applyExplain`, `mergeAccepted`, `applyPolish`, `mergeRevision` (a revise round replaces only flagged ids), `normalizeDesign`, `numberCitations`. `askRole(ctx, {dataDir, role, task, vars, schema, check})` builds the prompt, asks (`chatJson`: one repair round for schema issues), runs the check and sends the problems back once in words (`formatProblems`); a problem that remains throws with the list. `PROMPT_VARS` is the contract between a handler and each template (a test keeps both equal). Schema messages are written for the model that reads them in the repair round ("answer "z" is not one of the option ids (a, b, c)").
- **Assembly: DONE.** `src/engine/edu/assemble.ts`: `assembleCourse(input) -> {pack, catalogs, itemKeys}` with the key names of the plan; `renderCourseForReview(pack, catalogs, lang)` gives the reviewers `[key] text` lines so a problem can name a text key (the polish round changes only flagged keys). Language courses: an item with `taught: true` keeps its answers (options, cloze text and gaps, typed answers, pair sides, steps, entries, back) in the target-language catalog. `CourseStore.writeAssembled(slug, pack, catalogs)` writes the files, refusing any validation problem.
- **Lint additions: DONE.** `ITEM_NO_FACT` and `ARTICLE_NO_CITATION` (errors, only when `pack.extensions.pipeline` is set; hand-made packs and the golden fixtures are not affected); in `LINT_CODES`, the header comment and the lint table of `docs/mcp-guide.md`.
- **Prompts and agents: DONE.** 18 prompts (`director/plan_brief`, `curriculum-designer/curriculum`, `language-coach/{scope,accepted}`, `subject-expert/{articles,articles_revise}`, `item-writer/{items,items_revise}`, `misconception-designer/distractors`, `explainer/{explain,polish}`, `game-designer/design`, `narrative-designer/{frame,scriptorium_brief}`, `playtester/report`, `accessibility-reviewer/review`, `child-safety-reviewer/review`, `publisher/publish`); each ends with the exact JSON shape. 13 new seed agents (two item-writers), so every role of `ROLES` has an agent.
- **Scriptorium client: DONE.** `src/engine/studios/scriptorium.ts`: `createScriptoriumClient({url, token?, fetchImpl?})` -> `status()`, `handOffStory({idea, audience, length, title?}) -> {story}`, `waitForStory(story, {timeoutSeconds?}) -> {done, reason, story, book, title, stage, folder}`. Real tool names read from Scriptorium's `src/engine/mcp/tools.ts`: `add_story {title?, premise, style, setting}` (returns `{slug}`) and `wait_for_book {slug, timeout_seconds, stop_on_client_task}`. No `ensureUp`, not in the autostart list; down is `ScriptoriumError` kind `down` with the start hint. Config: `scriptoriumUrl` (default `http://127.0.0.1:7341/mcp`, env `EDU_SCRIPTORIUM_URL`) and `scriptoriumToken` (env `SCRIPTORIUM_MCP_TOKEN`) in `config/studios.md`. Engine option `scriptorium` (fake), `EduService.scriptorium()`.
- **Playtest runner: DONE.** `src/engine/edu/playtest.ts`: `runPlaytest(buildDir, {personas?, playScript?, node?, timeoutMs?, concurrency?, signal?, env?})`, personas perfect, wrong (2 rounds), strong 0.9, average 0.75, struggling 0.55 with fixed seeds; `ok` = every persona passed and no console error; exit code 3 throws `ChromiumMissingError` ("install it with yarn playwright install chromium"); `playtestDigest(result)` is the text for the playtester prompt; `findPlayScript` (`EDU_PLAY_SCRIPT` overrides). Engine option `playtest` (fake), `EduService.playtest(slug)` plays `courses/<slug>/build`.

### Verification (all run in `edu-game-studio-p3`)

- `yarn typecheck`: passes. `yarn lint`: passes. `yarn build:engine`: passes.
- `yarn test`: 50 files, 727 tests; 726 pass. The one failure is again `tests/bot.e2e.test.ts` > hr-a1-greetings > "random: a seeded 75 % learner ..." (EGS-04's load-dependent Playwright timing; it passes alone and failed the same way before EGS-06 and EGS-07). Before this ticket: 46 files / 674 tests; now +4 files, +53 tests (edu-authoring 27, edu-assemble 12, edu-playtest 8, scriptorium 6).
- The assembled fixture course validates with zero problems, builds with the fake bundle and lints with no error and no warning (`tests/edu-assemble.test.ts`); a language-course variant validates too.
- The real autoplay bot plays an assembled course (perfect and the 75 % learner finish, 0 console errors) in `tests/edu-playtest.test.ts`; it runs only when Chromium can be launched and prints a skip message otherwise (here it ran and passed, about 8 s).
- No test reaches the network (the Scriptorium client talks to an in-process fake MCP server) or starts an app; the real Scriptorium is never called.

### Deviations and notes

- A revise round (`articles_revise`, `items_revise`) returns only the corrected entries; `mergeRevision` replaces just the flagged ids (the plan did not say which).
- `taught: true` on an item (language courses) is new: the assembler cannot otherwise tell which answers are in the taught language.
- A cloze text cannot hold a literal `{{g1}}` in a prompt template (it would be filled in): the item prompts take `gap_marker` (`GAP_MARKER`).
- The research questions of a plan carry `unit` as the unit's number (1-based), not an id (the units have no ids yet at that stage).
- `SEED_HISTORY` now also holds the skeleton `config/studios.md` hash; `tests/seed-refresh.test.ts` and `tests/roles-config.test.ts` were adapted (agent list is a subset check).
- `src/engine/review/scoring.ts` exports `reviewBodyFor(role)` (the playtester's `deadEnds` extend it).
- `CourseStore.writeAssembled` and the engine options `scriptorium` and `playtest` (with `EduDeps.scriptorium` / `playtest`) were added for EGS-08.
- `ROADMAP.md` and `README.md` are not touched (not in this ticket's ownership).

### Files outside src/engine, seed, docs and tests

None. (`src/shared/schemas.ts` is unchanged in this ticket; `src/renderer/**` untouched.)
