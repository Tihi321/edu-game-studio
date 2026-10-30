# The browser player

Our own runtime (plain TypeScript and DOM, no game engine, no React) that plays a built course in a browser, over `file://`. The sources are in `src/player/`; `yarn build:player` bundles them into **one IIFE** `out/player/player.js` and `out/player/player.css` (no code splitting, no external imports, no CDN; the chalkboard theme's fonts, Kalam and Atkinson Hyperlegible Next, are inlined in the CSS as data URIs, so the one CSS file works over `file://`). The engine's build copies both next to `index.html`, `game-data.js` and `assets/` (the layout is in `src/shared/game-data.ts`).

The autoplay bot (EGS-04, `scripts/play.mjs`) and Playwright drive the game **only through `data-testid`s and `window.EduEngine.getState()`**, both documented here, plus the small solver hook `window.EduEngine.debug` (below).

## Pieces

| File | What |
|---|---|
| `main.ts` | Entry: creates `window.EduEngine`, registers the 13 item renderers and the quiz-arena shell, starts the game when the page is ready |
| `engine.ts` | `EduEngine`: registry of shells and item renderers, the published state |
| `shells/quiz-arena.ts` | The chalkboard quiz arena (screens, HUD, feedback panel, timer, combo, keys) |
| `round.ts` | Pure round logic: adaptive pick, in-session retry queue, due-card preference, interleaving, accuracy, grades, timer rule |
| `progress.ts` | Pure progress model (stars, unlocking, review queue, export/import validation) and `ProgressStore` (localStorage) |
| `feedback.ts` | Pure feedback text: why of the chosen distractor, answer lines, notes, did-you-know |
| `debug.ts` | The bot's solver hook `EduEngine.debug` (`solve`, `wrong`) |
| `state.ts` | Pure `getState()` snapshot builder |
| `i18n.ts` | The player's own words (English, Croatian; a course catalog can override any string with `ui.<key>`) |
| `items/*.ts` | One renderer per item kind |
| `style/base.css` | The only global rules (html, body, `#edu-root`); only the player bundle imports it |
| `style/items.css` | Buttons, chips and every item widget, scoped under `.edu-stage`, on the `--edu-*` tokens |
| `style/arena.css` | The quiz-arena screens (frame, board, HUD, feedback, summary, burst), scoped under `.edu-stage` |
| `style/embed.css` | What the studio imports to mount an item renderer in a live preview (tokens + chalkboard theme + motion + `items.css`; no global rules) |

Every answer goes through the shared `checkItem` (`src/shared/edu`) with a `CheckContext` built from the course (`matching.diacritics`, `matching.typos`) and the edition's text resolver, so the player, the lint and the bot agree on what is right.

## `window.EduEngine`

```ts
EduEngine.version                       // '1.0.0'
EduEngine.registerShell(id, shell)      // a shell is { id, mount(host), unmount? }
EduEngine.registerItemKind(kind, renderer) // { kind, ownsPrompt?, render(ctx) -> { el, focus, reveal, key?, destroy? } }
EduEngine.getState()                    // JSON-safe snapshot, below
EduEngine.debug.solve(itemId)           // an answer the checker accepts (shape of src/shared/edu/checkers.ts), in the edition being played
EduEngine.debug.wrong(itemId)           // an answer the checker rejects (a distractor with an explanation where there is one)
EduEngine.start()                       // mounts the shell named by GameData.shell (called by the bundle itself)
```

`debug` is for the autoplay bot: it is read-only (it computes with the shared `solveItem` on the game data the page already holds, changes no state and draws nothing, so no answer appears in the UI). `solve` returns the answer shapes of the checkers (an option id, `true`/`false`, a list of ids, `{gapId: text}`, the typed text, `{leftId: rightId}`, an id order, `{itemId: groupId}`, a region id, a flashcard grade, `{wordId: text}` for a crossword, a list of `{start, end}` cell lines for a word search); `wrong` returns the same shape, wrong (an empty list for a word search = give up). An unknown item or kind gives `undefined`. A word bank in a cloze is answered by the bot through `bank-<gapId>-<wordKey>`.

A later shell or item kind is one more `register...` call (before `start()`). `GameData.shell` picks the shell, falling back to `quiz-arena`. A question whose kind has no renderer is skipped with a `console.warn`, never a crash.

`?seed=N` in the address (an integer) seeds every shuffle and pick, so a run can be replayed; without it the seed is random. It is reported in `getState().seed`.

## `getState()`

```ts
{
  screen: 'loading' | 'error' | 'title' | 'map' | 'item' | 'feedback' | 'summary' | 'review' | 'end'
  shell: 'quiz-arena'
  lang: string                 // the edition being played
  seed: number
  unitId?: string              // the unit of the round (not for boss / review rounds)
  round?: number               // 1-based round number in this page session (a replay is a new round)
  roundKind?: 'unit' | 'boss' | 'review'
  itemId?: string              // only on screens 'item' and 'feedback'
  itemKind?: string            //   "
  itemIndex?: number           //   0-based position of the question in the round; retries of misses count
  roundSize?: number           // fresh questions in the round; retries come on top
  combo: number
  score: number                // total score over all sessions (saved with the progress)
  lastResult?: { correct: boolean; typo?: boolean; diacritics?: boolean }  // only on screen 'feedback'
  reviewQueue: string[]        // item ids missed and not answered right since
  mastery: Record<string, number>  // unit id -> stars 0..3 (every unit is a key)
  finished: boolean            // true on the end screen
  steps: number                // answers submitted in this page session (a flashcard grade is an answer)
}
```

A round shows `screen: 'item'` while a question waits for an answer and `'feedback'` after the answer, until `next` is pressed. `getState()` returns a copy; changing it changes nothing.

## Screens and test ids

Naming scheme: kebab-case, `<thing>` or `<thing>-<id>`, where `<id>` is the id from the pack (unit id, option id, pair id, item id, region id ...). The ids are language-neutral, so the bot can build them from `game-data.json`. The root element is `app` (`data-screen` = the screen, `data-shell`).

### `title`
`course-title` (h1), `course-subject` (when it differs from the title), `lang-picker` and `lang-<code>` (one per edition, only when there are two or more; `aria-pressed` marks the current), `setting-timer` (checkbox, off by default), `setting-sound` (only when the pack has cues), **`start`** (labelled Continue when there is saved progress; opens the map), `export` (downloads `<slug>-progress.json`), `import` (opens the file chooser) and `import-file` (the `<input type="file">`: `setInputFiles` works on it), `reset` then `reset-confirm` / `reset-cancel` (inline, no browser dialog), `title-message` (result of import / export / reset, `role=status`), `storage-warning` (when localStorage is unusable).

### `map`
`menu` (back to the title), `map-stars`, `map-title`, `unit-map`, `unit-<unitId>` (a button; `disabled` and `data-locked="true"` while a required unit has fewer than 2 stars; `data-stars` 0..3; `data-requires` lists the prerequisite ids), `boss` (disabled until every unit has 2 stars; `data-stars`), `review` (only when the review queue is not empty), `finish` (only after the boss was beaten once; shows the end screen).

### `item` and `feedback`
HUD: `leave` (back to the map, the round is dropped), `hud-unit`, `hud-progress` (pips), `hud-score`, `hud-combo`, `hud-timer` (only visible when the timer runs on this question). Question: `question-number`, `retry-tag` (a missed question coming back), `prompt` (not for flashcards: the card shows it), `item-image`, `hint` (button) and `hint-text`, `item-body` (`data-kind` = the item kind), the item widgets below, `combo-burst` (appears at combos 3, 5, 7, 10, 15 ...).

After the answer (screen `feedback`): `feedback` (`data-result` = `correct` | `partial` | `wrong` | `timeout`), `feedback-title`, `feedback-notes` (typo / accent notes of the matcher), `feedback-detail` ("Right pairs: 2 of 4"), `feedback-why` (the explanation of the CHOSEN wrong choice), `feedback-answer` (the right answer; not shown for a right answer, except a flashcard and a timeline), `feedback-explanation`, `feedback-dyk` (right answers only), **`next`** (the focus moves to it; Enter continues). `live` is an `aria-live` region that reads the verdict.

Item widgets, by kind (the answer shapes are the ones of `src/shared/edu/checkers.ts`):

| Kind | Test ids | How it is answered |
|---|---|---|
| `mcq` | `option-<optionId>` | click, or the number key 1-9 (displayed order) |
| `true-false` | `option-true`, `option-false` | click, or 1 / 2 |
| `multi-select` | `option-<optionId>` (`aria-pressed`), `submit` | toggle options, then `submit` |
| `cloze` | `gap-<gapId>` (a text input, or the slot of a word bank), `bank-<gapId>-<wordKey>` (a bank word; the key is the catalog key, e.g. the gap's `answer`), `letter-<char>`, `submit` | fill every gap, `submit` |
| `typed` | `answer-input`, `letter-<char>`, `submit` | type, Enter or `submit` |
| `match-pairs` | `pair-left-<pairId>`, `pair-right-<pairId>` (the right text that belongs to that pair), `submit` | click a left then a right; `submit` when all are paired |
| `order` | `order-list`, `order-row-<itemId>`, `order-up-<itemId>`, `order-down-<itemId>`, `submit` | move rows with the buttons (or drag), `submit` |
| `sort-groups` | `sort-card-<itemId>`, `group-<groupId>-<itemId>` (`aria-pressed`), `submit` | press the group of each card, `submit` |
| `hotspot` | `hotspot` (the svg), `region-<regionId>` (focusable) | click or Enter/Space on a region; a click on no region is a wrong answer |
| `listening` | `audio-play`, `audio`, then `option-<optionId>` (choose) or `answer-input` + `submit` (type), `transcript` (after the answer) | |
| `flashcard` | `flip`, `grade-again`, `grade-hard`, `grade-good`, `grade-easy` | flip, then grade (keys 1-4 after the flip) |
| `crossword` | `cell-<row>-<col>` (0-based), `word-<wordId>` (whole-word input of a clue), `clue-<wordId>`, `submit` | type into cells or the word inputs, `submit` |
| `word-search` | `cell-<row>-<col>` (0-based), `ws-word-<wordId>`, `ws-count`, `submit` ("Done") | click the first and last letter of each word; sends itself when all are found, `submit` gives up the rest |

Typed text goes through the tolerant matcher: case, spacing and punctuation never matter; missing accents are accepted under policy `ignore` / `warn` (a note under `warn`) and are a near-miss under `strict`; one letter off in an answer of 4+ letters is accepted with a spelling note. Courses whose typed answers are Croatian get the buttons `letter-č` `letter-ć` `letter-š` `letter-ž` `letter-đ` (other languages: `SPECIAL_LETTERS` in `i18n.ts`).

### `summary`
`summary-title`, `summary-stars` (`data-stars`; not for a review round), `summary-accuracy` (first-try accuracy of the fresh questions), `summary-score`, `summary-unlocked`, `summary-boss-open`, `summary-need-stars`, `summary-boss-fail`, `summary-misses` and `miss-<itemId>`, **`to-map`**, `review` (when the queue is not empty), `replay` (not for a review round), `finish` (boss beaten with 1+ star).

### `review`
`review-title`, `review-list` / `review-empty`, `review-item-<itemId>` (prompt, answer, explanation), **`practice`** (a round of the queued items), `to-map`.

### `end`
`end-title`, `end-units` (stars per unit and the boss), `end-score`, `end-accuracy`, **`play-again`** (back to the map, progress kept), `to-title`.

### `error`
`error` (`role=alert`): the page has no `#edu-root`, no `EDU_GAME_DATA`, or no shell. Also logged with `console.error`.

## Rules of the quiz arena

- **Round**: `shells.config['quiz-arena'].roundLength` fresh questions (default 7, limits 3-12; fewer when the unit has fewer items), `bossLength` (default 10), `timerSeconds` (default 30, limits 5-120). Questions are picked live: a missed one returns after 2, then 3, then 4 other questions (at most 2 returns); otherwise by the adaptive difficulty (`adaptive.ts`, aiming at 70-85 % success), preferring cards that are due (at most half the round), and not the same kind twice in a row (in a boss round not the same unit either).
- **Stars**: from the first-try accuracy of the fresh questions (partial credit counts: a hard flashcard is 0.6): 1 star from 50 %, 2 from 70 %, 3 from 90 %. Stars never go down. A unit with 2+ stars is mastered and opens the units that require it. The boss opens when every unit is mastered; 1+ star beats it.
- **Review queue**: a miss joins it; it leaves when the item is later answered right in a later round (or at any point in a review round). Cards are SM-2 (`srs.ts`): each answer schedules the item's card (grade again/hard/good/easy; a right answer is good, a typo/accent/partial is hard, a miss is again, a flashcard uses the learner's own grade).
- **Score**: 100 per question (scaled by partial credit) plus a combo bonus (10 per step, up to 10) and, with the timer, 2 per second left; half for a retry.
- **Timer**: off by default (the `setting-timer` checkbox). Never on flashcards, crosswords, word searches or any typed answer (typed, cloze with a typed gap, listening-type). A timeout is a miss with the answer shown.
- **Progress** is in `localStorage` under `edu-studio:progress:<pack.id>`; Export / Import / Reset are on the title screen. An unusable storage never throws: the game plays from memory and `storage-warning` appears.

## Keyboard and accessibility

Everything is a real `<button>`, `<input>` or `<select>`; Tab, Enter and Space work everywhere. Number keys 1-9 pick options (mcq, true-false, multi-select, listening-choose) and 1-4 grade a flipped flashcard (not while typing). Enter or Space on a page with the feedback open continues. Arrow keys move in the crossword and word-search grids (the crossword grid and the word search are each ONE tab stop: Tab enters the grid at the cell last used, Tab again leaves it; the crossword has a whole-word input per clue as well). Focus is moved to the first thing to do on each screen and to `next` after an answer. Every screen has exactly one `h1` (the title, the screen name, or the question; a flashcard has a hidden one). Focus rings are 3 px and follow the theme's `--edu-focus`. Feedback is read through an `aria-live` region; right and wrong are shown with a symbol as well as a colour; inputs have labels. `prefers-reduced-motion` zeroes every duration and stops the shake, glow, pop, burst, star pop and card flip.

Tap targets are at least 44 px, except the cells of the crossword and word-search grids (dense by nature: at least about 22-26 px, above the WCAG 2.2 AA minimum of 24 px at 390 px width for grids up to 14 columns); the crossword has a 44 px whole-word input per clue for phones. No page scrolls sideways from 360 px up.

## Look and theming

The look is the design system of `src/design/` (`docs/design.md`, "Look"): `main.ts` imports `tokens.css`, the chalkboard theme (`themes/chalkboard.css` and its two fonts), `motion.css`, then `base.css`, `items.css` and `arena.css`. The shell puts the class `edu-stage` and `data-edu-theme="chalkboard"` on `#edu-root`; every selector of `items.css` and `arena.css` starts with `.edu-stage` (a test checks it), colours come only from `--edu-*` slots, and the chalkboard extras (wood frame, board noise, chalk underline) are `--chalk-*` variables of the theme file. Chalkboard: Kalam lettering for headings and buttons over Atkinson Hyperlegible Next body text, a wooden frame with a chalk ledge, a board with a smudge and noise texture, coloured chalk for the answers; the new screen is written onto the board from the left behind an eraser smudge, a combo (3, 5, 7, 10 ...) stamps its lettering with a puff of chalk dust, a right answer glows and a wrong one shakes. Motion is switched off under `prefers-reduced-motion` (the durations are 0 and `animation` is `none`).

### Embedding an item in the studio (live preview)

```ts
import '../../player/style/embed.css'   // tokens + chalkboard theme + motion + items.css, no global rules
// ... render an item with a renderer from src/player/items and append view.el to:
// <div class="edu-stage" data-edu-theme="chalkboard"> ... </div>
```

`.edu-stage` is the contract: it sets the body font, text colour, box model and the focus ring for everything inside it, and all item and control styles (`.btn`, `.chip`, `.choice`, `.pair-btn`, `.order-row`, ...) apply only inside it. Wrap the preview in it and the studio's own look is untouched. The arena screens (`arena.css`) are not part of the embed.

### Keyboard and accessibility checks in the bot

`node scripts/play.mjs <build-dir> --mode perfect --keyboard` plays with the keyboard only (`page.keyboard`: Tab and Shift+Tab to reach a control, Enter or Space to use it, arrow keys in the word search, digits for options and grades, typing for text; no element click, no mouse; the summary reports `keyboard.mouseClicks: 0`). It fails when a control cannot be reached with Tab, when the focus is not inside the game after a screen change, when the feedback does not move the focus to `next`, or when a control reached with Tab has no focus outline. `--axe` injects `node_modules/axe-core` into the page and runs it once on every distinct screen, item kind and feedback kind (title, map, each item kind, right and wrong feedback, summary, review, end); a serious or critical violation fails the run and the JSON summary has `axe: { runs, violations: { critical, serious, moderate, minor }, rules, screens, minor }`. The two flags combine with every mode and with `--shots` / `--viewport`. `tests/bot.e2e.test.ts` runs the keyboard mode and axe on both golden fixtures.

## Shells (EGS-10+)

One course plays in every shell it enables (`pack.shells.enabled`). Besides the quiz arena there are five: `encyclopedia` (parchment and brass), `mindmaze` (castle stone), `rpg` (pixel quest), `roleplay` (postcard) and `detective` (noir). They are our own code like the arena: DOM and CSS, Canvas 2D or SVG where a map needs it, no game engine.

### Picking a shell

- `EduEngine.playableShells()` is the course's `shells.enabled` that the bundle has registered, in order (the quiz arena when none is).
- The shell that opens: `?shell=<id>` in the address, else the learner's last choice (`localStorage` key `edu-studio:shell:<pack.id>`), else `GameData.shell` (the first enabled), else the first playable.
- Every title screen has the game-style picker when the course plays in two or more shells: `shell-picker` with one `shell-<id>` button each (`aria-pressed="true"` on the current one). Picking one calls `EduEngine.switchShell(id)`: the shell is unmounted (its key handler and timers stop), the root is cleared, the other one is mounted. Nothing reloads.
- The progress is one store per course (`edu-studio:progress:<pack.id>`): the SM-2 cards, the review queue, the score and the settings are shared by every shell (a fact learned in the castle is due in the arena too). Each shell keeps its own unit stars, its finish flag and its own data in `progress.shells[<id>]` (a castle wing cleared is not a quiz round won); export and import carry it. An old progress file without `shells` still imports.

### The shell kit (`src/player/kit/`)

Every shell after the quiz arena is built on it, so the learning rules and the bot contract are the same everywhere:

| Piece | What it does |
|---|---|
| `ShellSession` (`session.ts`) | The edition (language, the player's words `ui`, the shell's words `s`, text resolver, check context); progress (`sp`, `shellData` / `setShellData`, `unitStars`, `isUnlocked`, `allMastered`, `recordUnit` with stars from first-try accuracy: 1 from 50 %, 2 from 70 %, 3 from 90 %, 2 stars = mastered and unlocks the units that require it; `finish`); `answer()` (shared `checkItem`, the SM-2 card, the review queue, combo, score, steps, the explanatory feedback); runs (`startRun` / `next` / `record` / `accuracy`: the quiz arena's round logic over any pool of items: adaptive difficulty aiming at 70-85 %, a miss coming back after 2-4 other questions, due cards first, no two of a kind in a row); `render(screen, body)` into the standard frame and `publish()` |
| `ask()` (`question.ts`) | The question screen: the same test ids as the arena (`prompt`, `item-body`, the item widgets, `hint`, `feedback`, `feedback-why`, `feedback-answer`, `feedback-explanation`, `feedback-dyk`, `next`, `retry-tag`, `leave`), screen `item` while the question waits and `feedback` after the answer. The shell adds a frame (`hud`: the door, the battle, the speaker), a `lead` line, and what the answer did in its world (`feedback-effect`: "The door swings open", "You lose a torch"). Number keys, Enter on the feedback and the focus work as in the arena |
| `titleScreen()`, `endScreen()` (`screens.ts`) | The shared title (course title, language, game style, start, export / import / reset) and end (stars per unit, score, accuracy, `play-again`, `to-title`) |
| `makeShellUi()` (`strings.ts`) | A shell's own words: an English and a Croatian table in `src/player/shells/<id>/strings.ts`, keys prefixed by the shell; a course overrides any with `ui.<key>` in its catalog |
| `kit.css` | The picker, the frame above a question, the effect line |

A shell module is `src/player/shells/<id>/index.ts` (it imports its theme `src/design/themes/<theme>.css` and its own CSS, so `player.css` carries every look: about 690 KB with the fonts inlined, still one file over `file://`) and registers in `src/player/main.ts`.

### State and screens

Every shell publishes the same `getState()` as the arena, with these rules:

- `screen` is `title`, `item`, `feedback` and `end` as in the arena, and the shell's own screens otherwise (listed per shell below).
- `item` and `feedback` carry `itemId`, `itemKind`, `itemIndex` and `context` (what the question is for: `door`, `battle`, `hunt`, `line`, `clue` ...); `feedback` carries `lastResult`.
- `mastery` is the shell's own unit stars; `reviewQueue`, `score`, `combo` and `steps` are the shared ones; `finished` is true on the end screen.
- `view` is the shell's own JSON state (the room, hit points, the clues found ...), documented per shell.
- `EduEngine.debug.shell` holds the mounted shell's read-only helpers for the bot (a route to the next door, the solution of a case ...); it is cleared on unmount.

The learning rules hold in every shell: every challenge is a retrieval question with explanatory feedback (the why of the chosen distractor, the answer, the explanation, a did-you-know after a right answer); a miss comes back later in the same run and stays in the review queue; units unlock at mastery; a final challenge mixes the units; a wrong answer costs something in the world (a torch, hit points, a wilting plant, a cold trail) but never ends in a dead end.

### The course section of a shell (`src/shared/shells/`)

A shell's authored content is `pack.shells.config[<id>]` (the pack schema is unchanged, so old courses still validate). `src/shared/shells/<id>.ts` defines it (`ShellDef`): the zod schema, the text keys it uses (every visible string is a catalog key, so Book Translator translates it with the rest), the assets it names, its reference checks (validator: `SHELL_SCHEMA`, `UNKNOWN_*`) and its shell lint (codes prefixed `ENC_`, `MAZE_`, `RPG_`, `RP_`, `DET_`, plus `SHELL_UNKNOWN` (warning) and `SHELL_SECTION_MISSING`). `edu_lint` runs it on every build; the text keys of the section are checked per edition like the pack's own (`TEXT_MISSING`, `PLACEHOLDER`).

### The autoplay bot in a shell

`node scripts/play.mjs <build> --mode perfect|wrong|random --shell <id>` opens the game in that shell. `play.mjs` checks the title (and the picker) and hands over to the shell's driver, `scripts/bot/<id>.mjs` (registry `scripts/bot/index.mjs`): it walks the shell's world through test ids and `EduEngine.debug.shell`, and answers every question with the shared `answerCurrent` (the same item widgets and feedback checks as the arena). Each driver documents what perfect, wrong and random mean in its shell and sets its step bound. `--keyboard`, `--axe`, `--shots` and `--viewport` work in every shell.

### The encyclopedia explorer (`encyclopedia`, EGS-10)

Theme `parchment` (parchment and brass, EB Garamond, oxblood rubrics). You browse a printed book: an index of articles in chapters (the units), cross-links in the text, a timeline, a map, and scavenger hunts that send you back into the articles to find the answers. Pages turn (the theme's `edu-enter-page` on the page content; the index tabs stay put), a drop cap opens every article, and the clue of a hunt is a slip of paper pinned with a brass pin on every page. No images beyond the course's own: the title book and the seal are drawn in CSS; `prefers-reduced-motion` turns every animation off.

#### Screens (`getState().screen`) and test ids

Every world screen has the tabs (`nav-index`, `nav-timeline` and `nav-map` only when the course has events / an image, `nav-codex`, `nav-hunts`, and `menu` for the title page). While a hunt is on, the pinned clue is on all of them: `clue-bar` (`data-step`), `clue` (the riddle), `clue-retry` (a missed step coming back), `clue-drop` ("Put the hunt aside").

| Screen | What it is | Test ids |
|---|---|---|
| `title` | the kit's title with a closed book as art | kit ids (`start` reads "Open the book" / "Continue reading", `course-title`, `shell-picker` ...) |
| `explore` | the home: masthead (the course title, h1), status line, search, the plate (the first image), the index in chapters. A locked chapter's articles stay readable: reading is free, the hunts are gated | `explore-title` (h1), `status` with `status-found`, `status-stars`, `status-read`, `search` (input; Enter opens the first hit), `search-status` (live), `search-results`, `result-<articleId>`, `plate`, `chapter-<unitId>` (`data-locked`), `chapter-locked-<unitId>`, `chapter-other` (articles of no unit), `article-<articleId>` (`data-read`) |
| `article` | one article as a spread: the text page (running head, title h1, the collect seal when this page answers the pinned clue, the body with cross-links) and the plate page (figure with its alt as caption, the audio slot when the article has an audio asset, "See also", the sources) | `article` (`data-article`), `article-title` (h1), `article-body`, `article-figure`, `article-audio` (only with an audio asset), `link-<articleId>` (first mention of another article's title in the body: longest title first, whole words, case-insensitive), `related`, `related-<articleId>`, `citations`, `citation-<factId>`, `citation-link-<factId>` (opens in a new tab, `rel="noopener noreferrer"`), `back` (the screen you came from: the index, the timeline, the map, the codex, another article), `collect-<stepId>` |
| `timeline` | events on a ruler true to scale in a box that scrolls inside itself (cards above and below with leader lines); the focus moves between cards with the arrow keys, Home and End; the detail line follows the focus | `timeline-title` (h1), `timeline`, `event-<eventId>` (`data-year`, `data-article`, `data-lane`), `event-detail` (`data-event`) |
| `map` | the image with brass rings at the pins (x / y in image pixels, drawn as percentages; the map keeps a width at which the two nearest pins stay a tap apart and scrolls inside its box on a phone); the arrow keys move between pins; the same places as a list under it | `map-title` (h1), `map`, `place-<placeId>` (`aria-label` = the name; the name shows on hover and focus), `places`, `place-link-<placeId>` |
| `codex` | the collectibles of the hunts: name, the fact it taught (the item's did-you-know, else its explanation), a link to the article; the ones not found yet are "?" | `codex-title` (h1), `codex-count` (`data-found`, `data-total`), `codex-empty`, `codex-<stepId>` (`data-found`), `codex-link-<stepId>` |
| `hunts` | one card per hunt under its chapter (stars per unit), the grand hunt, the result of the hunt just played | `hunts-title` (h1), `hunt-result` (`data-stars`, `data-collected`, `data-total`, `data-final`) with `hunt-result-stars`, `hunt-chapter-<unitId>`, `hunt-stars-<unitId>`, `hunt-<huntId>` (`data-locked`, `data-stars`, `disabled` while locked), `hunt-locked-<huntId>`, `hunt-chapter-final`, `hunt-final`, `hunt-stars-final`, `hunt-locked-final`, `finish` (once the grand hunt has a star) |
| `item`, `feedback` | the kit's `ask()`, context `hunt`; the hud is the hunt, the clue number and one brass pip per collectible (the pip fills when it is collected) | kit ids, `hunt-hud`, `leave` ("Back to the article"), `feedback-effect` ("Collected: ... It is in your codex." / "Not collected yet. Read the article again: the clue comes back.") |
| `end` | the kit's end screen after `finish`, plus the count of collectibles and articles read | kit ids, `end-collected` |

#### The hunt loop (the question is about the article you found)

1. A hunt (one per unit, authored or automatic) pins its first clue (the riddle) on every page.
2. Browse, search or follow links. On the target article the seal `collect-<stepId>` appears ("This page answers your clue").
3. Collect asks the step's item (`ask()`, context `hunt`; `leave` goes back to the article). Right: the collectible joins the codex, the next clue is pinned and you land on the article you just read. Wrong: the feedback explains, the step stays open and comes back as a retry (the shared run logic: a miss returns after 2-4 other questions, at most twice more; `clue-retry` marks it and the seal says "Back again. Read this page more closely."). A hunt always ends: after the retries it is over with fewer stars and can be hunted again; nothing is a dead end.
4. When the run is over, `recordUnit` gives the stars from the first-try accuracy (1 from 50 %, 2 from 70 %, 3 from 90 %); 2+ stars master the unit and open the hunts of the units that require it (`hunt-result` says which). The best run counts.
5. The grand hunt (`hunt-final`) opens when every unit is mastered and mixes the first and the last step of every unit's hunts (a boss run); 1+ star offers `finish` -> `end`.

#### `view` (JSON-safe, on every world screen)

`{ found: [stepId], read: [articleId], counts: { found, total, stars, maxStars, read, articles }, hunt: null | { id, final, step, article, item, retry, answered, size, collected: [stepId] } }`, plus per screen: `explore` `query`; `article` `article`; `timeline` `event`; `hunts` `result` (`{ huntId, final, stars, accuracy, collected, total, unlocked }` or null); `item` / `feedback` `step`, `article`. The found steps and the articles read are saved in `progress.shells.encyclopedia.data` (ids the course no longer has are dropped on load).

#### Debug helpers (`EduEngine.debug.shell`, read-only)

- `hunts()`: `[{ id, unit, open, stars, steps: [{ id, article, item }] }]`; `finalHunt()`: `{ open, steps }`.
- `target()`: the pinned step or null: `{ hunt, final, step, article, item, retry, clue, term, via }`; `term` is a short query that finds the article by its title, `via` is `{ from, testid }` (the article to open and the `link-<id>` / `related-<id>` to press to reach the target by a link) or null.
- `searchTerm(id)`, `links(id)` (`{ links, related }`), `articles()`, `timeline()`, `places()`, `codex()` (`[{ id, found }]`), `queue()` (the review queue).

#### Rules of the shell

- Every challenge is an `ask()` with the kit's explanatory feedback; picking, retries and stars are the shared run logic (`startRun` / `next` / `record` / `recordUnit`).
- Cross-links are computed from the article titles of the edition being read (so the Croatian edition links "Beč", not "Vienna"); search ignores case and accents and finds titles first, then body sentences.
- Reading is free (a locked chapter's articles open), the hunts are gated by mastery; the question IS the page you found (the lint warns when a step's right answer is not in its article).
- Colours only from the parchment theme's `--edu-*` slots; focus ring 3 px (`--edu-focus`); every control is a `<button>` / `<input>` / `<a>`; 44 px targets (inline cross-links in running text excepted); no horizontal scroll from 360 px (the timeline and the map scroll inside their own box); no text under 13 px; no external URL except the sources a course cites (opened in a new tab).

#### The course section `pack.shells.config.encyclopedia` (all of it optional)

```jsonc
{
  "timeline": [{ "id": "t-voyager", "year": 1977, "label": "enc.t.voyager", "text": "enc.t.voyager.text", "article": "art-giants" }],  // year < 0 is BC, no year 0
  "map": { "asset": "img-solar-system", "width": 800, "height": 300, "places": [{ "id": "p-sun", "x": 60, "y": 150, "label": "enc.p.sun", "article": "art-sun" }] },
  "hunts": [{ "id": "h-sun", "unit": "u-sun-planets", "title": "enc.h.sun.title", "intro": "enc.h.sun.intro",
              "steps": [{ "id": "s-sun-star", "clue": "enc.h.sun.s-sun-star.clue", "article": "art-sun", "item": "q-sun-mcq", "collectible": "enc.h.sun.s-sun-star.name" }] }]
}
```

Every text value is a catalog key (so Book Translator translates it); step ids are unique across all hunts. A part that is missing falls back to the automatic layout (or is hidden): without `hunts`, one hunt per unit whose steps are the unit's articles (at most 6; a unit without articles gets one built from each objective and its facts), each asking an item of the objective that cites a fact the article cites ("Find the article about ..."); without `timeline`, the dated entries of `order` items with `timeline: true`, linked to the article that names them; without `map`, the first image asset with no pins (the `map` tab is hidden when the course has no image). Courses play without the section (`requiresSection: false`).

#### Lint codes (`src/shared/shells/encyclopedia.ts`)

Validator: `UNKNOWN_UNIT` (a hunt's unit), `DUPLICATE_ID` (hunts, events, places, steps), `UNKNOWN_ASSET` (the map's asset), `MISSING_TEXT` (a catalog key without a string, checked per edition).
Lint errors: `ENC_HUNT_TARGET_MISSING`, `ENC_HUNT_ITEM_MISSING`, `ENC_HUNT_ITEM_DUPLICATE` (two steps of a hunt ask the same item: the second could never come up), `ENC_UNIT_NO_HUNT` (a unit no hunt covers could never be mastered), `ENC_HUNT_EMPTY`, `ENC_TIMELINE_ARTICLE_MISSING`, `ENC_MAP_ARTICLE_MISSING`, `ENC_MAP_PLACE_OUTSIDE`, `ENC_MAP_NO_IMAGE`.
Warnings: `ENC_ANSWER_NOT_IN_ARTICLE` (the right answer of a step's item, by option text, canonical typed answer, cloze gaps, flashcard back or hotspot label, is not in the target article in some edition; words are matched by stem, so Croatian inflection passes; true / false, multi-select and ordering kinds are skipped), `ENC_HUNT_ITEM_OTHER_UNIT`.
The automatic layout is linted too.

#### The bot driver (`scripts/bot/encyclopedia.mjs`)

- `perfect`: every unit's hunt in prerequisite order to 3 stars, then the grand hunt and `finish` -> `end`. Per clue it reads the pinned clue, reaches the target article by search + a click on the result, by the index, by search + Enter, or by a cross-link / "See also" (in turn), presses `collect-<step>` and answers right. It also searches for nonsense (no results, `search-status` says so), reads a locked chapter's article, checks every article page once (title, body, `link-*` for every mention, `related-*`, `citation-*`, the figure, no audio slot without audio, new-tab citation links), uses Home / End / the arrow keys on the timeline and the arrow keys on the map, opens an event and a place (and one place from the list), and counts the codex (empty at the start, every collectible after the unit hunts). The page content must animate with `edu-enter-page`.
- `wrong`: every answer wrong (`--rounds N` plays each open hunt N times; runs with `prefers-reduced-motion: reduce`, and checks that nothing animates). The clue stays pinned, the target article and its `collect-<step>` are always there, a missed clue comes back (more answers than steps), the codex stays empty, the review queue fills, the hunt ends with 0 stars and can be played again, the other chapters and the grand hunt stay locked, `finish` never shows.
- `random`: a seeded learner (`--accuracy`) hunts until every unit is mastered (2+ stars), then the grand hunt until it earns a star, within `maxSteps = ceil(6 * (steps of all hunts + 2 * units) * factor) + 20` (reduced motion, like `wrong`).
- `--keyboard`, `--axe`, `--shots` and `--viewport` work as in every shell. The summary adds `encyclopedia: { hunts, steps, search, searchEnter, index, crossLinks, related, articlesChecked, events, places, collectibles, locked, reducedMotion }`.

### The MindMaze castle (`mindmaze`, EGS-11)

Theme `castle` (castle stone and torchlight: Cinzel titles over Alegreya, torch amber, ember). You walk a castle: every unit is a WING of rooms, every door is a question, the characters in the rooms help, every wing hides a key, and the keys open the throne room. Pictures are inline SVG (`art.ts`), no image files; the torch flicker is the only animation and it stops under `prefers-reduced-motion`.

#### Screens (`getState().screen`) and test ids

| Screen | What it is | Test ids |
|---|---|---|
| `title` | the kit's title with the castle gatehouse as art | kit ids (`start`, `course-title`, `shell-picker` ...) |
| `castle` | the overview: a mini-map of the castle (towers), the throne room, one card per wing in rows by prerequisite | `castle-title` (h1), `castle-keys` ("Keys: 1 of 3"), `castle-map` (SVG), `wing-map` (the list of rows), `wing-<wingId>` (`data-locked`, `data-stars`, `data-key`, `data-unit`, `data-requires`; `disabled` while sealed), `throne` (`data-locked`, `data-stars`; `disabled` until every wing has its key), `menu` |
| `room` | you stand in a room: name (h1), description, the character, the doors, the torches, the wing's map | `room-name` (h1), `room-desc`, `doors`, `door-<toRoomId>` (`data-state` = `locked` or `open`, `data-key="true"` when the key room lies beyond), `back` (to the room you came from), `to-castle`, `wing-tag`, `torches` (`data-torches`, `data-max`, a flame per torch), `minimap` (SVG: rooms, locked and open doors, you are here), `minimap-list` (the same map as a numbered list), `character-name`, `talk` (shows `character-line`), `hint` (shows `character-hint`), `character-reaction` (after an answer), `notice` (the ghost scene), `take-key` (in the key room) |
| `item`, `feedback` | the kit's `ask()`; context `door` (the hud shows the carved door and the torches) | kit ids, `leave` ("Step back"), `feedback-effect` ("The door swings open." / "Your torch gutters: 2 left." / "Your last torch dies. The castle ghost leads you back ...") |
| `wing-done` | the wing's summary after `take-key`: stars (first-try accuracy of the wing's doors), the key won at 2+ stars or the wing crumbling | `wing-title` (h1), `wing-stars`, `wing-accuracy`, `wing-key` or `wing-crumble`, `wing-unlocked` (the wings this one opened), `throne-open`, `wing-misses` and `miss-<itemId>`, `to-castle`, `retry-wing` (below 3 stars) |
| `throne` | `view.phase` `intro` (`throne-title` h1, `throne-stars`, `throne-begin`, `finish` once crowned, `to-castle`) and `result` (`throne-title`, `throne-stars`, `throne-accuracy`, `throne-lost`, `throne-misses`, `finish` when won, `retry-throne`, `to-castle`); its questions are `item` / `feedback` with context `throne` and round kind `boss` | |
| `end` | the kit's end screen after `finish`, plus `end-keys` | kit ids |

#### The door loop (the door IS the question)

- Entering a wing starts a WALK: one run of the shared round logic (`session.startRun`) over the pool of every door of the wing. Each locked door asks the next question of the run from ITS OWN pool (`pickForDoor` in `walk.ts`): a missed question whose gap has passed comes first, then a fresh item of the door, then any fresh item of the wing, and when the run is used up a practice question from the door's own pool (a retry: no stars, half points). A door never has nothing to ask.
- Right: the door swings open and stays open for this walk, you walk through (the feedback's `next` goes to the next room); the character cheers on a streak. Wrong: the feedback explains (the why of the chosen distractor, the answer, the explanation); a torch goes out (`feedback-effect`), the door stays shut and asks a different question next time (the missed one returns after 2-4 others).
- With 0 torches the castle ghost leads you back to the wing's entrance hall and relights the torches (`view.ghost` true, `notice` shown until your next answer or step). The opened doors stay open. You are sent around, never locked out.
- `back` retraces the way you came for free; an open door is walked through without a question (`door-<to>` `data-state="open"`, a check mark).
- The key room has `take-key`: the wing's stars come from the first-try accuracy of the answers of the walk (`session.recordUnit`: 1 star from 50 %, 2 from 70 %, 3 from 90 %). 2+ stars win the key (mastery: the wings of the units that require it unlock). Fewer: "Walk the wing again" (`retry-wing`: a fresh walk, the doors shut again).
- The throne room opens when every wing holds its key. The gauntlet is a boss run (`size` questions, default 8, from every unit's items, misses return); every wrong answer puts a torch out and the last torch is relit at once (the gauntlet is never lost, only harder to earn stars in). 1+ star wins the crown, then `finish` goes to `end`.
- Keyboard: Tab / Enter reach everything; in a room the number keys 1-9 walk through the n-th door. A door's question also has `leave` ("Step back") that returns to the room unanswered.

#### `view` (JSON-safe)

- `castle`: `{ wings: [{ id, unit, stars, locked, key, walking }], keys, total, throneOpen, crowned }`
- `room`, `item`, `feedback` of a door: `{ wing, unit, room, entry, keyRoom, torches, maxTorches, trail, open, doors: [{ to, state }], ghost, mood, answered }`
- `wing-done`: `{ wing, stars, key, accuracy, unlocked, misses }`
- `throne`: `{ phase: 'intro' | 'question' | 'result', torches, maxTorches, size, asked, crowned, stars?, accuracy?, misses? }`
- `end`: `{ keys, total, crowned }`

#### Debug helpers (`EduEngine.debug.shell`, read-only)

- `route()`: `{ wing, room, found, path, locked, door, state, takeKey }`, the next door on the cheapest way from the room you stand in to the key room (a shut door costs 1, an open door almost nothing, so open doors come first; ties keep the author's order of doors); `door` is the test id to press, `null` in the key room (`takeKey` true) or when no route exists.
- `view()`: the room view above (null outside a walk).
- `maze()`: `{ torches, throne, wings: [{ id, unit, entry, auto, rooms, keys, doors, solvable }] }`, the shape of the castle (`doors` = doors on the shortest route).

#### The course section `pack.shells.config.mindmaze` (optional)

```jsonc
{
  "torches": 3,                         // 0-9, default 3; a wrong answer puts one out
  "wings": [{
    "id": "w-sun", "unit": "u-sun-planets", "name": "maze.w.w-sun", "description": "maze.w.w-sun.desc",
    "entry": "sun-hall",
    "rooms": [
      { "id": "sun-hall", "name": "maze.r.sun-hall", "description": "maze.r.sun-hall.desc",
        "character": { "name": "maze.c.sun-hall.name", "line": "maze.c.sun-hall.line", "hint": "maze.c.sun-hall.hint",
                       "right": "maze.c.sun-hall.right", "wrong": "maze.c.sun-hall.wrong", "portrait": "maze-astronomer" },
        "doors": [{ "to": "sun-orrery", "items": ["q-order-mcq", "q-order-card"] }] },
      { "id": "sun-orrery", "name": "...", "objective": "obj-sun", "doors": [...] },
      { "id": "sun-key", "name": "...", "key": true, "asset": "maze-lens-room" }
    ]
  }],
  "throne": { "name": "maze.throne", "description": "maze.throne.desc", "size": 8 }   // size 3-20, default 8
}
```

Every text is a catalog key (names, descriptions, the character's `line` / `hint` / `right` / `wrong`); `portrait` and `asset` name pack assets. A door lists `items` (its question pool); a door with none takes the items of the objective of the room beyond (`objective` on that room). A door is one way: it leads from its room to `to`. The character's `hint` is what `hint` shows for the doors of the room (missing: the hints of the items its shut doors ask); `right` and `wrong` are their reactions (missing: the shell's own). Without a section, or for a unit no authored wing covers, the shell builds the wing itself (`autoWing`): an entrance hall (the gatekeeper), one room per objective that has items (named after the objective's text, characters alternate), galleries when the route would be shorter than 4 doors, a key room, and one side chamber that gives a second route; every door asks the items of the objective of the room beyond. Wings are shown in the order of the units' prerequisites.

#### Lint codes

Validator (block the build): `MAZE_WING_UNIT_MISSING`, `MAZE_ENTRY_MISSING`, `MAZE_DOOR_TARGET_MISSING`, `MAZE_DOOR_ITEM_MISSING`, `MAZE_OBJECTIVE_MISSING`, `MAZE_DUPLICATE` (a wing, a room or a door twice). Lint (errors): `MAZE_UNIT_NO_WING` (a unit no authored wing covers; the castle still builds an automatic wing for it), `MAZE_DOOR_NO_ITEMS`, `MAZE_ROOM_UNREACHABLE` (BFS from the entrance), `MAZE_NO_KEY_ROOM`, `MAZE_KEY_UNREACHABLE`, `MAZE_KEY_AT_ENTRY` (no door would ask anything), `MAZE_DEAD_END` (a room from which no key room can be reached). Warnings: `MAZE_DOOR_ITEM_OTHER_UNIT`, `MAZE_TOO_FEW_TORCHES` (under 1). The automatic layout is linted too (a course with the shell enabled and no section). Text keys of the section are checked per edition like the pack's own.

#### Bot driver `scripts/bot/mindmaze.mjs`

`maxSteps` = ceil((30 per unit + 4 per throne question) * factor) + 20. The driver adds `summary.maze` = `{ wings: { <wingId>: bestStars }, doors, questions, ghosts, keys, backs, digitDoors, shape }`.

- `perfect`: every wing in prerequisite order to 3 stars (a wing whose unit needs another starts sealed, the throne starts sealed, the torches never drop, no ghost; once per wing it steps `back` through a door it opened and forward again without a question), then the throne gauntlet (`finish`) and the end screen; the review queue ends empty.
- `wrong`: every door of the first wing answered wrong: the torches go out one by one, the last sends the ghost (screen `room`, `view.room` = the entrance, `view.ghost`, the `notice`, the torches relit), the door still asks (`--rounds N` more ghost scenes, default 1 so 2 in all), the review queue fills, no key is won, the other wings and the throne stay sealed. It cannot finish.
- `random`: a seeded learner (`--accuracy`) wins every wing to mastery (2 stars; a wing that crumbles is walked again) and then the crown (a gauntlet that gives no star is faced again), within `maxSteps`.
- `--keyboard`: Tab / Enter reach every control, the number keys walk through the doors (the door you step back through again, and every other open door). `--axe`: runs on `castle`, `room`, `room-key`, `room-ghost` (wrong mode), `wing-done`, `castle-keys`, `castle-after` (wrong mode), `throne-intro`, `throne-result`, `end`, every item kind and every feedback kind.
