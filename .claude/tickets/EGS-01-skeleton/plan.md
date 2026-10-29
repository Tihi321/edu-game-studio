# EGS-01: repository skeleton (phase 0)

Derived from the hub plan HUB-19 (`creative-hub/.claude/tickets/HUB-19-edu-game-studio/plan.md`, phase 0). Branch: `EGS-01_skeleton` (root branch of the repo; there is no `master` yet).

## Goal

A working Edu Studio skeleton: VN Studio's generic engine core copied, the VN-specific parts stripped, renamed to Edu Studio, with green typecheck, lint and unit tests, a headless MCP server on port 7463, and a buildable Electron shell.

The repository is **public**: no keys, tokens, personal data, `~/EduGames` data or personal paths.

## Source

VN Studio committed `HEAD` (daf830f) exported to `.claude/temp/vn-src/` (gitignored). Do not touch the VN Studio repo itself (it has uncommitted VNO-51 work).

## Steps

- [x] Copy the generic core from `.claude/temp/vn-src`:
  - engine: `models/*`, `queue/*`, `budget/*`, `logs/*`, `store/*`, `agents/agents.ts`, `pipeline/{llm,prompts}.ts`, `transport.ts`, `summary.ts`, `cli.ts` (key-set, probe), `engine.ts`, `index.ts`;
  - `mcp/{http,server,stdio,relay,controller,config,raw.d.ts}.ts`, `mcp/tools-client.ts` (client tools), a new small `mcp/tools.ts` (registry `def(name, desc, zod, run)` + generic `edu_status`, `edu_wait`, client tools);
  - `studios/{mcp-http,autostart,launch,config}.ts`, `comfy/*`, `voice/comfy-tts.ts` (+ what it needs), `assets/{postprocess,palettes,manifest}.ts`, `themes/load.ts`;
  - `src/main`, `src/preload`; `src/shared/{md,schemas,languages,translit,protocol,ui-strings}.ts` (protocol + ui-strings trimmed to the generic core);
  - `src/shared/puzzles/` copied unchanged (the hub plan reuses it later for detective rooms) if it compiles on its own;
  - seed: `config/*` minus `renpy.md` (port 7463, Edu wording), `palettes/`, an empty-ish `agents/` + `prompts/` (no VN roles; a `director` placeholder is fine), workflows needed by copied comfy code.
- [x] Strip: `src/engine/vn/*`, `src/engine/game/*` (VN player), `vncli.ts`, VN MCP tools (`tools-story/plan/import/lang/puzzle`), `shared/vn.ts`, `shared/puzzle.ts` if VN-only, the renderer book UI, Ren'Py bits, VN-only tests and fixtures.
- [x] Rename: app **Edu Studio**, package `edu-game-studio`, preload bridge `window.edustudio`, MCP tools prefixed `edu_`, MCP port **7463** (`EDU_MCP_PORT`, `EDU_MCP_TOKEN`), data folder `~/EduGames` (`EDU_DATA` / `--data`; `EDU_SEED`), resource `edu-studio://guide` serving `docs/mcp-guide.md`, file protocol `edustudio-file://`. Data layout gets `courses/` instead of `projects/`.
- [x] Renderer: a minimal React shell (top bar "Edu Studio", engine status, and the generic Models / Agents / Settings pages if they copy cleanly; otherwise a status page). Phase 2 (EGS-05) builds the real studio UI.
- [x] Scripts: `build:engine` (`out/engine/index.js`), `dev`, `build`, `engine`, `mcp` (`--mcp-only`), `test`, `typecheck`, `lint`. Yarn 4, `nodeLinker: node-modules`, `packageManager` field.
- [x] Docs: `README.md`, `ROADMAP.md` (VN Studio style: Where it stands / Tasks in order / Done / Later; EGS-01..21 from the hub phases), `docs/design.md` (learning-design rules, shells, architecture), `docs/mcp-guide.md`, `AGENTS.md` (short rules for agents working in the repo), `.gitignore` (incl. `.claude/temp/`, `node_modules`, `out`, `release`, `.yarn/`), `LICENSE` (MIT, Tihomir Selak).
- [x] Keep the copied unit tests for the copied modules (queue/scheduler, router/models, budget, client, MCP http/config, custom providers, engine lock, seed, comfy, autostart, studios clients, languages, translit, assets postprocess/manifest, themes load, main files, puzzles) and make them green.

## Acceptance

- `yarn install`, `yarn typecheck`, `yarn lint`, `yarn test` pass.
- `yarn build:engine && node out/engine/index.js --mcp-only` (with `EDU_DATA` in `.claude/temp/`) listens on 7463; an MCP `initialize` + `tools/list` succeeds; tool names all start with `edu_`.
- `yarn build` succeeds.
- `git grep -iE "vno_|VisualNovels|VNO_|vnstudio|vn-studio|renpy"` returns nothing outside an explicit "copied from VN Studio" note.

## Results

Implemented 2026-10-29 on branch `EGS-01_skeleton` (nothing committed yet: the orchestrator commits).

### Verified (run, with evidence)

- `yarn install`: done (Yarn 4.13, `nodeLinker: node-modules`).
- `yarn typecheck`: exit 0 (node project incl. tests, and web project).
- `yarn lint`: exit 0.
- `yarn test`: 25 test files, 355 tests, all passed.
- `yarn build:engine` then `node out/engine/index.js --mcp-only` with `EDU_DATA=.claude/temp/data-egs01`: listened on 127.0.0.1:7463. Real MCP over HTTP: `initialize` (server `edu-studio` 0.0.1, with the instructions), `notifications/initialized` (202), `tools/list` returned 16 tools, all `edu_*`: `edu_list_courses, edu_status, edu_wait, edu_languages, edu_studios_status, edu_comfy_status, edu_comfy_free, edu_voice_status, edu_client_tasks, edu_get_task, edu_submit_task, edu_release_task, edu_pause_all, edu_resume_all, edu_stop_now, edu_clear_queue`. `edu_list_courses` and `edu_status` answered, `resources/list` gave `edu-studio://guide`, and `resources/read` returned `docs/mcp-guide.md` (8082 characters). The process was stopped and port 7463 was free afterwards; no `~/EduGames` was created.
- The same handshake against the app's own main process: `electron . --mcp-only --data .claude/temp/data-egs01-electron` (Electron main plus the engine as a utilityProcess): 16 tools, then stopped, port free.
- `yarn build` (engine, main, preload, renderer): succeeded (`out/engine`, `out/main`, `out/preload`, `out/renderer`).
- Hygiene greps (outside `node_modules`, `out`, `.claude`, `yarn.lock`): `vno_|VisualNovels|VNO_|vnstudio|vn-studio|renpy|ren'py` no matches; personal-data grep (user name, e-mail domains, home paths) no matches.

### Not verified

- `yarn dev` (the desktop window with hot reload) and the renderer in a real window were not opened; only the Electron main process was started, headless (`--mcp-only`). The renderer is only type-checked, linted and built, and its store is unit-tested (`tests/ui-store.test.ts`).
- Windows credential-store paths (`key:set`, `@napi-rs/keyring`) were not exercised.

### Deviations from the plan text

- `src/shared/media.ts` is new: the generic part of VN Studio's `shared/vn.ts` (language code schema, art/music/voice/sound settings as `courseSettingsSchema`, engine and provider ids, the asset manifest schemas). The kept generators, comfy and studios code need these types, so deleting `shared/vn.ts` without a home for them was not possible. EGS-02 builds the real course contract (`course.ts`) next to it.
- Not copied because they only work on a book/VN project (`VnService`): `assets/{derive,generate,import,flow-image}.ts`, `studios/chip-plan.ts`, `voice/{comfy-tts,flow,jobs}.ts` (the plan listed `voice/comfy-tts.ts`), `themes/{emit,pick}.ts`. (`shared/puzzle.ts` is kept: the puzzle generator needs it.) Their tests went with them. They are ported again in the media tickets (EGS-15 to EGS-17). `themes/load.ts` is kept and gained `themeFontFaces`.
- Kept besides the plan list: `studios/{pixel,pixelate,chiptune,music,flow,flow-music,draw,chip-sound}.ts` and `voice/{catalog,config,flow-catalog,vocab}.ts` (generic clients and catalogs, with their tests), and `src/engine/puzzles/solver.ts` (the pure-TypeScript puzzle prover, renamed from `python.ts`, Ren'Py SDK bits removed), because the puzzle tests need it.
- `src/engine/edu/` is the new home of what was `vn/`: `service.ts` (`EduService`: course list, queue helpers, `waitIdle`, and the ComfyUI / studios / voice status methods that were generic in `VnService`), `handlers.ts` (`registerEduHandlers`, registers nothing yet), `paths.ts` (`courseSlug`, `assertSlug`, `coursesDir`), `appdirs.ts`, `languages-config.ts`. The CLI is `src/engine/educli.ts` (`help`, `courses`).
- The seed has the `director` role only (agents, prompts and `roles.md`); `ROLES` in `shared/schemas.ts` is `['director']`. The seed no longer has the Scriptorium data folder setting, and the paths of sibling tools are relative (`../creative-hub/services.json`, `../pixel-art-generator`, `../midi-generator`, `../flow-music-mcp`) instead of absolute ones. The private Strata folder in `providers.md` became `<your Strata folder>`, and the default LM Studio model id is `gemma-4-e4b-it`.
- Added the generator MCP tools `edu_studios_status`, `edu_comfy_status`, `edu_comfy_free`, `edu_voice_status` (generic in VN Studio, needed by the kept tests) to the generic tool set.
- `ui-strings.ts` is a small Croatian table of player strings instead of the 37-language Ren'Py menu table; `LanguageInfo` lost its `renpy` field. `languages.test.ts`, `translit.test.ts`, `ui-store.test.ts`, `ui-mcp.test.ts`, `mcp-http.test.ts`, `seed-*.test.ts`, `models.test.ts` and `voice-catalog.test.ts` were adapted; `mcp-http.test.ts` is rewritten for the generic tools. `tests/vn-helpers.ts` became `tests/edu-helpers.ts`.
- `SEED_HISTORY` (hashes of earlier seed versions) is empty: Edu Studio has no earlier seed.
- Files are LF (`.gitattributes`: `* text=auto eol=lf`); the VN Studio sources had CRLF.
- No `build/` icons, `scripts/`, `electron-builder.config.cjs` or `dist` scripts (packaging is EGS-20).
- Left as in VN Studio: the job file field `book` (it now holds the course slug), and the RNG salt strings `vno-puzzles:...` in `src/shared/puzzles/` (changing them would change every generated puzzle; `src/shared/puzzles/` is copied unchanged as planned).
