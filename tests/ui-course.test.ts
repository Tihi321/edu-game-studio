import { describe, expect, it } from 'vitest'
import type { CourseLoadedView, EngineEvent } from '../src/shared/protocol'
import { emptyDoc, initialCourseDocs, reduceCourseDocs, type CourseDocsData } from '../src/renderer/store/course'
import { eduStore } from '../src/renderer/store/store'

const apply = (s: CourseDocsData, ...events: EngineEvent[]): CourseDocsData => events.reduce((acc, e) => ({ ...acc, ...reduceCourseDocs(acc, e) }), s)
const view = (slug: string): CourseLoadedView => ({ slug, pack: { slug } as never, text: {}, stats: { units: 1, objectives: 1, items: 0, byKind: {} }, build: { built: false } })

describe('reduceCourseDocs', () => {
  it('stores a loaded course and clears loading and error', () => {
    expect(initialCourseDocs()).toEqual({ docs: {} })
    let s: CourseDocsData = { docs: { a: { ...emptyDoc(), loading: true, error: 'old' } } }
    s = apply(s, { type: 'course.loaded', ...view('a') })
    expect(s.docs.a).toMatchObject({ loading: false, error: undefined })
    expect(s.docs.a?.data?.slug).toBe('a')
    expect(s.docs.a?.data).not.toHaveProperty('type')
  })
  it('turns a command.error of a course command into the error of that operation', () => {
    const err = (command: string): EngineEvent => ({ type: 'command.error', command, message: `${command} failed`, slug: 'a' })
    let s: CourseDocsData = { docs: { a: { ...emptyDoc(), loading: true, building: true, linting: true, saving: true } } }
    s = apply(s, err('getCourse'), err('buildCourse'), err('lintCourse'), err('updateItem'))
    expect(s.docs.a).toMatchObject({ loading: false, error: 'getCourse failed', building: false, buildError: 'buildCourse failed', linting: false, lintError: 'lintCourse failed', saving: false, saveError: 'updateItem failed' })
  })
})

describe('the store: navigation', () => {
  it('opens a course on a tab, and the Library item goes back to the list', () => {
    const st = eduStore.getState()
    st.showCourse('solar-system', 'items')
    expect(eduStore.getState()).toMatchObject({ page: 'courses', openCourse: 'solar-system', courseTab: 'items' })
    st.setCourseTab('build')
    expect(eduStore.getState().courseTab).toBe('build')
    st.setPage('models')
    expect(eduStore.getState().openCourse).toBe('solar-system')
    st.setPage('courses')
    expect(eduStore.getState().openCourse).toBeNull()
  })
})
