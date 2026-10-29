import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { afterAll, describe, expect, it } from 'vitest'
import { validateCourseFolder } from '../src/engine/edu/course-io'
import {
  coursePackSchema,
  findUnitCycle,
  isBuiltinItem,
  itemBaseShape,
  itemKindsBuiltin,
  itemsOf,
  objectivesOf,
  textCatalogSchema,
  unitOfItem,
  unitOrder
} from '../src/shared/course'
import {
  ITEM_KINDS,
  answerKeyOf,
  checkItem,
  formOf,
  getItemKind,
  loadCourseFromFiles,
  makeTextResolver,
  registerItemKind,
  solveItem,
  unregisterItemKind,
  validateCourse,
  type Problem
} from '../src/shared/edu'
import { FIXTURE_NAMES, FIXTURES, ctxFor, loadFixture, type LoadedFixture } from './edu-fixtures'

const clone = <T>(v: T): T => structuredClone(v)

describe('golden fixtures', () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name} validates with 0 problems (files, schema, references, text, puzzles)`, async () => {
      const res = await validateCourseFolder(path.join(FIXTURES, name))
      expect(res.problems).toEqual([])
      expect(res.ok).toBe(true)
      expect(res.pack?.id).toBe(name)
    })
  }

  it('solar-system: en + hr, three units in a prerequisite chain, every item kind used', async () => {
    const f = await loadFixture('solar-system')
    expect(f.pack).toMatchObject({ schema: 1, sourceLang: 'en', languages: ['en', 'hr'] })
    expect(f.pack.units.map((u) => u.id)).toEqual(['u-sun-planets', 'u-rocky-giant', 'u-moons-beyond'])
    expect(f.pack.units.map((u) => u.requires)).toEqual([[], ['u-sun-planets'], ['u-rocky-giant']])
    expect(unitOrder(f.pack.units)).toEqual(f.pack.units.map((u) => u.id))
    expect(findUnitCycle(f.pack.units)).toBeNull()
    expect(new Set(f.pack.items.map((i) => i.kind))).toEqual(new Set(itemKindsBuiltin))
  })

  it('solar-system: facts have sources and urls, articles cite them, items carry explanations and hooks', async () => {
    const f = await loadFixture('solar-system')
    expect(f.pack.factbase.length).toBeGreaterThanOrEqual(20)
    for (const fact of f.pack.factbase) {
      expect(fact.source).toMatch(/NASA/)
      expect(fact.url).toMatch(/^https:\/\/(science\.nasa\.gov|www\.nasa\.gov|nssdc\.gsfc\.nasa\.gov)\//)
    }
    expect(f.pack.encyclopedia.articles.length).toBeGreaterThanOrEqual(4)
    for (const a of f.pack.encyclopedia.articles) expect(a.citations.length).toBeGreaterThan(0)
    expect(f.pack.items.filter((i) => i.didYouKnow).length).toBeGreaterThan(f.pack.items.length / 2)
    const assets = Object.fromEntries(f.pack.assets.map((a) => [a.id, a]))
    expect(assets['img-solar-system']?.kind).toBe('image')
    expect(assets['aud-beeps']?.kind).toBe('audio')
  })

  it('hr-a1-greetings: source en, target hr, edition en, three units, A1, strict accents used', async () => {
    const f = await loadFixture('hr-a1-greetings')
    expect(f.pack).toMatchObject({ sourceLang: 'en', languages: ['en'], targetLang: 'hr', cefr: 'A1' })
    expect(f.pack.units).toHaveLength(3)
    expect(f.pack.units.map((u) => u.requires)).toEqual([[], ['u-greetings'], ['u-introductions']])
    const kinds = new Set(f.pack.items.map((i) => i.kind))
    for (const k of ['typed', 'cloze', 'match-pairs', 'mcq', 'flashcard', 'listening', 'word-search']) expect(kinds.has(k)).toBe(true)
    expect(f.pack.items.some((i) => i.kind === 'typed' && i.strictDiacritics === true)).toBe(true)
    // the listening clips are honest about being placeholder tones
    for (const a of f.pack.assets.filter((x) => x.kind === 'audio')) expect(f.catalogs.en!.strings[a.alt]).toMatch(/placeholder tone/i)
  })

  for (const name of FIXTURE_NAMES) {
    it(`${name}: every objective is asked in at least two forms and every item belongs to one`, async () => {
      const f = await loadFixture(name)
      for (const o of f.pack.objectives) {
        const forms = new Set(itemsOf(f.pack, o.id).map((i) => formOf(i)))
        expect(forms.size, `${o.id} has forms ${[...forms].join(', ')}`).toBeGreaterThanOrEqual(2)
        expect(objectivesOf(f.pack, o.unit)).toContain(o)
      }
      for (const i of f.pack.items) expect(unitOfItem(f.pack, i)).toBeDefined()
    })

    it(`${name}: every item is solved by its own key in every edition, and a wrong answer fails`, async () => {
      const f = await loadFixture(name)
      for (const lang of f.pack.languages) {
        const ctx = ctxFor(f, lang)
        for (const item of f.pack.items) {
          const answer = solveItem(item, ctx)
          const r = checkItem(item, answer, ctx)
          expect(r.correct, `${item.id} (${item.kind}) in ${lang}: ${JSON.stringify(answer)}`).toBe(true)
          expect(r.invalid).toBeUndefined()
          expect(answerKeyOf(item)).toBeDefined()
        }
      }
    })

    it(`${name}: every distractor has its own explanation and every string is in the catalog`, async () => {
      const f = await loadFixture(name)
      for (const item of f.pack.items) {
        const def = getItemKind(item.kind)!
        for (const d of def.distractors?.(item) ?? []) expect(d.why, `${item.id} ${d.path}`).toBeTruthy()
        for (const ref of def.textRefs(item)) {
          for (const lang of f.pack.languages) {
            const t = makeTextResolver(f.catalogs, lang, f.pack.targetLang)
            expect(ref.role === 'accepted' ? t.hasAccepted(ref.key) : t.hasText(ref.key), `${item.id} ${ref.path} ${ref.key} in ${lang}`).toBe(true)
          }
        }
      }
    })
  }

  it('solar-system: a wrong answer is not accepted for the typed, cloze and listening items', async () => {
    const f = await loadFixture('solar-system')
    const ctx = ctxFor(f, 'hr')
    const byId = (id: string) => f.pack.items.find((i) => i.id === id)!
    expect(checkItem(byId('q-giants-typed'), 'Saturn', ctx).correct).toBe(false)
    expect(checkItem(byId('q-moons-typed'), 'Mjesec', ctx).correct).toBe(true)
    expect(checkItem(byId('q-moons-typed'), 'Moon', ctx).correct).toBe(false)
    expect(checkItem(byId('q-beyond-cloze'), { '1': 'Jupitera' }, ctx).correct).toBe(true)
    expect(checkItem(byId('q-beyond-cloze'), { '1': 'Saturna' }, ctx).correct).toBe(false)
    expect(checkItem(byId('q-sun-beeps'), 'a', ctx).correct).toBe(false)
    expect(checkItem(byId('q-order-hotspot'), { x: 285, y: 150 }, ctx).correct).toBe(true)
    expect(checkItem(byId('q-order-hotspot'), { x: 235, y: 150 }, ctx).correct).toBe(false)
  })

  it('hr-a1-greetings: strict accents on an item, a warning elsewhere, and synonyms', async () => {
    const f = await loadFixture('hr-a1-greetings')
    const ctx = ctxFor(f, 'en')
    const byId = (id: string) => f.pack.items.find((i) => i.id === id)!
    // strict item: č missing is not accepted but is flagged
    expect(checkItem(byId('g-evening-typed'), 'dobra vecer', ctx)).toMatchObject({ correct: false, diacritics: true })
    expect(checkItem(byId('g-evening-typed'), 'Dobar večer', ctx).correct).toBe(true)
    // not strict: the course default (warn) accepts and flags
    expect(checkItem(byId('g-name-typed'), 'ja se zovem ana', ctx).correct).toBe(true)
    expect(checkItem(byId('g-bye-typed'), 'do vidjenja', ctx)).toMatchObject({ correct: false, diacritics: true })
    expect(checkItem(byId('g-bye-typed'), 'Do viđenja', ctx).correct).toBe(true)
    // g-hello-typed says strictDiacritics false and has no accents anyway; a typo is tolerated
    expect(checkItem(byId('g-hello-typed'), 'dobar dna', ctx).correct).toBe(false)
    expect(checkItem(byId('g-hello-typed'), 'dobar dann', ctx)).toMatchObject({ correct: true, typo: true })
    // cloze with a bank and strict accents
    expect(checkItem(byId('g-bye-cloze'), { '1': 'noc' }, ctx)).toMatchObject({ correct: false, diacritics: true })
    expect(checkItem(byId('g-bye-cloze'), { '1': 'noć' }, ctx).correct).toBe(true)
    // the word search finds Croatian words on a folded grid
    const ws = byId('g-greet-ws')
    expect(checkItem(ws, solveItem(ws, ctx), ctx).correct).toBe(true)
  })
})

describe('schema', () => {
  it('accepts both fixtures through the pack and catalog schemas', async () => {
    for (const name of FIXTURE_NAMES) {
      const f = await loadFixture(name)
      expect(coursePackSchema.safeParse(f.rawPack).success).toBe(true)
      for (const c of Object.values(f.rawCatalogs)) expect(textCatalogSchema.safeParse(c).success).toBe(true)
    }
  })
  it('rejects a pack without schema 1, with an unknown key, or with a bad id', async () => {
    const f = await loadFixture('solar-system')
    const a = clone(f.rawPack)
    delete a.schema
    expect(coursePackSchema.safeParse(a).success).toBe(false)
    expect(coursePackSchema.safeParse({ ...clone(f.rawPack), schema: 2 }).success).toBe(false)
    expect(coursePackSchema.safeParse({ ...clone(f.rawPack), surprise: 1 }).success).toBe(false)
    expect(coursePackSchema.safeParse({ ...clone(f.rawPack), id: 'has space' }).success).toBe(false)
    expect(coursePackSchema.safeParse({ ...clone(f.rawPack), sourceLang: 'English' }).success).toBe(false)
  })
  it('unknown shell ids and extensions are accepted, so later shells and features extend the pack', async () => {
    const f = await loadFixture('solar-system')
    const raw = clone(f.rawPack)
    raw.shells = { enabled: ['quiz-arena', 'mindmaze', 'rpg', 'detective'], config: { mindmaze: { wings: 3 }, rpg: { tileSet: 'x' }, 'something-new': { a: [1, 2] } } }
    raw.extensions = { teacherMode: { classes: [] }, multiplayer: { rooms: 4 } }
    const res = validateCourse(raw, f.rawCatalogs)
    expect(res.problems).toEqual([])
    expect(res.pack?.shells.config['something-new']).toEqual({ a: [1, 2] })
  })
  it('fills defaults: difficulty 3, no tags, quiz-arena, no cues', () => {
    const p = coursePackSchema.parse({
      schema: 1,
      id: 'x',
      slug: 'x',
      sourceLang: 'en',
      languages: ['en'],
      subject: 's',
      audience: 'a',
      units: [{ id: 'u', title: 't' }],
      objectives: [{ id: 'o', unit: 'u', bloom: 'remember', text: 't' }],
      items: []
    })
    expect(p.shells).toEqual({ enabled: ['quiz-arena'], config: {} })
    expect(p.cues).toEqual([])
    expect(p.matching).toEqual({ diacritics: 'ignore', typos: true })
    expect(p.units[0]!.requires).toEqual([])
  })
  it('isBuiltinItem tells the built-in kinds', async () => {
    const f = await loadFixture('solar-system')
    expect(f.pack.items.every(isBuiltinItem)).toBe(true)
    expect(isBuiltinItem({ id: 'a', objective: 'o', prompt: 'p', explanation: 'e', difficulty: 3, tags: [], kind: 'speaking' })).toBe(false)
  })
  it('findUnitCycle and unitOrder', () => {
    const u = (id: string, ...requires: string[]) => ({ id, requires })
    expect(findUnitCycle([u('a'), u('b', 'a'), u('c', 'b')])).toBeNull()
    expect(findUnitCycle([u('a', 'c'), u('b', 'a'), u('c', 'b')])).toEqual(['a', 'c', 'b', 'a'])
    expect(findUnitCycle([u('a', 'a')])).toEqual(['a', 'a'])
    expect(findUnitCycle([u('a', 'ghost')])).toBeNull()
    expect(unitOrder([u('c', 'b'), u('b', 'a'), u('a')])).toEqual(['a', 'b', 'c'])
    expect(unitOrder([u('a', 'b'), u('b', 'a')])).toEqual([])
  })
})

describe('validateCourse rejects crafted malformed packs with the expected codes', () => {
  let f: LoadedFixture
  const fresh = async (): Promise<{ pack: Record<string, any>; cats: Record<string, any> }> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    f ??= await loadFixture('solar-system')
    return { pack: clone(f.rawPack) as Record<string, any>, cats: clone(f.rawCatalogs) as Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  const item = (pack: Record<string, any>, id: string): Record<string, any> => pack.items.find((i: { id: string }) => i.id === id) // eslint-disable-line @typescript-eslint/no-explicit-any
  const has = (ps: Problem[], code: string, pathPart?: string): boolean => ps.some((p) => p.code === code && (!pathPart || p.path.includes(pathPart)))

  it('the unmodified clone is fine (control)', async () => {
    const { pack, cats } = await fresh()
    expect(validateCourse(pack, cats)).toMatchObject({ ok: true, problems: [] })
  })
  it('SCHEMA: wrong types, a missing field and an unknown key, with a path', async () => {
    const { pack, cats } = await fresh()
    // a base field wrong: the pack schema stops there and says where
    const base = clone(pack)
    item(base, 'q-order-mcq').difficulty = 9
    const baseRes = validateCourse(base, cats)
    expect(baseRes.ok).toBe(false)
    expect(baseRes.problems.map((p) => [p.code, p.path])).toEqual([['SCHEMA', 'items[0].difficulty']])
    // kind-level errors are all reported together
    delete item(pack, 'q-sun-mcq').answer
    item(pack, 'q-sun-tf').colour = 'red'
    const r = validateCourse(pack, cats)
    expect(r.ok).toBe(false)
    expect(r.problems.filter((p) => p.code === 'SCHEMA').map((p) => p.path)).toEqual(['items[5].answer', 'items[6]'])
    const top = validateCourse({ ...pack, units: 'nope' }, cats)
    expect(top.problems[0]).toMatchObject({ code: 'SCHEMA', path: 'units' })
    expect(validateCourse(null, {}).problems[0]!.code).toBe('SCHEMA')
    expect(validateCourse(pack, { en: { lang: 'en' } }).problems.some((p) => p.code === 'SCHEMA' && p.path.startsWith('text[en]'))).toBe(true)
  })
  it('UNKNOWN_KIND', async () => {
    const { pack, cats } = await fresh()
    item(pack, 'q-order-mcq').kind = 'hologram'
    expect(has(validateCourse(pack, cats).problems, 'UNKNOWN_KIND', '.kind')).toBe(true)
  })
  it('UNKNOWN_OBJECTIVE, UNKNOWN_UNIT, UNKNOWN_ASSET, UNKNOWN_FACT, UNKNOWN_ARTICLE', async () => {
    const { pack, cats } = await fresh()
    item(pack, 'q-order-mcq').objective = 'obj-ghost'
    pack.objectives[0].unit = 'u-ghost'
    pack.units[1].requires = ['u-ghost']
    item(pack, 'q-order-hotspot').asset = 'img-ghost'
    pack.objectives[1].facts = ['f-ghost']
    pack.encyclopedia.articles[0].citations = ['f-ghost']
    pack.encyclopedia.articles[0].related = ['art-ghost']
    pack.cues = [{ id: 'c1', on: 'correct', asset: 'aud-ghost' }]
    const ps = validateCourse(pack, cats).problems
    for (const code of ['UNKNOWN_OBJECTIVE', 'UNKNOWN_UNIT', 'UNKNOWN_ASSET', 'UNKNOWN_FACT', 'UNKNOWN_ARTICLE']) expect(has(ps, code), code).toBe(true)
    expect(ps.filter((p) => p.code === 'UNKNOWN_UNIT').map((p) => p.path)).toEqual(expect.arrayContaining(['objectives[0].unit', 'units[1].requires[0]']))
    expect(has(ps, 'UNKNOWN_ASSET', 'cues[0].asset')).toBe(true)
  })
  it('DUPLICATE_ID: items, units, options', async () => {
    const { pack, cats } = await fresh()
    pack.items[1].id = pack.items[0].id
    pack.units[1].id = pack.units[0].id
    item(pack, 'q-sun-mcq').options[1].id = item(pack, 'q-sun-mcq').options[0].id
    const ps = validateCourse(pack, cats).problems
    expect(has(ps, 'DUPLICATE_ID', 'items[1].id')).toBe(true)
    expect(has(ps, 'DUPLICATE_ID', 'units[1].id')).toBe(true)
    expect(ps.some((p) => p.code === 'DUPLICATE_ID' && p.path.includes('options'))).toBe(true)
  })
  it('MISSING_TEXT: a string gone from one edition, and an accepted list gone', async () => {
    const { pack, cats } = await fresh()
    delete cats.hr.strings['q-order-mcq.prompt']
    delete cats.en.accepted['q-giants-typed.answer']
    const ps = validateCourse(pack, cats).problems
    const prompt = ps.find((p) => p.code === 'MISSING_TEXT' && p.message.includes('q-order-mcq.prompt'))
    expect(prompt?.message).toMatch(/in: hr$/)
    expect(prompt?.path).toMatch(/^items\[\d+\]\.prompt$/)
    expect(ps.some((p) => p.code === 'MISSING_TEXT' && p.message.includes('accepted answers') && p.message.includes('en'))).toBe(true)
    // pack-level keys too
    delete cats.en.strings['ss.unit.sun.title']
    expect(has(validateCourse(pack, cats).problems, 'MISSING_TEXT', 'units[0].title')).toBe(true)
  })
  it('MISSING_WHY: a distractor without its misconception explanation', async () => {
    const { pack, cats } = await fresh()
    delete item(pack, 'q-order-mcq').options[1].why
    delete item(pack, 'q-giants-multi').options[2].why
    delete item(pack, 'q-sun-beeps').options[0].why
    const ps = validateCourse(pack, cats).problems.filter((p) => p.code === 'MISSING_WHY')
    expect(ps).toHaveLength(3)
    expect(ps[0]!.path).toMatch(/options\[1\]\.why$/)
  })
  it('UNKNOWN_OPTION / UNKNOWN_GROUP / UNKNOWN_REGION: answer keys that point nowhere', async () => {
    const { pack, cats } = await fresh()
    item(pack, 'q-order-mcq').answer = 'zz'
    item(pack, 'q-giants-multi').answers = ['rings', 'zz']
    item(pack, 'q-sun-beeps').answer = 'zz'
    item(pack, 'q-types-sort').items[0].group = 'zz'
    item(pack, 'q-order-hotspot').answer = 'zz'
    item(pack, 'q-venus-cloze').gaps[0].bank = ['q-venus-cloze.bank.ocean']
    const ps = validateCourse(pack, cats).problems
    expect(ps.filter((p) => p.code === 'UNKNOWN_OPTION').length).toBe(4)
    expect(has(ps, 'UNKNOWN_GROUP')).toBe(true)
    expect(has(ps, 'UNKNOWN_REGION')).toBe(true)
  })
  it('MISSING_GAP_MARKER: a cloze text that lost its gap in one language', async () => {
    const { pack, cats } = await fresh()
    cats.hr.strings['q-sun-cloze.text'] = 'Svjetlosti sa Sunca treba oko osam minuta.'
    const p = validateCourse(pack, cats).problems.find((x) => x.code === 'MISSING_GAP_MARKER')
    expect(p?.message).toMatch(/"hr"/)
  })
  it('ASSET_KIND: a hotspot on an audio file', async () => {
    const { pack, cats } = await fresh()
    item(pack, 'q-order-hotspot').asset = 'aud-beeps'
    expect(has(validateCourse(pack, cats).problems, 'ASSET_KIND')).toBe(true)
  })
  it('PUZZLE_UNPLACED: a crossword word that crosses nothing in one language', async () => {
    const { pack, cats } = await fresh()
    cats.hr.accepted['ss.word.earth'] = ['Qwx']
    const ps = validateCourse(pack, cats).problems
    expect(ps.some((p) => p.code === 'PUZZLE_UNPLACED' && p.message.includes('"hr"'))).toBe(true)
  })
  it('language and catalog problems', async () => {
    const { pack, cats } = await fresh()
    const noHr = { en: cats.en }
    expect(has(validateCourse(pack, noHr).problems, 'MISSING_CATALOG', 'text[hr]')).toBe(true)
    expect(has(validateCourse(pack, { ...cats, de: { schema: 1, lang: 'de', strings: {} } }).problems, 'UNKNOWN_LANGUAGE', 'text[de]')).toBe(true)
    expect(has(validateCourse(pack, { ...cats, hr: { ...cats.hr, lang: 'en' } }).problems, 'CATALOG_LANG')).toBe(true)
    expect(has(validateCourse({ ...pack, sourceLang: 'de' }, cats).problems, 'SOURCE_LANG_NOT_LISTED')).toBe(true)
  })
  it('accepts the catalogs as a list as well as a record', async () => {
    const { pack, cats } = await fresh()
    expect(validateCourse(pack, Object.values(cats)).problems).toEqual([])
  })
})

describe('the item-kind registry is extendable without touching the consumers', () => {
  const speakingSchema = z.looseObject({ ...itemBaseShape, kind: z.literal('speaking'), phrase: z.string(), minScore: z.number().min(0).max(1) })
  type Speaking = z.infer<typeof speakingSchema>
  const register = (): void =>
    registerItemKind<Speaking>({
      kind: 'speaking',
      form: 'Say it aloud',
      recall: true,
      schema: speakingSchema as unknown as z.ZodType<Speaking>,
      check: (item, answer) => {
        const score = typeof answer === 'number' ? answer : 0
        return { correct: score >= item.minScore, score, expected: item.minScore }
      },
      keyOf: (item) => item.minScore,
      solve: () => 1,
      textRefs: (item) => [{ path: 'phrase', key: item.phrase, role: 'string' }],
      validate: (item) => (item.minScore === 0 ? [{ code: 'BAD_THRESHOLD', path: 'minScore', message: 'a speaking item needs a threshold above 0' }] : [])
    })
  const ownedBy: { unregister?: boolean } = {}
  afterAll(() => {
    if (ownedBy.unregister) unregisterItemKind('speaking')
  })

  it('a registered fake kind validates, checks, solves and reports its form', async () => {
    const f = await loadFixture('hr-a1-greetings')
    const raw = clone(f.rawPack) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    const cats = clone(f.rawCatalogs) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    raw.items.push({ id: 'g-speak', kind: 'speaking', objective: 'obj-hello', prompt: 'g-speak.prompt', explanation: 'g-speak.explanation', difficulty: 2, tags: [], phrase: 't.dobar-dan', minScore: 0.8 })
    cats.en.strings['g-speak.prompt'] = 'Say it aloud.'
    cats.en.strings['g-speak.explanation'] = 'Good.'

    // not registered yet: the same pack is rejected with UNKNOWN_KIND
    expect(validateCourse(raw, cats).problems.map((p) => p.code)).toEqual(['UNKNOWN_KIND'])

    register()
    ownedBy.unregister = true
    expect(ITEM_KINDS.has('speaking')).toBe(true)
    const ok = validateCourse(raw, cats)
    expect(ok.problems).toEqual([])
    const item = ok.pack!.items.find((i) => i.id === 'g-speak')!
    const ctx = { text: makeTextResolver(f.catalogs, 'en', 'hr') }
    expect(formOf(item)).toBe('Say it aloud')
    expect(answerKeyOf(item)).toBe(0.8)
    expect(checkItem(item, 0.9, ctx)).toMatchObject({ correct: true })
    expect(checkItem(item, 0.2, ctx)).toMatchObject({ correct: false })
    expect(checkItem(item, solveItem(item, ctx), ctx).correct).toBe(true)

    // its own validation, its text refs and the generic checks all apply
    raw.items.at(-1).minScore = 0
    expect(validateCourse(raw, cats).problems.map((p) => p.code)).toEqual(['BAD_THRESHOLD'])
    raw.items.at(-1).minScore = 0.8
    raw.items.at(-1).phrase = 't.ghost'
    expect(validateCourse(raw, cats).problems.map((p) => p.code)).toEqual(['MISSING_TEXT'])
    raw.items.at(-1).phrase = 't.dobar-dan'
    raw.items.at(-1).objective = 'nope'
    expect(validateCourse(raw, cats).problems.map((p) => p.code)).toEqual(['UNKNOWN_OBJECTIVE'])
    raw.items.at(-1).objective = 'obj-hello'
    delete raw.items.at(-1).minScore
    expect(validateCourse(raw, cats).problems.map((p) => p.code)).toEqual(['SCHEMA'])

    // a second registration is refused unless replaced; unregistering restores UNKNOWN_KIND
    expect(() => register()).toThrow(/already registered/)
    expect(unregisterItemKind('speaking')).toBe(true)
    ownedBy.unregister = false
    raw.items.at(-1).minScore = 0.8
    expect(validateCourse(raw, cats).problems.map((p) => p.code)).toEqual(['UNKNOWN_KIND'])
  })

  it('all thirteen built-in kinds are registered with a form label', () => {
    for (const k of itemKindsBuiltin) {
      const def = getItemKind(k)
      expect(def, k).toBeDefined()
      expect(def!.form.length).toBeGreaterThan(3)
    }
    expect(itemKindsBuiltin).toHaveLength(13)
    expect(formOf({ kind: 'mystery' })).toBe('mystery')
  })
})

describe('loading', () => {
  it('loadCourseFromFiles reads pack and text files through any file source and reports bad JSON', async () => {
    const files: Record<string, string> = { 'course/pack.json': '{"a":1}', 'course/text/en.json': '{"lang":"en"}', 'course/text/hr.json': '{oops', 'course/text/notes.txt': 'x' }
    const out = await loadCourseFromFiles({
      readText: async (p) => files[p],
      list: async (d) => (d === 'course/text' ? ['hr.json', 'en.json', 'notes.txt'] : [])
    })
    expect(out.pack).toEqual({ a: 1 })
    expect(Object.keys(out.catalogs)).toEqual(['en'])
    expect(out.problems).toHaveLength(1)
    expect(out.problems[0]).toMatchObject({ code: 'PARSE', path: 'course/text/hr.json' })
    const none = await loadCourseFromFiles({ readText: async () => undefined, list: async () => [] })
    expect(none.problems.map((p) => p.path)).toEqual(['course/pack.json'])
  })

  const tmp: string[] = []
  afterAll(async () => {
    for (const d of tmp) await rm(d, { recursive: true, force: true })
  })
  it('validateCourseFolder reports an asset file that is not on disk', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'edu-course-'))
    tmp.push(dir)
    await cp(path.join(FIXTURES, 'hr-a1-greetings'), dir, { recursive: true })
    await rm(path.join(dir, 'course', 'assets', 'placeholder-dobar-dan.wav'))
    const res = await validateCourseFolder(dir)
    expect(res.ok).toBe(false)
    expect(res.problems.map((p) => p.code)).toEqual(['MISSING_ASSET_FILE'])
    const missing = await validateCourseFolder(path.join(dir, 'nowhere'))
    expect(missing.ok).toBe(false)
    expect(missing.problems.some((p) => p.code === 'PARSE')).toBe(true)
  })
})

describe('text resolver', () => {
  it('looks in the edition first, then in the target-language catalog', () => {
    const cats = {
      en: { schema: 1 as const, lang: 'en', strings: { a: 'edition a' }, accepted: { x: ['ex'] } },
      hr: { schema: 1 as const, lang: 'hr', strings: { a: 'target a', b: 'target b' }, accepted: { x: ['hr x', 'hr y'], y: ['why'] } }
    }
    const t = makeTextResolver(cats, 'en', 'hr')
    expect(t.text('a')).toBe('edition a')
    expect(t.text('b')).toBe('target b')
    expect(t.t('nope')).toBe('nope')
    expect(t.accepted('x')).toEqual(['ex'])
    expect(t.accepted('y')).toEqual(['why'])
    expect(t.accepted('b')).toEqual(['target b'])
    expect(t.canonical('x')).toBe('ex')
    expect(t.hasAccepted('b')).toBe(false)
    expect(t.hasText('b')).toBe(true)
    expect(makeTextResolver(cats, 'en').text('b')).toBeUndefined()
  })
})
