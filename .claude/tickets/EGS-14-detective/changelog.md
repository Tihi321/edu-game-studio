# EGS-14 changelog

## 2026-10-30 — EGS-14: the detective / escape room

Outcome: the detective shell (theme `noir`) is built and plays `solar-system` and `european-capitals`. Its cases come from VN Studio's puzzle generator, which this ticket did not change. The lint proves every case unique and deducible. Answering a course item turns a clue card. `european-capitals` adds a Carmen-Sandiego chase across 6 capitals. The bot passes the perfect, wrong and random runs, keyboard-only play and axe-core. No human has played it yet.

### Repository `edu-game-studio`, branch `EGS-14_detective` (stacked on `EGS-13_roleplay`)

- **Theme `noir`.** `src/design/themes/noir.css` is registered in `src/design/themes/index.ts`, and the theme previews include it. It passes the contrast pairs in `tests/design-tokens.test.ts`.
- **Player shell** (`src/player/shells/detective/`: `index.ts`, `grid.ts`, `art.ts`, `board.ts`, `map.ts`, `model.ts`, `strings.ts`, `detective.css`):
  - Screens: title, office, case, item/feedback (context `clue`), case-solved, chase, caught, end.
  - Clue cards are turned by answering course items. Each card shows the puzzle sentence and the fact from the answer.
  - The grid marks cycle blank → no → yes, and a yes strikes out its row and column.
  - Deduction hints cost no stars; the solved screen counts them.
  - A wrong accusation names only the wrong categories, and the case stays open.
  - On the chase, a wrong travel choice is a cold trail: an hour on the clock, and back to the last place.
  - Escape rooms unlock per unit, and the final room mixes units.
- **Course side** (`src/shared/shells/detective.ts`, `detective-case.ts`):
  - The required section, case building from the seed with a fallback to the next seed, and EN/HR clue sentences that use the aliases.
  - The `DET_*` lint: 14 codes.
  - The typecheck error in `answerOf` is fixed.
- **Puzzle generator.** `src/shared/puzzles/` was compared with VN Studio's: it matches apart from line endings and the header comment, and it is unchanged. VN Studio's other puzzle tests need its Python bridge, its Ren'Py emitter and its story engine, so none were copied.
- **Bot driver** `scripts/bot/detective.mjs`: `solution()` and `route()` helpers. The driver is registered in `scripts/bot/index.mjs`, `src/player/main.ts` and `src/shared/shells/index.ts`.
- **Fixtures:**
  - `solar-system`: 3 rooms and a final room.
  - `european-capitals`: a room per unit (one of them a logic grid), a final room, and the chase over 5 legs.
  - Entities are course things and aliases are course facts, in EN and HR.
  - New broken fixture: `tests/fixtures/courses/broken-detective/` with `EXPECTED.md`.
- **Tests:** `tests/detective-case.test.ts`, `tests/detective-lint.test.ts`, `tests/player-detective-model.test.ts`, `tests/bot-detective.e2e.test.ts`.
  - The test that proves 200 seeds of each kind and size gets a 120 s bound. It runs in about 10 s alone but timed out once at 15 s while the e2e files shared the CPU.
- **Docs:** `docs/player.md` "The detective", `README.md` (six looks; the puzzle line), `ROADMAP.md` (phase 5 moved to Done), `tests/fixtures/courses/README.md`.

### Deviations
- **Hints are free.** The plan said both "costs a star point" and "costs nothing"; this ticket follows "costs nothing", and the solved screen shows how many hints were used.
- **Chase as a final.** In `european-capitals` the chase is a `final: true` challenge next to the final room; either one closes the file.
- **Kinds offered.** The shell offers murdle and logic only, because the schema allows only those. Knights, testimony and quiz therefore have no property test here.
- **`DET_PUZZLE_*` codes.** No section the schema accepts can trigger these three codes. They are tested with an injected case builder instead.
- **Fact label.** The label under a turned card was "The fact behind it". The orchestrator renamed it to "The fact from your answer" (HR "Činjenica iz tvog odgovora"): the item that turns a card is not chosen for the card's entities, so the old label claimed a link that is not there.

### Verification
- **Final tree** (this ticket's, equal to the working tree):
  - `yarn typecheck`: 0 errors. `yarn lint`: 0 problems.
  - `yarn test`: 63 files, 1154 tests, all passing.
  - `yarn build`: ok.
  - The formerly flaky `bot.e2e` hr-a1-greetings random-75 % test was re-run separately; see the phase report.
- **Puzzle proofs:** murdle 3 and 4, and logic 3 and 4, each over 200 seeds. All were unique and deducible, with 0 fallbacks. The fallback is tested three ways.
- **Bot runs** (implementer), all with 0 console errors:

  | Course | Perfect | Wrong | Random |
  |---|---|---|---|
  | `solar-system` | 27/0, 4 rooms at 3 stars | 0/4, not finished as intended | 48/18, finished |
  | `european-capitals` | 37/0, including 5 chase legs and a cold trail | 0/4 | 59/21, finished |

  - Keyboard only: 1062 and 1431 key presses, 0 mouse clicks.
  - axe: 30 and 38 runs, 0 violations of any impact.
- **Lint:** both golden fixtures have 0 errors and 0 warnings.
- **Screenshots:** `.claude/temp/screens/phase5/detective/`, not committed.
- **Not run:** a human play-through, a screen reader, and Croatian checked on every screen (it was checked on the office screen only).

### Follow-ups
- Choose each clue card's item from the items about that card's entities, so that the fact under a card supports its sentence.

### Commit status
One local commit on `EGS-14_detective`. Not pushed.
