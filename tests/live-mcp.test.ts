import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildTools, callTool, type Tool } from '../src/engine/mcp/tools'
import { FIXTURES } from './edu-fixtures'
import { makeEduEnv, type EduEnv } from './edu-helpers'
import { fakeBundle, useTemp } from './edu-build-helpers'
import { LIVE_OUT } from './live-helpers'

/** The live quiz MCP tools (EGS-21): start a room for a built course, status, stop. */

useTemp()

let env: EduEnv
let tools: Tool[]
const saved = { player: process.env.EDU_PLAYER_DIR, live: process.env.EDU_LIVE_DIR }
const started: string[] = []

beforeAll(async () => {
  process.env.EDU_PLAYER_DIR = await fakeBundle()
  process.env.EDU_LIVE_DIR = LIVE_OUT
  env = await makeEduEnv()
  tools = buildTools(env.engine.edu, { control: env.engine.mcpControl(), clientQueue: env.engine.clientQueue })
})

afterAll(async () => {
  for (const id of started) await callTool(tools, 'edu_live_stop', { roomId: id })
  if (saved.player === undefined) delete process.env.EDU_PLAYER_DIR
  else process.env.EDU_PLAYER_DIR = saved.player
  if (saved.live === undefined) delete process.env.EDU_LIVE_DIR
  else process.env.EDU_LIVE_DIR = saved.live
  await env.cleanup()
})

type Data = Record<string, unknown>
async function call(name: string, args: Data = {}): Promise<{ ok: boolean; data: Data; text: string }> {
  const r = await callTool(tools, name, args)
  const text = r.content[0].text
  return r.isError ? { ok: false, data: { error: text }, text } : { ok: true, data: r.structuredContent as Data, text }
}
async function must(name: string, args: Data = {}): Promise<Data> {
  const r = await call(name, args)
  if (!r.ok) throw new Error(`${name} failed: ${r.text}`)
  return r.data
}

describe('edu_live_*', () => {
  it('is registered with the other tools', () => {
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['edu_live_start', 'edu_live_status', 'edu_live_stop']))
  })

  it('refuses a missing course, an unbuilt course and an unknown edition', async () => {
    expect((await call('edu_live_start', { slug: 'nope' })).text).toMatch(/no course/)
    await must('edu_import_course', { folder: path.join(FIXTURES, 'solar-system'), slug: 'solar' })
    expect((await call('edu_live_start', { slug: 'solar' })).text).toMatch(/not built/)
    await must('edu_build', { slug: 'solar' })
    expect((await call('edu_live_start', { slug: 'solar', lang: 'de' })).text).toMatch(/no "de" edition/)
    expect((await call('edu_live_start', { slug: 'solar', questions: 0 })).ok).toBe(false)
    expect((await call('edu_live_start', { slug: '../x' })).ok).toBe(false)
  })

  it('starts a room on loopback, lists it, serves it, and stops it', async () => {
    const r = await must('edu_live_start', { slug: 'solar', questions: 4, secondsPerQuestion: 10, lang: 'hr' })
    started.push(r.roomId as string)
    expect(r).toMatchObject({ lan: false, lang: 'hr', questions: 4, secondsPerQuestion: 10, phase: 'lobby' })
    expect(r.code).toMatch(/^\d{6}$/)
    expect(r.hostUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/live\/host\/[0-9a-f]{32}\/$/)
    expect(r.playerUrls).toEqual([`http://127.0.0.1:${String(r.port)}/live/`])
    expect(String((r.notes as string[]).join(' '))).toMatch(/127\.0\.0\.1 only/)

    const join = await fetch(`http://127.0.0.1:${String(r.port)}/live/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: r.code, name: 'Ana' }) })
    expect(join.status).toBe(200)
    const info = (await (await fetch(`http://127.0.0.1:${String(r.port)}/live/info`)).json()) as Data
    expect(info.lang).toBe('hr')

    const one = await must('edu_live_status', { roomId: r.roomId })
    expect(one).toMatchObject({ roomId: r.roomId, players: 1, phase: 'lobby', questionCount: 4, code: r.code })
    expect('hostUrl' in one).toBe(false)
    const all = await must('edu_live_status')
    expect((all.rooms as Data[]).map((x) => x.roomId)).toContain(r.roomId)

    const stop = await must('edu_live_stop', { roomId: r.roomId })
    expect(stop).toMatchObject({ stopped: true, phase: 'closed', players: 1 })
    expect(await must('edu_live_status', { roomId: r.roomId })).toMatchObject({ phase: 'closed', closedReason: 'stopped by edu_live_stop' })
    await expect(fetch(`http://127.0.0.1:${String(r.port)}/live/info`)).rejects.toThrow()
    expect((await call('edu_live_stop', { roomId: 'nope' })).text).toMatch(/no live room/)
  })

  it('says when fewer questions exist than asked', async () => {
    const r = await must('edu_live_start', { slug: 'solar', questions: 50 })
    started.push(r.roomId as string)
    expect(r.questions as number).toBeLessThan(50)
    expect(String((r.notes as string[]).join(' '))).toMatch(/only \d+ usable questions/)
  })
})
