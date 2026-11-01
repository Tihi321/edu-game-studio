import { describe, expect, it } from 'vitest'
import { createSpeechService } from '../src/player/speech'
import { encodeWav, WAV_RATE } from '../src/player/speech/wav'
import { transcribe } from '../src/player/speech/whisper-client'

/** Speaking practice (EGS-18): the WAV encoder, the settings, the recognizer choice, the whisper client and the `speak` learner setting. */

describe('WAV encoder', () => {
  const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength)
  const tag = (b: Uint8Array, at: number): string => String.fromCharCode(...b.slice(at, at + 4))

  it('writes a 16 kHz mono 16-bit PCM header and the samples', () => {
    const wav = encodeWav([new Float32Array([0, 1, -1, 0.5])], WAV_RATE)
    expect(wav.length).toBe(44 + 8)
    expect([tag(wav, 0), tag(wav, 8), tag(wav, 12), tag(wav, 36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    const v = view(wav)
    expect(v.getUint32(4, true)).toBe(36 + 8)
    expect(v.getUint16(20, true)).toBe(1)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint32(28, true)).toBe(32000)
    expect(v.getUint16(34, true)).toBe(16)
    expect(v.getUint32(40, true)).toBe(8)
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([0, 32767, -32768])
  })

})

describe('the recognizer choice', () => {
  const win = (extra: Record<string, unknown>): Window => ({ navigator: {}, ...extra }) as unknown as Window
  const Fake = class {}
  it('whisper wins when a url is set and the browser can record, else the Web Speech API', () => {
    const ext = { speaking: { whisperUrl: 'http://127.0.0.1:7464' } }
    const rec = win({ AudioContext: class {}, navigator: { mediaDevices: { getUserMedia: () => undefined } }, SpeechRecognition: Fake })
    expect(createSpeechService(rec, ext, 'hr')?.kind).toBe('whisper')
    expect(createSpeechService(win({ SpeechRecognition: Fake }), ext, 'hr')?.kind).toBe('web')
    expect(createSpeechService(win({}), ext, 'hr')).toBeUndefined()
  })
})

describe('whisper client', () => {
  const wav = encodeWav([new Float32Array(10)], WAV_RATE)

  it('posts the WAV to /stt with the language and returns the trimmed text', async () => {
    let seen: { url: string; method?: string; type?: string } | undefined
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, method: init.method, type: (init.headers as Record<string, string>)['content-type'] }
      return new Response(JSON.stringify({ text: ' dobar dan ' }))
    }) as unknown as typeof fetch
    expect(await transcribe('http://127.0.0.1:7464/', wav, 'hr', { fetchImpl: f })).toBe('dobar dan')
    expect(seen).toEqual({ url: 'http://127.0.0.1:7464/stt?lang=hr', method: 'POST', type: 'audio/wav' })
  })
})
