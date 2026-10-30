# EGS-13: language role-play and the vocabulary garden

Hub plan HUB-19 phase 5, fourth shell. Branch `EGS-13_roleplay`, stacked on `EGS-12_rpg`. One commit (orchestrator). Built in parallel with the other shells in one checkout against `../EGS-10-encyclopedia/shell-contract.md` and `docs/player.md`, "Shells".

Inspired by the sibling repo `lang-combat` (READ ONLY: a German text adventure where you act by typing German; each floor unlocks one grammar point) and Duolingo stories. Learning rules for languages: comprehensible input just above the level (i+1), vocabulary in context and not in lists, listening in the target language, production by typing, CEFR levels shown throughout.

## New theme `postcard`

Add `src/design/themes/postcard.css` and its entry in `src/design/themes/index.ts` (at the end of `THEMES`, between `// @EGS-13-begin` / `// @EGS-13-end` lines; `ThemeId` already lists it): a travel postcard / Adriatic café look (sea blue, terracotta, cream paper, a stamp, handwritten speaker names), light scheme, fonts already bundled in `src/design/fonts/` only (for example Young Serif for titles and Atkinson Hyperlegible Next for text; no new font download). Fill every colour and font slot of `tokens.css`; `tests/design-tokens.test.ts` checks the contrast pairs of every registered theme: make it pass. Give the shell `theme: 'postcard'`.

## Screens (`getState().screen`)

- `title` (kit), with the CEFR level badge (`cefr`) and the target language.
- `scenes`: the scene list by unit (`scene-<sceneId>`, locked until the units it requires are mastered, stars, the CEFR level of each scene), the garden (`to-garden`).
- `scene`: a dialogue in the target language: speech bubbles in order, the speaker's name and portrait slot; each line in the target language with `translate-<lineId>` (shows the edition's translation under it; hidden by default: input first) and `line-play-<lineId>` (plays its audio clip when the line has one: a TTS slot that phase 6 fills; without a clip the button is not drawn). `scene-next` reveals the next line. The learner's turns are questions.
- `item` / `feedback` (kit `ask()`, context `line`): the learner's reply, by choosing or by TYPING in the target language (the shared tolerant matcher: accents, one typo, synonyms from the `accepted` lists; the special letters č ć š ž đ under the input). The hud shows the last line said to you. Right: your reply appears as your bubble and the other speaker answers. Wrong: the feedback explains, the other speaker helps (a recovery line: says it again more slowly or rephrases, from the section, else from the shell's strings) and the same turn is asked again later with the item as a retry (or another item of the same objective); after the retries the scene goes on with the right reply shown: never a dead end.
- `scene-done`: stars (first-try accuracy of the scene's turns), the words it planted in the garden, the scenes it unlocked.
- `garden`: the vocabulary garden (spaced repetition): one plant per word or phrase (`plant-<wordId>`), its growth stage from the SM-2 card of its item (seed: never answered; sprout: learning; bud: young; bloom: mature, from `mastery(card)` in `src/shared/edu/srs.ts`; a missed item's plant wilts). `water` practises the due words (a run over the due and queued items, context `garden`); plants grow with recall. Each plant shows the word, its gloss in the edition and the line it was met in (vocabulary in context).
- `end` (kit) after the final scene (a conversation mixing every unit: boss).

## Course section `shells.config.roleplay` (required: `requiresSection: true`)

```jsonc
{
  "speakers": [{ "id": "ana", "name": "rp.sp.ana" }, { "id": "you", "name": "rp.sp.you", "learner": true }],
  "scenes": [{ "id": "sc-cafe", "unit": "u-greet", "title": "rp.sc.cafe.title", "setting": "rp.sc.cafe.setting", "cefr": "A1",
    "start": "l1",
    "lines": [
      { "id": "l1", "say": "ana", "text": "rp.sc.cafe.l1", "translation": "rp.sc.cafe.l1.tr", "audio": "rp-aud-l1", "next": "l2" },
      { "id": "l2", "reply": "g-hello-typed", "help": "rp.sc.cafe.l2.help", "next": "l3" },
      { "id": "l3", "say": "ana", "text": "...", "next": null }
    ] }],
  "garden": [{ "id": "w-dobar-dan", "text": "rp.w.dobar-dan", "gloss": "rp.w.dobar-dan.gloss", "item": "g-hello-typed" }],
  "finale": "sc-final"
}
```

`text` keys live in the TARGET language catalog (for `hr-a1-greetings`: `text/hr.json`); `translation`, `gloss`, `help`, titles and settings in the editions.

## Lint codes (`RP_`)

`RP_UNIT_NO_SCENE`, `RP_SCENE_UNIT_MISSING`, `RP_START_MISSING`, `RP_NEXT_MISSING` (a `next` to no line), `RP_NO_END` (a path from the start that never reaches `next: null`: a cycle with no exit), `RP_LINE_UNREACHABLE`, `RP_SPEAKER_MISSING`, `RP_REPLY_ITEM_MISSING`, `RP_SCENE_NO_REPLY` (a scene with no learner turn: no retrieval), `RP_GARDEN_ITEM_MISSING`, `RP_FINALE_MISSING`; warnings `RP_TEXT_NOT_TARGET` (a `text` key missing from the target-language catalog of a language course), `RP_REPLY_NOT_PRODUCTION` (a unit whose replies are all multiple choice: no typed production), `RP_CEFR_ABOVE_COURSE`.

## Fixtures

`hr-a1-greetings` (edition en, target hr, A1): a scene per unit (meeting Ana at a café in Zagreb; introducing yourself at a language school in Split; polite phrases and ti/Vi at a hotel desk), a finale, the garden words of the course; replies use the course's items (typed answers for production, mcq and listening for the rest). Natural, correct Croatian (A1), short lines; note in your plan that native review is welcome. The audio slots stay empty (no fake speech): the `line-play` buttons appear only where an audio asset exists (`rp-aud-*` none for now; the course's existing placeholder clips may be used for the two lines they stand for only if the alt text says so).

## Bot driver `scripts/bot/roleplay.mjs`

perfect: each unit's scene in order (reveal lines with `scene-next`, open one translation per scene, answer every reply right), the garden (water until nothing is due), the finale, `end`. wrong: every reply wrong: the recovery lines appear, the scene still ends (no dead end) with 0 stars, the next scenes stay locked, the review queue fills, the garden plants wilt. random: finish within the bound. Keyboard mode (typing with page.keyboard), axe on every distinct screen.

## Done when

The common checks of `shell-contract.md` pass for `hr-a1-greetings`, with screenshots in `.claude/temp/screens/phase5/roleplay/`.

---

## Results (implementation run, 2026-10-30)

Branch note: built in the shared WIP tree on `EGS-10_encyclopedia` without commits; the orchestrator moves the files to `EGS-13_roleplay`.

### Checklist

- [x] Theme `postcard`: `src/design/themes/postcard.css` + the registry entry between `// @EGS-13-begin/end` (found there, kept), contrast checks pass (`tests/design-tokens.test.ts`: all green with the postcard theme and the shell stylesheets). Change made in this run: the faint postmark in the corner is drawn on `title`, `end` and `scene-done` only (it sat under the top-right buttons of the other screens).
- [x] Course side `src/shared/shells/roleplay.ts` (found, reviewed): schema, `textRefs`, `assetRefs`, duplicate-id `validate`, `lint` with every `RP_` code of the plan (11 errors + 3 warnings), `walkScene`, `isProduction`. No change needed.
- [x] Player parts `art.ts`, `dialogue.ts`, `garden.ts`, `strings.ts` (found, reviewed, kept; 4 keys added to `strings.ts`).
- [x] NEW `src/player/shells/roleplay/board.ts` (pure: which scenes are locked, what a scene opened), `index.ts` (the shell, replaces the stub; theme `postcard`), `roleplay.css`.
- [x] Screens: `title` (CEFR stamp + target language), `scenes`, `scene`, `item`/`feedback` (context `line`; context `garden` for the watering), `scene-done`, `garden`, `end`. Test ids and `view` in `player-doc.md`.
- [x] Fixture `hr-a1-greetings`: the section and `rp.` text reviewed and changed ONLY through `.claude/temp/fixture-section.mjs` (part source `.claude/temp/fixtures/roleplay/hr-a1-greetings.json`, generated by `make-hr-a1-greetings.mjs`). Edits: no spoken line gives its own answer away any more (Ana greets with "Dobro došli!", "Već je večer.", "Sada zatvaram kafić. Idem kući."; Ivan "Dobro došli! Već je večer.", Luka "Brod ide! Moram ići."); a Croatian slip fixed ("Ja sam dobro" became "Super! Reci to cijelom rečenicom."; "Evo vaš ključ" became "Ovo je vaš ključ."); the hints no longer repeat the "says it again, slowly" lead the shell adds. **Native review of the Croatian is welcome** (the course itself writes "Dobra večer", which the lines follow).
- [x] Bot driver `scripts/bot/roleplay.mjs` (replaces the 2-line stub): perfect / wrong / random, keyboard mode types with `page.keyboard`, axe on every distinct screen.
- [x] Unit tests (node): `tests/player-roleplay-logic.test.ts` (24 tests: dialogue walker, recovery and retries, stars from the first try, listen lines, reply text, scene board / locks, garden stages from SM-2 cards, watering pool, "met in" line); `tests/roleplay-lint.test.ts` (6 tests: golden fixture clean, shell not linted without its section, broken fixture codes, every `RP_` code documented, schema defaults).
- [x] Broken fixture `tests/fixtures/courses/broken-roleplay/` (`course/` + `EXPECTED.md`): all 14 `RP_` codes fire, plus `DUPLICATE_ID` (blocks the normal build) and the two `PLACEHOLDER_ASSET` warnings of the original clips. Source script: `.claude/temp/roleplay-make-broken.mjs`.
- [x] `tests/bot-roleplay.e2e.test.ts` (5 tests, fixed seeds): perfect, keyboard + axe, wrong + axe, wrong, random.
- [x] Screenshots (1280x800 and 390x844) in `.claude/temp/screens/phase5/roleplay/hr-a1-greetings-desktop/`, `.../hr-a1-greetings-mobile/` and `.../hr-a1-greetings-garden/` (a seeded progress showing every plant stage). All looked at; fixes made from them: postmark off the buttons, duplicated "says it again" text in the help bubble, translate button hidden on a still-hidden listen line, bigger plant pots, faux-bold word text.
- [x] `player-doc.md` written (the section for `docs/player.md`).

### Verification (evidence)

| Check | Result |
|---|---|
| `tsc -p tsconfig.player.json` | 0 errors |
| `tsc -p tsconfig.node.json` / `.web.json` | 0 errors in any roleplay file (the node config shows DOM errors from `tests/player-rpg-logic.test.ts`, which imports the kit: not this ticket); web: 0 |
| eslint on `src/player/shells/roleplay`, `src/shared/shells/roleplay.ts`, `scripts/bot/roleplay.mjs`, the 3 test files | 0 problems |
| `vitest run tests/player-roleplay-logic.test.ts tests/roleplay-lint.test.ts` | 30 / 30 passed |
| `vitest run tests/design-tokens.test.ts tests/edu-lint.test.ts tests/edu-course.test.ts tests/player-shell-kit.test.ts` | 354 / 354 passed in 6 files (these four plus the two roleplay files above); hr-a1-greetings still lints with 0 errors and only the 2 placeholder-audio warnings |
| `vitest run tests/bot-roleplay.e2e.test.ts` (own bundle `EDU_TEST_PLAYER_OUT=.claude/temp/roleplay-player`) | 5 / 5 passed, 149 s |
| lint of `hr-a1-greetings` | 0 errors; warnings: only the 2 `PLACEHOLDER_ASSET` (the fixture's beep clips, named in the line `audio` slots on purpose) |

Bot table (`hr-a1-greetings`, 1280x800, built player):

| Mode | Seed | Pass | Console errors | Steps (answers) | Notes |
|---|---|---|---|---|---|
| perfect | 1 | yes | 0 | 23 (23 right, 0 wrong) | 4 scenes (3 + finale), 27 lines, 4 translations, 2 clips, 13 of 13 plants grown, end reached |
| wrong | 2 | yes | 0 | 30 (0 right) | first scene only (others locked), 8 recovery lines seen, 4 of 4 turns showed the right reply, 0 stars, plants wilted, a wrong watering run |
| random (75 %) | 7 | yes | 0 | 54 (35 right, 19 wrong), bound 315 | 6 scenes played (replays to mastery), 15 recovery lines, 2 watering runs, end reached |
| perfect + keyboard + axe | 1 | yes | 0 | 23 | 0 mouse clicks, 66 key presses, 107 focus checks, 119 focus-ring checks; axe 21 runs: 0 critical, 0 serious, 0 moderate, 0 minor |
| wrong + axe | 5 | yes | 0 | 30 | axe 18 runs: 0 violations |

Mobile (390x844) perfect and wrong: both pass, no horizontal overflow (`overflowCheck` on every screen), 0 console errors.

### Deviations from the plan text

1. **Retry of a missed turn**: the plan says the same turn is asked again "later" (or another item of the objective). A conversation cannot move on without your answer, so the turn comes again right after the speaker's recovery line (up to 3 answers in all, then the right reply is shown and the scene goes on). Only the first answer counts for the stars; later answers earn half points; the item stays in the review queue and its plant wilts, so the spaced repetition of the garden brings it back later.
2. **Scene ids** of the fixture are `cafe`, `school`, `hotel`, `final` (the plan's example used `sc-cafe`); the garden has 13 words.
3. **Audio slots**: the plan wanted none; the section names the course's two existing placeholder clips (`aud-dobar-dan`, `aud-zovem-se-ana`) on the two lines they stand for, which the plan allows because their alt text says they are placeholder tones. No `rp-aud-*` assets. A line without a clip has no `line-play` button.
4. **Locks look through scene-less units** (`board.ts`): a unit without a scene never blocks the next; what it requires is needed instead.
5. A listen line that is still hidden shows no translate button (it would give the answer away); when the next question is a listening item the hud omits `line-play` (the item has its own player).
6. Typing, tolerant matching and the special-letter keys (`č ć š ž đ`) are the shared item renderers' (`typed`, `cloze`, `listening`), reached through `ask()`; nothing was duplicated in the shell.

### Not done / not verified

- UNTESTED: sound (the clips are placeholder beeps; `line-play` was pressed, no audible check), real screen readers, Safari and Firefox (Chromium only), a real touch device (390 px viewport emulation only).
- NOT DONE: audio recordings for the lines (phase 6, text-to-speech fills the `audio` slots); native review of the Croatian.
- The full `yarn test` was not run (the brief reserves it for the orchestrator).

## Orchestrator check (2026-10-30)

Committed alone on branch `EGS-13_roleplay` (one commit, stacked; not pushed). This ticket's tree, checked in a clean worktree: `yarn typecheck` 0 errors, `yarn lint` 0 problems, `yarn test` 59 files, 1073 tests passing (the shell list in `tests/player-shell-kit.test.ts` is written per ticket). Changelog: `changelog.md`.
