import { describe, expect, it } from 'vitest'
import { courseTheme, courseTitle, pipelineStages, studioLang, textCoverage, usedTextKeys } from '../src/renderer/lib/course'
import { layoutUnits } from '../src/renderer/lib/graph'
import { buildSave, draftCatalogs, hasEdits, holderLang, itemTextFields, labelForPath, moved, noEdits, splitLines, toggleIn, withField } from '../src/renderer/lib/items'
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
  it('reports a cycle and an unknown prerequisite but still places every unit', () => {
    const g = layoutUnits([{ id: 'x', requires: ['y'] }, { id: 'y', requires: ['x'] }, { id: 'z', requires: ['nope'] }])
    expect(g.cycle).toEqual(['x', 'y', 'x'])
    expect(g.unknown).toEqual(['nope'])
    expect(g.nodes).toHaveLength(3)
    expect(g.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true)
  })
  it('lays out the golden fixture as a chain', async () => {
    const v = await view('solar-system')
    const g = layoutUnits(v.pack.units)
    expect(g.nodes.map((n) => n.layer)).toEqual([0, 1, 2])
    expect(g.width).toBeGreaterThan(g.height)
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
  it('derives the pipeline stages from what the course has', async () => {
    const v = await view('solar-system')
    const stages = pipelineStages(v, undefined)
    expect(stages.map((s) => s.id)).toEqual(['curriculum', 'articles', 'items', 'build', 'check', 'playtest'])
    const by = Object.fromEntries(stages.map((s) => [s.id, s.state]))
    expect(by).toMatchObject({ curriculum: 'done', articles: 'done', items: 'done', build: 'todo', check: 'todo', playtest: 'todo' })
    const built = pipelineStages({ ...v, build: { built: true, stale: false } }, { lint: { ok: true, errors: 0, warnings: 0, problems: [], built: false, at: 't' } }, 2)
    expect(Object.fromEntries(built.map((s) => [s.id, s.state]))).toMatchObject({ build: 'done', check: 'done', playtest: 'done' })
    expect(pipelineStages({ ...v, build: { built: true, stale: true } }, undefined).find((s) => s.id === 'build')?.state).toBe('partial')
    expect(pipelineStages(undefined, undefined).every((s) => s.state === 'todo')).toBe(true)
  })
  it('sees a new course (one scaffold unit, no items) as started, not done', async () => {
    const v = await view('solar-system')
    const pack = { ...v.pack, units: v.pack.units.slice(0, 1), items: [], encyclopedia: { articles: [] } }
    const by = Object.fromEntries(pipelineStages({ ...v, pack }, undefined).map((s) => [s.id, s.state]))
    expect(by).toMatchObject({ curriculum: 'partial', articles: 'todo', items: 'todo' })
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
  it('counts a missing text per edition and lists where it is used', async () => {
    const v = await view('solar-system')
    const en = v.text.en
    expect(en).toBeDefined()
    const strings = { ...(en?.strings ?? {}) }
    delete strings['q-order-mcq.prompt']
    const cov = textCoverage(v.pack, { ...v.text, en: { ...(en as NonNullable<typeof en>), strings } })
    const c = cov.find((x) => x.lang === 'en')
    expect(c?.missingCount).toBe(1)
    expect(c?.missing[0]).toEqual({ key: 'q-order-mcq.prompt', where: 'item q-order-mcq prompt' })
    expect(cov.find((x) => x.lang === 'hr')?.missingCount).toBe(0)
  })
  it('treats the target language of a language course as its own role', async () => {
    const v = await view('hr-a1-greetings')
    const cov = textCoverage(v.pack, v.text)
    expect(cov.map((c) => `${c.lang}:${c.role}`)).toEqual(['en:edition', 'hr:target'])
    expect(cov[1]?.needed).toBeGreaterThan(0)
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
  it('gives a typed answer as accepted lines, one per line', async () => {
    const v = await view('solar-system')
    const typed = v.pack.items.find((i) => i.kind === 'typed')!
    const f = itemTextFields(typed, v.pack, v.text, 'en').find((x) => x.role === 'accepted')!
    expect(f.value.split('\n').length).toBeGreaterThanOrEqual(1)
    expect(splitLines(' a \n\n b\r\nc ')).toEqual(['a', 'b', 'c'])
  })
  it('writes a text where it lives: the edition, or the target language for the taught phrases', async () => {
    const v = await view('hr-a1-greetings')
    const typed = v.pack.items.find((i) => i.kind === 'typed')!
    const accepted = itemTextFields(typed, v.pack, v.text, 'en').find((x) => x.role === 'accepted')!
    expect(holderLang(accepted.key, 'en', v.pack, v.text)).toBe('hr')
    expect(holderLang('brand.new.key', 'en', v.pack, v.text)).toBe('en')
  })
  it('builds a save with only what changed', async () => {
    const v = await view('solar-system')
    const item = v.pack.items.find((i) => i.id === 'q-order-mcq')!
    expect(buildSave(item, item, noEdits(), v.pack, v.text, 'en')).toBeNull()
    const draft = withField(withField(item, 'answer', 'venus'), 'difficulty', 5)
    const plan = buildSave(item, draft, { strings: { 'q-order-mcq.prompt': 'New?' }, accepted: {} }, v.pack, v.text, 'en')
    expect(plan?.patch).toEqual({ answer: 'venus', difficulty: 5 })
    expect(plan?.text).toEqual({ en: { strings: { 'q-order-mcq.prompt': 'New?' } } })
    expect(hasEdits(noEdits())).toBe(false)
    expect(buildSave(item, item, { strings: {}, accepted: { x: '  \n ' } }, v.pack, v.text, 'en')).toBeNull()
  })
  it('shows draft texts in the preview catalogs without touching the originals', async () => {
    const v = await view('solar-system')
    const out = draftCatalogs(v.text, v.pack, 'en', { strings: { 'q-order-mcq.prompt': 'Draft?' }, accepted: {} })
    expect(out.en?.strings['q-order-mcq.prompt']).toBe('Draft?')
    expect(v.text.en?.strings['q-order-mcq.prompt']).toBe('Which planet is closest to the Sun?')
  })
  it('moves and toggles', () => {
    expect(moved(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moved(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moved(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
    expect(toggleIn(['b'], 'a', true, ['a', 'b', 'c'])).toEqual(['a', 'b'])
    expect(toggleIn(['a', 'b'], 'a', false, ['a', 'b', 'c'])).toEqual(['b'])
  })
})
