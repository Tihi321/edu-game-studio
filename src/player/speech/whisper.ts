import type { SpeechHandlers, SpeechService } from './types'
import { encodeWav } from './wav'
import { transcribe, WhisperError } from './whisper-client'

/** A turn is cut off after this long (a WAV of 30 s at 16 kHz is about 1 MB; the endpoint takes 10 MB). */
export const MAX_RECORD_MS = 30_000

type AC = typeof AudioContext

export function canRecord(win: Window): boolean {
  const w = win as unknown as { AudioContext?: AC; webkitAudioContext?: AC }
  return !!(w.AudioContext ?? w.webkitAudioContext) && !!win.navigator?.mediaDevices?.getUserMedia
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** Records the microphone, makes a 16 kHz WAV and asks the local whisper endpoint. Fully local: nothing leaves the machine. */
export function whisperService(win: Window, url: string, lang: string): SpeechService {
  return {
    kind: 'whisper',
    lang,
    start(h: SpeechHandlers) {
      const w = win as unknown as { AudioContext?: AC; webkitAudioContext?: AC }
      const Ctx = (w.AudioContext ?? w.webkitAudioContext) as AC
      const chunks: Float32Array[] = []
      let stream: MediaStream | undefined
      let ctx: AudioContext | undefined
      let node: ScriptProcessorNode | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      let done = false
      const release = (): void => {
        if (timer) clearTimeout(timer)
        node?.disconnect()
        stream?.getTracks().forEach((t) => t.stop())
        void ctx?.close().catch(() => undefined)
      }
      const finish = async (): Promise<void> => {
        if (done) return
        done = true
        const rate = ctx?.sampleRate ?? 48_000
        release()
        if (chunks.length === 0) return h.onState('error', 'no-speech')
        h.onState('thinking')
        try {
          const text = await transcribe(url, encodeWav([concat(chunks)], rate), lang)
          if (text) h.onText(text)
          if (text) h.onState('idle')
          else h.onState('error', 'no-speech')
        } catch (e) {
          h.onState('error', e instanceof WhisperError ? e.code : 'failed')
        }
      }
      void (async () => {
        try {
          stream = await win.navigator.mediaDevices.getUserMedia({ audio: true })
          if (done) return release()
          ctx = new Ctx()
          const src = ctx.createMediaStreamSource(stream)
          node = ctx.createScriptProcessor(4096, 1, 1)
          node.onaudioprocess = (e) => {
            if (!done) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
          }
          src.connect(node)
          node.connect(ctx.destination)
          timer = setTimeout(() => void finish(), MAX_RECORD_MS)
        } catch (e) {
          done = true
          release()
          h.onState('error', (e as { name?: string }).name === 'NotAllowedError' ? 'denied' : 'unavailable')
        }
      })()
      h.onState('listening')
      return { stop: () => void finish() }
    }
  }
}
