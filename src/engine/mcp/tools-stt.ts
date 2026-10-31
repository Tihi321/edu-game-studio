import { z } from 'zod'
import { sttPort, sttWanted } from '../stt/server'
import { findWhisper, whisperConfigured } from '../stt/whisper'
import type { Tool, ToolDef } from './tools'

/** `edu_stt_status` (EGS-18): is the local speech-to-text endpoint of speaking practice up, and is whisper.cpp set up for it. */
export function sttTools(def: ToolDef): Tool[] {
  return [
    def(
      'edu_stt_status',
      "Speaking practice: is the local speech-to-text endpoint (127.0.0.1, default port 7464) running, and are whisper-cli and a ggml model found (env EDU_WHISPER_DIR / EDU_WHISPER_MODEL)? The endpoint starts with the engine only when EDU_STT=1 or whisper is configured; without it the player still offers the browser's Web Speech API. Add `speaking: {whisperUrl: \"http://127.0.0.1:7464\"}` to a course pack's extensions to use it.",
      z.object({}),
      async () => {
        const port = sttPort()
        const lookup = findWhisper()
        const running = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }).then(
          (res) => res.ok,
          () => false
        )
        return {
          wanted: sttWanted(),
          running,
          url: `http://127.0.0.1:${port}`,
          whisper: whisperConfigured() ? (lookup.ok ? { ready: true, cli: lookup.setup.cli, model: lookup.setup.model } : { ready: false, reason: lookup.reason }) : { ready: false, reason: 'EDU_WHISPER_DIR is not set' },
          hint: running ? 'Set extensions.speaking.whisperUrl of a course to this url to use whisper in the player.' : 'Start the engine with EDU_STT=1 (and EDU_WHISPER_DIR) to run it. See docs/speaking.md.'
        }
      }
    )
  ]
}
