# EGS-16 changelog

## 2026-10-30: re-verification of the committed tree (EGS-17 run)

The committed tree of `EGS-16_music` commit 8a99a20 was exported (`git archive`) and checked on its own: `yarn typecheck` passes, `yarn lint` passes, `yarn test` 64 files, 909 tests: 908 pass. The one failure is `tests/bot.e2e.test.ts` hr-a1-greetings "random: a seeded 75 % learner" (click on `next` times out: "element is not stable"). It is not caused by this ticket: the pointer rests on the edge of the Next button after the `g-formal-sort` item and the `.btn:hover` lift makes the button jitter forever (a player CSS bug from EGS-03). Fixed in the EGS-17 commit (`src/player/style/theme.css`, a hover area that moves with the button); with it the suite passes in full (EGS-17: 68 files, 969 tests). Nothing else in this ticket needed a fix.

## 2026-10-29: music and sound effects, the composer, the player's audio

Branch `EGS-16_music` (stacked on `EGS-15_art`), one commit `EGS-16: ...`; not pushed.

**Verification (implementer run, repeated by the orchestrator with the same result: 64 files, 909 tests, typecheck, lint and build pass):** `yarn typecheck` and `yarn lint` pass; `yarn test` 64 files, 909 tests passing (baseline 59 files, 833 tests: +5 files, +76 tests); `yarn build` passes. The real-Chromium tests ran and passed (the bot with sound on, 0 console errors, 0 media errors; the real player's music, mute and "reduce audio"). No live provider was running, so live music and sound generation, and how it sounds, are UNTESTED. Details: `plan.md` Results.

## What changed

### The composer and the plan

- **Role `composer`** (`ROLES`, agent `composer-tobias-lindqvist`, prompt `prompts/composer/plan.md` with its `PROMPT_VARS`, `config/roles.md`). Its answer `{music: [{area, mood, prompt, alt, seconds?, units?, chip?, bpm?, key?, bars?}], sfx: [{event, sound, alt}], notes}` is checked (`checkMusicPlan`: areas and events exist, every area and required event covered once, a unit line may merge more units) with one repair round; a plan that stays unusable is replaced by the deterministic plan from the course text (`fallbackMusicLines`), so the step never blocks.
- **Areas** (`src/shared/music.ts`, a table in code): `menu`, `unit-<id>`, `boss`, `end`, plus `castle` (MindMaze shell), `rpg-overworld` and `rpg-battle` (RPG shell). **Events**: `correct`, `wrong`, `combo`, `level-up` (required), `boss`. **Stable ids** `mus-<area>` (a merged track has its first area's id and a cue per area) and `sfx-<event>`; plan file `pipeline/music.json`.
- `src/engine/edu/music.ts` (the contract, the fallback, the providers per area, `resolveMusicEntries`, `mergeMusicPlan` into the manifest), `src/engine/edu/music-service.ts` (`MusicService`, `EduService.music`: the sources from a pipeline run or a pack, the plan, the generation, `withChiptuneCircuit`).
- **Providers per area**: an explicit `music.provider` wins; else Chiptune Studio for the castle and RPG areas and for a pixel course, ComfyUI ACE-Step for the rest. **Every sound effect is Chiptune Studio's `compose_sfx`** unless `sound.sfxEngine` says otherwise (`none` = by hand, placeholders until `edu_asset_replace`).
- **Flow Music never by default**: used only with `music.provider: flow` AND `music.flowCredits: true`, at most `flowMusicMaxSongs` songs (`config/studios.md`); the tracks beyond the cap are made by the default provider with a warning; `provider: flow` alone gives the default providers and a plan warning; the generator refuses a `flow-music` entry for a course that did not opt in. Proved in `tests/music-generate.test.ts` (no call without the opt-in) and `tests/music-pipeline.test.ts` (a whole run: no call; with the opt-in exactly 2 songs under a cap of 2).

### Generation, placeholders, the pack

- **Ported from VN Studio**: `studios/chip-plan.ts` (mood, chip, bpm, key, bars; the deterministic plan) and the music, sfx and ambience branches of `generate.ts`, now `assets/generate-audio.ts` (`generateAudioAsset`: Chiptune track with `compose_track`, `render_audio`, loop points and the song file; `compose_sfx` for effects and ambience; a ComfyUI audio engine; Flow Music through `makeFlowTrack`). `generateAsset` delegates the audio kinds to it; `generateAll` takes `kinds`.
- **Placeholders**: `writePlaceholder` writes `assets/<id>/placeholder.wav` (a second of silence, `assets/wav.ts`) for an audio kind; the lint warns `PLACEHOLDER_ASSET` by the file name. A provider found down once (`withCircuit` for ComfyUI, `withChiptuneCircuit` for Chiptune Studio) is not asked again in the same run.
- **Merge into the pack** (`media-link.ts`, `MediaService.mergeFor`): audio assets `{id, kind: audio, file, alt: asset.<id>.alt}`, the cues of the plan for the assets that have a file (`cue-music-<area>`: `music:<area>`, loop; `cue-sfx-<event>`: the event, one shot) and the loop points in `pack.extensions.audio.loops`. The cue schema is strict, so no course schema change was needed. With `media.music.enabled: false` no sound is linked and the cues of an earlier plan go on the next re-link.
- **Pipeline**: new stage `music` between `art` and `assemble`; `music_plan` (composer) -> `music_generate` (no model) after the art steps; the `music` skipped hook is gone. `restart from: music` and `restart from: art` work; resumable and idempotent (a version already made is not made again; nothing is made twice across restarts, tested). Standalone job `asset_music_plan` (for `edu_music_plan`, works on a hand-made course); `asset_generate` now makes pictures and sounds (`kind` says which).
- **Settings**: `media.music.enabled` (default true) and `media.music.flowCredits` (default false) are new; `CHIPS` gained `ps1` and `dreamcast`. `edu_status` `media` has `audio`, `audioMade`, `audioPlaceholders` and a note.

### The player

- **`src/player/audio.ts`** (`GameAudio`): music of the area as a loop, one track at a time with a 400 ms fade, the `menu` track as the fallback for an area with no cue, the same file in the next area keeps playing, loop points, no music with `reduceAudio`, nothing at all with `sound` off, effects on events (`level-up` also plays a `unit-complete` cue), effects at 40 % with `reduceAudio`, autoplay blocked is silent and the track starts at the first gesture, a load error is `console.error`, `duck(on)` for EGS-17's narration.
- **`progress.ts`**: `settings.reduceAudio` (optional in the type; always a boolean after a parse; an older save means false), exported and imported with the progress.
- **`quiz-arena.ts`**: the toggle `setting-reduce-audio` next to `setting-sound`, music area per screen (menu on title, map and review; the unit's or the boss's during a round; end), effects on `correct`, `wrong`, `combo` (the combo burst), `level-up` (a unit round ends) and `boss`; the old `playCue` is gone. `i18n.ts`: two strings (English, Croatian).

### MCP, seed, docs

- `edu_music_plan {slug, fallback?}` (added: `edu_asset_plan` takes no kind); `edu_asset_list` shows `plays` and `loop` for a sound and the music settings; `edu_asset_generate` takes `music` and `sfx` as `kind` and refuses when what it would make is switched off; `edu_asset_set {provider}` is refused for a sound; `edu_media_settings` documents the music settings. `docs/mcp-guide.md` ("Music and sound effects"), `docs/player.md` ("Audio"), `docs/design.md`, `README.md`, `ROADMAP.md` (EGS-16 to Done), `seed/config/{roles,studios}.md`.

### The kept copies

- `studios/{chiptune,music,flow-music,flow}.ts`, `comfy/*`, `assets/{manifest,postprocess,palettes}.ts`: unchanged. `studios/chip-sound.ts`: one export added (`CHIP_SOUNDS`, the sound names, for the composer's prompt and checks).

## Tests

- New: `chip-plan` (ported), `music-generate` (ported `chiptune-sfx`, `flow-music` and the music part of `studios-generate`, adapted: Chiptune track with loop points, an effect per event, ACE-Step through the ComfyUI fake, Flow only with the opt-in and under the cap, placeholders), `music-plan` (the contract, repair inputs, fallback, stable ids, providers, the manifest and pack merge), `music-pipeline` (the whole run with art and music, merged units, the composer's repair and fallback, restarts, Chiptune down, ComfyUI down, hand-made sound effects, Flow never by default and capped, the tools on a hand-made course, the real bot and the real player in Chromium), `player-audio` (a fake `Audio`: mute, reduce audio, one track at a time, cue lookup, loop points, autoplay, errors, effects; the setting kept with the progress).
- The fakes of ComfyUI, Chiptune Studio and Flow now write real PCM WAV (`tests/edu-helpers.ts`, `studio-fakes.ts`, `flow-fakes.ts`); `pipeline-helpers.ts` scripts the composer (`musicPlan: ok | merge | repair | unusable`).
- Changed: `art-pipeline` (its briefs switch the music off: those tests count pictures), `art-tools`, `assets-generate`, `pipeline`, `pipeline-run`, `roles-config`, `player-progress`, `assets-fixtures`.

## Files touched outside `src/engine`, `src/shared/media.ts`, `seed`, `docs`, `tests`

- `src/shared/music.ts` (new), `src/shared/schemas.ts` (`ROLES`).
- Player: `src/player/audio.ts` (new), `src/player/progress.ts`, `src/player/shells/quiz-arena.ts`, `src/player/i18n.ts`. No CSS, no other markup.
- `README.md`, `ROADMAP.md`.
- No file of `src/renderer/**` (`src/renderer/ui/roles.ts` was not updated: its picker list lags behind `ROLES` by `art-director`, `art-critic` and `composer`, which `tests/roles-config.test.ts` checks), and `scripts/play.mjs` is unchanged.

## Known gaps

- Live providers (ComfyUI ACE-Step, Chiptune Studio, Flow Music) were not run: the real ogg render, the loop points of a real track and how any of it sounds are UNTESTED.
- The listening item still plays its own `Audio` without ducking the music (`GameAudio.duck` is for EGS-17). Other shells (EGS-10..14) will call `GameAudio` with their own areas (`castle`, `rpg-overworld`, `rpg-battle` are planned and generated already).
- The unit areas of a merged group all point at one track; a later shell that wants a different track per unit needs the composer not to merge.
