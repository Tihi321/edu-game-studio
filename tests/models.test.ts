import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Budget } from '../src/engine/budget/spend'
import { AnthropicClient } from '../src/engine/models/anthropic'
import { GeminiClient } from '../src/engine/models/gemini'
import { z } from 'zod'
import { jsonSchemaOf } from '../src/engine/pipeline/llm'
import { ClientProvider, ClientTaskQueue, checkAgainstSchema } from '../src/engine/models/client'
import { deleteStoredKey, getStoredKey, lookupKey, resolveKey, setStoredKey } from '../src/engine/models/keys'
import { MockProvider } from '../src/engine/models/mock'
import { OpenAiCompatClient } from '../src/engine/models/openaiCompat'
import { ProviderLimiter } from '../src/engine/models/limiter'
import { ModelRegistry, computeCost, isPaidModel } from '../src/engine/models/registry'
import type { ProviderInfo } from '../src/engine/models/registry'
import { ModelRouter, isDailyLimitError, problemKind } from '../src/engine/models/router'
import type { RoutedEvent } from '../src/engine/models/router'
import { BudgetError, collect, ProviderError } from '../src/engine/models/types'
import type { ChatEvent } from '../src/engine/models/types'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { parseMd } from '../src/shared/md'
import type { EngineEvent } from '../src/shared/protocol'
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
    expect(Object.keys(registry.roles.roles)).toHaveLength(1)
    expect(registry.embeddingModel()).toBeUndefined() // Edu Studio has no embedding model
  })

  it('concurrency: auto follows the slots the Strata server reports, and a raise frees waiting requests', async () => {
    let answer: (() => Response) | null = () => new Response(JSON.stringify({ loaded: true, concurrency: { serving: 4, requested: 4 } }))
    const asked: string[] = []
    const fetchImpl = (async (url: string) => {
      if (!String(url).includes(':8080')) throw new Error('LM Studio is not running') // only Strata in this test
      asked.push(String(url))
      if (!answer) throw new Error('connection refused')
      return answer()
    }) as unknown as typeof fetch
    const registry = new ModelRegistry(dir, { keys: () => undefined, fetchImpl })
    await registry.load()
    const strata = () => registry.providers.get('strata')!
    expect(strata()).toMatchObject({ concurrencyAuto: true, concurrency: 1 })
    expect(registry.providers.get('lmstudio')!).toMatchObject({ concurrencyAuto: true, concurrency: 1 })
    expect(await registry.syncServerSlots()).toEqual([{ provider: strata(), from: 1, to: 4 }])
    expect(asked).toEqual(['http://127.0.0.1:8080/v1/status'])
    await registry.load() // a config reload keeps what the server said
    expect(strata().concurrency).toBe(4)
    expect(await registry.syncServerSlots()).toEqual([])
    answer = null // Strata is restarting with a solo script
    expect((await registry.syncServerSlots())[0]).toMatchObject({ from: 4, to: 1 })
    // one slot taken, a second request waits; the server comes back with 2 slots and the waiting request goes
    const router = new ModelRouter(registry, undefined)
    expect(router.limiter.tryAcquire(strata())).toBe(true)
    let got = false
    const waiting = router.limiter.acquire(strata()).then(() => (got = true))
    await new Promise((r) => setTimeout(r, 10))
    expect(got).toBe(false)
    answer = () => new Response(JSON.stringify({ concurrency: { serving: 2 } }))
    for (const c of await registry.syncServerSlots()) router.limiter.wakeAll(c.provider)
    await waiting
    expect(router.limiter.inFlight('strata')).toBe(2)
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

  it('discovery adds the models LM Studio lists, except the ones discover_skip names, also after a reload', async () => {
    const fetchImpl = (async (url: string) => {
      const u = String(url)
      if (!u.startsWith('http://localhost:1234')) throw new Error('not running')
      if (u.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'nail-qwen3.6-35b-a3b-mtp' }, { id: 'qwen3.8-27b-DFlash2' }, { id: 'some-new-model' }] }))
      return new Response('{}')
    }) as unknown as typeof fetch
    const registry = new ModelRegistry(dir, { keys: () => undefined, fetchImpl })
    await registry.load()
    await registry.discover()
    const lm = () => [...registry.models.keys()].filter((r) => r.startsWith('lmstudio/'))
    expect(lm()).toContain('lmstudio/some-new-model')
    expect(lm().some((r) => /dflash/i.test(r))).toBe(false)
    await registry.load()
    expect(lm()).toContain('lmstudio/some-new-model')
  })

  it('discover: free adds the models OpenRouter lists at price 0, with their context, and nothing without a price', async () => {
    const price = (p: string, c: string) => ({ prompt: p, completion: c })
    const listed = [
      { id: 'thinkingmachines/inkling:free', context_length: 1048576, top_provider: { max_completion_tokens: 262144 }, pricing: price('0', '0'), architecture: { output_modalities: ['text'] } },
      { id: 'google/gemma-4-31b-it:free', context_length: 262144, pricing: price('0', '0') },
      { id: 'google/lyria-3-pro-preview', pricing: price('0', '0'), architecture: { output_modalities: ['text', 'audio'] } }, // music
      { id: 'nvidia/nemotron-3.5-content-safety:free', pricing: price('0', '0') }, // discover_skip
      { id: 'openai/gpt-6', context_length: 400000, pricing: { ...price('0.000003', '0.000015'), input_cache_read: '0.0000003' } },
      { id: 'openrouter/auto', pricing: price('-1', '-1') }, // "varies": no usable price
      { id: 'no-price/model' }
    ]
    const fetchImpl = (async (url: string) => {
      if (String(url) === 'https://openrouter.ai/api/v1/models') return new Response(JSON.stringify({ data: listed }))
      throw new Error('not running')
    }) as unknown as typeof fetch
    const keys = (name: string) => (name === 'OPENROUTER_API_KEY' ? 'sk-or-test' : undefined)
    const registry = new ModelRegistry(dir, { keys, fetchImpl })
    await registry.load()
    expect((await registry.discover()).find((d) => d.provider === 'openrouter')).toEqual({ provider: 'openrouter', found: 2 })
    const or = () => [...registry.models.keys()].filter((r) => r.startsWith('openrouter/') && registry.models.get(r)!.discovered).sort()
    expect(or()).toEqual(['openrouter/google/gemma-4-31b-it:free', 'openrouter/thinkingmachines/inkling:free'])
    const inkling = registry.models.get('openrouter/thinkingmachines/inkling:free')!
    expect(inkling).toMatchObject({ family: 'thinkingmachines', context: 1048576, maxOutput: 262144, priceIn: 0, priceOut: 0 })
    expect(isPaidModel(inkling)).toBe(false)
    expect(registry.models.get('openrouter/google/gemma-4-31b-it:free')!.family).toBe('gemma')

    // discover: true adds the paid ones too, with the price OpenRouter lists, but never one without a price
    const file = path.join(dir, 'config', 'providers.md')
    await writeFile(file, (await readFile(file, 'utf8')).replace('discover: free ', 'discover: true '))
    await registry.load()
    await registry.discover()
    expect(or()).toEqual(['openrouter/google/gemma-4-31b-it:free', 'openrouter/openai/gpt-6', 'openrouter/thinkingmachines/inkling:free'])
    const gpt = registry.models.get('openrouter/openai/gpt-6')!
    expect(gpt).toMatchObject({ family: 'gpt', priceIn: 3, priceOut: 15 })
    expect(gpt.priceCachedIn).toBeCloseTo(0.3)
    expect(isPaidModel(gpt)).toBe(true)
  })

  it('concurrency: auto for LM Studio adds up `parallel` of the loaded chat models', async () => {
    let loaded: { type: string; loaded_instances: { config: { parallel?: number } }[] }[] = []
    const asked: string[] = []
    const fetchImpl = (async (url: string) => {
      const u = String(url)
      if (!u.startsWith('http://localhost:1234')) throw new Error('not running')
      asked.push(u)
      // LM Studio answers unknown endpoints with 200 and an error message
      if (u.endsWith('/v1/status')) return new Response(JSON.stringify({ error: 'Unexpected endpoint or method. (GET /v1/status)' }))
      return new Response(JSON.stringify({ models: loaded }))
    }) as unknown as typeof fetch
    const registry = new ModelRegistry(dir, { keys: () => undefined, fetchImpl })
    await registry.load()
    const lm = () => registry.providers.get('lmstudio')!
    expect(await registry.syncServerSlots()).toEqual([]) // nothing loaded: 1
    expect(asked).toEqual(['http://localhost:1234/v1/status', 'http://localhost:1234/api/v1/models'])
    loaded = [
      { type: 'llm', loaded_instances: [{ config: { parallel: 4 } }] },
      { type: 'llm', loaded_instances: [{ config: {} }] }, // no parallel reported: 1
      { type: 'embedding', loaded_instances: [{ config: {} }] }
    ]
    expect(await registry.syncServerSlots()).toEqual([{ provider: lm(), from: 1, to: 5 }])
    expect(lm().concurrency).toBe(5)
  })

  it('a key from the resolver makes a provider available', async () => {
    const registry = new ModelRegistry(dir, { keys: (n) => (n === 'DEEPSEEK_API_KEY' ? 'k' : undefined) })
    await registry.load()
    expect(registry.providers.get('deepseek')?.available).toBe(true)
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

  it("keeps the agent's own model first even in the writer's family", async () => {
    const { registry } = await registryWith({
      providers: [{ id: 'ds', family: 'deepseek', models: ['f'] }, { id: 'or', family: 'nemotron', models: ['n'] }],
      roles: { 'beta-reader': ['or/n', 'ds/f'] }
    })
    const r = new ModelRouter(registry, undefined)
    expect(r.candidates('beta-reader', { agentModel: 'ds/f', avoidFamily: 'deepseek' }).map((m) => m.ref)).toEqual(['ds/f', 'or/n'])
    expect(r.candidates('beta-reader', { avoidFamily: 'deepseek' }).map((m) => m.ref)).toEqual(['or/n', 'ds/f'])
  })

  it('names the kind of each failure', () => {
    expect(problemKind(new ProviderError('HTTP 429: free-models-per-day', 429, true))).toBe('day-limit')
    expect(problemKind(new ProviderError('HTTP 429: slow down', 429, true))).toBe('rate-limit')
    expect(problemKind(new ProviderError('connect ECONNREFUSED', undefined, true, undefined, true))).toBe('down')
    expect(problemKind(new ProviderError('HTTP 400: exceeds the available context size', 400))).toBe('too-big')
    expect(problemKind(new ProviderError('HTTP 401: invalid key', 401))).toBe('no-access')
    expect(problemKind(new ProviderError('HTTP 402: insufficient credits', 402))).toBe('no-credit')
    expect(problemKind(new ProviderError('HTTP 404: no such model', 404))).toBe('not-found')
    expect(problemKind(new ProviderError('HTTP 400: bad', 400))).toBe('bad-request')
    expect(problemKind(new ProviderError('HTTP 503: overloaded', 503, true))).toBe('server')
    expect(problemKind(new Error('something'))).toBe('other')
  })

  it('avoids the writer family for reviewers', async () => {
    const { registry } = await registryWith({
      providers: [{ id: 'ds', family: 'deepseek', models: ['f'] }, { id: 'qw', family: 'qwen', models: ['q'] }],
      roles: { 'line-editor': ['ds/f', 'qw/q'] }
    })
    const r = new ModelRouter(registry, undefined)
    expect(r.candidates('line-editor', { avoidFamily: 'deepseek' }).map((m) => m.ref)).toEqual(['qw/q', 'ds/f'])
    expect(r.candidates('line-editor', { avoidFamily: 'nothing' }).map((m) => m.ref)).toEqual(['ds/f', 'qw/q'])
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

  it('skips a provider that went down after the job picked its models, unless it is the last one left', async () => {
    const { registry, mock } = await registryWith({
      providers: [{ id: 'a', local: true, models: ['x'] }, { id: 'b', local: true, models: ['y'] }],
      roles: { writer: ['a/x', 'b/y'] }
    })
    const seen: string[] = []
    mock.onAny((req) => {
      seen.push(req.model)
      return 'ok'
    })
    const r = new ModelRouter(registry, undefined)
    const models = r.candidates('writer')
    registry.providers.get('a')!.down = true
    expect(r.candidates('writer').map((m) => m.ref)).toEqual(['b/y'])
    for await (const ev of r.chat(models, { messages: [{ role: 'user', content: 'hi' }], meta: { role: 'writer' } })) void ev
    expect(seen).toEqual(['y'])
    registry.providers.get('b')!.down = true // everything down: try them anyway
    expect(r.candidates('writer').map((m) => m.ref)).toEqual(['a/x', 'b/y'])
    for await (const ev of r.chat(models, { messages: [{ role: 'user', content: 'hi' }], meta: { role: 'writer' } })) void ev
    expect(seen).toEqual(['y', 'x'])
  })

  it('a request that cannot reach a local server marks it down for every job at once, without retries', async () => {
    const { registry, mock } = await registryWith({
      providers: [{ id: 'a', local: true, models: ['x'] }, { id: 'b', local: true, models: ['y'] }],
      roles: { writer: ['a/x', 'b/y'] }
    })
    registry.providers.get('a')!.concurrencyAuto = true // as Strata
    const seen: string[] = []
    mock.onAny((req) => {
      seen.push(req.model)
      if (req.model === 'x') throw new ProviderError('network error: fetch failed (ECONNREFUSED)', undefined, true, undefined, true)
      return 'ok'
    })
    const r = new ModelRouter(registry, undefined, { retries: 2, backoffMs: 1 })
    const down: string[] = []
    r.onProviderDown = (p) => down.push(p.id)
    for await (const ev of r.chat(r.candidates('writer'), { messages: [{ role: 'user', content: 'hi' }], meta: { role: 'writer' } })) void ev
    expect(seen).toEqual(['x', 'y']) // no retries on a server that is not running
    expect(down).toEqual(['a'])
    expect(r.candidates('writer').map((m) => m.ref)).toEqual(['b/y']) // the next job skips it
  })

  it('a refused connection is an unreachable server; other network errors are not', async () => {
    const failWith = (code?: string) =>
      new OpenAiCompatClient({
        id: 'strata',
        baseUrl: 'http://127.0.0.1:1/v1',
        fetchImpl: (async () => {
          throw Object.assign(new TypeError('fetch failed'), code ? { cause: { code } } : {})
        }) as unknown as typeof fetch
      })
    const err = async (code?: string) => collect(failWith(code).chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] })).catch((e: unknown) => e as ProviderError)
    expect(await err('ECONNREFUSED')).toMatchObject({ unreachable: true, retryable: true })
    expect(await err('ECONNRESET')).toMatchObject({ unreachable: false, retryable: true })
    expect(await err()).toMatchObject({ unreachable: false })
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

  it('holds a provider slot while the stream runs (concurrency)', async () => {
    const { registry, mock } = await registryWith({ providers: [{ id: 'loc', local: true, concurrency: 1, models: ['m'] }], roles: { writer: ['loc/m'] } })
    mock.onAny({ text: 'abcdefgh', chunkDelayMs: 30, chunks: 4 })
    const r = new ModelRouter(registry, undefined)
    let active = 0
    let max = 0
    const one = async () => {
      for await (const ev of r.chat(r.candidates('writer'), { messages: [{ role: 'user', content: 'x' }], meta: { role: 'writer' } })) {
        if (ev.type === 'attempt') max = Math.max(max, ++active)
        if (ev.type === 'done') active--
      }
    }
    await Promise.all([one(), one(), one()])
    expect(max).toBe(1)
  })
})

describe('mock provider', () => {
  it('streams in chunks, reports usage, matches rules by role and task, and honours abort', async () => {
    const mock = new MockProvider('mock', { chunkDelayMs: 2 })
    mock.on({ role: 'writer', task: 'draft' }, 'scripted draft')
    const req = { model: 'm', messages: [{ role: 'user' as const, content: 'hello' }] }
    const a = await collect(mock.chat({ ...req, meta: { role: 'writer', task: 'draft' } }))
    expect(a.text).toBe('scripted draft')
    expect(a.usage.outputTokens).toBeGreaterThan(0)
    const b = await collect(mock.chat({ ...req, meta: { role: 'writer', task: 'other' } }))
    expect(b.text).toMatch(/^Mock reply for writer \/ other/)

    const ac = new AbortController()
    mock.onAny({ text: 'x'.repeat(100), chunkDelayMs: 20, chunks: 10 })
    const seen: ChatEvent[] = []
    const p = (async () => {
      for await (const ev of mock.chat({ ...req, signal: ac.signal })) seen.push(ev)
    })()
    setTimeout(() => ac.abort(), 50)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(seen.length).toBeLessThan(10)
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

  it('OpenAI-compatible: sends the JSON schema as response_format unless jsonSchema is false; reasoning_content is not text', async () => {
    handler = (_u, res) =>
      sse(res, [
        'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"{}"}}]}\n\n',
        'data: [DONE]\n\n'
      ])
    const schema = { type: 'object' }
    const messages = [{ role: 'user' as const, content: 'hi' }]
    const on = new OpenAiCompatClient({ id: 'x', baseUrl: base + '/v1' })
    await collect(on.chat({ model: 'm', messages, schema }))
    expect(lastBody.response_format).toMatchObject({ type: 'json_schema', json_schema: { schema } })
    const off = new OpenAiCompatClient({ id: 'x', baseUrl: base + '/v1', jsonSchema: false })
    const r = await collect(off.chat({ model: 'm', messages, schema }))
    expect(lastBody).not.toHaveProperty('response_format')
    expect(r.text).toBe('{}')
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

  it('OpenAI-compatible: stopping at the token limit without any text is a clear error; reads LM Studio loaded context', async () => {
    handler = (_u, res) =>
      sse(res, [
        'data: {"choices":[{"delta":{"reasoning_content":"thinking..."},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":6560,"completion_tokens":1631}}\n\n',
        'data: [DONE]\n\n'
      ])
    const c = new OpenAiCompatClient({ id: 'x', baseUrl: base + '/v1' })
    await expect(collect(c.chat({ model: 'm', messages: [] }))).rejects.toThrow(/stopped at its token limit without an answer \(6560 tokens in, 1631 out\).*context window/)
    handler = (_u, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"data":[{"id":"a","loaded_context_length":32768},{"id":"b","state":"not-loaded"}]}')
    }
    expect([...(await c.contextLengths()).entries()]).toEqual([['a', 32768]])
  })

  it('LM Studio: a model that is not loaded is loaded first with the settings, once for parallel requests', async () => {
    const loaded = new Set<string>(['already'])
    const calls: string[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const u = String(url)
      calls.push(`${init?.method ?? 'GET'} ${u.replace('http://lm.test', '')}${init?.method === 'POST' && u.endsWith('/load') ? ' ' + String(init.body) : ''}`)
      if (u.endsWith('/api/v1/models')) {
        return new Response(JSON.stringify({ models: ['already', 'cold'].map((key) => ({ key, type: 'llm', loaded_instances: loaded.has(key) ? [{ id: key }] : [] })) }))
      }
      if (u.endsWith('/api/v1/models/load')) {
        await new Promise((r) => setTimeout(r, 20))
        loaded.add(JSON.parse(String(init!.body)).model)
        return new Response(JSON.stringify({ status: 'loaded' }))
      }
      return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    }) as unknown as typeof fetch
    const c = new OpenAiCompatClient({ id: 'lm', baseUrl: 'http://lm.test/v1', fetchImpl, loadConfig: () => ({ parallel: 4, context: 32768, ttlMinutes: 60 }) })
    expect((await collect(c.chat({ model: 'already', messages: [] }))).text).toBe('ok')
    expect(calls.filter((x) => x.startsWith('POST') && x.includes('/load'))).toEqual([])
    calls.length = 0
    const both = await Promise.all([collect(c.chat({ model: 'cold', messages: [] })), collect(c.chat({ model: 'cold', messages: [] }))])
    expect(both.map((b) => b.text)).toEqual(['ok', 'ok'])
    expect(calls.filter((x) => x.includes('/load'))).toEqual(['POST /api/v1/models/load {"model":"cold","context_length":32768,"parallel":4}'])
    await expect(collect(c.chat({ model: 'missing', messages: [] }))).rejects.toMatchObject({ retryable: false, message: expect.stringMatching(/LM Studio has no model "missing": download it first/) })
  })

  it('OpenAI-compatible: nomic prefixes', async () => {
    handler = (_u, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"data":[{"index":0,"embedding":[1]}]}')
    }
    const c = new OpenAiCompatClient({ id: 'x', baseUrl: base, embedPrefixes: { document: 'search_document: ', query: 'search_query: ' } })
    await c.embedWithPrefix('nomic', ['hello'], 'query')
    expect(lastBody.input).toEqual(['search_query: hello'])
  })

  it('Anthropic: reads text deltas and usage including cache reads', async () => {
    handler = (_u, res) =>
      sse(res, [
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":90,"output_tokens":1}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":12}}\n\n'
      ])
    const c = new AnthropicClient({ id: 'a', baseUrl: base, apiKey: 'k' })
    const r = await collect(c.chat({ model: 'claude', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }] }))
    expect(r.text).toBe('Hi there')
    expect(r.usage).toEqual({ inputTokens: 100, cachedInputTokens: 90, outputTokens: 12 })
    expect(lastBody).toMatchObject({ system: 'sys', stream: true, messages: [{ role: 'user', content: 'hi' }] })
    expect(lastHeaders['x-api-key']).toBe('k')
  })

  it('Gemini: reads parts and usage metadata (thinking counts as output)', async () => {
    handler = (u, res) => {
      expect(u).toContain('/v1beta/models/gem:streamGenerateContent?alt=sse')
      sse(res, [
        'data: {"candidates":[{"content":{"parts":[{"text":"One "}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"two"}]}}],"usageMetadata":{"promptTokenCount":50,"candidatesTokenCount":5,"thoughtsTokenCount":20,"cachedContentTokenCount":10}}\n\n'
      ])
    }
    const c = new GeminiClient({ id: 'g', baseUrl: base, apiKey: 'k' })
    const r = await collect(c.chat({ model: 'gem', messages: [{ role: 'user', content: 'hi' }] }))
    expect(r.text).toBe('One two')
    expect(r.usage).toEqual({ inputTokens: 50, cachedInputTokens: 10, outputTokens: 25 })
    expect(lastHeaders['x-goog-api-key']).toBe('k')
  })
})

describe('credential store', () => {
  it('stores, reads and deletes a key (throwaway account)', async () => {
    const account = `SCRIPTORIUM_TEST_${process.pid}_${Date.now()}`
    const service = 'scriptorium-test'
    try {
      expect(getStoredKey(account, service)).toBeUndefined()
      setStoredKey(account, 'secret-value-123', service)
      expect(getStoredKey(account, service)).toBe('secret-value-123')
      expect(deleteStoredKey(account, service)).toBe(true)
      // Windows can show a deleted credential for a moment (its own cache): wait up to two seconds for it to disappear
      for (let i = 0; i < 40 && getStoredKey(account, service) !== undefined; i++) await new Promise((r) => setTimeout(r, 50))
      expect(getStoredKey(account, service)).toBeUndefined()
    } finally {
      deleteStoredKey(account, service)
    }
  })
})

describe('Models dialog', () => {
  it('detectModels lists what a provider has; showModels picks a priced model, hides others, and refuses one without a price', async () => {
    const { Engine } = await import('../src/engine/engine')
    const listed = {
      'https://openrouter.ai/api/v1/models': [
        { id: 'thinkingmachines/inkling:free', context_length: 1048576, pricing: { prompt: '0', completion: '0' } },
        { id: 'openai/gpt-6', context_length: 400000, top_provider: { max_completion_tokens: 128000 }, pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003' } },
        { id: 'google/lyria-3-pro-preview', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['text', 'audio'] } }
      ],
      'https://api.deepseek.com/models': [{ id: 'deepseek-flash' }, { id: 'deepseek-chat' }]
    } as Record<string, unknown[]>
    const fetchImpl = (async (url: string) => {
      const data = listed[String(url)]
      if (!data) throw new Error('not running')
      return new Response(JSON.stringify({ data }))
    }) as unknown as typeof fetch
    const keys = (name: string) => (name === 'OPENROUTER_API_KEY' || name === 'DEEPSEEK_API_KEY' ? 'sk-test' : undefined)
    const events: EngineEvent[] = []
    const engine = new Engine({ dataDir: dir, emit: (e) => events.push(e), log: () => {}, registry: { keys, fetchImpl }, discover: false })
    await engine.registry.load()
    const catalog = (provider: string) => [...events].reverse().find((e) => e.type === 'models.catalog' && e.provider === provider) as Extract<EngineEvent, { type: 'models.catalog' }>
    const snap = () => [...events].reverse().find((e) => e.type === 'snapshot') as Extract<EngineEvent, { type: 'snapshot' }>

    await engine.handleCommand({ type: 'detectModels', provider: 'openrouter' })
    expect(catalog('openrouter').models).toEqual([
      { id: 'thinkingmachines/inkling:free', ref: 'openrouter/thinkingmachines/inkling:free', context: 1048576, priceIn: 0, priceOut: 0, pickable: true },
      { id: 'openai/gpt-6', ref: 'openrouter/openai/gpt-6', context: 400000, priceIn: 3, priceOut: 15, pickable: true }
    ])
    await engine.handleCommand({ type: 'detectModels', provider: 'deepseek' })
    expect(catalog('deepseek').models.map((m) => m.pickable)).toEqual([false, false]) // DeepSeek lists no prices
    await engine.handleCommand({ type: 'detectModels', provider: 'anthropic' })
    expect(catalog('anthropic').error).toMatch(/no key/)

    // tick a paid OpenRouter model and the unpriced DeepSeek one, untick a model from providers.md
    await engine.handleCommand({ type: 'showModels', refs: ['openrouter/openai/gpt-6', 'deepseek/deepseek-chat'], shown: true })
    await engine.handleCommand({ type: 'showModels', refs: ['deepseek/deepseek-v4-pro'], shown: false })
    const gpt = engine.registry.models.get('openrouter/openai/gpt-6')!
    expect(gpt).toMatchObject({ picked: true, family: 'gpt', context: 400000, maxOutput: 128000, priceIn: 3, priceOut: 15 })
    expect(gpt.priceCachedIn).toBeCloseTo(0.3)
    expect(engine.registry.models.has('deepseek/deepseek-chat')).toBe(false)
    const file = parseMd(await readFile(path.join(dir, 'config', 'models.md'), 'utf8'))
    expect(file.data.hidden).toEqual(['deepseek/deepseek-v4-pro'])
    expect((file.data.picked as { id: string }[]).map((m) => m.id)).toEqual(['openai/gpt-6'])
    expect(file.body).toContain('# Models in the pickers')
    const summary = (ref: string) => snap().models.find((m) => m.ref === ref)
    expect(summary('openrouter/openai/gpt-6')).toMatchObject({ shown: true, source: 'picked', priceIn: 3 })
    expect(summary('deepseek/deepseek-v4-pro')).toMatchObject({ shown: false, source: 'config' })
    expect(snap().providers.find((p) => p.id === 'anthropic')).toMatchObject({ available: false, canList: false })

    // a new registry reads the file back; unticking a picked model removes it, ticking a hidden one shows it again
    const again = new ModelRegistry(dir, { keys, fetchImpl })
    await again.load()
    expect(again.models.get('openrouter/openai/gpt-6')?.priceOut).toBe(15)
    expect(again.isShown('deepseek/deepseek-v4-pro')).toBe(false)
    await engine.handleCommand({ type: 'showModels', refs: ['openrouter/openai/gpt-6'], shown: false })
    await engine.handleCommand({ type: 'showModels', refs: ['deepseek/deepseek-v4-pro'], shown: true })
    expect(engine.registry.models.has('openrouter/openai/gpt-6')).toBe(false)
    expect(engine.registry.isShown('deepseek/deepseek-v4-pro')).toBe(true)
    expect(engine.registry.isShown('openrouter/openai/gpt-6')).toBe(true) // removed, not hidden
  })

  it('addModel adds a model by its id: a paid provider needs both prices, a local one none', async () => {
    const { Engine } = await import('../src/engine/engine')
    const keys = (name: string) => (name === 'ANTHROPIC_API_KEY' ? 'sk-test' : undefined)
    const logs: string[] = []
    const engine = new Engine({ dataDir: dir, emit: () => {}, log: (m) => logs.push(m), registry: { keys }, discover: false })
    await engine.registry.load()
    await engine.handleCommand({ type: 'addModel', provider: 'anthropic', id: 'claude-opus-5-5' }) // no price: refused
    expect(engine.registry.models.has('anthropic/claude-opus-5-5')).toBe(false)
    expect(logs.join(' ')).toMatch(/needs its price/)
    await engine.handleCommand({ type: 'addModel', provider: 'anthropic', id: ' claude-opus-5-5 ', priceIn: 5, priceOut: 25, context: 200000 })
    expect(engine.registry.models.get('anthropic/claude-opus-5-5')).toMatchObject({ picked: true, family: 'claude', context: 200000, priceIn: 5, priceOut: 25, priceCachedIn: 5 })
    await engine.handleCommand({ type: 'addModel', provider: 'lmstudio', id: 'qwen3.8-27b-new', priceIn: 9, priceOut: 9 })
    expect(engine.registry.models.get('lmstudio/qwen3.8-27b-new')).toMatchObject({ picked: true, family: 'qwen', priceIn: 0, priceOut: 0 })
    // adding a hidden known model shows it again
    await engine.handleCommand({ type: 'showModels', refs: ['deepseek/deepseek-v4-pro'], shown: false })
    await engine.handleCommand({ type: 'addModel', provider: 'deepseek', id: 'deepseek-v4-pro', priceIn: 1, priceOut: 1 })
    expect(engine.registry.isShown('deepseek/deepseek-v4-pro')).toBe(true)
    expect(engine.registry.models.get('deepseek/deepseek-v4-pro')).toMatchObject({ discovered: false, priceIn: 1.32 }) // providers.md stays, not picked
  })
})

describe('daily request limits', () => {
  it('counts requests per UTC day, is full at rpd, and starts again at midnight UTC', () => {
    let t = Date.UTC(2026, 9, 12, 23, 59, 0)
    const lim = new ProviderLimiter(() => t)
    const p = { id: 'or', rpd: 2, concurrency: 4 } as ProviderInfo
    expect(lim.dayFull(p)).toBe(false)
    lim.noteRequest(p)
    lim.noteRequest(p)
    expect(lim.requestsToday('or')).toBe(2)
    expect(lim.dayFull(p)).toBe(true)
    expect(lim.hasCapacity(p)).toBe(false)
    expect(lim.dayResetsAt()).toBe(Date.UTC(2026, 9, 13))
    t = Date.UTC(2026, 9, 13, 0, 0, 1)
    expect(lim.requestsToday('or')).toBe(0)
    expect(lim.dayFull(p)).toBe(false)
    // the provider says its daily limit is used up, whatever our own count
    const free = { id: 'x', concurrency: 4 } as ProviderInfo
    expect(lim.markDayFull(free)).toBe(true)
    expect(lim.markDayFull(free)).toBe(false)
    expect(lim.dayFull(free)).toBe(true)
    // requests made before a restart count too
    lim.seedToday('or', 5)
    expect(lim.dayFull(p)).toBe(true)
  })

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

  it('the spend files give the requests since midnight UTC, so a daily limit holds across restarts', async () => {
    const now = new Date(Date.UTC(2026, 9, 12, 12))
    const row = (time: Date, provider: string) => ({ time, agent: 'a', book: '', role: 'writer', provider, model: 'm', tokensIn: 1, tokensCached: 0, tokensOut: 1, costUsd: 0, ms: 1 })
    const b = new Budget(dir, {}, () => now)
    await b.load()
    await b.record(row(new Date(Date.UTC(2026, 9, 12, 0, 30)), 'openrouter'))
    await b.record(row(new Date(Date.UTC(2026, 9, 11, 23, 30)), 'openrouter')) // yesterday in UTC
    await b.record(row(new Date(Date.UTC(2026, 9, 12, 1)), 'deepseek'))
    expect(b.requestsTodayUtc('openrouter')).toBe(1)
    const again = new Budget(dir, {}, () => now)
    await again.load()
    expect(again.requestsTodayUtc('openrouter')).toBe(1)
    expect(again.requestsTodayUtc('deepseek')).toBe(1)
  })

  it('setProviderLimits saves the limits of a provider in models.md over providers.md, and the snapshot shows them', async () => {
    const { Engine } = await import('../src/engine/engine')
    const keys = (name: string) => (name === 'OPENROUTER_API_KEY' ? 'sk-test' : undefined)
    const events: EngineEvent[] = []
    const engine = new Engine({ dataDir: dir, emit: (e) => events.push(e), log: () => {}, registry: { keys }, discover: false })
    await engine.registry.load()
    expect(engine.registry.providers.get('openrouter')).toMatchObject({ concurrency: 4, rpm: 20, rpd: 50 }) // providers.md
    await engine.handleCommand({ type: 'setProviderLimits', provider: 'openrouter', concurrency: 2, rpm: 0, rpd: 1000 })
    expect(engine.registry.providers.get('openrouter')).toMatchObject({ concurrency: 2, rpm: undefined, rpd: 1000 })
    // Strata's requests at once come from the server, so only its daily limit is saved
    await engine.handleCommand({ type: 'setProviderLimits', provider: 'strata', concurrency: 9, rpd: 3 })
    const file = parseMd(await readFile(path.join(dir, 'config', 'models.md'), 'utf8'))
    expect(file.data.limits).toEqual({ openrouter: { concurrency: 2, rpm: 0, rpd: 1000 }, strata: { rpd: 3 } })
    expect(file.body).toContain('# Models in the pickers')
    const snap = [...events].reverse().find((e) => e.type === 'snapshot') as Extract<EngineEvent, { type: 'snapshot' }>
    expect(snap.providers.find((p) => p.id === 'openrouter')).toMatchObject({ concurrency: 2, rpd: 1000, requestsToday: 0, dayFull: false })
    expect(snap.providers.find((p) => p.id === 'openrouter')!.rpm).toBeUndefined()
    // a new registry reads them back
    const again = new ModelRegistry(dir, { keys })
    await again.load()
    expect(again.providers.get('openrouter')).toMatchObject({ concurrency: 2, rpd: 1000 })
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

  it('resolves from providers.md as a local, free, available provider with no key, and its model can be a role default', async () => {
    const registry = await clientRegistry()
    expect(registry.providers.get('client')).toMatchObject({ kind: 'client', local: true, available: true, concurrency: 8 })
    const m = registry.getModel('client/claude-code')!
    expect(m).toMatchObject({ vision: true, priceIn: 0, priceOut: 0 })
    expect(isPaidModel(m)).toBe(false)
    expect(registry.providers.get('client')!.client).toBeInstanceOf(ClientProvider)
    expect(new ModelRouter(registry, undefined).candidates('writer')[0]?.ref).toBe('client/claude-code')
  })

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

  it('aborting the request drops the task: the client gets "task not found", and the caller sees an AbortError', async () => {
    const queue = new ClientTaskQueue()
    const provider = new ClientProvider('client', queue)
    const ctl = new AbortController()
    const run = collect(provider.chat({ model: 'claude-code', messages: user('x'), signal: ctl.signal, meta: { job: 'j1' } }))
    const failed = run.then(() => null, (e: Error) => e)
    await vi.waitFor(() => expect(queue.counts().waiting).toBe(1))
    const t = queue.lease()!
    ctl.abort()
    const err = await failed
    expect(err?.name).toBe('AbortError')
    expect(queue.counts()).toEqual({ waiting: 0, leased: 0 })
    expect(queue.submit(t.id, 'late')).toEqual({ accepted: false, problems: ['task not found (it was aborted, answered, or the engine restarted)'] })
    expect(queue.release(t.id)).toBe(false)
    // already aborted: nothing is queued
    await expect(collect(provider.chat({ model: 'claude-code', messages: user('x'), signal: ctl.signal }))).rejects.toMatchObject({ name: 'AbortError' })
    expect(queue.counts().waiting).toBe(0)
    // a new request of the same job gets a new task id, so the old one stays gone
    const again = collect(provider.chat({ model: 'claude-code', messages: user('x'), meta: { job: 'j1' } }))
    await vi.waitFor(() => expect(queue.list().map((x) => x.id)).toEqual(['j1#2']))
    queue.submit('j1#2', 'ok')
    expect((await again).text).toBe('ok')
  })

  it('ids count calls per job, jobs without an id are adhoc, and a lease takes the oldest matching waiting task', () => {
    let now = 1000
    const q = new ClientTaskQueue({ now: () => now })
    const a = q.add({ messages: user('a') }, { job: 'j1', role: 'writer', book: 'b1', task: 'write' })
    now += 10
    const b = q.add({ messages: user('b') }, { job: 'j1', role: 'writer', book: 'b1', task: 'write' })
    now += 10
    const c = q.add({ messages: user('c') }, { role: 'reviewer', book: 'b2', task: 'review' })
    const d = q.add({ messages: user('d') })
    expect([a.task.id, b.task.id]).toEqual(['j1#1', 'j1#2'])
    expect(c.task.id).toBe('adhoc-1#1')
    expect(d.task.id).toBe('adhoc-2#1')
    expect(q.lease({ book: 'b2' })!.id).toBe('adhoc-1#1')
    expect(q.lease({ role: 'writer' })!.id).toBe('j1#1') // the oldest
    expect(q.lease({ role: 'writer' })!.id).toBe('j1#2')
    expect(q.lease({ role: 'writer' })).toBeNull() // both are leased
    expect(q.lease({ task: 'nope' })).toBeNull()
    expect(q.counts()).toEqual({ waiting: 1, leased: 3 })
    expect(q.list().find((x) => x.id === 'j1#1')).toMatchObject({ state: 'leased', ageMs: 20, leaseMsLeft: 30 * 60 * 1000 })
  })

  it('a lease that runs out puts the task back to waiting; release does it at once', () => {
    let now = 0
    const q = new ClientTaskQueue({ now: () => now })
    q.add({ messages: user('a') }, { job: 'j' })
    expect(q.lease({}, 1000)!.id).toBe('j#1')
    expect(q.counts()).toEqual({ waiting: 0, leased: 1 })
    now = 999
    expect(q.lease()).toBeNull()
    now = 1000
    expect(q.counts()).toEqual({ waiting: 1, leased: 0 })
    expect(q.list()[0]).toMatchObject({ state: 'waiting' })
    expect(q.lease({}, 5000)!.id).toBe('j#1')
    expect(q.release('j#1')).toBe(true)
    expect(q.counts()).toEqual({ waiting: 1, leased: 0 })
    expect(q.release('nope#1')).toBe(false)
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

  it('a project model goes first, before the agent and the role list; a client model stays first under model_order; kind client is always local', async () => {
    const { registry } = await registryWith({
      providers: [{ id: 'loc', local: true, models: ['m1', 'm2'] }, { id: 'paid', price: 1, models: ['p1'] }, { id: 'client', kind: 'client', local: false, models: ['claude-code'] }],
      roles: { writer: ['paid/p1', 'loc/m1'] }
    })
    expect(registry.providers.get('client')).toMatchObject({ local: true, available: true })
    const router = new ModelRouter(registry, undefined)
    expect(router.candidates('writer').map((m) => m.ref)).toEqual(['paid/p1', 'loc/m1'])
    expect(router.candidates('writer', { projectModel: 'client/claude-code' }).map((m) => m.ref)).toEqual(['client/claude-code', 'paid/p1', 'loc/m1'])
    expect(router.candidates('writer', { projectModel: 'client/claude-code', agentModel: 'loc/m2' }).map((m) => m.ref)).toEqual(['client/claude-code', 'loc/m2', 'paid/p1', 'loc/m1'])
    expect(router.candidates('writer', { projectModel: 'client/nope' }).map((m) => m.ref)).toEqual(['paid/p1', 'loc/m1'])
    // the client model first even with avoidFamily
    expect(router.candidates('writer', { projectModel: 'client/claude-code', avoidFamily: 'client' })[0]?.ref).toBe('client/claude-code')
    // model_order sorts the groups, but a client ref stays where the role put it (first)
    registry.setDefaults({ fallbacks: ['paid/p1', 'strata/x', 'lmstudio/y'], shared: true, lmLoad: { parallel: 1, context: 8192, ttlMinutes: 1 } })
    registry.roles = { kind: 'roles', roles: { writer: { models: ['paid/p1', 'client/claude-code', 'loc/m1'] } } } as typeof registry.roles
    expect(registry.roleEntries('writer')[0]).toBe('client/claude-code')
  })

  it('leaves out fields with a default: zod lists them as required, with a default', async () => {
    const schema = jsonSchemaOf(z.object({ id: z.string(), negative: z.string().default(''), tags: z.array(z.string()).default([]) }))
    expect(schema.required).toEqual(expect.arrayContaining(['id', 'negative']))
    expect(checkAgainstSchema('{"id": "a"}', schema)).toEqual([])
    expect(checkAgainstSchema('{"negative": "x"}', schema)).toEqual(['id: missing (required)'])
  })

  it('keeps the images of a task in order', () => {
    const q = new ClientTaskQueue()
    const { task } = q.add({ messages: [{ role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', mime: 'image/png', data: 'AAA' }, { type: 'image', mime: 'image/jpeg', data: 'BBB' }] }] }, { job: 'j' })
    expect(task.images).toEqual([{ type: 'image', mime: 'image/png', data: 'AAA' }, { type: 'image', mime: 'image/jpeg', data: 'BBB' }])
  })
})

describe('why a model is not usable (V12)', () => {
  const PROVIDERS = `---
kind: providers
providers:
  - id: nokey
    kind: openai-compat
    base_url: http://127.0.0.1:9/v1
    api_key_env: NOKEY_TEST_KEY
    models:
      - id: m
      - id: emb
        embedding: true
  - id: srv
    kind: openai-compat
    local: true
    base_url: http://127.0.0.1:9/v1
    concurrency: auto
    rpd: 1
    models:
      - id: chat
      - id: seeing
        vision: true
---
test
`
  async function setup() {
    await writeFile(path.join(dir, 'config', 'providers.md'), PROVIDERS)
    const registry = new ModelRegistry(dir, { keys: () => undefined })
    await registry.load()
    return { registry, router: new ModelRouter(registry, undefined) }
  }

  it('says no key, down, embedding, not vision, day limit and unknown', async () => {
    const { registry, router } = await setup()
    expect(router.whyUnusable('nokey/m')).toMatch(/provider nokey is not available \(no key \(set NOKEY_TEST_KEY/)
    expect(router.whyUnusable('nope/m')).toMatch(/unknown model/)
    expect(router.whyUnusable('srv/chat')).toBeNull()
    expect(router.whyUnusable('srv/chat', { visionOnly: true })).toMatch(/not a vision model/)
    expect(router.whyUnusable('srv/seeing', { visionOnly: true })).toBeNull()
    registry.markDown(registry.providers.get('srv')!)
    expect(router.whyUnusable('srv/chat')).toMatch(/server .* is down/)
    registry.providers.get('srv')!.down = false
    router.limiter.noteRequest(registry.providers.get('srv')!)
    expect(router.whyUnusable('srv/chat')).toMatch(/daily limit/)
  })

  it('a provider with a key but an embedding model is refused', async () => {
    await writeFile(path.join(dir, 'config', 'providers.md'), PROVIDERS.replace('NOKEY_TEST_KEY', 'HAS_KEY'))
    const registry = new ModelRegistry(dir, { keys: (n) => (n === 'HAS_KEY' ? 'k' : undefined) })
    await registry.load()
    const router = new ModelRouter(registry, undefined)
    expect(router.whyUnusable('nokey/m')).toBeNull()
    expect(router.whyUnusable('nokey/emb')).toMatch(/embedding/)
  })
})

describe('shared credential stores', () => {
  const store = (entries: Record<string, string>) => (account: string, service?: string) => entries[`${service}:${account}`]
  it('falls back to the scriptorium and book-translator services after edu-studio, and says where the key came from', () => {
    expect(resolveKey('K', store({ 'scriptorium:K': 'from-scriptorium' }), {})).toBe('from-scriptorium')
    expect(lookupKey('K', store({ 'book-translator:K': 'bt' }), {})).toEqual({ value: 'bt', from: 'the book-translator credential store' })
    expect(lookupKey('K', store({ 'scriptorium:K': 's', 'book-translator:K': 'bt' }), {})?.value).toBe('s')
    expect(lookupKey('K', store({ 'edu-studio:K': 'own', 'scriptorium:K': 's' }), {})).toEqual({ value: 'own', from: 'the edu-studio credential store' })
    expect(lookupKey('K', store({ 'edu-studio:K': 'own' }), { K: 'env' })).toEqual({ value: 'env', from: 'the environment' })
    expect(resolveKey('K', store({}), {})).toBeUndefined()
  })

  it('EDU_SHARED_KEYS=0 turns the fallback off', () => {
    const get = store({ 'scriptorium:K': 's', 'edu-studio:OWN': 'mine' })
    expect(resolveKey('K', get, { EDU_SHARED_KEYS: '0' })).toBeUndefined()
    expect(resolveKey('OWN', get, { EDU_SHARED_KEYS: '0' })).toBe('mine')
  })
})

describe('fallbacks as an open list', () => {
  const lm = { parallel: 1, context: 8192, ttlMinutes: 30 }
  // two API providers, LM Studio, Strata (with its -low variant) and the client
  const providers = [
    { id: 'deepseek', price: 1, models: ['flash', 'pro'] },
    { id: 'openrouter', price: 1, models: ['x', 'y'] },
    { id: 'lmstudio', local: true, models: ['gemma'] },
    { id: 'strata', local: true, models: ['q', 'q-low'] },
    { id: 'client', kind: 'client' as const, models: ['claude-code'] }
  ]
  const rows = ['deepseek/flash', 'openrouter/x', 'lmstudio/gemma', 'openrouter/y']

  it('a kind is an alias for its first row and kind-n for the n-th; an alias with no row names nothing', async () => {
    const { registry } = await registryWith({ providers, roles: { director: ['paid', 'strata', 'lmstudio'], editor: ['paid-2', 'paid-3', 'lmstudio-2', 'client'] } })
    registry.setDefaults({ fallbacks: rows, shared: false, lmLoad: lm })
    expect(registry.kindOf('deepseek/flash')).toBe('paid')
    expect(registry.kindOf('lmstudio/gemma')).toBe('lmstudio')
    expect(registry.kindOf('client/claude-code')).toBe('client')
    expect(registry.kindOf('nowhere/x')).toBe('paid') // a provider providers.md lacks counts as API
    expect(registry.resolve('paid')).toBe('deepseek/flash')
    expect(registry.resolve('paid-2')).toBe('openrouter/x')
    expect(registry.resolve('paid-3')).toBe('openrouter/y')
    expect(registry.resolve('lmstudio')).toBe('lmstudio/gemma')
    expect(registry.resolve('strata')).toBe('strata') // no Strata row
    expect(registry.resolve('lmstudio-2')).toBe('lmstudio-2')
    expect(registry.roleModelRefs('director')).toEqual(['deepseek/flash', 'strata', 'lmstudio/gemma'])
    expect(registry.unresolvedAliases().sort()).toEqual(['client', 'lmstudio-2', 'strata'])
    // the router skips what names no model
    expect(new ModelRouter(registry, undefined).candidates('director').map((m) => m.ref)).toEqual(['deepseek/flash', 'lmstudio/gemma'])
    expect(new ModelRouter(registry, undefined).candidates('editor').map((m) => m.ref)).toEqual(['openrouter/x', 'openrouter/y'])
  })

  it('a shared order gives every role the rows top to bottom, its own model of a kind taking that row', async () => {
    const { registry } = await registryWith({
      providers,
      roles: {
        editor: ['strata', 'lmstudio', 'paid'],
        checker: ['strata/q-low', 'lmstudio', 'paid'],
        critic: ['deepseek/flash', 'paid'],
        pro: ['deepseek/pro', 'paid'],
        clienty: ['deepseek/flash', 'client/claude-code']
      }
    })
    registry.setDefaults({ fallbacks: rows, shared: true, lmLoad: lm })
    // editor: its Strata alias has no row, and comes last
    expect(registry.roleModelRefs('editor')).toEqual(['deepseek/flash', 'openrouter/x', 'lmstudio/gemma', 'openrouter/y', 'strata'])
    // a concrete Strata model with no Strata row goes last
    expect(registry.roleModelRefs('checker')).toEqual(['deepseek/flash', 'openrouter/x', 'lmstudio/gemma', 'openrouter/y', 'strata/q-low'])
    // a model that is a row keeps it
    expect(registry.roleModelRefs('critic')).toEqual(['deepseek/flash', 'openrouter/x', 'lmstudio/gemma', 'openrouter/y'])
    // another API model takes the first free API row
    expect(registry.roleModelRefs('pro')).toEqual(['deepseek/pro', 'openrouter/x', 'lmstudio/gemma', 'openrouter/y'])
    // the client goes first
    expect(registry.roleModelRefs('clienty')[0]).toBe('client/claude-code')
    // with a Strata row, -low takes that row's place
    registry.setDefaults({ fallbacks: ['deepseek/flash', 'strata/q', 'lmstudio/gemma'], shared: true, lmLoad: lm })
    expect(registry.roleModelRefs('checker')).toEqual(['deepseek/flash', 'strata/q-low', 'lmstudio/gemma'])
    expect(registry.roleEntries('checker')).toEqual(['deepseek/flash', 'strata/q-low', 'lmstudio/gemma'])
  })

  it('with the old three rows the seed roles keep the chains the group sort gave them', async () => {
    const registry = new ModelRegistry(dir, { keys: () => undefined })
    await registry.load()
    const three = ['deepseek/deepseek-flash', 'strata/qwen3.8-flash-next', 'lmstudio/gemma-4-e4b-it']
    registry.setDefaults({ fallbacks: three, shared: true, lmLoad: lm })
    expect(registry.roleModelRefs('director')).toEqual(three)
  })
})
