# Design

What Edu Studio builds and why. This page condenses the research and the architecture of the hub plan (`HUB-19`); the tickets that build each part are in `ROADMAP.md`.

## What it is

A studio that turns a topic into a playable, good-looking educational game (language learning, or any subject). It has its own team of roles, as Scriptorium does, and it uses the hub's generators for story, art, music and voices. It has an MCP server so Claude can drive it. The first usable milestone is a pilot course, built by the studio and played by the user.

The player is our own code: DOM and CSS, plus Canvas 2D where a map needs it. No game engine.

## The ten learning-design rules

Every game shell follows them. The lint and the playtester role check them where they can.

1. **Retrieval practice.** Answering beats re-reading, so every unit ends in recall, not recognition only.
2. **Spaced repetition.** Missed items come back on a schedule (FSRS or SM-2), within a game and across sessions. Progress is saved locally.
3. **Interleaving and variation.** Item types are mixed, and the same fact is asked in two or more forms (choice, cloze, ordering, map).
4. **Immediate, explanatory feedback.** A wrong answer shows why; each distractor has its own explanation, written from a real misconception. A right answer adds one more fact.
5. **Intrinsic integration.** The learning is the core mechanic, not a gate in front of it: the RPG attack is the answer, and the castle door is the question.
6. **Mastery and flow.** Difficulty adapts, aiming at about 70 to 85 % success. A unit unlocks the next at mastery, and boss rounds mix earlier units.
7. **Autonomy, competence, relatedness.** The player chooses a path, sees visible progress (a map, a codex, mastery stars), and characters react. XP, streaks and badges are used lightly, because rewards for their own sake crowd out interest.
8. **Multimedia and dual coding.** Each fact gets one picture, and narration is short with text beside it. Nothing is decorative and off-topic.
9. **Language-specific.** Input pitched just above the learner's level, vocabulary in context and not in lists, listening through text-to-speech in the target language, production by typing (speaking later), CEFR levels throughout.
10. **Curiosity and exploration.** An encyclopedia you can browse, with links, a timeline and a map; the game sends you back into it for answers.

## Game shells

All shells read one course contract, so one course can be played in several shells.

| Shell | Core loop |
|---|---|
| Quiz arena | Rounds of mixed items: timer, combo, boss round, review of misses |
| MindMaze castle | Walk a castle of rooms; each door is a question; the topic decides the wing; the throne room opens at mastery |
| Encyclopedia explorer | Articles with images, audio, timeline and map; collectibles and scavenger hunts that send you into the articles |
| RPG quest | Tile map, NPCs with dialogue, turn battles where moves are answers, a quest per unit |
| Detective / escape room | Proven logic puzzles where the clues are facts from the course |
| Language role-play | Dialogue scenes answered by choosing or typing in the target language; listening; a vocabulary garden with spaced repetition |

## Item kinds

Shared by every shell:

- multiple choice, true/false and multi-select;
- cloze (fill the gap), typed answer with tolerant matching (accents, typos, synonyms), and match pairs;
- order and timeline, sort into groups, and a map hotspot or a labelled image;
- listening (a text-to-speech clip: pick or type what you heard) and a flashcard with spaced repetition;
- crossword and word search, built by code.

## Roles

Each role maps to models in `config/roles.md`, with fallbacks and budget caps. With the `client` provider, Claude can do all the model work at no cost.

| Role | Does |
|---|---|
| director | Keeps the course brief and picks the next job (the only role in the skeleton) |
| curriculum-designer | Learning objectives (Bloom level), the prerequisite graph, units, CEFR level for languages |
| researcher | Sourced notes into `factbase/` |
| subject-expert | Writes the encyclopedia articles from the fact base, with citations |
| item-writer | Writes the items for each objective, at least two forms per fact |
| misconception-designer | Distractors from real misconceptions, one explanation per distractor |
| explainer | Feedback, worked examples, hints, "did you know" hooks |
| language-coach | Vocabulary and grammar scope by level, natural phrasing, accepted answers |
| fact-checker | Checks every item and article against the fact base. **Must pass** |
| game-designer | Picks the shells, maps units to levels, rooms and quests, sets rewards and difficulty |
| narrative-designer | Frame story and characters; hands longer stories to Scriptorium over MCP |
| art-director, art-critic | Image plans and a check with a vision model |
| composer, voice-director | Music per area and mood; text-to-speech for narration and listening items |
| playtester | Plays the built game through the bot as simulated learners and reports flow, difficulty and dead ends |
| accessibility- and child-safety-reviewer | Contrast, keyboard play, reading level; child safety for kids' courses. **Must pass** |
| publisher | Scores against the threshold and builds the game |

## Architecture

- **Data folder** `~/EduGames`: `config/`, `agents/`, `prompts/<role>/<task>.md`, `courses/<slug>/`, `jobs/`, `logs/`.
- **Engine core** (copied from VN Studio): jobs are markdown files that move through `jobs/{queued,running,done,failed}`; the scheduler registers a handler per task; `engine.lock` keeps one engine per data folder; providers are openai-compatible servers, Anthropic, Gemini and `client`; every MCP tool is `def(name, description, schema, run)`.
- **Course contract** (`src/shared/course.ts`, EGS-02): `course/pack.json` is the template (ids, objectives, the prerequisite graph, items with answer keys, shells, assets, cues); `course/text/<lang>.json` is the only translatable text, so Book Translator can translate it. Answer keys are language-neutral where possible: indexes, ids, numbers.
- **Pipeline** (EGS-08): brief, research, curriculum, articles, items, fact-check, explain, game design, story, art, music, voice, assemble, build, lint, playtest, publish.
- **Player runtime** (EGS-03): our own DOM/CSS + Canvas 2D code that emits `index.html`, `player.js`, `player.css` and `game-data.js` and works over `file://`. Shells are plugins on a `window.EduEngine` hook (`registerShell`, `registerItemKind`). Progress and the review queue live in localStorage, with export and import. Every interactive element has a `data-testid`, so the bot and Playwright can drive it.
- **MCP** on port 7463, tools prefixed `edu_`, the guide served as `edu-studio://guide`.
- **Generators**: ComfyUI (images, music, text-to-speech), Pixel Studio (pixel art), Chiptune Studio (music), Google Flow (images, voices, songs), local and cloud text-to-speech. Reached through the clients in `src/engine/studios/` and `src/engine/comfy/`.
- **Look**: a design pass up front (EGS-05). Every shell gets its own theme on top of shared tokens; motion respects `prefers-reduced-motion`.

## How it is checked

| What | How |
|---|---|
| Code | Vitest, typecheck, ESLint, on every ticket |
| Content | The answer-key lint, the fact-checker (must pass, with citations), proved puzzles |
| Playability | The autoplay bot: perfect, all-wrong and random-learner runs, with no console errors |
| Looks | Screenshot sets at desktop and mobile width, an axe-core contrast run |
| Real use | The user plays the pilot and each new shell |
