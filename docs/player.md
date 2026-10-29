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
