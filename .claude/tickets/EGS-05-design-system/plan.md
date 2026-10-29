# EGS-05: design system and the studio UI (phase 2)

Derived from the hub plan HUB-19 phase 2 (`../creative-hub/.claude/tickets/HUB-19-edu-game-studio/plan.md`) and the director's brief of 2026-10-29. Branch: `EGS-05_design-system`, stacked on `EGS-04_autoplay-bot` (HEAD 1982630). One commit at the end (orchestrator). Never push.

A parallel department does phase 3 (EGS-06..08) in a separate worktree (`../edu-game-studio-p3`) off the same base. It owns `src/engine/**` (pipeline, roles, research, fact base, prompts), `seed/agents`, `seed/prompts`, `seed/config/roles.md` + `quality.md` and the MCP pipeline tools. This ticket owns `src/renderer/**`, `src/design/**`, the player's CSS and visual layer, design docs. Engine edits are limited to minimal UI wiring, in NEW files where possible, and listed in the changelog for the merge.

## Goal

1. Design tokens (CSS variables) shared by the studio and the player; four shell themes on top: chalkboard (quiz arena, exists: polish), castle stone + torchlight (MindMaze), parchment + brass (encyclopedia), pixel art (RPG), in a theme registry later shells pick from. Motion (screen transitions, combo bursts, page turns) behind `prefers-reduced-motion`. Bundled open-licensed fonts (no CDN), a real type scale (16px body, 13px floor).
2. Studio pages (React 19 + zustand): Library; Course with tabs Brief, Curriculum, Encyclopedia, Items, Game, Assets, Voice, Editions, Build, Playtest; Models, Agents, Generators, Settings. Empty, loading and error states.
3. Accessibility: keyboard navigation everywhere, visible focus rings, contrast AA.

## Design direction (frontend-design pass, agreed by the orchestrator)

**Subject:** a workshop where a teacher or author turns a topic into a game; the games are for learners. The studio is a working tool used for hours; the games are the show.

**Where the boldness goes:** into the games' themes and the way the studio shows them (Library covers painted in each course's theme, live theme previews in the Game tab, the item preview in the player's own look). The studio chrome stays quiet and disciplined.

### Studio: "the squared exercise book"

The Croatian school *bilježnica na kockice*: squared paper, fountain-pen royal-blue ink, the red margin rule, a yellow highlighter.

| Token | Light | Dark ("night desk") | Role |
|---|---|---|---|
| paper `--edu-bg` | `#f3f5f2` (cool, not cream) | `#161d22` | page, with a faint 8px square grid |
| sheet `--edu-surface` | `#ffffff` | `#1f282e` | panels and cards |
| ink `--edu-text` | `#1c2541` | `#e8edf0` | text |
| ink-dim `--edu-text-dim` | `#47506a` | `#a9b4bc` | secondary text (>= 4.5:1) |
| royal blue `--edu-accent` | `#2747c9` | `#8ea6ff` (ink `#10183a`) | primary actions, links, focus |
| margin red `--edu-accent-2` | `#c8283f` | `#ff7a8a` | the margin rule beside the nav, errors |
| highlighter `--edu-mark` | `#ffe066` | `#ffe066` | current nav item, selection, the "you are here" |

- Type: **Young Serif** for page and course titles (one weight, schoolbook warmth), **Atkinson Hyperlegible Next** for all UI text (made for legibility, fits an accessibility-first education tool), system monospace only for lint codes, ids and paths. Body 16px, controls 15-16px, nothing under 13px. Sentence case everywhere; no all-caps eyebrow labels.
- Layout: a left rail (the margin column) with the nav, separated from the content by the red margin rule; content left-aligned on the squared paper; panels are white sheets with a hairline, not floating cards with grey shadows. The course page has its title in Young Serif, a theme swatch strip and notebook-style tabs. The pipeline is a real sequence (brief -> research -> ... -> publish), so it may be shown as numbered stages.
- Light by default, dark with `prefers-color-scheme: dark` and a Settings switch (`data-studio-scheme`).

### Player themes (scoped `[data-edu-theme="<id>"]`)

| Theme | Ground / surface / text / accent / accent-2 | Display / body | Motion |
|---|---|---|---|
| chalkboard (quiz arena) | `#1d3a2e` / `#264a3a` / `#f5f2e8` / chalk yellow `#f7d95a` / chalk blue `#8fd3f7` | Kalam / Atkinson Hyperlegible Next | chalk-dust combo burst, board wipe between screens |
| castle (MindMaze) | `#1e2026` / `#2f333b` / `#efe6d2` / torch amber `#f4a53c` / ember `#d9542b` | Cinzel / Alegreya | torch flicker (opacity only), doors that swing |
| parchment (encyclopedia) | `#e6d7b8` / `#f1e6cc` / sepia `#2f2012` / brass `#7a5a17` / oxblood `#7a2230` | EB Garamond | page turn |
| pixel (RPG) | `#1b1b2f` / `#2c2c54` / `#f4f4f4` / gold `#ffcd3c` / grass `#4cbb47` | Pixelify Sans | steps() motion, stepped borders, `image-rendering: pixelated` |

All four are dark-or-light themes with AA contrast for every text slot; reduced motion turns every animation into an instant change.

## Contract written by the orchestrator before the split

- `src/design/tokens.css`: structure tokens and the colour/font slot names (`--edu-*`). Slot names are fixed; values may be tuned.
- `src/design/fonts/<family>/{font.css, *.woff2, OFL.txt}`: Atkinson Hyperlegible Next, Young Serif, Kalam, Cinzel, Alegreya, EB Garamond, Pixelify Sans (latin + latin-ext woff2 from Fontsource, OFL). `font.css` has the `@font-face` rules.
- `src/design/themes/index.ts`: the theme registry (`THEMES`, `getTheme`, `themeForShell`).
- `axe-core` added as a devDependency.

## Slices

### Slice A: design system, player themes, bot (implementer A)

Owns `src/design/**` (except the contract files' slot names), `src/player/**` (visual layer: `style/**`, markup/aria/focus/motion hooks in shells and items, no change to game logic), `scripts/play.mjs`, `scripts/theme-previews.mjs` (new), `tests/bot.e2e.test.ts`, `tests/design-*.test.ts` (new), `vite.player.config.ts`, `docs/player.md`, `docs/design.md` (new "Look" section).

- [x] `src/design/themes/{chalkboard,castle,parchment,pixel}.css`, each importing its fonts and filling every slot under `[data-edu-theme="<id>"]`; `src/design/motion.css` (keyframes: screen enter, combo burst, page turn, torch flicker, pixel step) behind reduced motion. DONE (A). Deviations: chalkboard is NOT also on `:root` (the shell puts `data-edu-theme` on `#edu-root`, so the file is safe to import into the studio); `tokens.css` gained six `--edu-series-1..6` + `--edu-series-ink` fills and `--edu-radius-control` / `--edu-radius-pill` (additive); two plan colours were nudged for AA (castle ember `#d9542b` -> `#f08357`, parchment brass `#7a5a17` -> `#6b4d10`; registry swatches updated); themes also dress `.frame` / `.board` (wood and chalk, stone and torches, vellum, stepped pixels).
- [x] Player CSS on the tokens: split the global part (resets, body) from the item and arena styles, and scope the item styles under a root class (`.edu-stage`) so the studio can embed a player item renderer for its live preview. Chalkboard polish (Kalam lettering, combo burst, screen transitions, feedback). The player bundle loads only the chalkboard theme and its fonts (inlined by Vite lib mode); `player.css` stays one file that works over `file://`. DONE (A): `style/base.css` (only globals), `style/items.css` + `style/arena.css` (every selector under `.edu-stage`, checked by a test), `style/embed.css` (the studio's entry: tokens + chalkboard + motion + items), `theme.css` removed. `player.css` = 209,216 bytes (about 204 KB; 6 `@font-face` data URIs, 0 `@import`, 0 external URLs); reduced motion verified in the real player (0 animations, durations 0ms). Also in the shell: one `h1` per screen (title / screen name / question; hidden one for flashcards), chalk-dust combo burst, `edu-stage` + `data-edu-theme` on the root.
- [x] Static theme previews (castle, parchment, pixel, and chalkboard for comparison): a sample question card, feedback and a progress strip in each theme, built into `.claude/temp/` HTML pages from `src/design/previews/` by `scripts/theme-previews.mjs`. DONE (A): `yarn previews` builds `.claude/temp/theme-previews/<id>.html` (one self-contained file per theme), screenshots 4 themes x (1280x800, 390x844) into `.claude/temp/screens/phase2/themes/`, runs axe (0 violations of any impact in all 8 runs), checks no horizontal overflow and 0 running animations under reduced motion.
- [x] `tests/design-tokens.test.ts`: every theme fills every slot; contrast pairs (text/bg, text/surface, text-dim/bg, accent-ink/accent, good-ink/good, bad-ink/bad, mark-ink/mark) >= 4.5:1, focus >= 3:1; the registry swatches match the CSS. DONE (A): 158 tests (all required pairs plus coloured text on bg/bg-2, series ink, warn on warn-bg, focus and line-strong at 3:1; motion rules; no remote fonts; the player stylesheets stay scoped, token-only, no all-caps labels, no text under 13px).
- [x] Bot: `--keyboard` (keyboard-only: Tab/Shift+Tab, Enter/Space, arrows, number keys, typing; no mouse clicks) that finishes the solar-system fixture in perfect mode; `--axe` runs axe-core (bundled from node_modules, injected into the page) on each distinct screen and fails on serious/critical violations; both covered in `tests/bot.e2e.test.ts`. DONE (A): keyboard perfect on solar-system: 34/34 right, finished, 533 key presses, 77 focus checks, 173 focus-ring checks, 0 mouse clicks; also hr-a1-greetings (242 presses) and wrong mode on both. axe: 31 runs (solar-system perfect) and 27 (hr), 0 critical, 0 serious, 0 moderate, 0 minor. Real player gaps found and fixed: word-search cells had `role=gridcell` with `aria-pressed` (axe critical), the flashcard's `aria-label` did not contain its visible text (serious), the filled cloze bank slot too (serious), the crossword grid was ~43 tab stops (now one, roving), screens had no `h1` / skipped heading levels. `tests/bot.e2e.test.ts`: 11 tests (keyboard + axe added for both fixtures).
- [x] Screenshots: quiz arena (both fixtures) and the theme previews at 1280x800 and 390x844 under `.claude/temp/screens/phase2/`. DONE (A): `arena/<fixture>-<desktop|mobile>/` (perfect + wrong runs: 49 / 49 / 43 / 43 PNGs) and `themes/` (8 PNGs); a sample of both was looked at and fixed (frame specificity, uppercase labels, tag contrast, castle Cinzel labels, star pop caught mid-animation -> shot wait 900 ms).

### Slice B: the studio UI (implementer B)

Owns `src/renderer/**`, `src/shared/protocol.ts` (additive changes), `src/main/**` + `src/preload/**` (host additions only), `src/engine/edu/studio-commands.ts` (new) plus the minimal routing lines in `src/engine/engine.ts` and `src/engine/edu/service.ts`, `tests/ui-*.test.ts`, `tests/studio-*.test.ts`, `scripts/studio-shots.mjs` (new), `tsconfig.web.json`, `electron.vite.config.ts`.

- [x] Studio theme `src/renderer/styles.css` on `src/design/tokens.css` (light + dark), fonts from `src/design/fonts/`.
- [x] Shell: left rail nav (Library, Models, Agents, Generators, Settings), engine status, warnings; keyboard navigation (roving tab index or plain tab order, arrow keys in tab lists, skip link), focus rings.
- [x] Library: course cards with a cover painted in the course's theme (registry swatch + display font), languages, item count, pipeline progress (stages derived from what the course has), empty state with how to create or import a course.
- [x] Course page with tabs: Brief (course facts, the brief when it exists), Curriculum (units, objectives with Bloom level, prerequisite graph as an SVG), Encyclopedia (articles), Items (list with filters + editor per item kind with a live preview that mounts the player's own item renderer and checks answers with the shared checkers), Game (shell choice + theme picker with live previews), Assets, Voice, Editions (languages + text coverage), Build (build + lint with codes, open the game), Playtest (run the bot, results + screenshots). Pipeline data that does not exist yet (brief, research, playtest history) shows an empty state and has a typed hook in `src/renderer/store/` named for the EGS ticket that will fill it.
- [x] Engine wiring (minimal): commands `getCourse`, `buildCourse`, `lintCourse`, `updateItem` (and `playtestCourse` if it fits in the new file), answered with events; handled in `src/engine/edu/studio-commands.ts` through `svc.courses`.
- [x] Models, Agents, Generators (studios + ComfyUI status), Settings restyled; MCP settings kept.
- [x] Browser harness: the built renderer with a mocked `window.edustudio` (fixture courses from `tests/fixtures/courses/`), so Playwright can load every page; `scripts/studio-shots.mjs` screenshots every page at 1280x800 and 390x844 into `.claude/temp/screens/phase2/studio/` and runs axe-core on each (0 serious/critical).

Slice B results (implementer B, 2026-10-29):

- Studio look done: "squared exercise book" (8px grid, red margin rule, highlighter nav, Young Serif + Atkinson Hyperlegible Next, light/dark via `prefers-color-scheme` and Settings `data-studio-scheme`). Bundled fonts load under the CSP (checked in the harness: both studio faces report `loaded`); `font-src` also allows `data:`.
- Shell, Library (covers painted per theme: chalkboard, castle, parchment, pixel; pipeline stages; empty/loading/offline/error), Course page with all ten tabs, Generators, restyled Models/Agents/Settings (testids kept, labels added) done.
- Item editor + live preview mounts the player's own renderers (`src/player/items`) in `.edu-stage[data-edu-theme]`; right/wrong by shared `checkItem`; feedback by the player's `buildFeedback`; save goes through `updateItem`. An unsaved item asks before it is left (dialog with focus trap, Escape).
- Engine wiring: `getCourse`, `buildCourse`, `lintCourse`, `updateItem` in `src/engine/edu/studio-commands.ts`. `playtestCourse` NOT done (the bot needs Playwright, which the packaged app does not carry): the Playtest tab gives the exact `yarn play` commands and has a typed slot (`usePlaytestRuns`, EGS-08).
- Pipeline slots (typed hooks + empty states): brief EGS-08, research EGS-06, curriculum notes EGS-07, playtest runs EGS-08 (`src/renderer/store/pipeline*.ts`).
- Verification: `yarn typecheck` 0 errors; `yarn lint` clean; `yarn test` 43 files, 631 tests pass; `yarn build` succeeds. `node scripts/studio-shots.mjs`: 146 audited states (3 runs: 1280 light, 390 light, 1280 dark, plus empty/offline/loading/error states at both widths and a keyboard run); 140 states with 0 serious/critical, 6 states fail only on the PLAYER's DOM (not studio code): flashcard `aria-label` does not contain its visible text (label-content-name-mismatch) and the word-search cells use `role="gridcell"` with `aria-pressed` (aria-allowed-attr, critical). Both are in `src/player/items/` (Slice A).
- Not done / deviations: no theme-saving (the quiz arena only plays chalkboard; the Game tab previews all four looks, saving a theme has no effect yet, so no `editCourse` command was added); `playtestCourse` as above.


## Acceptance (orchestrator verifies)

- `yarn typecheck`, `yarn lint`, `yarn test` pass (counts recorded); `yarn build` succeeds.
- axe-core: 0 serious/critical on the built quiz arena (both fixtures) and on every studio page.
- The bot's keyboard-only mode finishes the solar-system fixture.
- Screenshot set: every studio page, the quiz arena and the castle/parchment/pixel previews at 1280x800 and 390x844 under `.claude/temp/screens/phase2/`.
- Ticket folder (this plan with results, changelog.md), ROADMAP.md, README.md updated.

## Results

Done 2026-10-29 (orchestrator re-runs after both slices, on the final tree):

- `yarn typecheck` exit 0; `yarn lint` exit 0; `yarn test` 44 files, 793 tests passed (205 s, includes the bot e2e with keyboard and axe runs); `yarn build` succeeded.
- axe-core: quiz arena 0 violations of any impact (31 runs solar-system, 27 hr-a1-greetings, slice A); theme previews 8/8 clean; studio `node scripts/studio-shots.mjs` 146 states, 0 serious/critical (the 6 player-DOM failures slice B first saw were fixed by slice A).
- Keyboard-only bot: solar-system perfect 34/34, finished, 0 mouse clicks; also hr-a1-greetings and wrong mode on both.
- Screenshots: `.claude/temp/screens/phase2/{studio,arena,themes}/`.
- Orchestrator touch-ups: `studio:shots` script in package.json, "1 source" plural in the Curriculum tab, README, ROADMAP, changelog.
- UNTESTED: the Electron window (`yarn dev`), `openGame` and the new file-protocol paths in Electron, touch devices, real audio.
- NOT DONE: `playtestCourse` from the studio (needs an engine-side runner; Playwright is not in the packaged app) and saving a theme from the Game tab (only one shell plays yet); both in ROADMAP "Later".

Changelog: `changelog.md` next to this plan.
