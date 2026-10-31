import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import type { AddressInfo } from 'node:net'
import { LiveRoom, type JoinError, type LiveQuestion, type AnswerError, type StepError } from '../../shared/live'
import type { LiveClientFiles } from './client-files'

/**
 * The server of one live quiz room: node `http` only, no dependencies. It serves the client (`/live/`, `/live/live.js`, `/live/live.css`), the
 * player routes (`/live/info`, `/live/join`, `/live/events?token=` as Server-Sent Events, `/live/answer`) and the host routes under
 * `/live/host/<hostToken>/` (the host page, `state`, `events`, `start`, `next`, `end-question`, `kick`, `close`). It binds to 127.0.0.1;
 * `lan: true` binds 0.0.0.0 so phones on the same network can join (anyone on that network can). The host token is 128 random bits and is
 * only ever returned to the caller that started the room. Every answer is JSON, drawn by the client with textContent only.
 */

export const MAX_BODY_BYTES = 4096
export const DEFAULT_IDLE_MS = 10 * 60_000
export const DEFAULT_MAX_MS = 2 * 60 * 60_000
export const BAD_CODES_PER_WINDOW = 10
const MAX_SSE = 200

/** The address a room binds to: loopback unless the host asked for the LAN. */
export const pickBindAddress = (lan: boolean): string => (lan ? '0.0.0.0' : '127.0.0.1')

/** The IPv4 addresses of the machine's non-internal interfaces (what a phone on the same network can reach). */
export function lanAddresses(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const out: string[] = []
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal && !out.includes(i.address)) out.push(i.address)
    }
  }
  return out
}

/** The addresses players open: the machine's LAN addresses in LAN mode (loopback when it has none), else loopback. */
export function playerUrlsFor(lan: boolean, port: number, interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] {
  const hosts = lan ? lanAddresses(interfaces) : []
  return (hosts.length > 0 ? hosts : ['127.0.0.1']).map((a) => `http://${a}:${port}/live/`)
}

export interface LiveServerOptions {
  questions: LiveQuestion[]
  secondsPerQuestion: number
  lang: string
  title: string
  lan?: boolean
  /** 0 = any free port. */
  port?: number
  client: LiveClientFiles
  now?: () => number
  /** Closes the room after this long without any open connection (default 10 minutes). */
  idleMs?: number
  /** Closes the room after this long in all (default 2 hours). */
  maxMs?: number
  /** How often the idle check runs (default: half of idleMs, at most 15 s). */
  sweepMs?: number
  badCodesPerWindow?: number
  badCodeWindowMs?: number
  interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>
  maxPlayers?: number
  onClosed?: (reason: string) => void
}

export interface LiveHandle {
  roomId: string
  code: string
  hostToken: string
  port: number
  bind: string
  lan: boolean
  hostUrl: string
  playerUrls: string[]
  room: LiveRoom
  startedAt: number
  closedReason: string | undefined
  close(reason?: string): Promise<void>
}

const safeEqual = (a: string, b: string): boolean => {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb) && a.length === b.length
}

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="dark"><title>Edu Studio live quiz</title><link rel="stylesheet" href="/live/live.css"></head><body><div id="live-root"></div><script src="/live/live.js" defer></script></body></html>
`

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

const JOIN_STATUS: Record<JoinError, number> = { name: 400, taken: 409, full: 409, started: 409, closed: 410 }
const ANSWER_STATUS: Record<AnswerError, number> = { phase: 409, late: 409, already: 409, invalid: 400, unknown: 401 }
const STEP_STATUS: Record<StepError, number> = { phase: 409, empty: 409 }

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Starts a room and its server. Resolves when it listens. */
export async function startLiveServer(opts: LiveServerOptions): Promise<LiveHandle> {
  const now = opts.now ?? Date.now
  const lan = opts.lan === true
  const bind = pickBindAddress(lan)
  const files = { js: readFileSync(opts.client.js), css: readFileSync(opts.client.css) }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const hostToken = randomBytes(16).toString('hex')
  const roomId = randomBytes(4).toString('hex')
  const startedAt = now()
  const room = new LiveRoom({
    questions: opts.questions,
    secondsPerQuestion: opts.secondsPerQuestion,
    lang: opts.lang,
    title: opts.title,
    now,
    makeToken: () => randomBytes(16).toString('hex'),
    ...(opts.maxPlayers ? { maxPlayers: opts.maxPlayers } : {})
  })

  // ---- bad-code rate limit, per IP ----
  const limit = opts.badCodesPerWindow ?? BAD_CODES_PER_WINDOW
  const windowMs = opts.badCodeWindowMs ?? 60_000
  const bad = new Map<string, { count: number; resetAt: number }>()
  const blockedFor = (ip: string): number => {
    const e = bad.get(ip)
    if (!e) return 0
    if (now() >= e.resetAt) {
      bad.delete(ip)
      return 0
    }
    return e.count >= limit ? Math.ceil((e.resetAt - now()) / 1000) : 0
  }
  const fail = (ip: string): void => {
    const e = bad.get(ip)
    if (!e || now() >= e.resetAt) bad.set(ip, { count: 1, resetAt: now() + windowMs })
    else e.count += 1
    if (bad.size > 1000) for (const [k, v] of bad) if (now() >= v.resetAt) bad.delete(k)
  }

  // ---- connections (SSE) ----
  interface Client {
    res: http.ServerResponse
    playerId?: string
  }
  const clients = new Set<Client>()
  const perPlayer = new Map<string, number>()
  let idleSince = startedAt

  const eventFor = (c: Client): { event: string; data: unknown } =>
    c.playerId === undefined
      ? { event: 'host', data: hostState() }
      : { event: room.phase, data: room.view(c.playerId) }

  const push = (c: Client): void => {
    if (c.res.writableEnded) return
    const { event, data } = eventFor(c)
    c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  let timer: NodeJS.Timeout | undefined
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (room.deadline === null) return
    timer = setTimeout(() => room.tick(), Math.max(0, room.deadline - now()) + 5)
    timer.unref()
  }
  room.subscribe(() => {
    schedule()
    for (const c of clients) push(c)
    // a kicked player's stream ends (the page then finds its token gone), and so does every stream when the room closes
    for (const c of clients) if (room.phase === 'closed' || (c.playerId !== undefined && !room.hasPlayer(c.playerId))) c.res.end()
  })

  const playerUrls: string[] = []
  const hostState = () => ({ ...room.hostView(), code, playerUrls })

  // ---- helpers ----
  const hostAllowed = (req: http.IncomingMessage): boolean => {
    if (lan) return true
    const port = (server.address() as AddressInfo).port
    return [`127.0.0.1:${port}`, `localhost:${port}`].includes((req.headers.host ?? '').toLowerCase())
  }
  const sameOrigin = (req: http.IncomingMessage): boolean => {
    const o = req.headers.origin
    if (o === undefined) return true
    try {
      return new URL(o).host.toLowerCase() === (req.headers.host ?? '').toLowerCase()
    } catch {
      return false
    }
  }
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...extra
  })
  const sendJson = (res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void => {
    res.writeHead(status, headers({ 'Content-Type': 'application/json; charset=utf-8', ...extra }))
    res.end(JSON.stringify(body))
  }
  const readJson = async (req: http.IncomingMessage): Promise<Record<string, unknown>> => {
    const len = Number(req.headers['content-length'] ?? 0)
    if (len > MAX_BODY_BYTES) throw new HttpError(413, 'body too large')
    const type = String(req.headers['content-type'] ?? '')
    if (!/^application\/json\s*(;|$)/i.test(type)) throw new HttpError(415, 'content-type must be application/json')
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body too large')
      chunks.push(chunk as Buffer)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    if (text.trim() === '') return {}
    try {
      const v: unknown = JSON.parse(text)
      if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not an object')
      return v as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'body is not a JSON object')
    }
  }

  const openStream = (req: http.IncomingMessage, res: http.ServerResponse, who: { playerId?: string }): void => {
    const client: Client = { res, ...who }
    if (clients.size >= MAX_SSE) return sendJson(res, 503, { error: 'too many connections' })
    req.socket.setTimeout(0)
    res.writeHead(200, headers({ 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }))
    res.write('retry: 2000\n\n')
    clients.add(client)
    if (client.playerId !== undefined) {
      perPlayer.set(client.playerId, (perPlayer.get(client.playerId) ?? 0) + 1)
      room.setConnected(client.playerId, true)
    }
    if (room.phase !== 'closed') push(client)
    else {
      push(client)
      res.end()
    }
    const beat = setInterval(() => res.write(': ping\n\n'), 15_000)
    beat.unref()
    res.on('close', () => {
      clearInterval(beat)
      clients.delete(client)
      if (clients.size === 0) idleSince = now()
      if (client.playerId !== undefined) {
        const n = (perPlayer.get(client.playerId) ?? 1) - 1
        if (n <= 0) {
          perPlayer.delete(client.playerId)
          room.setConnected(client.playerId, false)
        } else perPlayer.set(client.playerId, n)
      }
    })
  }

  const hostRoute = async (req: http.IncomingMessage, res: http.ServerResponse, route: string): Promise<void> => {
    const method = req.method ?? 'GET'
    if (method === 'GET' && (route === '' || route === '/')) {
      res.writeHead(200, headers({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP }))
      return void res.end(HTML)
    }
    if (method === 'GET' && route === '/state') return sendJson(res, 200, hostState())
    if (method === 'GET' && route === '/events') return openStream(req, res, {})
    if (method !== 'POST') throw new HttpError(405, 'method not allowed')
    const body = await readJson(req)
    const step = (r: { ok: true } | { ok: false; error: StepError }): void =>
      r.ok ? sendJson(res, 200, { ok: true, phase: room.phase }) : sendJson(res, STEP_STATUS[r.error], { error: r.error })
    switch (route) {
      case '/start':
        return step(room.start())
      case '/next':
        return step(room.next())
      case '/end-question':
        return step(room.endQuestion())
      case '/kick': {
        const ok = typeof body.playerId === 'string' && room.kick(body.playerId)
        return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'no such player' })
      }
      case '/close':
        sendJson(res, 200, { ok: true })
        void close('host closed the room')
        return
      default:
        throw new HttpError(404, 'not found')
    }
  }

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    if (!hostAllowed(req)) return sendJson(res, 403, { error: 'forbidden host' })
    const url = new URL(req.url ?? '/', 'http://local')
    const p = url.pathname
    const method = req.method ?? 'GET'
    const ip = req.socket.remoteAddress ?? 'unknown'
    if (method === 'POST' && !sameOrigin(req)) return sendJson(res, 403, { error: 'forbidden origin' })

    const host = /^\/live\/host\/([A-Za-z0-9]{1,64})(\/.*)?$/.exec(p)
    if (host) {
      if (blockedFor(ip)) return sendJson(res, 429, { error: 'too many tries' }, { 'Retry-After': String(blockedFor(ip)) })
      if (!safeEqual(host[1] ?? '', hostToken)) {
        fail(ip)
        return sendJson(res, 404, { error: 'not found' })
      }
      return hostRoute(req, res, host[2] ?? '')
    }

    if (method === 'GET' && (p === '/live/' || p === '/live')) {
      res.writeHead(200, headers({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP }))
      return void res.end(HTML)
    }
    if (method === 'GET' && p === '/live/live.js') {
      res.writeHead(200, headers({ 'Content-Type': 'text/javascript; charset=utf-8' }))
      return void res.end(files.js)
    }
    if (method === 'GET' && p === '/live/live.css') {
      res.writeHead(200, headers({ 'Content-Type': 'text/css; charset=utf-8' }))
      return void res.end(files.css)
    }
    if (method === 'GET' && p === '/live/info') return sendJson(res, 200, { lang: opts.lang, title: opts.title, phase: room.phase })

    if (method === 'GET' && p === '/live/events') {
      const id = room.playerOf(url.searchParams.get('token'))
      if (id === undefined) return sendJson(res, 401, { error: 'unknown token' })
      return openStream(req, res, { playerId: id })
    }

    if (method === 'POST' && p === '/live/join') {
      const wait = blockedFor(ip)
      if (wait) return sendJson(res, 429, { error: 'too many tries' }, { 'Retry-After': String(wait) })
      const body = await readJson(req)
      if (typeof body.code !== 'string' || !safeEqual(body.code.trim(), code)) {
        fail(ip)
        return sendJson(res, 403, { error: 'code' })
      }
      const r = room.join(body.name)
      if (!r.ok) return sendJson(res, JOIN_STATUS[r.error], { error: r.error })
      return sendJson(res, 200, { token: r.token, id: r.id, view: room.view(r.id) })
    }

    if (method === 'POST' && p === '/live/answer') {
      const body = await readJson(req)
      const id = room.playerOf(body.token)
      if (id === undefined) return sendJson(res, 401, { error: 'unknown token' })
      const r = room.answer(id, body.answer)
      return r.ok ? sendJson(res, 200, { ok: true }) : sendJson(res, ANSWER_STATUS[r.error], { error: r.error })
    }

    return sendJson(res, 404, { error: 'not found' })
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (res.headersSent) return void res.end()
      if (e instanceof HttpError) {
        if (e.status === 413) res.setHeader('Connection', 'close')
        return sendJson(res, e.status, { error: e.message })
      }
      sendJson(res, 500, { error: 'server error' })
    })
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000
  server.maxHeadersCount = 50

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, bind, () => resolve())
  })
  const port = (server.address() as AddressInfo).port

  let closing: Promise<void> | undefined
  const handleOut: LiveHandle = {
    roomId,
    code,
    hostToken,
    port,
    bind,
    lan,
    hostUrl: `http://127.0.0.1:${port}/live/host/${hostToken}/`,
    playerUrls,
    room,
    startedAt,
    closedReason: undefined,
    close: (reason) => close(reason)
  }
  playerUrls.push(...playerUrlsFor(lan, port, opts.interfaces))

  const sweepEvery = opts.sweepMs ?? Math.max(10, Math.min(15_000, Math.floor((opts.idleMs ?? DEFAULT_IDLE_MS) / 2)))
  const sweep = setInterval(() => {
    if (clients.size === 0 && now() - idleSince >= (opts.idleMs ?? DEFAULT_IDLE_MS)) void close('no connection for a while')
  }, sweepEvery)
  sweep.unref()
  const maxTimer = setTimeout(() => void close('time limit reached'), opts.maxMs ?? DEFAULT_MAX_MS)
  maxTimer.unref()

  function close(reason = 'closed'): Promise<void> {
    if (closing) return closing
    handleOut.closedReason = reason
    closing = (async () => {
      clearInterval(sweep)
      clearTimeout(maxTimer)
      if (timer) clearTimeout(timer)
      room.close()
      for (const c of [...clients]) c.res.end()
      clients.clear()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
      opts.onClosed?.(reason)
    })()
    return closing
  }

  return handleOut
}
