# EGS-01 changelog

## 2026-10-29: EGS-01 skeleton: Edu Studio engine core copied from VN Studio, stripped and renamed

Branch `EGS-01_skeleton` (root branch of the repo).

### What changed

- Root: `package.json` (`edu-game-studio`, Yarn 4.13, scripts `build:engine`, `dev`, `build`, `engine`, `mcp`, `key:set`, `test`, `typecheck`, `lint`), `.yarnrc.yml` (node-modules linker), `.gitattributes` (LF), `.gitignore`, tsconfigs, `electron.vite.config.ts`, `vite.engine.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `LICENSE` (MIT).
- `src/engine/`: VN Studio's generic core (models and router, job queue and scheduler, budget, logs, store with the engine lock and seed refresh, agents, `pipeline/{llm,prompts}`, transport, summary, CLI `probe` / `key-set`, `Engine`), MCP (`http`, `server`, `stdio`, `relay`, `controller`, `config`, `tools`, `tools-client`), ComfyUI client, generic studio clients (Pixel Studio, Chiptune Studio, Flow, autostart, launch), voice catalogs, `assets/{manifest,palettes,postprocess}`, `themes/load`, the pure-TS puzzle prover.
- `src/engine/edu/`: `EduService` (course list, queue helpers, generator status), `registerEduHandlers` hook (empty), course paths, app dirs, language config. `src/engine/educli.ts`: `help`, `courses`.
- `src/shared/`: protocol trimmed to the generic core, schemas (roles: `director` only), languages, translit, md, puzzle generator (unchanged), new `media.ts` (generic media settings and asset-manifest schemas that lived in VN Studio's `shared/vn.ts`), small `ui-strings.ts`.
- `src/main`, `src/preload`, `src/renderer`: Electron shell with `window.edustudio`, `edustudio-file://`, a minimal UI (top bar, engine status, Courses, Models, Agents, Settings with MCP).
- `seed/`: config (MCP port 7463, relative sibling-tool paths, no private paths), palettes, one ComfyUI workflow, the `director` agent and prompt. `themes/`: five player themes with OFL fonts.
- Renames: `edu_` MCP tools, `EDU_DATA` / `EDU_SEED` / `EDU_MCP_PORT` / `EDU_MCP_TOKEN`, data folder `~/EduGames` with `courses/`, resource `edu-studio://guide`.
- Docs: `README.md`, `ROADMAP.md` (EGS-01..21), `docs/design.md`, `docs/mcp-guide.md`, `docs/protocol.md`, `AGENTS.md`.
- Tests: 25 copied test files adapted to the renames.

### Stripped

VN pipeline (`engine/vn`, `engine/game`, `vncli`), VN MCP tools, `shared/vn.ts`, book UI, Ren'Py, VN agents/prompts/fixtures, packaging scripts (electron-builder, icons), Python puzzle tests.

### Deviations

- `assets/{derive,generate,import,flow-image}`, `studios/chip-plan`, `voice/{comfy-tts,flow,jobs}` and `themes/{emit,pick}` were not copied: they are bound to the VN book service. They are ported again in the media tickets (EGS-15..17).
- Extra generic MCP tools kept: `edu_studios_status`, `edu_comfy_status`, `edu_comfy_free`, `edu_voice_status`, `edu_languages`, pause/resume/stop/clear queue.
- The engine still finds API keys in Scriptorium's and Book Translator's credential stores, as VN Studio does (`EDU_SHARED_KEYS=0` turns it off).

### Verification

- `yarn typecheck` exit 0, `yarn lint` exit 0, `yarn test` 25 files / 355 tests passed (re-run by the orchestrator).
- `node out/engine/index.js --mcp-only` with `EDU_DATA` under `.claude/temp/`: listened on 7463, real `initialize` + `tools/list` returned 16 `edu_*` tools, `edu-studio://guide` read; stopped, port free. Same through `electron . --mcp-only`.
- `yarn build` succeeded.
- Hygiene greps: no VN names, no personal data.

Not run: `yarn dev` window opened interactively; `key:set` against the Windows credential store.

### Commit status

Committed as one commit on `EGS-01_skeleton` (not pushed).
