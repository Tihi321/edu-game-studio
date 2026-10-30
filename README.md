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

**Phase 1, the design pass and the five game shells done (EGS-01 to EGS-05, EGS-10 to EGS-14).** A course written by hand (or over MCP) builds into a playable game that lints clean and passes the autoplay bot, also played with the keyboard only and checked with axe-core. Besides the quiz arena it plays in the encyclopedia explorer, MindMaze castle, RPG quest, language role-play and detective / escape room: the title screen has a game-style picker, so one course plays in every shell it enables. The studio has its own look and pages for every part of a course. The content pipeline (roles that write a course from a topic) and the media come ticket by ticket: see `ROADMAP.md`.

What works now:

- The engine: model router (LM Studio, Strata, DeepSeek, Anthropic, Gemini, OpenRouter, any OpenAI-compatible server you add, and `client`, where Claude does the model work through MCP at no cost), job queue, scheduler, agents, budget caps, seed refresh.
- The MCP server on port 7463 (`edu_*` tools, see `docs/mcp-guide.md`), with course create and edit, items, text, validate, build and lint.
- The course contract (`src/shared/course.ts`): 13 item kinds with checkers, tolerant answer matching, SM-2 spaced repetition and adaptive difficulty.
- The player (`src/player/`, `docs/player.md`): our own DOM/CSS runtime (Canvas 2D for the RPG map) with the chalkboard quiz arena and the encyclopedia explorer, MindMaze castle, RPG quest, language role-play and detective / escape room (`src/player/shells/`), all built on the shell kit (`src/player/kit/`: the same questions, feedback, spaced repetition, mastery and progress in every shell); a built game works over `file://`.
- Game shell sections (`src/shared/shells/`): what a course authors for a shell (`shells.config.<shell>`), checked by the validator and by `edu_lint` (every room reachable, every door's question there, quests that can be finished, dialogues that end, puzzles proved unique); without a section most shells build an automatic layout from the units.
- `edu_lint` and the autoplay bot (`scripts/play.mjs`).
- The generator clients (ComfyUI, Pixel Studio, Chiptune Studio, Google Flow) with their status tools; the course tools that use them come in the media tickets.
- The design system (`src/design/`, `docs/design.md` "Look"): shared `--edu-*` tokens, a theme registry with six looks (chalkboard for the quiz arena, castle stone, parchment and brass, pixel quest, Adriatic postcard, case file noir) that the shells pick by id, bundled OFL fonts (no CDN), motion that stops under `prefers-reduced-motion`, and a contrast test for every theme.
- The desktop studio: a Library of courses with covers in each course's look, a Course page with the tabs Brief, Curriculum (objectives and the prerequisite graph), Encyclopedia, Items (an editor per item kind with a live preview in the player's own look), Game, Assets, Voice, Editions, Build (build and lint with codes, open the game) and Playtest, plus Models, Agents, Generators and Settings. Light and dark.
- `src/shared/puzzles/`: the seeded puzzle generator and solver (murdle, knights, testimony, logic, quiz) copied from VN Studio; the detective shell builds its cases on it, and the lint proves every case unique and solvable by deduction.

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
| `yarn play <build-dir> --mode <perfect, wrong or random> [--shell <id>]` | The autoplay bot (`node scripts/play.mjs`): plays a built game in headless Chromium, in any shell the course enables; see "Autoplay bot" |
| `yarn previews` | Builds the static theme previews (chalkboard, castle, parchment, pixel) into `.claude/temp/theme-previews/`, screenshots them at 1280x800 and 390x844 and runs axe-core |
| `yarn studio:shots` | Builds the studio renderer with a mocked `window.edustudio` (the golden fixtures), screenshots every page and Course tab at 1280x800 and 390x844 (light and dark, empty, loading and error states) into `.claude/temp/screens/phase2/studio/` and runs axe-core on each; fails on a serious or critical violation |
| `yarn test` | Vitest |
| `yarn typecheck` | `tsc` for the node and web projects |
| `yarn lint` | ESLint |

API keys come from environment variables or the Windows credential store (service `edu-studio`), never from files. A key that is not found there is also looked for under the services `scriptorium` and `book-translator`, so the keys of those tools work here too (`EDU_SHARED_KEYS=0` turns that off).

A job that needs Pixel Studio, Chiptune Studio or ComfyUI starts it when it is down (from the creative hub's `services.json`, found at `../creative-hub/services.json`; `config/autostart.md`, `EDU_AUTOSTART=0` turns it off). Scriptorium and Strata are never started.

## Autoplay bot

`scripts/play.mjs` plays a built game folder in headless Chromium (Playwright) over `file://` and fails on a console error, a page error, a failed local request or a stuck screen. It needs only the folder (`index.html`, `game-data.json`, `player.js` ...), no TypeScript. It clicks and types through the `data-testid`s and reads `window.EduEngine.getState()`; it asks the page for answers (`window.EduEngine.debug.solve(itemId)` / `wrong(itemId)`, see `docs/player.md`), so it never duplicates the solving logic.

```
yarn playwright install chromium          # once
yarn build:player                         # out/player/player.js + player.css
# build a golden fixture into a game folder (scratch data folder, never ~/EduGames):
EDU_DATA=.claude/temp/play-data yarn engine -- import-course tests/fixtures/courses/solar-system
EDU_DATA=.claude/temp/play-data yarn engine -- build solar-system   # -> .claude/temp/play-data/courses/solar-system/build
yarn play .claude/temp/play-data/courses/solar-system/build --mode perfect      # every item right: all units to 3 stars, the boss, the end screen
yarn play .claude/temp/play-data/courses/solar-system/build --mode wrong        # every item wrong: explanations shown, review queue fills (--rounds N per unit)
yarn play .claude/temp/play-data/courses/solar-system/build --mode random --accuracy 0.75 --seed 7   # a seeded learner must finish within the step bound
yarn play .claude/temp/play-data/courses/solar-system/build --mode perfect --shots shots --viewport 390x844 --json
yarn play .claude/temp/play-data/courses/solar-system/build --mode perfect --keyboard --axe   # keyboard only (no mouse) and axe-core on every screen
```

Options: `--seed N` (the game's `?seed=`, default 1, replayable), `--accuracy` (random mode), `--shots <dir>` (one PNG per distinct screen and item kind, `<mode>-<nn>-<screen>[-<kind>].png`), `--viewport WxH` (default 1280x800), `--max-steps N` (default: `ceil(6 * (units * roundLength + bossLength) * max(1, 0.75 / accuracy)^2)`), `--keyboard` (plays with the keyboard only: Tab, Shift+Tab, Enter, Space, arrows, digits and typing; it checks that the focus lands on the right control and that the focus ring shows), `--axe` (runs axe-core on every distinct screen and item kind and fails on a serious or critical violation), `--json` (compact summary). The summary on stdout has `mode, seed, steps, correct, wrong, screens, kinds, finished, consoleErrors, durationMs` plus `ok` and `failures`; exit 0 = success, 1 = a failed check, 2 = bad usage, 3 = Chromium cannot be launched. `tests/bot.e2e.test.ts` builds the golden fixtures and runs all three modes on each in the quiz arena, plus keyboard-only and axe runs (skipped with a message when Chromium is missing). `--shell <id>` plays another shell through its driver (`scripts/bot/<id>.mjs`); each shell has its own `tests/bot-<id>.e2e.test.ts`.

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
src/renderer/  the React UI (the studio)
src/design/    design tokens, the theme registry and theme CSS, bundled fonts, theme previews
src/player/    the browser player (game runtime)
src/shared/    types and code shared by the engine and the UI (protocol, media settings, languages, puzzles)
seed/          what a new data folder starts from
themes/        theme files (colours, fonts) loaded by src/engine/themes
docs/          design.md, mcp-guide.md, protocol.md
scripts/       the autoplay bot (play.mjs), the theme previews, the studio screenshots and axe run (studio-shots.mjs), the fixture audio generator
tests/         Vitest
```

## Credits

The engine core (model router, job queue, agents, MCP server, generator clients, the Electron shell and the puzzle generator) is copied from VN Studio, which copied Scriptorium's. The plan is in the creative hub (`HUB-19`).

MIT licence, see `LICENSE`. The bundled fonts have their own licence (SIL OFL 1.1) next to them in `themes/` and `src/design/fonts/`.
