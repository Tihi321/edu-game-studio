# EGS-17 changelog

## 2026-10-30: voice, the voice-director and the hub's voice rule

Branch `EGS-17_voice` (stacked on `EGS-16_music` 8a99a20), one commit `EGS-17: ...`; not pushed. Resumed from a stopped run: the providers, the allocation rule, the quota, the run and the voice service were written then (a syntax error in `studios/vibetts.ts` fixed); the role, the pipeline steps, the merge, the tools, the seed, the docs and every test were added in this run.

**Verification:** `yarn typecheck` and `yarn lint` pass; `yarn test` **68 files, 969 tests, all passing** (EGS-16 baseline 64 files, 909 tests: +4 files, +60 tests); `yarn build` passes. Real Chromium launched: the bot plays the end-to-end language course (hr taught in en, shells quiz arena + RPG) as `perfect` and `average` with sound on: finished, 0 console errors, 0 media errors, `media: {checked: true, images: 10, audio: 18}`. Live: one VibeTTS `synthesize_batch` (VibeTTS was already running; nothing was started). Details: `plan.md` Results.

### What changed (repo-relative)

**Voice core (new)**
- `src/shared/voice.ts`: clip ids `voice-<lang>-<key>` (long keys cut with a short hash), `shortenForSpeech` (narration cut at a sentence, citation markers dropped), the plan file `pipeline/voice.json` types, `VoiceMerge`, the derived-item marker `extensions.voice.derivedFrom`.
- `src/engine/voice/allocate.ts`: the hub's rule, pure. `remaining = limit - used`; languages allocated whole, Croatian first, then English, then the rest; a language whose clips fit goes to Gemini, else local (VibeTTS when it reads it, else ComfyUI TTS; `comfy` forced tries ComfyUI first); nothing can speak: provider `none` (placeholders).
- `src/engine/voice/quota.ts`: `GeminiQuota`, the daily counter in `state/gemini-tts.json` (`{day, used}`), the day in `geminiResetTz` (default `America/Los_Angeles`), serialised read-modify-write; `add` before every request (retries count), `exhaust` on a quota 429, `reset`.
- `src/engine/voice/speak.ts`: the speakers. Gemini via flow-music-mcp `flow_narrate` with `engine: 'gemini'` only (never the paid Flow engine), retry/backoff, `parseRetryDelayMs`, `QUOTA_MIN_MS` (a long retry delay exhausts the day); VibeTTS `synthesize_batch` in batches of 12; ComfyUI TTS Audio Suite. A provider that is down or out of quota stops and hands the rest on.
- `src/engine/voice/run.ts`: `runVoice`: the hash index (`sha1(text, lang, gemini voice, vibetts voice, style, speed, format)` in the manifest entry's `voice.hash`; unchanged = not spoken, changed = new version; imported and locked clips kept), probing, allocation, the provider chain, silent placeholders and warnings for what nothing could speak (never a failed run); manifest saved after every clip.
- `src/engine/studios/vibetts.ts`: VibeTTS MCP client (`list_voices`, `synthesize_batch`, `synthesize_to_file`), never started by Edu Studio.
- `src/engine/edu/voice.ts`: the voice-director's source (narration candidates, listening rows, taught phrases), the zod contract with checks, the deterministic fallback, `buildVoicePlan`, `deriveListening` (`<item>-listen`, same objective and facts, `type` or `choose`), `mergeVoicePlan`, the prompt vars.
- `src/engine/edu/voice-service.ts`: `VoiceService` (`EduService.voice`): plan (model with one repair round, else fallback), generate (re-links the pack), import a hand-made clip, providers, course status, allocation preview, quota.

**Wiring (changed)**
- `src/shared/media.ts`: `VOICE_PROVIDERS` `auto | gemini | vibetts | comfy` (default `auto`; old `flow` becomes `gemini`, `vibetts` is valid again); `voice.enabled` optional with `voiceEnabled()` (default: on for a language course); `narration`, `listening`, `listeningPerUnit` (3), `localVoices`; asset kind `voice` with the `voice` block; `VOICE_KIND`, `SOUND_KINDS`.
- `src/engine/edu/media.ts`: `mergeFor` builds the voice merge (`voiceMergeOf`); `summary` counts clips in `audio`, `audioMade`, `audioPlaceholders`.
- `src/engine/edu/media-link.ts`: `applyVoice`: derived items after their source (dropped ones removed), their strings (an existing catalog string is kept), `listening.asset`, narration in `pack.extensions.narration`, unused placeholder audio dropped with its alt string and the "(... placeholder ...)" note in the item texts.
- `src/engine/edu/store.ts`, `assemble.ts`: the merge also writes the target-language catalog.
- `src/engine/edu/pipeline.ts`, `pipeline-handlers.ts`: stage `voice` between `review` and `build`; steps `voice_plan` (voice-director) -> `voice_generate` (no model), skipped with a reason when voice is off; jobs `asset_voice_plan`, `asset_voice_generate`; the `MEDIA_HOOKS` stub is gone.
- `src/engine/edu/service.ts`, `src/engine/engine.ts`: `deps.vibetts`, `deps.voiceRuntime` (clock and sleep for tests); VibeTTS in `studios()` and `studiosStatus`.
- `src/engine/studios/config.ts`: `vibettsUrl` (`EDU_VIBETTS_URL`), `vibettsToken` (`VIBETTS_MCP_TOKEN`), `vibettsClientFor`, start hint. `src/engine/voice/config.ts`: `geminiDailyLimit` (10), `geminiResetTz`, `narrationMaxChars` (600).
- `src/engine/assets/{generate,import,placeholder}.ts`: a `voice` asset is skipped by the picture/music generator, imports and placeholders treat it as a sound.
- `src/engine/mcp/tools-media.ts`, `tools.ts`, `server.ts`: `edu_voice_plan`, `edu_voice_generate`, `edu_voice_status` (moved and extended: providers, VibeTTS voices, Gemini quota today, course status, allocation preview), `edu_voice_quota {reset?}`, `edu_voice_import`.
- `src/shared/schemas.ts` (`ROLES` + `voice-director`), `src/engine/edu/authoring.ts` (`'voice-director/plan'` vars), `src/shared/protocol.ts` (`StudioStatusView.id` + `vibetts`).
- **Player:** `src/player/style/theme.css`: `.btn` gets `position: relative` and a transparent `::after` (`inset: -4px`) so the 1 px hover lift no longer moves the button out from under a pointer resting on its edge (it jittered forever; root cause of the `bot.e2e` hr "random 75 %" failures since EGS-03).

**Seed and docs**
- `seed/agents/voice-director-elodie-brandt.md`, `seed/prompts/voice-director/plan.md` (new), `seed/config/roles.md`, `seed/config/voice.md` (the hub rule and the quota settings), `seed/config/studios.md` (VibeTTS).
- `docs/mcp-guide.md` ("Voice" section, pipeline diagram, settings), `docs/design.md`, `README.md`, `ROADMAP.md` (EGS-17 to Done, phase 6 done).
- `.claude/tickets/EGS-15-art/`, `.claude/tickets/EGS-16-music/`: re-verification entries (below).

**Tests**
- New: `tests/voice-allocate.test.ts` (15: quota math, day rollover at Pacific midnight, bad time zone, exhaust/reset, Croatian first, hr+en over quota -> hr Gemini / en local, both fit, neither fits, never split, forced providers, Gemini down, VibeTTS not reading a language, all down), `tests/voice-generate.test.ts` (19: providers with fakes, hash index, one changed text = one clip, quota 429 mid-run falls back and keeps made clips, providers down, placeholders, `parseRetryDelayMs`, the VibeTTS client), `tests/voice-plan.test.ts` (15), `tests/voice-pipeline.test.ts` (11: every asset kind end to end, idempotency and `restart from: voice`, unusable director, all providers down, voice off / narration only, the real bot, the tools on a copy of `hr-a1-greetings`).
- Changed: `tests/studio-fakes.ts` (`FakeVibeTts`), `tests/flow-fakes.ts` (`narrate` writes a real WAV tone, records `spoken`), `tests/edu-helpers.ts`, `tests/pipeline-helpers.ts` (voice-director mock), `tests/pipeline.test.ts`, `tests/roles-config.test.ts`, `tests/voice-catalog.test.ts`, `tests/studios-flow-client.test.ts`.

### Deviations from the plan
- Voice sits after the audience reviews (as planned), so the reviewers never see the derived listening items; those come only from items that passed the fact-check.
- Narration lives in `pack.extensions.narration` (no schema change); the quiz arena has no narration UI; the encyclopedia shell (EGS-10) is the consumer.
- `applyVoice` strips the "(... placeholder ...)" parenthetical from a listening item's texts when its tone placeholder is replaced (narrow, aimed at the fixture pattern), else the lint reports `PLACEHOLDER` on the golden fixture copy.
- A derived item is rebuilt from its source on every plan (the stopped run's code would have dropped derived items on a re-plan).
- A player CSS fix outside the media scope (the hover jitter), because the EGS-15/16 verification failed on it.

### Verification
- Run: `yarn typecheck` (pass), `yarn lint` (pass), `yarn test` (68 files, 969 passed), `yarn build` (pass).
- Bot flake: before the CSS fix 5 of 8 direct bot runs (`--mode random --seed 3 --accuracy 0.75` on `hr-a1-greetings`) failed on the Next button after `g-formal-sort` ("element is not stable": its box alternated between y 719.4 and 719.6 with the hover transition restarting); after the fix 0 of 10, and the full suite passes.
- EGS-15 (40a6b28) and EGS-16 (8a99a20) re-verified on their exported trees: typecheck and lint pass; tests 833 (832 pass) and 909 (908 pass), the single failure being the same hover-jitter bot run.
- Live: VibeTTS (7723, already running) through `createVibeTtsClient`: `list_voices` 51 voices (Supertonic installed, Higgs not), `supertonic:F1` chosen for hr, `am_michael` for en; one `synthesize_batch` made 2 WAV clips ("Dobar dan!" 1.39 s, "Good afternoon!" 1.17 s) in 2.0 s; the result shape matches the client.
- Not run: Gemini TTS (flow-music-mcp down, and no request may be spent), ComfyUI TTS (ComfyUI down), a person listening to any clip, Electron window.

### Follow-ups and known limitations
- `GameAudio.duck(on)` is still not called when a listening clip plays (`docs/player.md` says so); the player's item renderers are outside this ticket.
- Integration: stack A (EGS-05) moved the button styles to `src/player/style/items.css` (`.edu-stage .btn:hover`); the hover-area fix must be re-applied there when stack B is rebased onto stack A, or the bot flake returns.
- `src/renderer/ui/roles.ts` `KNOWN_ROLES` still lacks `art-director`, `art-critic`, `composer` and `voice-director` (the agents picker lags; the integration ticket aligns it).
- `edu_lint` right after `edu_voice_generate` lints the old build unless `rebuild: true`.

### Commit status
Committed as one commit `EGS-17: ...` on `EGS-17_voice`; not pushed.
