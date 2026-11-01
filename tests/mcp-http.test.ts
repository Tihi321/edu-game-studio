import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpHttpServer } from '../src/engine/mcp/http'
import { buildTools } from '../src/engine/mcp/tools'
import { makeEduEnv } from './edu-helpers'
import type { EduEnv } from './edu-helpers'

/** The MCP server over a real HTTP listen on a free loopback port: session, auth, a client-task round trip, a busy port. */

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

async function start(o: { token?: string; client?: boolean } = {}): Promise<McpHttpServer> {
  env = await makeEduEnv({ client: o.client })
  server = new McpHttpServer({ host: { tools: buildTools(env.engine.edu, { control: env.engine.mcpControl(), clientQueue: env.engine.clientQueue }) }, port: 0, token: o.token })
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
  it('session: initialises, lists the tools, calls one (an unknown course is an error result), reads the guide and stops', async () => {
    const s = await start()
    const client = await connect(s.url()!)
    expect(client.getServerVersion()).toMatchObject({ name: 'edu-studio' })
    expect(client.getInstructions()).toMatch(/edu_list_courses/)
    expect(s.getStatus().sessions).toBe(1)
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain('edu_list_courses')
    expect(names.every((n) => n.startsWith('edu_'))).toBe(true)
    await makeCourse('alpha')
    await makeCourse('beta')
    const all = (await call(client, 'edu_status')) as { courses: { slug: string }[]; clientTasks: unknown }
    expect(all.courses.map((x) => x.slug)).toEqual(['alpha', 'beta'])
    expect((await client.callTool({ name: 'edu_status', arguments: { slug: 'nope' } })).isError).toBe(true)
    const guide = await client.readResource({ uri: 'edu-studio://guide' })
    expect((guide.contents[0] as { text: string }).text).toMatch(/Edu Studio/)
    await s.stop()
    expect(s.getStatus()).toMatchObject({ running: false, url: null, sessions: 0 })
  })

  it('auth: refuses a wrong Host or Origin, a missing or wrong token and another path', async () => {
    const s = await start({ token: 's3cret' })
    const url = s.url()!
    const good = { host: `127.0.0.1:${new URL(url).port}`, authorization: 'Bearer s3cret' }
    expect((await post(url, good)).status).toBe(200)
    expect((await post(url, { ...good, host: 'evil.example:80' })).status).toBe(403)
    expect((await post(url, { ...good, origin: 'http://evil.example' })).status).toBe(403)
    expect((await post(url, { host: good.host })).status).toBe(401)
    expect((await post(url, { host: good.host, authorization: 'Bearer nope' })).status).toBe(401)
    expect((await post(url.replace('/mcp', '/other'), good)).status).toBe(404)
    await expect(connect(url)).rejects.toThrow()
    expect((await (await connect(url, 's3cret')).listTools()).tools.length).toBeGreaterThan(10)
  })

  it('client tasks: a queued model call is taken, filtered by client, answered and released over MCP', async () => {
    const s = await start({ client: true })
    const c = await connect(s.url()!)
    const queue = env!.engine.clientQueue
    const marker = 'UNIQUE-MARKER-' + 'x'.repeat(200)
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }
    queue.add({ client: 'antigravity', messages: [{ role: 'user', content: 'hi' }] }, { job: 'p--edu.plan--all--r1', role: 'director', task: 'edu.plan', book: 'p' })
    queue.add({ messages: [{ role: 'system', content: 'You are a tester.' }, { role: 'user', content: marker }], schema }, { job: 'p--edu.demo--all--r1', role: 'director', task: 'edu.demo', book: 'p', unit: 'all' })
    expect(await call(c, 'edu_client_tasks')).toMatchObject({ waiting: 2, leased: 0 })
    // without a client only claude-code tasks are handed out; the antigravity one waits for its own client
    const got = await call(c, 'edu_get_task', { task: 'edu.demo' })
    expect(got).toMatchObject({ taskId: expect.stringMatching(/--edu\.demo--all--r1#1$/), meta: { role: 'director' }, turns: 'single', system: 'You are a tester.', user: marker, leaseMinutes: 30 })
    expect(JSON.stringify(got).split(marker)).toHaveLength(2) // the user text is carried once
    expect(got.schema).toMatchObject({ type: 'object' })
    expect(await call(c, 'edu_get_task')).toEqual({ none: true, waiting: 1 })
    expect(await call(c, 'edu_get_task', { client: 'antigravity' })).toMatchObject({ meta: { client: 'antigravity' } })
    const bad = await call(c, 'edu_submit_task', { taskId: got.taskId, text: 'no' })
    expect(bad.accepted).toBe(false)
    expect((bad.problems as string[]).length).toBeGreaterThan(0)
    expect(await call(c, 'edu_release_task', { taskId: got.taskId })).toEqual({ released: true })
    expect(await call(c, 'edu_release_task', { taskId: 'nope#1' })).toEqual({ released: false })
    const again = await call(c, 'edu_get_task', { task: 'edu.demo' })
    expect(await call(c, 'edu_submit_task', { taskId: again.taskId, text: JSON.stringify({ ok: true }) })).toEqual({ accepted: true })
  })

  it('reports a port that is already in use instead of throwing', async () => {
    const blocker = net.createServer()
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()))
    const port = (blocker.address() as net.AddressInfo).port
    try {
      env = await makeEduEnv()
      const seen: unknown[] = []
      server = new McpHttpServer({ host: { tools: buildTools(env.engine.edu) }, port, onStatus: (st) => seen.push(st) })
      expect(await server.start()).toMatchObject({ running: false, url: null, error: `Port ${port} is already in use.` })
      expect(seen).toHaveLength(1)
    } finally {
      await new Promise((r) => blocker.close(r))
    }
  })
})
