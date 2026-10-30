# EGS-13 changelog

## 2026-10-30 — EGS-13: language role-play and the vocabulary garden

Outcome: the role-play shell, with the new `postcard` theme, plays `hr-a1-greetings`. You reply to the other speaker by choosing an answer or by typing Croatian, and the vocabulary garden grows from SM-2 recall. The bot passes the perfect, wrong and random runs, keyboard-only play and axe-core. No human has played it, and no native speaker has reviewed the Croatian.

### Repository `edu-game-studio`, branch `EGS-13_roleplay` (stacked on `EGS-12_rpg`)

- **Theme `postcard`.** `src/design/themes/postcard.css` is new and registered in `src/design/themes/index.ts`, and has preview entries in `scripts/theme-previews.mjs` and `src/design/previews/previews.css`. `tests/design-tokens.test.ts` lists it, and its contrast pairs pass. The postmark appears only on the title, end and scene-done screens.
- **Player** (`src/player/shells/roleplay/`: `index.ts`, `board.ts`, `dialogue.ts`, `garden.ts`, `art.ts`, `strings.ts`, `roleplay.css`):
  - Screens: title (CEFR stamp), scenes, scene, item and feedback (context `line`, or `garden` while watering), scene-done, garden and end.
  - Translations appear on request, and there are `line-play` slots for audio.
  - Typed replies use the shared tolerant matcher and the special-letter keys.
  - After a miss the speaker says a recovery line and the reply is asked again (at most 3 answers). After that the right reply is shown, so a scene never dead-ends.
  - The garden's stages come from `mastery(card)`. A missed word's plant wilts, and `water` practises the due words.
  - A finale mixes the units.
- **Course side** (`src/shared/shells/roleplay.ts`): the required section, the dialogue graph and the `RP_*` lint, with 14 codes.
- **Bot driver** (`scripts/bot/roleplay.mjs`): reveals lines, opens one translation per scene, types in keyboard mode and waters the garden. Registrations are in `scripts/bot/index.mjs`, `src/player/main.ts` and `src/shared/shells/index.ts`.
- **Fixture** (`hr-a1-greetings`): a scene per unit (a café in Zagreb, a language school in Split, a hotel desk), a finale, and 13 garden words. The section is enabled.
  - Croatian fixes against the earlier draft: "Ja sam dobro" and "Evo vaš ključ". No spoken line gives its own answer away.
  - The two existing placeholder clips are used on the lines they stand for, and their alt text says they are placeholders.
- **Broken fixture:** `tests/fixtures/courses/broken-roleplay/` with `EXPECTED.md`.
- **Tests:** `tests/player-roleplay-logic.test.ts`, `tests/roleplay-lint.test.ts`, `tests/bot-roleplay.e2e.test.ts`.
- **Docs:** `docs/player.md` "The language role-play", `README.md` (five looks), `ROADMAP.md`, `tests/fixtures/courses/README.md`.

### Deviations
- A missed turn is asked again right after the recovery line, not "later". Only the first answer counts for the stars, and the item stays in the review queue.
- A hidden listen line shows no translate button, because the translation would give the answer away.
- A unit without a scene never blocks the next unit; what that unit requires blocks it instead.
- Typing, matching and the special-letter keys come from the shared item renderers.
- The logic test is named `player-*` so that it is type-checked with the DOM lib.

### Verification
- In a clean worktree of this ticket's tree:
  - `yarn typecheck`: 0 errors.
  - `yarn lint`: 0 problems.
  - `yarn test`: 59 files, 1073 tests; 1072 passed. The one failure was the kit test's shell list, which is now written per ticket; it was re-run afterwards.
- The implementer's bot runs on `hr-a1-greetings`, all with 0 console errors:

  | Mode | Steps | Result |
  |---|---|---|
  | perfect | 23 right | 13 of 13 plants grown |
  | wrong | 30 | 8 recovery lines, 0 stars, plants wilted |
  | random 75 % | 54 (35 right) | finished |
  | keyboard only | – | 0 mouse clicks |

  - axe: 21 runs and 18 runs, with 0 violations of any impact.
  - At 390x844 the perfect and wrong runs pass without horizontal overflow.
- Lint of `hr-a1-greetings`: 0 errors. There are 2 `PLACEHOLDER_ASSET` warnings, for the beep clips.
- Screenshots: `.claude/temp/screens/phase5/roleplay/` (not committed).
- Not run:
  - a native speaker's review of the Croatian;
  - real line audio (phase 6, EGS-17);
  - a real touch device;
  - a screen reader;
  - a human play-through.

### Commit status
One local commit on `EGS-13_roleplay`. Not pushed.
