# EGS-17: voice, the voice-director and the hub's voice rule

Phase 6 of `HUB-19`, third ticket. Branch `EGS-17_voice`, stacked on `EGS-16_music`. One commit. Builds on the media foundation of EGS-15 and the audio player of EGS-16.

## Goal

The pipeline's `voice` hook becomes real: narration and listening items in the target language, spoken by ComfyUI TTS, VibeTTS or Gemini TTS, chosen by the hub's allocation rule, with hash-indexed clips so unchanged text is never spoken again.

## Port from VN Studio (read-only)

`src/engine/voice/comfy-tts.ts`, `voice/jobs.ts` (the hash index, import of clips), `voice/flow.ts` (Gemini / Windows narration through flow-music-mcp's `flow_narrate`, retry and `parseRetryDelayMs`, `QUOTA_MIN_MS`) adapted to courses; their VN tests (`voice-comfy-jobs`, `voice-flow-jobs`, `voice-plan` as far as they apply). `voice/{catalog,config,flow-catalog,vocab}.ts` and `comfy/tts-engines.ts` are already copied.

## Providers

- **ComfyUI TTS** (TTS Audio Suite, as VN Studio: OmniVoice default, reads Croatian; `voice.engine` / `voice.engines`).
- **VibeTTS** (MCP `http://127.0.0.1:7723/mcp`, `config/studios.md` `vibettsUrl`, `EDU_VIBETTS_URL`): `list_voices` (languages, configured voice per language, `supertonic_installed`, `higgs_installed`), `synthesize_to_file {text, output, lang, voice?, speed?, format?, overwrite}` and `synthesize_batch {items: [{text, output, lang, voice?, speed?}], overwrite}` (one call for many clips; preferred). Kokoro reads en/es/fr/hi/it/pt, Supertonic 31 languages (Croatian included), Higgs about 100. VibeTTS is a tray app: **never started by Edu Studio** (not in the autostart list).
- **Gemini TTS**: Google's free Gemini voices through flow-music-mcp `flow_narrate {engine: 'gemini', voice, text, ...}` (the existing `studios/flow.ts` client), as VN Studio does. Free, but the free tier allows **10 requests a day**. Never the paid Flow engine.

## The hub's allocation rule (pure, unit-tested: `src/engine/voice/allocate.ts`)

- A daily counter of Gemini requests in the data folder (`state/gemini-tts.json`: `{day, used}`; the day in a configurable time zone, default `America/Los_Angeles` because the free tier resets at Pacific midnight; `config/voice.md`: `geminiDailyLimit: 10`, `geminiResetTz`). Every `flow_narrate` request that reaches Gemini counts (a retry too); a quota error (429 with a long retry delay, `QUOTA_MIN_MS`) sets `used` to the limit for that day.
- `remaining = limit - used`. Languages are allocated whole (a language never mixes providers within one run), Croatian first:
  1. Croatian: if its clips needing generation fit in `remaining`, Gemini; else local.
  2. Then each other language (English next): if its clips fit in what is left, Gemini; else local. So if hr and en are both needed and together exceed the remaining quota, Croatian goes to Gemini and English to local.
  3. Local means VibeTTS when it reads that language (from `list_voices`; Kokoro for English, Supertonic or Higgs for Croatian), else ComfyUI TTS; when the chosen local provider is down, the other local one; when nothing can speak, placeholders and warnings (never a failed run).
  4. Gemini down (flow-music-mcp not running or signed out) or a quota error mid-run: the rest of that language falls back to local; clips already made stay.
- Course setting `media.voice.provider`: `auto` (the rule, default), `gemini`, `vibetts`, `comfy` (forced; `gemini` still respects the quota and falls back). The allocation is recorded per language in `pipeline/voice.json` and shown by `edu_voice_status`.

## What the voice-director plans

New role `voice-director` (agent, prompt, roles.md, zod contract with a repair round, deterministic fallback):

- **Narration**: short narration in the source language (unit intros, article bodies or their summary: the director picks, short text beside the audio as design rule 8 says), the voice per language and the delivery style.
- **Listening in the target language** (language courses): audio for every `listening` item's transcript (hand-made items too); and listening items derived from taught phrases that already passed the fact-check (same objective and `extensions.facts` as the source item, `mode: type` with the source's accepted answers, or `choose` with its options), so a language course has listening practice. Derived items have stable ids (`<sourceItemId>-listen`).
- Clip ids `voice-<lang>-<key>` (the text key, sanitized); the hash index (`voice/<lang>/index.json` style, from `voice/jobs.ts`) holds `sha1(text + lang + voice + style + speed + format)`: a clip whose hash did not change is not spoken again, whatever provider made it; changed text makes a new version.

## Pipeline, pack, player

- `voice_plan` (voice-director) -> `voice_generate` (no model). Voice runs **after** the audience review / polish loop (so it speaks the final text) and re-links the pack (re-run the assemble merge) before `build`. Resumable, idempotent.
- Pack: audio assets (`kind: audio`, alt key), `listening.asset` set, narration linked where the player shows it (`article.asset` is an image; narration goes in `extensions` of the pack, e.g. `extensions.narration = {<textKey>: assetId}`, unless a minimal schema addition is cleaner: say which). The quiz arena needs no narration UI in this ticket beyond listening; note the encyclopedia shell (EGS-10) as the consumer.
- The golden fixture `hr-a1-greetings` has tone placeholders for its listening items (`scripts/make-fixture-audio.mjs`): `edu_voice_generate` on a copy of it with a fake TTS replaces them, lint then shows 0 `PLACEHOLDER_ASSET` (do not change the committed fixture unless needed; say so).

## MCP tools (`docs/mcp-guide.md`)

`edu_voice_plan {slug}`, `edu_voice_generate {slug, lang?, force?}` (queues the job), `edu_voice_status` (extended: the providers, VibeTTS voices and languages, Gemini quota today `{limit, used, remaining, day}`, the allocation of a course with `slug`), `edu_voice_quota {}` (read; and `{reset: true}` only for tests or a manual fix: your call), `edu_voice_import {slug, lang, key, file}` (a hand-made clip). `edu_studios_status` lists VibeTTS.

## Tests (fakes only, autostart off)

- **Allocation rule** (pure): quota math per day and time zone, the counter persisting and resetting on a new day, Croatian preferred, hr + en over the remaining quota -> hr Gemini, en local, both fit -> both Gemini, neither fits -> both local, a language never split, a quota error mid-run falls back, Gemini down falls back, VibeTTS not reading a language -> ComfyUI, everything down -> placeholders.
- Generation with fakes: VibeTTS (a fake MCP server: `synthesize_batch` writes real WAVs), Gemini (the flow fake's `flow_narrate`, counted), ComfyUI TTS (fake), hash index (second run speaks nothing; changing one text speaks one clip).
- Pipeline end to end with **every asset kind** (image, pixel sprite/tile, music, SFX, TTS clip): a language course (hr target, en source) with shells including `rpg`: published, 0 placeholders, `edu_lint` clean (0 errors, 0 warnings), the real bot (when Chromium launches) plays with sound on, audio files present, 0 console errors and 0 media errors.
- The MCP tools.

## Acceptance

`yarn typecheck`, `yarn lint`, `yarn test`, `yarn build` pass (counts in the changelog). Docs: `docs/mcp-guide.md`, `README.md`, `ROADMAP.md` (EGS-17 to Done, phase 6 status), `seed/config/voice.md` and `studios.md`. Live: the orchestrator may make one short clip with VibeTTS if it is already running; nothing else is started.

## Results

Implementer results (the orchestrator adds the live check and the changelog counts):

**Done**

- Role `voice-director`: `seed/agents/voice-director-elodie-brandt.md`, `seed/prompts/voice-director/plan.md` (variables registered as `'voice-director/plan'` in `src/engine/edu/authoring.ts`, equal to `voicePromptVars`), `ROLES` in `src/shared/schemas.ts`, `seed/config/roles.md` (models and description). Output contract with one repair round and the deterministic fallback (`src/engine/edu/voice.ts`). No renderer file changed (the roles test keeps `voice-director` in its "picker lags behind" list).
- Providers and rule: `src/engine/voice/{allocate,quota,speak,run}.ts`, `src/engine/studios/vibetts.ts` (VibeTTS MCP client, never started), `edu/voice-service.ts`; the hash index lives in the asset manifest (`kind: voice`, `voice.hash`).
- Pipeline: the `voice` hook is replaced by `voice_plan` (voice-director) and `voice_generate` (no model). Stage `voice` (between `review` and `build`; writes `voice.json`; `restart from: "voice"` works). Skipped with a reason when the voice step is off (`media.voice.enabled: false`, or not a language course without `enabled: true`). Resumable and idempotent (a second run or `restart from: voice` speaks nothing).
- Pack: clips are `kind: audio` assets with an alt key; `listening.asset`; derived `<item>-listen` items after their source; narration in `pack.extensions.narration = {<text key>: <clip id>}`. `MediaService.mergeFor` builds the `VoiceMerge` (`voiceMergeOf`), `assemble` passes the target catalog to `applyMedia`.
- MCP tools: `edu_voice_plan`, `edu_voice_generate`, `edu_voice_status` (extended: providers, quota, course status, allocation preview), `edu_voice_quota`, `edu_voice_import`; `edu_studios_status` lists VibeTTS. Jobs `asset_voice_plan` / `asset_voice_generate` (like the music ones).
- Seed config: `seed/config/voice.md` (geminiDailyLimit, geminiResetTz, narrationMaxChars, the hub rule), `seed/config/studios.md` (vibettsUrl, vibettsToken). Docs: `docs/mcp-guide.md` (new "Voice" section, pipeline diagram, settings), `docs/design.md`. README.md and ROADMAP.md not touched.
- Tests (fakes only, autostart off): new `voice-allocate` (15), `voice-generate` (19), `voice-plan` (15), `voice-pipeline` (11: every asset kind end to end, idempotency and resume, unusable director, every provider down, voice off / narration only, the real bot, the tools on a copy of the golden fixture). Test fakes: `FakeVibeTts` (studio-fakes), `FakeFlow.narrate` writes a real wav and records `spoken`, `makeEduEnv` hands the VibeTTS fake and an instant sleep to the engine, a `voice-director` mock in `pipeline-helpers`.
- Updated tests: `voice-catalog` and `studios-flow-client` (provider `vibetts` is valid now, `flow` becomes `gemini`, the default is `auto`), `roles-config`, `pipeline` (the skipped list is now `voice_generate:all`, `voice_plan:all`).
- Checks (implementer run): `yarn typecheck` 0 errors, `yarn lint` clean, `yarn build` ok, `yarn test`: 68 files, 969 tests, 968 pass; the one failure was `bot.e2e` hr-a1-greetings "random 75 %", fixed by the orchestrator (see below).

**Deviations and decisions**

- Voice sits after the audience review / polish loop and before `build`, as the plan says (not right after music). The audience reviewers therefore judge the pack without the derived listening items; the derived items come from items that passed the fact-check.
- Narration storage: `pack.extensions.narration` (no schema change). The encyclopedia shell (EGS-10) is the consumer; the quiz arena has no narration UI.
- A derived item is made again from its source on every plan (so a re-plan or `restart from: voice` keeps it); previously the source item was excluded once it had its `-listen` item, which would have dropped the derived items on a re-plan (fixed in `buildVoiceSource`).
- `applyVoice` keeps a catalog string that is already there (a derived transcript corrected by hand stays; the clip speaks the catalog text) and, when a clip replaces a tone placeholder, removes the placeholder's alt string and the parenthetical that says "placeholder" from the item's explanation/hint/prompt. Without that the lint reports `PLACEHOLDER` errors on the stale texts of the golden fixture after `edu_voice_generate`. The committed fixture is not changed.
- `MediaService.summary` (and so `edu_status.media`) counts the spoken clips in `audio`, `audioMade`, `audioPlaceholders`.
- `shortenForSpeech` also drops `[f1]` citation markers.
- A `edu_lint` right after `edu_voice_generate` without `rebuild: true` lints the build from before (the build is stale until `edu_build`): the tests use `rebuild`.

**Not done / not verified**

- Not run against the real Gemini or ComfyUI TTS (fakes only): the real `flow_narrate` behaviour (429 text, retry delay) is UNTESTED. VibeTTS was checked live once by the orchestrator (below): the `synthesize_batch` result shape matches; Croatian quality is unheard.
- `docs/player.md` still says "EGS-17 calls `duck(on)`": no item renderer calls it (the player is outside this slice).
- The playtest runs through `runPlaytest` with Chromium in the voice-pipeline test: Chromium launched (the real bot test ran, not skipped).

### Orchestrator verification (2026-10-30)

- `yarn typecheck` passes; `yarn lint` passes; `yarn test` **68 files, 969 tests, all passing** (EGS-16 baseline 64 files, 909 tests: +4 files, +60 tests); `yarn build` passes.
- **The `bot.e2e` hr-a1-greetings "random 75 %" failure is fixed, not flaky.** Root cause found with an instrumented bot: after the `g-formal-sort` item the pointer rests on the edge of the Next button; `.btn:hover` lifts the button 1 px (`translateY(-1px) rotate(-0.4deg)`), the button leaves the pointer, un-hovers, drops back, hovers again, so it jitters forever (a real UI bug, also for a mouse user) and Playwright's click waits for "stable" until it times out. Fix in `src/player/style/theme.css`: `.btn` gets `position: relative` and a transparent `::after` with `inset: -4px` that moves with the button, so the hover area always covers the pointer. Before: 5 of 8 bot runs (seed 3) failed; after: 0 of 10, and the full suite passes. The same failure was present on the EGS-15 and EGS-16 commits.
- **Live VibeTTS check** (VibeTTS was already running on 7723; ComfyUI 8188, Pixel Studio 7457, Chiptune Studio 7458 and flow-music-mcp 7462 were down and not started): `createVibeTtsClient` `list_voices` gave 51 voices, Supertonic installed, Higgs not; `vibeVoiceFor` picked `supertonic:F1` for hr and `am_michael` for en; one `synthesize_batch` call made "Dobar dan!" (hr, 1.39 s, 122 924 bytes) and "Good afternoon!" (en, 1.17 s, 103 532 bytes) as WAV in 2.0 s. The real result shape `{output, durationS/duration_s, ok}` matches the client's assumption. Not played by a person (quality unheard). Gemini and ComfyUI TTS live: UNTESTED.
