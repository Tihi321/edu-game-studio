import { makeEduEnv, waitIdle } from './edu-helpers'
import { waitFor } from './helpers'
import type { TestEnv } from './helpers'
import type { JobContext } from '../src/engine/queue/scheduler'
import type { EduEnv } from './edu-helpers'
import type { SearchProvider } from '../src/engine/research/web'
import type { MockProvider } from '../src/engine/models/mock'
import type { ChatRequest } from '../src/engine/models/types'
import { contentText } from '../src/engine/models/types'

export interface PageSpec {
  url: string
  title: string
  content: string
  /** True: the search result carries the page text. False (default): the page is "downloaded" by the fake `fetchPage`. */
  inline?: boolean
  /** The scripted researcher finds no fact in this page (it is about something else). */
  irrelevant?: boolean
}

export interface ResearchEnvOptions {
  /** The results of every search. */
  pages?: PageSpec[]
  /** The results of a search for this query (wins over `pages`). */
  pagesFor?: (query: string) => PageSpec[]
  /** The search words the model suggests when the first pages answer nothing. */
  searchQueries?: string[]
  /** The facts the model gives from its own knowledge. */
  knowledge?: string[]
  /** Price of one search request (USD). */
  price?: number
}

export interface ResearchEnv extends EduEnv {
  counters: { searches: string[]; fetches: string[]; calls: Record<string, number> }
  provider: SearchProvider
}

const userText = (req: ChatRequest): string => req.messages.filter((m) => m.role === 'user').map((m) => contentText(m.content)).join('\n')

/** The `<<<WEB_PAGE n | url | title>>>` blocks of a prompt. */
export function pagesOf(text: string): { n: number; url: string; title: string; body: string }[] {
  return [...text.matchAll(/<<<WEB_PAGE (\d+) \| (\S+) \| ([^\n]*?)>>>\n([\s\S]*?)\n<<<END_WEB_PAGE \1>>>/g)].map((m) => ({ n: Number(m[1]), url: m[2]!, title: m[3]!, body: m[4]! }))
}

/**
 * An engine with the mock model, one agent per role, a fake search provider (no network) and a scripted researcher: the `research` job's
 * prompts are told apart by their text. The facts the mock writes restate the first words of each page and keep its numbers.
 */
export async function makeResearchEnv(o: ResearchEnvOptions = {}): Promise<ResearchEnv> {
  const counters = { searches: [] as string[], fetches: [] as string[], calls: {} as Record<string, number> }
  const allPages = (query: string): PageSpec[] => o.pagesFor?.(query) ?? o.pages ?? []
  const byUrl = new Map<string, PageSpec>()
  const provider: SearchProvider = {
    id: 'fake',
    pricePerRequest: o.price ?? 0.01,
    search: async (query) => {
      counters.searches.push(query)
      const pages = allPages(query)
      for (const p of pages) byUrl.set(p.url, p)
      return pages.map((p) => ({ title: p.title, url: p.url, snippet: p.content.slice(0, 200), ...(p.inline ? { content: p.content } : {}) }))
    }
  }
  const fetchPage = async (url: string): Promise<string> => {
    counters.fetches.push(url)
    return byUrl.get(url)?.content ?? ''
  }
  const env = await makeEduEnv({ engine: { searchProviders: [provider], search: { fetchPage } } })
  const mock: MockProvider = env.mock
  const count = (k: string) => (counters.calls[k] = (counters.calls[k] ?? 0) + 1)
  mock.on({ task: 'research' }, (req) => {
    const text = userText(req)
    if (text.includes('A question was sent to the research notes')) {
      count('check')
      return JSON.stringify({ covered: false, missing: 'the notes are about something else' })
    }
    if (text.includes('Suggest up to two new searches')) {
      count('queries')
      return JSON.stringify({ queries: o.searchQueries ?? [] })
    }
    if (text.includes('no web source could be used')) {
      count('knowledge')
      return JSON.stringify({ facts: (o.knowledge ?? ['The mock researcher is fairly sure of this one fact.', 'The mock researcher is also fairly sure of a second fact.']).map((fact) => ({ fact })) })
    }
    if (text.includes('The pages also give these figures')) {
      count('followup')
      return JSON.stringify({ facts: [] })
    }
    if (text.includes('Answer a research question')) {
      count('notes')
      const pages = pagesOf(text)
      return JSON.stringify({
        facts: pages.filter((p) => !byUrl.get(p.url)?.irrelevant).map((p) => {
          const first = p.body.split(/(?<=[.!?])\s+/)[0] ?? p.body
          const figures = (p.body.match(/\b\d[\d,.]*\b/g) ?? []).filter((x, i, a) => a.indexOf(x) === i).join(' and ')
          return { fact: `According to ${p.title}: ${first.split(/\s+/).slice(0, 8).join(' ')} (figures ${figures || 'none'})`, source: p.n }
        })
      })
    }
    count('other')
    return '{}'
  })
  return Object.assign(env, { counters, provider })
}

export { waitIdle }

let jobSeq = 0

/**
 * Runs `fn` inside a real job of `role` (an agent of the role takes it): the function gets the job's context, so it can call the model through
 * `ctx.chat` as a handler does. Resolves with what `fn` returns; rejects with the job's failure text.
 */
export async function runInJob<T>(env: Pick<TestEnv, 'engine'>, role: string, fn: (ctx: JobContext) => Promise<T>, job: { book?: string; avoid_family?: string } = {}): Promise<T> {
  const n = ++jobSeq
  const task = `test.run${n}`
  let out: { ok: true; value: T } | { ok: false; error: unknown } | undefined
  env.engine.scheduler.register(task, async (ctx) => {
    try {
      out = { ok: true, value: await fn(ctx) }
    } catch (error) {
      out = { ok: false, error }
    }
    return { result: 'done' }
  })
  await env.engine.jobs.enqueue({ id: `${job.book ?? 'test'}--${task}--all--r0`, task, role, book: job.book ?? null, ...(job.avoid_family ? { avoid_family: job.avoid_family } : {}) })
  env.engine.scheduler.kick()
  await waitFor(() => out, 20_000, `the ${task} job`)
  if (!out!.ok) throw out!.error
  return out!.value
}
