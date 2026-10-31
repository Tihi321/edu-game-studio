# EGS-22 changelog

## 2026-10-31: the two lines become one

Branch `EGS-22_integration`, one commit, stacked on `EGS-17_voice`. Not pushed.

**The rebase.** `EGS-06`..`EGS-08` and `EGS-15`..`EGS-17` were rebased onto `EGS-14_detective` (`git rebase --update-refs`), so the whole history is one line:
`EGS-01` .. `EGS-05`, `EGS-10` .. `EGS-14`, `EGS-06` .. `EGS-08`, `EGS-15` .. `EGS-17`, `EGS-22`. The conflicts were in `README.md`, `ROADMAP.md`, `docs/player.md`, `docs/design.md` (merged by hand), `scripts/play.mjs` (the media check joined the shell drivers' bot), `src/player/progress.ts` and `src/player/shells/quiz-arena.ts` (`reduceAudio` next to `shells`). `src/player/style/theme.css` was deleted by EGS-05; its hover fix (a larger hover area on `.btn`) was already in `items.css`. Old tip of the line: local branch `backup-pre-rebase-EGS-17` (96c36a0). The rebased tickets were not re-tested one by one; only the tip was.

**What changed (repo-relative)**
- `src/engine/edu/authoring.ts`: `PIPELINE_SHELLS` (quiz arena, encyclopedia, MindMaze, RPG: the shells whose layout is automatic) replaces the old `KNOWN_SHELLS = ['quiz-arena']`; `OBJECTIVE_CUES` and `CurriculumContext.factTexts` (the curriculum check flags "causes", "consequences", "dates" that the facts of the objective do not state).
- `src/engine/edu/assemble.ts`: no `{requested: true}` section any more (the real shell schemas are strict); a shell that needs an authored section (role-play, detective) is recorded in `extensions.pipeline.requestedShells`; the RPG gets its `story.intro/outro` from the frame story; `related` links to articles that do not exist are dropped.
- `src/engine/edu/pipeline-handlers.ts`: the articles step lists the planned article ids (`a-<unit>-<n>`) of the units not written yet, so units written in parallel can link to each other; the curriculum check gets the fact texts.
- `src/engine/edu/media-link.ts`: art of the RPG in its own fields (`tileset`, `sprites.hero`, `sprites.npc`), of the quiz arena in its section, of everything else in `extensions.art`; the "unused placeholder" sweep sees every asset a shell section names; a role-play line's tone is re-pointed at the spoken clip that replaces it.
- `src/shared/shells/rpg.ts`: a section that only skins the quest (tileset, sprites) is not told it has no story.
- `src/player/kit/session.ts`, `screens.ts`: `session.audio` (`GameAudio`) for every shell: music by area (`musicAreaOf`), `playCue` is `audio.sfx`, the reduce-audio toggle on the title, `ItemContext.duck`. `src/player/audio.ts`: `unit-complete` and `level-up` are one event.
- `src/player/items/listening.ts`, `src/player/types.ts`, `src/player/shells/quiz-arena.ts`: the listening clip ducks the music.
- `src/player/shells/encyclopedia/{view-article,app}.ts`: the article's audio is its own audio asset, else the narration clip (`extensions.narration['art.<id>.body']`), and ducks the music.
- `src/renderer/ui/roles.ts`: the picker has the media roles (`KNOWN_ROLES` equals `ROLES`).
- Docs: `docs/player.md` (audio), `docs/mcp-guide.md` (shells, art), `README.md`, `ROADMAP.md`.
- Tests: `tests/audio-shells.e2e.test.ts` (new: real Chromium, a recording `Audio`, the five shells, the bot with music on), plus new cases in `edu-authoring`, `edu-assemble`, `pipeline`, `player-audio`, `player-shell-kit`, `rpg-lint`; the expectations about `requested` and the RPG art moved to the new places.

**Verification** (in the worktree `edu-game-studio-p3`, Node 24; `yarn` is not on this machine's PATH, so the binaries were run through `fnm exec --using=24 node node_modules/...`)
- `tsc` for the three tsconfigs and `eslint .`: 0 problems.
- `vitest run`: 93 files; the last full run had 1 failure, `puzzles.test.ts` "logic: proves 200 seeds" hitting the 15 s timeout under the load of the whole suite; it passes alone (and in the earlier run). One art-tools hook timeout in an earlier run was the same kind of load flake. Everything else passes, including the bot on every shell and fixture (perfect, wrong, random, keyboard, axe).
- The vite player and engine builds and `electron-vite build`: pass.

**Not run:** the Electron window, real audio playback (the browser test uses a recording stand-in for `Audio`; nobody has listened to a clip), touch devices, a human play-through. The shells other than the RPG do not show the generated pictures yet (the pictures are in the pack and in `extensions.art`).

**Follow-ups:** the art slots of MindMaze rooms and encyclopedia plates are recorded but not drawn by those shells; the objective-cue check is a heuristic for English objectives only.
