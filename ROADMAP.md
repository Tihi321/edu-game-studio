# Roadmap

The tasks of Edu Studio, in order. The big plan, with the research behind it, is `HUB-19` in the creative hub (`../creative-hub/.claude/tickets/HUB-19-edu-game-studio/plan.md`); it is split into the tickets below. Work that needs other tools or a production run (wiring the studio into the hub, a live course with the user playing it) is planned in the hub. Every ticket is `EGS-NN`, has a plan in `.claude/tickets/EGS-NN-<name>/plan.md` and a branch `EGS-NN_<what>`, and gets one commit. When it is done its row moves to "Done".

Every phase ends in something that can be checked: a command, a screenshot set, a bot run. A phase is not done until its checks pass and the result is recorded.

## Where it stands (2026-10-30)

- **Phase 0, phase 1 and phase 2 are done** (EGS-01 to EGS-05, branches stacked on `EGS-01_skeleton`, not merged yet): the engine core copied from VN Studio, the course contract with 13 item kinds, SM-2 and adaptive difficulty, our own browser player with the chalkboard quiz arena, the build, `edu_lint`, the course MCP tools and CLI, and the autoplay bot; the design system (tokens, four themes in a registry, bundled fonts) and the studio pages. Both golden fixtures build, lint clean and pass the bot in all three runs with 0 console errors, also keyboard-only, with 0 axe-core violations; every studio page passes axe-core too.
- **Phase 5 is done** (EGS-10 to EGS-14, stacked on `EGS-05_design-system`, not merged yet): the encyclopedia explorer, MindMaze castle, RPG quest, language role-play and detective / escape room, each on the shared shell kit with its course section, its lint, a bot driver (perfect, wrong and random runs, keyboard-only and axe-core) and a broken fixture. No human has played them yet.
- **Phase 3 is done** (EGS-06 to EGS-08, branches stacked on `EGS-14_detective`, not merged yet): the content team (15 roles with agents and prompts), research and the fact base, review gates, and `edu_run_pipeline` from a brief to a published course. A live run with the `client` provider made a 2-unit "Roman Empire" course for $0: lint clean, the bot's learners passed, every item cites the fact base (`.claude/tickets/EGS-08-pipeline/run-log.md`).
- **Not checked yet:** `yarn dev` (the desktop window) has not been opened; the studio was checked in Chromium with a mocked engine. Real audio, touch devices and a human play-through are untested. The pipeline has not run with a real web search or a local model yet.
- **Phase 6 has started** (EGS-15 art, branch stacked on `EGS-08_pipeline`, itself on `EGS-14_detective`, not merged yet): the pipeline makes the pictures of a course, with the generators faked in the tests; no live ComfyUI, Pixel Studio or Flow run has been made yet. EGS-16 (music) and EGS-17 (voice) build on its media foundation.
- **Next:** EGS-16 and EGS-17, then the pilot EGS-09.
- **The pilot** (EGS-09) is a history and geography course; the exact topic is chosen then. It is done only when the user has played it.

## Tasks, in order

The phase numbers are the ones of the hub plan.


### Phase 4: pilot

- **EGS-09** the pilot course (history and geography), built only through the MCP, played in the quiz arena and then in the encyclopedia explorer, with a production log in `runs/<slug>.md`. Done when the user has played it.


### Phase 6: media

- **EGS-16** music: Chiptune Studio (RPG and castle), ComfyUI ACE-Step or Flow Music.
- **EGS-17** voice: narration and listening items in the target language; Gemini TTS for Croatian within the 10-a-day free quota, VibeTTS or ComfyUI TTS for the rest.

### Phase 7 and after (placeholders: the split is a first guess and will change)

- **EGS-18** editions: translate a course text catalog with Book Translator, build the edition and run the bot on it.
- **EGS-19** hub wiring support: whatever the hub's registration needs from this repo (a `hub.ps1 check` handshake, the tool count, a skill that makes a course from one sentence).
- **EGS-20** packaging: the Windows installer and portable exe (electron-builder, icons, a package check), CI.
- **EGS-21** Android through Capacitor, later.

## Done

- **EGS-01** the repository skeleton: VN Studio's generic engine core (models, router, queue, budget, agents, MCP, client provider, ComfyUI and studio clients), renamed to Edu Studio, MCP on port 7463. Plan `.claude/tickets/EGS-01-skeleton/`.
- **EGS-02** the course contract (`src/shared/course.ts`), 13 item kinds with pure-TS checkers in a registry, tolerant matching, SM-2, adaptive difficulty, seeded crossword and word search, the validator, and the golden fixtures (solar system en + hr, Croatian A1 greetings). Plan `.claude/tickets/EGS-02-course-contract/`.
- **EGS-03** the player runtime (`window.EduEngine`, quiz arena, all item renderers, localStorage progress with export and import), the build into a `file://` folder, `edu_lint` with a broken fixture, the course MCP tools and CLI. Plan `.claude/tickets/EGS-03-player-runtime/`.
- **EGS-04** the autoplay bot (`scripts/play.mjs`, perfect / wrong / random runs, screenshots) and its e2e test on both fixtures. Plan `.claude/tickets/EGS-04-autoplay-bot/`.
- **EGS-05** the design system and the studio UI: `--edu-*` tokens, the theme registry with four looks (chalkboard, castle stone, parchment and brass, pixel quest), bundled OFL fonts, motion behind `prefers-reduced-motion`; the studio pages (Library, Course with ten tabs and an item editor with a live preview, Models, Agents, Generators, Settings); the bot's keyboard-only mode and axe-core runs on the game, the theme previews and the studio. Plan `.claude/tickets/EGS-05-design-system/`.
- **EGS-06** the role engine: 15 roles, `quality.md` (threshold, max_rounds, must_pass) and `formats.md`, course models in `course.md`, the review contract and gates, the research stack from Scriptorium (search providers incl. client search, notes, the researcher), the course fact base and the fact-checker; `edu_ask_researcher`, `edu_factbase_get`. Plan `.claude/tickets/EGS-06-roles/`.
- **EGS-07** the content roles: agents and prompts for every role, zod output contracts with checks and a repair round, `assembleCourse`, the lint codes `ITEM_NO_FACT` and `ARTICLE_NO_CITATION`, the playtest runner (bot learner personas) and the Scriptorium client for long stories. Plan `.claude/tickets/EGS-07-content-roles/`.
- **EGS-08** the pipeline: `edu_run_pipeline` from a brief through research, curriculum, articles, items, distractors, fact-check, explain, design, story, assemble, audience reviews, build, lint, playtest and publish; file jobs with deterministic ids, resumable, revise loops, must-pass and hard gates; art, music and voice are typed hooks marked skipped. Live client run on "The Roman Empire" in `run-log.md`. Plan `.claude/tickets/EGS-08-pipeline/`.
- **EGS-10** the shell contract and the encyclopedia explorer: the shell kit (`src/player/kit/`), the course sections and their lint (`src/shared/shells/`), the game-style picker on every title, per-shell progress, the bot's shell drivers (`scripts/bot/`); the encyclopedia (parchment and brass: articles with cross-links, search, citations, a timeline, a map, scavenger hunts whose answers are in the articles, a codex of collectibles); the `european-capitals` fixture. Plan `.claude/tickets/EGS-10-encyclopedia/`.
- **EGS-11** the MindMaze castle (castle stone: a wing per unit, doors that are questions, torches and a ghost that leads you back instead of a dead end, characters with hints, keys at mastery, the throne room gauntlet, mini-maps). Plan `.claude/tickets/EGS-11-mindmaze/`.
- **EGS-12** the RPG quest (pixel quest: a Canvas 2D tile map from a seeded generator, quest givers, turn battles where the moves are answers with streaks and partial credit, an inn instead of game over, scrolls of learned facts, area bosses and a final boss; the frame story hand-written in the fixture, Scriptorium later). Plan `.claude/tickets/EGS-12-rpg/`.
- **EGS-13** the language role-play (Adriatic postcard theme: dialogue scenes answered by choosing or typing in the target language, translations on demand, recovery lines, CEFR shown, a vocabulary garden that grows with SM-2 recall). Plan `.claude/tickets/EGS-13-roleplay/`.
- **EGS-14** the detective / escape room (case file noir: cases from VN Studio's proved puzzle generator whose clue cards are turned by answering course items, a grid, hints, accusations that never dead-end, escape rooms per unit and a Carmen-Sandiego chase; every case proved unique at lint time, 200 seeds per kind and size in the tests). Plan `.claude/tickets/EGS-14-detective/`.
- **EGS-15** art: the art-director plans the pictures (an article picture each, the art of every shell, hotspot pictures with their regions drawn over them), ComfyUI makes them (Pixel Studio for RPG tiles and sprites, Google Flow only when a course sets `art.provider: flow`), the art-critic reviews them with regenerate rounds (not must-pass), placeholders stand in when a provider is down (lint `PLACEHOLDER_ASSET`, never a failed run), stable asset ids, the course media settings and manifest, the `edu_asset_*` tools, and the bot's media check. The foundation of EGS-16 and EGS-17. Plan `.claude/tickets/EGS-15-art/`.

## Later

Not planned yet:

- The RPG frame story written by Scriptorium over MCP (the fixtures hand-write it), and Pixel Studio tiles and sprites in its image slots (phase 6).
- Speaking practice through VibeWhisper (speech recognition).
- A teacher or classroom mode, and a multiplayer quiz.
- Run the autoplay bot from the studio's Playtest tab (`playtestCourse`): the packaged app does not carry Playwright, so it needs an engine-side runner; the tab shows the `yarn play` commands until then.
- Save a course's theme from the Game tab once a second shell can play another look.
- Rename the `book` field of a job file (the course slug) once a ticket touches the scheduler.
