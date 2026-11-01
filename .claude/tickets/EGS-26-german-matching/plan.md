# EGS-26 German-aware matching (umlaut, ss, capitals) and one check-context helper

Copied from the HUB-22 plan (creative hub, `.claude/tickets/HUB-22-edu-start-screen-german/plan.md`).

Rules (language `de` only, `MatchOptions.lang` = language of the answer text; first hit wins):
1. Exact (normalised, case-insensitive, accents kept): correct.
2. Transliteration: the input equals an alternate spelling of an accepted answer (all of a/o/u-umlaut and sharp s as ae/oe/ue/ss; only the sharp s; only the umlauts): correct, `translit: true`, never costs a grade. The accepted side is expanded, the input is never converted back.
3. Missing umlaut (equal only after folding): wrong, `diacritics: true`; default for `de` is `strict` (`resolveDiacritics(itemStrict, courseDefault, lang)`); `strictDiacritics: false` keeps `ignore`; a course default of `warn`/`strict` wins.
4. Capitalisation: a capitalised non-first token (or a single capitalised token) typed in lower case: correct, `caps: true`.
5. Typos as before (distance 1, 4+ letters); `typos: false` switches them off (conjugation, EGS-27).

Do: `match.ts` (pure), `translit`/`caps` on `MatchResult` and `CheckResult`, `lang` on `MatchOptions` and `CheckContext`, `makeCheckContext` replacing every hand-built context, feedback notes (`fb.note.translit`, `fb.note.caps`, `fb.note.umlaut`), docs, tests.

Contract: `matchAnswer(input, accepted, { lang?, diacritics?, typos?, minTypoLength? })`; `CheckContext.lang?`; `CheckResult.translit?/caps?`; `makeCheckContext` exported from `src/shared/edu`.

Acceptance: B1 (match table), B2 (one check context; `lang` flows into typed / cloze / listening), Z (typecheck, lint, test, build).
