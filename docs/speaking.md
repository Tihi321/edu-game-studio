# Speaking practice (EGS-18)

"Speak your answer": in a language course, every text answer (a typed item, the typed gaps of a cloze, a listening item in type mode) has a microphone button next to the input. The learner speaks, the transcript fills the input, the learner can edit it and checks as usual. The shared matcher (case, diacritics, one-letter typos per the course policy) does the checking, so a recogniser that mishears one letter still passes. It is not a pronunciation scorer, it adds no item kind (the item contract and the autoplay bot are unchanged) and typing always works. A browser with no recogniser shows no button.

## What the learner sees

- The button `speak` (`aria-pressed="true"` while it listens). A second press or Escape stops; the keyboard works like on any button. A live region (`speak-status`) says "Listening", "Heard: ..." or why it failed (microphone refused, nothing heard, recogniser not available).
- In a cloze, one button serves all typed gaps: the transcript goes into the gap in focus, else the first empty gap.
- While the microphone listens the music is ducked (`ItemContext.duck`), so it does not drown the voice.
- Both title screens (quiz arena and the shell kit) have a switch "Speak your answers" (`setting-speak`, saved as `settings.speak`, default on; an older save without it means on) with a one-line privacy note. The switch and the button are absent when the course has no speech service.

## Settings of a course

`pack.extensions.speaking` (free-form `extensions`, validated by the player; the strict pack schema is unchanged):

```json
{ "enabled": true, "whisperUrl": "http://127.0.0.1:7464" }
```

- `enabled`: default true for a course with `targetLang`, false for any other (a course without a target language never shows the button; `false` switches it off for a language course).
- `whisperUrl`: a local whisper endpoint (below). Only `http(s)://127.0.0.1`, `localhost` or `[::1]` are accepted; anything else is ignored, so the audio can never be sent to a remote address by the pack. Without it the browser's recogniser is used; with it, and when the browser can record, whisper wins.

The recogniser language is the course's `targetLang`.

## Privacy

- **Web Speech API** (the default): in Chromium based browsers (Chrome, Edge) the audio is sent to the browser vendor's speech service; the player cannot change that. Other browsers may have no recogniser at all (no button then). The title screen says so next to the switch.
- **whisper mode**: fully local. The player records the microphone, makes a 16 kHz mono WAV in the page and posts it to the local endpoint of the engine; nothing leaves the machine.

## The local whisper endpoint

`src/engine/stt/` (no dependencies besides node): `whisper.ts` runs `whisper-cli` (whisper.cpp) with `-nt -l <lang> -f <wav> -m <model>`, `server.ts` is a small HTTP server on **127.0.0.1 only**.

- `POST /stt?lang=hr`: body = a WAV (16 kHz mono 16-bit), at most 10 MB (413 above, 400 when it is no WAV) -> `{"text": "..."}`; 500 with `{"error"}` when whisper fails. One recognition runs at a time.
- `GET /health` -> `{"ok": true, "whisper": {"configured", "ready", "reason"?}}`.
- CORS and Host: only the `null` origin (a game opened from `file://`) and `http://127.0.0.1` / `http://localhost` (any port) are allowed; another Origin or Host gets 403.

Nothing is installed or downloaded. Environment:

| Variable | Meaning |
|---|---|
| `EDU_STT=1` | start the endpoint with the engine |
| `EDU_WHISPER_DIR` | folder with `whisper-cli(.exe)` (also `bin/`, `build/bin/`, `build/bin/Release/`) and usually `models/`; setting it also starts the endpoint |
| `EDU_WHISPER_MODEL` | a ggml model file, absolute or relative to `EDU_WHISPER_DIR` (and its `models/`); default the first `ggml-*.bin` found |
| `EDU_WHISPER_CLI` | an explicit path of the cli (a `.js` file is run with node: the tests use one) |
| `EDU_STT_PORT` | port, default 7464 |

The endpoint is off by default: the engine starts it only when `EDU_STT=1` or one of the whisper variables is set. Run it with the engine (`EDU_STT=1 EDU_WHISPER_DIR=<folder> yarn engine`), then add `speaking.whisperUrl` to the course. The MCP tool `edu_stt_status` tells whether it runs and whether whisper-cli and a model are found.

## Tests

`tests/player-speaking.test.ts` (WAV encoder, settings, recogniser choice, whisper client, the `speak` setting), `tests/stt.test.ts` (whisper wrapper with a fake cli, server), `tests/speaking.e2e.test.ts` (Chromium with a fake `SpeechRecognition`, keyboard, axe). Not covered by tests: a real microphone and the real Web Speech service.
