---
kind: comfy
# One ComfyUI endpoint per GPU, in priority order.
lanes:
  - http://127.0.0.1:8188
# refuse: fail when every lane is busy. wait: hand the job to ComfyUI's own queue.
queuePolicy: wait
requestTimeoutMs: 30000
jobTimeoutMs: 1800000
pollIntervalMs: 4000
freeBeforeDispatch: false
# Engines the app offers. An empty list offers every engine in the registry.
enabledEngines: []
# Audio format for generated music (flac, mp3, opus, wav).
audioFormat: mp3
# Background removal model (models/background_removal); empty uses the first one ComfyUI lists.
backgroundRemovalModel: ''
# Model file overrides, merged over the built-in defaults. Example:
# files:
#   zImage:
#     unet: z_image_turbo_bf16.safetensors
files: {}
# Sampler overrides per engine id, for example: { z-image-turbo: { steps: 9 } }
engineSettings: {}
---
# ComfyUI

Edu Studio drives a local ComfyUI. The generated images and music are saved into each course (`courses/<slug>/course/assets/<id>/v<n>.webp`, listed in `course/assets.json`), not into ComfyUI's output folder. A course makes its pictures with the engine in its `media.art.generator` (default `qwen-image-2.1`; `enabledEngines` below can narrow what is offered); when no lane answers (after the auto-start in `config/autostart.md`) the pictures get placeholder cards and the run goes on.

- `lanes`: the ComfyUI endpoints (one per GPU). A lane that does not answer counts as busy.
- `queuePolicy`: `refuse` fails when every lane is busy; `wait` queues behind the running job.
- `files`: model file names (`qwen`, `zImage`, `krea2`, `moss`, `audio` groups) when yours differ from the defaults.
- `backgroundRemovalModel`: the BiRefNet file in `models/background_removal` (empty uses the first one ComfyUI lists).
- `engineSettings`: steps, cfg, sampler or scheduler per engine id.
- The TTS Audio Suite voice and sound-effect engines (OmniVoice, Higgs Audio v3, Chatterbox, VibeVoice, Qwen3-TTS, IndexTTS-2, F5-TTS and MOSS-SoundEffect v2) are offered to voice and SFX jobs as soon as ComfyUI lists their nodes; `edu_voice_status` or the Generators page shows which are ready and which nodes are missing. They have no model file paths here (the suite manages its own models).
- Custom workflows: put an API-format `<name>.json` and a `<name>.map.yaml` in `workflows/` of the data folder and pick `custom:<name>` as an engine (also for a TTS workflow). See `workflows/chatterbox-multilingual.map.yaml` for the mapping format.
