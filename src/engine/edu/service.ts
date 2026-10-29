import { promises as fs, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { parseMd } from '../../shared/md'
import type { Scheduler } from '../queue/scheduler'
import { parseNoteFacts } from '../research/notes'
import type { CustomWorkflowInfo, EduCommand, EngineEvent, EngineInfo, StudioStatusView } from '../../shared/protocol'
import { DEFAULT_VOICE_ENGINE } from '../../shared/media'
import type { FactoryConfig, FormatEntry, QualityConfig, SettingsConfig } from '../../shared/schemas'
import type { AgentStore } from '../agents/agents'
import type { ModelRegistry } from '../models/registry'
import type { ModelRouter } from '../models/router'
import type { JobState, JobStore } from '../queue/jobs'
import { JOB_STATES } from '../queue/jobs'
import { listPalettes } from '../assets/palettes'
import { createComfyClient, lanesOf } from '../comfy/client'
import type { ComfyClient } from '../comfy/client'
import { listCustomWorkflows, loadCustomWorkflow, workflowKind } from '../comfy/custom-workflow'
import { ENGINES } from '../comfy/graphs'
import { buildInventory, freeAllLanes } from '../comfy/inventory'
import type { PixelClient } from '../studios/pixel'
import type { ChiptuneClient } from '../studios/chiptune'
import type { FlowClient } from '../studios/flow'
import type { ScriptoriumClient } from '../studios/scriptorium'
import { runPlaytest } from './playtest'
import type { PlaytestOptions, PlaytestResult } from './playtest'
import type { ServiceStarter } from '../studios/autostart'
import { chiptuneClientFor, flowClientFor, flowStartHint, loadStudiosConfig, pixelClientFor, scriptoriumClientFor, startHint, studioRepo, studioUrl, STUDIO_NAMES } from '../studios/config'
import type { StudioId, StudiosConfig } from '../studios/config'
import { ResearchService } from '../research/service'
import type { SearchService } from '../research/service'
import { registerResearchHandlers } from '../research/handlers'
import { findAppDirs } from './appdirs'
import type { AppDirs } from './appdirs'
import { courseMdPath, modelFor, patchCourseMeta, patchCourseModels, readCourseMeta } from './course-meta'
import type { CourseMeta, CourseMetaFile } from './course-meta'
import { FactBase } from './factbase'
import { briefSchema, resolveBrief } from '../../shared/brief'
import type { BriefInput } from '../../shared/brief'
import { Pipeline } from './pipeline'
import type { RunResult } from './pipeline'
import { registerPipelineHandlers } from './pipeline-handlers'
import { assertSlug, courseSlug, coursesDir, dataFolders, loadComfyConfigFor } from './paths'
import { CourseStore, listCourses } from './store'
import { handleStudioCommand } from './studio-commands'
import type { CourseSummary } from './store'

/** What the course pipeline gets from the engine. */
export interface EduDeps {
  dataDir: string
  log: (message: string) => void
  emit: (e: EngineEvent) => void
  registry: ModelRegistry
  router: ModelRouter
  jobs: JobStore
  getSettings: () => SettingsConfig
  /** `config/factory.md` (the research limit, `allow_unverified_facts`). */
  getFactory: () => FactoryConfig
  /** `config/quality.md`: the thresholds the reviews are judged by. */
  getQuality: () => QualityConfig
  /** `config/formats.md`: the course formats. */
  getFormats: () => FormatEntry[]
  /** The agents (the research service asks whether there is a researcher). */
  agents: Pick<AgentStore, 'list'>
  /** The search providers of `config/providers.md` (tests inject fakes through the engine option `search`). */
  search: SearchService
  /** Running jobs follow a changed model list from their next request (called after a course's models changed). */
  changeModel?: () => void
  /** Wakes the scheduler after jobs were enqueued. */
  kick?: () => void
  /** Aborts running jobs of a course in the scheduler and returns how many were aborted. */
  stopBook?: (slug: string, reason?: 'stopped' | 'stop') => number
  /** Generator clients (tests pass fakes). Default: made from `config/*.md` where a ticket needs them. */
  comfy?: ComfyClient | (() => ComfyClient | Promise<ComfyClient>)
  pixel?: PixelClient
  chiptune?: ChiptuneClient
  flow?: FlowClient
  /** Scriptorium (tests pass a fake). Default: made from `config/studios.md`. It is never started by Edu Studio. */
  scriptorium?: ScriptoriumClient
  /** Plays a built game with the autoplay bot (tests pass a fake; `runPlaytest` by default). */
  playtest?: (buildDir: string, opts?: PlaytestOptions) => Promise<PlaytestResult>
  /** Starts the generator services when a job finds them down (tests pass a fake, or none). */
  starter?: ServiceStarter
  /** The folders that ship with the app. Default: found relative to this code. */
  dirs?: Partial<AppDirs>
}

export interface JobCounts {
  queued: number
  running: number
  done: number
  failed: number
}

export type { CourseSummary } from './store'

const runOf = (id: string): number => {
  const m = /--r(\d+)$/.exec(id)
  return m ? Number(m[1]) : 0
}

/**
 * Everything the app does with courses: the queries and queue helpers that the MCP tools and the app share. A skeleton for now: later
 * tickets add the course store (EGS-02), the build (EGS-03) and the pipeline (EGS-08) here. Job ids are `<slug>--<task>--<unit>--r<run>`.
 */
export class EduService {
  readonly dirs: AppDirs
  private readonly comfyOverride: EduDeps['comfy']
  private store: CourseStore | undefined
  /** The research jobs (the per-course limit, idempotent ids) and the notes the researcher writes. */
  readonly research: ResearchService
  /** The fact base of each course (`courses/<slug>/factbase/`). */
  readonly factbase: FactBase
  /** The content pipeline: its state, `advance` and the run controls (EGS-08). */
  readonly pipeline: Pipeline
  /** Set by the pipeline handlers: called when a research job finished its work. */
  afterResearch?: (slug: string, jobId: string) => Promise<void>
  /** `course.md` models by course: the cache `courseModel` answers from (see there). */
  private readonly models = new Map<string, { models: Record<string, string>; mtime: number }>()

  constructor(readonly deps: EduDeps) {
    this.dirs = { ...findAppDirs(), ...(deps.dirs ?? {}) }
    this.comfyOverride = deps.comfy
    this.research = new ResearchService({ dataDir: deps.dataDir, jobs: deps.jobs, agents: deps.agents, getFactory: deps.getFactory, log: (m) => this.log(m), kick: () => deps.kick?.(), emit: deps.emit })
    this.pipeline = new Pipeline(this)
    this.factbase = new FactBase(deps.dataDir, this.research.store, { allowUnverified: () => deps.getFactory().allow_unverified_facts })
  }

  /** Registers the job handlers of the service's own tasks on the scheduler: `research` now, the content pipeline in EGS-08. */
  registerHandlers(scheduler: Scheduler): void {
    registerResearchHandlers(scheduler, { dataDir: this.deps.dataDir, log: (m) => this.log(m), search: this.deps.search, research: this.research, after: (slug, jobId) => this.afterResearch?.(slug, jobId) ?? Promise.resolve() })
    registerPipelineHandlers(scheduler, this)
  }

  get dataDir(): string {
    return this.deps.dataDir
  }

  log(message: string): void {
    this.deps.log(`edu: ${message}`)
  }

  emit(e: EngineEvent): void {
    this.deps.emit(e)
  }

  /**
   * The model a course sets for a role: `models[role]`, else `models['*']` of its `course.md`; it goes first in that course's model list
   * (course, then agent, then the role's list). Synchronous: it answers from an in-memory cache that `warm()` fills and every write through
   * the service refreshes. The cache also notices a changed file (one `stat` of `course.md`), so a hand edit or the CLI's takes effect
   * without a restart: the file watcher does not cover `courses/`.
   */
  courseModel(slug: string, role: string): string | undefined {
    let file: string
    try {
      file = courseMdPath(this.dataDir, slug)
    } catch {
      return undefined // not a course slug (a job of another kind)
    }
    let mtime: number
    try {
      mtime = statSync(file).mtimeMs
    } catch {
      this.models.delete(slug)
      return undefined
    }
    let entry = this.models.get(slug)
    if (!entry || entry.mtime !== mtime) {
      entry = { models: this.readModelsSync(file), mtime }
      this.models.set(slug, entry)
    }
    return modelFor(entry.models, role)
  }

  private readModelsSync(file: string): Record<string, string> {
    try {
      const doc = parseMd(readFileSync(file, 'utf8'), file)
      const models = (doc.data as { models?: unknown }).models
      if (!models || typeof models !== 'object' || Array.isArray(models)) return {}
      return Object.fromEntries(
        Object.entries(models as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'string' && v.trim())
          .map(([k, v]) => [k, (v as string).trim()])
      )
    } catch (err) {
      this.log(`${file}: ${(err as Error).message} (its models are ignored until it parses)`)
      return {}
    }
  }

  /** `course.md` of a course (null when it has none). */
  getCourseMeta(slug: string): Promise<CourseMetaFile | null> {
    return readCourseMeta(this.dataDir, slug)
  }

  /** Changes top-level fields of `course.md` (see `patchCourseMeta`), refreshes the model cache and tells running jobs when the models changed. */
  async setCourseMeta(slug: string, patch: Record<string, unknown> | ((old: CourseMeta) => Record<string, unknown>), o: { body?: string | ((old: string) => string) } = {}): Promise<CourseMetaFile> {
    const before = JSON.stringify(this.courseModelsOf(slug))
    const out = await patchCourseMeta(this.dataDir, slug, patch, o)
    this.afterMetaWrite(slug, before)
    return out
  }

  /** Sets (or with `null` removes) course models by role (`*` for every role) in `course.md`. */
  async setCourseModels(slug: string, models: Record<string, string | null>): Promise<CourseMetaFile> {
    const before = JSON.stringify(this.courseModelsOf(slug))
    const out = await patchCourseModels(this.dataDir, slug, models)
    this.afterMetaWrite(slug, before)
    return out
  }

  private courseModelsOf(slug: string): Record<string, string> {
    this.courseModel(slug, '*') // refreshes the cache entry
    return this.models.get(slug)?.models ?? {}
  }

  private afterMetaWrite(slug: string, before: string): void {
    this.models.delete(slug)
    this.courseModel(slug, '*') // fills the cache from the file just written
    if (JSON.stringify(this.models.get(slug)?.models ?? {}) !== before) this.deps.changeModel?.()
  }

  /** Prepares what must be there before the first job runs: the course folder, and the course models of every `course.md`. */
  async warm(): Promise<void> {
    await fs.mkdir(coursesDir(this.dataDir), { recursive: true })
    for (const c of await listCourses(this.dataDir)) this.courseModel(c.slug, '*')
  }

  /**
   * Asks the researcher on behalf of a tool or the app (`you`): the answer is a note in `courses/<slug>/research/`. `waitSeconds`: waits for
   * the job and returns the facts of its note. It returns early (`clientTasks > 0`) when the job waits for you to answer a model call or a
   * web search (`edu_get_task`), and with `timedOut: true` when the time ran out.
   */
  async askResearcher(
    slug: string,
    question: string,
    o: { purpose?: string; waitSeconds?: number; askedBy?: string } = {}
  ): Promise<{
    status: string
    id: string | null
    state?: JobState | 'missing'
    timedOut?: boolean
    clientTasks?: number
    note?: { file: string; question: string; unverified: boolean; facts: { fact: string; source?: string }[] }
  }> {
    if (!(await this.courseExists(slug))) throw new Error(`no course "${slug}"`)
    const asked = await this.research.ask({ slug, question, askedBy: o.askedBy ?? 'you', purpose: o.purpose, priority: 1 })
    if (asked.status === 'empty') throw new Error('the question is empty (give a question of a few words)')
    const out: Awaited<ReturnType<EduService['askResearcher']>> = { ...asked }
    if (!asked.id || asked.status === 'no-researcher' || asked.status === 'limit') return out
    if (o.waitSeconds && o.waitSeconds > 0) {
      const w = await this.waitJob(asked.id, { timeoutMs: o.waitSeconds * 1000 })
      out.state = w.state
      if (w.timedOut) out.timedOut = true
      if (w.clientTasks) out.clientTasks = w.clientTasks
    }
    const note = await this.research.store.findExact(question, slug)
    if (note) {
      const facts = parseNoteFacts(note).map((f) => ({ fact: f.fact, ...(f.url ? { source: f.url } : {}) }))
      out.note = { file: note.file, question: note.question, unverified: note.unverified, facts }
    }
    return out
  }

  /** Waits until one job is done or failed. Returns early, with `clientTasks`, when it waits for a client to answer one of its model calls or searches. */
  async waitJob(id: string, o: { timeoutMs?: number; pollMs?: number } = {}): Promise<{ state: JobState | 'missing'; timedOut: boolean; clientTasks: number }> {
    const end = o.timeoutMs ? Date.now() + o.timeoutMs : Infinity
    for (;;) {
      const job = await this.deps.jobs.find(id)
      const state = job?.state ?? 'missing'
      if (state === 'done' || state === 'failed' || state === 'missing') return { state, timedOut: false, clientTasks: 0 }
      const clientTasks = state === 'running' ? this.deps.registry.clientQueue.countFor((j) => j === id) : 0
      if (clientTasks > 0) return { state, timedOut: false, clientTasks }
      if (Date.now() > end) return { state, timedOut: true, clientTasks: 0 }
      await new Promise((r) => setTimeout(r, o.pollMs ?? 100))
    }
  }

  /** Stops what the service keeps running (the file watchers of the studio round trips, later). */
  dispose(): void {
    // nothing yet
  }

  /** The courses in `<data>/courses/`: a folder with a `course.md` or a `course/pack.json`. */
  listCourses(): Promise<CourseSummary[]> {
    return listCourses(this.dataDir)
  }

  /**
   * Creates the course of a brief (its files, and `course.md` with the brief and the model) when it does not exist yet. The slug defaults to the
   * topic's. A course that exists keeps its files; its `course.md` gets the brief only when no run has started (or `overwriteBrief`). Returns the slug.
   */
  async createFromBrief(input: BriefInput, slug?: string, o: { overwriteBrief?: boolean } = {}): Promise<{ slug: string; created: boolean }> {
    const brief = briefSchema.parse(input)
    resolveBrief(brief, this.deps.getFormats()) // an unknown format is refused here
    if (brief.model && !this.deps.registry.getModel(brief.model)) throw new Error(`unknown model "${brief.model}" (the Models page lists provider/model refs; client/claude-code lets an MCP client do the work)`)
    const s = slug ?? courseSlug(brief.topic)
    let created = false
    if (!(await fs.stat(path.join(coursesDir(this.dataDir), assertSlug(s), 'course', 'pack.json')).then(() => true, () => false))) {
      await this.courses.create({ slug: s, title: brief.topic, languages: [brief.sourceLang], sourceLang: brief.sourceLang, subject: brief.topic, audience: brief.audience, ...(brief.targetLang ? { targetLang: brief.targetLang } : {}), ...(brief.cefr ? { cefr: brief.cefr } : {}) })
      created = true
    }
    const hasRun = !!(await this.pipeline.readSteps(s))
    if (created || !hasRun || o.overwriteBrief) {
      await this.setCourseMeta(s, { brief, stage: 'draft' })
      if (brief.model) await this.setCourseModels(s, { '*': brief.model })
    }
    return { slug: s, created }
  }

  /**
   * `edu_run_pipeline`: creates the course from a brief when it does not exist, then starts the run, resumes the one in progress, retries the
   * failed jobs or restarts from a stage (see `Pipeline.start`).
   */
  async runPipeline(a: { slug?: string; brief?: BriefInput; restart?: boolean; from?: string; retry?: boolean }): Promise<RunResult & { created?: boolean }> {
    let slug = a.slug
    let created: boolean | undefined
    if (a.brief) {
      const r = await this.createFromBrief(a.brief, slug, { overwriteBrief: a.restart === true })
      slug = r.slug
      created = r.created
    }
    if (!slug) throw new Error('give a slug (an existing course with a brief) or a brief')
    if (!(await this.courseExists(slug))) throw new Error(`no course "${slug}": pass a brief to create it`)
    const out = await this.pipeline.start(slug, { restart: a.restart, from: a.from, retry: a.retry })
    return created === undefined ? out : { ...out, created }
  }

  /** The course files (create, edit, import, validate, build, lint): the same code the CLI uses. */
  get courses(): CourseStore {
    return (this.store ??= new CourseStore(this.dataDir))
  }

  async courseExists(slug: string): Promise<boolean> {
    assertSlug(slug)
    return fs.stat(path.join(coursesDir(this.dataDir), slug)).then((s) => s.isDirectory(), () => false)
  }

  async jobCounts(slug: string): Promise<JobCounts> {
    const counts: JobCounts = { queued: 0, running: 0, done: 0, failed: 0 }
    for (const state of JOB_STATES) counts[state] = (await this.deps.jobs.ids(state)).filter((id) => id.startsWith(`${slug}--`)).length
    return counts
  }

  async jobIds(state: JobState, slug: string): Promise<string[]> {
    return (await this.deps.jobs.ids(state)).filter((id) => id.startsWith(`${slug}--`))
  }

  /** Drops the queued jobs of a course (or of every course when `slug` is null). */
  async clearQueue(slug: string | null): Promise<{ dropped: number; courses: string[] }> {
    if (slug) assertSlug(slug)
    const ids = (await this.deps.jobs.ids('queued')).filter((id) => !slug || id.startsWith(`${slug}--`))
    for (const id of ids) await fs.rm(this.deps.jobs.file('queued', id), { force: true })
    const courses = [...new Set(ids.map((id) => id.split('--')[0] ?? ''))].filter(Boolean)
    return { dropped: ids.length, courses }
  }

  /** The jobs of a course: how many per state, what runs, what failed. */
  async status(slug: string): Promise<{ jobs: JobCounts; running: { id: string; task: string; unit: string | null }[]; failed: { id: string; failure: string }[] }> {
    if (!(await this.courseExists(slug))) throw new Error(`no course "${slug}"`)
    const running = (await this.deps.jobs.list('running')).filter((j) => j.data.book === slug).map((j) => ({ id: j.id, task: j.data.task, unit: j.data.unit }))
    const failed = (await this.deps.jobs.list('failed'))
      .filter((j) => j.data.book === slug)
      .map((j) => ({ id: j.id, failure: String((j.data as Record<string, unknown>).failure ?? '') }))
    return { jobs: await this.jobCounts(slug), running, failed }
  }

  /**
   * Waits until the course (or every course) has nothing left to run: no running job, and every queued job is blocked by a failed one.
   * Returns the failed job ids. A running job whose model call waits in the client task queue (`client/...` model, answered over MCP)
   * is not working: the call returns as soon as nothing else runs, with `clientTasks` (how many tasks wait or are leased for this
   * course) so the caller can take them (`edu_get_task`). Without that it would block until the timeout.
   */
  async waitIdle(
    slug: string | null,
    o: { timeoutMs?: number; pollMs?: number; onTick?: () => void } = {}
  ): Promise<{ failed: string[]; timedOut: boolean; clientTasks: number }> {
    const end = o.timeoutMs ? Date.now() + o.timeoutMs : Infinity
    const mine = (b: string | null) => !slug || b === slug
    let idleSeen = false
    for (;;) {
      // running, queued, running again: a job that starts or ends between the reads is not missed (it is in one of them)
      const running1 = (await this.deps.jobs.list('running')).filter((j) => mine(j.data.book))
      const queued = (await this.deps.jobs.list('queued')).filter((j) => mine(j.data.book))
      const running2 = (await this.deps.jobs.list('running')).filter((j) => mine(j.data.book))
      const running = [...new Map([...running1, ...running2].map((j) => [j.id, j])).values()]
      // jobs parked in the client queue (waiting for Claude): not running work
      const queue = this.deps.registry.clientQueue
      const parked = queue.jobs()
      const working = running.filter((j) => !parked.has(j.id))
      const clientTasks = queue.countFor((job) => running.some((j) => j.id === job))
      const failed = (await this.deps.jobs.list('failed')).filter((j) => mine(j.data.book)).map((j) => j.id)
      const blocked = new Set<string>()
      const failedSet = new Set(failed)
      for (let changed = true; changed; ) {
        changed = false
        for (const j of queued) {
          if (blocked.has(j.id)) continue
          if (j.data.depends_on.some((d) => failedSet.has(d) || blocked.has(d))) {
            blocked.add(j.id)
            changed = true
          }
        }
      }
      const pending = queued.filter((j) => !blocked.has(j.id))
      // only the failures of the latest run count: an older run's failed job is history
      const latest = Math.max(0, ...failed.map(runOf))
      const current = failed.filter((id) => runOf(id) === latest)
      if (working.length === 0 && clientTasks > 0) return { failed: current, timedOut: false, clientTasks }
      if (running.length === 0 && pending.length === 0) {
        // a job that just ended may have queued its next jobs after the read above: look once more before saying idle
        if (idleSeen) return { failed: current, timedOut: false, clientTasks: 0 }
        idleSeen = true
        await new Promise((r) => setTimeout(r, 75))
        continue
      }
      idleSeen = false
      if (Date.now() > end) return { failed: current, timedOut: true, clientTasks }
      o.onTick?.()
      await new Promise((r) => setTimeout(r, o.pollMs ?? 300))
    }
  }

  // ---- generators: ComfyUI, the studios, the voice engines ----

  /**
   * The ComfyUI client. With `autoStart` (job paths only, never a status check) a lane that does not answer at all is started first, when
   * `config/autostart.md` allows it. A client given to the engine (tests) is used as it is.
   */
  async comfy(o: { autoStart?: boolean; log?: (m: string) => void } = {}): Promise<ComfyClient> {
    const override = this.comfyOverride
    if (override) return typeof override === 'function' ? override() : override
    const starter = o.autoStart ? this.deps.starter : undefined
    return createComfyClient({
      config: await loadComfyConfigFor(this.dataDir),
      dataDir: this.dataDir,
      ...(starter
        ? {
            ensureLane: async (lane: string, signal?: AbortSignal) => {
              const id = await starter.idForUrl(lane)
              return id ? starter.ensure(id, lane, { signal, log: o.log }) : 'not a service Edu Studio starts'
            }
          }
        : {})
    })
  }

  /** The Pixel Studio, Chiptune Studio and flow-music-mcp clients. With `autoStart` a studio that is down is started first (job paths only). */
  async studios(o: { autoStart?: boolean; log?: (m: string) => void } = {}): Promise<{ pixel: PixelClient; chiptune: ChiptuneClient; flow: FlowClient; config: StudiosConfig }> {
    const config = await loadStudiosConfig(this.dataDir)
    const starter = o.autoStart ? this.deps.starter : undefined
    const hook = (id: string, url: string) => (starter ? { ensureUp: (signal?: AbortSignal) => starter.ensure(id, url, { signal, log: o.log }) } : {})
    return {
      pixel: this.deps.pixel ?? pixelClientFor(config, hook('pixel-studio', config.pixelStudioUrl)),
      chiptune: this.deps.chiptune ?? chiptuneClientFor(config, hook('chiptune-studio', config.chiptuneStudioUrl)),
      flow: this.deps.flow ?? flowClientFor(config),
      config
    }
  }

  /** The Scriptorium client (never started from here: a Scriptorium that is down is an error with the start hint). */
  async scriptorium(): Promise<ScriptoriumClient> {
    return this.deps.scriptorium ?? scriptoriumClientFor(await loadStudiosConfig(this.dataDir))
  }

  /** Plays the built game of a course with the autoplay bot as simulated learners (`runPlaytest`; needs Chromium). Build the course first. */
  async playtest(slug: string, opts: PlaytestOptions = {}): Promise<PlaytestResult> {
    if (!(await this.courseExists(slug))) throw new Error(`no course "${slug}"`)
    const dir = this.courses.buildDir(slug)
    return (this.deps.playtest ?? runPlaytest)(dir, opts)
  }

  /** Asks the studios for their tools. Never throws: an unreachable studio is `ok: false` with the message (and how to start it). */
  async studiosStatus(): Promise<StudioStatusView[]> {
    const { pixel, chiptune, flow, config } = await this.studios()
    const probe = async (id: StudioId, client: PixelClient | ChiptuneClient): Promise<StudioStatusView> => {
      const base = { id, name: STUDIO_NAMES[id], url: client.url || studioUrl(config, id), repo: studioRepo(config, id), hint: startHint(config, id) }
      try {
        const tools = await client.listTools()
        return { ...base, ok: true, error: '', tools: tools.length }
      } catch (e) {
        return { ...base, ok: false, error: (e as Error).message, tools: 0 }
      }
    }
    const probeFlow = async (): Promise<StudioStatusView> => {
      const base = { id: 'flow' as const, name: 'flow-music-mcp (Google Flow)', url: flow.url || config.flowUrl, repo: config.flowRepo, hint: flowStartHint(config) }
      try {
        const st = await flow.status()
        if (!st.up) return { ...base, ok: false, error: st.hint ?? base.hint, tools: 0 }
        if (st.signedIn === false) return { ...base, ok: false, error: st.hint ?? 'Google Flow is not signed in', tools: 0 }
        return { ...base, ok: true, error: '', tools: 0 }
      } catch (e) {
        return { ...base, ok: false, error: (e as Error).message, tools: 0 }
      }
    }
    return Promise.all([probe('pixel', pixel), probe('chiptune', chiptune), probeFlow()])
  }

  async comfyStatus(): Promise<Extract<EngineEvent, { type: 'comfy.status' }>> {
    const config = await loadComfyConfigFor(this.dataDir)
    const inv = await buildInventory(config, { workflowDirs: dataFolders(this.dataDir).workflows })
    return { type: 'comfy.status', ok: inv.ok, lanes: inv.lanes, engines: inv.engines, customWorkflows: inv.customWorkflows, backgroundRemoval: inv.backgroundRemoval }
  }

  async comfyFree() {
    return freeAllLanes(await loadComfyConfigFor(this.dataDir))
  }

  async listEngines(): Promise<{ image: EngineInfo[]; audio: EngineInfo[]; palettes: string[] }> {
    const all: EngineInfo[] = Object.entries(ENGINES).map(([id, e]) => ({
      id,
      kind: e.kind,
      label: e.label,
      edit: !!e.acceptsReferences,
      task: e.task ?? 'music',
      languages: e.languages ?? []
    }))
    return { image: all.filter((e) => e.kind === 'image'), audio: all.filter((e) => e.kind === 'audio'), palettes: await listPalettes(dataFolders(this.dataDir).palettes) }
  }

  async customWorkflows(): Promise<CustomWorkflowInfo[]> {
    const dirs = dataFolders(this.dataDir).workflows
    const out: CustomWorkflowInfo[] = []
    for (const name of await listCustomWorkflows(dirs)) {
      try {
        const wf = await loadCustomWorkflow(dirs, name)
        out.push({ name, kind: workflowKind(wf.graph, wf.mapping), languages: Object.keys(wf.mapping.languages ?? {}) })
      } catch (e) {
        this.log(`workflow ${name}: ${(e as Error).message}`)
      }
    }
    return out
  }

  /**
   * The local voice engines (the TTS Audio Suite) and the custom TTS workflows, with their readiness. Never throws: an unreachable
   * ComfyUI is `ok: false` with the lane errors.
   */
  async voiceStatus(): Promise<Extract<EngineEvent, { type: 'voice.status' }>> {
    const defaultEngine = DEFAULT_VOICE_ENGINE
    let comfyUrl = ''
    try {
      const config = await loadComfyConfigFor(this.dataDir)
      comfyUrl = lanesOf(config)[0] ?? ''
      const inv = await buildInventory(config, { workflowDirs: dataFolders(this.dataDir).workflows })
      const reports = new Map(inv.engines.map((r) => [r.id, r]))
      const engines = Object.entries(ENGINES)
        .filter(([, e]) => e.task === 'tts' || e.task === 'sfx')
        .map(([id, e]) => {
          const report = reports.get(id)
          return {
            id,
            label: e.label,
            task: e.task ?? 'music',
            languages: e.languages ?? [],
            ready: report?.ready ?? false,
            missing: report?.missing ?? []
          }
        })
      const workflows = (await this.customWorkflows()).filter((w) => w.kind === 'audio' && w.languages.length > 0).map((w) => ({ name: w.name, languages: w.languages }))
      const error = inv.ok ? '' : `ComfyUI is not reachable (${inv.lanes.map((l) => `${l.url}: ${l.error || 'no answer'}`).join('; ')}): start it, or set a lane in config/comfy.md`
      return { type: 'voice.status', ok: inv.ok, error, comfyUrl, defaultEngine, engines, workflows }
    } catch (e) {
      const error = `the local voice engines could not be checked: ${(e as Error).message}`
      return { type: 'voice.status', ok: false, error, comfyUrl, defaultEngine, engines: [], workflows: [] }
    }
  }

  /** The UI commands about courses and generators: each answers with its event. */
  async handle(cmd: EduCommand): Promise<void> {
    switch (cmd.type) {
      case 'listCourses':
        this.emit({ type: 'courses.listed', courses: await this.listCourses() })
        return
      case 'comfyStatus':
        this.emit(await this.comfyStatus().catch((e: Error) => ({ type: 'command.error' as const, command: 'comfyStatus', message: e.message })))
        return
      case 'comfyFree':
        this.emit({ type: 'comfy.freed', results: await this.comfyFree() })
        return
      case 'listEngines':
        this.emit({ type: 'engines.listed', ...(await this.listEngines()) })
        return
      case 'listCustomWorkflows':
        this.emit({ type: 'workflows.listed', workflows: await this.customWorkflows() })
        return
      case 'voiceStatus':
        this.emit(await this.voiceStatus())
        return
      case 'studiosStatus':
        this.emit({ type: 'studios.status', studios: await this.studiosStatus() })
        return
      case 'getCourse':
      case 'buildCourse':
      case 'lintCourse':
      case 'updateItem':
        await handleStudioCommand(this, cmd) // the Course page's commands (EGS-05), in studio-commands.ts
        return
    }
  }
}
