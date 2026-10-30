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
| art-director | Plans the pictures: one per article, the art of each shell (backdrops, castle rooms, plates, RPG tiles and sprites), a picture for an item where it helps, hotspot pictures (EGS-15) |
| art-critic | Looks at each generated picture with a vision model and says pass or revise against its plan line; **not must-pass** (a rejected picture stays, marked), EGS-15 |
| composer | Music per area (menu, each unit or group of units, boss, end, the castle and RPG areas) and mood, and the sound effects of the events; calm, instrumental, loops well; deterministic fallback plan (EGS-16) |
| voice-director | Short narration in the source language, listening practice in the target language (every listening item's clip, and listening items derived from taught phrases that passed the fact-check) and a delivery style per language; deterministic fallback plan (EGS-17). Who speaks (Gemini within the daily free quota, VibeTTS, ComfyUI TTS) is the hub's allocation rule in code, not this role |
| playtester | Plays the built game through the bot as simulated learners and reports flow, difficulty and dead ends |
| accessibility- and child-safety-reviewer | Contrast, keyboard play, reading level; child safety for kids' courses. **Must pass** |
| publisher | Scores against the threshold and builds the game |

## Look

The design system (EGS-05) lives in `src/design/` and is shared by the studio and every game shell.

**Tokens** (`src/design/tokens.css`). One vocabulary of CSS variables, `--edu-*`: colour slots (`bg`, `bg-2`, `surface`, `surface-2`, `line`, `line-strong`, `text`, `text-dim`, `accent`, `accent-ink`, `accent-2`, `good`/`good-ink`, `bad`/`bad-ink`, `warn`/`warn-bg`, `mark`/`mark-ink`, `focus`, two shadows, six `series-*` fills with `series-ink`), font slots (`font-display`, `font-body`, `font-mono`) and the structure tokens that a theme does not own: a type scale on a 16 px body with a 13 px floor, a 4 px space scale, radii, a 44 px tap size, a 3 px focus ring, durations and easings, z-layers. The slot names are the contract; a theme only fills them.

**Themes** (`src/design/themes/<id>.css`, registry in `src/design/themes/index.ts`). Each theme fills every colour and font slot under `[data-edu-theme="<id>"]`, imports its own fonts and adds the dressing of the shell frame (`.frame`, `.board`):

| Id | For | Look | Type | Motion |
|---|---|---|---|---|
| `chalkboard` | quiz arena | green board in a wooden frame, chalk white, coloured chalk | Kalam over Atkinson Hyperlegible Next | the new screen is written onto the board behind an eraser smudge; a combo throws chalk dust |
| `castle` | MindMaze | dressed stone, torch amber, ember | Cinzel (titles) over Alegreya | doors that swing open; the torch glow flickers (opacity only) |
| `parchment` | encyclopedia | vellum, sepia ink, brass, oxblood | EB Garamond | a page turns |
| `pixel` | RPG | night blue, gold, grass green, stepped corners and hard shadows | Pixelify Sans | `steps()` only, `image-rendering: pixelated` |

A shell picks its look by id: `themeForShell('mindmaze')` (or the theme named in `shells.config[shell].theme`) returns the `ThemeInfo` (label, scheme, fonts, a `swatch` of five colours and the display and body families, so the studio can paint a Library cover or a theme picker without loading the CSS). The shell then imports `<id>.css` and puts `data-edu-theme="<id>"` and the class `edu-stage` on its root element; it never defines colours of its own. The player bundle loads the chalkboard only (`player.css`: about 200 KB with the Kalam and Atkinson fonts inlined as base64, one file that works over `file://`); the studio loads all four.

**Fonts and licences.** Atkinson Hyperlegible Next, Young Serif (studio titles), Kalam, Cinzel, Alegreya, EB Garamond and Pixelify Sans, latin and latin-ext subsets (Croatian: č ć đ š ž) as woff2 from Fontsource, in `src/design/fonts/<family>/` with a `font.css` (the `@font-face` rules) and the OFL 1.1 text. They are bundled, never loaded from a CDN (a test checks the CSS for remote URLs).

**Motion** (`src/design/motion.css`). Motion shows what changed (a new screen, a streak, a right or wrong answer, a card turning), never decoration. A theme picks its entrance with `--edu-enter-name` and `--edu-enter-scale`; it must not override the duration tokens. Under `prefers-reduced-motion: reduce` the durations are 0 *and* `animation` is switched off for everything under `.edu-stage` and `[data-edu-theme]`, so nothing moves and nothing waits for an animation to end (the combo burst still shows its words, without the dust).

**Contrast and accessibility.** WCAG AA for every pair the UI draws, checked for every theme by `tests/design-tokens.test.ts`: text, dim text, accent ink on accent, good/bad/mark ink on their fills and the coloured text on the board and the feedback panel at 4.5:1; the focus ring and the borders of controls at 3:1. Right and wrong are a symbol and words as well as a colour. No all-caps eyebrow labels (the castle's Cinzel is a capitals face, so only its titles use it). `yarn previews` builds a static page per theme (a title, a progress strip, a question card with a right and a wrong choice, a feedback panel) into `.claude/temp/theme-previews/`, screenshots it at 1280x800 and 390x844 and runs axe-core on it; the bot's `--axe` does the same on the built quiz arena.

**The studio** ("the squared exercise book") sits on the same tokens: light paper with a faint square grid, royal-blue ink, a red margin rule beside the nav, a yellow highlighter for the current place; Young Serif titles over Atkinson Hyperlegible Next; dark with `prefers-color-scheme: dark` or the Settings switch. The boldness goes into the games' themes and the way the studio shows them (Library covers, the live preview in the Game tab), not into the chrome.

## Architecture

- **Data folder** `~/EduGames`: `config/`, `agents/`, `prompts/<role>/<task>.md`, `courses/<slug>/`, `jobs/`, `logs/`.
- **Engine core** (copied from VN Studio): jobs are markdown files that move through `jobs/{queued,running,done,failed}`; the scheduler registers a handler per task; `engine.lock` keeps one engine per data folder; providers are openai-compatible servers, Anthropic, Gemini and `client`; every MCP tool is `def(name, description, schema, run)`.
- **Course contract** (`src/shared/course.ts`, EGS-02): `course/pack.json` is the template (ids, objectives, the prerequisite graph, items with answer keys, shells, assets, cues); `course/text/<lang>.json` is the only translatable text, so Book Translator can translate it. Answer keys are language-neutral where possible: indexes, ids, numbers.
- **Pipeline** (EGS-08): brief, research, curriculum, articles, items, fact-check, explain, game design, story, art, music, assemble, audience reviews, voice, build, lint, playtest, publish. Art is real since EGS-15 (`art_plan`, `art_generate`, `art_review`), music since EGS-16 (`music_plan`, `music_generate`) and voice since EGS-17 (`voice_plan`, `voice_generate`: after the audience reviews so the clips speak the final text, then the pack is re-linked before the build).
- **Media** (EGS-15): a course's media settings are `course.md` `media`; its assets are `course/assets.json` plus `course/assets/<id>/v<n>.<ext>`, with ids that come from what they illustrate; `assemble` links them into the pack (`assets[]`, `article.asset`, `item.asset`, `shells.config[*].art`). A picture that cannot be made is a labelled placeholder (lint `PLACEHOLDER_ASSET`, a warning), never a failed run. Google Flow is used only when a course asks.
- **Audio** (EGS-16): music plays by area (`music:<area>` cues, one track at a time with a short fade) and sound effects on events (`correct`, `wrong`, `combo`, `level-up`, `boss`); the sounds are assets `mus-<area>` and `sfx-<event>` in the same manifest; the loop points of a Chiptune track are in `pack.extensions.audio.loops`. Sound is never the only carrier of meaning (design rule 8: text sits beside every sound), and the player has a mute and a "reduce audio" toggle (no music, quieter effects). Flow Music (credits) is never a default.
- **Player runtime** (EGS-03): our own DOM/CSS + Canvas 2D code that emits `index.html`, `player.js`, `player.css` and `game-data.js` and works over `file://`. Shells are plugins on a `window.EduEngine` hook (`registerShell`, `registerItemKind`). Progress and the review queue live in localStorage, with export and import. Every interactive element has a `data-testid`, so the bot and Playwright can drive it.
- **MCP** on port 7463, tools prefixed `edu_`, the guide served as `edu-studio://guide`.
- **Generators**: ComfyUI (images, music, text-to-speech), Pixel Studio (pixel art), Chiptune Studio (music), Google Flow (images, Gemini voices, songs), VibeTTS and ComfyUI (local text-to-speech; VibeTTS is a tray app that Edu Studio never starts). Reached through the clients in `src/engine/studios/` and `src/engine/comfy/`.
- **Look**: a design system up front (EGS-05, see "Look" above): shared tokens, a theme per shell, bundled fonts, motion that respects `prefers-reduced-motion`.

## How it is checked

| What | How |
|---|---|
| Code | Vitest, typecheck, ESLint, on every ticket |
| Content | The answer-key lint, the fact-checker (must pass, with citations), proved puzzles |
| Playability | The autoplay bot: perfect, all-wrong and random-learner runs, with no console errors |
| Looks | Screenshot sets at desktop and mobile width, an axe-core run (the bot's `--axe`, `yarn previews`), the contrast test of every theme (`tests/design-tokens.test.ts`) |
| Keyboard | The bot's `--keyboard` mode plays a whole game with Tab, Enter, Space, arrows, digits and typing only |
| Real use | The user plays the pilot and each new shell |
