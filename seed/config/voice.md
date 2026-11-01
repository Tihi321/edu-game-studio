---
kind: voice
# The clip format: mp3 (small) or wav.
format: mp3
# Speech speed, 0.5 to 2, for the engines that take one (OmniVoice, F5-TTS).
speed: 1
# A long line is split for the TTS node after this many characters (100-1000).
chunkChars: 400
# Google's free Gemini TTS allows this many requests a day (every flow_narrate call that reaches Gemini counts, a retry too).
geminiDailyLimit: 10
# The day of that counter ends at midnight in this time zone (Google resets the free tier at Pacific midnight).
geminiResetTz: America/Los_Angeles
# A narration clip speaks at most this many characters (a longer text is cut at a sentence).
narrationMaxChars: 600
---
# Voice

How the spoken lines and the sound effects are made. A course's spoken clips (narration, and the audio of the listening items of a language course) are made by three providers: Google's free **Gemini** voices (through flow-music-mcp, never the paid Flow engine), **VibeTTS** (the local tray app: Kokoro, Supertonic, Higgs) and the local ComfyUI **TTS Audio Suite** engines. Which one speaks is decided by the hub's voice rule below, unless the course forces one with `media.voice.provider` (`auto` is the default; `gemini`, `vibetts`, `comfy`).

## The hub's voice rule

- Gemini's free tier allows `geminiDailyLimit` requests a day (10). Edu Studio counts every request that reaches Gemini (a retry too) in `state/gemini-tts.json` (`{day, used}`); the day ends at midnight of `geminiResetTz`. A quota error from Google sets today's count to the limit. `edu_voice_quota` shows it; `{reset: true}` is for tests or a manual fix.
- `remaining = limit - used`. Languages are allocated whole (a language never mixes providers in one run), **Croatian first**: if the clips of a language that need speaking fit in what is left, that language goes to Gemini, else it goes local. So when Croatian and English are both needed and together exceed what is left, Croatian goes to Gemini and English to the local voices. A clip whose text, language, voice and style did not change is not spoken again, so the count only grows for new or changed texts.
- Local means VibeTTS when it reads the language (Kokoro: English, Spanish, French, Hindi, Italian, Portuguese, never Croatian or German; Supertonic: 31 languages, Croatian and German included; Higgs: about 100). What VibeTTS reads is a probe of the language codes `list_voices` returns, not a list in code, else ComfyUI TTS. When the chosen provider is down the other local one takes over; when nothing can speak, the clip gets a silent placeholder and a warning (the lint warns PLACEHOLDER_ASSET), never a failed run.
- **German** (a language course taught in `de`): the same rule applies, but with 10 requests a day German never fits, so it goes to local VibeTTS (Supertonic, e.g. `voice.localVoices.de: supertonic:M2`, or Higgs) and then ComfyUI TTS (OmniVoice, Chatterbox); it is never sent to Kokoro. Narration of a language course is **off** by default (`media.voice.narration: true` turns it on), so the free Gemini quota is not spent on narration nobody asked for. `edu_voice_status` shows `readsDe` per provider and a warning when none reads German (the clips become silent placeholders).
- Gemini down (flow-music-mcp not running or not signed in) or a quota error mid-run: the rest of that language goes local; clips already made stay.
- `geminiDailyLimit`, `geminiResetTz`, `narrationMaxChars`: the daily Gemini limit, the time zone of its day and the longest narration clip in characters.

## The local engines

- `format`, `speed`: the clip format and the speech speed. A clip whose text, engine, reference clip, transcript, style, speed, format and chunk length did not change is skipped.
- `chunkChars`: a long beat is split for `UnifiedTTSTextNode` after this many characters and the pieces are crossfaded.
- The engines: **OmniVoice** (600+ languages; the default, `voice.engine: omnivoice`, and it reads Croatian), **Higgs Audio v3** (100+ languages, delivery tags inline in the text), **Chatterbox 23 languages**, **VibeVoice** (English and Chinese), **Qwen3-TTS** (10 languages, cloning), **IndexTTS-2** (5 languages, cloning) and **F5-TTS** (10 languages, cloning; it needs the reference transcript). Croatian works with **OmniVoice** and **Higgs Audio v3**; the other built-in engines do not read it and a job for it is skipped with the supported list. A project picks the default engine with `voice.engine` and a per-language override with `voice.engines` (for example `{hr: higgs-audio-v3}`); an engine id or `custom:<workflow>`.
- Sound effects: **MOSS-SoundEffect v2** is offered as an explicit SFX engine (`sound.sfxEngine: moss-soundeffect-v2`), with the audio engines, custom workflows and Chiptune Studio. The default is the music provider's engine: the ambience engine (ACE-Step) for a ComfyUI project, Chiptune Studio for a pixel book; `"none"` keeps effects import-only. If MOSS fails in the suite's model loader (some ComfyUI custom nodes patch `torch.load`), pick ACE-Step or fix that node. Ambience stays ACE-Step by default (`sound.ambienceEngine`).
- Reference clips: upload one per speaker (`voice_<speaker>` asset, narrator included); its transcript goes in `voice.refTexts` and the delivery note (the OmniVoice/Qwen3 `instruct`, or inline tags for Higgs) in `voice.styles`. A character without a clip uses the narrator's. Engines that need a clip or a transcript (IndexTTS-2, F5-TTS) skip that clip with a message when it is missing.
- Gemini voices (through flow-music-mcp's `flow_narrate`, free) are chosen per language by the voice-director (`gemini:Kore`) or by `voice.voices.narrator.<lang>`; the delivery style is `voice.styles`. The VibeTTS voice of a language is `voice.localVoices.<lang>` (`supertonic:F1`, `am_michael`); missing, VibeTTS uses its own configured voice for that language.
- Licences: check each model card before using a course commercially. Higgs Audio v3 is released for research and non-commercial use, F5-TTS is CC-BY-NC, and the other engines follow the terms of their own model cards.

The engines live in the TTS Audio Suite; Edu Studio does not download the models (install the suite and its models in ComfyUI). `edu_voice_status` (or the Voice tab) lists every engine that is installed, the languages it reads and which nodes are missing.
