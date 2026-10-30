# EGS-11 changelog

## 2026-10-30 — EGS-11: the MindMaze castle

Outcome: the MindMaze castle shell plays `solar-system` and `european-capitals` with their authored sections, and any course without one through its automatic layout. The bot passes the perfect, wrong and random runs, keyboard-only play and axe-core on all of them. No human has played it yet.

### Repository `edu-game-studio`, branch `EGS-11_mindmaze` (stacked on `EGS-10_encyclopedia`)

- **`src/player/shells/mindmaze/`** (theme `castle`), files `index.ts`, `art.ts`, `layout.ts`, `walk.ts`, `strings.ts`, `mindmaze.css`:
  - Screens: title (with an SVG gatehouse), castle (wings, the throne room and a mini-map), room, wing-done and throne. Item, feedback and end come from the kit.
  - Each door is a question (`ask()` with context `door`). A wrong answer costs a torch. When the torches run out, the ghost leads the player back to the entrance with the torches relit and the opened doors still open, so there is never a dead end.
  - Characters give hints and change their lines.
  - A wing's key is won at 2+ stars.
  - The throne gauntlet mixes every unit; its last torch is relit when it goes out.
  - Fixes in this run:
    - the `MindmazeSection` import and a possibly-null `hintBtn` (typecheck errors);
    - the ghost notice is now cleared on the next answer;
    - automatic room names drop the trailing full stop.
- **`src/shared/shells/mindmaze.ts`**:
  - The section schema, the maze graph, the automatic layout, and the `MAZE_*` lint (15 codes).
  - The unused `throne.character` field was dropped.
  - `AUTO_CHARS` is now a type, which clears the eslint error.
- **Bot driver** `scripts/bot/mindmaze.mjs`: the `route()`, `view()` and `maze()` helpers, and the perfect, wrong, random, keyboard and axe modes. It is registered in `scripts/bot/index.mjs`, and the shell in `src/player/main.ts` and `src/shared/shells/index.ts`.
- **Fixtures**: `solar-system` and `european-capitals` each get 3 wings of 6 rooms, 18 characters and an authored throne, in EN and HR, and `mindmaze` is enabled. New `tests/fixtures/courses/broken-mindmaze/` with `EXPECTED.md`.
- **Tests**: `tests/mindmaze-maze.test.ts`, `tests/mindmaze-lint.test.ts`, `tests/player-mindmaze-walk.test.ts`, `tests/bot-mindmaze.e2e.test.ts`.
- **Docs**: `docs/player.md` "The MindMaze castle", `README.md`, `ROADMAP.md`, `tests/fixtures/courses/README.md`.

### Deviations
- Wings have 6 rooms instead of 4 or 5, so that every wing has two routes and a shortest route of 4 doors.
- There are 3 extra lint codes: `MAZE_OBJECTIVE_MISSING`, `MAZE_DUPLICATE` and `MAZE_KEY_AT_ENTRY`.
- The throne's last torch is relit when it goes out, so the gauntlet can never be lost.

### Verification
- In a clean worktree of this ticket's tree:
  - `yarn typecheck`: 0 errors.
  - `yarn lint`: 0 problems.
  - `yarn test`: 53 files, 937 tests. 936 passed on the first run. The one failure was the kit test's shell list, now written per ticket; I re-ran it after the fix.
- From the implementer:
  - Bot runs on `solar-system`, `european-capitals` and the automatic layout, all with 0 console errors:
    - perfect: 20, 20 and 21 answers, all right;
    - wrong: 6 wrong each, with the ghost scene seen 2 times;
    - random (75 %): pass;
    - keyboard: 0 mouse clicks;
    - axe: 32, 26 and 32 runs, 0 serious and 0 critical.
  - A random run at 45 % on `solar-system` also finished (156 answers, 18 ghost scenes).
  - Lint: 0 `MAZE_*` errors and 0 warnings on every fixture.
  - Screenshots are in `.claude/temp/screens/phase5/mindmaze/`; they are not committed.
- Not run: a human play-through, Croatian text checked on screen, and a real phone.

### Commit status
One local commit on `EGS-11_mindmaze`. Not pushed.
