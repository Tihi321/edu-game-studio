import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadStudiosConfig } from '../src/engine/studios/config'
import { createScriptoriumClient, DEFAULT_SCRIPTORIUM_URL, ScriptoriumError } from '../src/engine/studios/scriptorium'
import { makeEduEnv } from './edu-helpers'
import { seedDir } from './helpers'
import { fakeMcpServer } from './studio-fakes'

describe('the Scriptorium client (a fake MCP server; the real Scriptorium is never called)', () => {
  const tools = (log: { name: string; args: Record<string, unknown> }[], waits: unknown[]) => ({
    add_story: (args: Record<string, unknown>) => (log.push({ name: 'add_story', args }), { structured: { slug: 'the-scribe', file: 'ideas/the-scribe.md', story: { slug: 'the-scribe' } } }),
    wait_for_book: (args: Record<string, unknown>) => (log.push({ name: 'wait_for_book', args }), { structured: waits.shift() ?? { done: false, reason: 'timeout' } })
  })

  it('status is up when the story tools are there; handOffStory calls add_story with the idea, audience and length and returns the story slug', async () => {
    const log: { name: string; args: Record<string, unknown> }[] = []
    const server = await fakeMcpServer({ tools: tools(log, []) })
    try {
      const client = createScriptoriumClient({ url: server.url, token: 'sct-test' })
      expect(await client.status()).toEqual({ up: true })
      const r = await client.handOffStory({ idea: 'A young scribe carries a message across the Roman empire.', audience: 'teenagers who like adventures', length: 'a short story of about 2000 words', title: 'The Scribe of Rome' })
      expect(r).toEqual({ story: 'the-scribe' })
      const call = log.find((c) => c.name === 'add_story')!
      expect(call.args).toMatchObject({ title: 'The Scribe of Rome', premise: 'A young scribe carries a message across the Roman empire.' })
      expect(String(call.args.style)).toContain('teenagers who like adventures')
      expect(String(call.args.style)).toContain('a short story of about 2000 words')
      // the bearer token goes with every request
      expect(server.seen.every((s) => s.headers.authorization === 'Bearer sct-test')).toBe(true)
      // a call without a title leaves it out
      await client.handOffStory({ idea: 'x', audience: 'y', length: 'z' })
      expect('title' in log[log.length - 1]!.args).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('waitForStory is one wait_for_book call: not done yet, then the book is published', async () => {
    const log: { name: string; args: Record<string, unknown> }[] = []
    const waits = [
      { done: false, reason: 'timeout', story: 'the-scribe', book: null, title: null, stage: null, folder: null },
      { done: true, reason: 'published', story: 'the-scribe', book: 'the-scribe-1', title: 'The Scribe of Rome', stage: 'published', folder: 'x' }
    ]
    const server = await fakeMcpServer({ tools: tools(log, waits) })
    try {
      const client = createScriptoriumClient({ url: server.url })
      expect(await client.waitForStory('the-scribe', { timeoutSeconds: 5 })).toEqual({ done: false, reason: 'timeout', story: 'the-scribe', book: null, title: null, stage: null, folder: null })
      expect(log[0]!.args).toEqual({ slug: 'the-scribe', timeout_seconds: 5, stop_on_client_task: false })
      expect(await client.waitForStory('the-scribe')).toMatchObject({ done: true, reason: 'published', book: 'the-scribe-1', stage: 'published' })
      expect(log[1]!.args.timeout_seconds).toBe(60)
    } finally {
      await server.close()
    }
  })

  it('a Scriptorium that is down is an error with the start hint, and nothing starts it', async () => {
    const client = createScriptoriumClient({ url: 'http://127.0.0.1:9/mcp', timeoutMs: 2000 })
    const st = await client.status()
    expect(st.up).toBe(false)
    expect(st.error).toMatch(/Scriptorium is not running at http:\/\/127\.0\.0\.1:9\/mcp/)
    expect(st.error).toMatch(/Edu Studio never starts it/)
    await expect(client.handOffStory({ idea: 'x', audience: 'y', length: 'z' })).rejects.toMatchObject({ name: 'ScriptoriumError', kind: 'down' })
    await expect(client.waitForStory('x')).rejects.toBeInstanceOf(ScriptoriumError)
  })

  it('a server without the story tools, a refused call and an answer without a slug are reported', async () => {
    const empty = await fakeMcpServer({ tools: { list_books: () => ({ structured: [] }) } })
    try {
      expect(await createScriptoriumClient({ url: empty.url }).status()).toEqual({ up: false, error: expect.stringMatching(/has no add_story and wait_for_book tool/) })
    } finally {
      await empty.close()
    }
    const refusing = await fakeMcpServer({ tools: { add_story: () => ({ isError: true, text: 'Needs at least a title or some text' }), wait_for_book: () => ({ structured: {} }) } })
    try {
      const client = createScriptoriumClient({ url: refusing.url })
      await expect(client.handOffStory({ idea: 'x', audience: 'y', length: 'z' })).rejects.toMatchObject({ kind: 'tool', message: expect.stringContaining('Needs at least a title') })
    } finally {
      await refusing.close()
    }
    const noSlug = await fakeMcpServer({ tools: { add_story: () => ({ structured: { ok: true } }), wait_for_book: () => ({ structured: {} }) } })
    try {
      await expect(createScriptoriumClient({ url: noSlug.url }).handOffStory({ idea: 'x', audience: 'y', length: 'z' })).rejects.toMatchObject({ kind: 'protocol', message: expect.stringContaining('no story slug') })
    } finally {
      await noSlug.close()
    }
  })
})

describe('config and the service', () => {
  it('config/studios.md has the URL (the default port 7341) and says Edu Studio never starts Scriptorium; EDU_SCRIPTORIUM_URL overrides it', async () => {
    const text = fs.readFileSync(path.join(seedDir, 'config', 'studios.md'), 'utf8')
    expect(text).toMatch(/scriptoriumUrl: http:\/\/127\.0\.0\.1:7341\/mcp/)
    expect(text).toMatch(/NEVER starts it|never starts Scriptorium/)
    expect(DEFAULT_SCRIPTORIUM_URL).toBe('http://127.0.0.1:7341/mcp')
    const env = await makeEduEnv()
    try {
      expect((await loadStudiosConfig(env.dir, {})).scriptoriumUrl).toBe('http://127.0.0.1:7341/mcp')
      expect((await loadStudiosConfig(env.dir, { EDU_SCRIPTORIUM_URL: 'http://127.0.0.1:1/mcp' })).scriptoriumUrl).toBe('http://127.0.0.1:1/mcp')
      expect((await env.engine.edu.scriptorium()).url).toBe(DEFAULT_SCRIPTORIUM_URL) // made from the config
    } finally {
      await env.cleanup()
    }
  })

  it('the engine takes a fake client (tests) and the service hands it out', async () => {
    const fake = { url: 'http://fake/scriptorium', status: async () => ({ up: true as const }), handOffStory: async () => ({ story: 's' }), waitForStory: async () => ({ done: true, reason: 'published', story: 's', book: 'b', title: 't', stage: 'published', folder: null }) }
    const env = await makeEduEnv({ engine: { scriptorium: fake } })
    try {
      expect(await env.engine.edu.scriptorium()).toBe(fake)
    } finally {
      await env.cleanup()
    }
  })
})
