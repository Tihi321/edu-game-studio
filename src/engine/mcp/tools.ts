import { z } from 'zod'
import { languages } from '../../shared/languages'
import { jsonSchemaOf } from '../pipeline/llm'
import type { EduService } from '../edu/service'
import type { ClientTaskQueue } from '../models/client'
import { clientTools } from './tools-client'

/**
 * The MCP tools. They drive the same `EduService` as the app and the CLI, so a shared engine shows what an agent does in the UI
 * (the service emits its own events). `server.ts` serves them over HTTP and stdio, `callTool` runs one.
 */

export interface Tool {
  name: string
  description: string
  schema: z.ZodType
  run: (args: never) => Promise<unknown>
}

export interface McpOptions {
  /** How long a `wait` call waits at most (ms). Default 10 minutes. */
  waitTimeoutMs?: number
  /** The queue switches of the engine (`edu_pause_all`, `edu_resume_all`, `edu_stop_now`). Without it those tools say they are unavailable. */
  control?: { setPaused(paused: boolean): Promise<void>; stopNow(opts?: { drop?: boolean; slug?: string }): Promise<void>; clearQueue(slug?: string): Promise<{ dropped: number; courses: string[] }> }
  /** The engine's client task queue (model calls of `client/...` models). Default: the one of the service's registry. */
  clientQueue?: ClientTaskQueue
}

/** Makes a tool: the arguments are parsed with `schema` before `run` sees them. */
export type ToolDef = <S extends z.ZodType>(name: string, description: string, schema: S, run: (args: z.output<S>) => Promise<unknown>) => Tool
export const def: ToolDef = (name, description, schema, run) => ({ name, description, schema, run: run as Tool['run'] })

/** A tool result with extra content blocks (images) besides its data. */
export class ToolOutput {
  constructor(
    readonly data: unknown,
    readonly extra: { type: 'image'; data: string; mimeType: string }[]
  ) {}
}

/** The result of a `tools/call`: a readable text item plus the same data as `structuredContent`. */
export interface ToolResult {
  [key: string]: unknown
  /** The first block is the text; image blocks may follow. */
  content: [{ type: 'text'; text: string }, ...{ type: 'image'; data: string; mimeType: string }[]]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

const slug = z.string().describe('The course slug (see edu_list_courses)')

/** What `wait` says when jobs wait for the client: how many tasks, and what to do. */
export function clientHint(n: number): { clientTasks?: number; hint?: string } {
  return n > 0 ? { clientTasks: n, hint: 'Model calls are waiting for you: call edu_get_task, answer with edu_submit_task, repeat until none, then edu_wait again.' } : {}
}

/**
 * The tool list, bound to a service. Later tickets add their tools as `def(name, description, schema, run)` entries (or a `xxxTools(svc, def, opts)`
 * list spread in below): EGS-02 the course tools, EGS-03 build and lint, EGS-08 the pipeline.
 */
export function buildTools(svc: EduService, opts: McpOptions = {}): Tool[] {
  const timeoutMs = opts.waitTimeoutMs ?? 10 * 60_000
  const queue = () => opts.clientQueue ?? svc.deps.registry.clientQueue
  const control = () => {
    if (!opts.control) throw new Error('the queue switches are not available here')
    return opts.control
  }

  return [
    def('edu_list_courses', 'List the courses in the data folder (slug and when they last changed).', z.object({}), async () => ({ courses: await svc.listCourses() })),
    def(
      'edu_status',
      'The state of the job queue: with a course slug, the jobs of that course (queued, running, done, failed, and the failures); without one, the courses with their job counts. clientTasks: the model calls waiting for you or leased (see edu_get_task).',
      z.object({ slug: slug.optional() }),
      async (a) => {
        if (a.slug) return { slug: a.slug, ...(await svc.status(a.slug)), clientTasks: queue().counts() }
        const courses = await svc.listCourses()
        return { dataDir: svc.dataDir, courses: await Promise.all(courses.map(async (c) => ({ slug: c.slug, jobs: await svc.jobCounts(c.slug) }))), clientTasks: queue().counts() }
      }
    ),
    def(
      'edu_wait',
      'Wait until a course has nothing left to run (or the timeout passes), then say how it ended. Other calls keep working while this one waits.',
      z.object({ slug, timeoutSeconds: z.number().positive().optional().describe('Default: 600') }),
      async (a) => {
        const r = await svc.waitIdle(a.slug, { timeoutMs: Math.min(a.timeoutSeconds ? a.timeoutSeconds * 1000 : 600_000, timeoutMs) })
        return { timedOut: r.timedOut, failedJobs: r.failed, ...clientHint(r.clientTasks), status: await svc.status(a.slug) }
      }
    ),
    def(
      'edu_languages',
      'The languages a course can use: code, English name, native name, right-to-left, script and whether the player menus are translated. Add more in config/languages.md.',
      z.object({}),
      async () => ({ languages: languages().map((l) => ({ code: l.code, name: l.name, native: l.native, rtl: !!l.rtl, script: l.script, uiStrings: !!l.ui })) })
    ),

    // ---- generators ----
    def('edu_studios_status', 'Are Pixel Studio, Chiptune Studio and flow-music-mcp (the apps that make pixel art, music and Google Flow media) reachable, and how to start them if not.', z.object({}), async () => ({ studios: await svc.studiosStatus() })),
    def('edu_comfy_status', 'Is ComfyUI reachable: its lanes, the image and audio engines, custom workflows and background removal.', z.object({}), async () => {
      const { type: _type, ...status } = await svc.comfyStatus()
      return status
    }),
    def('edu_comfy_free', 'Free the VRAM of the ComfyUI lanes (unload models).', z.object({}), async () => ({ results: await svc.comfyFree() })),
    def(
      'edu_voice_status',
      'The local ComfyUI voice engines (the TTS Audio Suite) and sound-effect engines: each engine id, label, task (voice or effect), the languages it reads (`*` means any language), whether it is ready and which ComfyUI nodes are missing, plus the custom TTS workflows.',
      z.object({}),
      async () => {
        const { type: _type, ...status } = await svc.voiceStatus()
        return status
      }
    ),

    // ---- model work done by the MCP client (client/... models) ----
    ...clientTools(svc, def, opts),

    // ---- queue switches ----
    def('edu_pause_all', 'Pause the whole queue: running jobs finish, no new job starts (it stays paused after a restart).', z.object({}), async () => {
      await control().setPaused(true)
      return { paused: true }
    }),
    def('edu_resume_all', 'Resume the queue.', z.object({}), async () => {
      await control().setPaused(false)
      return { paused: false }
    }),
    def(
      'edu_stop_now',
      'Pause the queue and stop every running job at once (they go back to the queue, and run again after edu_resume_all, oldest first). drop: true also deletes the queued jobs (of the course slug, or of every course).',
      z.object({ drop: z.boolean().optional().describe('Also drop the queued jobs'), slug: z.string().optional().describe('With drop: only the jobs of this course') }),
      async (a) => {
        await control().stopNow({ drop: a.drop, slug: a.slug })
        return { paused: true, stopped: true, ...(a.drop ? { dropped: true } : {}) }
      }
    ),
    def(
      'edu_clear_queue',
      'Delete the queued jobs of a course (or of every course), without stopping the jobs that are running now. Pass confirm: true.',
      z.object({ slug: z.string().optional().describe('Only this course'), confirm: z.literal(true).describe('Must be true') }),
      async (a) => ({ ...(await control().clearQueue(a.slug)) })
    )
  ]
}

/** Runs one tool: the arguments are checked against its schema; a failure is an error result, never a throw. */
export async function callTool(tools: readonly Tool[], name: string, args: unknown): Promise<ToolResult> {
  const fail = (text: string): ToolResult => ({ isError: true, content: [{ type: 'text', text }] })
  const tool = tools.find((t) => t.name === name)
  if (!tool) return fail(`unknown tool "${name}"`)
  const parsed = tool.schema.safeParse(args ?? {})
  if (!parsed.success) return fail(`invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
  try {
    const out = await tool.run(parsed.data as never)
    const result = out instanceof ToolOutput ? out.data : out
    const extra = out instanceof ToolOutput ? out.extra : []
    const structured = (result !== null && typeof result === 'object' && !Array.isArray(result) ? result : { result }) as Record<string, unknown>
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }, ...extra], structuredContent: JSON.parse(JSON.stringify(structured)) as Record<string, unknown> }
  } catch (e) {
    return fail((e as Error).message)
  }
}

/** The tools as `tools/list` shows them. */
export function toolList(tools: readonly Tool[]): { name: string; description: string; inputSchema: { type: 'object'; [k: string]: unknown } }[] {
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: jsonSchemaOf(t.schema) as { type: 'object'; [k: string]: unknown } }))
}
