import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Budget } from '../src/engine/budget/spend'
import { ClientTaskQueue } from '../src/engine/models/client'
import { MockProvider } from '../src/engine/models/mock'
import { OpenAiCompatClient } from '../src/engine/models/openaiCompat'
import { ModelRegistry, computeCost, isPaidModel } from '../src/engine/models/registry'
import { ModelRouter, isDailyLimitError } from '../src/engine/models/router'
import { ROLES } from '../src/shared/schemas'
import type { RoutedEvent } from '../src/engine/models/router'
import { BudgetError, collect, ProviderError } from '../src/engine/models/types'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { seedDir, writeTestConfig } from './helpers'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-models-'))
  await initDataFolder(dir, seedDir)
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function registryWith(o: Parameters<typeof writeTestConfig>[1], mock = new MockProvider()) {
  await writeTestConfig(dir, o)
  const registry = new ModelRegistry(dir, { mock })
  await registry.load()
  return { registry, mock }
}

describe('seed configs', () => {
  it('providers.md and roles.md load, and every role model exists', async () => {
    const registry = new ModelRegistry(dir, { keys: () => undefined })
    await registry.load()
    expect(registry.providers.get('deepseek')?.available).toBe(false)
    expect(registry.providers.get('deepseek')?.unavailableReason).toMatch(/no key/)
    expect(registry.providers.get('lmstudio')?.available).toBe(true)
    expect(registry.providers.get('ollama')?.available).toBe(false)
    expect(registry.providers.get('strata')).toMatchObject({ available: true, local: true, jsonSchema: false })
    expect(isPaidModel(registry.getModel('strata/qwen3.8-flash-next')!)).toBe(false)
    expect(new ModelRouter(registry, undefined).candidates('director')[0]?.ref).toBe('strata/qwen3.8-flash-next')
    const flash = registry.getModel('deepseek/deepseek-flash')!
    expect(flash).toMatchObject({ priceIn: 0.3, priceOut: 1.2, priceCachedIn: 0.006, family: 'deepseek' })
    expect(isPaidModel(flash)).toBe(true)
    expect(isPaidModel(registry.getModel('lmstudio/nail-qwen3.6-35b-a3b-mtp')!)).toBe(false)
    for (const role of Object.keys(registry.roles.roles)) for (const ref of registry.roleModelRefs(role)) expect(registry.getModel(ref), ref).toBeTruthy()
    // the seed roles use the aliases, resolved to the settings defaults
    expect(registry.roles.roles.director?.models).toEqual(['paid', 'strata', 'lmstudio'])
    expect(registry.roleModelRefs('director')).toEqual(['deepseek/deepseek-flash', 'strata/qwen3.8-flash-next', 'lmstudio/gemma-4-e4b-it'])
    // the client provider is on in the seed, with a context, and no role uses it
    expect(registry.providers.get('client')).toMatchObject({ kind: 'client', local: true, available: true, concurrency: 8 })
    expect(registry.getModel('client/claude-code')).toMatchObject({ vision: true, context: 200000 })
    for (const role of Object.keys(registry.roles.roles)) expect(registry.roleModelRefs(role)).not.toContain('client/claude-code')
    expect(registry.providers.get('lmstudio')?.loadModels).toBe(true)
    expect(registry.getModel('lmstudio/gemma-4-e4b-it')?.context).toBe(131072) // loaded with the settings' window
    // the big Qwen models have their own load settings in providers.md
    expect(registry.loadConfigFor('lmstudio', 'nail-qwen3.6-35b-a3b-mtp')).toEqual({ parallel: 2, context: 65536, ttlMinutes: 60 })
    expect(registry.loadConfigFor('lmstudio', 'gemma-4-e4b-it')).toEqual({ parallel: 4, context: 131072, ttlMinutes: 60 })
    // another default in the settings: the roles follow, and an agent override may be an alias too
    registry.setDefaults({ fallbacks: ['deepseek/deepseek-v4-pro', 'strata/qwen3.8-flash-next', 'lmstudio/nail-qwen3.6-35b-a3b-mtp'], shared: false, lmLoad: { parallel: 2, context: 16384, ttlMinutes: 30 } })
    await registry.load()
    expect(registry.roleModelRefs('director')).toEqual(['deepseek/deepseek-v4-pro', 'strata/qwen3.8-flash-next', 'lmstudio/nail-qwen3.6-35b-a3b-mtp'])
    expect(registry.getModel('lmstudio/gemma-4-e4b-it')?.context).toBe(16384)
    expect(registry.getModel('lmstudio/nail-qwen3.6-35b-a3b-mtp')?.context).toBe(65536) // its own load_context wins
    expect(new ModelRouter(registry, undefined).candidates('director', { agentModel: 'lmstudio' })[0]?.ref).toBe('lmstudio/nail-qwen3.6-35b-a3b-mtp')
    expect(Object.keys(registry.roles.roles).sort()).toEqual([...ROLES].sort()) // every role of the team has a model list (EGS-06)
    expect(registry.embeddingModel()).toBeUndefined() // Edu Studio has no embedding model
  })

  it('a server that does not answer is down: jobs skip it while another model is left, and use it again once it answers', async () => {
    let strata: Record<string, unknown> | null = null // null: Strata is not started
    const fetchImpl = (async (url: string) => {
      const u = String(url)
      if (u.includes(':8080')) {
        if (!strata) throw new Error('connection refused')
        return new Response(JSON.stringify(strata))
      }
      if (u.endsWith('/v1/status')) return new Response(JSON.stringify({ error: 'Unexpected endpoint or method. (GET /v1/status)' }))
      return new Response(JSON.stringify({ models: [] })) // LM Studio runs
    }) as unknown as typeof fetch
    const registry = new ModelRegistry(dir, { keys: () => undefined, fetchImpl })
    await registry.load()
    const router = new ModelRouter(registry, undefined)
    const refs = () => router.candidates('director').map((m) => m.ref)
    expect(refs()).toEqual(['strata/qwen3.8-flash-next', 'lmstudio/gemma-4-e4b-it']) // not asked yet
    await registry.syncServerSlots()
    expect(registry.providers.get('strata')!.down).toBe(true)
    expect(registry.providers.get('lmstudio')!.down).toBe(false)
    expect(refs()).toEqual(['lmstudio/gemma-4-e4b-it'])
    await registry.load() // a config reload keeps it
    expect(refs()).toEqual(['lmstudio/gemma-4-e4b-it'])
    strata = { loaded: false, auto_load: false, concurrency: { serving: 1 } } // answers, but won't load its model for a request
    await registry.syncServerSlots()
    expect(registry.providers.get('strata')!.down).toBe(true)
    strata = { loaded: true, auto_load: false, concurrency: { serving: 4 } }
    await registry.syncServerSlots()
    expect(refs()).toEqual(['strata/qwen3.8-flash-next', 'lmstudio/gemma-4-e4b-it'])
  })
})

describe('price math', () => {
  it('bills cached input at its own price', () => {
    const m = { priceIn: 0.3, priceOut: 1.2, priceCachedIn: 0.006 }
    // 800k uncached, 200k cached, 100k output
    const cost = computeCost(m, { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000 })
    expect(cost).toBeCloseTo(0.8 * 0.3 + 0.2 * 0.006 + 0.1 * 1.2, 9)
  })
})

describe('router', () => {
  it('orders candidates: agent override, then role list, deduplicated', async () => {
    const { registry } = await registryWith({
      providers: [{ id: 'a', models: ['x', 'y'] }, { id: 'b', local: true, models: ['z'] }],
      roles: { writer: ['a/x', 'b/z', 'a/x'] }
    })
    const r = new ModelRouter(registry, undefined)
    expect(r.candidates('writer').map((m) => m.ref)).toEqual(['a/x', 'b/z'])
    expect(r.candidates('writer', { agentModel: 'a/y' }).map((m) => m.ref)).toEqual(['a/y', 'a/x', 'b/z'])
    expect(r.candidates('unknown-role')).toEqual([])
  })

  it('retries a retryable error, then falls back to the next model in order', async () => {
    const { registry, mock } = await registryWith({
      providers: [{ id: 'a', models: ['x'] }, { id: 'b', models: ['y'] }, { id: 'c', models: ['z'] }],
      roles: { writer: ['a/x', 'b/y', 'c/z'] }
    })
    const seen: string[] = []
    mock.onAny((req) => {
      seen.push(req.model)
      if (req.model === 'x') throw new ProviderError('rate limited', 429, true)
      if (req.model === 'y') throw new ProviderError('bad request', 400, false)
      return 'from z'
    })
    const r = new ModelRouter(registry, undefined, { retries: 1, backoffMs: 1 })
    const events: string[] = []
    let text = ''
    for await (const ev of r.chat(r.candidates('writer'), { messages: [{ role: 'user', content: 'hi' }], meta: { role: 'writer' } })) {
      events.push(ev.type === 'attempt' ? `attempt:${ev.model.ref}` : ev.type)
      if (ev.type === 'delta') text += ev.text
    }
    expect(seen).toEqual(['x', 'x', 'y', 'z']) // x twice (one retry), y once (not retryable), then z
    expect(text).toBe('from z')
    expect(events.filter((e) => e.startsWith('attempt'))).toEqual(['attempt:a/x', 'attempt:a/x', 'attempt:b/y', 'attempt:c/z'])
  })

  it('a context-size error goes straight to the next model; when all fail, the error names each model', async () => {
    const { registry, mock } = await registryWith({
      providers: [{ id: 'a', models: ['x'] }, { id: 'b', models: ['y'] }, { id: 'c', models: ['z'] }],
      roles: { writer: ['a/x', 'b/y', 'c/z'] }
    })
    const seen: string[] = []
    let zWorks = true
    mock.onAny((req) => {
      seen.push(req.model)
      if (req.model === 'x') throw new ProviderError('the model stopped at its token limit without an answer (15000 tokens in, 6000 out)')
      // LM Studio sends this inside the stream, which the client marks retryable
      if (req.model === 'y') throw new ProviderError('provider error: {"message":"request (15430 tokens) exceeds the available context size (8192 tokens)","type":"exceed_context_size_error"}', undefined, true)
      if (!zWorks) throw new ProviderError('bad request', 400, false)
      return 'from z'
    })
    const r = new ModelRouter(registry, undefined, { retries: 2, backoffMs: 1 })
    const req = { messages: [{ role: 'user' as const, content: 'hi' }], meta: { role: 'writer' } }
    let text = ''
    for await (const ev of r.chat(r.candidates('writer'), req)) if (ev.type === 'delta') text += ev.text
    expect(seen).toEqual(['x', 'y', 'z']) // no retries of y on the same model
    expect(text).toBe('from z')
    zWorks = false
    const drain = async () => {
      for await (const ev of r.chat(r.candidates('writer'), req)) void ev
    }
    await expect(drain()).rejects.toThrow(/all models failed\. a\/x: .*token limit.* \| b\/y: .*exceeds the available context.* \| c\/z: bad request/)
  })

  it('refuses paid models over the cap and falls to a local one; throws BudgetError when nothing is left', async () => {
    const { registry, mock } = await registryWith({
      providers: [{ id: 'paid', price: 1000, models: ['p'] }, { id: 'loc', local: true, models: ['l'] }],
      roles: { writer: ['paid/p', 'loc/l'], solo: ['paid/p'] },
      caps: { daily: 0.5 }
    })
    mock.onAny('ok')
    const budget = new Budget(dir)
    await budget.load()
    const r = new ModelRouter(registry, budget)
    const run = async (role: string) => {
      const used: string[] = []
      for await (const ev of r.chat(r.candidates(role), { messages: [{ role: 'user', content: 'x'.repeat(40) }], meta: { role } })) {
        if (ev.type === 'done') used.push(ev.model.ref)
      }
      return used
    }
    expect(await run('writer')).toEqual(['loc/l']) // paid estimate is about 4 USD, over the 0.5 cap
    await expect(run('solo')).rejects.toBeInstanceOf(BudgetError)
    // the local call was recorded with cost 0
    expect(budget.spentToday()).toBe(0)
  })
})

describe('HTTP clients against fake servers', () => {
  let server: Server
  let base: string
  let lastBody: Record<string, unknown> = {}
  let lastHeaders: Record<string, unknown> = {}
  let handler: (url: string, res: import('node:http').ServerResponse) => void = () => undefined

  beforeEach(async () => {
    server = createServer((req, res) => {
      let data = ''
      req.on('data', (c) => (data += c))
      req.on('end', () => {
        lastBody = data ? (JSON.parse(data) as Record<string, unknown>) : {}
        lastHeaders = req.headers
        handler(req.url ?? '', res)
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterEach(async () => {
    await new Promise((r) => server.close(r))
  })

  const sse = (res: import('node:http').ServerResponse, lines: string[]) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const l of lines) res.write(l)
    res.end()
  }

  it('OpenAI-compatible: streams text, asks for usage, reads cached tokens, sends extra_body and the key', async () => {
    handler = (_u, res) =>
      sse(res, [
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":7,"prompt_cache_hit_tokens":60}}\n\n',
        'data: [DONE]\n\n'
      ])
    const c = new OpenAiCompatClient({ id: 'x', baseUrl: base + '/v1', apiKey: 'sk-test' })
    const r = await collect(c.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }], extraBody: { thinking: false }, maxTokens: 50 }))
    expect(r.text).toBe('Hello')
    expect(r.usage).toEqual({ inputTokens: 100, cachedInputTokens: 60, outputTokens: 7 })
    expect(lastBody).toMatchObject({ model: 'm', stream: true, stream_options: { include_usage: true }, thinking: false, max_tokens: 50 })
    expect(lastHeaders.authorization).toBe('Bearer sk-test')
  })

  it('OpenAI-compatible: 429 becomes a retryable error, 400 does not; embeddings and model list work', async () => {
    const c = new OpenAiCompatClient({ id: 'x', baseUrl: base + '/v1' })
    handler = (_u, res) => {
      res.writeHead(429, { 'retry-after': '2' })
      res.end('slow down')
    }
    await expect(collect(c.chat({ model: 'm', messages: [] }))).rejects.toMatchObject({ status: 429, retryable: true, retryAfterMs: 2000 })
    handler = (_u, res) => {
      res.writeHead(400)
      res.end('bad')
    }
    await expect(collect(c.chat({ model: 'm', messages: [] }))).rejects.toMatchObject({ status: 400, retryable: false })
    handler = (u, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(u.endsWith('/models') ? '{"data":[{"id":"a"},{"id":"b"}]}' : '{"data":[{"index":1,"embedding":[3,4]},{"index":0,"embedding":[1,2]}]}')
    }
    expect(await c.listModels()).toEqual(['a', 'b'])
    expect(await c.embed('e', ['x', 'y'])).toEqual([[1, 2], [3, 4]])
  })
})

describe('daily request limits', () => {

  it('a per-day 429 uses the provider up without retries, and its jobs go to the next model until midnight UTC', async () => {
    const { registry, mock } = await registryWith({ providers: [{ id: 'a', models: ['x'] }, { id: 'b', models: ['y'] }], roles: { writer: ['a/x', 'b/y'] } })
    const seen: string[] = []
    mock.onAny((req) => {
      seen.push(req.model)
      if (req.model === 'x') throw new ProviderError('HTTP 429: {"error":{"message":"Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day"}}', 429, true)
      return 'ok'
    })
    const r = new ModelRouter(registry, undefined, { retries: 2, backoffMs: 1 })
    const full: string[] = []
    r.onProviderDayFull = (p) => full.push(p.id)
    const models = r.candidates('writer')
    const ask = async () => {
      for await (const ev of r.chat(models, { messages: [{ role: 'user', content: 'hi' }], meta: { role: 'writer' } })) void ev
    }
    await ask()
    expect(seen).toEqual(['x', 'y']) // no retries on a
    expect(full).toEqual(['a'])
    expect(r.candidates('writer').map((m) => m.ref)).toEqual(['b/y'])
    await ask() // a job that picked its models earlier skips a too
    expect(seen).toEqual(['x', 'y', 'y'])
    expect(isDailyLimitError(new ProviderError('HTTP 429: too many requests', 429, true))).toBe(false)

    // our own count: b allows 3 a day, so after that every model is used up and both are tried again
    registry.providers.get('b')!.rpd = 3
    await ask()
    expect(r.candidates('writer').map((m) => m.ref)).toEqual(['a/x', 'b/y'])
  })
})

describe('client provider', () => {
  const user = (content: string) => [{ role: 'user' as const, content }]

  async function clientRegistry(queue?: ClientTaskQueue): Promise<ModelRegistry> {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path.join(dir, 'config', 'providers.md'), `---
kind: providers
providers:
  - id: client
    kind: client
    local: true
    concurrency: 8
    models:
      - id: claude-code
        vision: true
---
x
`)
    await writeFile(path.join(dir, 'config', 'roles.md'), `---
kind: roles
roles:
  writer:
    models: [client/claude-code]
---
x
`)
    const registry = new ModelRegistry(dir, { keys: () => undefined, clientQueue: queue })
    await registry.load()
    return registry
  }

  it('a request waits in the engine queue, is answered, and costs nothing', async () => {
    const queue = new ClientTaskQueue()
    const registry = await clientRegistry(queue)
    const router = new ModelRouter(registry, undefined)
    const ref = registry.getModel('client/claude-code')!
    const events: RoutedEvent[] = []
    const run = (async () => {
      for await (const ev of router.chat([ref], { messages: user('Write a haiku'), meta: { job: 'b--write--u1--r0', role: 'writer', task: 'write', book: 'b', agent: 'w', unit: 'u1' } })) events.push(ev)
    })()
    await vi.waitFor(() => expect(queue.counts()).toEqual({ waiting: 1, leased: 0 }))
    const [t] = queue.list()
    expect(t).toMatchObject({ id: 'b--write--u1--r0#1', job: 'b--write--u1--r0', call: 1, role: 'writer', task: 'write', book: 'b', agent: 'w', unit: 'u1', state: 'waiting' })
    const leased = queue.lease({ role: 'writer' })!
    expect(leased.messages).toEqual(user('Write a haiku'))
    expect(queue.submit(leased.id, 'Old pond / a frog jumps in / sound of water')).toEqual({ accepted: true })
    await run
    const delta = events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('')
    expect(delta).toBe('Old pond / a frog jumps in / sound of water')
    const done = events.find((e) => e.type === 'done') as Extract<RoutedEvent, { type: 'done' }>
    expect(done.costUsd).toBe(0)
    expect(done.usage).toMatchObject({ inputTokens: Math.ceil('Write a haiku'.length / 4), cachedInputTokens: 0, outputTokens: Math.ceil(delta.length / 4) })
    expect(queue.counts()).toEqual({ waiting: 0, leased: 0 })
  })

  it('a schema is checked on submit: a bad answer is refused with problems and the task stays leased; a good one resolves it', async () => {
    const q = new ClientTaskQueue()
    const schema = { type: 'object', properties: { n: { type: 'integer' }, kind: { type: 'string', enum: ['a', 'b'] }, tags: { type: 'array' } }, required: ['n', 'kind'] }
    const { done } = q.add({ messages: user('x'), schema }, { job: 'j' })
    q.lease()
    const r = q.submit('j#1', '{"n": "1", "tags": {}}')
    expect(r).toMatchObject({ accepted: false })
    expect((r as { problems: string[] }).problems).toEqual(expect.arrayContaining(['kind: missing (required)', 'n: expected integer, got string', 'tags: expected array, got object']))
    expect(q.submit('j#1', '   ')).toEqual({ accepted: false, problems: ['the text is empty'] })
    expect((q.submit('j#1', 'sorry') as { problems: string[] }).problems[0]).toMatch(/^not a JSON object: /)
    expect(q.counts()).toEqual({ waiting: 0, leased: 1 })
    // fences and chatter around the object are fine: the same extractJson the callers use
    expect(q.submit('j#1', 'Here you go:\n```json\n{"n": 2, "kind": "a"}\n```')).toEqual({ accepted: true })
    expect(await done).toContain('"n": 2')
    expect(q.counts()).toEqual({ waiting: 0, leased: 0 })
    // no schema: any text goes
    const t = q.add({ messages: user('x') }, { job: 'k' })
    expect(q.submit('k#1', 'plain prose')).toEqual({ accepted: true })
    expect(await t.done).toBe('plain prose')
  })
})
