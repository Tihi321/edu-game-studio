# EGS-38 changelog: listening passages (optional, HUB-22)

## Changed
- `src/shared/voice.ts`: role `passage`; `passageChunks` (paragraphs of a body, a long one split at sentence ends, 450 characters), `passageClipId` (`art-<articleId>-p<n>[-<k>]`), `spokenText` (narration cut / passage piece / as is); clips get `paragraph` and `part`.
- `src/shared/media.ts`: `media.voice.passages` (default false); asset `voice.role` accepts `passage`.
- `src/engine/edu/voice.ts`: `VoiceSource.passages` (articles whose body is in the target language), `limits.passages` (language courses only), deterministic passage clips in `buildVoicePlan` (no new role, nothing added to the model prompt), default German voice `supertonic:M2` in the plan voices (`DEFAULT_PASSAGE_VOICE_DE`).
- `src/engine/voice/allocate.ts`: `localOnly` input; `run.ts` passes the languages that have passage clips (`passageLangs`), so they never go to Gemini whatever the quota; `voice-service.ts` does the same in the preview and uses `spokenText`, so the hash index re-speaks only paragraphs whose text changed. `edu_voice_plan` and `edu_voice_status` show `passages` and `passageCharacters`. `media.ts` merge: passage clips are not narration or listening links.
- Reader (`view-reader.ts`, `strings.ts` en+hr, `encyclopedia.css`): `reader-play-<n>` per paragraph that has a clip, `reader-play-all`; `passageUrls` helper.
- Docs: `docs/mcp-guide.md`; `ROADMAP.md` row.
- Tests: 6 cases in `tests/voice-plan.test.ts`, 1 in `tests/player-reader-logic.test.ts`.

## Status
- DONE: option `media.voice.passages`; per-paragraph plan with stable ids; local-only routing; placeholders via the usual voice path; hash skip of unchanged paragraphs (unit-tested through `spokenText`); plan shows clip and character counts; reader buttons; docs; ROADMAP.
- NOT DONE: German UI strings for the new reader keys (EGS-34 owns the `de` tables); a browser/bot check of the play buttons.
- UNTESTED: real audio (VibeTTS Supertonic `supertonic:M2` was not run); playback in a browser; quality of the German speech.
