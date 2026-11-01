# EGS-33 changelog

## Changed

- `src/engine/voice/allocate.ts`: new `voiceReads(voice, lang)`, the one place that decides whether a VibeTTS voice reads a language. It is built on the language codes `list_voices` returns (a probe, no hard-coded list of readable languages) and refuses Kokoro for `de` and `hr`. The stale comment about local voices is fixed.
- `src/engine/voice/run.ts` and `src/engine/edu/voice-service.ts`: the availability probe, the voice choice (`vibeVoiceFor`) and the allocation preview use `voiceReads`. German therefore never goes to Kokoro.
- `src/shared/media.ts`, `src/engine/edu/voice.ts`: `media.voice.narration` is optional. Missing means on, except for a language course (`targetLang` set), where it is off. `true` turns it on. New `narrationOn`, and `limitsOf(media, languageCourse)`; `buildVoicePlan`, `voicePromptVars`, `plan` and `planFromText` pass `!!src.targetLang`. German is not allocated to Gemini in practice because 10 requests a day never fit a course (the existing whole-language rule, unchanged).
- `fallbackStyle`: a taught `de` style says standard German (Hochdeutsch, no dialect).
- `seed/prompts/voice-director/plan.md`: a `de` paragraph (Hochdeutsch, no dialect, one phrase per clip, the article spoken with its noun, no Gemini voice for German).
- `edu_voice_status` (`VoiceService.providers`): `readsDe` per provider (`vibetts`, `comfy`), `vibetts.readsDe`, and a `warnings` entry when no local provider reads German (the clips become silent placeholders, never a failed run).
- Docs: `seed/config/voice.md`, `docs/mcp-guide.md` (Voice). `ROADMAP.md` row.
- Tests: `tests/voice-allocate.test.ts` (Kokoro-only -> no provider; probe; Supertonic -> VibeTTS; 10 left with 4 hr and 40 de -> hr Gemini, de local), `tests/voice-plan.test.ts` (narration default, German style), `tests/voice-pipeline.test.ts` (`readsDe`; existing language-course tests now set `narration: true` explicitly because the default changed).

`voice.localVoices.de` is still empty by default (VibeTTS picks; the user configures `supertonic:M2`). No engine code was copied or changed apart from the files above.

## Status

- DONE: `reads('de')` is a probe of `list_voices` codes and Kokoro never gets German; German local order VibeTTS then ComfyUI TTS; narration off by default for language courses; `de` style line in the voice-director prompt and the fallback style; stale comment fixed; `readsDe` per provider plus a warning when none reads German; docs and ROADMAP row.
- DONE: unit tests with fakes for every case listed in the ticket.
- UNTESTED: real German audio, a real `edu_voice_status` against the running VibeTTS (`supertonic:M2`), and the live check of acceptance H1. Nothing was run against real services.
