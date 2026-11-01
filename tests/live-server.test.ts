import { afterEach, describe, expect, it } from 'vitest'
import { startLiveServer, type LiveHandle, type LiveServerOptions } from '../src/engine/live/server'
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

describe('joining', () => {
  it('binds to loopback, joins with the right code and refuses a wrong code, a bad or taken name and a flood of guesses; no host token reaches a player', async () => {
    const clock = fakeClock()
    const h = await start({ now: clock.now })
    expect(h.bind).toBe('127.0.0.1')
    expect(h.playerUrls).toEqual([`http://127.0.0.1:${h.port}/live/`])
    const ok = await post(h, '/live/join', { code: h.code, name: '  Ana ' })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { token: string; view: RoomView }
    expect(body.view.you?.nickname).toBe('Ana')
    expect(JSON.stringify(body)).not.toContain(h.hostToken)
    expect((await post(h, '/live/join', { code: h.code, name: 'x'.repeat(21) })).status).toBe(400)
    expect((await post(h, '/live/join', { code: h.code, name: 'ana' })).status).toBe(409)
    expect((await post(h, '/live/join', { code: h.code, name: 'B' }, { Origin: 'http://evil.example' })).status).toBe(403)
    const bad = h.code === '123456' ? '654321' : '123456'
    for (let i = 0; i < 10; i++) expect((await post(h, '/live/join', { code: bad, name: 'A' })).status).toBe(403)
    expect((await post(h, '/live/join', { code: bad, name: 'A' })).status).toBe(429)
    expect((await post(h, '/live/join', { code: h.code, name: 'Cy' })).status).toBe(429)
    clock.advance(60_001)
    expect((await post(h, '/live/join', { code: h.code, name: 'Cy' })).status).toBe(200)
  })
})

describe('answering', () => {
  it('refuses an unknown token, a malformed answer and a late one; the host ends a question early and needs its token', async () => {
    const clock = fakeClock()
    const h = await start({ now: clock.now })
    const ana = await joinAs(h, 'Ana')
    const bo = await joinAs(h, 'Bo')
    expect((await post(h, '/live/host/00000000000000000000000000000000/start', {})).status).toBe(404)
    await hostPost(h, 'start')
    expect((await post(h, '/live/answer', { token: 'nope', answer: { option: 'a' } })).status).toBe(401)
    expect((await post(h, '/live/answer', { token: ana.token, answer: { option: 'zzz' } })).status).toBe(400)
    clock.advance(20_001)
    const late = await post(h, '/live/answer', { token: bo.token, answer: { option: 'a' } })
    expect(late.status).toBe(409)
    expect(((await late.json()) as { error: string }).error).toBe('late')
    expect(h.room.phase).toBe('reveal')
    await hostPost(h, 'next')
    await hostPost(h, 'next')
    expect((await hostPost(h, 'end-question')).status).toBe(200)
    expect(h.room.phase).toBe('reveal')
  })
})

describe('the scoreboard', () => {
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
})

describe('disconnecting', () => {
  it('marks a player connected and disconnected, resends the whole view on reconnect, ends the stream of a kicked player and of a closed room', async () => {
    const h = await start()
    const ana = await joinAs(h, 'Ana')
    const bo = await joinAs(h, 'Bo')
    const hostSse = await SseReader.open(url(h, `/live/host/${h.hostToken}/events`))
    readers.push(hostSse)
    const connected = async (n: number): Promise<void> => {
      for (let e = await hostSse.next(); (e.data as { connected?: number } | null)?.connected !== n; e = await hostSse.next());
    }
    const first = await events(h, ana.token)
    await events(h, bo.token)
    await connected(2)
    await hostPost(h, 'start')
    await first.until('question')
    await post(h, '/live/answer', { token: ana.token, answer: { option: 'a' } })
    first.close()
    await connected(1)
    const again = await events(h, ana.token)
    const ev = await again.next()
    expect(ev.event).toBe('question')
    expect((ev.data as RoomView).you?.answered).toBe(true)
    expect((await events(h, 'nope')).status).toBe(401)

    const boSse = await events(h, bo.token)
    expect((await hostPost(h, 'kick', { playerId: bo.id })).status).toBe(200)
    expect((await boSse.until('end')).event).toBe('end')
    expect((await events(h, bo.token)).status).toBe(401)

    expect((await hostPost(h, 'close')).status).toBe(200)
    expect((await again.until('closed')).event).toBe('closed')
    await h.close()
    expect(h.closedReason).toBe('host closed the room')
    await expect(fetch(url(h, '/live/info'))).rejects.toThrow()
  })
})
