# EGS-03 changelog

## 2026-10-29: EGS-03 player runtime, quiz arena, build, edu_lint, course MCP tools and CLI

Branch `EGS-03_player-runtime` (stacked on `EGS-02_course-contract`). Done by two implementers in parallel (engine side, player side) on a contract the orchestrator wrote first (`src/shared/game-data.ts`).

### What changed

- `src/shared/game-data.ts`: the build/player contract (`GameData`, `renderIndexHtml`, `renderGameDataJs`, `window.EDU_GAME_DATA`, `#edu-root`).
- `src/player/**`: our own browser runtime (DOM + CSS, inline SVG for hotspots): `window.EduEngine` plugin API, quiz arena shell, renderers for all 13 item kinds, localStorage progress + SM-2 queue with export/import/reset, en/hr player strings, chalkboard theme (`style/*.css`, CSS variables, reduced motion, phone layout). `docs/player.md` documents screens, `data-testid`s and `getState()`.
- `vite.player.config.ts`, `tsconfig.player.json`, `tests/setup/player-bundle.ts`, `package.json` (`build:player` before `build:engine`, `playwright` devDependency), `vitest.config.ts` (globalSetup), `tsconfig.json`, `tsconfig.node.json`.
- `src/engine/edu/`: `player-bundle.ts` (finds `out/player`, `EDU_PLAYER_DIR`), `build.ts` (`courses/<slug>/course` -> `courses/<slug>/build/` with index.html, player.js/css, game-data.json/js, assets; refuses on structural problems unless `force`), `lint.ts` (pedagogy lint over the built game: 14 error codes + `PLACEHOLDER_ASSET` warning; errors -> exit 1), `store.ts` (`CourseStore` shared by CLI and MCP), `course-io.ts` and `service.ts` adjusted.
- `src/engine/educli.ts`: `courses`, `import-course`, `validate`, `build [--force]`, `lint [--json]`, `help` (no engine started).
- `src/engine/mcp/tools-course.ts`: `edu_create_course`, `edu_get_course`, `edu_course_edit` (merge patch), `edu_item_add/update/remove`, `edu_text_set`, `edu_import_course`, `edu_validate`, `edu_build`, `edu_lint`; `edu_status {slug}` adds course info; server instructions and `docs/mcp-guide.md` ("Build a course").
- `tests/fixtures/courses/broken/` + `EXPECTED.md`; tests `tests/edu-{build,lint,mcp,cli}.test.ts` (80) and `tests/player-{progress,round,feedback}.test.ts` (32).

### Deviations

- One `build/` per course with all editions and an in-player language picker (instead of one build per language).
- Course title is the catalog string `course.title` (the pack has no title field) - candidate for a contract field later.
- `ITEM_MULTI_KEY` and `DISTRACTOR_IS_KEY` read stored shapes the strict schemas reject (`answers` list, `extensions.nearMisses`).
- Course edits refuse only new structural problems; missing texts come back as `pending`.
- `playwright` was added in EGS-03 (for the player smoke checks) rather than EGS-04.

### Verification

- `yarn typecheck` exit 0, `yarn lint` exit 0, `yarn test` 38 files / 587 tests passed (orchestrator re-run).
- Built engine CLI with the real bundle: solar-system lint 0/0 exit 0; hr-a1-greetings 0 errors + 2 placeholder-audio warnings exit 0; broken fixture lint exit 1 with the expected codes.
- Player smoke in Chromium over `file://` on both fixtures at 1280x800 and 390x844: full playthroughs, 0 console/page errors.
- Not run: real audio output, real touch devices, measured contrast (axe in phase 2), MCP course tools over a live HTTP session (in-process registry only), `yarn build` (Electron) for this ticket.

### Commit status

Committed as one commit on `EGS-03_player-runtime` (not pushed).
