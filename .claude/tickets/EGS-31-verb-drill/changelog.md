# EGS-31 changelog

- `src/player/types.ts`: `RoundKind` gains `'verbs'`.
- `src/player/round.ts`: `verbUnitsOf`, `verbItems`, `verbDueCount`, `verbPool` (due first, most overdue first; then never asked; then lowest ease; capped at the round length); `startRound(pack, 'verbs', {cards, now})`; `pickNext` keeps the pool order for a `verbs` round (misses still return through the session queue).
- `src/player/shells/quiz-arena.ts`: `verb-drill` button on the map (only with verb units and conjugation items), `beginRound('verbs')`, verbs summary is not rated (no stars, no sfx level-up), menu music, round title.
- `src/player/i18n.ts`: `map.verbs` (en, hr).
- `scripts/bot/quiz-arena.mjs`: bot step checks the button exists exactly when the course has verb units, plays one drill.
- `tests/fixtures/courses/de-verbs-a1/course/pack.json`: `extensions.language = {verbUnits, verbsPerUnit}`.
- Tests: `tests/player-round.test.ts` (due before new, weakest last, miss returns, deterministic, empty without verb units); `tests/bot-conjugation.e2e.test.ts` runs the new bot step.
- Docs: `docs/player.md`; ROADMAP row.

## Status
- DONE: round kind, pool order, button + hiding, SM-2 scheduling through the shared answer path, bot step, unit tests, docs.
- NOT DONE: bias of the asked persons to earlier misses (`progress` stores no per-item weak list; adding it needs a schema change, so persons stay the renderer's seeded pick); a `de` string for the button (EGS-34). Checked by grep: roleplay and detective have no kind filter that excludes conjugation (they were not played).
- UNTESTED: a human playing the drill; the button on a real touch device.
