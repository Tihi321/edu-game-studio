import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { findWhisper, transcribeFile, whisperConfigured, whisperLang, type WhisperSetup } from './whisper'

/**
 * The local speech-to-text endpoint of speaking practice (EGS-18): 127.0.0.1 only, default port 7464 (`EDU_STT_PORT`).
 *   GET  /health            -> {ok, whisper: {configured, ready, reason?}}
 *   POST /stt?lang=hr       body = a WAV (16 kHz mono 16-bit), at most 10 MB -> {text}
 * CORS: only the `null` origin (a game opened from file://) and http://127.0.0.1 / http://localhost (any port) may call it; a request with another
 * Origin or another Host is refused with 403. Started by the engine only with EDU_STT=1 or when whisper is configured.
 */

export const DEFAULT_STT_PORT = 7464
export const MAX_WAV_BYTES = 10 * 1024 * 1024

export interface SttStatus {
  configured: boolean
  ready: boolean
  reason?: string
}

export interface SttServerOptions {
  port?: number
  /** Runs the recognizer on a WAV file. Default: whisper-cli found through the environment. */
  transcribe?: (wavPath: string, lang: string) => Promise<string>
  /** Whether a recognizer is ready, for /health. Default: looks whisper up in the environment. */
  status?: () => SttStatus
  maxBytes?: number
  log?: (m: string) => void
}

export function sttPort(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.EDU_STT_PORT)
  return env.EDU_STT_PORT && Number.isInteger(n) && n >= 0 && n <= 65535 ? n : DEFAULT_STT_PORT
}

/** Should the engine start the endpoint: `EDU_STT=1`, or whisper is configured in the environment. */
export function sttWanted(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EDU_STT === '1' || whisperConfigured(env)
}

export const originAllowed = (origin: string | undefined): boolean => origin === undefined || origin === 'null' || /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(origin)
const hostAllowed = (host: string | undefined): boolean => !!host && /^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host)

export interface SttServer {
  start(): Promise<{ port: number; url: string }>
  stop(): Promise<void>
}

export function createSttServer(opts: SttServerOptions = {}): SttServer {
  const max = opts.maxBytes ?? MAX_WAV_BYTES
  const lookup = (): { setup?: WhisperSetup; reason?: string } => {
    const r = findWhisper()
    return r.ok ? { setup: r.setup } : { reason: r.reason }
  }
  const status =
    opts.status ??
    ((): SttStatus => {
      const r = lookup()
      return { configured: whisperConfigured(), ready: !!r.setup, ...(r.reason ? { reason: r.reason } : {}) }
    })
  const run =
    opts.transcribe ??
    ((wav: string, lang: string): Promise<string> => {
      const r = lookup()
      if (!r.setup) return Promise.reject(new Error(r.reason ?? 'whisper is not set up'))
      return transcribeFile(r.setup, wav, lang)
    })
  // one recognition at a time: whisper uses the whole CPU
  let queue: Promise<unknown> = Promise.resolve()

  const send = (res: http.ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}): void => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
    res.end(JSON.stringify(body))
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin
    if (!hostAllowed(req.headers.host) || !originAllowed(origin)) return send(res, 403, { error: 'forbidden origin' })
    const cors: Record<string, string> = origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' })
      return void res.end()
    }
    if (url.pathname === '/health') {
      if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' }, { ...cors, allow: 'GET' })
      return send(res, 200, { ok: true, whisper: status() }, cors)
    }
    if (url.pathname !== '/stt') return send(res, 404, { error: 'not found' }, cors)
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { ...cors, allow: 'POST' })

    const chunks: Buffer[] = []
    let size = 0
    let tooBig = Number(req.headers['content-length'] ?? 0) > max
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) tooBig = true
      if (!tooBig) chunks.push(c)
    })
    req.on('end', () => {
      if (tooBig) return send(res, 413, { error: `the WAV is larger than ${max} bytes` }, { ...cors, connection: 'close' })
      const body = Buffer.concat(chunks)
      if (body.length < 44 || body.toString('ascii', 0, 4) !== 'RIFF' || body.toString('ascii', 8, 12) !== 'WAVE') return send(res, 400, { error: 'the body is not a WAV file' }, cors)
      const lang = whisperLang(url.searchParams.get('lang') ?? undefined)
      const job = queue.then(async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'edu-stt-'))
        try {
          const file = path.join(dir, 'in.wav')
          await writeFile(file, body)
          return await run(file, lang)
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => undefined)
        }
      })
      queue = job.catch(() => undefined)
      job.then(
        (text) => send(res, 200, { text }, cors),
        (e: unknown) => {
          opts.log?.(`stt failed: ${e instanceof Error ? e.message : String(e)}`)
          send(res, 500, { error: e instanceof Error ? e.message : 'recognition failed' }, cors)
        }
      )
    })
    req.on('error', () => undefined)
  })

  return {
    start: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(opts.port ?? sttPort(), '127.0.0.1', () => {
          const port = (server.address() as AddressInfo).port
          resolve({ port, url: `http://127.0.0.1:${port}` })
        })
      }),
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
  }
}
