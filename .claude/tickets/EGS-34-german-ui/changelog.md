# EGS-34 changelog

- `src/player/i18n.ts`: table `DE` for every `UiKey` (reader, gloss, passage, selfcheck, verb-drill, mode, start, fb.note.* and conj.tense.* included); `TABLES = { hr, de }`, so `UI_LANGUAGES` is `en, hr, de`; new export `UI_TABLES` for the test.
- `src/player/shells/{detective,encyclopedia,mindmaze,roleplay,rpg}/strings.ts`: a `de` table each.
- `src/shared/ui-strings.ts`: `UI_STRINGS.de`. `seed/config/languages.md`: text updated.
- `tests/player-i18n.test.ts` (new): every `UiKey` and every shell key has a non-empty `hr` and `de` entry, and no table has an unknown key. The `hr` tables were already complete; no hr key was missing.
- `tests/languages.test.ts`: expects the `de` table in `UI_STRINGS` (the line said only `hr`).
- The German text is a language-model translation, not reviewed by a native speaker (same note as hr).

## Status

- DONE: `DE` table for every UiKey; `de` table for all five shells; `UI_STRINGS.de`; languages seed text; `UI_LANGUAGES` has de; completeness test (en/hr/de).
- DONE (run): `tests/player-i18n.test.ts`, `tests/languages.test.ts`, `tests/player-shell-picker.e2e.test.ts` pass; tsc node/web/player and eslint clean.
- NOT DONE: full test suites (decision: not run).
- UNTESTED: the German UI in the real player; native-speaker review of the wording; the layout with the longer German strings.
