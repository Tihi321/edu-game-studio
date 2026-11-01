# EGS-33 German voices

Copied from the HUB-22 plan (creative hub, `.claude/tickets/HUB-22-edu-start-screen-german/plan.md`). User decision: German is voiced by local VibeTTS Supertonic (`supertonic:M2`); Higgs is not installed; Gemini quota is never spent on German.

### EGS-33 German voices
- **Inputs:** `voice.md`, `allocate.ts`, `edu_voice_status`, `edu_voice_quota`; research (Kokoro cannot read German; Supertonic 31 languages, Higgs ~100, OmniVoice 600+, Chatterbox lists `de`).
- **Do:**
  1. Check, with the real services in the live check (not in unit tests): `edu_voice_status` must show which providers read `de`. In code: `reads('de')` for VibeTTS must come from `list_voices` language codes (a probe, not a hard-coded list), and German must not be sent to Kokoro.
  2. Allocation for a language course, stated as a proposal: the clips that need speaking in a language course are the **German listening clips** (and optional narration in the edition language). The hub order is kept (Croatian first, then English, then others, `orderLanguages`): if the course needs Croatian narration clips and they fit the remaining free Gemini quota, they go to Gemini first; **German then goes to Gemini only if its clip count still fits the quota left (10 requests a day, so in practice never for a course: it goes to local VibeTTS)**. Because a whole-language rule makes German local, narration for a language course defaults to **off** (`media.voice` narration flag; the worker finds the real setting name) so the free quota is not spent on Croatian narration that nobody asked for; the brief can turn it on. German local order: VibeTTS (Supertonic or Higgs voice) then ComfyUI TTS (OmniVoice / Chatterbox). `voice.localVoices.de` default is empty (VibeTTS picks); the voice-director may name `supertonic:F1`-style ids only from `list_voices`.
  3. Style for taught German: `fallbackStyle` already says "clear, natural and a little slow"; add a `de` line to the voice-director prompt (standard German, Hochdeutsch, no dialect, one phrase per clip, the article spoken with the noun).
  4. Fix the stale comments (`allocate.ts:11`).
  5. `edu_voice_status` output includes `readsDe` per provider; the course gets a warning (not a failure) when no provider reads German: clips become silent placeholders as the rule says.
- **Outputs:** code, tests with fakes (German: Kokoro-only availability -> placeholders + warning; Supertonic available -> VibeTTS; quota 10 left and 4 hr + 40 de clips -> hr Gemini, de local; no narration default for language courses), docs, ROADMAP row.
- **Contract:** `VoiceAvailability.vibetts.reads('de')` is a probe; `media.voice` narration default false when `targetLang` is set.

Acceptance H1: `tests/voice-allocate.test.ts` cases; `edu_voice_status` shows `readsDe` (live check).
