# EGS-22: integration of the phase 3 and 6 line with the shells

Not in the first plan's numbering: the two lines of work (phase 5 shells on `EGS-05`..`EGS-14`, phases 3 and 6 on `EGS-06`..`EGS-17`) were built in parallel and merged here, by rebasing `EGS-06`..`EGS-17` onto `EGS-14_detective` (the old tip of line B is kept as the local branch `backup-pre-rebase-EGS-17`, 96c36a0).

## Goal

The pipeline, the media and the shells work as one: a course made from a brief plays in every shell it enables, with its pictures, music and voice.

## What to do (the handoff's list)

1. Resolve the rebase (docs, `play.mjs`, `progress.ts`, `quiz-arena.ts`; the hover fix was already in `items.css`).
2. The pipeline enables the shells that build an automatic layout (quiz arena, encyclopedia, MindMaze, RPG); the role-play and the detective need authored sections and are only recorded. No `requested` key in a section any more (the section schemas are strict).
3. Art of the shells: the RPG's slots go into its own fields (`tileset`, `sprites`), the rest in `extensions.art`.
4. Audio in every shell: `ShellSession.audio` (music by area, sound effects, the reduce-audio toggle), `ItemContext.duck` for listening clips, the encyclopedia plays narration and ducks the music.
5. `KNOWN_ROLES` of the renderer equals `ROLES` (the media roles joined).
6. The phase-3 follow-ups: the planned article ids make cross-unit `related` links possible while units are written in parallel; the curriculum check flags objectives that ask for causes, consequences or dates that the facts they rest on do not state.
7. All checks: typecheck, lint, tests, build, the bot on every shell.

## Checks

- `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build` pass.
- The pipeline tests (mock provider) publish courses with the RPG enabled and a clean lint; the bot plays every shell on every fixture it supports.
- Not checkable here: real audio playback and listening (nobody has played a clip), the Electron window.
