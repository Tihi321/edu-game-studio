import type { EngineEvent } from '../../shared/protocol'
import type { FactoryConfig } from '../../shared/schemas'
import type { AgentStore } from '../agents/agents'
import type { Budget } from '../budget/spend'
import { resolveKey } from '../models/keys'
import type { KeyResolver } from '../models/keys'
import type { ClientTaskQueue } from '../models/client'
import type { ModelRegistry } from '../models/registry'
import type { JobStore } from '../queue/jobs'
import { questionKey, researchJobId, ResearchStore } from './notes'
import { fetchPageText, makeSearchProvider } from './web'
import type { SearchProvider, SearchResult } from './web'

// ---- searching ----

export interface SearchServiceOptions {
  registry: ModelRegistry
  budget?: Budget
  emit?: (e: EngineEvent) => void
  log?: (message: string) => void
  fetchImpl?: typeof fetch
  /** Looks up API keys. Default: environment variable, then the credential store. */
  keys?: KeyResolver
  /** The engine's client task queue: the `client` search engine puts its web search tasks there. */
  clientQueue?: ClientTaskQueue
  /** Tests: use these providers instead of the ones in config/providers.md. */
  providers?: SearchProvider[]
  /** Tests: replaces the page download. */
  fetchPage?: (url: string, signal?: AbortSignal) => Promise<string>
}

export interface SearchOutcome {
  provider: string
  results: SearchResult[]
}

/** The search providers of config/providers.md in the order of `search_order`, with spend logging and fallback. */
export class SearchService {
  constructor(private readonly o: SearchServiceOptions) {}

  /** The providers that can be used right now: enabled, with their key, known engine. */
  providers(): SearchProvider[] {
    if (this.o.providers) return this.o.providers
    const { registry } = this.o
    const infos = [...registry.providers.values()].filter((p) => p.kind === 'search' && p.available)
    const order = registry.searchOrder
    infos.sort((a, b) => {
      const ia = order.indexOf(a.id)
      const ib = order.indexOf(b.id)
      return (ia === -1 ? 1e6 : ia) - (ib === -1 ? 1e6 : ib)
    })
    const out: SearchProvider[] = []
    for (const p of infos) {
      const provider = makeSearchProvider(
        {
          id: p.id,
          engine: p.searchEngine ?? p.id,
          baseUrl: p.baseUrl,
          apiKey: p.apiKeyEnv ? (this.o.keys ?? resolveKey)(p.apiKeyEnv) : undefined,
          pricePerRequest: p.pricePerRequest,
          clientQueue: this.o.clientQueue,
          clientWaitMs: p.waitMinutes === undefined ? undefined : p.waitMinutes * 60_000
        },
        this.o.fetchImpl
      )
      if (provider) out.push(provider)
      else this.o.log?.(`search provider ${p.id}: unknown engine "${p.searchEngine}" or no key`)
    }
    return out
  }

  /**
   * Searches with the first provider that gives results. A provider that fails, or has no results, falls through to the next.
   * A paid provider is skipped while a budget cap is reached. Every request that was answered is written to the spend rows.
   */
  async search(query: string, ctx: { signal?: AbortSignal; book?: string | null; agent?: string; job?: string; limit?: number; news?: boolean; days?: number } = {}): Promise<SearchOutcome | null> {
    for (const p of this.providers()) {
      if (ctx.signal?.aborted) throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
      if (p.pricePerRequest > 0 && this.o.budget && !this.o.budget.isExhausted(ctx.book).ok) {
        this.o.log?.(`search provider ${p.id} skipped: a budget cap is reached`)
        continue
      }
      const started = Date.now()
      try {
        const results = await p.search(query, { signal: ctx.signal, limit: ctx.limit ?? 5, book: ctx.book ?? undefined, agent: ctx.agent, job: ctx.job, ...(ctx.news ? { news: true, days: ctx.days } : {}) })
        await this.recordSpend(p, ctx, Date.now() - started)
        if (results.length > 0) return { provider: p.id, results }
        this.o.log?.(`search provider ${p.id}: no results for "${query}"`)
      } catch (err) {
        if (ctx.signal?.aborted || (err as Error).name === 'AbortError') throw err
        this.o.log?.(`search provider ${p.id} failed: ${(err as Error).message}`)
      }
    }
    return null
  }

  private async recordSpend(p: SearchProvider, ctx: { book?: string | null; agent?: string }, ms: number): Promise<void> {
    if (!this.o.budget) return
    await this.o.budget.record({
      time: new Date(),
      agent: ctx.agent ?? '',
      book: ctx.book ?? '',
      role: 'researcher',
      provider: p.id,
      model: 'search',
      tokensIn: 0,
      tokensCached: 0,
      tokensOut: 0,
      costUsd: p.pricePerRequest,
      ms
    })
    this.o.emit?.({ type: 'spend', provider: p.id, model: 'search', tokensIn: 0, tokensOut: 0, costUsd: p.pricePerRequest, agent: ctx.agent, book: ctx.book ?? undefined })
  }

  /** The text of a page: stripped of scripts and HTML, capped. */
  fetchPage(url: string, signal?: AbortSignal, maxChars = 6000): Promise<string> {
    if (this.o.fetchPage) return this.o.fetchPage(url, signal)
    return fetchPageText(url, { fetchImpl: this.o.fetchImpl, signal, maxChars })
  }
}

// ---- asking ----

export interface AskInput {
  /** The course the answer is for. Its notes go in the course's `research/` folder. */
  slug: string
  question: string
  /** An agent id, or `you`. Shown as the origin of the handover line in the office. */
  askedBy: string
  /** Why it is asked, for the researcher's terminal ("the curriculum of unit 2"). */
  purpose?: string
  /** A question about what happened in the last days or weeks: the search asks for news (the last 7 days). */
  news?: boolean
  /** 1 for a question someone asked on purpose (a tool, the app): it goes before the pipeline's own jobs. Default 0. */
  priority?: number
}

export type AskStatus = 'created' | 'exists' | 'limit' | 'empty' | 'no-researcher'

export interface AskResult {
  status: AskStatus
  /** The research job id (also for `exists`: it was asked before). */
  id: string | null
}

export interface ResearchServiceDeps {
  dataDir: string
  jobs: JobStore
  agents: Pick<AgentStore, 'list'>
  getFactory: () => FactoryConfig
  log: (message: string) => void
  kick: () => void
  emit?: (e: EngineEvent) => void
}

const STATES = ['queued', 'running', 'done', 'failed'] as const

/** Creates research jobs: one place for the per-course limit, the idempotent job ids and the "is there a researcher" check. */
export class ResearchService {
  readonly store: ResearchStore
  private warned = new Set<string>()

  constructor(private readonly d: ResearchServiceDeps) {
    this.store = new ResearchStore(d.dataDir)
  }

  hasResearcher(): boolean {
    return this.d.agents.list().some((a) => a.data.role === 'researcher')
  }

  /** How many research questions this course has asked so far (jobs in any state). */
  async asked(slug: string): Promise<number> {
    const prefix = `${slug}--research--`
    let n = 0
    for (const state of STATES) n += (await this.d.jobs.ids(state)).filter((id) => id.startsWith(prefix)).length
    return n
  }

  /**
   * Asks the researcher. The job id comes from the course and the question, so the same question is never asked twice for one course,
   * and a repeat does not count against the course's limit. At the limit the question is dropped (the course goes on without the notes).
   */
  async ask(i: AskInput): Promise<AskResult> {
    const question = i.question.replace(/\s+/g, ' ').trim()
    if (questionKey(question).length < 3) return { status: 'empty', id: null }
    const id = researchJobId(i.slug, question)
    if (!this.hasResearcher()) {
      this.warnOnce('no-researcher', 'a research question was asked, but there is no researcher in agents/. Hire one in the app, or the question is skipped.')
      return { status: 'no-researcher', id: null }
    }
    for (const state of STATES) {
      if (await this.d.jobs.read(state, id)) return { status: 'exists', id }
    }
    const limit = this.d.getFactory().research_limit_per_course
    if ((await this.asked(i.slug)) >= limit) {
      this.warnOnce(`limit-${i.slug}`, `course ${i.slug} reached its research limit (${limit} questions, research_limit_per_course in config/factory.md). Further questions are skipped.`)
      return { status: 'limit', id: null }
    }
    const created = await this.d.jobs.enqueue(
      {
        id,
        task: 'research',
        role: 'researcher',
        book: i.slug,
        requested_by: i.askedBy,
        label: question.length > 100 ? question.slice(0, 97) + '...' : question,
        question,
        purpose: i.purpose ?? '',
        ...(i.priority ? { priority: i.priority } : {}),
        ...(i.news !== undefined ? { news: i.news } : {})
      } as Parameters<JobStore['enqueue']>[0],
      `Question: ${question}\n\nAsked by: ${i.askedBy}${i.purpose ? `\nWhy: ${i.purpose}` : ''}\nFor: the course ${i.slug}\n`
    )
    this.d.kick()
    return { status: created ? 'created' : 'exists', id }
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.d.log(`warning: ${message}`)
    this.d.emit?.({ type: 'engine.warning', message })
  }
}
