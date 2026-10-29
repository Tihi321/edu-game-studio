import type { CourseSummaryView, EngineEvent } from '../../shared/protocol'

export interface CommandErrorView {
  command: string
  message: string
  slug?: string
  at: number
}

/** The course part of the UI state: what the engine answered about the courses, and the recent command errors. */
export interface CoursesData {
  /** The courses in the data folder, once the engine answered `listCourses`. */
  courses: CourseSummaryView[]
  coursesLoaded: boolean
  /** The last 20 command errors. */
  errors: CommandErrorView[]
}

export function initialCourses(): CoursesData {
  return { courses: [], coursesLoaded: false, errors: [] }
}

/** Pure reducer for the course events. Returns only what changed. */
export function reduceCourses(s: CoursesData, e: EngineEvent, now = Date.now()): Partial<CoursesData> {
  switch (e.type) {
    case 'courses.listed':
      return { courses: e.courses, coursesLoaded: true }
    case 'command.error':
      return { errors: [...s.errors.slice(-19), { command: e.command, message: e.message, slug: e.slug, at: now }] }
    default:
      return {}
  }
}
