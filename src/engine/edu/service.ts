import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CustomWorkflowInfo, EduCommand, EngineEvent, EngineInfo, StudioStatusView } from '../../shared/protocol'
import { DEFAULT_VOICE_ENGINE } from '../../shared/media'
import type { SettingsConfig } from '../../shared/schemas'
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
import type { ServiceStarter } from '../studios/autostart'
import { chiptuneClientFor, flowClientFor, flowStartHint, loadStudiosConfig, pixelClientFor, startHint, studioRepo, studioUrl, STUDIO_NAMES } from '../studios/config'
import type { StudioId, StudiosConfig } from '../studios/config'
import { findAppDirs } from './appdirs'
import type { AppDirs } from './appdirs'
import { assertSlug, coursesDir, dataFolders, loadComfyConfigFor } from './paths'
import { CourseStore, listCourses } from './store'
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
  /** Wakes the scheduler after jobs were enqueued. */
  kick?: () => void
  /** Aborts running jobs of a course in the scheduler and returns how many were aborted. */
  stopBook?: (slug: string, reason?: 'stopped' | 'stop') => number
  /** Generator clients (tests pass fakes). Default: made from `config/*.md` where a ticket needs them. */
  comfy?: ComfyClient | (() => ComfyClient | Promise<ComfyClient>)
  pixel?: PixelClient
  chiptune?: ChiptuneClient
  flow?: FlowClient
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

  constructor(readonly deps: EduDeps) {
    this.dirs = { ...findAppDirs(), ...(deps.dirs ?? {}) }
    this.comfyOverride = deps.comfy
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

  /** The model a course sets for a role (in its `course.md`), over the role's own list. None until the course store exists. */
  courseModel(_slug: string, _role: string): string | undefined {
    return undefined
  }

  /** Prepares what must be there before the first job runs. */
  async warm(): Promise<void> {
    await fs.mkdir(coursesDir(this.dataDir), { recursive: true })
  }

  /** Stops what the service keeps running (the file watchers of the studio round trips, later). */
  dispose(): void {
    // nothing yet
  }

  /** The courses in `<data>/courses/`: a folder with a `course.md` or a `course/pack.json`. */
  listCourses(): Promise<CourseSummary[]> {
    return listCourses(this.dataDir)
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
    }
  }
}
