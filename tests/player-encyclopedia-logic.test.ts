import { describe, expect, it } from 'vitest'
import { makeTextResolver } from '../src/shared/edu'
import { encyclopediaSectionSchema, buildEncyclopedia, parseYear, answerInArticle, type EncyclopediaSection } from '../src/shared/shells/encyclopedia'
import { emptyData, readData } from '../src/player/shells/encyclopedia/data'
import { linkedIds, linkify, searchArticles, type ArticleText } from '../src/player/shells/encyclopedia/articles'
import { minMapWidth, nearestPinDistance } from '../src/player/shells/encyclopedia/places'
import { layoutTimeline } from '../src/player/shells/encyclopedia/timeline'
import type {  } from '../src/shared/course'
import { loadFixture } from './edu-fixtures'

/**
 * The encyclopedia explorer's pure logic (EGS-10), no DOM: the reading logic (paragraphs, cross-links, search), the timeline and map
 * geometry, the saved data, the model the player and the lint share (authored section and automatic layout, both editions), the section
 * schema and the answer-in-article check.
 */

describe('reading: paragraphs and cross-links', () => {
  it('links the first mention of every other article, longest title first, whole words, any case, never the article itself', () => {
    const others = [
      { id: 'sun', title: 'The Sun' },
      { id: 'planets', title: 'The Sun and the planets' },
      { id: 'moon', title: 'Moon' },
      { id: 'self', title: 'Self' }
    ]
    const segs = linkify(['The sun and the planets orbit. The Sun shines. A moonlit Moon, the moon again. Self.'], 'self', others)
    const linked = segs[0]!.filter((s) => s.link).map((s) => [s.link, s.text])
    // "The sun and the planets" wins over "The Sun" (longer), the later "The Sun" is not linked again, "moonlit" is not a whole-word match
    expect(linked).toEqual([
      ['planets', 'The sun and the planets'],
      ['moon', 'Moon']
    ])
    expect(linkedIds(segs)).toEqual(['planets', 'moon'])
    // every character of the paragraph is kept
    expect(segs[0]!.map((s) => s.text).join('')).toBe('The sun and the planets orbit. The Sun shines. A moonlit Moon, the moon again. Self.')
  })

})

describe('reading: search', () => {
  const arts: ArticleText[] = [
    { id: 'vienna', title: 'Beč', paragraphs: ['Beč is the capital of Austria. The Danube flows through it.'] },
    { id: 'budapest', title: 'Budimpešta', paragraphs: ['The Danube flows through Budapest, the capital of Hungary.'] },
    { id: 'prague', title: 'Prag', paragraphs: ['Prag lies on the Vltava.'] }
  ]

  it('finds a title by a prefix, ignoring case and accents; fewer than two letters finds nothing', () => {
    expect(searchArticles('bec', arts)[0]?.id).toBe('vienna')
    expect(searchArticles('BUDIM', arts)[0]?.id).toBe('budapest')
    expect(searchArticles('b', arts)).toEqual([])
    expect(searchArticles('   ', arts)).toEqual([])
    expect(searchArticles('zzqxj', arts)).toEqual([])
  })

})

describe('timeline geometry', () => {
  const years = [-432, 80, 1078, 1357, 1561, 1755, 1791, 1814, 1873, 1889, 1961, 1991]
  const events = years.map((y) => ({ id: `e${y}`, year: y }))

  it('puts every event true to scale on the ruler, in time order, inside the track', () => {
    const L = layoutTimeline([...events].reverse())
    expect(L.events.map((e) => e.year)).toEqual(years)
    for (let i = 1; i < L.events.length; i++) expect(L.events[i]!.tick).toBeGreaterThan(L.events[i - 1]!.tick)
    // equal year gaps map to equal pixel gaps
    const a = L.events.find((e) => e.year === 1873)!
    const b = L.events.find((e) => e.year === 1889)!
    const c = L.events.find((e) => e.year === 1961)!
    expect((c.tick - b.tick) / (c.year - b.year)).toBeCloseTo((b.tick - a.tick) / (b.year - a.year), 6)
    for (const e of L.events) {
      expect(e.x).toBeGreaterThanOrEqual(L.pad - 0.001)
      expect(e.x).toBeLessThanOrEqual(L.width - L.pad + 0.001)
    }
  })

  it('never lets two cards of a lane overlap, and alternates the lanes', () => {
    for (const n of [1, 2, 3, 5, 8, 12, 25]) {
      const L = layoutTimeline(Array.from({ length: n }, (_, i) => ({ id: `e${i}`, year: 1900 + (i % 4) * 3 })), { card: 150, gap: 12 })
      for (const lane of [0, 1] as const) {
        const row = L.events.filter((e) => e.lane === lane).sort((p, q) => p.x - q.x)
        for (let i = 1; i < row.length; i++) expect(row[i]!.x - row[i - 1]!.x, `n=${n} lane ${lane}`).toBeGreaterThanOrEqual(150 + 12 - 0.001)
        for (const e of row) {
          expect(e.x).toBeGreaterThanOrEqual(L.pad - 0.001)
          expect(e.x).toBeLessThanOrEqual(L.width - L.pad + 0.001)
        }
      }
      expect(Math.abs(L.events.filter((e) => e.lane === 0).length - L.events.filter((e) => e.lane === 1).length)).toBeLessThanOrEqual(1)
    }
  })

})

describe('map geometry', () => {
  const pins = [
    { id: 'a', x: 100, y: 100 },
    { id: 'b', x: 140, y: 100 },
    { id: 'c', x: 400, y: 300 }
  ]

  it('measures the nearest pins and widens the map so that they stay a tap apart', () => {
    expect(nearestPinDistance(pins)).toBe(40)
    expect(nearestPinDistance([pins[0]!])).toBe(Infinity)
    expect(minMapWidth(pins, 800, 34, 300)).toBe(Math.round((800 * 34) / 40))
    expect(minMapWidth([{ id: 'x', x: 0, y: 0 }, { id: 'y', x: 10, y: 0 }], 400, 34, 300)).toBe(400) // never wider than the image
    expect(minMapWidth([], 800)).toBe(300) // nothing to protect: the floor
    expect(minMapWidth([{ id: 'x', x: 1, y: 1 }, { id: 'y', x: 700, y: 500 }], 800)).toBe(300)
  })

})

describe('saved data', () => {
  it('drops unknown ids and garbage from an imported progress file', () => {
    const steps = new Set(['s1', 's2'])
    const arts = new Set(['a1'])
    expect(readData(null, steps, arts)).toEqual(emptyData())
    expect(readData('nope', steps, arts)).toEqual(emptyData())
    expect(readData({ found: ['s1', 'gone', 3, 's1'], read: ['a1', 'a9'] }, steps, arts)).toEqual({ found: ['s1'], read: ['a1'] })
    expect(readData({ found: 'x' }, steps, arts)).toEqual(emptyData())
  })

})

describe('the course side: years, phrases, the section schema', () => {
  it('reads a year from a date text, negative for BC', () => {
    expect(parseYear('1957')).toBe(1957)
    expect(parseYear('about 1078')).toBe(1078)
    expect(parseYear('AD 80')).toBe(80)
    expect(parseYear('432 BC')).toBe(-432)
    expect(parseYear('432. pr. Kr.')).toBe(-432)
    expect(parseYear('no date here')).toBeUndefined()
  })

})

describe.each(['solar-system', 'european-capitals'] as const)('the model of %s', (name) => {
  it('builds the authored layout in both editions: every reference is real and has a text', async () => {
    const f = await loadFixture(name)
    const section = f.pack.shells.config.encyclopedia as EncyclopediaSection
    expect(section.hunts.length).toBe(f.pack.units.length)
    for (const lang of f.pack.languages) {
      const text = makeTextResolver(f.catalogs, lang, f.pack.targetLang)
      const m = buildEncyclopedia(f.pack, encyclopediaSectionSchema.parse(section), text)
      expect(m.hunts.every((h) => !h.auto)).toBe(true)
      expect(m.timeline.length).toBeGreaterThanOrEqual(5)
      expect(m.timeline.map((e) => e.year)).toEqual([...m.timeline.map((e) => e.year)].sort((a, b) => a - b))
      const arts = new Set(m.articles.map((a) => a.id))
      const items = new Set(f.pack.items.map((i) => i.id))
      for (const h of m.hunts) {
        expect(h.steps.length, h.id).toBeGreaterThanOrEqual(3)
        expect(text.hasText(h.title as string), `${lang} ${h.id} title`).toBe(true)
        for (const s of h.steps) {
          expect(arts.has(s.article), s.id).toBe(true)
          expect(items.has(s.item), s.id).toBe(true)
          expect(text.hasText(s.clue as string), `${lang} ${s.id} clue`).toBe(true)
          expect(text.hasText(s.collectible as string), `${lang} ${s.id} name`).toBe(true)
        }
      }
      for (const e of m.timeline) {
        expect(text.hasText(e.label), `${lang} ${e.id}`).toBe(true)
        if (e.article) expect(arts.has(e.article)).toBe(true)
      }
      expect(m.map?.places.length).toBeGreaterThanOrEqual(8)
      for (const p of m.map!.places) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(m.map!.width)
        expect(p.y).toBeLessThanOrEqual(m.map!.height)
        expect(arts.has(p.article)).toBe(true)
      }
      expect(m.finalSteps.length).toBeGreaterThanOrEqual(f.pack.units.length)
    }
  })

  it('every hunt answer is on the page the clue leads to, in both editions', async () => {
    const f = await loadFixture(name)
    const section = encyclopediaSectionSchema.parse(f.pack.shells.config.encyclopedia)
    for (const lang of f.pack.languages) {
      const text = makeTextResolver(f.catalogs, lang, f.pack.targetLang)
      const m = buildEncyclopedia(f.pack, section, text)
      for (const h of m.hunts)
        for (const s of h.steps) {
          const item = f.pack.items.find((i) => i.id === s.item)!
          const art = m.articles.find((a) => a.id === s.article)!
          expect(answerInArticle(item, art, text), `${lang} ${s.id}`).not.toBe(false)
        }
    }
  })
})

describe('the automatic layout (no section)', () => {
  it('builds a hunt per unit from its articles, a timeline from the order items, a map without pins, in both editions', async () => {
    const f = await loadFixture('solar-system')
    for (const lang of f.pack.languages) {
      const text = makeTextResolver(f.catalogs, lang, f.pack.targetLang)
      const m = buildEncyclopedia(f.pack, undefined, text)
      expect(m.hunts.map((h) => h.unit)).toEqual(f.pack.units.map((u) => u.id))
      expect(m.hunts.every((h) => h.auto && h.steps.length > 0)).toBe(true)
      // a step per article of the unit, an item of the unit, no step asks an item twice in a hunt
      for (const h of m.hunts) {
        const arts = m.articles.filter((a) => a.unit === h.unit).map((a) => a.id)
        expect(h.steps.map((s) => s.article).sort()).toEqual(arts.sort())
        expect(new Set(h.steps.map((s) => s.item)).size).toBe(h.steps.length)
        for (const s of h.steps) {
          const obj = f.pack.objectives.find((o) => o.id === f.pack.items.find((i) => i.id === s.item)!.objective)!
          expect(obj.unit).toBe(h.unit)
          expect(s.clue).toBeUndefined() // the shell says "Find the article about ..."
        }
      }
      expect(m.map).toMatchObject({ auto: true, places: [] })
      expect(m.map?.asset).toBe('img-solar-system')
      // the dated order item (q-explore-timeline) gives events with years, true or not an article each
      expect(m.timeline.length).toBeGreaterThanOrEqual(3)
      expect(m.timeline.every((e) => Number.isInteger(e.year))).toBe(true)
      expect(m.finalSteps.length).toBeGreaterThanOrEqual(f.pack.units.length)
    }
  })

})
