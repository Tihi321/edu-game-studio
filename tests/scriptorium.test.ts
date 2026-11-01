import { describe, expect, it } from 'vitest'
import { createScriptoriumClient, ScriptoriumError } from '../src/engine/studios/scriptorium'
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

  it('a Scriptorium that is down is an error with the start hint, and nothing starts it', async () => {
    const client = createScriptoriumClient({ url: 'http://127.0.0.1:9/mcp', timeoutMs: 2000 })
    const st = await client.status()
    expect(st.up).toBe(false)
    expect(st.error).toMatch(/Scriptorium is not running at http:\/\/127\.0\.0\.1:9\/mcp/)
    expect(st.error).toMatch(/Edu Studio never starts it/)
    await expect(client.handOffStory({ idea: 'x', audience: 'y', length: 'z' })).rejects.toMatchObject({ name: 'ScriptoriumError', kind: 'down' })
    await expect(client.waitForStory('x')).rejects.toBeInstanceOf(ScriptoriumError)
  })
})
