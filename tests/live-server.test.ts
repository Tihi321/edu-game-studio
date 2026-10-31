import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { lanAddresses, pickBindAddress, playerUrlsFor, startLiveServer, type LiveHandle, type LiveServerOptions } from '../src/engine/live/server'
import type { RoomView } from '../src/shared/live'
import { LIVE_OUT, SseReader, fakeClock, fakeQuestion } from './live-helpers'

/** The live quiz HTTP server (EGS-21) with fetch and a streaming SSE reader. Every room listens on 127.0.0.1 and an ephemeral port. */

const client = { js: `${LIVE_OUT}/live.js`, css: `${LIVE_OUT}/live.css` }
const open: LiveHandle[] = []
const readers: SseReader[] = []

afterEach(async () => {
  for (const r of readers.splice(0)) r.close()
  await Promise.all(open.splice(0).map((h) => h.close()))
})

async function start(extra: Partial<LiveServerOptions> = {}): Promise<LiveHandle> {
  const h = await startLiveServer({ questions: [fakeQuestion('q1'), fakeQuestion('q2'), fakeQuestion('q3')], secondsPerQuestion: 20, lang: 'en', title: 'Test quiz', client, ...extra })
  open.push(h)
  return h
}

const url = (h: LiveHandle, p: string): string => `http://127.0.0.1:${h.port}${p}`
const post = (h: LiveHandle, p: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(url(h, p), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const hostPost = (h: LiveHandle, action: string, body: unknown = {}): Promise<Response> => post(h, `/live/host/${h.hostToken}/${action}`, body)

async function joinAs(h: LiveHandle, name: string): Promise<{ token: string; id: string }> {
  const res = await post(h, '/live/join', { code: h.code, name })
  expect(res.status).toBe(200)
  const j = (await res.json()) as { token: string; id: string }
  return j
}

async function events(h: LiveHandle, token: string): Promise<SseReader> {
  const r = await SseReader.open(url(h, `/live/events?token=${token}`))
  readers.push(r)
  return r
}

describe('the address selection', () => {
  it('binds to loopback unless LAN is asked for (no socket is opened here)', () => {
    expect(pickBindAddress(false)).toBe('127.0.0.1')
    expect(pickBindAddress(true)).toBe('0.0.0.0')
  })

  it('lists the non-internal IPv4 addresses for the LAN URLs and loopback otherwise', () => {
    const ifaces = {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      eth0: [
        { address: '192.168.1.20', family: 'IPv4', internal: false },
        { address: 'fe80::1', family: 'IPv6', internal: false }
      ],
      wlan0: [{ address: '10.0.0.7', family: 'IPv4', internal: false }]
    } as unknown as NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]>
    expect(lanAddresses(ifaces)).toEqual(['192.168.1.20', '10.0.0.7'])
    expect(playerUrlsFor(true, 7000, ifaces)).toEqual(['http://192.168.1.20:7000/live/', 'http://10.0.0.7:7000/live/'])
    expect(playerUrlsFor(false, 7000, ifaces)).toEqual(['http://127.0.0.1:7000/live/'])
    expect(playerUrlsFor(true, 7000, {})).toEqual(['http://127.0.0.1:7000/live/'])
  })

  it('a room started without lan listens on 127.0.0.1 only', async () => {
    const h = await start()
    expect(h.bind).toBe('127.0.0.1')
    expect(h.lan).toBe(false)
    expect(h.playerUrls).toEqual([`http://127.0.0.1:${h.port}/live/`])
    expect(h.hostUrl).toBe(`http://127.0.0.1:${h.port}/live/host/${h.hostToken}/`)
    expect(h.code).toMatch(/^\d{6}$/)
    expect(h.hostToken).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('the pages and the headers', () => {
  it('serves the client with a CSP, nosniff and no inline script', async () => {
    const h = await start()
    const page = await fetch(url(h, '/live/'))
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('x-content-type-options')).toBe('nosniff')
    const csp = page.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain('unsafe-inline')
    const html = await page.text()
    expect(html).not.toMatch(/<script>[^<]/)
    for (const [p, type] of [
      ['/live/live.js', 'text/javascript'],
      ['/live/live.css', 'text/css']
    ] as const) {
      const r = await fetch(url(h, p))
      expect(r.status).toBe(200)
      expect(r.headers.get('content-type')).toContain(type)
      expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    }
    const info = (await (await fetch(url(h, '/live/info'))).json()) as Record<string, unknown>
    expect(info).toEqual({ lang: 'en', title: 'Test quiz', phase: 'lobby' })
    expect((await fetch(url(h, '/nothing'))).status).toBe(404)
  })

  it('refuses a foreign Host header and a cross-origin POST', async () => {
    const h = await start()
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: h.port, path: '/live/info', headers: { Host: 'evil.example' } }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(403)
    const res = await post(h, '/live/join', { code: h.code, name: 'X' }, { Origin: 'http://evil.example' })
    expect(res.status).toBe(403)
  })
})

describe('joining', () => {
  it('joins with the right code and refuses a wrong one, a bad name, a taken name and a wrong content type', async () => {
    const h = await start()
    const wrong = await post(h, '/live/join', { code: h.code === '000000' ? '000001' : '000000', name: 'Ana' })
    expect(wrong.status).toBe(403)
    const ok = await post(h, '/live/join', { code: h.code, name: '  Ana ' })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { token: string; view: RoomView }
    expect(body.token).toMatch(/^[0-9a-f]{32}$/)
    expect(body.view.you?.nickname).toBe('Ana')
    expect(JSON.stringify(body)).not.toContain(h.hostToken)
    expect((await post(h, '/live/join', { code: h.code, name: '' })).status).toBe(400)
    expect((await post(h, '/live/join', { code: h.code, name: 'x'.repeat(21) })).status).toBe(400)
    expect((await post(h, '/live/join', { code: h.code, name: 'ana' })).status).toBe(409)
    const text = await fetch(url(h, '/live/join'), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })
    expect(text.status).toBe(415)
    expect((await post(h, '/live/join', 'not json')).status).toBe(400)
    expect((await post(h, '/live/join', '[1]')).status).toBe(400)
  })

  it('limits the body to 4 KB', async () => {
    const h = await start()
    const res = await post(h, '/live/join', { code: h.code, name: 'x', pad: 'y'.repeat(5000) })
    expect(res.status).toBe(413)
    // still serving
    expect((await post(h, '/live/join', { code: h.code, name: 'Ana' })).status).toBe(200)
  })

  it('rate limits wrong codes per IP: 10 a minute, then 429 for everything, until the window passes', async () => {
    const clock = fakeClock()
    const h = await start({ now: clock.now })
    const bad = h.code === '123456' ? '654321' : '123456'
    for (let i = 0; i < 10; i++) expect((await post(h, '/live/join', { code: bad, name: 'A' })).status).toBe(403)
    const blocked = await post(h, '/live/join', { code: bad, name: 'A' })
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    // even the right code waits
    expect((await post(h, '/live/join', { code: h.code, name: 'Ana' })).status).toBe(429)
    // so does guessing host tokens
    expect((await fetch(url(h, '/live/host/abc/state'))).status).toBe(429)
    clock.advance(60_001)
    expect((await post(h, '/live/join', { code: h.code, name: 'Ana' })).status).toBe(200)
  })

  it('takes 60 players at most', async () => {
    const h = await start({ maxPlayers: 3 })
    for (const n of ['a', 'b', 'c']) await joinAs(h, n)
    expect((await post(h, '/live/join', { code: h.code, name: 'd' })).status).toBe(409)
  })
})

describe('a whole quiz with three players', () => {
  it('runs lobby, three questions, leaderboards and the podium, and keeps the key out of the question', async () => {
    const clock = fakeClock()
    const h = await start({ now: clock.now })
    const ana = await joinAs(h, 'Ana')
    const bo = await joinAs(h, 'Bo')
    const cy = await joinAs(h, 'Cy')
    const sse = { ana: await events(h, ana.token), bo: await events(h, bo.token), cy: await events(h, cy.token) }
    const lobby = await sse.ana.until('lobby')
    expect((lobby.data as RoomView).you?.nickname).toBe('Ana')
    const hostSse = await SseReader.open(url(h, `/live/host/${h.hostToken}/events`))
    readers.push(hostSse)
    expect((await hostSse.next()).event).toBe('host')

    expect((await hostPost(h, 'start')).status).toBe(200)
    for (let q = 1; q <= 3; q++) {
      const ev = await sse.bo.until('question')
      const view = ev.data as RoomView
      expect(view.question?.prompt).toBe(`Prompt q${q}`)
      expect(JSON.stringify(view)).not.toContain(`Because q${q}`)
      expect(JSON.stringify(view)).not.toContain('correctIds')
      await sse.ana.until('question')
      await sse.cy.until('question')
      expect((await post(h, '/live/answer', { token: ana.token, answer: { option: 'a' } })).status).toBe(200)
      expect((await post(h, '/live/answer', { token: ana.token, answer: { option: 'b' } })).status).toBe(409)
      clock.advance(10_000)
      expect((await post(h, '/live/answer', { token: cy.token, answer: { option: 'a' } })).status).toBe(200)
      expect((await post(h, '/live/answer', { token: bo.token, answer: { option: 'b' } })).status).toBe(200)
      // everybody connected has answered: the question ends by itself
      const rev = (await sse.ana.until('reveal')).data as RoomView
      expect(rev.reveal?.correctIds).toEqual(['a'])
      expect(rev.reveal?.explanation).toBe(`Because q${q}`)
      expect(rev.reveal?.you.correct).toBe(true)
      expect(((await sse.bo.until('reveal')).data as RoomView).reveal?.you.correct).toBe(false)
      expect((await hostPost(h, 'next')).status).toBe(200)
      const board = (await sse.cy.until('leaderboard')).data as RoomView
      expect(board.leaderboard?.rows.map((r) => r.nickname)).toEqual(['Ana', 'Cy', 'Bo'])
      expect((await hostPost(h, 'next')).status).toBe(200)
    }
    const pod = (await sse.bo.until('podium')).data as RoomView
    expect(pod.podium?.rows.map((r) => `${r.rank}:${r.nickname}:${r.score}`)).toEqual(['1:Ana:3150', '2:Cy:2400', '3:Bo:0'])
    expect(pod.you?.rank).toBe(3)
    const state = (await (await fetch(url(h, `/live/host/${h.hostToken}/state`))).json()) as Record<string, unknown>
    expect(state.phase).toBe('podium')
    expect(state.code).toBe(h.code)
  })

  it('refuses an answer after the deadline and an unknown token, and the host can end a question early', async () => {
    const clock = fakeClock()
    const h = await start({ now: clock.now })
    const ana = await joinAs(h, 'Ana')
    const bo = await joinAs(h, 'Bo')
    await hostPost(h, 'start')
    expect((await post(h, '/live/answer', { token: 'nope', answer: { option: 'a' } })).status).toBe(401)
    expect((await post(h, '/live/answer', { token: ana.token, answer: { option: 'zzz' } })).status).toBe(400)
    clock.advance(20_001)
    const late = await post(h, '/live/answer', { token: bo.token, answer: { option: 'a' } })
    expect(late.status).toBe(409)
    expect(((await late.json()) as { error: string }).error).toBe('late')
    expect(h.room.phase).toBe('reveal')
    expect((await hostPost(h, 'end-question')).status).toBe(409)
    expect((await hostPost(h, 'next')).status).toBe(200)
    expect((await hostPost(h, 'next')).status).toBe(200)
    expect(h.room.phase).toBe('question')
    expect((await hostPost(h, 'end-question')).status).toBe(200)
    expect(h.room.phase).toBe('reveal')
  })

  it('ends the question at the deadline by itself (timer) when nobody is connected', async () => {
    const h = await start({ secondsPerQuestion: 0.3 })
    await joinAs(h, 'Ana')
    await hostPost(h, 'start')
    expect(h.room.phase).toBe('question')
    // the room's own timer: shorten by moving the deadline into the past is not possible here, so the real timer fires after 0.3 s
    await new Promise((r) => setTimeout(r, 700))
    expect(h.room.phase).toBe('reveal')
  }, 15_000)
})

describe('reconnecting', () => {
  it('sends the whole current view on connect, and marks the player connected and disconnected', async () => {
    const h = await start()
    const ana = await joinAs(h, 'Ana')
    const bo = await joinAs(h, 'Bo')
    const first = await events(h, ana.token)
    await first.until('lobby')
    await events(h, bo.token)
    expect(h.room.hostView().connected).toBe(2)
    await hostPost(h, 'start')
    await first.until('question')
    await post(h, '/live/answer', { token: ana.token, answer: { option: 'a' } })
    first.close()
    await new Promise((r) => setTimeout(r, 100))
    expect(h.room.hostView().connected).toBe(1)
    const again = await events(h, ana.token)
    const ev = await again.next()
    expect(ev.event).toBe('question')
    const v = ev.data as RoomView
    expect(v.you?.answered).toBe(true)
    expect(v.question?.index).toBe(0)
    expect(h.room.hostView().connected).toBe(2)
  })

  it('refuses a stream for an unknown token', async () => {
    const h = await start()
    const r = await events(h, 'nope')
    expect(r.status).toBe(401)
  })
})

describe('the host routes', () => {
  it('need the host token', async () => {
    const h = await start()
    await joinAs(h, 'Ana')
    expect((await fetch(url(h, '/live/host/00000000000000000000000000000000/state'))).status).toBe(404)
    expect((await post(h, '/live/host/00000000000000000000000000000000/start', {})).status).toBe(404)
    expect((await fetch(url(h, '/live/host/'))).status).toBe(404)
    expect(h.room.phase).toBe('lobby')
    expect((await fetch(url(h, `/live/host/${h.hostToken}/state`))).status).toBe(200)
    const page = await fetch(url(h, `/live/host/${h.hostToken}/`))
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'")
  })

  it('never shows the host token to a player', async () => {
    const h = await start()
    const ana = await joinAs(h, 'Ana')
    const s = await events(h, ana.token)
    const first = await s.next()
    expect(JSON.stringify(first)).not.toContain(h.hostToken)
    expect(await (await fetch(url(h, '/live/info'))).text()).not.toContain(h.hostToken)
  })

  it('kicks a player: the token stops working and the stream ends', async () => {
    const h = await start()
    const ana = await joinAs(h, 'Ana')
    const bo = await joinAs(h, 'Bo')
    const s = await events(h, bo.token)
    await s.until('lobby')
    expect((await hostPost(h, 'kick', { playerId: bo.id })).status).toBe(200)
    const end = await s.until('end')
    expect(end.event).toBe('end')
    expect((await events(h, bo.token)).status).toBe(401)
    expect((await hostPost(h, 'kick', { playerId: bo.id })).status).toBe(404)
    expect(h.room.hostView().roster.map((p) => p.nickname)).toEqual(['Ana'])
    expect((await post(h, '/live/answer', { token: ana.token, answer: { option: 'a' } })).status).toBe(409)
  })

  it('close tells every stream and shuts the server down', async () => {
    const h = await start()
    const ana = await joinAs(h, 'Ana')
    const s = await events(h, ana.token)
    await s.until('lobby')
    expect((await hostPost(h, 'close')).status).toBe(200)
    expect((await s.until('closed')).event).toBe('closed')
    expect((await s.until('end')).event).toBe('end')
    await h.close()
    expect(h.closedReason).toBe('host closed the room')
    await expect(fetch(url(h, '/live/info'))).rejects.toThrow()
  })
})

describe('closing by itself', () => {
  it('closes after the idle time without a connection, but not while a stream is open', async () => {
    const h = await start({ idleMs: 400, sweepMs: 40 })
    const ana = await joinAs(h, 'Ana')
    const s = await events(h, ana.token)
    await s.until('lobby')
    await new Promise((r) => setTimeout(r, 700))
    expect(h.closedReason).toBeUndefined()
    s.close()
    await new Promise((r) => setTimeout(r, 900))
    expect(h.closedReason).toBe('no connection for a while')
    expect(h.room.phase).toBe('closed')
    await expect(fetch(url(h, '/live/info'))).rejects.toThrow()
  })

  it('closes at the time limit', async () => {
    const h = await start({ maxMs: 150 })
    await new Promise((r) => setTimeout(r, 500))
    expect(h.closedReason).toBe('time limit reached')
    expect(h.room.phase).toBe('closed')
  })
})
