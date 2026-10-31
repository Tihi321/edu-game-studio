# EGS-18 Speaking practice: changelog

Scope built: a mic button next to every text input of text-answer items (typed, typed cloze gaps, listening in type mode) of language courses. The transcript fills the input, the learner edits and checks as usual (shared tolerant matcher). Web Speech API and an optional local whisper.cpp endpoint. No pronunciation scoring, no new item kind, typing always works.

## Changed (repo-relative)

Player
- `src/player/speech/{types,settings,wav,whisper-client,web,whisper,toggle,index}.ts`: recognizer interface, `extensions.speaking` (zod, loopback whisper url only), PCM -> 16 kHz mono WAV encoder, whisper client (timeout, error codes), Web Speech and whisper recorders, the title toggle, `createSpeechService`.
- `src/player/items/speak.ts`: the mic button (`speak`, `speak-status`; idle/listening/thinking/error, `aria-pressed`, Escape and second press stop, music ducked while listening).
- `src/player/items/text.ts` (typedBox, cloze), `src/player/items/listening.ts`: the button; locked on reveal, stopped on destroy.
- `src/player/types.ts`: `ItemContext.speech?`. Wired in `src/player/shells/quiz-arena.ts` and `src/player/kit/session.ts`; toggle `setting-speak` on both title screens (`quiz-arena.ts`, `kit/screens.ts`).
- `src/player/progress.ts`: `settings.speak` (default true, old saves normalised). `src/player/i18n.ts`: en and hr strings. `src/player/style/items.css`.

Engine
- `src/engine/stt/whisper.ts` (find whisper-cli and a ggml model from `EDU_WHISPER_DIR` / `EDU_WHISPER_MODEL` / `EDU_WHISPER_CLI`, execFile with timeout, parse), `src/engine/stt/server.ts` (127.0.0.1, port 7464 / `EDU_STT_PORT`, `POST /stt` up to 10 MB, `GET /health`, CORS `null` + loopback origins, Host check).
- `src/engine/index.ts`: starts it only with `EDU_STT=1` or whisper configured; stops it on shutdown.
- `src/engine/mcp/tools-stt.ts` (`edu_stt_status`), one line in `src/engine/mcp/tools.ts` (+ the import).

Docs and tests
- `docs/speaking.md`, pointer in `docs/player.md`.
- `tests/player-speaking.test.ts`, `tests/stt.test.ts`, `tests/speaking.e2e.test.ts`; `tests/player-progress.test.ts` (the round-trip settings now include `speak`).

## Verification

- tsc node, web, player: clean. eslint: clean. Builds: player, engine, electron-vite: ok.
- Tests run, all passed (9 files, 108 tests): stt, player-speaking, player-progress, speaking.e2e, player-shell-kit, edu-mcp, mcp-http, bot.e2e, bot-roleplay.e2e.
- Manual smoke: the real `whisper-cli.exe` with a `ggml-small.bin` model from another repo on this machine, through the endpoint, with a synthetic tone WAV: HTTP 200 and `{text}` in about 4 s (the cli arguments work; no real speech was tried). The path was given through the environment only and is not in the repo.

## Not run

- A real microphone and the real Web Speech service (the e2e uses a fake `SpeechRecognition`).
- The whisper recorder in a browser (`getUserMedia`, ScriptProcessor, the WAV post from the page): the WAV encoder and the client are unit tested, the recorder itself is not.
- The full vitest suite (the parent runs it). Other shell bots (mindmaze, rpg, detective, encyclopedia) were not run.
- `docs/mcp-guide.md`, README.md and ROADMAP.md were not edited (left to the parent).
