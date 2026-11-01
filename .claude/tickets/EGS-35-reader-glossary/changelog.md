# EGS-35 changelog: reader view, glossary, passage-linked items (B2)

## Changed
- `src/shared/shells/encyclopedia.ts`: section gets `glossary` and `reader`; `readerChapters`, `glossaryOf`, `passageOf`, `paragraphsOf`; lint `GLOSS_TERM_NOT_IN_TEXT`, `GLOSS_DUPLICATE`, `GLOSS_COVERAGE` (warning); validator `UNKNOWN_ARTICLE`, `DUPLICATE_ID` for glosses; glossary text refs (TEXT_MISSING per edition).
- `src/player/gloss.ts` (new): segmentation at glossed words, popover, `button.gloss`.
- `src/player/items/common.ts`: `passagePanel`, `withPassage`; `engine.ts` wraps every registered renderer with it (all shells, no per-shell code); `ItemContext.passageOpen` and `ShellSession.passageOpen` (one line in `kit/session.ts`).
- Encyclopedia: `view-reader.ts` (new), `app.ts` (Reader tab, `reader()`, `practice()`, cleanup hook, `chapters()` debug helper), `data.ts` (`reader`, `glossOff`, optional, old saves unchanged; stored in `progress.shells.encyclopedia.data`), `view-article.ts` (glossed words in article pages), CSS in `items.css` and `encyclopedia.css`.
- `i18n.ts`: own block `reader.*`, `gloss.*`, `passage.*` (en, hr).
- Bot: reader walkthrough in `scripts/bot/encyclopedia.mjs`; passage check for every shell in `scripts/play.mjs`.
- Fixture `tests/fixtures/courses/de-b2-reading` (hr + en, target de): 2 readings of 400 words, 12 glosses each, 10 items with passages. Model-written German, not natively reviewed. Not added to `FIXTURE_NAMES`.
- Tests: `player-reader-logic`, GLOSS cases in `encyclopedia-lint`, 6 bot cases in `bot-encyclopedia.e2e`; one assertion updated in `player-encyclopedia-logic` (schema defaults). Docs: `docs/player.md`, fixtures README, ROADMAP row.

## Verification
typecheck, lint clean; the new and touched test files pass; `yarn build` steps (player, live, engine, electron-vite) pass run by hand because `yarn` was not on PATH in fnm. The first full `vitest run` on a loaded machine had timeouts in unrelated bot/mcp files; the files I re-ran serially pass. `tests/pipeline-run.test.ts` "restarted engine" times out also with my changes stashed or not (load); not investigated further. Detective, mindmaze and rpg bot files were not re-run serially.

## Status
- DONE: section schema `glossary` + `reader`; GLOSS_* lint and one failing test each; reader view with chapters, remembered position, read marking, arrow keys; tap-to-gloss + popover + glossary panel + "in my deck" switch (`glossOff`); passage panel in every shell; i18n en+hr; fixture; bot steps; docs; ROADMAP.
- NOT DONE: "the reader jumps to the passage from the feedback" (only in the contract paragraph, not in the Do list); German `de` UI strings (EGS-34); harvest of cards from glosses (EGS-36, only the `glossOff` flag exists).
- UNTESTED: a human reading; real touch device; scroll-position restore (logic unit-tested, not asserted in the browser); whether the texts are really B2.
