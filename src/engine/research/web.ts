import type { ClientTaskQueue } from '../models/client'
import { ClientSearchProvider } from './clientSearch'

/**
 * Getting text from the web for the researcher: search providers (Tavily, Wikipedia, stubs for the rest)
 * and page fetching with HTML stripping. Everything that comes back is untrusted data.
 */

/** Sent with every request. Wikimedia asks for a descriptive User-Agent. */
export const USER_AGENT = 'EduStudio/0.1 (educational game studio; light on-demand research for course facts; no scraping)'

export interface SearchResult {
  title: string
  url: string
  snippet: string
  /** Page text the provider already returned (Tavily, Wikipedia), so the page need not be fetched. */
  content?: string
}

export interface SearchOptions {
  signal?: AbortSignal
  limit?: number
  /** Recent news: a provider that has a news mode asks for it (Tavily: `topic: "news"` and the last `days`). Others ignore it. */
  news?: boolean
  /** With `news`: how many days back. Default 7. */
  days?: number
  /** Who asks: the course slug and the agent (the client search provider shows them on its task). */
  book?: string
  agent?: string
  /** The job that asks: a client search task is filed under it, so the queue sees the job as waiting for a client (`edu_wait` returns). */
  job?: string
}

export interface SearchProvider {
  readonly id: string
  /** USD per request, logged to the spend files. */
  readonly pricePerRequest: number
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>
}

type FetchImpl = typeof fetch

// ---- text cleaning ----

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' }

/** Turns HTML into plain text: drops scripts, styles, comments and tags, decodes entities, collapses white space, caps the length. */
export function htmlToText(html: string, maxChars = 8000): string {
  let t = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head|iframe|object|embed|form|nav|footer|aside)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(script|style|noscript|template|svg|head|iframe|object|embed)\b[\s\S]*$/i, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article|blockquote)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:b|i|em|strong|span|a|u|small|sup|sub|code|abbr|mark|font)\b[^>]*>/gi, '')
    .replace(/<[^>]*>/g, ' ')
  t = t
    .replace(/&#(\d+);/g, (_m, n: string) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => safeChar(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
  t = t
    .split(/\n+/)
    .map((l) => l.replace(/[ \t\f\v\xa0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return capText(t, maxChars)
}

function safeChar(code: number): string {
  return Number.isFinite(code) && code > 8 && code < 0x110000 && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' '
}

/** Cuts text at `maxChars`, at a sentence or line end when one is close. */
export function capText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'))
  return (end > maxChars * 0.6 ? cut.slice(0, end + 1) : cut).trim()
}

const STOP = new Set('about after again also because been before being between could does during each from have into just like many more most much only other over same should some such than that their them then there these they this those through under very were what when where which while will with would your how long did the and for are was were its who whom why can may might must shall'.split(' '))

/** Words that sound like research but say nothing about the subject. */
const GENERIC = new Set('typical standard general common usual usually around approximately specific specifically early late main various several different important regarding including involved involve use used using role function functioned worked work conditions limitations capacity layout procedures instruments effective effects effect type types kind kinds example examples compared take took make made need needed get got take'.split(' '))

/**
 * The few words of a question that name its subject, in their original order: proper nouns, numbers and long words first.
 * Wikipedia's search wants every word to be on the page, so a whole question finds nothing and a few good words do.
 */
export function searchTerms(question: string, max = 5): string[] {
  const tokens = [...question.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)].map((m, i) => ({ word: m[0].replace(/'s$/i, ''), i }))
  const scored = tokens
    .filter((t) => t.word.length >= 3 && !STOP.has(t.word.toLowerCase()) && !GENERIC.has(t.word.toLowerCase()))
    .map((t) => ({ ...t, score: (/^\p{Lu}/u.test(t.word) && t.i > 0 ? 3 : 0) + (/\d/.test(t.word) ? 3 : 0) + (t.word.length >= 8 ? 2 : t.word.length >= 6 ? 1 : 0) }))
  const seen = new Set<string>()
  const unique = scored.filter((t) => (seen.has(t.word.toLowerCase()) ? false : (seen.add(t.word.toLowerCase()), true)))
  return unique
    .sort((a, b) => b.score - a.score || b.word.length - a.word.length || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((t) => t.word)
}

/** The words of a question that say what it is about: no short words, no question words. */
export function keywordsOf(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w)))]
}

/**
 * A long text cut down to `maxChars`: the opening (what the page is about) and then the paragraphs that share the most words with the query, in their original order.
 * Short texts come back whole.
 */
export function excerptFor(query: string, text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const paras = text.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0)
  const words = keywordsOf(query)
  const head = Math.min(900, Math.floor(maxChars / 5))
  const chosen = new Set<number>()
  let used = 0
  const take = (i: number) => {
    const len = paras[i]!.length + 1
    if (chosen.has(i) || used + len > maxChars) return
    chosen.add(i)
    used += len
  }
  // the opening paragraphs up to `head` characters
  for (let i = 0; i < paras.length && used < head; i++) take(i)
  const ranked = paras
    .map((p, i) => ({ i, score: words.filter((w) => p.toLowerCase().includes(w)).length }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
  for (const r of ranked) take(r.i)
  return [...chosen]
    .sort((a, b) => a - b)
    .map((i) => paras[i]!)
    .join('\n')
    .slice(0, maxChars)
}

/** Only plain http(s) URLs to public hosts. Search results are untrusted, so no localhost, private ranges or odd schemes. */
export function isSafeUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  if (u.username || u.password) return false
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (/^\[/.test(host)) return false // IPv6 literals
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false
  }
  return true
}

export interface FetchPageOptions {
  fetchImpl?: FetchImpl
  signal?: AbortSignal
  maxChars?: number
  /** Stop reading the body after this many bytes. */
  maxBytes?: number
  timeoutMs?: number
}

/** Downloads a page and returns its text (no HTML, no scripts, capped). Throws on errors and on non-text content. */
export async function fetchPageText(url: string, o: FetchPageOptions = {}): Promise<string> {
  if (!isSafeUrl(url)) throw new Error(`refusing to fetch ${url}`)
  const fetchImpl = o.fetchImpl ?? fetch
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 15_000)
  const onAbort = () => ctl.abort()
  o.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain;q=0.9' }, signal: ctl.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    const type = (res.headers.get('content-type') ?? '').toLowerCase()
    if (type && !/text\/|html|xml/.test(type)) throw new Error(`${url}: not a text page (${type})`)
    const raw = await readCapped(res, o.maxBytes ?? 1_500_000)
    return /html|xml/.test(type) || /<html|<body|<p[ >]/i.test(raw.slice(0, 2000)) ? htmlToText(raw, o.maxChars ?? 8000) : capText(raw.trim(), o.maxChars ?? 8000)
  } finally {
    clearTimeout(timer)
    o.signal?.removeEventListener('abort', onAbort)
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, maxBytes)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    if (size >= maxBytes) {
      await reader.cancel().catch(() => undefined)
      break
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}

// ---- providers ----

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))), { once: true })
  })

/** GET or POST that returns the JSON. A 429 (rate limit) or 503 is tried again after the server's Retry-After (or a short pause), up to `retries` times. */
async function getJson(fetchImpl: FetchImpl, url: string, init: RequestInit, retries = 0, pauseMs = 1500): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, init)
    if (res.ok) return res.json()
    if ((res.status === 429 || res.status === 503) && attempt < retries) {
      const after = Number(res.headers.get('retry-after'))
      await wait(Math.min(15_000, Number.isFinite(after) && after > 0 ? after * 1000 : pauseMs * (attempt + 1)), init.signal ?? undefined)
      continue
    }
    throw new Error(`${new URL(url).host}: HTTP ${res.status}${res.status === 429 ? ' (rate limited or out of credits)' : ''}`)
  }
}

/** The JSON body of a Tavily search. A news search (articles) uses `topic: "news"` and only the last `days` days (default 7). */
export function tavilyRequest(query: string, opts: SearchOptions = {}): Record<string, unknown> {
  return {
    query,
    search_depth: 'basic',
    max_results: opts.limit ?? 5,
    include_answer: false,
    include_raw_content: false,
    ...(opts.news ? { topic: 'news', days: Math.max(1, Math.floor(opts.days ?? 7)) } : {})
  }
}

export interface TavilyOptions {
  id?: string
  apiKey: string
  baseUrl?: string
  pricePerRequest?: number
  fetchImpl?: FetchImpl
}

/** Tavily: a search API for AI agents. Returns cleaned page text with the results. Needs TAVILY_API_KEY. */
export class TavilyProvider implements SearchProvider {
  readonly id: string
  readonly pricePerRequest: number
  constructor(private readonly o: TavilyOptions) {
    this.id = o.id ?? 'tavily'
    this.pricePerRequest = o.pricePerRequest ?? 0
  }
  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const base = (this.o.baseUrl ?? 'https://api.tavily.com').replace(/\/+$/, '')
    const json = (await getJson(this.o.fetchImpl ?? fetch, `${base}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.apiKey}`, 'user-agent': USER_AGENT },
      body: JSON.stringify(tavilyRequest(query, opts)),
      signal: opts.signal
    })) as { results?: { title?: string; url?: string; content?: string }[] }
    return (json.results ?? [])
      .filter((r) => r.url && isSafeUrl(r.url))
      .map((r) => ({ title: String(r.title ?? r.url), url: r.url!, snippet: String(r.content ?? '').slice(0, 300), content: r.content ? String(r.content) : undefined }))
  }
}

export interface WikipediaOptions {
  id?: string
  /** Default https://en.wikipedia.org */
  baseUrl?: string
  fetchImpl?: FetchImpl
  /** Characters of article text to return per page. */
  maxChars?: number
  /** Pause between the requests of one search (ms). Default 250. */
  spacingMs?: number
  /** First pause after a 429 without a Retry-After header (ms). Default 1500. */
  pauseMs?: number
}

/** The MediaWiki API of Wikipedia: free, no key. Returns the start of each matching article as plain text. */
export class WikipediaProvider implements SearchProvider {
  readonly id: string
  readonly pricePerRequest = 0
  constructor(private readonly o: WikipediaOptions = {}) {
    this.id = o.id ?? 'wikipedia'
  }
  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const base = (this.o.baseUrl ?? 'https://en.wikipedia.org').replace(/\/+$/, '')
    const fetchImpl = this.o.fetchImpl ?? fetch
    const init: RequestInit = { headers: { 'user-agent': USER_AGENT, accept: 'application/json', 'api-user-agent': USER_AGENT }, signal: opts.signal }
    const limit = Math.min(opts.limit ?? 3, 5)
    // MediaWiki search needs every word on the page: try the five best words, then three, then two
    const attempts = [...new Set([searchTerms(query, 5).join(' '), searchTerms(query, 3).join(' '), searchTerms(query, 2).join(' ')])].filter(Boolean)
    let hits: { title: string; pageid: number; snippet?: string }[] = []
    for (const q of attempts.length ? attempts : [query]) {
      const found = (await getJson(
        fetchImpl,
        `${base}/w/api.php?${new URLSearchParams({ action: 'query', list: 'search', srsearch: q, srlimit: String(limit), srprop: 'snippet', format: 'json', formatversion: '2' })}`,
        init,
        3,
        this.o.pauseMs ?? 1500
      )) as { query?: { search?: { title: string; pageid: number; snippet?: string }[] } }
      hits = found.query?.search ?? []
      if (hits.length > 0) break
    }
    if (hits.length === 0) return []
    // the whole article as plain text, one request per page (the API gives one full-length extract per request), cut down to the passages that fit the question
    const out: SearchResult[] = []
    for (const h of hits) {
      let text = ''
      try {
        await wait(this.o.spacingMs ?? 250, opts.signal) // be gentle: Wikipedia limits bursts of requests
        const page = (await getJson(
          fetchImpl,
          `${base}/w/api.php?${new URLSearchParams({ action: 'query', prop: 'extracts', explaintext: '1', exsectionformat: 'plain', pageids: String(h.pageid), format: 'json', formatversion: '2' })}`,
          init,
          3,
          this.o.pauseMs ?? 1500
        )) as { query?: { pages?: { extract?: string }[] } }
        text = page.query?.pages?.[0]?.extract?.trim() ?? ''
      } catch (err) {
        if (opts.signal?.aborted) throw err
      }
      out.push({
        title: h.title,
        url: `${base}/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}`,
        snippet: htmlToText(h.snippet ?? '', 300),
        content: text ? excerptFor(query, text, this.o.maxChars ?? 5000) : undefined
      })
    }
    return out
  }
}

/** Brave, SerpApi, SERPHouse and DuckDuckGo are named in the design and sit behind the same interface, but are not written yet. */
export class StubSearchProvider implements SearchProvider {
  readonly pricePerRequest: number
  constructor(
    readonly id: string,
    private readonly engine: string,
    pricePerRequest = 0
  ) {
    this.pricePerRequest = pricePerRequest
  }
  search(): Promise<SearchResult[]> {
    return Promise.reject(new Error(`the ${this.engine} search provider is not implemented yet (it is a stub: use tavily or wikipedia)`))
  }
}

export const STUB_ENGINES = ['brave', 'serpapi', 'serphouse', 'duckduckgo'] as const

export interface ProviderSpec {
  id: string
  engine: string
  baseUrl?: string
  apiKey?: string
  pricePerRequest: number
  /** `client` engine: the engine's client task queue, and how long a task may wait for a client. */
  clientQueue?: ClientTaskQueue
  clientWaitMs?: number
}

/** The provider object for one `kind: search` entry of providers.md. Null when the engine is unknown. */
export function makeSearchProvider(spec: ProviderSpec, fetchImpl?: FetchImpl): SearchProvider | null {
  switch (spec.engine.toLowerCase()) {
    case 'tavily':
      return spec.apiKey ? new TavilyProvider({ id: spec.id, apiKey: spec.apiKey, baseUrl: spec.baseUrl, pricePerRequest: spec.pricePerRequest, fetchImpl }) : null
    case 'client':
      return spec.clientQueue ? new ClientSearchProvider({ id: spec.id, queue: spec.clientQueue, waitMs: spec.clientWaitMs }) : null
    case 'wikipedia':
      return new WikipediaProvider({ id: spec.id, baseUrl: spec.baseUrl, fetchImpl })
    default:
      return (STUB_ENGINES as readonly string[]).includes(spec.engine.toLowerCase()) ? new StubSearchProvider(spec.id, spec.engine, spec.pricePerRequest) : null
  }
}
