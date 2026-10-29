# Roadmap

The tasks of Edu Studio, in order. The big plan, with the research behind it, is `HUB-19` in the creative hub (`../creative-hub/.claude/tickets/HUB-19-edu-game-studio/plan.md`); it is split into the tickets below. Work that needs other tools or a production run (wiring the studio into the hub, a live course with the user playing it) is planned in the hub. Every ticket is `EGS-NN`, has a plan in `.claude/tickets/EGS-NN-<name>/plan.md` and a branch `EGS-NN_<what>`, and gets one commit. When it is done its row moves to "Done".

Every phase ends in something that can be checked: a command, a screenshot set, a bot run. A phase is not done until its checks pass and the result is recorded.

## Where it stands (2026-10-29)

- **Phase 0 and phase 1 are done** (EGS-01 to EGS-04, branches stacked on `EGS-01_skeleton`, not merged yet): the engine core copied from VN Studio, the course contract with 13 item kinds, SM-2 and adaptive difficulty, our own browser player with the chalkboard quiz arena, the build, `edu_lint`, the course MCP tools and CLI, and the autoplay bot. Both golden fixtures build, lint clean and pass the bot in all three runs with 0 console errors.
- **Not checked yet:** `yarn dev` (the desktop window) has not been opened; real audio, touch devices and a measured contrast run wait for phase 2 and 6.
- **Next:** EGS-05, the design system and the studio UI.
- **The pilot** (EGS-09) is a history and geography course; the exact topic is chosen then. It is done only when the user has played it.

## Tasks, in order

The phase numbers are the ones of the hub plan.

### Phase 2: design system and the studio UI

- **EGS-05** the design tokens and the four shell themes (castle stone and torchlight, parchment and brass, pixel art, chalkboard) made with the frontend-design skill; the studio pages (Library; Course with the tabs Brief, Curriculum, Encyclopedia, Items, Game, Assets, Voice, Editions, Build, Playtest; Models, Agents, Generators, Settings); screenshot sets at desktop and mobile width; keyboard-only play in the bot and an axe-core contrast run.

### Phase 3: roles and the content pipeline

- **EGS-06** the role engine: the researcher, the fact base (`factbase/`, `[n]` citations, Tavily, Brave, Wikipedia or client search) and the fact-checker, copied from Scriptorium; `quality.md` with `threshold`, `max_rounds` and `must_pass`.
- **EGS-07** the content roles and prompts: curriculum-designer, subject-expert, item-writer, misconception-designer, explainer, language-coach, game-designer, narrative-designer, playtester, accessibility and child-safety reviewers, publisher. Must-pass: fact-checker, child-safety, accessibility.
- **EGS-08** `edu_run_pipeline` from a brief (topic, audience, level, languages, shells, length) up to the explained items; tests with the `mock` provider (a fact-check `revise` loops back and passes in round 2; a forced must-pass failure stops the publish) and a live run with the `client` provider.

### Phase 4: pilot

- **EGS-09** the pilot course (history and geography), built only through the MCP, played in the quiz arena and then in the encyclopedia explorer, with a production log in `runs/<slug>.md`. Done when the user has played it.

### Phase 5: more shells (one ticket per shell)

- **EGS-10** the encyclopedia explorer (articles, timeline, map, collectibles).
- **EGS-11** the MindMaze castle (rooms, doors that are questions, wings by topic, the throne room at mastery).
- **EGS-12** the RPG quest (tile map, NPCs, turn battles where the moves are answers; the frame story from Scriptorium over MCP).
- **EGS-13** language role-play and the vocabulary garden.
- **EGS-14** the detective / escape room, with the copied puzzle generator and its proofs.

Each shell: the bot plays a fixture course through it (perfect, wrong, random runs), the shell-specific lint passes (every room reachable, every door's question exists, the quest graph can be finished, puzzles proved unique), and the screenshots go to the user.

### Phase 6: media

- **EGS-15** art: the art-director plans images, made by ComfyUI, Pixel Studio (RPG tiles and sprites) or Flow, and checked by the art-critic.
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

## Later

Not planned yet:

- Speaking practice through VibeWhisper (speech recognition).
- A teacher or classroom mode, and a multiplayer quiz.
- Rename the `book` field of a job file (the course slug) once a ticket touches the scheduler.
