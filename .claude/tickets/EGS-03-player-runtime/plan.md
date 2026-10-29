# EGS-03: player runtime, quiz arena, build, edu_lint and MCP tools (phase 1, part 2)

Derived from the hub plan HUB-19 phase 1 steps 2 and 3. Branch: `EGS-03_player-runtime`, stacked on `EGS-02_course-contract`.

## Goal

Our own browser player (no game-engine libraries: DOM/CSS, Canvas 2D only where needed) that plays any course in the **quiz arena** shell, built from a course folder into a self-contained folder that works over `file://`; a native lint over the built `game-data.json`; engine CLI and MCP tools to create/edit courses and items, build, lint and report status.

## Steps

- [x] Player sources in TypeScript (e.g. `src/player/`), bundled to one IIFE `player.js` + `player.css` (own vite/esbuild config, built before the engine or read from disk). Reuse `src/shared/course.ts` and `src/shared/edu/*` so the player and lint share checkers.
- [x] Build (`src/engine/edu/build.ts` or `src/engine/game/`): emits `index.html`, `player.js`, `player.css`, `game-data.json`, `game-data.js` (`window.EDU_GAME_DATA = ...`, so it works from `file://`), plus copied assets, into `courses/<slug>/build/<lang>/` (or `build/` with an edition switcher). **Engine side done**: `src/engine/edu/build.ts` writes one `build/` with an edition switcher in the player (all editions in one `game-data.json`), the bundle comes from `player-bundle.ts` (see Results, Engine side).
- [x] Runtime API on `window.EduEngine`: `registerShell(id, shell)`, `registerItemKind(kind, renderer)`, `getState()`; shells and item renderers are plugins.
- [x] Quiz arena shell: title -> unit map (locked until prerequisites mastered) -> rounds of mixed items (interleaved kinds, adaptive difficulty), optional timer, combo meter, boss round mixing earlier units, review of misses (SR queue), mastery stars per unit, explanation per distractor on a wrong answer, "did you know" on a right one, end screen with summary. Language picker for editions.
- [x] All item kinds rendered: mcq, true-false, multi-select, cloze, typed, match-pairs, order/timeline, sort-groups, hotspot (Canvas 2D or positioned SVG over the image), listening (audio + choose/type), flashcard (flip + self-grade), crossword, word-search.
- [x] Progress + SR queue in `localStorage` (namespaced by course id), export/import as JSON file.
- [x] Every interactive element has `data-testid`; keyboard playable (Tab/Enter/Space/arrows, number keys for options); mobile layout to 360 px width; `prefers-reduced-motion` respected; chalkboard theme with CSS variables (chalk fonts from system stacks or embedded, no external CDN), looks good already.
- [x] `edu_lint` / CLI `lint <slug>` over `game-data.json` (exit 0 clean / 1 problems), codes e.g. `ITEM_NO_KEY`, `ITEM_MULTI_KEY`, `ACCEPTED_INCOMPLETE`, `DISTRACTOR_DUPLICATE`, `DISTRACTOR_IS_KEY`, `OBJECTIVE_ONE_FORM`, `ASSET_MISSING`, `TEXT_MISSING`, `PREREQ_CYCLE`, `UNIT_UNREACHABLE`, `PLACEHOLDER`. **Done**: `src/engine/edu/lint.ts` (over the built `game-data.json` + asset files).
- [x] A deliberately broken fixture `tests/fixtures/courses/broken/` that fails lint with a documented list of expected codes (a test asserts it). **Done**: `tests/fixtures/courses/broken/` + `EXPECTED.md`, asserted in `tests/edu-lint.test.ts`.
- [x] Engine CLI (`yarn engine -- build <slug>`, `lint <slug>`, `courses`, `import-course <folder>`) and MCP tools: `edu_list_courses`, `edu_create_course`, `edu_get_course`, `edu_course_edit`, `edu_item_add`, `edu_item_update`, `edu_item_remove`, `edu_text_set`, `edu_build`, `edu_lint`, `edu_status` (plus the generic ones from EGS-01). Update `docs/mcp-guide.md`. **Done** (the CLI starts no engine; `edu_import_course` and `edu_validate` added too).
- [x] Tests: build of both golden fixtures produces the files; lint clean on both; broken fixture codes; MCP tools happy-path via the in-process tool registry; runtime unit tests where practical (jsdom not required; keep logic in shared modules). **Engine side done** (build, lint, broken fixture, MCP tools, CLI: `tests/edu-{build,lint,mcp,cli}*.test.ts`); the runtime unit tests are player side.

## Acceptance

`yarn typecheck`, `yarn lint`, `yarn test` green; `yarn engine -- build` + `lint` on both fixtures exits 0; broken fixture exits 1 with the expected codes.

## Results

### Engine side (build, lint, CLI, MCP tools, broken fixture)

Implemented 2026-10-29 on branch `EGS-03_player-runtime` (not committed). Contract used: `src/shared/game-data.ts` (unchanged).

#### Verification (all run)

- `yarn typecheck`: exit 0.
- `yarn lint`: my files are clean (`yarn eslint src/engine tests` has no problem). The whole-repo run reported 2 errors in the player implementer's `src/player/shells/quiz-arena.ts` (unused `answerKeyOf` import, a useless assignment at line 351), not mine.
- `yarn test`: 35 files, 555 tests passed (with the player side's files present at that time). My four new files: `tests/edu-build.test.ts` (16 tests), `tests/edu-lint.test.ts` (35), `tests/edu-mcp.test.ts` (18), `tests/edu-cli.test.ts` (11) = 80 tests.
- `yarn build:engine`: exit 0. Smoke with the built engine (`node out/engine/index.js ...`, a scratch data folder in `.claude/temp/`): `courses`, `import-course`, `build`, `lint` on solar-system exit 0 ("0 error(s), 0 warning(s)"); `build broken` exits 1 (refused), `build broken --force` exits 0, `lint broken` exits 1 with 19 errors; with no `EDU_PLAYER_DIR` the real `out/player/` bundle was found by the walk-up from `out/engine/` and used. The data folder only gets `courses/`: no engine, lock, MCP server or service starts.
- The tests use a fake player bundle in a temp folder (`EDU_PLAYER_DIR` / the `playerDir` option); none depends on `out/player/`.
- NOT run: nothing was opened in a browser (the build folder was never played here), no spawn of `node out/engine/index.js` from a test (the CLI function is called directly, plus the manual smoke above), `yarn build` (Electron) and the MCP tools over a real HTTP session (they go through the in-process registry; the HTTP path is unchanged).

#### Files

- New: `src/engine/edu/player-bundle.ts` (`findPlayerBundle`, `engineVersion`), `build.ts` (`buildCourse`, `assetUrl`, `defaultLangOf`, `courseTitleOf`, `buildDirOf`), `lint.ts` (`lintGameData`, `lintGame`, `summarize`, `LINT_CODES`), `store.ts` (`CourseStore`: create, import, get, edit, items, text, validate, build, lint; `listCourses`, `mergePatch`), `src/engine/mcp/tools-course.ts` (the course tools), `tests/edu-build-helpers.ts`, `tests/edu-{build,lint,mcp,cli}.test.ts`, `tests/fixtures/courses/broken/{EXPECTED.md,course/pack.json,course/text/en.json}`.
- Changed: `src/engine/edu/course-io.ts` (extracted `assetFileProblems`; behaviour the same), `src/engine/edu/service.ts` (`listCourses` delegates to the store; new `courses` getter), `src/engine/educli.ts` (the course commands, `runCli(argv, io, env)`), `src/engine/index.ts` (help text), `src/engine/mcp/tools.ts` (spreads `courseTools`; `edu_status {slug}` adds `course`), `src/engine/mcp/server.ts` (INSTRUCTIONS), `docs/mcp-guide.md` (new section "Build a course": workflow, contract, item kinds, merge-patch rules, lint codes), `README.md` (CLI row), `tests/fixtures/courses/README.md` (a note on `broken/`).

#### Design choices

- **Layout**: `courses/<slug>/course/{pack.json,text/<lang>.json,assets/*}` -> `courses/<slug>/build/`. `buildCourse(courseDir, outDir = <courseDir>/build, {force, env, playerDir, now})` takes the course root (the folder that holds `course/`). It cleans only `<courseDir>/build`, a folder that already holds an Edu Studio `game-data.json`, or an empty folder; anything else throws. The player bundle is looked up BEFORE anything is cleaned. An asset's URL is `assets/<file without a leading assets/>`.
- **`force`**: builds although validation (or a missing asset file) reports problems, as long as the pack and the catalogs parse (otherwise `ok: false`). The result lists the problems and says `forced: true`. Used by the broken fixture only (and `--force` in the CLI).
- **Course title**: the pack has no title field, so the title is the catalog string `course.title` (subject as fallback); `edu_create_course` writes it. Documented in the guide.
- **Lint** works on the built data. It reruns `validateCourse` over it and keeps its codes, except `MISSING_TEXT`, which is reported as `TEXT_MISSING` (a string) or `ACCEPTED_INCOMPLETE` (an accepted list). Codes: `ITEM_NO_KEY`, `ITEM_MULTI_KEY`, `ACCEPTED_INCOMPLETE`, `DISTRACTOR_DUPLICATE`, `DISTRACTOR_IS_KEY`, `OBJECTIVE_ONE_FORM`, `OBJECTIVE_NO_ITEMS`, `UNIT_NO_OBJECTIVES`, `ASSET_MISSING`, `TEXT_MISSING`, `PREREQ_CYCLE`, `UNIT_UNREACHABLE`, `PLACEHOLDER` (errors), `PLACEHOLDER_ASSET` (warning), `GAME_DATA_INVALID` (error). Errors -> exit 1, only warnings -> exit 0.
  - `ITEM_MULTI_KEY` is read from the stored item (an `answer` array or an `answers` list with 2+ entries on mcq / true-false / listening-choose), because the strict kind schema has no way to hold two keys: such an item also gets the validator's `SCHEMA`.
  - `ITEM_NO_KEY`: the key points to no option, region or answer, or the item's own `solve` does not `check` right in an edition whose texts are complete.
  - `DISTRACTOR_IS_KEY` for a typed item's "near-miss list": the schema has no such field, so it reads `extensions.nearMisses` (array of strings) when present; also covers cloze word-bank words that are an accepted answer of their gap. Texts are compared with `normalizeText(..., {fold: true})`.
  - `PLACEHOLDER` markers: `TODO`/`TBD`/`FIXME` upper case (lower case only with a colon, so "todo-list" and "Todos" are fine), `lorem ipsum`, `XXX`, `[[`, a `{{` that is not a gap id of the cloze item that owns that string, and the word "placeholder". `PLACEHOLDER_ASSET` (warning): an asset whose file name or alt text says placeholder; the strings of that asset's alt and of the items that use it may then say "placeholder" without an error. This keeps both golden fixtures at exit 0: solar-system has no problems, hr-a1-greetings has exactly 2 `PLACEHOLDER_ASSET` warnings.
- **CLI**: no engine is started for any command (the engine lock, seed copy and MCP server are not touched), so it also works while the app runs. Exit codes: 0 ok, 1 problems or failure, 2 wrong command line.
- **MCP tools** (13 new or extended, all `edu_*`): `edu_create_course`, `edu_get_course`, `edu_course_edit`, `edu_item_add`, `edu_item_update`, `edu_item_remove`, `edu_text_set`, `edu_import_course`, `edu_validate`, `edu_build`, `edu_lint`, plus `edu_list_courses` (unchanged) and `edu_status {slug}` (now adds `course`: counts, editions, build state, `stale`). Edits are JSON merge patches (RFC 7396; arrays replace). A result with a new structural problem (schema, unknown ids, duplicate ids) is refused and nothing is written; texts still to write, missing `why`, gap markers and asset files are `pending` (saved, reported). `edu_item_add` / `edu_item_update` / `edu_course_edit` take a `text` argument so an item and its strings are one write. Writes use `store/atomic` and are serialised per course.

#### Deviations and open points

- `buildCourse` returns `{ok, outDir, problems, forced, files, data}` and takes the course root, not the `course/` folder.
- Edits refuse only new structural problems; "refuse invalid results" is not literal for unfinished text (see above), because a unit or an item cannot be written before its strings.
- `edu_create_course` seeds one unit (`u1`) and one objective (`u1-o1`), because the pack schema needs at least one of each; a fresh course therefore lints with `OBJECTIVE_NO_ITEMS` until items are added.
- `startHeadless` in `educli.ts` is kept (the stdio MCP uses it); the course commands no longer use it.
- No dependency or `package.json` change was needed from my side.
- The `edu_get_course` result can be large (the whole pack); pass `lang` for one catalog or `text: true` for all.
- A fresh `lint` reads the existing build: after an edit it says `stale: true` until `rebuild: true` (or a build).


(Player side: filled in by the orchestrator.)

### Player side (runtime, quiz arena, item renderers, theme)

Implemented 2026-10-29 by a second implementer in parallel (results recorded by the orchestrator).

- `src/player/` (plain TS + DOM, no game-engine library, no React): `window.EduEngine` (`version`, `registerShell`, `registerItemKind`, `getState`, `start`), the quiz arena shell (title with language picker, timer setting, export/import/reset; unit map with prerequisite links, locks and stars; interleaved rounds with adaptive difficulty and the in-session re-ask queue; feedback with per-distractor `why`, explanation, correct answer and "Did you know?"; summary; boss round; review of misses; end), renderers for all 13 item kinds, progress + SM-2 cards in `localStorage` (namespaced by pack id, export/import/reset, storage failures tolerated), chalkboard theme with CSS variables, reduced motion, phone layout.
- Bundle: `vite.player.config.ts` -> one IIFE `out/player/player.js` (~204 KB) + `player.css` (~31 KB); `build:player` runs before `build:engine`; vitest `globalSetup` (`tests/setup/player-bundle.ts`) builds it. `tsconfig.player.json` (DOM lib). `playwright` devDependency added here (used for smoke checks; EGS-04 builds the bot on it).
- `docs/player.md`: screens, every `data-testid`, `getState()` shape, round/star/queue rules, theming.
- Tests: `tests/player-{progress,round,feedback}.test.ts` (32 tests).
- Smoke (temp scripts, Chromium over `file://`, 1280x800 and 390x844): both fixtures played title -> map -> rounds with misses -> review -> all units mastered -> boss -> end, export/reset/import; 0 console errors, 0 page errors; keyboard, timer, no-storage, reduced-motion and language-switch assertions passed. Screenshots in `.claude/temp/screens/egs03/` (gitignored).
- Deviations: course title comes from the catalog string `course.title` (no pack field); player UI strings in `src/player/i18n.ts` (en/hr, overridable by `ui.<key>` catalog strings); crossword cells are 22-26 px on a phone (each clue has a 44 px whole-word input as the alternative).
- UNTESTED: real audio output (placeholder tones), drag-and-drop ordering (buttons tested), real touch devices, measured contrast (axe run is phase 2). Known cosmetic: faint texture seam on very tall screens.

### Integration (orchestrator)

`yarn typecheck` exit 0, `yarn lint` exit 0, `yarn test` 38 files / 587 tests passed; `yarn build:engine` ok; built engine CLI with the real player bundle: `import-course` + `lint` solar-system -> 0 errors 0 warnings, exit 0; hr-a1-greetings -> 0 errors, 2 `PLACEHOLDER_ASSET` warnings, exit 0; `build broken --force` then `lint broken` -> exit 1, 19 errors, codes ACCEPTED_INCOMPLETE ASSET_MISSING DISTRACTOR_DUPLICATE DISTRACTOR_IS_KEY ITEM_MULTI_KEY ITEM_NO_KEY OBJECTIVE_NO_ITEMS OBJECTIVE_ONE_FORM PLACEHOLDER PREREQ_CYCLE SCHEMA TEXT_MISSING UNIT_NO_OBJECTIVES UNIT_UNREACHABLE UNKNOWN_OPTION.
