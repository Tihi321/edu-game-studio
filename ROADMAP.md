# Roadmap

The tasks of Edu Studio, in order. The big plan, with the research behind it, is `HUB-19` in the creative hub (`../creative-hub/.claude/tickets/HUB-19-edu-game-studio/plan.md`); it is split into the tickets below. Work that needs other tools or a production run (wiring the studio into the hub, a live course with the user playing it) is planned in the hub. Every ticket is `EGS-NN`, has a plan in `.claude/tickets/EGS-NN-<name>/plan.md` and a branch `EGS-NN_<what>`, and gets one commit. When it is done its row moves to "Done".

Every phase ends in something that can be checked: a command, a screenshot set, a bot run. A phase is not done until its checks pass and the result is recorded.

## Where it stands (2026-10-29)

- **In progress:** EGS-01, the repository skeleton (branch `EGS-01_skeleton`): the generic engine core copied from VN Studio and stripped of everything about visual novels, renamed to Edu Studio, with a headless MCP server on port 7463 and a minimal desktop shell. Typecheck, lint and the unit tests pass; the MCP handshake and `yarn build` were run. `yarn dev` (the desktop window) has not been opened yet.
- **Next:** EGS-02, the course contract.
- **The pilot** (EGS-09) is a history and geography course; the exact topic is chosen then. It is done only when the user has played it.

## Tasks, in order

The phase numbers are the ones of the hub plan.

### Phase 1: course contract, player runtime and bot (no language model: code and hand-written fixtures)

- **EGS-02** the course contract: `src/shared/course.ts` with zod schemas (pack, text catalog, objectives, prerequisite graph, items with answer keys), the item kinds with their checkers (choice, true/false, multi-select, cloze, typed answer with tolerant matching, match pairs, order, sort, map hotspot, listening, flashcard), the spaced-repetition scheduler in pure TypeScript, a validator, and golden fixtures (a solar-system course in en and hr, a Croatian A1 greetings course).
- **EGS-03** the player runtime and the quiz arena: our own DOM/CSS + Canvas 2D runtime that emits `index.html`, `player.js`, `player.css` and `game-data.js` and works over `file://`; shells as plugins on `window.EduEngine`; progress and the review queue in localStorage with export and import; `data-testid` on every interactive element; the native lint (`edu_lint`: one key per item, distinct distractors, two or more forms per objective, assets exist, no cycles, no placeholders); `edu_build`; `edu_create_course` and the item tools; `eduCli` build and lint.
- **EGS-04** the autoplay bot: `scripts/play.mjs` with Playwright Chromium plays a built game in three runs (perfect, all wrong, a seeded random learner), saves a screenshot of every screen and fails on a console error.

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

- **EGS-01** (in progress; plan `.claude/tickets/EGS-01-skeleton/plan.md`, branch `EGS-01_skeleton`): see "Where it stands". It moves here once the commit is made and the desktop window has been opened.

## Later

Not planned yet:

- Speaking practice through VibeWhisper (speech recognition).
- A teacher or classroom mode, and a multiplayer quiz.
- Rename the `book` field of a job file (the course slug) once a ticket touches the scheduler.
