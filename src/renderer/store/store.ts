import { createStore } from 'zustand/vanilla'
import { initialMcp, reduceMcp, type McpData } from './mcp'
import { initialCourses, reduceCourses, type CoursesData } from './courses'
import { initialCourseDocs, emptyDoc, reduceCourseDocs, type CourseDoc, type CourseDocsData } from './course'
import { initialGenerators, reduceGenerators, type GeneratorsData } from './generators'
import { initialPipeline, type PipelineData } from './pipeline'
import { applyScheme, readScheme, type Scheme } from '../lib/scheme'
import type { AgentProblem, AgentState, AgentSummary, CatalogModel, EngineEvent, ModelSummary, ProviderSummary, ServerStatus, SettingsSummary } from '../../shared/protocol'

export type Page = 'courses' | 'models' | 'agents' | 'generators' | 'settings'

export const PAGES: { id: Page; label: string }[] = [
  { id: 'courses', label: 'Library' },
  { id: 'models', label: 'Models' },
  { id: 'agents', label: 'Agents' },
  { id: 'generators', label: 'Generators' },
  { id: 'settings', label: 'Settings' }
]

/** The tabs of the Course page, in the order the course is made. */
export const COURSE_TABS = [
  { id: 'brief', label: 'Brief' },
  { id: 'curriculum', label: 'Curriculum' },
  { id: 'encyclopedia', label: 'Encyclopedia' },
  { id: 'items', label: 'Items' },
  { id: 'game', label: 'Game' },
  { id: 'assets', label: 'Assets' },
  { id: 'voice', label: 'Voice' },
  { id: 'editions', label: 'Editions' },
  { id: 'build', label: 'Build' },
  { id: 'playtest', label: 'Playtest' }
] as const
export type CourseTab = (typeof COURSE_TABS)[number]['id']

export interface AgentView {
  id: string
  name: string
  role: string
  /** The agent's own override (`provider/model`), or null. */
  override: string | null
  /** The model it calls now or will call next. */
  model: string | null
  state: AgentState
  paused: boolean
  task?: string
  /** The course of the job it works on. */
  book?: string
  jobId?: string
  problem?: AgentProblem
}

export interface EduState extends CoursesData, McpData, CourseDocsData, GeneratorsData, PipelineData {
  connected: boolean
  dataDir: string
  paused: boolean
  warnings: string[]
  agents: Record<string, AgentView>
  agentOrder: string[]
  spend: { today: number; month: number; dailyCap: number; monthlyCap: number }
  /** Every model the engine knows, from the snapshot. The pickers offer the `shown` ones. */
  models: ModelSummary[]
  providers: ProviderSummary[]
  /** What each provider listed on the Models page (`detectModels`), or why it couldn't. `loading` until it answers. */
  catalogs: Record<string, { models: CatalogModel[]; error?: string; at?: string; loading?: boolean }>
  roleDefaults: Record<string, string>
  /** The local model servers (Strata, LM Studio): running or not. */
  servers: ServerStatus[]
  settings: SettingsSummary | null
  secretsSet: string[]
  /** Every key variable the Settings key select offers (from the providers). */
  keyNames: string[]
  /** The last answer to `testCustomProvider` in the Add provider form: `pending` until it comes. */
  providerTest: { pending?: boolean; ok?: boolean; count?: number; error?: string } | null
  /** The last answer to `saveCustomProvider` / `removeCustomProvider`: `at` changes with every answer. */
  providerSaved: { ok: boolean; id?: string; removed?: boolean; error?: string; at: number } | null
  page: Page
  /** The course open on the Library page (its slug), or null for the list. */
  openCourse: string | null
  courseTab: CourseTab
  scheme: Scheme
}

export interface EduActions {
  applyEvents(events: EngineEvent[]): void
  setPage(page: Page): void
  /** Opens a course on the Library page, on a tab. */
  showCourse(slug: string, tab?: CourseTab): void
  setCourseTab(tab: CourseTab): void
  setScheme(scheme: Scheme): void
  /** Changes what the studio waits for on a course (`loading`, `building` ...): set when a command is sent, cleared by its answer. */
  markCourse(slug: string, patch: Partial<CourseDoc>): void
  /** A generator check was sent: show it as running until its answer comes. */
  markChecking(which: keyof GeneratorsData['checking']): void
  /** The Models page asked a provider for its models: show it as loading until `models.catalog` comes. */
  markCatalogLoading(provider: string): void
  /** The Add provider form pressed Test: show it as pending until `provider.tested` comes. `null` clears the result. */
  markProviderTesting(pending: boolean): void
}

export type EduStore = EduState & EduActions

function initial(): EduState {
  return {
    connected: false,
    dataDir: '',
    paused: false,
    warnings: [],
    agents: {},
    agentOrder: [],
    spend: { today: 0, month: 0, dailyCap: 0, monthlyCap: 0 },
    models: [],
    providers: [],
    catalogs: {},
    roleDefaults: {},
    servers: [],
    settings: null,
    secretsSet: [],
    keyNames: [],
    providerTest: null,
    providerSaved: null,
    page: 'courses',
    openCourse: null,
    courseTab: 'brief',
    scheme: readScheme(),
    ...initialCourses(),
    ...initialMcp(),
    ...initialCourseDocs(),
    ...initialGenerators(),
    ...initialPipeline()
  }
}

function agentFromSummary(a: AgentSummary): AgentView {
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    override: a.model,
    model: a.resolvedModel ?? a.model,
    state: a.paused ? 'paused' : a.state,
    paused: a.paused,
    task: a.task,
    book: a.book,
    jobId: a.jobId,
    problem: a.problem
  }
}

export function reduceEvent(s: EduState, e: EngineEvent): Partial<EduState> {
  switch (e.type) {
    case 'engine.ready':
      return { connected: true, dataDir: e.dataDir }
    case 'engine.heartbeat':
      return { connected: true }
    case 'engine.warning':
      return { warnings: [...s.warnings.slice(-19), e.message] }
    case 'snapshot': {
      const agents: Record<string, AgentView> = {}
      for (const a of e.agents) agents[a.id] = agentFromSummary(a)
      return {
        connected: true,
        dataDir: e.dataDir,
        paused: e.paused,
        agents,
        agentOrder: e.agents.map((a) => a.id),
        spend: e.spend,
        models: e.models,
        providers: e.providers ?? [],
        roleDefaults: e.roleDefaults,
        servers: e.servers ?? [],
        settings: e.settings,
        secretsSet: e.secretsSet,
        keyNames: e.keyNames ?? s.keyNames
      }
    }
    case 'agent.hired':
    case 'agent.updated': {
      const had = !!s.agents[e.agent.id]
      return { agents: { ...s.agents, [e.agent.id]: agentFromSummary(e.agent) }, agentOrder: had ? s.agentOrder : [...s.agentOrder, e.agent.id] }
    }
    case 'agent.removed': {
      const { [e.agent]: _gone, ...rest } = s.agents
      return { agents: rest, agentOrder: s.agentOrder.filter((id) => id !== e.agent) }
    }
    case 'agent.state': {
      const prev = s.agents[e.agent]
      if (!prev) return {}
      return { agents: { ...s.agents, [e.agent]: { ...prev, state: e.state, task: e.task, book: e.book, jobId: e.jobId } } }
    }
    case 'agent.problem': {
      const prev = s.agents[e.agent]
      return prev ? { agents: { ...s.agents, [e.agent]: { ...prev, problem: e.problem ?? undefined } } } : {}
    }
    case 'factory.paused':
      return { paused: e.paused }
    case 'servers':
      return { servers: e.servers }
    case 'secrets.updated':
      return { secretsSet: e.secretsSet, keyNames: e.keyNames ?? s.keyNames }
    case 'provider.tested':
      return { providerTest: { ok: e.ok, count: e.count, error: e.error } }
    case 'provider.saved':
      return { providerSaved: { ok: e.ok, id: e.id, removed: e.removed, error: e.error, at: Date.now() } }
    case 'models.catalog':
      return { catalogs: { ...s.catalogs, [e.provider]: { models: e.models, error: e.error, at: e.at } } }
    case 'mcp.status':
      return reduceMcp(s, e)
    default:
      return { ...reduceCourses(s, e), ...reduceCourseDocs(s, e), ...reduceGenerators(s, e) }
  }
}

const ACTION_KEYS = ['applyEvents', 'setPage', 'showCourse', 'setCourseTab', 'setScheme', 'markCourse', 'markChecking', 'markCatalogLoading', 'markProviderTesting'] as const

export const eduStore = createStore<EduStore>()((set, get) => ({
  ...initial(),
  applyEvents(events) {
    if (!events.length) return
    let next: EduState = get()
    for (const e of events) next = { ...next, ...reduceEvent(next, e) }
    const state: Record<string, unknown> = { ...next }
    for (const k of ACTION_KEYS) delete state[k]
    set(state as unknown as EduState)
  },
  setPage(page) {
    // the Library item always goes back to the list of courses
    set(page === 'courses' ? { page, openCourse: null } : { page })
  },
  showCourse(slug, tab = 'brief') {
    set({ page: 'courses', openCourse: slug, courseTab: tab })
  },
  setCourseTab(tab) {
    set({ courseTab: tab })
  },
  setScheme(scheme) {
    applyScheme(scheme)
    set({ scheme })
  },
  markCourse(slug, patch) {
    const docs = get().docs
    set({ docs: { ...docs, [slug]: { ...(docs[slug] ?? emptyDoc()), ...patch } } })
  },
  markChecking(which) {
    set({ checking: { ...get().checking, [which]: true } })
  },
  markProviderTesting(pending) {
    set({ providerTest: pending ? { pending: true } : null })
  },
  markCatalogLoading(provider) {
    const cur = get().catalogs[provider] ?? { models: [] }
    set({ catalogs: { ...get().catalogs, [provider]: { ...cur, loading: true, error: undefined } } })
  }
}))
