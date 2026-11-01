import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodeWav } from '../src/player/speech/wav'
import { createSttServer } from '../src/engine/stt/server'
import { transcribeFile } from '../src/engine/stt/whisper'
import { tmp, useTemp } from './edu-build-helpers'

/** The local speech-to-text endpoint (EGS-18): the whisper.cpp wrapper with a fake whisper-cli (a node script) and the HTTP server. */

useTemp()

const FAKE_CLI = `
const a = process.argv.slice(2)
const get = (f) => a[a.indexOf(f) + 1]
if (process.env.FAKE_FAIL) { console.error('boom'); process.exit(3) }
console.log('[00:00:00.000 --> 00:00:02.000]   Dobar dan [BLANK_AUDIO]')
console.log('args: ' + a.includes('-nt') + ' ' + get('-l') + ' ' + require('fs').existsSync(get('-f')) + ' ' + require('path').basename(get('-m')))
`

async function fakeWhisperDir(): Promise<string> {
  const dir = await tmp('edu-whisper-')
  await mkdir(path.join(dir, 'models'), { recursive: true })
  await writeFile(path.join(dir, 'models', 'ggml-tiny.bin'), 'x')
  const cli = path.join(dir, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli')
  await writeFile(cli, 'not a real binary')
  await chmod(cli, 0o755)
  await writeFile(path.join(dir, 'fake-cli.js'), FAKE_CLI)
  return dir
}

describe('whisper wrapper', () => {

  it('runs the cli with -nt -l <lang> -f <wav> -m <model>', async () => {
    const dir = await fakeWhisperDir()
    const wav = path.join(dir, 'in.wav')
    await writeFile(wav, encodeWav([new Float32Array(160)], 16000))
    const setup = { cli: path.join(dir, 'fake-cli.js'), model: path.join(dir, 'models', 'ggml-tiny.bin') }
    expect(await transcribeFile(setup, wav, 'hr-HR')).toBe('Dobar dan args: true hr true ggml-tiny.bin')
  })

  it('reports a failing cli', async () => {
    const dir = await fakeWhisperDir()
    const setup = { cli: path.join(dir, 'fake-cli.js'), model: path.join(dir, 'models', 'ggml-tiny.bin') }
    process.env.FAKE_FAIL = '1'
    try {
      await expect(transcribeFile(setup, 'x.wav', 'hr')).rejects.toThrow(/whisper failed: boom/)
    } finally {
      delete process.env.FAKE_FAIL
    }
  })
})

describe('stt server', () => {
  const wav = Buffer.from(encodeWav([new Float32Array(1600)], 16000))
  async function up(extra: Parameters<typeof createSttServer>[0] = {}): Promise<{ url: string; stop: () => Promise<void>; seen: string[] }> {
    const seen: string[] = []
    const s = createSttServer({
      port: 0,
      transcribe: async (file, lang) => {
        seen.push(lang)
        return `heard ${file.endsWith('.wav') ? 'wav' : '?'}`
      },
      status: () => ({ configured: true, ready: true }),
      ...extra
    })
    const { url } = await s.start()
    return { url, stop: () => s.stop(), seen }
  }

  it('POST /stt returns the text, passes the language; GET /health answers; CORS for null', async () => {
    const s = await up()
    try {
      const res = await fetch(`${s.url}/stt?lang=hr`, { method: 'POST', body: wav, headers: { origin: 'null' } })
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('null')
      expect(await res.json()).toEqual({ text: 'heard wav' })
      expect(s.seen).toEqual(['hr'])
      const health = await fetch(`${s.url}/health`)
      expect(await health.json()).toEqual({ ok: true, whisper: { configured: true, ready: true } })
      const pre = await fetch(`${s.url}/stt`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } })
      expect(pre.status).toBe(204)
      expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    } finally {
      await s.stop()
    }
  })

  it('refuses another origin (403), a wrong method (405) and an unknown path (404)', async () => {
    const s = await up()
    try {
      const evil = await fetch(`${s.url}/stt`, { method: 'POST', body: wav, headers: { origin: 'https://evil.example' } })
      expect(evil.status).toBe(403)
      expect(evil.headers.get('access-control-allow-origin')).toBeNull()
      expect((await fetch(`${s.url}/stt`)).status).toBe(405)
      expect((await fetch(`${s.url}/health`, { method: 'POST' })).status).toBe(405)
      expect((await fetch(`${s.url}/other`)).status).toBe(404)
    } finally {
      await s.stop()
    }
  })
})
