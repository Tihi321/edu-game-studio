# EGS-10: the shell contract and the encyclopedia explorer

Hub plan HUB-19 phase 5 (`../creative-hub/.claude/tickets/HUB-19-edu-game-studio/plan.md`), first shell. Branch `EGS-10_encyclopedia`, stacked on `EGS-05_design-system` (c78d3b2). One commit (orchestrator). Never push. The phase-3 stack (EGS-06..08, media EGS-15..17) lives in `../edu-game-studio-p3` and is not touched; a later integration rebases it onto this stack.

## Part A: the shell contract (orchestrator, done before the split)

See `shell-contract.md` (this folder) and `docs/player.md`, "Shells".

- [x] `src/shared/shells/` registry + `ShellDef`; `validateCourse` runs the sections (`SHELL_SCHEMA`, text keys as MISSING_TEXT); `lintGameData` runs `lintShells` (`SHELL_UNKNOWN`, `SHELL_SECTION_MISSING`, the shells' codes) and checks the sections' text keys per edition.
- [x] Engine: `?shell=`, the remembered choice, `switchShell`, `playableShells`, `debug.shell`; the game-style picker on every title (quiz arena included).
- [x] `Progress.shells[<id>]` (own stars, finish, data), parse/export/import; `startPool` (runs over any pool).
- [x] The kit: `ShellSession`, `ask()`, `titleScreen`, `endScreen`, `makeShellUi`, `kit.css`; stubs for the five shells.
- [x] Bot: `--shell`, driver registry `scripts/bot/`, the quiz arena driver moved out of `play.mjs` unchanged in behaviour, `bot` toolbox.
- [x] Tests: `tests/player-shell-kit.test.ts`, `tests/player-shell-picker.e2e.test.ts`, shell stylesheet checks in `tests/design-tokens.test.ts`, `tests/bot-helpers.ts`.
- [x] Fixture `european-capitals` (en + hr, history and geography, previews the pilot): core course by a fixture implementer. Done: 3 units (u-west; u-central and u-south both require only u-west), 9 objectives, 34 items in 12 kinds, 12 articles, 29 facts (Wikipedia). Evidence: edu-course and edu-lint tests pass, `lint european-capitals` 0 errors 0 warnings, bot perfect/wrong/random/keyboard+axe ok, `bot.e2e.test.ts` 16 passed, typecheck and lint pass. Core only (`shells.enabled` = quiz-arena); the encyclopedia section is not set.

## Part B: the encyclopedia explorer (implementer)

Theme `parchment` (parchment and brass, EB Garamond, pages that turn). Inspired by Encarta: you browse, the game sends you back into the articles for answers.

### Screens (names are `getState().screen`)

- `title` (kit).
- `explore`: the home of the encyclopedia. A masthead (the course title as a book title, h1), a search field (`search` input, results `result-<articleId>` live under it, Enter opens the first), the article index grouped by unit (`article-<articleId>` links; a locked unit's articles are still readable: reading is free, the hunts are gated), tabs or a nav for `timeline`, `map`, `codex`, `hunts` (`nav-<name>`), a status line (collectibles found / total, stars).
- `article`: the article (title h1, figure with the article's image and its alt as caption, an audio slot `article-audio` when the article has an audio asset (a button that plays it; when there is none, nothing), the body with paragraphs, cross-links: every mention of another article's title in the body becomes a link `link-<articleId>` (first mention, longest title first, case-insensitive, whole words), "See also" from `related` (`related-<articleId>`), citations (`citation-<factId>`: the fact-base source, and the url as a link that opens in a new tab), back (`back`), and, during a hunt, the collect button (`collect-<stepId>`) when this article is the target of the current step). Page-turn motion between articles.
- `timeline`: events on a horizontal axis (SVG or Canvas 2D, from the section's `timeline`, else from `order` items with `timeline: true` and their `when` labels), each event a focusable button `event-<id>` opening its article; arrow keys move between events. Readable at 390 px (it scrolls inside its own box, the page does not).
- `map`: an image (the section's `map.asset`, else the first image asset) with pins (`place-<id>` buttons at x/y in image pixels, scaled), each opening its article; a list of the places under it for keyboard and screen-reader users.
- `codex`: the collectibles found (`codex-<id>`: name, the fact it taught (the step item's didYouKnow or explanation), a link to its article), and the empty slots of those not found yet (shown as "?").
- `hunts`: the scavenger hunts, one or more per unit (`hunt-<huntId>`; locked until the unit is open: `data-locked`), stars per unit; the final grand hunt (`hunt-final`, mixes units) when every unit is mastered.
- `item` / `feedback` (kit `ask()`, context `hunt`), `end` (kit).

### The hunt loop (intrinsic integration: the question is about the article you found)

1. Start a hunt: its first step's clue is pinned in a bar on every screen (`clue`, the riddle: "Find the planet whose day is longer than its year").
2. The learner browses or searches; on the target article the `collect-<stepId>` button appears ("Collect the brass key").
3. Collect asks the step's item (`ask`, context `hunt`, the article stays one click away: the question screen offers `back-to-article` via `onLeave`... or simply the lead names the article). Right: the collectible goes into the codex, the next clue shows. Wrong: the feedback explains, the step stays open and asks again later with the item coming back as a retry (or another item of the same objective); the learner is told to read the article again (never a dead end).
4. When every step is done: stars from the first-try accuracy of the hunt's run (`recordUnit`), 2+ stars unlock the next units' hunts; fewer: the hunt can be played again.
5. The final hunt mixes steps from every unit (boss); after it, `end`.

### Course section `shells.config.encyclopedia` (all optional; automatic layout when missing)

```jsonc
{
  "timeline": [{ "id": "t-voyager", "year": 1977, "label": "enc.t.voyager", "article": "art-beyond" }],   // year < 0 = BC
  "map": { "asset": "img-...", "width": 800, "height": 300, "places": [{ "id": "p-sun", "x": 40, "y": 150, "label": "enc.p.sun", "article": "art-sun" }] },
  "hunts": [{ "id": "h-sun", "unit": "u-sun-planets", "title": "enc.h.sun.title", "intro": "enc.h.sun.intro",
              "steps": [{ "id": "s1", "clue": "enc.h.sun.s1.clue", "article": "art-sun", "item": "q-sun-mcq", "collectible": "enc.h.sun.s1.name" }] }]
}
```

Automatic layout (no section): a hunt per unit whose steps are the unit's articles (or, without articles, the unit's objectives with an auto article built from the objective text), the item of each step chosen from the items whose objective cites a fact the article cites, else from the unit; generic clue text from the shell's strings ("Find the article about {title}"); timeline from timeline `order` items; map from the first image asset with no pins (the map tab hidden when there is nothing to show).

### Lint codes (`ENC_`)

- `ENC_HUNT_TARGET_MISSING` a step's article does not exist; `ENC_HUNT_ITEM_MISSING` a step's item does not exist; `ENC_UNIT_NO_HUNT` a unit no hunt covers (it could never be mastered); `ENC_HUNT_EMPTY`; `ENC_TIMELINE_ARTICLE_MISSING`; `ENC_MAP_ARTICLE_MISSING`; `ENC_MAP_PLACE_OUTSIDE` a pin outside the image; `ENC_MAP_NO_IMAGE` the map names a non-image asset.
- Warnings: `ENC_ANSWER_NOT_IN_ARTICLE` the step item's right answer (option text, canonical typed answer, true/false statement's key words are skipped) does not appear in the target article's body in an edition (the hunt must send you to an article that holds the answer); `ENC_HUNT_ITEM_OTHER_UNIT`.

### Fixtures

- `solar-system`: section with a timeline (5+ events: Galileo 1610, Uranus discovered 1781, Neptune 1846, Pluto 1930, Voyager 1977, New Horizons at Pluto 2015 ... facts that the fact base or articles support; add fact-base-backed text only), a map on `img-solar-system` (pins for the Sun and the planets drawn there), a hunt per unit (3 steps each) whose answers are in the article bodies (edit only your `enc.` keys: if an article body lacks an answer, choose another item; the core articles belong to the course). EN + HR text.
- `european-capitals` (being written in parallel; wait for `.claude/temp/european-capitals.READY`): a timeline (founding/landmark dates from its fact base), the map on its Europe map with a pin per capital, a hunt per unit.

### Bot driver `scripts/bot/encyclopedia.mjs`

perfect: for each unit in prerequisite order, start its hunt; per step read the clue, find the article by SEARCH (type a word of its title into `search`, open `result-<id>`) on odd steps and by the index or a cross-link on even ones, `collect-<step>`, answer right; all hunts to 3 stars, then the final hunt, `end`; also visit `timeline` (activate one event), `map` (one place), `codex` (count = collectibles found). wrong: answer every step wrong; check the clue stays open, the codex stays empty, the review queue fills, the hunt cannot be finished (no stars), and nothing is a dead end (the target article and the collect button are still there). random: finish within the bound. Keyboard mode and axe on every distinct screen.

### Done when

The common checks of `shell-contract.md` pass for `solar-system` and `european-capitals`, with screenshots in `.claude/temp/screens/phase5/encyclopedia/`.

### Part B results (implementer, phase 5 resume)

Section for `docs/player.md`: `player-doc.md` in this folder.

- [x] Player shell `src/player/shells/encyclopedia/` (app, articles, data, places, timeline, strings, view-article / explore / hunts / places, index) reviewed against this plan and finished: `encyclopedia.css` written (parchment and brass; tabs, pinned clue slip, spread with drop cap, timeline ruler, map rings, codex medals, hunt cards, CSS book emblem; page turn on the page content only; reduced motion off); the `roman()` eslint error fixed; the hud pip fills when a collectible is collected.
- [x] Course side `src/shared/shells/encyclopedia.ts` reviewed: lint codes as planned plus `ENC_HUNT_ITEM_DUPLICATE` (two steps of a hunt asking one item: the second could never come up); the answer-in-article stem rule now also matches Croatian inflection ("Ateni" finds "Atena").
- [x] Fixtures through `.claude/temp/fixture-section.mjs` (sources: `.claude/temp/encyclopedia-make-parts.mjs` -> `.claude/temp/fixtures/encyclopedia/<fixture>.json`): `solar-system` (8 events, map with 9 pins, 3 hunts x 3 steps, EN + HR) and `european-capitals` (12 events, map with 12 pins, 3 hunts x 4 / 4 / 3 steps, EN + HR, `encyclopedia` added to `shells.enabled`). Lint: 0 errors, 0 warnings for both, with the section and without it (the automatic layout). Note: four solar-system events (Galileo 1610, Uranus 1781, Neptune 1846, Pluto 1930) are well-known dates that are not in the course's fact base (the plan named them); the other four (1957, 1969, 1977, 2015) are.
- [x] Broken fixture `tests/fixtures/courses/broken-encyclopedia/` (+ `EXPECTED.md`: 3 build codes, 12 lint error codes, 2 warning codes; generator `.claude/temp/encyclopedia-make-broken.mjs`).
- [x] Tests: `tests/player-encyclopedia-logic.test.ts` (30 tests: links, search, timeline and map geometry, saved data, strings, model of both fixtures in both editions, the automatic layout) and `tests/encyclopedia-lint.test.ts` (9 tests: golden fixtures lint clean with and without the section, the broken fixture's exact codes, every `ENC_` code documented) - 39 passed. `tests/bot-encyclopedia.e2e.test.ts`: 15 passed (3 cases x perfect, keyboard + axe, axe wrong + phone, wrong, random). With `tests/design-tokens.test.ts`, `edu-lint`, `edu-course`, `player-shell-kit`: 363 passed in 6 files.
- [x] Bot driver `scripts/bot/encyclopedia.mjs` (replaces the stub), table below.
- [x] Typecheck: web and player projects clean; the node project has errors only in other shells' files (`src/player/dom.ts` through `tests/player-rpg-logic.test.ts`), none in ours. eslint clean on all our files.
- [x] Screenshots 1280x800 and 390x844 of every distinct screen: `.claude/temp/screens/phase5/encyclopedia/<fixture>-desktop|mobile/` for `solar-system`, `european-capitals`, `solar-system-auto`, plus `solar-system-wrong-desktop|mobile` (retry clue, failed hunt) and `european-capitals-hr` (Croatian edition). Looked at: the explore page, an article with the collect seal, the timelines, both maps, the codex, the hunts and the result banners, the end page; fixed the index gaps (CSS columns), the pinned clue on a phone, and the timeline / map widening the frame on a phone (`contain: inline-size`).

| Fixture | Mode | Result | Console errors | Answers (right / wrong) | Notes |
|---|---|---|---|---|---|
| solar-system | perfect | pass | 0 | 15 / 0 | 4 hunts, 9 collectibles |
| solar-system | wrong (2 rounds) | pass | 0 | 0 / 18 | hunt 1 twice, others locked |
| solar-system | random (seed 7, 0.75) | pass | 0 | 23 / 10 | 7 hunts, 33 answers |
| solar-system | perfect keyboard + axe | pass | 0 | 15 / 0 | 0 mouse clicks, 217 key presses, axe 21 runs: 0 critical, 0 serious |
| european-capitals | perfect | pass | 0 | 17 / 0 | 4 hunts, 11 collectibles |
| european-capitals | wrong (2 rounds) | pass | 0 | 0 / 24 | |
| european-capitals | random (seed 7, 0.75) | pass | 0 | 39 / 23 | 11 hunts, 62 answers |
| european-capitals | perfect keyboard + axe | pass | 0 | 17 / 0 | 0 mouse clicks, 283 key presses, axe 21 runs: 0 / 0 |
| solar-system without section (auto) | perfect | pass | 0 | 10 / 0 | 5 collectibles |
| solar-system without section (auto) | wrong (2 rounds) | pass | 0 | 0 / 6 | |
| solar-system without section (auto) | random (seed 7, 0.75) | pass | 0 | 16 / 5 | |
| solar-system without section (auto) | perfect keyboard + axe | pass | 0 | 10 / 0 | 0 mouse clicks, axe 17 runs: 0 / 0 |

Deviations and notes:
- The wrong and random mouse runs set `prefers-reduced-motion: reduce` (the driver does it): Playwright clicks only a settled element, so every page turn cost a second (a random run of european-capitals took 217 s, now 16 s); it also proves the book plays without motion. Perfect and keyboard runs keep the page turn and check that the content animates `edu-enter-page`.
- Hunts have 3 to 4 steps per unit; in `solar-system` one of the steps of the first unit points to the article of another unit ("rocky planets": the Mercury question), so the first hunt also crosses between articles.
- UNTESTED: the audio slot of an article (no fixture article has an audio asset; the driver checks the slot is absent without one); a real screen reader; Safari / Firefox (Chromium only).

## Orchestrator check (2026-10-30)

Committed alone on branch `EGS-10_encyclopedia` (one commit, stacked; not pushed). This ticket's tree, checked in a clean worktree: `yarn typecheck` 0 errors, `yarn lint` 0 problems, `yarn test` 49 files, 871 tests passing (the shell list in `tests/player-shell-kit.test.ts` is written per ticket). Changelog: `changelog.md`.
