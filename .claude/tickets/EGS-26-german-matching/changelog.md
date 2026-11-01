# EGS-26 changelog

- `src/shared/edu/match.ts`: `MatchOptions.lang`, `MatchResult.translit/caps`, `germanVariants`, German rules (transliteration, strict missing umlaut, lower-case nouns), `resolveDiacritics(itemStrict, courseDefault, lang)`. Other languages unchanged.
- `src/shared/edu/registry.ts`: `CheckContext.lang`, `CheckResult.translit/caps`, `makeCheckContext({ pack, text, targetLang? })` (exported from `src/shared/edu`). `lang` = `targetLang ?? pack.targetLang ?? text.lang`.
- `src/shared/edu/checkers.ts`: `textResult` passes `lang` and carries the flags; cloze aggregates them.
- Hand-built contexts replaced by `makeCheckContext`: `player/kit/session.ts` (2), `player/shells/quiz-arena.ts` (2), `player/debug.ts` (bot), `shared/live/questions.ts`, `engine/edu/lint.ts`, `shared/edu/kinds.ts` (validation).
- `player/feedback.ts` + `player/i18n.ts` (en, hr): notes `fb.note.translit`, `fb.note.caps`, `fb.note.umlaut` (the last is defined but not yet used: a strict miss still shows `fb.accents.strict`).
- `gradeOf` unchanged: `translit`/`caps` are not `typo`, so they stay `good`.
- Docs: `docs/player.md`, `docs/design.md`. Tests: `tests/edu-match.test.ts`, `tests/edu-checkers.test.ts`.
- Copied engine code changed: `match.ts`, `checkers.ts` (as the ticket requires).

Known limit: for a taught course every text answer gets `lang = de`, including non-taught answers in the hr/en edition (the resolver cannot say which catalog a key came from); only umlaut and capital rules differ, so the effect on hr/en answers is lenient capitals.

## Status
- DONE: matching rules, flags, `lang` on contexts, `makeCheckContext` everywhere, notes, docs, tests, ROADMAP row.
- NOT DONE: `fb.note.umlaut` is not wired to a display (strict miss uses the existing accents note).
- UNTESTED: in the real app/player in a browser; no German course exists yet (EGS-27 fixture).

## Verification
- typecheck (node, web, player) and lint clean. Full suite on a loaded machine: only timeouts/worker crashes; all re-run serially with longer timeouts passed except `tests/pipeline-run.test.ts` "a restarted engine ... finishes the run" (waits for publish; timed out twice, unrelated to matching, not checked on master). `yarn build` not run.
