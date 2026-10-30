# Phase 5 shell contract (EGS-10 to EGS-14)

Written by the orchestrator before the five shells were built in parallel. Every shell ticket follows it. The user-facing part of the contract is in `docs/player.md`, "Shells"; read that first.

## What exists already (do not rebuild)

- `src/player/kit/`: `ShellSession` (session.ts), `ask()` (question.ts), `titleScreen()` / `endScreen()` / `shellPicker()` (screens.ts), `makeShellUi()` (strings.ts), `kit.css`. Read all four .ts files before you start.
- `src/player/engine.ts`: `?shell=`, the remembered choice, `switchShell`, `playableShells`, `EduEngine.debug.shell` (set by `session.setDebug({...})`).
- `src/player/progress.ts`: `progress.shells[<id>]` (`ShellProgress`: `units`, `boss`, `finished`, `data`).
- `src/player/round.ts`: `startPool()`; `ShellSession.startRun/next/record/accuracy` wrap it.
- `src/shared/shells/index.ts`: the registry (`SHELL_DEFS`, `parseSection`, `sectionOf`, `validateShellSections` called by `validateCourse`, `lintShells` called by `lintGameData`), `types.ts` (`ShellDef`). Your def lives in `src/shared/shells/<id>.ts` (a stub is there).
- `src/player/shells/<id>/index.ts`: a STUB shell (`makeStubShell`) that you replace. Already registered in `src/player/main.ts`.
- `scripts/bot/<id>.mjs`: a STUB driver (re-exports `generic.mjs`) that you replace. Already registered in `scripts/bot/index.mjs`. `scripts/play.mjs` gives you the `bot` toolbox (see the object `bot` near the end of `run()`).
- `tests/bot-helpers.ts`: `chromiumUnavailable`, `play`, `buildFixtureGame`, `expectPassed`, `expectCleanAxe`.
- `.claude/temp/fixture-section.mjs`: applies your shell's section, text and assets to a fixture (see its header).

## File ownership (parallel work in ONE checkout: touch only your files)

| Ticket | Shell id | Owns (create or edit freely) |
|---|---|---|
| EGS-10 | `encyclopedia` | `src/player/shells/encyclopedia/**`, `src/shared/shells/encyclopedia.ts`, `scripts/bot/encyclopedia.mjs`, `tests/*encyclopedia*`, `tests/fixtures/courses/broken-encyclopedia/**`, `.claude/tickets/EGS-10-encyclopedia/**` (except this file) |
| EGS-11 | `mindmaze` | same pattern with `mindmaze`, `.claude/tickets/EGS-11-mindmaze/**` |
| EGS-12 | `rpg` | same pattern with `rpg`, `.claude/tickets/EGS-12-rpg/**` |
| EGS-13 | `roleplay` | same pattern with `roleplay`, `.claude/tickets/EGS-13-roleplay/**`, `src/design/themes/postcard.css` |
| EGS-14 | `detective` | same pattern with `detective`, `.claude/tickets/EGS-14-detective/**`, `src/design/themes/noir.css` |

Shared files you may need, with the rule for each:

- Fixtures (`tests/fixtures/courses/<fixture>/course/**`): ONLY through `.claude/temp/fixture-section.mjs` (it rewrites your shell's section, enable flag, text keys and assets atomically; other agents edit the same files). Keep your part's source in `.claude/temp/fixtures/<shellId>/<fixture>.json`. Text keys start with your prefix (`enc.`, `maze.`, `rpg.`, `rp.`, `det.`), asset ids with `enc-`, `maze-` ... and asset files are named the same way. Never hand-edit a fixture's JSON.
- `src/design/themes/index.ts` (EGS-13, EGS-14 only): add your theme entry at the END of `THEMES`, wrapped in `// @EGS-1N-begin` and `// @EGS-1N-end` comment lines; the `ThemeId` member is already there. Use the Edit tool (it refuses a stale file; re-read and retry).
- `scripts/theme-previews.mjs`, `src/design/previews/*` (EGS-13, EGS-14 only, if your theme needs a preview entry): one line per change, ending in `// @EGS-1N`.
- Everything else outside your rows (the kit, the engine, `play.mjs`, `lint.ts`, `validate.ts`, `main.ts`, `i18n.ts`, the arena, docs, README, ROADMAP): do NOT edit. If the kit lacks something you need, write it inside your shell folder; if that is impossible, stop and report exactly what you need in your final message (the orchestrator changes shared files).
- Lines ending in `// @EGS-NN` and blocks between `@EGS-NN-begin` / `@EGS-NN-end` belong to ticket NN: the orchestrator uses them to split the work into one commit per ticket. Do not remove or move them.

## Rules for a shell

1. `src/player/shells/<id>/index.ts` exports `<id>Shell: Shell` (`id`, `mount(host)`, `unmount()`), built on `ShellSession`. Imports its theme CSS (`../../../design/themes/<theme>.css`) and its own CSS (`./<id>.css`). Own words in `./strings.ts` (EN + HR tables, keys prefixed by the shell, e.g. `maze.door`). Split into several files: pure logic (graph, layout, battle maths, garden growth) in files with NO DOM so it can be unit-tested in node; DOM in others.
2. Screens: `title` (use `titleScreen`), your world screens (name them; document them), `item` / `feedback` only through `ask()`, `end` (use `endScreen`, after `session.finish()`). Exactly one `h1` per screen (`ask()` draws the h1 of the question screen; your `hud` must not have one).
3. Every interactive element is a real `<button>` / `<input>` / `<a>` with a `data-testid` (kebab-case, `<thing>-<id>` with language-neutral ids from the pack or your section). Keyboard playable: Tab / Enter / Space reach and use everything; arrow keys where a map needs them (and an accessible alternative: a list of exits / places / targets as buttons). Visible focus ring (the theme's `--edu-focus`, 3 px). After every screen change the focus is inside `#edu-main` (`session.render` focuses `[data-autofocus]`, else the first h1/h2).
4. Mobile: no horizontal scroll from 360 px; tap targets 44 px; a canvas scales to the width (CSS `max-width: 100%`, keep the aspect ratio) and stays crisp (`image-rendering: pixelated` for pixel art).
5. `prefers-reduced-motion`: no animation, no smooth movement (`motion.css` already zeroes durations under `.edu-stage`; a canvas animation must check `matchMedia('(prefers-reduced-motion: reduce)')` and jump).
6. CSS: every selector starts with `.edu-stage` (scope to your shell with `.edu-stage .shell-<id>` or `.edu-stage[data-shell='<id>']`), colours only from `--edu-*` slots and your theme's own `--<theme>-*` variables (no hex outside `src/design/themes/<theme>.css`), no text under 13 px, no all-caps labels. `tests/design-tokens.test.ts` checks every `.css` under `src/player/shells/`. A canvas reads its colours from the computed CSS variables (`getComputedStyle(root).getPropertyValue('--edu-...')`).
7. Learning rules: every challenge is an `ask()` with explanatory feedback; use `session.startRun/next/record` for picking (adaptive, retries after 2-4 others, due cards, interleaving); a wrong answer costs something in your world but NEVER leaves a dead end; a unit's stars come from the first-try accuracy of its run (`session.recordUnit`); 2+ stars unlock the units that require it (`session.isUnlocked`); a final challenge mixes the units (boss) before `end`. Right answers may add the item's did-you-know to the world (codex, inventory, garden).
8. Every shell plays EVERY valid course that enables it: an automatic layout from units, objectives, items and articles when the section is missing (except roleplay and detective, which may require their section: `requiresSection: true`), and the authored layout when it is there.
9. Publish your world state in `view` (JSON-safe) and register read-only bot helpers with `session.setDebug({...})` (for example `route()`, `nextTarget()`, `solution()`): they compute, they never change state or draw.
10. Never `innerHTML` with course text (use `h()` from `../../dom`); no external URL; no third-party library (no game engine); no `console.error` in normal play (the bot fails on it).
11. Public repository: no personal data, no absolute paths in committed files.

## Your course section and lint (`src/shared/shells/<id>.ts`)

- zod schema (`z.strictObject` for your objects, defaults where sensible), `textRefs` (every catalog key, path relative to the section), `assetRefs`, `validate` (unknown items, units, articles, rooms ... as `UNKNOWN_*` or your prefixed codes; these block the build), `lint` (playability: reachable, completable, no dead end, every reference exists, puzzles proved), `codes` (all your lint codes), `warnings`.
- Import only from `../course`, `../puzzles`, `../edu/registry`, `../edu/text`, `../edu/match`, `../edu/prng` (single files), never `../edu` (cycle through the validator).
- Lint the automatic layout too when `section` is undefined (if your shell has one).

## Verification each ticket must run and report (with counts)

- `yarn typecheck`, `yarn lint`, `yarn test` (Node 24 through fnm: `fnm exec --using=24 <cmd>`). The full `yarn test` runs every e2e file and takes minutes; while iterating run your own files (`yarn vitest run tests/<yours>`), and run the full suite once at the end.
- Unit tests (node, no DOM) for your pure logic and your lint: every code fires on a broken variant; the golden fixtures lint clean.
- A broken shell fixture `tests/fixtures/courses/broken-<id>/` (copy a golden fixture's course, break your section) with `EXPECTED.md` listing the codes, and a test that builds it with `force` and asserts the codes (see `tests/edu-lint.test.ts` for how the existing `broken` fixture is tested).
- Bot e2e test `tests/bot-<id>.e2e.test.ts` (use `tests/bot-helpers.ts`): for every fixture that enables your shell, perfect, wrong and random (seeded) pass with 0 console errors; one keyboard-only perfect run (`--keyboard`, 0 mouse clicks) and an axe run (`--axe`, 0 serious/critical) per fixture. If a test needs `window` in `page.evaluate`, name the file `tests/player-<id>*.test.ts` (that pattern is type-checked with the DOM lib).
- Build the player (`yarn build:player`) and the fixtures into a scratch data folder (`EDU_DATA=.claude/temp/<id>-data`, `node out/engine/index.js import-course ...`, `build`, `lint`) and look at your screens: screenshots with `--shots .claude/temp/screens/phase5/<id>/<fixture>-desktop --viewport 1280x800` and `... -mobile --viewport 390x844`. Look at them yourself (Read the PNGs) and fix what looks wrong or dull.
- Write `.claude/tickets/EGS-NN-<id>/plan.md` results (checklist with evidence) and `player-doc.md`: the section for `docs/player.md` (screens, test ids, `view`, debug helpers, rules, the course section format, lint codes, the driver's modes). The orchestrator merges it.

Do not commit, do not switch branches, do not push. Put scratch files under `.claude/temp/`.
