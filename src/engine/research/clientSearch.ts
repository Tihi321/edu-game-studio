import { ClientTaskQueue } from '../models/client'
import { extractJson } from '../pipeline/llm'
import type { SearchOptions, SearchProvider, SearchResult } from './web'

/** How long a web search task may wait for a client to take it before the search gives up (providers.md: `wait_minutes`). */
export const DEFAULT_SEARCH_WAIT_MS = 10 * 60 * 1000

/** The answer a client gives to a `web_search` task. */
export const CLIENT_SEARCH_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'url', 'content'],
        properties: {
          title: { type: 'string', minLength: 1 },
          url: { type: 'string', pattern: '^https?://[^ ]+$' },
          content: { type: 'string', minLength: 1 },
          published: { type: ['string', 'null'] }
        }
      }
    }
  }
}

const MAX_EXCERPT = 1500

export interface ClientSearchOptions {
  id?: string
  queue: ClientTaskQueue
  /** Give up when no client has taken the task for this long. Default 10 minutes. */
  waitMs?: number
}

let seq = 0

/** The messages of a web search task: what the client is asked to do. */
export function searchTaskMessages(query: string, opts: { limit: number; news?: boolean; days?: number }): { role: 'system' | 'user'; content: string }[] {
  return [
    {
      role: 'system',
      content:
        'You are the web searcher of a course studio. Search the web yourself, with your own web search and fetch tools, for the query you are given. ' +
        'Prefer primary and official sources (government, institutions, the original report, the company or person concerned) and recent ones. ' +
        'Read the pages. For each result give the title, the URL you actually opened, the date it was published if the page shows one, and `content`: ' +
        `a verbatim excerpt from the page that is relevant to the query (at most ${MAX_EXCERPT} characters; quote it, do not paraphrase or summarise, and keep numbers and names exactly). ` +
        'Return only URLs you really read. Do not invent a source. If you find nothing, return an empty list. ' +
        'Reply with one JSON object and nothing else: {"results":[{"title":"...","url":"https://...","content":"...","published":"2026-10-14"}]}. `published` may be left out.'
    },
    {
      role: 'user',
      content:
        `Query: ${query}\n` +
        `Return up to ${opts.limit} results.` +
        (opts.news ? `\nThis is a news search: use only sources published within the last ${opts.days ?? 7} days, newest first.` : '')
    }
  ]
}

/** Turns a client's answer into search results: at most `limit`, a real http(s) URL each, an excerpt of at most 1500 characters. */
export function parseSearchAnswer(text: string, limit: number): SearchResult[] {
  const value = extractJson(text) as { results?: { title?: unknown; url?: unknown; content?: unknown; published?: unknown }[] }
  const out: SearchResult[] = []
  const seen = new Set<string>()
  for (const r of value.results ?? []) {
    const url = typeof r.url === 'string' ? r.url.trim() : ''
    const content = typeof r.content === 'string' ? r.content.trim() : ''
    if (!/^https?:\/\/\S+$/.test(url) || !content || seen.has(url)) continue
    seen.add(url)
    const published = typeof r.published === 'string' && r.published.trim() ? ` (${r.published.trim()})` : ''
    out.push({
      title: `${typeof r.title === 'string' && r.title.trim() ? r.title.trim() : url}${published}`,
      url,
      snippet: content.slice(0, 240),
      content: content.slice(0, MAX_EXCERPT)
    })
    if (out.length >= limit) break
  }
  return out
}

/**
 * Web search done by an MCP client (Claude Code): each query becomes a `searcher` / `web_search` task in the engine's client queue.
 * It costs nothing. A task nobody takes within `waitMs` is dropped and the search finds nothing, so the next provider is tried and a
 * course never stalls without a session. Once a client has taken the task its answer is waited for (a lease that runs out starts the wait again).
 */
export class ClientSearchProvider implements SearchProvider {
  readonly id: string
  readonly pricePerRequest = 0
  private readonly waitMs: number

  constructor(private readonly o: ClientSearchOptions) {
    this.id = o.id ?? 'client'
    this.waitMs = o.waitMs ?? DEFAULT_SEARCH_WAIT_MS
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = Math.max(1, opts.limit ?? 5)
    const { queue } = this.o
    if (opts.signal?.aborted) throw abortError()
    const { task, done } = queue.add(
      { messages: searchTaskMessages(query, { limit, news: opts.news, days: opts.days }), schema: CLIENT_SEARCH_SCHEMA, maxTokens: 6000 },
      { job: opts.job ?? `search-${Date.now().toString(36)}-${++seq}`, role: 'searcher', task: 'web_search', book: opts.book ?? '', agent: opts.agent ?? '', unit: query.slice(0, 120) }
    )
    let timedOut = false
    let idleSince = Date.now()
    const tick = Math.min(5000, Math.max(10, Math.floor(this.waitMs / 10)))
    const timer = setInterval(() => {
      if (queue.state(task.id) === 'leased') idleSince = Date.now()
      else if (Date.now() - idleSince >= this.waitMs) {
        timedOut = true
        queue.cancel(task.id)
      }
    }, tick)
    const onAbort = () => void queue.cancel(task.id)
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      return parseSearchAnswer(await done, limit)
    } catch (err) {
      if (timedOut) throw new ClientSearchTimeout(`no client took the web search task within ${Math.round(this.waitMs / 1000)} s`)
      throw err
    } finally {
      clearInterval(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }
}

/** Thrown when nobody took the task in time. The service logs it and goes on with the next provider. */
export class ClientSearchTimeout extends Error {}

function abortError(): Error {
  const e = new Error('The operation was aborted')
  e.name = 'AbortError'
  return e
}
