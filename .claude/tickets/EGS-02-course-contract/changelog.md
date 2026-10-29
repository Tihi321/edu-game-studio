# EGS-02 changelog

## 2026-10-29: EGS-02 course contract, 13 item kinds with checkers, SM-2, adaptive difficulty, generators and two golden fixtures

Branch `EGS-02_course-contract` (stacked on `EGS-01_skeleton`).

### What changed

- `src/shared/course.ts`: zod schemas for `course/pack.json` (`schema: 1`, units with `requires[]` prerequisite graph, objectives with Bloom level, items, `shells.config[shellId]` open to any shell id, assets, cues, encyclopedia articles citing `factbase` ids, `extensions` on the pack and on items, optional `targetLang` and `matching` policy) and `course/text/<lang>.json` (strings + `accepted` answer sets); graph helpers (`findUnitCycle`, `unitOrder`, `objectivesOf`, `itemsOf`).
- `src/shared/edu/`: item-kind registry (`ITEM_KINDS`, `registerItemKind`, `checkItem`, `answerKeyOf`, `solveItem`, `formOf`) with 13 built-in kinds (mcq, true-false, multi-select, cloze, typed, match-pairs, order/timeline, sort-groups, hotspot, listening, flashcard, crossword, word-search); tolerant matching (`match.ts`: case/punctuation, č/ć/š/ž/đ folding, Levenshtein 1 for answers of 4+ letters, synonyms, accent policy ignore/warn/strict); SM-2 scheduler with an in-session re-ask queue (`srs.ts`); adaptive difficulty for a 70-85 % success band (`adaptive.ts`); seeded crossword and word-search generators; `validateCourse` with structural problem codes; loaders. Pure TS, bundles in the browser.
- `src/engine/edu/course-io.ts`: `loadCourseFolder`, `validateCourseFolder` (also checks asset files on disk).
- `tests/fixtures/courses/solar-system/` (en + hr, 3 units, 9 objectives, 28 items, all 13 kinds, NASA-sourced fact base) and `hr-a1-greetings/` (Croatian A1 for English speakers, 3 units, 31 items); `scripts/make-fixture-audio.mjs` writes the fixture WAVs; `.gitattributes` marks WAVs binary.
- Tests: `tests/edu-{match,srs,adaptive,puzzles,checkers,course}.test.ts` (120 new tests).

### Deviations

- SM-2 chosen over FSRS (no trained parameters; intervals pinned in tests: good x4 = 1, 6, 15, 38 days).
- Units derive their objectives from `objective.unit`; schemas are strict (growth through `extensions` or a new `schema` number).
- Language courses get `targetLang`; the target catalog holds the taught phrases for every edition.
- Fixture audio is placeholder beeps (labelled as such); TTS replaces them in EGS-17.

### Verification

`yarn typecheck` exit 0, `yarn lint` exit 0, `yarn test` 31 files / 475 tests passed (re-run by the orchestrator). Both fixtures validate with 0 problems and every item is solvable from its own key in every edition (test). Not run: playing anything (no player until EGS-03); native-speaker proofreading of the Croatian.

### Commit status

Committed as one commit on `EGS-02_course-contract` (not pushed).
