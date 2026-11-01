import { describe, expect, it } from 'vitest'
import { courseTheme, courseTitle, studioLang, textCoverage, usedTextKeys } from '../src/renderer/lib/course'
import { layoutUnits } from '../src/renderer/lib/graph'
import { itemTextFields, labelForPath } from '../src/renderer/lib/items'
import type { CourseLoadedView } from '../src/shared/protocol'
import { loadFixture } from './edu-fixtures'

const view = async (name: 'solar-system' | 'hr-a1-greetings'): Promise<CourseLoadedView> => {
  const f = await loadFixture(name)
  return { slug: name, pack: f.pack, text: f.catalogs, stats: { units: f.pack.units.length, objectives: f.pack.objectives.length, items: f.pack.items.length, byKind: {} }, build: { built: false } }
}

describe('layoutUnits', () => {
  it('puts a unit one layer to the right of its deepest prerequisite and draws an edge for each requirement', () => {
    const g = layoutUnits([{ id: 'a', requires: [] }, { id: 'b', requires: ['a'] }, { id: 'c', requires: ['a', 'b'] }, { id: 'd', requires: [] }])
    const layer = Object.fromEntries(g.nodes.map((n) => [n.id, n.layer]))
    expect(layer).toEqual({ a: 0, b: 1, c: 2, d: 0 })
    expect(g.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['a>b', 'a>c', 'b>c'])
    expect(g.nodes.find((n) => n.id === 'd')?.row).toBe(1)
    expect(g.cycle).toBeNull()
    expect(g.edges[0]?.path).toMatch(/^M [\d.]+ [\d.]+ C /)
  })
})

describe('course helpers', () => {
  it('reads the title from the catalog and the look from the shell', async () => {
    const v = await view('solar-system')
    expect(courseTitle(v)).toBe(v.text.en?.strings['course.title'] ?? v.pack.subject)
    expect(courseTheme(v.pack).id).toBe('chalkboard')
    const themed = { ...v.pack, shells: { enabled: ['quiz-arena'], config: { 'quiz-arena': { theme: 'castle' } } } }
    expect(courseTheme(themed).id).toBe('castle')
    expect(studioLang(v)).toBe('en')
  })
})

describe('text coverage', () => {
  it('finds every key the course uses once, and the golden fixtures are complete', async () => {
    for (const name of ['solar-system', 'hr-a1-greetings'] as const) {
      const v = await view(name)
      const keys = usedTextKeys(v.pack).map((k) => k.key)
      expect(new Set(keys).size).toBe(keys.length)
      for (const c of textCoverage(v.pack, v.text)) expect(c, `${name} ${c.lang}`).toMatchObject({ missingCount: 0, present: c.needed })
    }
  })
})

describe('the item editor model', () => {
  it('lists the texts of an item once each, with labels, in the edition', async () => {
    const v = await view('solar-system')
    const item = v.pack.items.find((i) => i.id === 'q-order-mcq')!
    const fields = itemTextFields(item, v.pack, v.text, 'en')
    expect(fields.map((f) => f.label)).toContain('Question')
    expect(fields.find((f) => f.key === 'q-order-mcq.prompt')?.value).toBe('Which planet is closest to the Sun?')
    expect(fields.find((f) => f.label === 'Why option 2 is wrong')?.role).toBe('string')
    expect(new Set(fields.map((f) => f.key)).size).toBe(fields.length)
    expect(labelForPath('gaps[0].answer')).toBe('Gap 1: accepted answers')
    expect(labelForPath('weird.path')).toBe('weird.path')
  })
})
