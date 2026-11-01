# Edu Studio MCP guide

Edu Studio turns a topic into a playable educational game: a course (objectives, articles, items with answer keys, game shells) that a self-contained web player plays. This server lets an agent such as Claude Code drive the studio: see the courses and the job queue, and do the model work of the jobs itself, at no cost.

**Status: EGS-17.** The course tools (create, edit, items, text, import, validate, build, lint), the research tools (ask the researcher, read the fact base) and the generic ones below work. The content team's prompts, output contracts, the assembly of a course and the playtest runner (EGS-07) exist as engine code; `edu_run_pipeline` runs them from a brief to a published course (EGS-08, see "Make a course from a brief"); the pictures (the art-director and the art-critic, the asset tools, placeholders) are real since EGS-15 (see "Pictures"); music and sound effects are real since EGS-16 (see "Music and sound effects") and the voice since EGS-17 (see "Voice"); each later ticket adds its tools to this guide.

## Connect

- Port **7463** on 127.0.0.1 (`config/mcp.md`; `EDU_MCP_PORT` overrides it for one run, `yarn mcp --port N` too).
- Token: none by default. With a `token` in `config/mcp.md` (or `EDU_MCP_TOKEN`) every request must send `Authorization: Bearer <token>`. Settings > MCP sets and clears it.
- Only requests with a loopback `Host` and no foreign `Origin` are served.
- Claude Code: `claude mcp add --transport http edu-studio http://127.0.0.1:7463/mcp`
- Headless (no window): `yarn mcp` (= `node out/engine/index.js --mcp-only`). The app runs the same server while it is open.
- Stdio, for clients that cannot speak HTTP: `claude mcp add edu-studio -- yarn --cwd <repo> engine -- mcp`. It relays to the running engine when there is one, else it starts its own.
- Only one engine can use a data folder (`engine.lock` in it names the running one). A second start prints where the running one serves MCP.
- The data folder is `~/EduGames` (`--data <dir>` or `EDU_DATA` change it). A course lives in `courses/<slug>/`.

## Tools

All tool names start with `edu_`. Every call returns JSON, also as `structuredContent`; a failure is an error result with a message.

| Group | Tools |
|---|---|
| Courses | `edu_list_courses` (the courses in `courses/`), `edu_create_course`, `edu_get_course {slug, text?, lang?}`, `edu_course_edit {slug, patch, text?}`, `edu_import_course {folder, slug?, overwrite?}`, `edu_status {slug?}` (the job counts of a course, or of every course; with a slug also `course`: counts, editions, build state; `clientTasks`), `edu_wait {slug, timeoutSeconds?}` (waits until the course has nothing left to run), `edu_languages` |
| Items and text | `edu_item_add {slug, item, text?}`, `edu_item_update {slug, id, patch, text?}`, `edu_item_remove {slug, id}`, `edu_text_set {slug, lang, strings?, accepted?, remove?}` |
| Build and check | `edu_validate {slug}`, `edu_build {slug, force?}`, `edu_lint {slug, rebuild?}` |
| Pipeline | `edu_run_pipeline {slug?, brief?, restart?, from?, retry?}` (make a course from a brief; `edu_status` and `edu_wait` carry a `pipeline` block), `edu_create_course {brief}` (create the course and its `course.md` only) |
| Research | `edu_ask_researcher {slug, question, purpose?, wait?}` (the researcher answers with sourced facts; `wait` seconds returns the note's facts), `edu_factbase_get {slug, merge?}` (the course's facts with stable ids and numbered sources) |
| Android | `edu_android_prepare {slug, appId?, sync?}` (wrap the built course into a Capacitor project in `courses/<slug>/android/`; see `android.md`) |
| Queue | `edu_pause_all`, `edu_resume_all`, `edu_stop_now {drop?, slug?}`, `edu_clear_queue {slug?, confirm: true}` |
| Client provider | `edu_client_tasks`, `edu_get_task {client?, role?, book?, task?}`, `edu_submit_task {taskId, text}`, `edu_release_task {taskId}` |
| Pictures, music, sounds | `edu_asset_list {slug, kind?}`, `edu_asset_plan {slug, fallback?}`, `edu_music_plan {slug, fallback?}`, `edu_asset_generate {slug, ids?, force?, kind?}`, `edu_asset_set {slug, id, prompt?, negative?, provider?}`, `edu_asset_select {slug, id, version}`, `edu_asset_replace {slug, id, file}`, `edu_asset_lock {slug, id, locked}`, `edu_media_settings {slug, set?}` (see "Pictures" and "Music and sound effects") |
| Live quiz | `edu_live_start {slug, questions?, secondsPerQuestion?, lan?, lang?}` (a Kahoot-style quiz on the local network: returns the join `code`, the secret `hostUrl` and the `playerUrls`), `edu_live_status {roomId?}`, `edu_live_stop {roomId}` (see [live-quiz.md](live-quiz.md)) |
| Generators | `edu_studios_status` (Pixel Studio, Chiptune Studio, flow-music-mcp; ComfyUI is `edu_comfy_status`), `edu_comfy_status`, `edu_comfy_free`, `edu_voice_status` |

A job id is `<slug>--<task>--<unit>--r<run>`, so `edu_status {slug}` finds the jobs of a course by their prefix. A research job is `<slug>--research--q<hash>--r0` (the hash is of the question's words, so the same question is never asked twice for a course).

## Build a course

A course lives in `courses/<slug>/course/`: `pack.json` (the language-neutral template) and `text/<lang>.json` (every visible string, per language), plus `assets/` (images and audio). `edu_build` writes `courses/<slug>/build/`, a folder that opens from `file://`.

**The loop.** `edu_create_course` (or `edu_import_course` from a folder) -> `edu_course_edit` (units, objectives, shells, fact base) -> `edu_item_add` for each item, with its text -> `edu_validate` -> `edu_build` -> `edu_lint` -> fix what the lint says -> repeat. Open `courses/<slug>/build/index.html` to play it. The same steps are the CLI: `yarn engine -- import-course <folder>`, `validate <slug>`, `build <slug> [--force]`, `lint <slug> [--json]`, `courses` (they work on the data folder without starting an engine). `yarn build:player` must have run once (it makes `out/player/`; `EDU_PLAYER_DIR` points at another folder with `player.js` and `player.css`).

### The contract

- **Pack** (`pack.json`): `schema: 1`, `id`, `slug`, `sourceLang`, `languages` (the editions; the source is one of them), optional `targetLang` (a language course: the taught language, whose catalog holds the taught phrases and their accepted answers), `subject`, `audience`, optional `cefr`, `matching {diacritics: ignore|warn|strict, typos}`, `units`, `objectives`, `items`, `shells {enabled: ["quiz-arena"], config}`, `assets`, `cues`, `encyclopedia.articles`, `factbase`, `extensions`. The pack is strict: an unknown field is an error.
- **Units** `{id, title, summary?, requires: [unit ids]}`: `requires` is the prerequisite graph; a unit unlocks when the units it requires are mastered. **Objectives** `{id, unit, bloom: remember|understand|apply|analyze|evaluate|create, text, facts: [fact ids]}` (the unit lists no objectives: the link is `objective.unit`).
- **Every visible string is a key** into the text catalog (`unit.u1.title`, `q-sun.prompt` ...: letters, digits, `. : - _`). `text/<lang>.json` is `{schema: 1, lang, strings: {key: text}, accepted: {key: [answers]}}`. **The course title is the string `course.title`** (index.html uses it; the subject is the fallback). A typed answer, a cloze gap, a typed listening answer and a crossword or word-search word point to a key that has an `accepted` list per language (first entry = the canonical answer). In a language course the taught phrases and their accepted answers live in the target-language catalog; every edition falls back to it.
- **Answer keys are language-neutral**: option ids, `true`/`false`, group ids, region ids, pair ids, an id list for an order.
- **Assets** `{id, kind: image|audio, file: "assets/x.png", alt: key}`: put the file in `course/assets/` (import a folder that has it), then add the asset with `edu_course_edit {patch: {assets: [...]}}` (an array replaces the whole array, so send the full list). The generators fill `assets` themselves (`assets/<id>/v<n>.webp`, alt text `asset.<id>.alt`), see "Pictures"; `shells.config[<shell>].art` maps an art slot to an asset id.
- **Every item**: `id`, `objective`, `kind`, `prompt` (key), `explanation` (key, shown after the answer), optional `didYouKnow`, `hint`, `asset`, `difficulty` 1-5 (default 3), `tags`, `extensions`. Kind fields:

| kind | fields |
|---|---|
| `mcq` | `options: [{id, text, why?}]` (2-8), `answer: <option id>`, `shuffle` |
| `true-false` | `answer: true/false`, optional `why` (the misconception behind the wrong choice) |
| `multi-select` | `options`, `answers: [option ids]` (at least 1), `shuffle` |
| `cloze` | `text` (a key whose string holds `{{gapId}}` markers), `gaps: [{id, answer: <accepted key>, bank?: [keys]}]`, `strictDiacritics?` |
| `typed` | `answer: <accepted key>`, `strictDiacritics?` |
| `match-pairs` | `pairs: [{id, left, right}]` (2-8) |
| `order` | `items: [{id, text, when?}]` in the CORRECT order (2-10), `timeline` |
| `sort-groups` | `groups: [{id, title}]` (2-5), `items: [{id, text, group, why?}]` |
| `hotspot` | `asset` (image), `width`, `height`, `regions: [{id, label, shape: {type: circle, cx, cy, r} / {rect, x, y, w, h} / {poly, points}, why?}]`, `answer: <region id>` |
| `listening` | `asset` (audio), `transcript`, `mode: choose` (`options`, `answer: <option id>`) or `type` (`answer: <accepted key>`) |
| `flashcard` | `back` (key), `backAsset?` (self-graded) |
| `crossword` | `words: [{id, answer: <accepted key>, clue}]` (3-20), `seed`, `maxSize` (the grid is generated per language) |
| `word-search` | `words: [{id, answer: <accepted key>}]`, `seed`, `size?`, `directions: forward|diagonal|all` |
| `conjugation` | `verb` (key of the infinitive), `tense` (id: `praesens`, `perfekt`, `praeteritum`, `futur1`, `imperativ`, `konjunktiv2`), `forms: [{person, label: <key>, answer: <accepted key, the form WITHOUT the pronoun>, given?}]` (2-7), `ask?` (how many open forms one presentation asks), `strictDiacritics?`. Each form is typed on its own, typos are never accepted, `score` = right / asked. Persons for German: ich, du, er (er / sie / es), wir, ihr, sie (plural), Sie. Compound and separable forms include every word to type ("bin gegangen", "stehe auf"); imperativ has du, ihr, Sie only. The live quiz skips it. |

**Writing items well** (the lint checks the checkable ones): ask each objective in two or more different forms; every wrong choice of an mcq, multi-select or listening-choose item has a `why` (the misconception it stands for); one fact per item; a typed answer lists its synonyms; keep the explanation short and add a `didYouKnow` hook.

### Editing

- `edu_item_add` parses the item with its kind's schema (defaults filled in), and refuses an item that does not fit, an unknown objective, asset or option, a duplicate id. Pass `text` (`{en: {strings: {...}, accepted: {...}}, hr: {...}}`) to write its strings in the same call; strings still missing come back as `pending` (the item is saved, the course is just not finished). `edu_text_set` writes strings and accepted lists and removes keys (`remove`) in one language; the language must be an edition or the target language.
- `edu_course_edit` and `edu_item_update` take a JSON merge patch (RFC 7396): objects merge, `null` deletes a key, an array replaces the whole array. A result that is structurally invalid (schema, unknown ids, duplicate ids) is refused and nothing is written; missing texts, `why` keys, gap markers and asset files are reported as `pending`, not refused. Editable pack fields: `sourceLang languages targetLang subject audience cefr matching units objectives shells assets cues encyclopedia factbase extensions` (items have their own tools; `id`, `slug` and `schema` never change). To add an edition, add it to `languages` and send its strings with `text`.
- Writes are atomic (a temp file renamed over the target) and the writes of one course run one after another.

### Validate, build and lint

- `edu_validate` checks the schema, every reference, the text keys in every edition, the puzzles (every crossword and word-search word must be placeable) and the asset files. Codes: `SCHEMA`, `UNKNOWN_KIND`, `DUPLICATE_ID`, `UNKNOWN_UNIT|OBJECTIVE|ASSET|FACT|ARTICLE|OPTION|GROUP|REGION`, `MISSING_TEXT`, `MISSING_WHY`, `MISSING_GAP_MARKER`, `ASSET_KIND`, `PUZZLE_UNPLACED`, `PUZZLE_INVALID`, `MISSING_CATALOG`, `CATALOG_LANG`, `UNKNOWN_LANGUAGE`, `SOURCE_LANG_NOT_LISTED`, `PARSE`, `MISSING_ASSET_FILE`.
- `edu_build` refuses a course with validation problems (and returns them); `force: true` builds anyway when the files parse (for testing the lint). The build folder holds `index.html`, `player.js`, `player.css`, `game-data.json` (what the lint and the autoplay bot read), `game-data.js` (`window.EDU_GAME_DATA = ...`, so it works from `file://`) and `assets/`. Only `courses/<slug>/build/` is ever cleaned.
- `edu_lint` reads the built `game-data.json` and its asset files (and builds first when there is no build; `rebuild: true` builds again; `stale: true` says a course file changed after the build). The result is `{ok, errors, warnings, problems: [{code, severity, path, message}]}`; **errors fail the lint** (CLI exit 1), warnings alone pass (exit 0). It also reports everything `edu_validate` finds, as errors.

| Lint code | Severity | Meaning |
|---|---|---|
| `ITEM_NO_KEY` | error | the answer key is empty or unsolvable: it points to no option, region or answer, or the item's own solution does not check right |
| `ITEM_MULTI_KEY` | error | an mcq, true-false or listening-choose item names more than one right answer (use multi-select) |
| `ACCEPTED_INCOMPLETE` | error | a typed answer, cloze gap, typed listening answer or crossword/word-search word has no accepted list in an edition, or an accepted entry is empty |
| `DISTRACTOR_DUPLICATE` | error | two options (or two bank words of a gap) read the same after normalising case, accents and punctuation, in an edition |
| `DISTRACTOR_IS_KEY` | error | a distractor reads like a right option; a bank word is an accepted answer of its gap; a typed item's `extensions.nearMisses` list holds an accepted answer |
| `OBJECTIVE_ONE_FORM` | error | an objective is asked in fewer than two distinct forms |
| `OBJECTIVE_NO_ITEMS` | error | an objective has no items |
| `UNIT_NO_OBJECTIVES` | error | a unit has no objectives |
| `ASSET_MISSING` | error | an asset file is not in the build folder |
| `TEXT_MISSING` | error | a text key the pack or an item uses is missing or empty in an edition |
| `PREREQ_CYCLE` | error | the unit prerequisites form a cycle |
| `UNIT_UNREACHABLE` | error | no learner can reach the unit from the units without prerequisites |
| `ITEM_NO_FACT` | error | in a pack made by the pipeline (`extensions.pipeline` is set): an item names no fact it rests on (`extensions.facts` empty or missing), or one that is not in the fact base. Hand-made packs are not checked |
| `ARTICLE_NO_CITATION` | error | in a pipeline pack: an article cites no fact, or one that is not in the fact base |
| `PLACEHOLDER` | error | a text says TODO, TBD, FIXME (upper case, or lower case with a colon), lorem ipsum, XXX, `[[`, "placeholder", or has a `{{` that is not a gap marker of its own cloze item |
| `PLACEHOLDER_ASSET` | warning | an asset (or an item's text that uses it) says it is a placeholder, such as a test tone standing in for speech: replace it before publishing |
| `CONJ_PERSON_DUPLICATE` | error | a conjugation item lists a person twice |
| `CONJ_ASK_TOO_MANY` | error | `ask` is larger than the number of forms that are asked (not given) |
| `CONJ_IMPERATIVE_PERSON` | error | German imperativ with a person other than du, ihr, Sie |
| `CONJ_FORM_DUPLICATE_AMBIGUOUS` | warning | two asked persons have the same canonical form (wir / sie / Sie in the present): the learner cannot tell them apart |
| `GAME_DATA_INVALID` | error | `game-data.json` is missing or is not a game |

## Make a course from a brief

`edu_run_pipeline` turns a brief into a published, playable course with the team of roles, as file jobs in the queue. One call creates the course and starts the run:

```
edu_run_pipeline {brief: {topic: "The Roman Empire", audience: "teenagers", age: 14, sourceLang: "en", units: 2, model: "client/claude-code", story: "none"}}
```
**The brief** (`src/shared/brief.ts`; it is saved in `courses/<slug>/course.md`). Required: `topic`, `audience`. Optional: `age` (years; `kids` defaults to age < 13), `level` (free text), `cefr` (a language course), `sourceLang` (default `en`), `languages` (the editions, for example `["hr", "en"]`: the step `editions` has the `translator` role translate the text catalog of `sourceLang` into every other language, see "Editions" below), `targetLang` (the language that is taught: a language course), `shells` (default `["quiz-arena"]`; the pipeline switches on the quiz arena, the encyclopedia, MindMaze and the RPG, whose layouts are made from the units; the role-play and the detective need authored sections, so they are only recorded in `extensions.pipeline.requestedShells` and not enabled), `format` (an id of `config/formats.md`: `quick` is 2 units, `standard` 4, `deep` 6, `language-a1`, `language-a2`, `language-b1`; default `quick`, or with a `targetLang` the format `language-<cefr>` for A1, A2 and B1 (`language-a1` when no `cefr`; B2 has no format yet and C1/C2 are out of scope, name a format to override). A language format has `verb_units` (units whose objectives are all about one verb group; the curriculum-designer marks them `verb: true`, the language-coach gives them `verbs: [{inf, tense, level}]`, and the pack records `extensions.language = {verbUnits, verbsPerUnit}`) and `verbs_per_unit`; the kind `conjugation` is in the formats' `item_kinds` but is not asked for until EGS-27 adds it, `units`, `objectivesPerUnit`, `itemsPerObjective` (override the format), `kids` (the child-safety reviewer must pass it), `story` (`none`, `frame`: a frame story written by the narrative designer, or `scriptorium`: the story idea is handed to Scriptorium, which is never started from here; when it is down the step is skipped), `media` (the media settings, written to `course.md`: see "Pictures"), `model` (`provider/model` for every role of this course, written to `course.md` as `models["*"]`: `client/claude-code` makes you the team), `notes`. The slug is made from the topic (`the-roman-empire`) unless you pass `slug`. `edu_create_course {brief}` only creates the course and `course.md`; `edu_run_pipeline {slug}` then starts the run.
**The brief** (`src/shared/brief.ts`; it is saved in `courses/<slug>/course.md`). Required: `topic`, `audience`. Optional: `age` (years; `kids` defaults to age < 13), `level` (free text), `cefr` (a language course), `sourceLang` (default `en`), `languages` (the editions, for example `["hr", "en"]`: the step `editions` has the `translator` role translate the text catalog of `sourceLang` into every other language, see "Editions" below), `targetLang` (the language that is taught: a language course), `shells` (default `["quiz-arena"]`; the pipeline switches on the quiz arena, the encyclopedia, MindMaze and the RPG, whose layouts are made from the units; the role-play and the detective need authored sections, so they are only recorded in `extensions.pipeline.requestedShells` and not enabled), `format` (an id of `config/formats.md`: `quick` is 2 units, `standard` 4, `deep` 6, `language-a1`; default `quick`, or `language-a1` with a `targetLang`), `units`, `objectivesPerUnit`, `itemsPerObjective` (override the format), `kids` (the child-safety reviewer must pass it), `story` (`none`, `frame`: a frame story written by the narrative designer, or `scriptorium`: the story idea is handed to Scriptorium, which is never started from here; when it is down the step is skipped), `media` (the media settings, written to `course.md`: see "Pictures"), `model` (`provider/model` for every role of this course, written to `course.md` as `models["*"]`: `client/claude-code` makes you the team), `notes`. The slug is made from the topic (`the-roman-empire`) unless you pass `slug`. `edu_create_course {brief}` only creates the course and `course.md`; `edu_run_pipeline {slug}` then starts the run.

**The steps** (the job id is `<slug>--<task>[-k<round>]--<unit|all>--r<run>`; a research job is `<slug>--research--q<hash>--r0`):

```
plan -> research x N -> factbase -> curriculum -> scope (language courses)
  -> per unit, in parallel: articles -> items -> distractors -> fact_check -> explain -> accepted (language courses)
  -> design -> story -> art_plan -> art_generate -> art_review (-> art_generate-k2 -> art_review-k2 ...) -> music_plan -> music_generate -> assemble
  -> accessibility review (+ child-safety review for kids) -> voice_plan -> voice_generate (after the reviews: it speaks the final text) -> editions (the translator; skipped with one language) -> build -> lint -> playtest -> playtest_report -> publish -> summarize
```

Each step writes its output to `courses/<slug>/pipeline/` (`plan.json`, `curriculum.json`, `units/<unit>/{articles,items,distractors,explain,accepted}.json`, `reviews/*.json`, `design.json`, `story.json`, `art.json`, `polish.json`, `lint.json`, `playtest.json`, `report.json`, `publish.json`, and `steps.json` = the state), then calls `advance`, which enqueues what can run next from those files. The assemble step writes `course/pack.json` and `course/text/<lang>.json`; build and lint are the ones of `edu_build` / `edu_lint`; the playtest step plays the built game with the autoplay bot as simulated learners (needs Chromium: `yarn playwright install chromium`).

**Gates and loops.** The fact-checker must pass (`config/quality.md`, `must_pass`): a `revise` sends the unit to `articles_revise` / `items_revise` (only the flagged ids change), then `distractors` and `fact_check` again, as round 2 (`-k2` in the job ids), up to `max_rounds`; after the last round a reviewer that still says revise blocks the run. The accessibility reviewer (and the child-safety reviewer for kids) review the assembled course; a revise goes through `polish` (the explainer corrects only the flagged text keys) and `assemble` again. The publisher decides in code: must-pass reviewers, the weighted score against `threshold`, and two hard gates, lint errors and a failed autoplay bot; only a course that passes gets its blurb. `courses/<slug>/course.md` says `stage: running | blocked | published | failed` and its body is the run log the director's summary is appended to.

**Looking.** `edu_status {slug}` has a `pipeline` block: `run`, `stage`, every step with its status (`queued`, `running`, `done`, `skipped`, `blocked`, `failed`) and note, `failed` (the failure text of a job that failed for good), `blockedBy` (why a run is blocked: the must-pass role, the gate) and `next` (what to do). `edu_wait {slug}` returns the same block when the course has nothing left to run.

**Resume, retry, restart.** `edu_run_pipeline {slug}` on a course with a run in progress advances it (finished steps are not redone, also after the engine restarted). `{slug, retry: true}` puts the failed jobs of the run back in the queue. `{slug, restart: true, from: "<stage>"}` starts run n+1 and clears the outputs from that stage on (`plan`, `research`, `factbase`, `curriculum`, `scope`, `articles`, `items`, `distractors`, `fact_check`, `explain`, `accepted`, `design`, `story`, `art`, `assemble`, `review`, `build`, `lint`, `playtest`, `publish`); the research notes are kept. A job of an older run does nothing.

**Doing it all yourself (`model: "client/claude-code"`).** Every model call of the run waits for you (see "Do the model work yourself"); the steps that need no model (factbase, assemble, build, lint, playtest) run on their own in between. The loop: `edu_run_pipeline {brief}`, then `edu_wait {slug}` (it returns as soon as a call waits, with `clientTasks`), `edu_get_task` and `edu_submit_task` until `none`, `edu_wait` again, until `stage` is `published` or `blocked`. Every task's `user` text is the whole prompt (the course, the unit, the objectives, the fact base, the rules, the JSON shape) and `schema` is the shape of the answer. The researcher's web search is also yours when `search_order` in `config/providers.md` has only `client-search` (`search_order: [client-search]`): those tasks have role `searcher` and the answer shape `{results: [{title, url, content}]}` (see "Research and the fact base"). About 30 to 40 tasks make a 2-unit quick course (plan, 4 research notes and searches, curriculum, 5 per unit, design, review, playtest report, publish, summary).

### Editions: hr + en from one run (EGS-32)

`brief.languages` lists the editions of the course (the source language is always one). The step `editions` runs after the voice (the last step that adds text to the pack) and before the build: the `translator` role (`prompts/translator/edition.md`; model from `config/roles.md`, the course's `models`, or `client/claude-code` like any role) translates the text catalog of `sourceLang` into each other language, in groups of entries, and `pack.languages` then lists them. What is translated: every string of `text/<sourceLang>.json` and its `accepted` lists, **except** the keys that are in the target-language catalog of a language course (the taught phrases are the same in every edition). Keys, gap markers and `{placeholders}` must come back unchanged; a key that is missing, invented or has changed placeholders is sent back once (the repair round), and if it is still wrong the step fails with the keys named and nothing is written (the course stays valid with its source language). A language of the brief that is the taught language is not an edition and is skipped; with no edition to make the step is skipped with its reason. The result is checked with `validateCourse` before it is written (`CourseStore.addEditions`), and `edu_lint` names an edition that lacks a key (`TEXT_MISSING ... (in en)`). `restart: true, from: editions` translates again; `from: assemble` or earlier writes the pack with one language again and removes the catalogs of the editions; a restart from a stage between assemble and editions keeps the editions in the pack, so a step that then adds new text (a changed voice plan) is refused until you restart from assemble. Book Translator stays the manual way to make an edition. The translation is model-written and not reviewed by a native speaker.

## Pictures: art, the art-director and the art-critic (EGS-15)

A pipeline run makes the pictures of the course. `art_plan` (the art-director) -> `art_generate` (no model: the generators) -> `art_review` (the art-critic, with regenerate rounds) run after `story` and before `assemble`; `assemble` links the assets into the pack, so the build carries them and `edu_lint` finds no `ASSET_MISSING`.

**The plan** (`courses/<slug>/pipeline/art.json`). The art-director (role `art-director`, prompt `prompts/art-director/plan.md`) is shown the units, the articles, the items and the shells of the course and answers `{images: [{for: article|item|shell, id | shell + slot, prompt, alt, ratio?, side?}], notes}`:
- one picture per encyclopedia article (dual coding: it shows the fact; nothing decorative);
- a picture for an item only where it helps (at most 12; a flashcard may have a `back` picture); a hotspot item whose picture is missing needs one, fitted to the item's `width` x `height`, with its regions drawn faintly over it by code (no text labels: the label is the question);
- the art of every shell in the brief (`shells`) and in the game design, from a table of slots in code: `quiz-arena` a backdrop per unit (`bg-<unit>`) and `bg-boss`; `mindmaze` a castle room per unit (`room-<unit>`); `encyclopedia` a plate per article (`plate-<article>`); `rpg` the tile set (`tiles`), the `hero` and the NPCs (`npc-1`...), pixel art with a palette; any other shell id gets one `backdrop`. Where the pack records it (EGS-22): the quiz arena's backdrops in `shells.config['quiz-arena'].art = {slot: assetId}`; the RPG's in its own section fields (`tileset` = `tiles`, `sprites.hero` = `hero`, `sprites.npc` = `npc-1`), because the section schemas of the shells are strict; every other slot (`npc-2`..., the castle rooms, the encyclopedia plates, a backdrop) in `extensions.art[<shell>][<slot>]`. The RPG shell plays its pictures; the other shells keep their own drawn art for now.

The answer is checked (ids and slots exist, no duplicate, every article, every required slot and every hotspot covered, prompts long enough) and sent back once in words; an answer that stays unusable is replaced by a deterministic plan made from the course text (`art.json` says `source: fallback`), so the step never blocks the course.

**Asset ids come from what a picture illustrates, never from a counter**: `img-article-<articleId>`, `img-item-<itemId>` (`-back` for a flashcard back), a hotspot keeps the asset id its item names, `img-<shell>-<slot>` (`img-quiz-arena-bg-u1`, `img-mindmaze-room-u2`, `img-encyclopedia-plate-<articleId>`, `img-rpg-tiles`, `img-rpg-hero`, `img-rpg-npc-1`). A rerun of the plan (`restart from: art`, `edu_asset_plan`) keeps the ids and the versions already made; an asset that is `locked`, has a version, or has a prompt set by hand (`edu_asset_set`) keeps its prompt.

**Files.** The manifest is `courses/<slug>/course/assets.json` (`{assets: [{id, kind: background|illustration|sprite|tileset, prompt, negative?, engine, seed, size, fit, alt, style, provider?, versions: [{n, file, engine, prompt, seed, warnings?, nativeFile?, remote?}], selected, source: generated|custom, locked, promptByHand?, placeholder?, review?}]}`); the files are `course/assets/<id>/v<n>.webp` (versions are never deleted), `custom.<ext>` for a hand-made file and `placeholder.svg`. The pack's `assets[]` entry points at the selected version, its alt text is the catalog key `asset.<id>.alt`, and the links are `article.asset`, `item.asset` (`backAsset` for a flashcard back; a hotspot keeps its own) and `shells.config[*].art`.

**Settings** (`courses/<slug>/course.md`, `media`; the brief may carry the same `media` block; `edu_media_settings` reads and changes it; every field optional):

```yaml
media:
  art:
    enabled: true          # false: no picture is planned or made
    review: true           # the art-critic runs (needs a model with vision, else the step is skipped with the reason)
    style: illustrated     # or pixel
    provider: comfy        # comfy (default) | flow (Google Flow: ONLY when you set it) | hand (every picture comes from edu_asset_replace)
    generator: qwen-image-2.1   # the ComfyUI engine (config/comfy.md)
    palette: db32          # pixel art palette (seed/palettes); RPG art defaults to db32
    pixelProvider: pixel-studio # RPG tiles and sprites: pixel-studio (default) or builtin
    stylePrompt: ""        # replaces the default style words
    flowModel: ""          # flow only: the Flow model name; flowProject: the Flow project (default edu-<slug>)
  music:                   # see "Music and sound effects"
    enabled: true          # false: a silent course (no composer, no sound, no cue)
    provider: comfy        # comfy (ACE-Step) | chiptune | flow (SPENDS CREDITS: needs flowCredits: true too)
    flowCredits: false     # the explicit opt-in to spend Flow Music credits
    chip: snes             # Chiptune Studio chip: nes gb genesis snes pce ps1 dreamcast
  sound:
    sfxEngine: chiptune    # the sound effects: chiptune (default), a ComfyUI audio engine, custom:<workflow>, or none (made by hand)
  voice:                   # see "Voice"
    enabled: true          # missing: on for a language course, off for the others; false: no clip; true on another course: narration only
    provider: auto         # auto (the hub's rule) | gemini | vibetts | comfy
    narration: true        # a few short narration clips (source language)
    listening: true        # listening items for the taught phrases (language courses)
    listeningPerUnit: 3
    localVoices: {}        # language -> VibeTTS voice id (supertonic:F1, am_michael)
```

**Providers.** ComfyUI makes the pictures (autostarted from the hub's `services.json` when `config/autostart.md` allows it; `EDU_AUTOSTART=0` turns that off). The tile set and the sprites of the RPG shell are turned into pixel art by Pixel Studio (MCP 7457: `import_image` then `export_many`; the native copy is kept next to the version); when Pixel Studio is down the built-in pixelate runs and the version carries a warning. **Google Flow is never called unless the course sets `art.provider: flow` (or one asset sets `provider: flow` with `edu_asset_set`).** Sprites are cut out with BiRefNet (a flat-colour key without it) and trimmed.

**Placeholders.** A provider that is down (after the autostart, or with it off) or a picture that fails does **not** fail the run: the asset gets a placeholder card, `assets/<id>/placeholder.svg`, and the step says why. The pack links it, the build carries it, and `edu_lint` warns `PLACEHOLDER_ASSET` for each (a warning is not a publish gate: the course still publishes). `edu_status {slug}` has a `media` block (`images`, `made`, `placeholders`, `rejected`). A real version, or `edu_asset_replace`, replaces the placeholder and removes its file.

**The art-critic** (role `art-critic`, a vision model: images are sent as message parts; with `client/claude-code` the images come with `edu_get_task` as MCP image content) reviews each new version against its plan line: `{verdict, scores: {relevance, clarity}, notes, problems: [{ref, issue, fix}]}`. A `revise` makes that picture again with the critic's note added to the prompt (`art_generate-k2`, then `art_review-k2`), up to `max_rounds` (`config/quality.md`). The critic is **not must-pass**: after the last round a picture that is still rejected stays in the course with `review.status: rejected` and the note (the step note and `edu_status` count them). With `media.art.review: false`, or no vision model, `art_review` is skipped and says why.

**Tools** (they write the manifest and then re-link the pack, so a built course picks the change up with the next `edu_build`):

| Tool | What it does |
|---|---|
| `edu_asset_list {slug, kind?}` | the assets (pictures, music, sound effects): id, kind, what each illustrates (`target`) or where it plays (`plays`), selected version, file, `placeholder` (and why), review, prompt, provider, warnings, the `loop` points of a Chiptune track; `summary`; the art and music settings |
| `edu_stt_status` | speaking practice: whether the local whisper.cpp endpoint is configured and listening (`docs/speaking.md`) |
| `edu_class_assign {slug, assignment?, clear?, build?}` | classroom mode: give the course an assignment (units, targetStars, due, message), written to `pack.extensions.classroom.assignment`; build again to show it (`docs/classroom.md`) |
| `edu_class_report {slug, files?, folder?, format?}` | the class report from the students' result files (default folder `courses/<slug>/class/results/`): writes `class/report.md` and `report.csv` |
| `edu_asset_plan {slug, fallback?}` | plan the pictures of a course, also a hand-made one: queues the art-director (a model job); `fallback: true` plans from the course text at once, with no model |
| `edu_asset_generate {slug, ids?, force?, kind?}` | queues one job that makes the pictures and the sounds that have no file yet (`kind`: an image kind, `music` or `sfx`; `force`: again; locked and hand-made ones are never touched); returns the job id |
| `edu_asset_set {slug, id, prompt?, negative?, provider?}` | the prompt (kept by the art-director from then on), the negative prompt, or `comfy` / `flow` for this asset |
| `edu_asset_select {slug, id, version}` | use an earlier version |
| `edu_asset_replace {slug, id, file}` | use a file you made (png, jpg, webp, gif, avif, svg), copied as it is; `source: custom`, locked; removes a placeholder |
| `edu_asset_lock {slug, id, locked}` | a locked asset is never made again |
| `edu_media_settings {slug, set?}` | read, or change with a JSON merge patch, the `media` block of `course.md` |

`edu_studios_status` shows Pixel Studio, Chiptune Studio and flow-music-mcp; ComfyUI is checked by `edu_comfy_status`.

## Music and sound effects: the composer (EGS-16)

A pipeline run makes the music and the sound effects of the course. `music_plan` (the composer) -> `music_generate` (no model: the generators) run after the art steps and before `assemble`. `assemble` links the sounds into the pack (audio assets, the cues, the loop points), so the build carries them and `edu_lint` finds no `ASSET_MISSING`. `restart from: music` runs them again (the stage `music` sits between `art` and `assemble`); `media.music.enabled: false` skips both steps with the reason.

**The plan** (`courses/<slug>/pipeline/music.json`). The composer (role `composer`, prompt `prompts/composer/plan.md`) is shown the units and the shells and answers `{music: [{area, mood, prompt, alt, seconds?, units?, chip?, bpm?, key?, bars?}], sfx: [{event, sound, alt}], notes}`:
- music by **area**: `menu` (title and map), `unit-<id>` (a round of that unit; several units of one mood may share a track: the line `unit-u1` with `units: ["u2"]`), `boss`, `end`, and an area for each shell the course has: `castle` (MindMaze), `rpg-overworld` and `rpg-battle` (RPG). Every area is covered exactly once. A track is calm, instrumental and loops;
- sound effects by **event**: `correct`, `wrong`, `combo`, `level-up` (required) and `boss`. `sound` is one of Chiptune Studio's `compose_sfx` sounds (coin, chime, powerup, magic, cancel, alert ...).

The answer is checked (areas and events exist, every area and required event covered, no area twice, prompts long enough) and sent back once in words; an answer that stays unusable is replaced by a deterministic plan made from the course text (`music.json` says `source: fallback`), so the step never blocks the course.

**Stable ids**: `mus-<area>` (`mus-menu`, `mus-unit-u1`, `mus-boss`, `mus-end`, `mus-castle`, `mus-rpg-overworld`, `mus-rpg-battle`; a merged track has the id of its first area) and `sfx-<event>` (`sfx-correct`, `sfx-level-up` ...). A rerun of the plan (`restart from: music`, `edu_music_plan`) keeps the ids and the versions already made; an asset that is `locked`, a hand-made file, or has a prompt set by hand (`edu_asset_set`) keeps its prompt.

**Providers.** Chiptune Studio (MCP 7458: `compose_track`, `render_audio`, `compose_sfx`; ogg, with the loop points) makes **every sound effect** and the **RPG and castle music** (and all the music of a pixel-style course); ComfyUI (ACE-Step, `media.music.engine`) makes the other music. **Flow Music spends credits, so it is never a default**: it is used only when the course sets `music.provider: flow` AND `music.flowCredits: true`, and then at most `flowMusicMaxSongs` songs (`config/studios.md`, default 4: the tracks beyond the cap are made by the default provider and carry a warning). `music.provider: flow` without `flowCredits` makes the default providers and says so in the plan (`warnings`). A course whose *art* provider is flow does not use Flow Music. `sound.sfxEngine` picks another engine for the effects (a ComfyUI audio engine, `custom:<workflow>`; `none` makes them import-only: placeholders until `edu_asset_replace`). The generators are autostarted like the art ones (`config/autostart.md`, `EDU_AUTOSTART=0` off).

**Placeholders.** A provider that is down (after the autostart, or with it off) or a sound that fails does **not** fail the run: the asset gets `assets/<id>/placeholder.wav` (a second of silence), the step says why, the pack links it (the cue points at it), the build carries it, and `edu_lint` warns `PLACEHOLDER_ASSET` for each. A provider found down once is not asked again in the same run. `edu_status {slug}` has `media.audio`, `audioMade` and `audioPlaceholders`. When the provider is back, `edu_asset_generate` makes the sounds and removes the placeholders.

**In the pack.** Each sound is an asset `{id, kind: audio, file: assets/<id>/v<n>.ogg, alt: asset.<id>.alt}` and the cues are `{id: cue-music-<area>, on: music:<area>, asset, loop: true, volume}` for music (one per area a track plays in) and `{id: cue-sfx-<event>, on: <event>, asset, loop: false, volume}` for effects. The cue schema is strict, so the **loop points** of a Chiptune track are in `pack.extensions.audio.loops = {<assetId>: {startSec, endSec}}`; the player jumps from the end point back to the start point. (No course schema change: `cues` and `extensions` already existed.)

**The player** (`src/player/audio.ts`, see `docs/player.md`) plays the music of the area as a loop (one track at a time, a short fade when the area changes), the effects on `correct`, `wrong`, `combo` (the combo burst), `level-up` (a unit round ends; the old name `unit-complete` works too) and `boss`. The title screen has the toggles `setting-sound` (nothing plays) and `setting-reduce-audio` (no music, quieter effects), kept with the progress.

| Tool | What it does |
|---|---|
| `edu_music_plan {slug, fallback?}` | plan the music and the sound effects of a course, also a hand-made one: queues the composer (a model job); `fallback: true` plans from the course text at once, with no model. The plan is merged into the manifest and the pack is re-linked. Nothing is generated here (`edu_asset_generate`) |
| `edu_asset_list {slug, kind?}`, `edu_asset_generate {slug, ids?, force?, kind?}`, `edu_asset_set`, `edu_asset_select`, `edu_asset_replace`, `edu_asset_lock` | the same tools as for pictures; `kind` is `music` or `sfx` for the sounds (an audio file for `edu_asset_replace`: ogg, mp3, wav, opus, flac, m4a) |
| `edu_media_settings {slug, set?}` | the `media.music` and `media.sound` settings; run `edu_music_plan` again after changing them |

**The bot's media check.** `scripts/play.mjs` loads every asset URL of `game-data.json` in the page (an image must decode; audio must reach `canplaythrough` or `loadedmetadata`). A failure is a `mediaErrors` entry of its summary and fails the run, like a console error (`--no-media-check` turns it off). The player logs `console.error` when an image or an audio element fails to load.

## Voice: narration, listening practice and the hub's voice rule (EGS-17)

A pipeline run speaks the course. `voice_plan` (the voice-director) -> `voice_generate` (no model: the providers) run **after** the audience reviews (so the clips speak the final text) and before `build`; `voice_generate` re-links the pack (the assemble merge: audio assets, `listening.asset`, derived items, narration) so the build carries the clips. Resumable and idempotent: a clip whose text, language, voice and style did not change is never spoken again, so `restart from: voice` (the stage `voice` sits between `review` and `build`) re-plans and speaks nothing that is already made. A course that is not a language course skips both steps (narration is opt-in: `media.voice.enabled: true`); `media.voice.enabled: false` skips them for a language course. The step notes say why.

**The plan** (`courses/<slug>/pipeline/voice.json`). The voice-director (role `voice-director`, prompt `prompts/voice-director/plan.md`) is shown the final text and answers `{voices: {<lang>: {style, gemini?}}, narration: [{key, alt?}], derive: [{item, prompt?}], notes}`:
- **narration** in the source language: a few short texts of the course (unit summaries, article bodies; at most 12; a long text is cut at a sentence, `narrationMaxChars` in `config/voice.md`: short narration with the text beside it). The clip is `voice-<lang>-<text key>` (`voice-en-unit-u1-summary`); `pack.extensions.narration = {<text key>: <clip id>}` links it (the encyclopedia shell reads it; the quiz arena has no narration UI);
- **listening** in the target language (language courses): every `listening` item (hand-made ones too) gets the clip of its transcript, and `listening.asset` points at it (a tone placeholder it had is dropped from the pack, with its alt text and the parenthetical in the item texts that said it was a placeholder tone); and **listening items are derived from taught phrases** of items that already passed the fact-check: `<sourceItemId>-listen` (`u1-q2-listen`), the same objective and `extensions.facts` as the source, difficulty + 1, marked `extensions.voice.derivedFrom`; `mode: type` (the source's accepted answers) or `choose` (its options), at most `media.voice.listeningPerUnit` (3) per unit, put right after the source item. A derived item the plan no longer names is removed by the next merge; a text of a derived item that is already in the catalog (corrected by hand) is kept, and the clip speaks the catalog's text;
- **voices**: a delivery style per language (and optionally a Gemini voice `gemini:Kore`). The settings of the course win: `media.voice.styles`, `voices.narrator.<lang>`, `localVoices.<lang>` (a VibeTTS voice id).

The answer is checked (keys and items exist, no repeats, within the limits, voices of languages the course has) and sent back once in words; an answer that stays unusable is replaced by the deterministic plan from the course text (`voice.json` says `source: fallback`), so the step never blocks the course.

**Who speaks: the hub's allocation rule** (`src/engine/voice/allocate.ts`, pure). Three providers: **Gemini** (Google's free voices through flow-music-mcp's `flow_narrate`, `engine: gemini` only: never the paid Flow engine), **VibeTTS** (the local tray app, MCP `http://127.0.0.1:7723/mcp`, `config/studios.md` `vibettsUrl`, `EDU_VIBETTS_URL`: `list_voices`, `synthesize_batch`; Kokoro reads en, es, fr, hi, it, pt (never hr or de); Supertonic 31 languages, Croatian and German included; Higgs about 100) and **ComfyUI TTS** (TTS Audio Suite, OmniVoice by default, reads Croatian). **VibeTTS is a tray app: Edu Studio never starts it.**
- Gemini's free tier allows **10 requests a day** (`geminiDailyLimit` in `config/voice.md`). The counter is `state/gemini-tts.json` (`{day, used}`); the day ends at midnight of `geminiResetTz` (default `America/Los_Angeles`: the free tier resets at Pacific midnight). Every `flow_narrate` request that reaches Gemini counts (a retry too); a quota error (a 429 with a long retry delay, 5 minutes or more) sets `used` to the limit for that day. `remaining = limit - used`, never negative.
- Languages are allocated **whole** (a language never mixes providers in one run), **Croatian first**, then English, then the others by code: if the clips of a language that need speaking (the hash index has no up-to-date clip) fit in `remaining`, the language goes to Gemini and uses that much of it; else it goes local. So hr and en together over what is left: Croatian on Gemini, English local; both fit: both on Gemini; neither fits: both local.
- Local means VibeTTS when it lists a voice that reads the language, else ComfyUI TTS; when the chosen local provider is down, the other one. When nothing can speak a language its clips become silent placeholders (`assets/<id>/placeholder.wav`) and warnings, never a failed run; `edu_lint` warns `PLACEHOLDER_ASSET` for each, and `edu_voice_generate` replaces them when a provider is back.
- Gemini down (flow-music-mcp not running, not signed in, no AI Studio key) or a quota error in the middle of a run: the rest of that language falls back to local; clips already made stay.
- **German (EGS-33).** `reads('de')` of VibeTTS is a probe of the `list_voices` language codes. German goes to local VibeTTS (Supertonic or Higgs; set `localVoices.de`, e.g. `supertonic:M2`), then ComfyUI TTS, never Kokoro and in practice never Gemini (10 requests a day). `media.voice.narration` defaults to off for a language course (a course with `targetLang`) and on otherwise. `edu_voice_status` returns `readsDe` (`vibetts`, `comfy`) and a `warnings` entry when no provider reads German; the clips then become placeholders.
- `media.voice.provider`: `auto` (the rule, default), `gemini` (Gemini first; the quota still applies and a language that does not fit goes local), `vibetts` (VibeTTS, then ComfyUI), `comfy` (ComfyUI, then VibeTTS). `vibetts` and `comfy` never use Gemini. The allocation of the last run is recorded per language in `voice.json` (`allocation`: the provider, the chain, the reason, how many clips each provider made, the placeholders).

**Hash index.** Each clip is an asset in the manifest (`kind: voice`, `voice: {lang, key, role, text, hash, provider}`); `hash = sha1(text, lang, Gemini voice, VibeTTS voice, style, speed, format)`. The hash does not know the provider: a clip VibeTTS made is not spoken again by Gemini. A changed text makes a new version (`v2.wav`; the old one stays). A locked clip, and a clip imported with `edu_voice_import`, are kept (the status says when the text changed since the recording). The manifest is saved after every clip, so a stopped run resumes.

| Tool | What it does |
|---|---|
| `edu_voice_plan {slug, fallback?}` | plan the narration and the listening audio of a course, also a hand-made one: queues the voice-director (a model job); `fallback: true` plans from the course text at once, with no model, and returns the clips and the derived items. Refused for a course that is not a language course until `media.voice.enabled: true`. Nothing is spoken here |
| `edu_voice_generate {slug, lang?, force?}` | queues one job (no model) that speaks the clips by the rule above (`lang`: one language; `force`: speak again), then re-links the pack. With no plan the deterministic one is made first. Returns the job id; `edu_wait {slug}` |
| `edu_voice_status {slug?}` | the local ComfyUI voice engines, `providers` (Gemini: up, ready, voice ids; VibeTTS: up, voices, the languages it reads, the voice configured per language, Supertonic / Higgs installed), `quota` (`{limit, used, remaining, day, tz}`) and, with `slug`, `course` (the plan, the clips: made / imported / placeholders / planned, the last allocation) and `preview` (what a run would allocate now, per language) |
| `edu_voice_quota {reset?}` | today's Gemini quota; `reset: true` sets today's count to 0 (for a test, or when the counter is wrong) |
| `edu_voice_import {slug, lang, key, file}` | use a recording you made as the clip of a text key (copied as it is; locked and imported); the clip must be in the plan |
| `edu_asset_list {slug, kind: "voice"}` | the clips with their files, versions, placeholders and alt texts |
| `edu_studios_status` | lists VibeTTS (up or not, the number of voices) with Pixel Studio, Chiptune Studio, flow-music-mcp and Scriptorium |

`config/voice.md`: `geminiDailyLimit`, `geminiResetTz`, `narrationMaxChars`, `format`, `speed`; `config/studios.md`: `vibettsUrl`, `vibettsToken` (or `VIBETTS_MCP_TOKEN`). The golden fixture `hr-a1-greetings` has tone placeholders for its two listening items: `edu_voice_generate` on a copy of it (with any TTS) replaces them and the lint shows no `PLACEHOLDER_ASSET`.

## Research and the fact base

A course teaches only what its **fact base** says. The researcher (a role, `config/roles.md`) answers questions with short sourced facts; the fact base turns them into numbered, citable facts that the writers of articles and items rest on and the fact-checker checks against.

- **`edu_ask_researcher {slug, question, purpose?, wait?}`** creates the research job `<slug>--research--q<hash>--r0`. The researcher looks in the course's notes first (an exact match, or notes that share words with the question), then searches the web, reads the best three pages, and writes a note of facts (one claim each, in its own words, with the source URL and date) to `courses/<slug>/research/<n>-<question>.md`. When the pages answer nothing it asks the model for better search words once; as a last resort it writes facts from the model's own knowledge, marked **unverified**. A note that already answers the question is not searched again (a shared note in `research/` is copied into the course). With `wait: <seconds>` the call waits for the job and returns the note's facts (`note.facts: [{fact, source}]`); it returns early with `clientTasks > 0` when the research waits for you (a model call, or the web search below), and with `timedOut: true` when the time ran out. Statuses: `created`, `exists` (the same question was asked before), `limit` (the course reached `research_limit_per_course`, 40 by default, in `config/factory.md`), `no-researcher` (no researcher agent in `agents/`: nothing is queued) and an error for an empty question or an unknown course.
- **`edu_factbase_get {slug, merge?}`** reads `courses/<slug>/factbase/`: `facts` (`{id, fact, sources: [n], note, topic?, unverified?}`), the numbered `sources` (`{n, url, title, retrieved}`), the number of research `notes` and the `pendingNotes` not merged yet. `merge: true` merges the new notes first: each new fact gets the next id (`f1`, `f2` ...), each new source the next number; a fact that repeats one already there (the same words, ignoring case and punctuation) adds its source to it. Ids and numbers never change once given, so a citation stays right. Facts of an unverified note are only merged when `allow_unverified_facts: true` in `config/factory.md`; until then that note stays pending.
- **The files** (a person can read and edit them): `factbase/sources.md` (the numbered sources), `factbase/facts.md` (the facts with their ids and source numbers) and `factbase/merged.md` (the notes already merged). Text cites a fact as `[f3]` (also `[f3, f5]` and `[f3][f5]`); `[3]` is a source number. The pack's `factbase` takes one source per fact, the first.
- **Reviews.** Every reviewer answers `{verdict: pass|revise, scores: {<dimension>: 1-10}, notes, problems: [{ref, issue, fix?, severity?}]}`; `ref` is the id of the item or article at fault. The fact-checker's dimension is `accuracy`; its pass is required (`must_pass` in `config/quality.md`, with `threshold`, `max_rounds` and `revise_below`). A script runs first: every item must name facts that exist, every article must cite facts that exist; a problem there forces `revise` whatever the model says. The unit-level fact-check job arrives with the pipeline (EGS-08).
- **Search providers** (`config/providers.md`, `kind: search`, tried in `search_order`: `tavily`, `client-search`, `wikipedia`, then the switched-off `brave`, `serpapi`, `serphouse`, `duckduckgo`). A provider without its key is skipped; each answered paid request is a spend row; a paid one is skipped while a budget cap is reached. When no provider gives results the researcher writes unverified facts from the model.

**Do the web search yourself (`client-search`).** The `client-search` provider (on in the seed, free, no key) makes each search a task for you instead of calling a search service. The research job waits (`edu_wait` returns with `clientTasks`, as for any model call, and `edu_status` shows it):
1. `edu_get_task {role: "searcher"}` leases the oldest search task (`meta.task` is `web_search`, `meta.unit` is the query). `system` and `user` say what to find; the schema is the answer's shape.
2. Search the web yourself with your own search and fetch tools, read the pages, and prefer primary and recent sources. Answer `{"results": [{"title": "...", "url": "https://...", "content": "<a verbatim excerpt of the page, at most 1500 characters>", "published": "2026-10-14"}]}`: only URLs you really read, `published` optional, an empty list when you find nothing.
3. `edu_submit_task {taskId, text}`. A bad shape comes back as `{accepted: false, problems}` and the task stays yours.
4. A task nobody takes within `wait_minutes` (10 by default) gives no results and the next provider is tried, so a course never stalls without a session. Once you have taken it, the answer is waited for.

A course can also set its own models in `courses/<slug>/course.md` (`models: {<role> or "*": provider/model}`): they go before the agent's model and the role's list, so a course can run on `client/claude-code` while the others keep their models. A change takes effect at the next request, with no restart.

## The content team's work (EGS-07)

Each role of the team answers with one JSON object, checked by a zod schema (`src/engine/edu/authoring.ts`); the prompts are `prompts/<role>/<task>.md`. When you do the model work yourself (below), the task you get carries the exact JSON shape; this is what each one means:

| Role | Task | Answer |
|---|---|---|
| director | `plan_brief` | `{title, summary, units: [{title, focus}], research: [{question, unit}]}` |
| curriculum-designer | `curriculum` | `{units: [{id, title, summary, requires}], objectives: [{id, unit, bloom, text, facts: [fact ids]}]}`: ids unique, `requires` acyclic, every unit has an objective, every objective rests on existing facts |
| language-coach | `scope`, `accepted` | the vocabulary and grammar per unit (a language course); the other accepted answers of typed gaps (`ref` = item id, or `<item id>.<gap id>`) |
| subject-expert | `articles`, `articles_revise` | `{articles: [{id, unit, title, body, related}]}`: the body cites facts as `[f3]`; every article cites at least one existing fact |
| item-writer | `items`, `items_revise` | `{items: [...]}` of the kinds mcq, true-false, multi-select, cloze, typed, match-pairs, order, sort-groups, flashcard, conjugation (language courses; `{kind: "conjugation", verb, tense, forms: [{person, accepted: [form]}], given?: [persons], ask?}`); each names its objective and the facts it rests on; every objective in at least two kinds |
| misconception-designer | `distractors` | the full option list of each mcq and multi-select item (right options unchanged, a `why` for every wrong one) and the `why` of each true-false |
| explainer | `explain`, `polish` | `explanation`, `hint` and a `didYouKnow` with its `didYouKnowFact`; `polish` returns `{strings: {key: text}}` for flagged keys only |
| fact-checker, accessibility-reviewer, child-safety-reviewer | `fact_check`, `review` | the review JSON `{verdict, scores, notes, problems: [{ref, issue, fix?, severity?}]}`; scores `accuracy`; `accessibility` and `readability`; `age_fit` |
| game-designer | `design` | `{shells, quizArena: {roundLength, bossLength, timerSeconds?}, difficulty: [{item, difficulty}], notes}`, clamped to the player's limits (round 3 to 12, boss 4 to 20, timer 5 to 120 s, difficulty 1 to 5) |
| narrative-designer | `frame`, `scriptorium_brief` | a frame story (premise, characters, intro, outro, a beat per unit) or the brief `{idea, audience, length}` for Scriptorium |
| art-director | `plan` | `{images: [{for: article\|item\|shell, id or shell + slot, prompt, alt, ratio?, side?}], notes}`: a picture for every article, every required shell slot and every hotspot (see "Pictures"); a repair round, then a deterministic plan |
| art-critic | `review` | a review of one picture (it is sent with the request; a vision model) with the scores `relevance` and `clarity`; not must-pass |
| playtester | `report` | a review with the scores `flow` and `difficulty` and a list `deadEnds` |
| publisher | `publish` | `{blurb, notes}` (the decision itself is code: must-pass reviewers, hard gates and the threshold) |

A repair round sends back what is wrong in words: a schema issue (`units: units must be a list of {title, focus}`) or a problem found by a check (`q4: the item names the fact f9, which is not in the fact base`). Ids in an answer (units, objectives, items, articles, facts) must be the ones given.

**Assembly.** `assembleCourse` turns the answers into `course/pack.json` and the text catalog (keys: `item.<id>.prompt|expl|hint|dyk|why`, `item.<id>.opt.<optId>`, `art.<id>.title|body`, `fact.<id>.claim`, `story.*` ...). A language course keeps the taught phrases (items marked `taught`) in the target-language catalog. A pack made this way has `extensions.pipeline`, so `edu_lint` also holds it to `ITEM_NO_FACT` and `ARTICLE_NO_CITATION`.

**Playtest.** The autoplay bot plays a built game as simulated learners (perfect, always wrong, and right 90, 75 and 55 percent of the time) through `runPlaytest`; it needs Chromium (`yarn playwright install chromium`). A failed run or a console error is a hard gate of the publisher.

**Scriptorium.** A course whose brief says `story: scriptorium` hands the narrative designer's story idea to Scriptorium over MCP (`add_story`, then `wait_for_book`; `scriptoriumUrl` in `config/studios.md`, default `http://127.0.0.1:7341/mcp`). Edu Studio never starts Scriptorium (its engine resumes the whole book factory and may spend on paid models): when it is down, the story step is skipped.

## Do the model work yourself

The roles of the studio (the director now, the content team from EGS-06) ask a model for most of their work. Instead of LM Studio, Strata or a paid API you can answer them yourself, with nothing spent. Set a role (or one agent) to the model `client/claude-code`; its jobs then wait until you take them over MCP.

**Setting it up.** The `client` provider is on in the seed's `config/providers.md` and nothing uses it until you pick it:

```yaml
- id: client
  kind: client
  local: true
  concurrency: 8
  models:
    - id: claude-code
      vision: true     # the art-critic sends images
      context: 200000  # recorded only: Edu Studio sizes nothing by it
```

**Named clients.** Each model of the `client` provider is one named client: `client/claude-code` (what an `edu_get_task` without `client` takes) and `client/antigravity` (for Antigravity CLI). A task made for `client/antigravity` is never handed to a call without `client`, and the other way round; `edu_client_tasks` shows each task's `client`, and `edu_get_task` puts it in `meta.client`. Add another client with "Add a model by its id" on the `client` provider (Models page), and take its tasks with `client: "<id>"`.

**Choosing what the client does.** For one course, set `models: {"*": client/claude-code}` (or one role) in `courses/<slug>/course.md`. Or put `client/claude-code` first in a role's `models` list in `config/roles.md` (for example `director: {models: [client/claude-code, strata]}`); it is reloaded at once, and a request that is already waiting is asked again on the new model. One agent: `model: client/claude-code` in `agents/<agent>.md`. Put things back when you are done: a role left on `client` with nobody answering stalls every job that uses it.

**The loop.**
1. Start the work (the pipeline tools come in EGS-08), then `edu_wait {slug}`. It returns as soon as nothing runs except jobs that wait for you, with `clientTasks: n` and a hint (it does not block until the timeout). `edu_status` shows `clientTasks: {waiting, leased}` too, and `edu_client_tasks` lists the tasks (id, role, task, course, age).
2. `edu_get_task {client?, role?, book?, task?}` leases the oldest matching task to you for 30 minutes (`client` is the client model you are: `claude-code`, the default, or `antigravity`; `book` is the course slug). You get `{taskId, meta: {job, call, role, task, book, agent, unit, client}, turns, system, user, schema?, maxTokens?, output, leaseMinutes}`, or `{none: true, waiting}`. Each text is sent once. `turns: "single"` (nearly every task) has `system` and `user`. `turns: "multi"` (a repair round) has `system` and `messages: [{role, content}]`, the turns after the system text in order, and no `user`: answer the last user turn.
3. Write the answer as `output` says: one JSON object that matches `schema` (no prose, no code fence), or the text only.
4. `edu_submit_task {taskId, text}`. When the task has a schema the text is checked first: `{accepted: false, problems}` means fix it and submit again (the task stays yours, so the engine does not spend a repair round). `{accepted: true}` lets the job go on as if a model had answered. `edu_release_task {taskId}` gives a task back.
5. Repeat until `edu_get_task` says `none`, then `edu_wait` again, until the jobs are done. A lease that runs out (30 minutes) puts the task back in the queue, so several clients, or subagents with one task each, can work in parallel.

**Vision.** Tasks of the art-critic carry images. `edu_get_task` returns them as MCP image content after the text, in order; the `user` text has `[image 1]`, `[image 2]` where each one sat.

**Good to know.**
- A job that waits for you does not hold its agent: only jobs on other models count against an agent's `max_parallel` (1 by default, `agents/<agent>.md`).
- No timeout, and the provider is never marked down: a waiting job just waits. A job you stop (`edu_stop_now`, a model change) drops its task, and a later submit gets "task not found (it was aborted, answered, or the engine restarted)". The queue lives in memory: an engine restart loses the tasks, and the running jobs ask again.
- A job that never calls a model (build, lint) runs as usual.

## The queue

- Jobs have a priority: what you ask for with a tool goes before the jobs of the pipeline's own chain, oldest first inside each. A job still waits for the jobs it depends on.
- `edu_stop_now` stops the running jobs and pauses; they and everything queued run again after `edu_resume_all`, oldest first. `edu_stop_now {drop: true, slug?}` also deletes the queued jobs (of that course, or all). `edu_clear_queue {slug?, confirm: true}` drops the queued jobs without stopping the running ones.
- Spending is capped by `config/budget.md` (a daily and a monthly cap, a per-course cap). A model that is local, or the client, costs nothing.

## Languages

`edu_languages` lists the 37 built-in course languages (code, English name, native name, right-to-left, script) and the ones added in `config/languages.md`. Player menu strings exist for Croatian so far; other languages keep the English menus until the player extends the table.

**Language rules in the prompts (EGS-30).** When a course teaches a language that has rules (German today, `src/shared/lang`), the writer roles get them as the prompt variable `{{language_rules}}` (empty for other languages): item-writer (`items`, `items_revise`, plus the authored shape of the `conjugation` kind), language-coach (`scope`, `accepted`), misconception-designer, explainer and fact-checker. The German text is `src/shared/lang/de/rules.ts` (in code, so it is bundled with the engine and needs no seed refresh); the changed prompts reach an existing data folder through the seed refresh. The text is model-written German and has not been reviewed by a native speaker.

## Notes

- Paths you pass are paths on the machine that runs Edu Studio.
- Image generation (ComfyUI, Pixel Studio, Flow) has its tools since EGS-15 (`edu_asset_*`, see "Pictures"); music and sound effects (Chiptune Studio, ComfyUI ACE-Step, Flow Music on an opt-in) since EGS-16 (`edu_music_plan` and the same `edu_asset_*` tools, see "Music and sound effects"); the voice (narration and listening practice; Gemini, VibeTTS and ComfyUI TTS under the hub's quota rule) since EGS-17 (`edu_voice_*`, see "Voice"). `edu_studios_status`, `edu_comfy_status` and `edu_voice_status` check that the generators are up.
- Never start the hub's book factory (Scriptorium) from here: Edu Studio only calls it over MCP when a game needs a story.
