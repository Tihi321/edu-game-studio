import type { CourseLoadedView, EngineEvent, LintProblemView, ProblemView } from '../../shared/protocol'

/** The result of the last build of a course, as `course.built` reported it. */
export interface BuildReport {
  ok: boolean
  forced: boolean
  problems: ProblemView[]
  files: number
  at: string
}

/** The result of the last lint of a course, as `course.linted` reported it. */
export interface LintReport {
  ok: boolean
  errors: number
  warnings: number
  problems: LintProblemView[]
  built: boolean
  stale?: boolean
  at: string
}

/** What the studio knows about one course and what it is waiting for. */
export interface CourseDoc {
  /** `getCourse` is on its way. */
  loading: boolean
  /** Why the course could not be read (a missing folder, a pack that does not match the contract). */
  error?: string
  data?: CourseLoadedView
  building: boolean
  build?: BuildReport
  buildError?: string
  linting: boolean
  lint?: LintReport
  lintError?: string
  /** An item save is on its way. */
  saving: boolean
  saved?: { id: string; pendingCount: number; pending: ProblemView[]; at: string }
  saveError?: string
}

export interface CourseDocsData {
  /** Every course the studio asked for, by slug. */
  docs: Record<string, CourseDoc>
}

export const emptyDoc = (): CourseDoc => ({ loading: false, building: false, linting: false, saving: false })

export const initialCourseDocs = (): CourseDocsData => ({ docs: {} })

const COURSE_COMMANDS = new Set(['getCourse', 'buildCourse', 'lintCourse', 'updateItem'])

/** Pure reducer for the events about one course. Returns only what changed. */
export function reduceCourseDocs(s: CourseDocsData, e: EngineEvent): Partial<CourseDocsData> {
  const put = (slug: string, patch: Partial<CourseDoc>): Partial<CourseDocsData> => ({ docs: { ...s.docs, [slug]: { ...(s.docs[slug] ?? emptyDoc()), ...patch } } })
  switch (e.type) {
    case 'course.loaded': {
      const { type: _type, ...data } = e
      return put(e.slug, { data, loading: false, error: undefined })
    }
    case 'course.built':
      return put(e.slug, { building: false, buildError: undefined, build: { ok: e.ok, forced: e.forced, problems: e.problems, files: e.files, at: e.at } })
    case 'course.linted':
      return put(e.slug, { linting: false, lintError: undefined, lint: { ok: e.ok, errors: e.errors, warnings: e.warnings, problems: e.problems, built: e.built, stale: e.stale, at: e.at } })
    case 'item.updated':
      return put(e.slug, { saving: false, saveError: undefined, saved: { id: e.id, pendingCount: e.pendingCount, pending: e.pending, at: e.at } })
    case 'command.error': {
      if (!e.slug || !COURSE_COMMANDS.has(e.command)) return {}
      if (e.command === 'getCourse') return put(e.slug, { loading: false, error: e.message })
      if (e.command === 'buildCourse') return put(e.slug, { building: false, buildError: e.message })
      if (e.command === 'lintCourse') return put(e.slug, { linting: false, lintError: e.message })
      return put(e.slug, { saving: false, saveError: e.message })
    }
    default:
      return {}
  }
}
