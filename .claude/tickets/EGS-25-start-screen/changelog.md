# EGS-25 changelog

One start screen for every game mode (HUB-22).

- New `src/player/kit/start.ts`: `startScreen(host, opts, redraw, state)`, `StartHost`, `applyScreenTheme`, `MENU_THEME`. New `kit/mode-icons.ts` (pictogram per mode, SVG built with the `svg` helper, no innerHTML).
- `kit/screens.ts`: `titleScreen` is a thin wrapper (`startHostOf(session)`); `shellPicker` removed. The `art` and `tagline` options are gone; the eyebrow is the current mode's blurb.
- Quiz arena: own title markup, message/reset/import/export code deleted; it uses the component through a `StartHost` adapter and passes its timer toggle as `opts.settings`. Engine code change: arena `go()` and `mount()` call `applyScreenTheme`.
- `ShellSession.mount()` / `render()` set `menu` on the title and the shell theme elsewhere (no flash on `switchShell`).
- New theme `menu` ("Game lobby", `src/design/themes/menu.css`, registry, previews, `theme-previews.mjs`). Title-only rules removed from chalkboard, parchment, postcard and arena CSS; picker CSS in `kit.css` is now a mode-card layout.
- UI keys (own block in `i18n.ts`, en + hr): `start.choose`, `mode.<id>.name|blurb`; the old `shell.choose` and `shell.<id>` keys are replaced by them.
- Docs: `docs/player.md` (start screen section), `docs/design.md` (menu row and the rule). ROADMAP row EGS-25.
- Tests: `tests/player-shell-kit.test.ts` (one implementation, theme helper, keys), `tests/player-shell-picker.e2e.test.ts` (skeleton equal across 5+2 shells, themes, progress kept, no overflow at 390 px), `tests/design-tokens.test.ts` (registry list).

## Status

- DONE: shared component and `menu` theme; quiz arena on it; per-screen theme; five shell callers moved; tests A1, A2, A3, A4 (design-tokens, themes-load pass), A5 by eye (screenshots 1280x800 and 390x844 of all 7 shell titles looked at; kept in `.claude/temp/screens/EGS-25/`, not committed); typecheck and lint clean; `electron-vite build` OK.
- DONE: A6 `bot.e2e` (16 tests) and `bot-mindmaze` pass when run alone.
- NOT DONE: the bot `--axe` on the title was not run separately beyond the existing bot tests; the shells' leftover title-art CSS and helpers (`folderSvg`, `gatehouseSvg`, `stamp`, `drawBanner`, `.enc-emblem` ...) are unused but not deleted.
- UNTESTED: full `yarn test` in one go. The machine was overloaded (other workers), a full run gave timeouts in bot.e2e, bot-mindmaze, models and pipeline-run; the first three pass alone. `tests/pipeline-run.test.ts` "a restarted engine ... finishes the run" still times out waiting for publish (3 runs, once with a playtest click timeout); not compared with master, so unknown whether it is load or related. Not run in the real app.
