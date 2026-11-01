import { describe, expect, it } from 'vitest'
import { builtinItemSchema, type BuiltinItem, type TextCatalog } from '../src/shared/course'
import {
  checkItem,
  crosswordFor,
  hitRegion,
  makeTextResolver,
  placementSelection,
  pointInShape,
  presentedOrder,
  solveItem,
  wordSearchFor,
  wordsFound,
  type CheckContext
} from '../src/shared/edu'

const common = { objective: 'o1', prompt: 'p', explanation: 'x' }
const parse = (raw: Record<string, unknown>): BuiltinItem => builtinItemSchema.parse({ id: 'i1', ...common, ...raw })

const en: TextCatalog = {
  schema: 1,
  lang: 'en',
  strings: {},
  accepted: {
    typed: ['Laku noć', 'Good night'],
    gap1: ['8', 'eight'],
    gap2: ['atmosphere'],
    mars: ['Mars'],
    earth: ['Earth'],
    venus: ['Venus'],
    saturn: ['Saturn'],
    zem: ['Zemlja']
  }
}
const mkCtx = (over: Partial<CheckContext> = {}): CheckContext => ({ text: makeTextResolver({ en }, 'en'), ...over })
const ctx = mkCtx()

describe('mcq and true-false', () => {
  const mcq = parse({
    kind: 'mcq',
    options: [
      { id: 'a', text: 't.a' },
      { id: 'b', text: 't.b', why: 'w.b' }
    ],
    answer: 'a'
  })
  it('right, wrong and a wrong-shaped answer', () => {
    expect(checkItem(mcq, 'a', ctx)).toMatchObject({ correct: true, score: 1, expected: 'a' })
    expect(checkItem(mcq, 'b', ctx)).toMatchObject({ correct: false, score: 0, expected: 'a' })
    expect(checkItem(mcq, 3, ctx)).toMatchObject({ correct: false, invalid: true })
    expect(checkItem(mcq, 'zzz', ctx).correct).toBe(false)
  })
  it('true-false', () => {
    const tf = parse({ kind: 'true-false', answer: false })
    expect(checkItem(tf, false, ctx).correct).toBe(true)
    expect(checkItem(tf, true, ctx)).toMatchObject({ correct: false, expected: false })
    expect(checkItem(tf, 'false', ctx).invalid).toBe(true)
  })
})

describe('multi-select', () => {
  const ms = parse({
    kind: 'multi-select',
    options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: `t.${id}`, why: `w.${id}` })),
    answers: ['a', 'b']
  })
  it('exact set is right; order does not matter', () => {
    expect(checkItem(ms, ['b', 'a'], ctx)).toMatchObject({ correct: true, score: 1 })
  })
  it('one of two right is partial (0.5); a wrong extra pick cancels a right one', () => {
    expect(checkItem(ms, ['a'], ctx)).toMatchObject({ correct: false, partial: true, score: 0.5 })
    expect(checkItem(ms, ['a', 'b', 'c'], ctx)).toMatchObject({ correct: false, partial: true, score: 0.5 })
    expect(checkItem(ms, ['a', 'c'], ctx)).toMatchObject({ correct: false, partial: false, score: 0 })
    expect(checkItem(ms, ['c', 'd'], ctx)).toMatchObject({ correct: false, score: 0 })
    expect(checkItem(ms, [], ctx)).toMatchObject({ correct: false, score: 0 })
  })
  it('rejects a wrong shape', () => {
    expect(checkItem(ms, 'a', ctx).invalid).toBe(true)
    expect(checkItem(ms, [1], ctx).invalid).toBe(true)
  })
})

describe('typed', () => {
  const typed = parse({ kind: 'typed', answer: 'typed' })
  it('right, synonym, wrong', () => {
    expect(checkItem(typed, 'Laku noć', ctx)).toMatchObject({ correct: true, expected: 'Laku noć' })
    expect(checkItem(typed, 'good night', ctx).correct).toBe(true)
    expect(checkItem(typed, 'dobro jutro', ctx)).toMatchObject({ correct: false, expected: 'Laku noć' })
    expect(checkItem(typed, 42, ctx).invalid).toBe(true)
  })
  it('flags a typo and accent differences according to the policy', () => {
    expect(checkItem(typed, 'laku noc', ctx)).toMatchObject({ correct: true })
    expect(checkItem(typed, 'laku noc', mkCtx({ diacritics: 'warn' }))).toMatchObject({ correct: true, diacritics: true })
    expect(checkItem(typed, 'laku noc', mkCtx({ diacritics: 'strict' }))).toMatchObject({ correct: false, diacritics: true })
    expect(checkItem(typed, 'laku nox', ctx)).toMatchObject({ correct: true, typo: true })
    expect(checkItem(typed, 'laku nox', mkCtx({ typos: false })).correct).toBe(false)
  })
  it('the item strictDiacritics overrides the course default', () => {
    const strict = parse({ kind: 'typed', answer: 'typed', strictDiacritics: true })
    expect(checkItem(strict, 'laku noc', mkCtx({ diacritics: 'ignore' }))).toMatchObject({ correct: false, diacritics: true })
    const lax = parse({ kind: 'typed', answer: 'typed', strictDiacritics: false })
    expect(checkItem(lax, 'laku noc', mkCtx({ diacritics: 'strict' })).correct).toBe(true)
  })
  it('falls back to the catalog string when there is no accepted list', () => {
    const c: TextCatalog = { schema: 1, lang: 'en', strings: { only: 'Sunce' } }
    const item = parse({ kind: 'typed', answer: 'only' })
    expect(checkItem(item, 'sunce', { text: makeTextResolver({ en: c }, 'en') }).correct).toBe(true)
  })
})

describe('cloze', () => {
  const cloze = parse({
    kind: 'cloze',
    text: 't',
    gaps: [
      { id: '1', answer: 'gap1' },
      { id: '2', answer: 'gap2', bank: ['gap2', 'x'] }
    ]
  })
  it('all gaps right, one right (partial) and none', () => {
    expect(checkItem(cloze, { '1': '8', '2': 'Atmosphere' }, ctx)).toMatchObject({ correct: true, score: 1, detail: { '1': true, '2': true } })
    expect(checkItem(cloze, { '1': 'eight', '2': 'moon' }, ctx)).toMatchObject({ correct: false, partial: true, score: 0.5, detail: { '1': true, '2': false } })
    expect(checkItem(cloze, { '1': '9' }, ctx)).toMatchObject({ correct: false, score: 0 })
    expect(checkItem(cloze, 'x', ctx).invalid).toBe(true)
  })
  it('reports a typo in a gap', () => {
    expect(checkItem(cloze, { '1': '8', '2': 'atmosphre' }, ctx)).toMatchObject({ correct: true, typo: true })
  })
  it('exposes the canonical text of every gap as expected', () => {
    expect(checkItem(cloze, {}, ctx).expected).toEqual({ '1': '8', '2': 'atmosphere' })
  })
})

describe('match-pairs', () => {
  const pairs = parse({
    kind: 'match-pairs',
    pairs: [
      { id: 'p1', left: 'l1', right: 'r1' },
      { id: 'p2', left: 'l2', right: 'r2' },
      { id: 'p3', left: 'l3', right: 'r3' },
      { id: 'p4', left: 'l4', right: 'r4' }
    ]
  })
  it('all right, partial and wrong', () => {
    expect(checkItem(pairs, { p1: 'p1', p2: 'p2', p3: 'p3', p4: 'p4' }, ctx)).toMatchObject({ correct: true, score: 1 })
    expect(checkItem(pairs, { p1: 'p1', p2: 'p2', p3: 'p4', p4: 'p3' }, ctx)).toMatchObject({ correct: false, partial: true, score: 0.5, detail: { p1: true, p3: false } })
    expect(checkItem(pairs, { p1: 'p2', p2: 'p1', p3: 'p4', p4: 'p3' }, ctx)).toMatchObject({ correct: false, partial: false, score: 0 })
    expect(checkItem(pairs, {}, ctx).score).toBe(0)
    expect(checkItem(pairs, ['p1'], ctx).invalid).toBe(true)
  })
})

describe('order and timeline', () => {
  const order = parse({
    kind: 'order',
    timeline: true,
    items: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: `t.${id}` }))
  })
  it('right order, a swap (partial) and a wrong permutation', () => {
    expect(checkItem(order, ['a', 'b', 'c', 'd'], ctx)).toMatchObject({ correct: true, score: 1, expected: ['a', 'b', 'c', 'd'] })
    expect(checkItem(order, ['b', 'a', 'c', 'd'], ctx)).toMatchObject({ correct: false, partial: true, score: 0.5 })
    expect(checkItem(order, ['d', 'c', 'b', 'a'], ctx)).toMatchObject({ correct: false, partial: false, score: 0 })
  })
  it('rejects missing, repeated or unknown ids', () => {
    expect(checkItem(order, ['a', 'b', 'c'], ctx).invalid).toBe(true)
    expect(checkItem(order, ['a', 'a', 'c', 'd'], ctx).invalid).toBe(true)
    expect(checkItem(order, ['a', 'b', 'c', 'z'], ctx).invalid).toBe(true)
  })
  it('presentedOrder is a seeded shuffle that is never the answer', () => {
    const a = presentedOrder(order as never, 1)
    expect(a).toEqual(presentedOrder(order as never, 1))
    expect([...a].sort()).toEqual(['a', 'b', 'c', 'd'])
    for (let s = 0; s < 50; s++) expect(presentedOrder(order as never, s)).not.toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('sort-groups', () => {
  const sort = parse({
    kind: 'sort-groups',
    groups: [
      { id: 'g1', title: 'g1' },
      { id: 'g2', title: 'g2' }
    ],
    items: [
      { id: 'x', text: 'x', group: 'g1' },
      { id: 'y', text: 'y', group: 'g2' },
      { id: 'z', text: 'z', group: 'g1' }
    ]
  })
  it('right, partial, wrong', () => {
    expect(checkItem(sort, { x: 'g1', y: 'g2', z: 'g1' }, ctx).correct).toBe(true)
    const part = checkItem(sort, { x: 'g1', y: 'g1', z: 'g1' }, ctx)
    expect(part).toMatchObject({ correct: false, partial: true })
    expect(part.score).toBeCloseTo(2 / 3)
    expect(checkItem(sort, { x: 'g2', y: 'g1', z: 'g2' }, ctx)).toMatchObject({ correct: false, score: 0 })
    expect(checkItem(sort, 'x', ctx).invalid).toBe(true)
  })
})

describe('hotspot', () => {
  const hot = parse({
    kind: 'hotspot',
    asset: 'img',
    width: 100,
    height: 100,
    regions: [
      { id: 'c', label: 'c', shape: { type: 'circle', cx: 20, cy: 20, r: 10 } },
      { id: 'r', label: 'r', shape: { type: 'rect', x: 50, y: 50, w: 20, h: 10 } },
      {
        id: 'p',
        label: 'p',
        shape: {
          type: 'poly',
          points: [
            [10, 60],
            [40, 60],
            [25, 90]
          ]
        }
      }
    ],
    answer: 'r'
  }) as Extract<BuiltinItem, { kind: 'hotspot' }>
  it('a region id or a click point', () => {
    expect(checkItem(hot, 'r', ctx).correct).toBe(true)
    expect(checkItem(hot, 'c', ctx).correct).toBe(false)
    expect(checkItem(hot, { x: 60, y: 55 }, ctx).correct).toBe(true)
    expect(checkItem(hot, { x: 20, y: 20 }, ctx)).toMatchObject({ correct: false, expected: 'r' })
    expect(checkItem(hot, { x: 99, y: 1 }, ctx).correct).toBe(false)
    expect(checkItem(hot, { x: 'a' }, ctx).invalid).toBe(true)
  })
  it('hit testing of the three shapes', () => {
    expect(hitRegion(hot, 25, 20)).toBe('c')
    expect(hitRegion(hot, 31, 20)).toBeUndefined()
    expect(hitRegion(hot, 25, 70)).toBe('p')
    expect(hitRegion(hot, 5, 70)).toBeUndefined()
    expect(pointInShape({ type: 'rect', x: 0, y: 0, w: 5, h: 5 }, 5, 5)).toBe(true)
    expect(pointInShape({ type: 'rect', x: 0, y: 0, w: 5, h: 5 }, 5.1, 5)).toBe(false)
  })
})

describe('listening and flashcard', () => {
  it('choose', () => {
    const l = parse({
      kind: 'listening',
      asset: 'aud',
      transcript: 't',
      mode: 'choose',
      options: [
        { id: 'a', text: 'a' },
        { id: 'b', text: 'b', why: 'w' }
      ],
      answer: 'b'
    })
    expect(checkItem(l, 'b', ctx).correct).toBe(true)
    expect(checkItem(l, 'a', ctx).correct).toBe(false)
  })
  it('type uses the tolerant matcher', () => {
    const l = parse({ kind: 'listening', asset: 'aud', transcript: 't', mode: 'type', answer: 'typed', strictDiacritics: true })
    expect(checkItem(l, 'Laku noć', ctx).correct).toBe(true)
    expect(checkItem(l, 'laku noc', ctx)).toMatchObject({ correct: false, diacritics: true })
    expect(checkItem(l, 'laku nox', ctx)).toMatchObject({ correct: true, typo: true })
  })
  it('the schema asks for options in choose mode and none in type mode', () => {
    expect(builtinItemSchema.safeParse({ id: 'i', ...common, kind: 'listening', asset: 'a', transcript: 't', mode: 'choose', answer: 'a' }).success).toBe(false)
    expect(builtinItemSchema.safeParse({ id: 'i', ...common, kind: 'listening', asset: 'a', transcript: 't', mode: 'type', answer: 'a', options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }] }).success).toBe(false)
  })
  it('flashcard grades: again wrong, hard right but shaky, good and easy right', () => {
    const f = parse({ kind: 'flashcard', back: 'b' })
    expect(checkItem(f, 'again', ctx)).toMatchObject({ correct: false, score: 0 })
    expect(checkItem(f, 'hard', ctx)).toMatchObject({ correct: true, partial: true, score: 0.6 })
    expect(checkItem(f, 'good', ctx)).toMatchObject({ correct: true, score: 1 })
    expect(checkItem(f, 'easy', ctx)).toMatchObject({ correct: true, score: 1 })
    expect(checkItem(f, 'meh', ctx).invalid).toBe(true)
  })
})

describe('crossword and word search', () => {
  const cross = parse({
    kind: 'crossword',
    words: [
      { id: 'mars', answer: 'mars', clue: 'c1' },
      { id: 'earth', answer: 'earth', clue: 'c2' },
      { id: 'venus', answer: 'venus', clue: 'c3' },
      { id: 'saturn', answer: 'saturn', clue: 'c4' }
    ],
    seed: 3
  }) as Extract<BuiltinItem, { kind: 'crossword' }>
  it('compares letters only, folded and upper-case', () => {
    expect(checkItem(cross, { mars: 'MARS', earth: 'earth', venus: ' Venus ', saturn: 'SATURN' }, ctx)).toMatchObject({ correct: true, score: 1 })
    expect(checkItem(cross, { mars: 'mars', earth: 'earth', venus: 'venas', saturn: '' }, ctx)).toMatchObject({ correct: false, partial: true, score: 0.5, detail: { mars: true, venus: false, saturn: false } })
    expect(checkItem(cross, [], ctx).invalid).toBe(true)
  })
  it('folds accents on the learner side too (Croatian)', () => {
    const hr: TextCatalog = { schema: 1, lang: 'hr', strings: {}, accepted: { zem: ['Zemlja'], mjesec: ['Mjesec'], sunce: ['Sunce'] } }
    const item = parse({
      kind: 'crossword',
      words: [
        { id: 'z', answer: 'zem', clue: 'c' },
        { id: 'm', answer: 'mjesec', clue: 'c' },
        { id: 's', answer: 'sunce', clue: 'c' }
      ],
      seed: 1
    })
    const c: CheckContext = { text: makeTextResolver({ hr }, 'hr') }
    expect(checkItem(item, { z: 'ZEMLJA', m: 'mjesec', s: 'Sunce' }, c).correct).toBe(true)
  })
  it('builds the same grid for the item every time', () => {
    expect(crosswordFor(cross, ctx).grid).toEqual(crosswordFor(cross, ctx).grid)
    expect(crosswordFor(cross, ctx).grid.unplaced).toEqual([])
  })

  const ws = parse({
    kind: 'word-search',
    words: [
      { id: 'mars', answer: 'mars' },
      { id: 'earth', answer: 'earth' },
      { id: 'venus', answer: 'venus' }
    ],
    seed: 9,
    directions: 'all'
  }) as Extract<BuiltinItem, { kind: 'word-search' }>
  it('the bot answer (the placements) finds every word, forwards or backwards', () => {
    expect(checkItem(ws, solveItem(ws, ctx), ctx)).toMatchObject({ correct: true, score: 1 })
    const { grid, words } = wordSearchFor(ws, ctx)
    const reversed = grid.placements.map((p) => {
      const s = placementSelection(p)
      return { start: s.end, end: s.start }
    })
    expect(wordsFound(grid, words, reversed).sort()).toEqual(['earth', 'mars', 'venus'])
  })
  it('a subset is partial, nothing is zero, junk is invalid', () => {
    const { grid } = wordSearchFor(ws, ctx)
    const first = placementSelection(grid.placements[0]!)
    expect(checkItem(ws, [first], ctx)).toMatchObject({ correct: false, partial: true })
    expect(checkItem(ws, [first], ctx).score).toBeCloseTo(1 / 3)
    expect(checkItem(ws, [{ start: [0, 0], end: [0, 0] }], ctx)).toMatchObject({ correct: false, partial: false, score: 0 })
    expect(checkItem(ws, 'x', ctx).invalid).toBe(true)
    expect(checkItem(ws, [{ start: 'a', end: 'b' }], ctx).invalid).toBe(true)
  })
})

describe('checkItem', () => {
  it('an unknown kind is invalid, never an exception', () => {
    expect(checkItem({ ...common, id: 'x', kind: 'nope', difficulty: 3, tags: [] }, 'a', ctx)).toMatchObject({ correct: false, invalid: true })
  })
})

describe('German flows through the context (lang)', () => {
  const de: TextCatalog = { schema: 1, lang: 'de', strings: {}, accepted: { maedchen: ['Mädchen'], g1: ['Straße'], g2: ['Haus'] } }
  const deCtx = (lang?: string): CheckContext => ({ text: makeTextResolver({ en, de }, 'en', 'de'), ...(lang ? { lang } : {}) })
  const typedDe = parse({ kind: 'typed', answer: 'maedchen' })
  const clozeDe = parse({ kind: 'cloze', text: 't.c', gaps: [{ id: 'a', answer: 'g1' }, { id: 'b', answer: 'g2' }] })
  it('typed: transliteration is accepted with a flag, a missing umlaut is wrong', () => {
    expect(checkItem(typedDe, 'Maedchen', deCtx('de'))).toMatchObject({ correct: true, score: 1, translit: true })
    expect(checkItem(typedDe, 'Madchen', deCtx('de'))).toMatchObject({ correct: false, diacritics: true })
    expect(checkItem(typedDe, 'Madchen', deCtx())).toMatchObject({ correct: true })
  })
  it('cloze carries translit and caps from any gap', () => {
    expect(checkItem(clozeDe, { a: 'Strasse', b: 'haus' }, deCtx('de'))).toMatchObject({ correct: true, translit: true, caps: true })
  })
  it('an item with strictDiacritics: false stays lenient', () => {
    expect(checkItem({ ...typedDe, strictDiacritics: false }, 'Madchen', deCtx('de')).correct).toBe(true)
  })
})
