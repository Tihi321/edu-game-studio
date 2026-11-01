import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ClientTaskQueue } from '../src/engine/models/client'
import { ModelRegistry } from '../src/engine/models/registry'
import { contentText } from '../src/engine/models/types'
import { ClientSearchProvider } from '../src/engine/research/clientSearch'
import { parseNoteFacts, researchJobId } from '../src/engine/research/notes'
import { SearchService } from '../src/engine/research/service'
import { readMd, writeMd } from '../src/engine/store/atomic'
import { buildTools, callTool } from '../src/engine/mcp/tools'
import { makeEduEnv } from './edu-helpers'
import { waitFor } from './helpers'
import { pagesOf } from './research-helpers'

const answer = (n: number) =>
  JSON.stringify({ results: Array.from({ length: n }, (_, i) => ({ title: `Page ${i}`, url: `https://example.org/p${i}`, content: `Excerpt ${i}: the forum held 1,200 people in 120 AD.`, published: '2026-10-14' })) })

describe('client web search: a task for the MCP client', () => {
  it('a query is a searcher task; the client answers it and the results come back as notes material', async () => {
    const queue = new ClientTaskQueue()
    const provider = new ClientSearchProvider({ queue, waitMs: 60_000 })
    const pending = provider.search('Roman Forum visitors', { limit: 2, news: true, days: 3, book: 'rome', agent: 'noor', job: 'rome--research--qabc12345--r0' })
    const listed = await waitFor(() => (queue.list().length ? queue.list() : null))
    // filed under the research job, so the queue sees that job as waiting for a client
    expect(listed[0]).toMatchObject({ job: 'rome--research--qabc12345--r0', role: 'searcher', task: 'web_search', book: 'rome', agent: 'noor', unit: 'Roman Forum visitors', state: 'waiting' })
    const t = queue.lease({ role: 'searcher' })!
    expect(t.schema).toBeTruthy()
    const text = t.messages.map((m) => contentText(m.content)).join('\n')
    expect(text).toMatch(/Roman Forum visitors/)
    expect(text).toMatch(/search the web yourself/i)
    expect(text).toMatch(/up to 2 results/)
    expect(text).toMatch(/last 3 days/)
    expect(text).toMatch(/1500 characters/)
    expect(queue.state(t.id)).toBe('leased')
    expect(queue.submit(t.id, answer(3)).accepted).toBe(true)
    const results = await pending
    expect(results).toHaveLength(2) // the limit
    expect(results[0]).toMatchObject({ url: 'https://example.org/p0', content: expect.stringContaining('1,200 people') })
    expect(results[0]!.title).toContain('2026-10-14')
    expect(queue.state(t.id)).toBe('gone')
  })

  it('a task nobody takes ends in a timeout, the next provider is used, and the task is gone', async () => {
    const queue = new ClientTaskQueue()
    const logs: string[] = []
    const client = new ClientSearchProvider({ id: 'client-search', queue, waitMs: 80 })
    const calls: string[] = []
    const next = { id: 'wikipedia', pricePerRequest: 0, search: async () => (calls.push('next'), [{ title: 'W', url: 'https://w.org/x', snippet: 's', content: 'c' }]) }
    const svc = new SearchService({ registry: undefined as unknown as ModelRegistry, providers: [client, next], log: (m) => logs.push(m) })
    const out = await svc.search('anything', { book: 'rome' })
    expect(out?.provider).toBe('wikipedia')
    expect(calls).toEqual(['next'])
    expect(logs.join('\n')).toMatch(/client-search failed: no client took the web search task/)
    expect(queue.list()).toEqual([])
  })
})

describe('a research job whose web search is done by the MCP client', () => {
  it('posts a searcher task under the research job, edu_wait returns for it, and the submitted results become the note\'s facts', async () => {
    const env = await makeEduEnv()
    try {
      // the engine's own search providers: only the client search (no key, no network)
      const file = path.join(env.dir, 'config', 'providers.md')
      const doc = await readMd(file)
      await writeMd(file, { ...doc.data, providers: [...(doc.data.providers as unknown[]), { id: 'client-search', kind: 'search', engine: 'client', enabled: true, wait_minutes: 10 }], search_order: ['client-search'] }, doc.body)
      await env.engine.registry.load()
      expect(env.engine.search.providers().map((p) => p.id)).toEqual(['client-search'])
      env.mock.on({ task: 'research' }, (req) => {
        const text = req.messages.map((m) => contentText(m.content)).join('\n')
        if (!text.includes('Answer a research question')) return '{}'
        return JSON.stringify({ facts: pagesOf(text).map((p) => ({ fact: `According to ${p.title}, the forum had room for a very large crowd (${p.body.match(/\d[\d,]*/g)?.join(' and ')}).`, source: p.n })) })
      })
      await env.engine.edu.courses.create({ slug: 'rome', title: 'Rome', languages: ['en'], sourceLang: 'en', subject: 'Rome', audience: 'Teens' })
      const tools = buildTools(env.engine.edu, { clientQueue: env.engine.clientQueue })
      const question = 'How many people did the Roman Forum hold?'
      const asked = await callTool(tools, 'edu_ask_researcher', { slug: 'rome', question })
      expect(asked.structuredContent).toMatchObject({ status: 'created' })
      const jobId = researchJobId('rome', question)
      // the course is not idle: the research job waits for the client's web search, and edu_wait says so (clientTasks)
      const w = await env.engine.edu.waitIdle('rome', { timeoutMs: 10_000 })
      expect(w.timedOut).toBe(false)
      expect(w.clientTasks).toBe(1)
      const got = (await callTool(tools, 'edu_get_task', { role: 'searcher' })).structuredContent as { taskId: string; meta: Record<string, string>; user: string; output: string; schema: unknown }
      expect(got.meta).toMatchObject({ job: jobId, role: 'searcher', task: 'web_search', book: 'rome', unit: question })
      expect(got.user).toContain(question)
      expect(got.output).toContain('This is a web search') // the client is told to search the web itself and answer {results: [...]}
      expect(got.schema).toBeTruthy()
      const submit = await callTool(tools, 'edu_submit_task', {
        taskId: got.taskId,
        text: JSON.stringify({ results: [{ title: 'Roman Forum', url: 'https://example.org/forum', content: 'The Roman Forum was the centre of public life. It could hold about 20,000 people on a festival day. It stood in a valley between hills. '.repeat(3) }] })
      })
      expect(submit.structuredContent).toEqual({ accepted: true })
      const done = await env.engine.edu.waitIdle('rome', { timeoutMs: 10_000 })
      expect(done).toMatchObject({ timedOut: false, clientTasks: 0, failed: [] })
      const note = (await env.engine.edu.research.store.list('rome'))[0]!
      expect(note).toMatchObject({ unverified: false, sources: [{ url: 'https://example.org/forum', title: 'Roman Forum' }] })
      expect(parseNoteFacts(note)[0]).toMatchObject({ url: 'https://example.org/forum' })
      expect(parseNoteFacts(note)[0]!.fact).toContain('20,000')
      // the answer carried the page text (300 characters or more), so nothing was downloaded: no test reaches the network
      // a client search costs nothing
      await env.engine.budget.flush()
      expect(env.engine.budget.spentBook('rome')).toBe(0)
    } finally {
      await env.cleanup()
    }
  })
})
