# EGS-18 Speaking practice

Scope: "speak your answer". A mic button next to every text input of text-answer items (typed, cloze typed gaps, listening in type mode) in language courses. The transcript fills the input; the learner edits and submits as usual; the shared tolerant matcher checks it. No new item kind, no pronunciation scoring, typing always works. No recognizer: no button.

## Player (src/player/speech/)
- `types.ts` SpeechService / SpeechSession / handlers; `settings.ts` zod-validated `pack.extensions.speaking` (`enabled`, `whisperUrl` loopback only); `wav.ts` pure PCM -> 16 kHz mono WAV; `whisper-client.ts` POST WAV, JSON `{text}`, timeout, error codes; `web.ts` Web Speech recognizer; `whisper.ts` mic capture recognizer; `index.ts` `createSpeechService`.
- `src/player/items/speak.ts` mic button (`data-testid=speak`, aria-pressed, live region, Escape/second press stops, ducks music); used by `typedBox` and cloze.
- `ItemContext.speech?`, wired in quiz-arena and kit session. Learner setting `settings.speak` (default true, normalised in progress.ts), toggle + privacy note on both title screens; en and hr strings.

## Engine
- `src/engine/stt/whisper.ts` (find whisper-cli + ggml model from `EDU_WHISPER_DIR`/`EDU_WHISPER_MODEL`, execFile with timeout), `src/engine/stt/server.ts` (127.0.0.1, port 7464 / `EDU_STT_PORT`, POST /stt <= 10 MB, GET /health, CORS only null/loopback), started from index.ts only when `EDU_STT=1` or whisper configured. MCP tool `edu_stt_status` in `tools-stt.ts`.

## Tests / docs
wav, whisper (fake cli), server, settings, progress normalisation, Playwright e2e with a fake SpeechRecognition; bot e2e unchanged. `docs/speaking.md`, pointer in docs/player.md.
