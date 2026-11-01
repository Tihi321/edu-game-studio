# Rules for agents working in this repository

Edu Studio turns a topic into a playable educational game. Read `README.md` for what it is, `ROADMAP.md` for what is done and what comes next, and `docs/design.md` for the design rules. The big plan is `HUB-19` in the creative hub (`../creative-hub`); this repo only holds its own tickets.

## Stack and commands

Electron 44, electron-vite, React 19, zustand, TypeScript strict, zod 4, Vitest, ESLint flat config, Yarn 4 (`nodeLinker: node-modules`), Node 24.

- Node is managed by fnm. If `node` or `yarn` is not on `PATH`, run `fnm exec --using=24 yarn <script>`.
- Check your work with `yarn typecheck`, `yarn lint` and `yarn test` (the fast suite, no Chromium). Whoever changes a game shell, the player or the autoplay bot also runs `yarn test:e2e` (the Chromium tests, `tests/*.e2e.test.ts`; it fails, not skips, without Chromium). A test that needs a browser goes in a `*.e2e.test.ts` file; no other test imports `playwright` or `bot-helpers` (a guard test checks it). `yarn build` must keep working. Do not leave a test unrun because Node was missing.
- `yarn build:engine && node out/engine/index.js --mcp-only` starts the headless MCP server (port 7463). Point it at a scratch data folder (`EDU_DATA=.claude/temp/<name>`), never at `~/EduGames`.

## Work in tickets

- A ticket is `EGS-NN`, with its plan in `.claude/tickets/EGS-NN-<name>/plan.md` (changelog and notes next to it). New work gets the next free number and a row in `ROADMAP.md`.
- A branch is `EGS-NN_<what>`, cut from `master`. One commit per ticket. Do not commit or push unless asked.
- Put every scratch, staging and intermediate file under `.claude/temp/` (it is ignored by git). Durable notes go in the ticket folder.
- Record what was verified and what was not. End a run with each requested item marked DONE, NOT DONE (with the reason) or UNTESTED (not run in the real app).

## Rules

- **The repository is public.** No keys, tokens, e-mail addresses, personal data, `~/EduGames` content or personal absolute paths in any committed file. Sibling tools are found by relative paths (`../creative-hub`).
- **Our own engine.** The player is our own DOM/CSS and Canvas 2D runtime. Do not add a game-engine library (Phaser, Godot, Unity or similar).
- **Every interactive element has a `data-testid`**, in the studio UI and in the player, so the autoplay bot and Playwright can drive it.
- **No "director" behaviour.** An agent working on a ticket does the assigned work directly: it does not re-plan an approved ticket, take over another agent's files or act as an orchestrator. (The product's own `director` role, which keeps a course brief and picks the next pipeline job, is a different thing.)
- Tools are named `edu_*`, the preload bridge is `window.edustudio`, the file protocol is `edustudio-file://`, the MCP port is 7463 (`EDU_MCP_PORT`, `EDU_MCP_TOKEN`), the data folder is `~/EduGames` (`EDU_DATA`, `--data`; `EDU_SEED` for the seed).
- A new MCP tool is a `def(name, description, zod schema, run)` entry in `src/engine/mcp/tools.ts` (or a `xxxTools(svc, def, opts)` list spread into it). Add it to `docs/mcp-guide.md` too.
- Job handlers are registered in `src/engine/edu/handlers.ts`. The course service is `src/engine/edu/service.ts`.
- Answer keys are language-neutral where possible (indexes, ids, numbers); all translatable text lives in the text catalog of the course (`course/text/<lang>.json`), so Book Translator can translate it.
- Keep the copied engine code as it is unless a ticket needs a change; say in the changelog when you change it.
- Tests use the `mock` provider and fakes for ComfyUI and the studios; no test may start a real app (`EDU_AUTOSTART=0` is set for the test run) or spend money.
