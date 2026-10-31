import { describe, expect, it } from 'vitest'
import { newProgress, parseProgress } from '../src/player/progress'
import { createSpeechService, speakingConfig } from '../src/player/speech'
import { encodeWav, resample, toMono, WAV_RATE } from '../src/player/speech/wav'
import { transcribe, WhisperError } from '../src/player/speech/whisper-client'
import { loadFixture } from './edu-fixtures'

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

  it('clips out-of-range samples', () => {
    const v = view(encodeWav([new Float32Array([5, -5])], WAV_RATE))
    expect([v.getInt16(44, true), v.getInt16(46, true)]).toEqual([32767, -32768])
  })

  it('resamples 48 kHz to a third of the samples and mixes stereo down', () => {
    const wav = encodeWav([new Float32Array(480), new Float32Array(480)], 48000)
    expect(view(wav).getUint32(40, true)).toBe(160 * 2)
    expect(Array.from(toMono([new Float32Array([1, 0]), new Float32Array([0, 0])]))).toEqual([0.5, 0])
    expect(resample(new Float32Array([0, 1]), 16000, 16000).length).toBe(2)
    expect(resample(new Float32Array(0), 48000, 16000).length).toBe(0)
  })

  it('an empty recording is a valid empty WAV', () => {
    expect(encodeWav([], 48000).length).toBe(44)
  })
})

describe('extensions.speaking', () => {
  it('is on by default for a language course and off otherwise', () => {
    expect(speakingConfig(undefined, 'hr')).toEqual({ enabled: true })
    expect(speakingConfig({}, undefined)).toEqual({ enabled: false })
    expect(speakingConfig({ speaking: { enabled: true } }, undefined)).toEqual({ enabled: false })
  })
  it('can be switched off and takes a loopback whisper url only', () => {
    expect(speakingConfig({ speaking: { enabled: false } }, 'hr')).toEqual({ enabled: false })
    expect(speakingConfig({ speaking: { whisperUrl: 'http://127.0.0.1:7464' } }, 'hr')).toEqual({ enabled: true, whisperUrl: 'http://127.0.0.1:7464' })
    expect(speakingConfig({ speaking: { whisperUrl: 'http://localhost:7464/' } }, 'hr').whisperUrl).toBe('http://localhost:7464/')
    expect(speakingConfig({ speaking: { whisperUrl: 'https://example.com/stt' } }, 'hr')).toEqual({ enabled: true })
    expect(speakingConfig({ speaking: 5 }, 'hr')).toEqual({ enabled: true })
    expect(speakingConfig({ speaking: { enabled: 'no' } }, 'hr')).toEqual({ enabled: true })
  })
})

describe('the recognizer choice', () => {
  const win = (extra: Record<string, unknown>): Window => ({ navigator: {}, ...extra }) as unknown as Window
  const Fake = class {}
  it('no recognizer, no service', () => {
    expect(createSpeechService(win({}), undefined, 'hr')).toBeUndefined()
  })
  it('the Web Speech API, prefixed or not, in the course language', () => {
    expect(createSpeechService(win({ SpeechRecognition: Fake }), undefined, 'hr')).toMatchObject({ kind: 'web', lang: 'hr' })
    expect(createSpeechService(win({ webkitSpeechRecognition: Fake }), undefined, 'de')).toMatchObject({ kind: 'web', lang: 'de' })
  })
  it('none for a course without a target language or with speaking off', () => {
    expect(createSpeechService(win({ SpeechRecognition: Fake }), undefined, undefined)).toBeUndefined()
    expect(createSpeechService(win({ SpeechRecognition: Fake }), { speaking: { enabled: false } }, 'hr')).toBeUndefined()
  })
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
  const reply = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it('posts the WAV to /stt with the language and returns the trimmed text', async () => {
    let seen: { url: string; method?: string; type?: string } | undefined
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, method: init.method, type: (init.headers as Record<string, string>)['content-type'] }
      return new Response(JSON.stringify({ text: ' dobar dan ' }))
    }) as unknown as typeof fetch
    expect(await transcribe('http://127.0.0.1:7464/', wav, 'hr', { fetchImpl: f })).toBe('dobar dan')
    expect(seen).toEqual({ url: 'http://127.0.0.1:7464/stt?lang=hr', method: 'POST', type: 'audio/wav' })
  })
  it('error states: a bad status, no text, an unreachable endpoint, a timeout', async () => {
    await expect(transcribe('http://127.0.0.1:1', wav, 'hr', { fetchImpl: reply(500, {}) })).rejects.toMatchObject({ code: 'failed' })
    await expect(transcribe('http://127.0.0.1:1', wav, 'hr', { fetchImpl: reply(200, { nope: 1 }) })).rejects.toBeInstanceOf(WhisperError)
    const down = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await expect(transcribe('http://127.0.0.1:1', wav, 'hr', { fetchImpl: down })).rejects.toMatchObject({ code: 'unavailable' })
    const hang = ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch
    await expect(transcribe('http://127.0.0.1:1', wav, 'hr', { fetchImpl: hang, timeoutMs: 20 })).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('the speak setting', () => {
  it('defaults to true, keeps false, and an old save without it means true', async () => {
    const f = await loadFixture('hr-a1-greetings')
    expect(newProgress(f.pack.id).settings.speak).toBe(true)
    const parse = (settings: unknown): boolean | undefined => {
      const r = parseProgress(JSON.stringify({ format: 'edu-progress', progress: { version: 1, pack: f.pack.id, settings } }), f.pack)
      return r.ok ? r.progress.settings.speak : undefined
    }
    expect(parse({ timer: false, sound: true })).toBe(true)
    expect(parse({ timer: false, sound: true, speak: false })).toBe(false)
    expect(parse({ speak: 'maybe' })).toBe(true)
  })
})
