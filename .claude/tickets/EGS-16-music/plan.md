# EGS-16: music and sound effects, the composer

Phase 6 of `HUB-19`, second ticket. Branch `EGS-16_music`, stacked on `EGS-15_art`. One commit. Builds on the media foundation of EGS-15 (course media settings, the manifest in the course, placeholders, the assemble merge, the bot's media check). Phase 2 is restyling the player's visual layer elsewhere: player edits stay small and are listed in the changelog.

## Goal

The pipeline's `music` hook becomes real: the composer plans music per area and mood and the sound effects, the providers make them, they land in the pack as audio assets and `cues`, and the player plays them, respecting mute and a new "reduce audio" setting.

## Port from VN Studio (read-only)

`src/engine/studios/chip-plan.ts` (mood, chip, bpm, bars plan; fallback plan) and its test; the music and SFX branches of `assets/generate.ts` (if EGS-15 did not port them); `studios/{chiptune,music,chip-sound,flow-music}.ts` are already copied (keep them unless a change is needed); the VN tests `chip-plan`, `chiptune-sfx`, `flow-music`, the music part of `studios-generate`. Fakes: `tests/studio-fakes.ts` (Chiptune Studio), `tests/flow-fakes.ts` (Flow Music), a ComfyUI ACE-Step fake that returns a real, decodable audio file (WAV PCM is fine in tests).

## Design

- **Providers.** Chiptune Studio (MCP 7458) is the default for RPG and MindMaze castle music and for every SFX of a pixel course; ComfyUI ACE-Step for the other courses' music (`media.music.provider`, `resolveMusicProvider`). **Flow Music spends credits: off by default.** It is used only when the course sets `music.provider: flow` AND `music.flowCredits: true` (or the equivalent explicit opt-in you choose), capped by `flowMusicMaxSongs` in `config/studios.md`; a test proves Flow Music is never called by default.
- **Composer role** (agent, prompt `seed/prompts/composer/plan.md`, roles.md entry, zod contract with a repair round, deterministic fallback plan). It plans:
  - music per area and mood: areas are `menu`, one per unit (or per unit group if the composer merges them), `boss`, `end`, plus per-shell areas of the brief's shells (for example `castle`, `rpg-overworld`, `rpg-battle`); each with mood, tempo, chip (Chiptune) or prompt (ACE-Step / Flow), length, loop;
  - SFX for the events `correct`, `wrong`, `combo`, `level-up` (and `boss` / `unit-complete` if the shell plays them) through Chiptune Studio's `compose_sfx` (`chip-sound.ts`), or the course's `sound.sfxEngine`.
- **Stable ids:** `mus-<area>` (for example `mus-menu`, `mus-unit-u1`, `mus-boss`), `sfx-<event>`. Plan file `pipeline/music.json`.
- **Pack:** audio assets (`kind: audio`, alt key `asset.<id>.alt` describing the sound), and `cues`: music `{on: 'music:<area>', loop: true, volume}`, SFX `{on: '<event>', loop: false}`. Chiptune loop points (`loopStartSec`/`loopEndSec`) are kept in the manifest and passed to the player (in `extensions` of the cue or of the pack, since the cue schema is strict; keep the course schema change minimal and say what you chose).
- **Pipeline:** `music_plan` (composer) -> `music_generate` (no model), after art and before assemble; resumable, idempotent, a version already made is not made again; a provider that is down gives placeholders (a short silent or tone WAV named `placeholder`) and warnings, never a failed run.
- **Player** (smallest change; new module `src/player/audio.ts` preferred over edits spread in the shell): plays the area's music as a loop (one track at a time, a short fade on change, stops on leaving), plays SFX on events; respects the existing `settings.sound` (mute: nothing plays) and a new `settings.reduceAudio` ("reduce audio": no music, SFX at a lower volume), stored with the progress (export/import keeps it) and shown as a toggle with `data-testid="setting-reduce-audio"` next to the sound toggle in the quiz arena. The quiz arena calls it on screen changes (menu, a unit round, the boss, the end) and on `correct`, `wrong`, `combo` (the combo burst) and `level-up` (unit complete). Autoplay blocking is caught silently; a load error is `console.error` (the bot counts it).
- **MCP:** the `edu_asset_*` tools of EGS-15 cover music and SFX (`kind` filter); add `edu_music_plan {slug}` only if `edu_asset_plan` cannot take a `kind`. Docs in `docs/mcp-guide.md`.

## Tests (fakes only, autostart off)

- Ported VN tests; the composer contract, repair and fallback; stable ids across runs.
- Generation with fakes: Chiptune track with loop points, Chiptune SFX for each event, ACE-Step music through the ComfyUI fake, Flow Music only with the opt-in (and capped), placeholders when Chiptune Studio is down.
- Player: unit tests for `audio.ts` (mute, reduce audio, one track at a time, cue lookup) with a fake `Audio`; progress export/import keeps `reduceAudio`.
- Pipeline end to end with art + music (shells including `rpg` so Chiptune is used): published, cues and audio assets in the pack, files in the build, `edu_lint` 0 errors and 0 `PLACEHOLDER_ASSET`, the real bot (when Chromium launches) plays with sound on, 0 console errors and 0 media errors.

## Acceptance

`yarn typecheck`, `yarn lint`, `yarn test`, `yarn build` pass (counts in the changelog). Docs: `docs/mcp-guide.md`, `README.md`, `ROADMAP.md` (EGS-16 to Done), `seed/config/*.md` where a setting was added. Live generation only if a provider is already running (the orchestrator decides).

## Results

Implemented by the implementer agent, 2026-10-29. Not committed (the orchestrator commits). The changelog is `changelog.md` next to this file.

### Verification (all run, all passing)

| Command | Result |
|---|---|
| `yarn typecheck` | passes (no output) |
| `yarn lint` | passes (no output) |
| `yarn test` | **64 files, 909 tests, all passing** (baseline 59 files, 833 tests: +5 files, +76 tests) |
| `yarn build` | passes |

Run from PowerShell as `fnm exec --using=24 cmd /c "yarn <script> > .claude\temp\<file>.txt 2>&1"` (from Git Bash the output of `cmd /c yarn` is swallowed). New test files: `chip-plan` (4 tests), `music-plan` (17), `music-generate` (24), `music-pipeline` (17), `player-audio` (14). Existing tests changed: `art-pipeline` (briefs switch the music off: they are about pictures), `art-tools`, `assets-generate`, `pipeline`, `pipeline-run`, `roles-config`, `player-progress`, `edu-authoring` (through `PROMPT_VARS`). The real Chromium tests ran on this machine and passed: the autoplay bot plays the published RPG course (10 images, 12 sounds) with the default settings (sound on) as the perfect and the 75 % learner with 0 console errors and 0 media errors (`media: {checked: true, images: 10, audio: 12}`), a corrupted sound in the build is reported as a media error that fails the run, and a Playwright run of the real player shows the menu music starting (an `Audio` element for `mus-menu`, looping, fading in), `setting-reduce-audio` stopping it at once and being kept in the saved progress across a reload, and a unit round starting `mus-unit-u1` with one track playing at a time, 0 console errors.

### The plan items

| Item | Status |
|---|---|
| Port `studios/chip-plan.ts` and its test; the music, sfx and ambience branches of `generate.ts`; the VN tests `chip-plan`, `chiptune-sfx`, `flow-music`, the music part of `studios-generate` | DONE (`studios/chip-plan.ts`, `assets/generate-audio.ts`, tests `chip-plan`, `music-generate`) |
| Fakes: Chiptune Studio, Flow Music, ComfyUI ACE-Step, real decodable audio | DONE (the three fakes write real PCM WAV through `src/engine/assets/wav.ts`) |
| Providers: Chiptune (RPG and castle music, every SFX), ACE-Step (the other music), Flow Music off by default, only with `provider: flow` AND `flowCredits: true`, capped by `flowMusicMaxSongs`, proved by tests | DONE |
| Composer role (agent, prompt, `roles.md`, zod contract, repair round, deterministic fallback) | DONE |
| Plan areas: menu, a track per unit or group of units, boss, end, castle and RPG areas; SFX for correct, wrong, combo, level-up (and boss) | DONE |
| Stable ids `mus-<area>`, `sfx-<event>`; plan file `pipeline/music.json` | DONE |
| Pack: audio assets with alt keys, cues `music:<area>` (loop) and events, loop points kept | DONE (loop points in `pack.extensions.audio.loops`) |
| Pipeline `music_plan` -> `music_generate`, after art, before assemble; resumable, idempotent; a provider that is down gives placeholders and warnings | DONE |
| Player: `src/player/audio.ts`, `settings.reduceAudio`, the `setting-reduce-audio` toggle, calls on screens and events, autoplay caught, load error is `console.error` | DONE |
| MCP: `edu_asset_*` cover music and SFX (`kind`); `edu_music_plan` | DONE (`edu_music_plan` added: `edu_asset_plan` takes no kind) |
| Tests (all bullets of the Tests section) | DONE |
| Docs: `mcp-guide.md`, `README.md`, `ROADMAP.md` (EGS-16 to Done), `design.md`, `player.md`, `seed/config/{roles,studios}.md` | DONE |
| Live generation with a real provider | NOT DONE: no provider was started (the brief said so) |
| Music audible and pleasant, the real Chiptune ogg render and loop points, the Flow Music credits path, a real composer model | UNTESTED (fakes only; headless Chromium cannot judge the sound) |

### Deviations

1. **Settings added**: `media.music.enabled` (default true; false skips both steps and leaves a silent course with no placeholder, like `art.enabled`) and `media.music.flowCredits` (default false, the explicit opt-in). `CHIPS` gained `ps1` and `dreamcast` (the ported `chip-plan` and its test use them). Existing course files parse unchanged.
2. **The sound-effect engine defaults to Chiptune Studio for every course**, not through `resolveSfxEngine` (whose default for a non-pixel course is the ACE-Step ambience engine, a poor choice for a 0.3 s blip). `sfxEngineOf(media)` in `edu/music.ts`: `sound.sfxEngine` when set (`none` = by hand), else `chiptune`. `resolveSfxEngine` itself is unchanged.
3. **A new pipeline stage `music`** between `art` and `assemble` (`STAGES`, `STAGE_OF`, `STAGE_FILES.music = ['music.json']`), so `restart from: music` redoes only the music plan and `restart from: art` redoes the art and the music. The `music` skipped hook is gone from `MEDIA_HOOKS` (only `voice` is left; its `STAGE_OF.voice` is still `art`).
4. **Cue loop points** are in `pack.extensions.audio.loops = {<assetId>: {startSec, endSec}}`: the cue schema is strict, so the pack's `extensions` carries them; no course schema change at all. The cues made by the merge have ids `cue-music-*` and `cue-sfx-*`; the merge replaces exactly those and leaves a hand-made course's other cues alone.
5. **Flow cap**: a track beyond `flowMusicMaxSongs` is made by the default provider (with a warning on the report and the step note) instead of becoming a placeholder. A course that did not opt in never reaches Flow even if a manifest entry says `flow-music` (the generator refuses and the pre-pass switches the engine).
6. **A track in the plan carries the Chiptune plan** (`chip`, `bpm`, `key`, `bars`) whatever its provider, so switching the provider needs no new model call; the manifest entry's engine follows the plan on a re-plan unless the asset is locked or custom.
7. **`generateAsset` delegates the audio kinds to `assets/generate-audio.ts`** (a new file, to avoid an import cycle and a 650-line `generate.ts`); `GenerateContext.settings` now accepts `music` and `sound` (optional), and has `chiptune`, `audioOf` and `flowSongs`; `generateAll` takes `kinds`. The skipped reason for a `voiceRef` now names EGS-17.
8. **The player plays `level-up` only at the end of a unit round** (and `boss` at the end of the boss round); the old code played `unit-complete` also at the end of a review round. A cue named `unit-complete` is still played for `level-up`. The sound toggles are shown only when the pack has cues (as before).
9. **Fakes**: the Chiptune fake always writes a PCM WAV next to the asked path with a `.wav` extension (it has no ogg encoder; `noFfmpeg` still adds the warning); the ComfyUI fake's audio is a WAV with extension `wav` whatever format was asked; the Flow fake keeps `.mp3` names with WAV content. So the real `.ogg` render is covered only by the studio's own contract.
10. **`tests/art-pipeline.test.ts` briefs switch the music off** (they assert on picture counts and on `env.comfy.requests`); the run with art and music together is in `tests/music-pipeline.test.ts`. `tests/art-tools.test.ts`'s last assertion now also turns the music off before expecting `edu_asset_generate` to refuse.
11. **`edu_asset_set {provider}` is refused for a sound** (its provider is the course's `media.music.provider`). `src/renderer/ui/roles.ts` is not updated (the renderer is restyled elsewhere): `tests/roles-config.test.ts` says its list equals `ROLES` minus `art-director`, `art-critic` and `composer`.

### What was NOT run (UNTESTED)

- No live ComfyUI (ACE-Step), Chiptune Studio, Pixel Studio, flow-music-mcp or Flow Music call and no real model: every test uses fakes and the mock provider; the autostart is off in tests.
- Nobody listened to anything: the music is planned and generated by fakes (tones), played in headless Chromium, whose autoplay policy and audio sink prove the wiring (Audio elements made, started, stopped, looped, no errors) but not how it sounds.
- `yarn dev` (the desktop window) and the Assets page of EGS-05 were not opened; nothing in `src/renderer/**` changed.

### Files touched outside `src/engine`, `seed`, `docs`, `tests`

- `src/shared/media.ts` (music settings, `CHIPS`, `flowMusicAllowed`), `src/shared/music.ts` (new, the areas, ids, plan types and cues), `src/shared/schemas.ts` (`ROLES` gets `composer`).
- Player: `src/player/audio.ts` (new), `src/player/progress.ts` (`settings.reduceAudio`), `src/player/shells/quiz-arena.ts` (the hooks and the toggle), `src/player/i18n.ts` (two strings, English and Croatian). No CSS and no markup beyond the one toggle (same `label.toggle` as the sound toggle).
- `README.md`, `ROADMAP.md`. `scripts/play.mjs` is unchanged (its media check already loads audio). No file of `src/renderer/**`.

### For EGS-17 (voice)

- `GameAudio.duck(on)` (`src/player/audio.ts`) makes the music quieter while narration or a listening clip plays; nothing calls it yet (the listening renderer is in `src/player/items/`, not touched here). `GameAudio` is created by the quiz arena only; the listening item still uses its own `Audio`.
- Placeholders: `writePlaceholder` already writes `placeholder.wav` for the audio kinds in `AUDIO_KINDS` (`music`, `sfx`, `ambience`); a voice clip kind will need adding there, in `MediaService.mergeFor` (which links every `AUDIO_KINDS` asset that is in the music plan, or all of them when there is no music plan: a voice clip must be linked through its own path or it would be dropped as unplanned) and in `generateAsset`.
- `src/engine/assets/wav.ts` (`toneWav`, `silentWav`) is what the fakes use for real decodable audio; a TTS fake can use it. `MediaMerge.cues` / `loops` and `applyMedia` are the place for `listening.asset` links too.
- The pipeline: `STAGES` has `music`; `voice` is still the skipped hook (`MEDIA_HOOKS`, `STAGE_OF.voice = 'art'`: give it its own stage and run it after the audience review as the EGS-17 plan says). `ROLES` and `PROMPT_VARS` get `voice-director` the way `composer` did.
