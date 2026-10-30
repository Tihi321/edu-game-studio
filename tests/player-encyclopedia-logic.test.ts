import { describe, expect, it } from 'vitest'
import { makeTextResolver } from '../src/shared/edu'
import { encyclopediaSectionSchema, encyclopediaShell, autoHunts, autoMap, autoTimeline, buildEncyclopedia, containsPhrase, encArticles, finalStepsOf, parseYear, answerInArticle, type EncyclopediaSection } from '../src/shared/shells/encyclopedia'
import { emptyData, readData, withFound, withRead } from '../src/player/shells/encyclopedia/data'
import { linkedIds, linkify, paragraphsOf, searchArticles, searchTermFor, type ArticleText } from '../src/player/shells/encyclopedia/articles'
import { minMapWidth, nearestPinDistance, pinPercent, stepPin } from '../src/player/shells/encyclopedia/places'
import { formatYear, layoutTimeline, niceStep, rulerTicks } from '../src/player/shells/encyclopedia/timeline'
import { ENC_STRINGS } from '../src/player/shells/encyclopedia/strings'
import type { CoursePack } from '../src/shared/course'
import { loadFixture } from './edu-fixtures'

/**
 * The encyclopedia explorer's pure logic (EGS-10), no DOM: the reading logic (paragraphs, cross-links, search), the timeline and map
 * geometry, the saved data, the model the player and the lint share (authored section and automatic layout, both editions), the section
 * schema and the answer-in-article check.
 */

describe('reading: paragraphs and cross-links', () => {
  it('splits a body on line breaks and drops blanks', () => {
    expect(paragraphsOf(['One.\n\nTwo.', '  Three.  ', ''])).toEqual(['One.', 'Two.', 'Three.'])
  })

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

  it('links a title only once across paragraphs and never links a very short title', () => {
    const segs = linkify(['Rome is old.', 'Rome is big. Io is a moon.'], 'x', [
      { id: 'rome', title: 'Rome' },
      { id: 'io', title: 'Io' }
    ])
    expect(linkedIds(segs)).toEqual(['rome'])
    expect(segs[1]!.some((s) => s.link)).toBe(false)
  })

  it('does not link inside a longer word (Unicode letters count)', () => {
    const segs = linkify(['Beča and Bečki. Beč is the capital.'], 'x', [{ id: 'vienna', title: 'Beč' }])
    const linked = segs[0]!.filter((s) => s.link)
    expect(linked).toHaveLength(1)
    expect(linked[0]!.text).toBe('Beč')
    expect(segs[0]!.map((s) => s.text).join('')).toBe('Beča and Bečki. Beč is the capital.')
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

  it('ranks a title hit above a body hit and gives a snippet only for body hits', () => {
    const hits = searchArticles('danube', arts)
    expect(hits.map((h) => h.id).sort()).toEqual(['budapest', 'vienna'])
    expect(hits.every((h) => h.snippet.includes('Danube'))).toBe(true)
    const t = searchArticles('prag', arts)
    expect(t[0]).toMatchObject({ id: 'prague', snippet: '' })
  })

  it('searchTermFor gives a term that finds the article it was made for', () => {
    for (const a of arts) {
      const term = searchTermFor(a, arts)
      expect(searchArticles(term, arts).some((h) => h.id === a.id), `${a.id}: "${term}"`).toBe(true)
      expect(term.length).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('timeline geometry', () => {
  it('niceStep and rulerTicks give a readable ruler (no year 0, majors on the step)', () => {
    expect(niceStep(100)).toBeLessThanOrEqual(20)
    expect(niceStep(2500)).toBeGreaterThanOrEqual(500)
    const ticks = rulerTicks(-450, 90)
    expect(ticks.some((t) => t.year === 0)).toBe(false)
    expect(ticks.every((t) => t.year >= -450 && t.year <= 90)).toBe(true)
    expect(ticks.filter((t) => t.major).length).toBeGreaterThanOrEqual(2)
  })

  it('formats a year, BC with the edition word', () => {
    expect(formatYear(1957, 'BC')).toBe('1957')
    expect(formatYear(-432, 'BC')).toBe('432 BC')
    expect(formatYear(-432, 'pr. Kr.')).toBe('432 pr. Kr.')
  })

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

  it('copes with no event, one event and events in one year', () => {
    expect(layoutTimeline([]).events).toEqual([])
    const one = layoutTimeline([{ id: 'a', year: 1900 }])
    expect(one.events[0]!.tick).toBe(one.width / 2)
    const same = layoutTimeline([
      { id: 'a', year: 1900 },
      { id: 'b', year: 1900 }
    ])
    expect(new Set(same.events.map((e) => e.lane)).size).toBe(2)
    expect(same.ticks).toEqual([])
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

  it('moves between pins with the arrow keys, wrapping round', () => {
    expect(stepPin(pins, 'a', 'right')?.id).toBe('b')
    expect(stepPin(pins, 'c', 'right')?.id).toBe('a')
    expect(stepPin(pins, 'a', 'left')?.id).toBe('c')
    expect(stepPin(pins, 'a', 'down')?.id).toBe('b') // same y: by x
    expect(stepPin(pins, 'b', 'down')?.id).toBe('c')
    expect(stepPin([], 'a', 'down')).toBeUndefined()
  })

  it('places a pin as percentages of the image', () => {
    expect(pinPercent({ id: 'a', x: 200, y: 75 }, 800, 300)).toEqual({ left: '25%', top: '25%' })
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

  it('adds a found step and a read article once', () => {
    let d = emptyData()
    d = withFound(withFound(d, 's1'), 's1')
    d = withRead(withRead(d, 'a1'), 'a1')
    expect(d).toEqual({ found: ['s1'], read: ['a1'] })
  })
})

describe('words', () => {
  it('has a Croatian word for every English one, with the same placeholders', () => {
    const en = ENC_STRINGS.en as Record<string, string>
    const hr = ENC_STRINGS.hr as Record<string, string>
    const holes = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()
    expect(Object.keys(hr).sort()).toEqual(Object.keys(en).sort())
    for (const k of Object.keys(en)) expect(holes(hr[k]!), k).toEqual(holes(en[k]!))
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

  it('finds the words of a phrase in a body by their stems (inflection), numbers exactly', () => {
    const body = 'atena je glavni grad grcke a partenon je dovrsen do 432 godine'
    expect(containsPhrase(body, 'Atena')).toBe(true)
    expect(containsPhrase(body, 'Ateni')).toBe(true) // Croatian locative
    expect(containsPhrase(body, 'Partenon u Ateni')).toBe(true)
    expect(containsPhrase(body, '432')).toBe(true)
    expect(containsPhrase(body, '43')).toBe(false)
    expect(containsPhrase(body, 'Koloseum')).toBe(false)
    expect(containsPhrase(body, 'a of the')).toBe(true) // only filler words: nothing to look for
  })

  it('accepts a section with every part optional and refuses unknown keys and year 0', () => {
    expect(encyclopediaSectionSchema.parse({})).toEqual({ timeline: [], hunts: [] })
    expect(encyclopediaSectionSchema.safeParse({ extra: 1 }).success).toBe(false)
    expect(encyclopediaSectionSchema.safeParse({ timeline: [{ id: 't', year: 0, label: 'k' }] }).success).toBe(false)
    expect(encyclopediaSectionSchema.safeParse({ timeline: [{ id: 't', year: -44, label: 'k' }] }).success).toBe(true)
    expect(encyclopediaSectionSchema.safeParse({ map: { asset: 'a', width: 0, height: 10 } }).success).toBe(false)
  })

  it('lists every text key and asset of a section', () => {
    const s: EncyclopediaSection = encyclopediaSectionSchema.parse({
      timeline: [{ id: 't', year: 1900, label: 'k.t', text: 'k.t.text', article: 'a' }],
      map: { asset: 'img', width: 10, height: 10, places: [{ id: 'p', x: 1, y: 1, label: 'k.p', article: 'a' }] },
      hunts: [{ id: 'h', unit: 'u', title: 'k.h', intro: 'k.h.i', steps: [{ id: 's', clue: 'k.s.c', article: 'a', item: 'i', collectible: 'k.s.n' }] }]
    })
    expect(encyclopediaShell.textRefs(s, {} as CoursePack).map((r) => r.key).sort()).toEqual(['k.h', 'k.h.i', 'k.p', 'k.s.c', 'k.s.n', 'k.t', 'k.t.text'])
    expect(encyclopediaShell.assetRefs?.(s)).toEqual([{ path: 'map.asset', id: 'img' }])
    expect(encyclopediaShell.requiresSection).toBe(false)
    expect(encyclopediaShell.theme).toBe('parchment')
  })

  it('keeps the grand hunt to the first and last step of every unit, each step once', () => {
    const step = (id: string) => ({ id, article: 'a', item: `i-${id}` })
    const hunts = [
      { id: 'h1', unit: 'u1', steps: [step('a'), step('b'), step('c')], auto: false },
      { id: 'h2', unit: 'u2', steps: [step('d')], auto: false },
      { id: 'h3', unit: 'u1', steps: [step('e')], auto: false }
    ]
    expect(finalStepsOf(hunts).map((s) => s.id)).toEqual(['a', 'e', 'd'])
    expect(finalStepsOf([])).toEqual([])
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

  it('builds an article per objective for a unit without any, and a hunt over them', async () => {
    const f = await loadFixture('solar-system')
    const pack = structuredClone(f.pack)
    pack.encyclopedia.articles = pack.encyclopedia.articles.filter((a) => a.unit !== 'u-moons-beyond')
    const text = makeTextResolver(f.catalogs, 'en', pack.targetLang)
    const arts = encArticles(pack)
    const virtual = arts.filter((a) => a.virtual)
    expect(virtual.map((a) => a.id).sort()).toEqual(['auto-obj-beyond', 'auto-obj-exploration', 'auto-obj-moons'])
    expect(virtual.every((a) => a.unit === 'u-moons-beyond' && a.bodyKeys.length >= 1)).toBe(true)
    const hunts = autoHunts(pack, arts, text)
    expect(hunts.find((h) => h.unit === 'u-moons-beyond')!.steps).toHaveLength(3)
  })

  it('has no timeline and no map for a course without order dates or images', async () => {
    const f = await loadFixture('hr-a1-greetings')
    const text = makeTextResolver(f.catalogs, 'en', f.pack.targetLang)
    const arts = encArticles(f.pack)
    expect(autoTimeline(f.pack, arts, text)).toEqual([])
    expect(autoMap({ ...f.pack, assets: [] })).toBeUndefined()
  })
})
