# EGS-05 changelog

## 2026-10-29: EGS-05 design system, four themes and the studio UI; keyboard-only bot and axe-core clean on the game and the studio

Branch `EGS-05_design-system` (stacked on `EGS-04_autoplay-bot`, 1982630). Done by two implementers in one checkout (slice A: design system + player + bot; slice B: studio UI), reviewed and re-verified by the orchestrator.

### What changed

**Design system (`src/design/`, new)**
- `tokens.css`: the shared `--edu-*` vocabulary: colour and font slots, a 1.2 type scale on a 16px body (13px floor), 4px spacing, radii (`--edu-radius-control`, `--edu-radius-pill`), focus ring, motion durations (0 under `prefers-reduced-motion`), six series fills.
- `fonts/<family>/`: Atkinson Hyperlegible Next, Young Serif, Kalam, Cinzel, Alegreya, EB Garamond, Pixelify Sans: latin + latin-ext woff2 (Croatian letters), `font.css` with the `@font-face` rules, `OFL.txt`. Taken from Fontsource; the packages were removed again after copying.
- `themes/index.ts`: the theme registry (`THEMES`, `getTheme`, `themeForShell`) with swatches and font families; `themes/{chalkboard,castle,parchment,pixel}.css` fill every slot under `[data-edu-theme="<id>"]` and dress the frame (wood and chalk; stone and torchlight; vellum and brass; stepped pixel borders).
- `motion.css`: screen enter, combo burst, page turn, torch flicker, pixel steps; all off under reduced motion.
- `previews/`: a static page per theme (question card, feedback, progress strip, title).

**Player (`src/player/`)**
- `style/base.css` (globals, player only), `style/items.css` and `style/arena.css` rewritten on the tokens with every selector under `.edu-stage`; `style/embed.css` (tokens + chalkboard + motion + items) for the studio's live preview; `style/theme.css` removed. The root gets `edu-stage` and `data-edu-theme`.
- Chalkboard polish: Kalam lettering, chalk-dust combo burst, board-wipe transition, one `h1` per screen.
- Accessibility fixes found by the keyboard and axe runs: word-search cells (invalid `gridcell` + `aria-pressed`), flashcard and cloze-slot names that did not contain their visible text, the crossword grid as one roving tab stop instead of about 43.
- `player.css` is 209,216 bytes (fonts inlined, no `@import`, no external URL); still one file over `file://`.

**Bot and checks**
- `scripts/play.mjs`: `--keyboard` (keyboard only, checks focus placement and the visible focus ring) and `--axe` (axe-core from node_modules on every distinct screen and item kind; fails on serious or critical).
- `scripts/theme-previews.mjs` (`yarn previews`): builds the theme previews, screenshots them, runs axe, checks overflow and reduced motion.
- `scripts/studio-shots.mjs` (`yarn studio:shots`): builds the renderer with a mocked `window.edustudio` that runs the real course handler on temporary copies of the golden fixtures, screenshots every page, tab and state, runs axe-core, exits non-zero on a serious or critical violation.
- Tests: `tests/design-tokens.test.ts` (contrast pairs per theme, slots filled, swatches = CSS, scoping, no remote fonts), `tests/bot.e2e.test.ts` (keyboard and axe runs added; 11 tests), `tests/studio-commands.test.ts`, `tests/studio-files.test.ts`, `tests/studio-lib.test.ts`, `tests/ui-course.test.ts`, `tests/ui-store.test.ts` (new page list).

**Studio (`src/renderer/`)**
- `styles.css` rewritten: "the squared exercise book" (cool paper with an 8px grid, royal-blue ink, red margin rule beside the rail, highlighter for the current place; Young Serif titles, Atkinson Hyperlegible Next UI), light and dark (`prefers-color-scheme` and a Settings switch).
- `App.tsx`: left rail (Library, Models, Agents, Generators, Settings), skip link, engine status. `ui/CoursesPage.tsx` replaced by `ui/LibraryPage.tsx` (covers painted in each course's theme, pipeline stages, empty / offline / loading / error states).
- `ui/course/`: `CoursePage` with ARIA tabs Brief, Curriculum (prerequisite graph as SVG, objectives with Bloom levels), Encyclopedia, Items (filters + `ItemEditor` per kind + `ItemPreview` that mounts the player's own renderer in `.edu-stage` and checks with the shared `checkItem`; unsaved-changes dialog with focus trap), Game (shells and live theme previews), Assets, Voice, Editions (text coverage), Build (build + lint with codes, open the game), Playtest (the `yarn play` commands and a typed slot).
- `ui/GeneratorsPage.tsx` (studios, ComfyUI, voice status); Models, Agents, Settings, MCP settings restyled (testids kept; MCP default port fixed from 7459 to 7463).
- `store/course.ts`, `store/generators.ts`, `store/pipeline.ts` + `pipeline-hooks.ts` (typed slots for brief EGS-08, research EGS-06, curriculum notes EGS-07, playtest runs EGS-08), `lib/{course,graph,items,scheme}.ts`.

**Outside `src/renderer` and `src/design` (for the merge with phase 3)**
- `src/shared/protocol.ts` (additive): commands `getCourse`, `buildCourse`, `lintCourse`, `updateItem`; events `course.loaded`, `course.built`, `course.linted`, `item.updated`; view types; `StudioCommand`; `EduCommand` and `COMMAND_TYPE_SET` extended.
- `src/engine/edu/studio-commands.ts` (new): handles the four commands through `svc.courses`; errors go out as `command.error` with the slug.
- `src/engine/edu/service.ts`: one import and a four-case branch in `handle`.
- `src/engine/engine.ts`: four `case` lines in the list that forwards to `this.edu.handle`.
- `src/main/files.ts`: the file protocol also serves `courses/<slug>/course/assets/` and `courses/<slug>/build/assets/`.
- `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/hostApi.ts`: `host:openGame` / `openGame(slug)` opens `build/index.html` in the default browser.
- `src/renderer/index.html`: CSP `font-src` allows `data:`. `electron.vite.config.ts`: `server.fs.allow` the repo root (the dev server serves `src/design` and `src/player`).
- `package.json`: `axe-core` devDependency; scripts `previews`, `studio:shots`. `yarn.lock`.
- Docs: `docs/design.md` ("Look"), `docs/player.md` (embed entry, `.edu-stage`, bot flags), `README.md`, `ROADMAP.md`.

### Deviations

- Chalkboard is not on `:root` (it would restyle the studio when imported); the player root carries `data-edu-theme`.
- Two plan colours nudged for AA: castle ember `#d9542b` -> `#f08357`, parchment brass `#7a5a17` -> `#6b4d10`.
- `playtestCourse` not built: the bot needs Playwright, which the packaged app does not carry. The Playtest tab shows the commands; a typed slot waits for an engine-side runner (ROADMAP "Later").
- The Game tab previews all four looks but does not save a theme: the quiz arena plays only chalkboard, so no `editCourse` command was added (ROADMAP "Later").

### Verification (orchestrator re-runs after both slices)

- `yarn typecheck` exit 0; `yarn lint` exit 0; `yarn build` succeeded (renderer chunk-size warning only).
- `yarn test`: 44 files, 793 tests passed (205 s, includes the bot e2e with keyboard and axe runs).
- `node scripts/studio-shots.mjs`: 146 audited states (1280 light, 390 light, 1280 dark, empty/offline/loading/error at both widths, a keyboard run), 0 serious/critical in all 146 (the 6 player-DOM failures slice B saw were fixed by slice A before this run).
- Slice A: `yarn previews` 8 pages, 0 axe violations; bot keyboard perfect on solar-system 34/34, finished, 533 key presses, 0 mouse clicks; axe 31 runs (solar-system) and 27 (hr-a1-greetings), 0 violations of any impact.
- Screenshots (gitignored) under `.claude/temp/screens/phase2/`: `studio/` (146), `arena/<fixture>-<desktop|mobile>/` (49, 49, 43, 43), `themes/` (8); samples looked at by the implementers and the orchestrator.

Not run: `yarn dev` / the Electron window (`openGame` and the new file-protocol paths are covered only by `tests/studio-files.test.ts` and the browser mock); real touch devices; real audio; a human look at every screenshot.

### Commit status

One commit on `EGS-05_design-system` (not pushed).
