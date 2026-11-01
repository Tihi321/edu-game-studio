import { afterEach, describe, expect, it } from 'vitest'
import { createFlowClient } from '../src/engine/studios/flow'
import { createMcpClient } from '../src/engine/studios/mcp-http'
import { fakeMcpServer } from './studio-fakes'
import type { FakeTool } from './studio-fakes'

let closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((c) => c()))
  closers = []
})
async function serve(tools: Record<string, FakeTool>) {
  const s = await fakeMcpServer({ tools })
  closers.push(s.close)
  return s
}
const client = (url: string) => createFlowClient({ url, notRunningHint: 'start flow-music-mcp', timeoutMs: 2000, pollS: 1 })
const out = (r: unknown) => ({ structured: r as Record<string, unknown> })

describe('MCP client: a restarted server', () => {
  it('starts a new session once when the server forgets the old one (HTTP 404), then repeats the request', async () => {
    let session = 0
    let stale = false
    const seen: string[] = []
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      const m = JSON.parse(String(init.body)) as { id?: number; method: string }
      const sid = (init.headers as Record<string, string>)['Mcp-Session-Id']
      seen.push(`${m.method}:${sid ?? '-'}`)
      if (m.method !== 'initialize' && stale && sid === 's1') return new Response('Session not found', { status: 404 })
      if (m.id === undefined) return new Response(null, { status: 202 })
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (m.method === 'initialize') headers['mcp-session-id'] = `s${++session}`
      const result = m.method === 'tools/list' ? { tools: [{ name: 'a' }] } : { protocolVersion: '2025-06-18' }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }), { status: 200, headers })
    }) as never
    const c = createMcpClient({ url: 'http://x/mcp', label: 'Fake', notRunningHint: 'h', fetchImpl })
    await c.listTools()
    stale = true // the server restarted: s1 is unknown now
    expect((await c.listTools()).map((t) => t.name)).toEqual(['a'])
    expect(seen.filter((s) => s.startsWith('initialize'))).toHaveLength(2)
    expect(seen.at(-1)).toBe('tools/list:s2')
  })
})

describe('flow client', () => {
  it('status: not signed in, signed in, busy (unknown) and not running', async () => {
    let flow: unknown = { signed_in: true }
    let chrome = true
    const s = await serve({ flow_status: () => out({ chrome_running: chrome, flow, upload_rights: 'agree (set by the user)' }) })
    const c = client(s.url)
    expect(await c.status()).toEqual({ up: true, signedIn: true, uploadRights: true })
    flow = { signed_in: false, hint: 'Flow is not signed in. Run `yarn login`' }
    expect(await c.status()).toMatchObject({ up: true, signedIn: false, hint: expect.stringContaining('yarn login') })
    flow = undefined
    expect(await c.status()).toMatchObject({ up: true, signedIn: null })
    chrome = false
    // Chrome closed is unknown (flow-music-mcp opens it on the first call), so it does not block
    const closed = await c.status()
    expect(closed).toMatchObject({ up: true, signedIn: null })
    expect(closed.hint).toBeUndefined()
    flow = { signed_in: false, hint: 'Flow is not signed in. Run `yarn login`' }
    chrome = true
    expect(await c.status()).toMatchObject({ signedIn: false })
    expect(s.seen.find((x) => x.body.params?.name === 'flow_status')!.body.params!.arguments).toEqual({ detailed: false })
    const down = createFlowClient({ url: 'http://127.0.0.1:1/mcp', notRunningHint: 'start flow-music-mcp', timeoutMs: 500 })
    expect(await down.status()).toMatchObject({ up: false, signedIn: null, hint: 'start flow-music-mcp' })
  })

  it('generateImage: one scene with max_credits 0, then flow_wait until done, and returns the file and media id', async () => {
    let polls = 0
    const s = await serve({
      flow_generate: () => out({ finished: false, jobs: [{ job_id: 'j1', status: 'queued' }] }),
      flow_wait: () => {
        polls++
        return polls < 3
          ? out({ finished: false, jobs: [{ job_id: 'j1', status: 'running' }] })
          : out({ finished: true, jobs: [{ job_id: 'j1', status: 'done', project: { id: 'p', name: 'edu-x' }, images: [{ scene: 1, file: 'C:\\o\\bg-01.jpeg', media_id: 'm-123', title: 't', variant: 1 }] }] })
      }
    })
    const r = await client(s.url).generateImage({ prompt: 'a harbour', aspect: '16:9', quality: 'upscaled', model: 'Nano Banana Pro', references: ['asset:a', 'asset:b', 'asset:c', 'asset:d'], project: 'edu-x', out: 'C:\\o', name: 'bg', timeoutMs: 20_000 })
    expect(r).toEqual({ file: 'C:\\o\\bg-01.jpeg', mediaId: 'm-123', project: 'edu-x' })
    expect(polls).toBe(3)
    const call = s.seen.find((x) => x.body.params?.name === 'flow_generate')!.body.params!.arguments as Record<string, unknown>
    expect(call).toMatchObject({ project: 'edu-x', create_project: true, out: 'C:\\o', name: 'bg', start_number: 1, wait: 0 })
    const scene = (call.scenes as Record<string, unknown>[])[0]!
    expect(scene).toMatchObject({ prompt: 'a harbour', type: 'image', aspect_ratio: '16:9', model: 'Nano Banana Pro', download_quality: 'upscaled', max_credits: 0 })
    expect(scene.reference_images).toEqual(['asset:a', 'asset:b', 'asset:c'])
  })

  it('a job the server lost, a failed job and a timeout are errors with kinds', async () => {
    const lost = await serve({ flow_generate: () => out({ jobs: [{ job_id: 'j1', status: 'queued' }] }), flow_wait: () => out({ jobs: [{ job_id: 'j1', status: 'unknown' }] }) })
    await expect(client(lost.url).generateImage({ prompt: 'x', aspect: '1:1', quality: 'original', project: 'p', out: 'C:\\o', name: 'n', timeoutMs: 5000 })).rejects.toMatchObject({ kind: 'lost', message: expect.stringContaining('generate again') })

    const failed = await serve({ flow_generate: () => out({ jobs: [{ job_id: 'j1', status: 'queued' }] }), flow_wait: () => out({ jobs: [{ job_id: 'j1', status: 'failed', error: 'Flow reports high demand' }] }) })
    await expect(client(failed.url).generateImage({ prompt: 'x', aspect: '1:1', quality: 'original', project: 'p', out: 'C:\\o', name: 'n', timeoutMs: 5000 })).rejects.toMatchObject({ kind: 'tool', message: expect.stringContaining('high demand') })

    const slow = await serve({
      flow_generate: () => out({ jobs: [{ job_id: 'j1', status: 'queued' }] }),
      flow_wait: () => out({ jobs: [{ job_id: 'j1', status: 'running' }] }),
      flow_cancel: () => out({ job_id: 'j1', status: 'cancelled' })
    })
    await expect(client(slow.url).generateImage({ prompt: 'x', aspect: '1:1', quality: 'original', project: 'p', out: 'C:\\o', name: 'n', timeoutMs: 300 })).rejects.toMatchObject({ kind: 'timeout' })
    expect(slow.seen.some((x) => x.body.params?.name === 'flow_cancel')).toBe(true)
  })
})
