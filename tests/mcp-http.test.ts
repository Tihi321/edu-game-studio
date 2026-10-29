import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpHttpServer } from '../src/engine/mcp/http'
import { buildTools } from '../src/engine/mcp/tools'
import { waitFor } from './helpers'
import { makeEduEnv } from './edu-helpers'
import type { EduEnv } from './edu-helpers'

let env: EduEnv | undefined
let server: McpHttpServer | undefined
const clients: Client[] = []
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => undefined)
  await server?.stop()
  server = undefined
  await env?.cleanup()
  env = undefined
})

async function start(o: { token?: string; port?: number; client?: boolean } = {}): Promise<McpHttpServer> {
  env = await makeEduEnv({ client: o.client })
  server = new McpHttpServer({ host: { tools: buildTools(env.engine.edu, { control: env.engine.mcpControl(), clientQueue: env.engine.clientQueue }) }, port: o.port ?? 0, token: o.token })
  const st = await server.start()
  expect(st.running).toBe(true)
  return server
}

async function connect(url: string, token?: string): Promise<Client> {
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined }))
  clients.push(client)
  return client
}

/** A course folder the engine lists: `courses/<slug>/course.md`. */
async function makeCourse(slug: string): Promise<void> {
  const dir = path.join(env!.dir, 'courses', slug)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'course.md'), `---\nslug: ${slug}\n---\n`)
}

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }

/** A raw POST with chosen headers (the SDK client always sends a good Host). */
function post(url: string, headers: Record<string, string>, body: unknown = INIT): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers } }, (res) => {
      let text = ''
      res.on('data', (d: Buffer) => (text += d.toString('utf8')))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
    })
    req.on('error', reject)
    req.end(JSON.stringify(body))
  })
}

const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })).structuredContent as Record<string, unknown>

describe('MCP over HTTP', () => {
  it('initialises, lists the tools, calls one and reads the guide', async () => {
    const s = await start()
    const client = await connect(s.url()!)
    expect(client.getServerVersion()).toMatchObject({ name: 'edu-studio' })
    expect(client.getInstructions()).toMatch(/edu_list_courses/)
    expect(s.getStatus().sessions).toBe(1)
    const names = (await client.listTools()).tools.map((t) => t.name)
    for (const n of ['edu_list_courses', 'edu_status', 'edu_wait', 'edu_languages', 'edu_client_tasks', 'edu_get_task', 'edu_submit_task', 'edu_release_task', 'edu_pause_all', 'edu_resume_all', 'edu_stop_now', 'edu_clear_queue']) expect(names).toContain(n)
    expect(names.every((n) => n.startsWith('edu_'))).toBe(true)
    await makeCourse('demo')
    const list = await client.callTool({ name: 'edu_list_courses', arguments: {} })
    expect((list.structuredContent as { courses: { slug: string }[] }).courses.map((c) => c.slug)).toEqual(['demo'])
    const guide = await client.readResource({ uri: 'edu-studio://guide' })
    expect((guide.contents[0] as { text: string }).text).toMatch(/Edu Studio/)
    await s.stop()
    expect(s.getStatus()).toMatchObject({ running: false, url: null, sessions: 0 })
  })

  it('lists the languages and the local voice engines hermetically', async () => {
    const s = await start()
    const client = await connect(s.url()!)
    const langs = (await call(client, 'edu_languages')) as { languages: { code: string; native: string }[] }
    expect(langs.languages.find((l) => l.code === 'hr')).toMatchObject({ native: 'Hrvatski' })
    // An unreachable lane keeps the status test hermetic: the engines and their languages are still listed.
    await writeFile(path.join(env!.dir, 'config', 'comfy.md'), '---\nkind: comfy\nlanes: [http://127.0.0.1:9]\n---\n')
    const status = (await client.callTool({ name: 'edu_voice_status', arguments: {} })).structuredContent as {
      ok: boolean
      error: string
      comfyUrl: string
      defaultEngine: string
      engines: { id: string; task: string; languages: string[] | '*'; ready: boolean; missing: string[] }[]
      workflows: { name: string; languages: string[] }[]
    }
    expect(status.ok).toBe(false)
    expect(status.error).toMatch(/not reachable/)
    expect(status.comfyUrl).toBe('http://127.0.0.1:9')
    expect(status.defaultEngine).toBe('omnivoice')
    expect(status.engines.map((e) => e.id)).toEqual(expect.arrayContaining(['omnivoice', 'higgs-audio-v3', 'chatterbox-23lang', 'moss-soundeffect-v2']))
    expect(status.engines.find((e) => e.id === 'omnivoice')).toMatchObject({ task: 'tts', languages: '*' })
    expect(status.engines.find((e) => e.id === 'moss-soundeffect-v2')).toMatchObject({ task: 'sfx', languages: [] })
    expect(status.workflows).toEqual([expect.objectContaining({ name: 'chatterbox-multilingual' })])
  })

  it('answers edu_status while an edu_wait call is still open', async () => {
    const s = await start()
    const waiter = await connect(s.url()!)
    const other = await connect(s.url()!)
    await makeCourse('demo')
    await env!.engine.setPaused(true) // the job stays queued, so the wait has to time out
    await env!.engine.jobs.enqueue({ id: 'demo--edu.demo--all--r1', task: 'edu.demo', role: 'director', book: 'demo', unit: 'all' })
    let waitDone = false
    const waiting = waiter.callTool({ name: 'edu_wait', arguments: { slug: 'demo', timeoutSeconds: 2 } }).then((r) => {
      waitDone = true
      return r
    })
    await new Promise((r) => setTimeout(r, 300))
    const st = await other.callTool({ name: 'edu_status', arguments: { slug: 'demo' } })
    expect(st.isError).toBeFalsy()
    expect(st.structuredContent).toMatchObject({ slug: 'demo', jobs: { queued: 1, running: 0, done: 0, failed: 0 } })
    expect(waitDone).toBe(false) // the status came back first
    const done = await waiting
    expect((done.structuredContent as { timedOut: boolean }).timedOut).toBe(true)
  }, 30_000)

  it('edu_status without a slug lists the courses with their job counts; an unknown course is an error result', async () => {
    const s = await start()
    const c = await connect(s.url()!)
    await makeCourse('alpha')
    await makeCourse('beta')
    const all = (await call(c, 'edu_status')) as { courses: { slug: string; jobs: { queued: number } }[]; clientTasks: unknown }
    expect(all.courses.map((x) => x.slug)).toEqual(['alpha', 'beta'])
    expect(all.clientTasks).toEqual({ waiting: 0, leased: 0 })
    const bad = await c.callTool({ name: 'edu_status', arguments: { slug: 'nope' } })
    expect(bad.isError).toBe(true)
  })

  it('refuses a wrong Host or Origin, and a missing or wrong token', async () => {
    const s = await start({ token: 's3cret' })
    const url = s.url()!
    const port = new URL(url).port
    const good = { host: `127.0.0.1:${port}`, authorization: 'Bearer s3cret' }
    expect((await post(url, good)).status).toBe(200)
    expect((await post(url, { ...good, host: 'evil.example:80' })).status).toBe(403)
    expect((await post(url, { ...good, origin: 'http://evil.example' })).status).toBe(403)
    expect((await post(url, { host: good.host })).status).toBe(401)
    expect((await post(url, { host: good.host, authorization: 'Bearer nope' })).status).toBe(401)
    expect((await post(url.replace('/mcp', '/other'), good)).status).toBe(404)
    await expect(connect(url)).rejects.toThrow()
    const ok = await connect(url, 's3cret')
    expect((await ok.listTools()).tools.length).toBeGreaterThan(10)
  })

  it('reports a port that is already in use instead of throwing', async () => {
    const blocker = net.createServer()
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()))
    const port = (blocker.address() as net.AddressInfo).port
    try {
      env = await makeEduEnv()
      const seen: unknown[] = []
      server = new McpHttpServer({ host: { tools: buildTools(env.engine.edu) }, port, onStatus: (st) => seen.push(st) })
      const st = await server.start()
      expect(st).toMatchObject({ running: false, url: null, error: `Port ${port} is already in use.` })
      expect(seen).toHaveLength(1)
    } finally {
      await new Promise((r) => blocker.close(r))
    }
  })
})

describe('MCP client tasks', () => {
  type Tasks = { waiting: number; leased: number; tasks: { id: string; state: string; role: string }[] }

  it('lists the four client tools, the guide section and clientTasks in edu_status', async () => {
    const s = await start({ client: true })
    const c = await connect(s.url()!)
    const names = (await c.listTools()).tools.map((t) => t.name)
    for (const n of ['edu_client_tasks', 'edu_get_task', 'edu_submit_task', 'edu_release_task']) expect(names).toContain(n)
    expect(c.getInstructions()).toMatch(/edu_get_task/)
    expect(await call(c, 'edu_client_tasks')).toEqual({ waiting: 0, leased: 0, tasks: [] })
    expect(await call(c, 'edu_get_task')).toEqual({ none: true, waiting: 0 })
    await makeCourse('demo')
    expect((await call(c, 'edu_status', { slug: 'demo' })).clientTasks).toEqual({ waiting: 0, leased: 0 })
    const guide = (await c.readResource({ uri: 'edu-studio://guide' })).contents[0] as { text: string }
    expect(guide.text).toMatch(/Do the model work yourself/)
  })

  it('edu_get_task takes a client: without it only claude-code tasks, with client: "antigravity" only that client tasks', async () => {
    const s = await start({ client: true })
    const c = await connect(s.url()!)
    const queue = env!.engine.clientQueue
    const user = [{ role: 'user' as const, content: 'hi' }]
    queue.add({ client: 'antigravity', messages: user }, { job: 'p--edu.plan--all--r1', role: 'director', task: 'edu.plan', book: 'p' })
    expect(await call(c, 'edu_get_task')).toEqual({ none: true, waiting: 1 })
    expect(await call(c, 'edu_get_task', { client: 'claude-code' })).toEqual({ none: true, waiting: 1 })
    expect(((await call(c, 'edu_client_tasks')) as unknown as { tasks: { client: string }[] }).tasks[0]!.client).toBe('antigravity')
    const got = await call(c, 'edu_get_task', { client: 'antigravity' })
    expect(got).toMatchObject({ taskId: 'p--edu.plan--all--r1#1', meta: { client: 'antigravity', role: 'director' } })
    const tool = (await c.listTools()).tools.find((t) => t.name === 'edu_get_task')!
    expect(tool.description).toMatch(/client: "antigravity"/)
    expect(Object.keys((tool.inputSchema as { properties: object }).properties)).toContain('client')
  })

  it('edu_wait returns at once while a job waits for the client; get, bad submit, release and good submit work over MCP', async () => {
    const s = await start({ client: true })
    const c = await connect(s.url()!)
    await makeCourse('demo')
    // a test job: one model call that must answer with a JSON object { ok: boolean }
    env!.engine.scheduler.register('edu.demo', async (ctx) => {
      const r = await ctx.chat({ messages: [{ role: 'system', content: 'You are a tester.' }, { role: 'user', content: 'Answer ok.' }], schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } })
      return { result: r.text }
    })
    await env!.engine.jobs.enqueue({ id: 'demo--edu.demo--all--r1', task: 'edu.demo', role: 'director', book: 'demo', unit: 'all' })
    env!.engine.scheduler.kick()
    const t0 = Date.now()
    const waited = await waitFor(async () => {
      const w = await call(c, 'edu_wait', { slug: 'demo', timeoutSeconds: 20 })
      return (w.clientTasks as number) > 0 ? w : null
    }, 30_000, 'edu_wait with clientTasks')
    expect(Date.now() - t0).toBeLessThan(15_000)
    expect(waited).toMatchObject({ timedOut: false, clientTasks: 1 })
    expect(String(waited.hint)).toMatch(/edu_get_task/)
    expect((await call(c, 'edu_status', { slug: 'demo' })).clientTasks).toEqual({ waiting: 1, leased: 0 })
    const list = (await call(c, 'edu_client_tasks')) as unknown as Tasks
    expect(list).toMatchObject({ waiting: 1, leased: 0, tasks: [{ role: 'director', state: 'waiting' }] })

    expect(await call(c, 'edu_get_task', { role: 'composer' })).toEqual({ none: true, waiting: 1 })
    const got = await call(c, 'edu_get_task', { task: 'edu.demo' })
    expect(got).toMatchObject({ taskId: expect.stringMatching(/--edu\.demo--all--r1#1$/), meta: { role: 'director', task: 'edu.demo', book: 'demo' }, leaseMinutes: 30 })
    expect(got.system).toBe('You are a tester.')
    expect(got.user).toBe('Answer ok.')
    expect(got.schema).toMatchObject({ type: 'object' })
    expect(got.output).toBe('Reply with one JSON object that matches `schema`. No prose, no code fence.')
    expect(await call(c, 'edu_get_task')).toEqual({ none: true, waiting: 0 }) // it is leased now
    const bad = await call(c, 'edu_submit_task', { taskId: got.taskId, text: 'no' })
    expect(bad.accepted).toBe(false)
    expect((bad.problems as string[]).length).toBeGreaterThan(0)
    expect(await call(c, 'edu_release_task', { taskId: got.taskId })).toEqual({ released: true })
    expect(((await call(c, 'edu_client_tasks')) as unknown as Tasks).waiting).toBe(1)
    expect(await call(c, 'edu_release_task', { taskId: 'nope#1' })).toEqual({ released: false })
    expect(await call(c, 'edu_submit_task', { taskId: 'nope#1', text: '{}' })).toEqual({ accepted: false, problems: ['task not found (it was aborted, answered, or the engine restarted)'] })

    const again = await call(c, 'edu_get_task', {})
    const ok = await call(c, 'edu_submit_task', { taskId: again.taskId, text: JSON.stringify({ ok: true }) })
    expect(ok).toEqual({ accepted: true })
    await waitFor(async () => (await call(c, 'edu_wait', { slug: 'demo', timeoutSeconds: 5 })).clientTasks === undefined, 10_000, 'the job to finish')
    expect(((await call(c, 'edu_client_tasks')) as unknown as Tasks).leased).toBe(0)
  })

  it('a vision task returns its images as MCP image content, with [image n] in the text', async () => {
    const s = await start({ client: true })
    const c = await connect(s.url()!)
    env!.engine.clientQueue.add(
      {
        messages: [
          { role: 'system', content: 'You are the art critic.' },
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: [{ type: 'text', text: 'Is this the harbour?' }, { type: 'image', mime: 'image/png', data: 'AAAA' }, { type: 'text', text: 'And this?' }, { type: 'image', mime: 'image/jpeg', data: 'BBBB' }] }
        ]
      },
      { job: 'p--edu.review--bg_harbour--r1', role: 'art-critic', task: 'edu.review', book: 'p', unit: 'bg_harbour' }
    )
    const res = await c.callTool({ name: 'edu_get_task', arguments: { role: 'art-critic' } })
    const content = res.content as { type: string; text?: string; data?: string; mimeType?: string }[]
    expect(content.map((x) => x.type)).toEqual(['text', 'image', 'image'])
    expect(content[1]).toMatchObject({ data: 'AAAA', mimeType: 'image/png' })
    expect(content[2]).toMatchObject({ data: 'BBBB', mimeType: 'image/jpeg' })
    const view = res.structuredContent as { system: string; user: string; output: string; schema?: unknown; messages?: unknown[] }
    expect(view.system).toBe('You are the art critic.\n\nBe brief.')
    expect(view.user).toBe('Is this the harbour?\n[image 1]\nAnd this?\n[image 2]')
    expect(view.output).toBe('Reply with the text only: no preamble, no notes, no code fence.')
    expect(view.messages).toBeUndefined()
    expect((view as { turns?: string }).turns).toBe('single')
  })

  it('a multi-turn task sends system and messages, and no user', async () => {
    const s = await start({ client: true })
    const c = await connect(s.url()!)
    env!.engine.clientQueue.add(
      { messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'first ask' }, { role: 'assistant', content: 'bad answer' }, { role: 'user', content: 'repair it' }] },
      { job: 'p--edu.analyse--all--r1', role: 'director', task: 'edu.analyse', book: 'p', unit: 'all' }
    )
    const res = await c.callTool({ name: 'edu_get_task', arguments: {} })
    const view = res.structuredContent as { turns: string; system: string; user?: string; messages?: { role: string; content: string }[] }
    expect(view.turns).toBe('multi')
    expect(view.user).toBeUndefined()
    expect(view.system).toBe('SYS')
    expect(view.messages).toEqual([
      { role: 'user', content: 'first ask' },
      { role: 'assistant', content: 'bad answer' },
      { role: 'user', content: 'repair it' }
    ])
  })

  it('a single-turn task carries its user text once', async () => {
    const s = await start({ client: true })
    const c = await connect(s.url()!)
    const marker = 'UNIQUE-MARKER-' + 'x'.repeat(200)
    env!.engine.clientQueue.add(
      { messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: marker }] },
      { job: 'p--edu.analyse--all--r1', role: 'director', task: 'edu.analyse', book: 'p', unit: 'all' }
    )
    const res = await c.callTool({ name: 'edu_get_task', arguments: {} })
    const json = JSON.stringify(res.structuredContent)
    expect(json.split(marker)).toHaveLength(2)
    expect(res.structuredContent).toMatchObject({ turns: 'single', user: marker })
    expect((res.structuredContent as { messages?: unknown }).messages).toBeUndefined()
  })
})
