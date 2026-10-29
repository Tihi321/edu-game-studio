import { describe, expect, it } from 'vitest'
import type { CourseLoadedView, EngineEvent } from '../src/shared/protocol'
import { emptyDoc, initialCourseDocs, reduceCourseDocs, type CourseDocsData } from '../src/renderer/store/course'
import { initialGenerators, reduceGenerators } from '../src/renderer/store/generators'
import { COURSE_TABS, eduStore } from '../src/renderer/store/store'
import { initialPipeline, PIPELINE_TICKETS } from '../src/renderer/store/pipeline'

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
  it('keeps the build and lint reports and ends the waiting', () => {
    let s: CourseDocsData = { docs: { a: { ...emptyDoc(), building: true, linting: true } } }
    s = apply(
      s,
      { type: 'course.built', slug: 'a', ok: false, forced: false, problems: [{ code: 'SCHEMA', path: 'items[0]', message: 'm' }], files: 0, at: 't' },
      { type: 'course.linted', slug: 'a', ok: true, errors: 0, warnings: 2, problems: [], built: true, at: 't' }
    )
    expect(s.docs.a).toMatchObject({ building: false, linting: false })
    expect(s.docs.a?.build?.problems[0]?.code).toBe('SCHEMA')
    expect(s.docs.a?.lint).toMatchObject({ ok: true, warnings: 2, built: true })
  })
  it('records a saved item', () => {
    const s = apply({ docs: { a: { ...emptyDoc(), saving: true, saveError: 'x' } } }, { type: 'item.updated', slug: 'a', id: 'q1', pendingCount: 1, pending: [{ code: 'MISSING_TEXT', path: 'items[0]', message: 'm' }], at: 't' })
    expect(s.docs.a).toMatchObject({ saving: false, saveError: undefined, saved: { id: 'q1', pendingCount: 1 } })
  })
  it('turns a command.error of a course command into the error of that operation', () => {
    const err = (command: string): EngineEvent => ({ type: 'command.error', command, message: `${command} failed`, slug: 'a' })
    let s: CourseDocsData = { docs: { a: { ...emptyDoc(), loading: true, building: true, linting: true, saving: true } } }
    s = apply(s, err('getCourse'), err('buildCourse'), err('lintCourse'), err('updateItem'))
    expect(s.docs.a).toMatchObject({ loading: false, error: 'getCourse failed', building: false, buildError: 'buildCourse failed', linting: false, lintError: 'lintCourse failed', saving: false, saveError: 'updateItem failed' })
  })
  it('ignores errors of other commands and errors without a course', () => {
    const s = initialCourseDocs()
    expect(reduceCourseDocs(s, { type: 'command.error', command: 'comfyStatus', message: 'm', slug: 'a' })).toEqual({})
    expect(reduceCourseDocs(s, { type: 'command.error', command: 'getCourse', message: 'm' })).toEqual({})
    expect(reduceCourseDocs(s, { type: 'pong', at: 'x' })).toEqual({})
  })
})

describe('reduceGenerators', () => {
  it('keeps each answer and ends the matching check', () => {
    let s = { ...initialGenerators(), checking: { comfy: true, voice: true, studios: true } }
    const studios = [{ id: 'pixel' as const, name: 'Pixel Studio', ok: true, error: '', url: 'u', repo: 'r', hint: 'h', tools: 3 }]
    s = { ...s, ...reduceGenerators(s, { type: 'studios.status', studios }) }
    expect(s.studios).toHaveLength(1)
    expect(s.checking).toEqual({ comfy: true, voice: true, studios: false })
    s = { ...s, ...reduceGenerators(s, { type: 'command.error', command: 'voiceStatus', message: 'm' }) }
    expect(s.checking.voice).toBe(false)
    s = { ...s, ...reduceGenerators(s, { type: 'comfy.freed', results: [{ lane: 'l', ok: true }] }) }
    expect(s.freed).toEqual([{ lane: 'l', ok: true }])
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
  it('lists the ten course tabs in the order the course is made', () => {
    expect(COURSE_TABS.map((t) => t.id)).toEqual(['brief', 'curriculum', 'encyclopedia', 'items', 'game', 'assets', 'voice', 'editions', 'build', 'playtest'])
  })
  it('applies a course event through the store and marks waiting', () => {
    eduStore.getState().markCourse('z', { loading: true })
    expect(eduStore.getState().docs.z?.loading).toBe(true)
    eduStore.getState().applyEvents([{ type: 'course.loaded', ...view('z') }])
    expect(eduStore.getState().docs.z).toMatchObject({ loading: false })
  })
})

describe('the pipeline slots', () => {
  it('start empty and name the ticket that fills them', () => {
    expect(initialPipeline()).toEqual({ briefs: {}, research: {}, curriculumNotes: {}, playtests: {} })
    expect(Object.values(PIPELINE_TICKETS).every((t) => /^EGS-0[6-8]$/.test(t))).toBe(true)
  })
})
