import { describe, expect, it } from 'vitest'
import type { EngineEvent } from '../src/shared/protocol'
import { initialCourses, reduceCourses, type CoursesData } from '../src/renderer/store/courses'
import { eduStore, PAGES, reduceEvent } from '../src/renderer/store/store'

const apply = (s: CoursesData, ...events: EngineEvent[]): CoursesData => events.reduce((acc, e) => ({ ...acc, ...reduceCourses(acc, e, 1000) }), s)

describe('reduceCourses', () => {
  it('stores the course list and marks it loaded', () => {
    let s = initialCourses()
    expect(s.coursesLoaded).toBe(false)
    s = apply(s, { type: 'courses.listed', courses: [{ slug: 'rome', title: 'rome', updatedAt: 'a' }, { slug: 'solar-system', title: 'solar-system', updatedAt: 'b' }] })
    expect(s.courses.map((c) => c.slug)).toEqual(['rome', 'solar-system'])
    expect(s.coursesLoaded).toBe(true)
    s = apply(s, { type: 'courses.listed', courses: [] })
    expect(s.courses).toEqual([])
  })
  it('keeps the last 20 command errors with the time they came', () => {
    let s = initialCourses()
    for (let i = 0; i < 25; i++) s = apply(s, { type: 'command.error', command: 'c', message: `m${i}`, slug: 'a' })
    expect(s.errors).toHaveLength(20)
    expect(s.errors[0]).toMatchObject({ message: 'm5', at: 1000 })
    expect(s.errors[19]).toMatchObject({ message: 'm24', slug: 'a' })
  })
  it('ignores events that are not about courses', () => {
    expect(reduceCourses(initialCourses(), { type: 'pong', at: 'x' })).toEqual({})
  })
})

describe('the store', () => {
  it('has the skeleton pages and starts on the courses page', () => {
    expect(PAGES.map((p) => p.id)).toEqual(['courses', 'models', 'agents', 'settings'])
    expect(eduStore.getState().page).toBe('courses')
    expect(eduStore.getState().connected).toBe(false)
  })
  it('turns an engine.ready event and a courses.listed event into state', () => {
    eduStore.getState().applyEvents([
      { type: 'engine.ready', pid: 1, dataDir: 'D', at: 'x' },
      { type: 'courses.listed', courses: [{ slug: 'a', title: 'a', updatedAt: 'x' }] }
    ])
    const s = eduStore.getState()
    expect(s).toMatchObject({ connected: true, dataDir: 'D', coursesLoaded: true })
    expect(s.courses).toHaveLength(1)
  })
  it('reduceEvent keeps the last warnings', () => {
    const s = eduStore.getState()
    const next = reduceEvent(s, { type: 'engine.warning', message: 'careful' })
    expect(next.warnings?.[next.warnings.length - 1]).toBe('careful')
  })
})
