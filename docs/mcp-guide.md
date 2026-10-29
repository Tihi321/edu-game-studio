# Edu Studio MCP guide

Edu Studio turns a topic into a playable educational game: a course (objectives, articles, items with answer keys, game shells) that a self-contained web player plays. This server lets an agent such as Claude Code drive the studio: see the courses and the job queue, and do the model work of the jobs itself, at no cost.

**Status: EGS-15.** The course tools (create, edit, items, text, import, validate, build, lint), the research tools (ask the researcher, read the fact base) and the generic ones below work. The content team's prompts, output contracts, the assembly of a course and the playtest runner (EGS-07) exist as engine code; `edu_run_pipeline` runs them from a brief to a published course (EGS-08, see "Make a course from a brief"); the pictures (the art-director and the art-critic, the asset tools, placeholders) are real since EGS-15 (see "Pictures"); music and voices arrive in EGS-16 and EGS-17 (see `ROADMAP.md`); each later ticket adds its tools to this guide.

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
| Queue | `edu_pause_all`, `edu_resume_all`, `edu_stop_now {drop?, slug?}`, `edu_clear_queue {slug?, confirm: true}` |
| Client provider | `edu_client_tasks`, `edu_get_task {client?, role?, book?, task?}`, `edu_submit_task {taskId, text}`, `edu_release_task {taskId}` |
| Pictures | `edu_asset_list {slug, kind?}`, `edu_asset_plan {slug, fallback?}`, `edu_asset_generate {slug, ids?, force?, kind?}`, `edu_asset_set {slug, id, prompt?, negative?, provider?}`, `edu_asset_select {slug, id, version}`, `edu_asset_replace {slug, id, file}`, `edu_asset_lock {slug, id, locked}`, `edu_media_settings {slug, set?}` (see "Pictures") |
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
| `GAME_DATA_INVALID` | error | `game-data.json` is missing or is not a game |

## Make a course from a brief

`edu_run_pipeline` turns a brief into a published, playable course with the team of roles, as file jobs in the queue. One call creates the course and starts the run:

```
edu_run_pipeline {brief: {topic: "The Roman Empire", audience: "teenagers", age: 14, sourceLang: "en", units: 2, model: "client/claude-code", story: "none"}}
```

**The brief** (`src/shared/brief.ts`; it is saved in `courses/<slug>/course.md`). Required: `topic`, `audience`. Optional: `age` (years; `kids` defaults to age < 13), `level` (free text), `cefr` (a language course), `sourceLang` (default `en`), `languages` (editions; only the source language is built now, the others are recorded and the step `editions` is skipped until Book Translator, EGS-18), `targetLang` (the language that is taught: a language course), `shells` (default `["quiz-arena"]`), `format` (an id of `config/formats.md`: `quick` is 2 units, `standard` 4, `deep` 6, `language-a1`; default `quick`, or `language-a1` with a `targetLang`), `units`, `objectivesPerUnit`, `itemsPerObjective` (override the format), `kids` (the child-safety reviewer must pass it), `story` (`none`, `frame`: a frame story written by the narrative designer, or `scriptorium`: the story idea is handed to Scriptorium, which is never started from here; when it is down the step is skipped), `media` (the media settings, written to `course.md`: see "Pictures"), `model` (`provider/model` for every role of this course, written to `course.md` as `models["*"]`: `client/claude-code` makes you the team), `notes`. The slug is made from the topic (`the-roman-empire`) unless you pass `slug`. `edu_create_course {brief}` only creates the course and `course.md`; `edu_run_pipeline {slug}` then starts the run.

**The steps** (the job id is `<slug>--<task>[-k<round>]--<unit|all>--r<run>`; a research job is `<slug>--research--q<hash>--r0`):

```
plan -> research x N -> factbase -> curriculum -> scope (language courses)
  -> per unit, in parallel: articles -> items -> distractors -> fact_check -> explain -> accepted (language courses)
  -> design -> story -> art_plan -> art_generate -> art_review (-> art_generate-k2 -> art_review-k2 ...) -> music, voice (skipped until EGS-16, EGS-17) -> assemble
  -> accessibility review (+ child-safety review for kids) -> build -> lint -> playtest -> playtest_report -> publish -> summarize
```

Each step writes its output to `courses/<slug>/pipeline/` (`plan.json`, `curriculum.json`, `units/<unit>/{articles,items,distractors,explain,accepted}.json`, `reviews/*.json`, `design.json`, `story.json`, `art.json`, `polish.json`, `lint.json`, `playtest.json`, `report.json`, `publish.json`, and `steps.json` = the state), then calls `advance`, which enqueues what can run next from those files. The assemble step writes `course/pack.json` and `course/text/<lang>.json`; build and lint are the ones of `edu_build` / `edu_lint`; the playtest step plays the built game with the autoplay bot as simulated learners (needs Chromium: `yarn playwright install chromium`).

**Gates and loops.** The fact-checker must pass (`config/quality.md`, `must_pass`): a `revise` sends the unit to `articles_revise` / `items_revise` (only the flagged ids change), then `distractors` and `fact_check` again, as round 2 (`-k2` in the job ids), up to `max_rounds`; after the last round a reviewer that still says revise blocks the run. The accessibility reviewer (and the child-safety reviewer for kids) review the assembled course; a revise goes through `polish` (the explainer corrects only the flagged text keys) and `assemble` again. The publisher decides in code: must-pass reviewers, the weighted score against `threshold`, and two hard gates, lint errors and a failed autoplay bot; only a course that passes gets its blurb. `courses/<slug>/course.md` says `stage: running | blocked | published | failed` and its body is the run log the director's summary is appended to.

**Looking.** `edu_status {slug}` has a `pipeline` block: `run`, `stage`, every step with its status (`queued`, `running`, `done`, `skipped`, `blocked`, `failed`) and note, `failed` (the failure text of a job that failed for good), `blockedBy` (why a run is blocked: the must-pass role, the gate) and `next` (what to do). `edu_wait {slug}` returns the same block when the course has nothing left to run.

**Resume, retry, restart.** `edu_run_pipeline {slug}` on a course with a run in progress advances it (finished steps are not redone, also after the engine restarted). `{slug, retry: true}` puts the failed jobs of the run back in the queue. `{slug, restart: true, from: "<stage>"}` starts run n+1 and clears the outputs from that stage on (`plan`, `research`, `factbase`, `curriculum`, `scope`, `articles`, `items`, `distractors`, `fact_check`, `explain`, `accepted`, `design`, `story`, `art`, `assemble`, `review`, `build`, `lint`, `playtest`, `publish`); the research notes are kept. A job of an older run does nothing.

**Doing it all yourself (`model: "client/claude-code"`).** Every model call of the run waits for you (see "Do the model work yourself"); the steps that need no model (factbase, assemble, build, lint, playtest) run on their own in between. The loop: `edu_run_pipeline {brief}`, then `edu_wait {slug}` (it returns as soon as a call waits, with `clientTasks`), `edu_get_task` and `edu_submit_task` until `none`, `edu_wait` again, until `stage` is `published` or `blocked`. Every task's `user` text is the whole prompt (the course, the unit, the objectives, the fact base, the rules, the JSON shape) and `schema` is the shape of the answer. The researcher's web search is also yours when `search_order` in `config/providers.md` has only `client-search` (`search_order: [client-search]`): those tasks have role `searcher` and the answer shape `{results: [{title, url, content}]}` (see "Research and the fact base"). About 30 to 40 tasks make a 2-unit quick course (plan, 4 research notes and searches, curriculum, 5 per unit, design, review, playtest report, publish, summary).

## Pictures: art, the art-director and the art-critic (EGS-15)

A pipeline run makes the pictures of the course. `art_plan` (the art-director) -> `art_generate` (no model: the generators) -> `art_review` (the art-critic, with regenerate rounds) run after `story` and before `assemble`; `assemble` links the assets into the pack, so the build carries them and `edu_lint` finds no `ASSET_MISSING`.

**The plan** (`courses/<slug>/pipeline/art.json`). The art-director (role `art-director`, prompt `prompts/art-director/plan.md`) is shown the units, the articles, the items and the shells of the course and answers `{images: [{for: article|item|shell, id | shell + slot, prompt, alt, ratio?, side?}], notes}`:
- one picture per encyclopedia article (dual coding: it shows the fact; nothing decorative);
- a picture for an item only where it helps (at most 12; a flashcard may have a `back` picture); a hotspot item whose picture is missing needs one, fitted to the item's `width` x `height`, with its regions drawn faintly over it by code (no text labels: the label is the question);
- the art of every shell in the brief (`shells`) and in the game design, from a table of slots in code: `quiz-arena` a backdrop per unit (`bg-<unit>`) and `bg-boss`; `mindmaze` a castle room per unit (`room-<unit>`); `encyclopedia` a plate per article (`plate-<article>`); `rpg` the tile set (`tiles`), the `hero` and the NPCs (`npc-1`...), pixel art with a palette; any other shell id gets one `backdrop`. Shells the player does not have yet (EGS-10..14) still get their art: the pack records it in `shells.config[<shell>].art = {slot: assetId}`.

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
  music: {}                # EGS-16
  voice: {}                # EGS-17
```

**Providers.** ComfyUI makes the pictures (autostarted from the hub's `services.json` when `config/autostart.md` allows it; `EDU_AUTOSTART=0` turns that off). The tile set and the sprites of the RPG shell are turned into pixel art by Pixel Studio (MCP 7457: `import_image` then `export_many`; the native copy is kept next to the version); when Pixel Studio is down the built-in pixelate runs and the version carries a warning. **Google Flow is never called unless the course sets `art.provider: flow` (or one asset sets `provider: flow` with `edu_asset_set`).** Sprites are cut out with BiRefNet (a flat-colour key without it) and trimmed.

**Placeholders.** A provider that is down (after the autostart, or with it off) or a picture that fails does **not** fail the run: the asset gets a placeholder card, `assets/<id>/placeholder.svg`, and the step says why. The pack links it, the build carries it, and `edu_lint` warns `PLACEHOLDER_ASSET` for each (a warning is not a publish gate: the course still publishes). `edu_status {slug}` has a `media` block (`images`, `made`, `placeholders`, `rejected`). A real version, or `edu_asset_replace`, replaces the placeholder and removes its file.

**The art-critic** (role `art-critic`, a vision model: images are sent as message parts; with `client/claude-code` the images come with `edu_get_task` as MCP image content) reviews each new version against its plan line: `{verdict, scores: {relevance, clarity}, notes, problems: [{ref, issue, fix}]}`. A `revise` makes that picture again with the critic's note added to the prompt (`art_generate-k2`, then `art_review-k2`), up to `max_rounds` (`config/quality.md`). The critic is **not must-pass**: after the last round a picture that is still rejected stays in the course with `review.status: rejected` and the note (the step note and `edu_status` count them). With `media.art.review: false`, or no vision model, `art_review` is skipped and says why.

**Tools** (they write the manifest and then re-link the pack, so a built course picks the change up with the next `edu_build`):

| Tool | What it does |
|---|---|
| `edu_asset_list {slug, kind?}` | the assets: id, kind, what each illustrates, selected version, file, `placeholder` (and why), review, prompt, provider, warnings; `summary`; the art settings |
| `edu_asset_plan {slug, fallback?}` | plan the pictures of a course, also a hand-made one: queues the art-director (a model job); `fallback: true` plans from the course text at once, with no model |
| `edu_asset_generate {slug, ids?, force?, kind?}` | queues one job that makes the pictures that have no file yet (`force`: again; locked and hand-made ones are never touched); returns the job id |
| `edu_asset_set {slug, id, prompt?, negative?, provider?}` | the prompt (kept by the art-director from then on), the negative prompt, or `comfy` / `flow` for this asset |
| `edu_asset_select {slug, id, version}` | use an earlier version |
| `edu_asset_replace {slug, id, file}` | use a file you made (png, jpg, webp, gif, avif, svg), copied as it is; `source: custom`, locked; removes a placeholder |
| `edu_asset_lock {slug, id, locked}` | a locked asset is never made again |
| `edu_media_settings {slug, set?}` | read, or change with a JSON merge patch, the `media` block of `course.md` |

`edu_studios_status` shows Pixel Studio, Chiptune Studio and flow-music-mcp; ComfyUI is checked by `edu_comfy_status`.

**The bot's media check.** `scripts/play.mjs` loads every asset URL of `game-data.json` in the page (an image must decode; audio must reach `canplaythrough` or `loadedmetadata`). A failure is a `mediaErrors` entry of its summary and fails the run, like a console error (`--no-media-check` turns it off). The player logs `console.error` when an image or an audio element fails to load.

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
| item-writer | `items`, `items_revise` | `{items: [...]}` of the kinds mcq, true-false, multi-select, cloze, typed, match-pairs, order, sort-groups, flashcard; each names its objective and the facts it rests on; every objective in at least two kinds |
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

## Notes

- Paths you pass are paths on the machine that runs Edu Studio.
- Image generation (ComfyUI, Pixel Studio, Flow) has its tools since EGS-15 (`edu_asset_*`, see "Pictures"); music (Chiptune Studio) and voice (local TTS) arrive in EGS-16 and EGS-17. `edu_studios_status`, `edu_comfy_status` and `edu_voice_status` check that the generators are up.
- Never start the hub's book factory (Scriptorium) from here: Edu Studio only calls it over MCP when a game needs a story.
