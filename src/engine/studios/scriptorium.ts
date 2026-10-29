import { createMcpClient, McpHttpError } from './mcp-http'
import type { McpHttpClient } from './mcp-http'

/**
 * Scriptorium (the hub's book factory) over MCP, for a course whose brief asks `story: "scriptorium"`: Edu Studio hands it the narrative
 * designer's story idea and gets the story slug back; the book appears when Scriptorium's factory starts it (`waitForStory`).
 *
 * Edu Studio NEVER starts Scriptorium: starting its engine resumes the whole book factory, which may spend on paid models. There is no
 * `ensureUp` hook here and Scriptorium is not in the autostart list; a Scriptorium that is down is an error with a start hint, and the pipeline
 * records the story step as skipped with it.
 *
 * Tools used (Scriptorium `src/engine/mcp/tools.ts`): `add_story {title?, premise?, plot?, characters?, setting?, style?, format?, genre?, ...}`
 * returns `{slug, file, story}`; `wait_for_book {slug, timeout_seconds?, stop_on_client_task?}` takes a story slug or a book slug and returns
 * `{done, reason, story, book, title, stage, folder, epub, ...}`.
 */

export const DEFAULT_SCRIPTORIUM_URL = 'http://127.0.0.1:7341/mcp'

export interface StoryHandOff {
  /** The story idea: what the book is about, for the learners of the course. */
  idea: string
  audience: string
  /** How long the story should be, in words ("a short story of about 2000 words"). */
  length: string
  /** A working title (Scriptorium keeps it for the book). */
  title?: string
}

export interface StoryState {
  done: boolean
  /** `published`, `rejected`, `failed`, `client-task` or `timeout`. */
  reason: string
  story: string | null
  /** The book slug, once the factory has started the book. */
  book: string | null
  title: string | null
  stage: string | null
  folder: string | null
}

export interface ScriptoriumStatus {
  up: boolean
  /** Why not (with how to start it). */
  error?: string
}

export interface ScriptoriumClient {
  readonly url: string
  /** Is Scriptorium answering (an MCP `initialize` and `tools/list`), and does it have the story tools. Never throws. */
  status(): Promise<ScriptoriumStatus>
  /** Adds the story to Scriptorium's factory. Returns the story slug. Throws `ScriptoriumError` (`down` when nothing answers). */
  handOffStory(story: StoryHandOff, opts?: { signal?: AbortSignal }): Promise<{ story: string }>
  /** One `wait_for_book` call (at most `timeoutSeconds`, default 60): where the story's book is. */
  waitForStory(story: string, opts?: { timeoutSeconds?: number; signal?: AbortSignal }): Promise<StoryState>
}

export class ScriptoriumError extends Error {
  constructor(
    message: string,
    /** `down`: nothing answers. `tool`: Scriptorium refused the call. `protocol`: an answer we cannot read. */
    readonly kind: 'down' | 'tool' | 'protocol'
  ) {
    super(message)
    this.name = 'ScriptoriumError'
  }
}

export function scriptoriumStartHint(url: string): string {
  return `Scriptorium is not running at ${url}. Start it yourself (it resumes its book factory and may use paid models, so Edu Studio never starts it): hub.ps1 start scriptorium`
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

export interface ScriptoriumClientOptions {
  url?: string
  token?: string | null
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export function createScriptoriumClient(o: ScriptoriumClientOptions = {}): ScriptoriumClient {
  const url = o.url ?? DEFAULT_SCRIPTORIUM_URL
  const hint = scriptoriumStartHint(url)
  const mcp: McpHttpClient = createMcpClient({ url, label: 'Scriptorium', notRunningHint: hint, token: o.token, tokenVar: 'SCRIPTORIUM_MCP_TOKEN', fetchImpl: o.fetchImpl, timeoutMs: o.timeoutMs ?? 15_000 })
  const asError = (e: unknown): ScriptoriumError => {
    if (e instanceof ScriptoriumError) return e
    if (e instanceof McpHttpError) return new ScriptoriumError(e.message, e.kind === 'unreachable' ? 'down' : e.kind === 'tool' ? 'tool' : 'protocol')
    return new ScriptoriumError((e as Error).message, 'protocol')
  }
  return {
    url,
    async status() {
      try {
        const tools = (await mcp.listTools()).map((t) => t.name)
        const missing = ['add_story', 'wait_for_book'].filter((t) => !tools.includes(t))
        return missing.length ? { up: false, error: `Scriptorium at ${url} has no ${missing.join(' and ')} tool` } : { up: true }
      } catch (e) {
        return { up: false, error: asError(e).message }
      }
    },
    async handOffStory(story, opts = {}) {
      try {
        const r = await mcp.callTool(
          'add_story',
          {
            ...(story.title ? { title: story.title } : {}),
            premise: story.idea,
            style: `Written for ${story.audience}. Length: ${story.length}.`,
            setting: 'A story that carries a learning course: it is read before or beside the course, so the topic of the course is woven into it.'
          },
          { signal: opts.signal }
        )
        const slug = str(r.json?.slug)
        if (!slug) throw new ScriptoriumError(`Scriptorium's add_story gave no story slug: ${r.text.slice(0, 200)}`, 'protocol')
        return { story: slug }
      } catch (e) {
        throw asError(e)
      }
    },
    async waitForStory(story, opts = {}) {
      try {
        const seconds = Math.min(900, Math.max(1, Math.round(opts.timeoutSeconds ?? 60)))
        const r = await mcp.callTool('wait_for_book', { slug: story, timeout_seconds: seconds, stop_on_client_task: false }, { timeoutMs: (seconds + 30) * 1000, signal: opts.signal })
        const j = r.json
        if (!j) throw new ScriptoriumError(`Scriptorium's wait_for_book answered no JSON: ${r.text.slice(0, 200)}`, 'protocol')
        return { done: j.done === true, reason: str(j.reason) ?? 'timeout', story: str(j.story), book: str(j.book), title: str(j.title), stage: str(j.stage), folder: str(j.folder) }
      } catch (e) {
        throw asError(e)
      }
    }
  }
}
