# Edu Studio

An Electron + TypeScript desktop app that turns a topic into a playable, good-looking educational game: language learning, or any subject. A small team of AI agents researches the topic, writes the course, checks the facts and builds a game that a self-contained web player runs in the browser. It uses your own generators for the looks and the sound: ComfyUI, Pixel Studio, Chiptune Studio, Google Flow and local text-to-speech. An MCP server lets Claude Code drive the whole studio, the way it drives its sibling tools.

The player is our own runtime (DOM and CSS, plus Canvas 2D where a map needs it). No game engine, no Phaser, no Godot, no Unity.

## What it will make

One course contract, several game shells that all play it:

- **Quiz arena**: rounds of mixed items with a timer, a combo, a boss round and a review of the misses.
- **MindMaze castle**: walk a castle of rooms; every door is a question.
- **Encyclopedia explorer**: articles with images, a timeline and a map, and hunts that send you back into them.
- **RPG quest**: a tile map, characters, and turn battles where the moves are answers.
- **Detective / escape room**: logic puzzles that code makes and proves, with clues taken from the course.
- **Language role-play**: dialogue scenes where you answer by choosing or typing in the target language, plus a vocabulary garden with spaced repetition.

The learning rules every shell follows (retrieval practice, spaced repetition, explanatory feedback, mastery, and the rest) are in `docs/design.md`.

## Status

**Skeleton (EGS-01).** The engine core, the headless MCP server and a minimal desktop shell work. The course contract, the player, the content pipeline and the shells come ticket by ticket: see `ROADMAP.md`.

What works now:

- The engine: model router (LM Studio, Strata, DeepSeek, Anthropic, Gemini, OpenRouter, any OpenAI-compatible server you add, and `client`, where Claude does the model work through MCP at no cost), job queue, scheduler, agents, budget caps, seed refresh.
- The MCP server on port 7463 (`edu_*` tools, see `docs/mcp-guide.md`).
- The generator clients (ComfyUI, Pixel Studio, Chiptune Studio, Google Flow) with their status tools; the course tools that use them come in the media tickets.
- The desktop shell: a top bar with the engine state, a Courses page and the Models, Agents and Settings pages.
- `src/shared/puzzles/`: the seeded puzzle generator and solver (murdle, knights, testimony, logic, quiz) that the detective shell will reuse.

## Setup

Node 24 through fnm, Yarn 4.

```
fnm use 24
yarn install
```

## Scripts

| Script | What it does |
| --- | --- |
| `yarn dev` | Builds the engine and starts the desktop app with hot reload |
| `yarn build` | Builds the engine, main, preload and renderer into `out/` |
| `yarn build:engine` | Builds the headless engine to `out/engine/index.js` |
| `yarn engine [-- probe]` | Runs the headless engine; `probe` sends one short request to a model |
| `yarn engine -- <command>` | The course CLI (no engine is started; `--data <dir>` or `EDU_DATA` picks the data folder): `courses`, `import-course <folder> [--slug s] [--overwrite]`, `validate <slug>`, `build <slug> [--force]` (writes `courses/<slug>/build/`, needs the player bundle), `lint <slug> [--json]` (exit 0 clean, 1 errors), `help` |
| `yarn mcp [--port N]` | The engine without Electron, serving MCP over HTTP (= `node out/engine/index.js --mcp-only`) |
| `yarn key:set <NAME>` | Stores an API key (for example `DEEPSEEK_API_KEY`) in the Windows credential store |
| `yarn test` | Vitest |
| `yarn typecheck` | `tsc` for the node and web projects |
| `yarn lint` | ESLint |

API keys come from environment variables or the Windows credential store (service `edu-studio`), never from files. A key that is not found there is also looked for under the services `scriptorium` and `book-translator`, so the keys of those tools work here too (`EDU_SHARED_KEYS=0` turns that off).

A job that needs Pixel Studio, Chiptune Studio or ComfyUI starts it when it is down (from the creative hub's `services.json`, found at `../creative-hub/services.json`; `config/autostart.md`, `EDU_AUTOSTART=0` turns it off). Scriptorium and Strata are never started.

## Data folder

`~/EduGames` (`--data <dir>` or the `EDU_DATA` environment variable change it; `EDU_SEED` points at another seed folder). The first start copies `seed/` into it:

```
config/      providers, roles, models, settings, budget, mcp, studios, autostart, comfy, voice, languages
agents/      one markdown file per agent
prompts/     <role>/<task>.md prompt templates
courses/     <slug>/ one folder per course
jobs/        queued, running, done, failed: one markdown file per job
logs/        agent logs and spend rows
```

A seeded file you did not edit gets the newer version at the next start; one you edited is kept and an "update available" note is logged.

## MCP

The engine serves MCP on 127.0.0.1:7463 while the app is open, or alone with `yarn mcp` (no window).

```
claude mcp add --transport http edu-studio http://127.0.0.1:7463/mcp
```

The guide an agent should read first is the resource `edu-studio://guide` (`docs/mcp-guide.md`). Port, token and the stdio variant are described there and on the Settings page.

## Layout

```
src/engine/    the headless engine: models, queue, budget, agents, MCP, generator clients, edu/ (the course service)
src/main/      the Electron main process
src/preload/   the bridge, window.edustudio
src/renderer/  the React UI
src/shared/    types and code shared by the engine and the UI (protocol, media settings, languages, puzzles)
seed/          what a new data folder starts from
themes/        theme files (colours, fonts) loaded by src/engine/themes
docs/          design.md, mcp-guide.md, protocol.md
tests/         Vitest
```

## Credits

The engine core (model router, job queue, agents, MCP server, generator clients, the Electron shell and the puzzle generator) is copied from VN Studio, which copied Scriptorium's. The plan is in the creative hub (`HUB-19`).

MIT licence, see `LICENSE`. The bundled theme fonts have their own licence (OFL) next to them in `themes/`.
