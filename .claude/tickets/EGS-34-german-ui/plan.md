# EGS-34 German UI strings (hub ticket HUB-22)

Copied from the HUB-22 plan.

- **Inputs:** all UI keys after EGS-25, 26, 27, 31 (and 35, 36, 38) have merged.
- **Do:** table `DE` in `src/player/i18n.ts` for every `UiKey`, `de` tables for every shell's strings (detective, encyclopedia, mindmaze, roleplay, rpg), `UI_STRINGS.de`; keep the "written by a language model, not native" note; test that every key exists in `en`, `hr` and `de` (a missing `hr` key found by the test is fixed here too). A German-speaking learner is not a target of the course; the table makes `languages: ['de']` editions of other courses work and the new `fb.note.*` / `mode.*` strings complete.
- **Outputs:** tables, test (`tests/player-i18n.test.ts`), docs (`seed/config/languages.md`), ROADMAP row.
- **Acceptance (I1):** every key exists in en, hr, de.
