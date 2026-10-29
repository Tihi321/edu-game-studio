---
kind: voice
# The clip format: mp3 (small) or wav.
format: mp3
# Speech speed, 0.5 to 2, for the engines that take one (OmniVoice, F5-TTS).
speed: 1
# A long line is split for the TTS node after this many characters (100-1000).
chunkChars: 400
---
# Voice

How the spoken lines and the sound effects are made. The spoken lines come from the local ComfyUI **TTS Audio Suite** engines (the default provider, `voice.provider: comfy` in a course's course.md); Google Flow is the cloud fallback (`voice.provider: flow`).

- `format`, `speed`: the clip format and the speech speed. A clip whose text, engine, reference clip, transcript, style, speed, format and chunk length did not change is skipped.
- `chunkChars`: a long beat is split for `UnifiedTTSTextNode` after this many characters and the pieces are crossfaded.
- The engines: **OmniVoice** (600+ languages; the default, `voice.engine: omnivoice`, and it reads Croatian), **Higgs Audio v3** (100+ languages, delivery tags inline in the text), **Chatterbox 23 languages**, **VibeVoice** (English and Chinese), **Qwen3-TTS** (10 languages, cloning), **IndexTTS-2** (5 languages, cloning) and **F5-TTS** (10 languages, cloning; it needs the reference transcript). Croatian works with **OmniVoice** and **Higgs Audio v3**; the other built-in engines do not read it and a job for it is skipped with the supported list. A project picks the default engine with `voice.engine` and a per-language override with `voice.engines` (for example `{hr: higgs-audio-v3}`); an engine id or `custom:<workflow>`.
- Sound effects: **MOSS-SoundEffect v2** is offered as an explicit SFX engine (`sound.sfxEngine: moss-soundeffect-v2`), with the audio engines, custom workflows and Chiptune Studio. The default is the music provider's engine: the ambience engine (ACE-Step) for a ComfyUI project, Chiptune Studio for a pixel book; `"none"` keeps effects import-only. If MOSS fails in the suite's model loader (some ComfyUI custom nodes patch `torch.load`), pick ACE-Step or fix that node. Ambience stays ACE-Step by default (`sound.ambienceEngine`).
- Reference clips: upload one per speaker (`voice_<speaker>` asset, narrator included); its transcript goes in `voice.refTexts` and the delivery note (the OmniVoice/Qwen3 `instruct`, or inline tags for Higgs) in `voice.styles`. A character without a clip uses the narrator's. Engines that need a clip or a transcript (IndexTTS-2, F5-TTS) skip that clip with a message when it is missing.
- Google Flow (cloud fallback) makes the clips with its free Gemini or Windows voices; the ids are `voice.voices` (Flow only). Everything else above applies.
- Licences: check each model card before using a course commercially. Higgs Audio v3 is released for research and non-commercial use, F5-TTS is CC-BY-NC, and the other engines follow the terms of their own model cards.

The engines live in the TTS Audio Suite; Edu Studio does not download the models (install the suite and its models in ComfyUI). `edu_voice_status` (or the Voice tab) lists every engine that is installed, the languages it reads and which nodes are missing.
