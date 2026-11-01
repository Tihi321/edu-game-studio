import { describe, expect, it } from 'vitest'
import { assembleCourse } from '../src/engine/edu/assemble'
import { authoredItemSchema } from '../src/engine/edu/authoring'
import { renderItemForCheck } from '../src/engine/edu/pipeline-handlers'
import { lintGameData, type LintProblem } from '../src/engine/edu/lint'
import { conjugationSchema, type ConjugationItem } from '../src/shared/course'
import { checkItem, makeCheckContext, makeTextResolver, solveItem, validateCourse } from '../src/shared/edu'
import { GAME_DATA_FORMAT, GAME_DATA_VERSION, type GameData } from '../src/shared/game-data'
import { selectQuestions } from '../src/shared/live'
import { gradeOf, timerApplies } from '../src/player/round'
import { buildSave, itemTextFields, labelForPath, noEdits } from '../src/renderer/lib/items'
import { assembleInput } from './edu-authored-fixture'
import { loadFixture } from './edu-fixtures'

/** The `conjugation` item kind (EGS-27): checker, lint codes, authoring, assembling, live quiz, grade, editor model. */

const fx = await loadFixture('de-verbs-a1')
const item = (id: string): ConjugationItem => fx.pack.items.find((i) => i.id === id) as unknown as ConjugationItem
const ctx = (lang = 'en', over: Record<string, unknown> = {}) => ({ ...makeCheckContext({ pack: fx.pack, text: makeTextResolver(fx.catalogs, lang, 'de') }), ...over })

function parse(raw: Record<string, unknown>): ConjugationItem {
  return conjugationSchema.parse({ id: 'i1', objective: 'o', prompt: 'p', explanation: 'x', ...raw })
}

describe('checkConjugation', () => {
  const sein = item('c-sein')
  const right = { ich: 'bin', du: 'bist', er: 'ist', wir: 'sind', ihr: 'seid' }

  it('all forms right: correct, score 1, expected holds every canonical form', () => {
    const r = checkItem(sein, right, ctx())
    expect(r).toMatchObject({ correct: true, score: 1, detail: { ich: true, du: true, er: true, wir: true, ihr: true } })
    expect(r.expected).toEqual(right)
  })

  it('some right: partial with a per-person detail; none right: score 0', () => {
    expect(checkItem(sein, { ...right, du: 'ist', ihr: 'sind' }, ctx())).toMatchObject({ correct: false, partial: true, score: 0.6, detail: { du: false, ihr: false, ich: true } })
    expect(checkItem(sein, { ich: 'x', du: 'x', er: 'x', wir: 'x', ihr: 'x' }, ctx())).toMatchObject({ correct: false, partial: false, score: 0 })
  })

  it('a one-letter slip is wrong because typos are off (seit for seid, gehst for gehe)', () => {
    expect(checkItem(sein, { ...right, ihr: 'seit' }, ctx()).detail?.ihr).toBe(false)
    expect(checkItem(sein, { ...right, ihr: 'seid ' }, ctx()).detail?.ihr).toBe(true)
    const gehen = item('c-gehen')
    const asked = { ich: 'gehst', du: 'gehst', er: 'geht' }
    expect(checkItem(gehen, asked, ctx())).toMatchObject({ detail: { ich: false, du: true, er: true } })
    // even when the course allows typos
    expect(checkItem(gehen, asked, ctx('en', { typos: true })).detail?.ich).toBe(false)
  })

  it('transliteration and capitals are right with a note flag, never a typo', () => {
    const koennen = parse({
      kind: 'conjugation',
      verb: 'v',
      tense: 'konjunktiv2',
      forms: [
        { person: 'ich', label: 'l1', answer: 'a1' },
        { person: 'du', label: 'l2', answer: 'a2' }
      ]
    })
    const cat = { schema: 1 as const, lang: 'de', strings: { v: 'können', l1: 'ich', l2: 'du' }, accepted: { a1: ['könnte'], a2: ['könntest'] } }
    const c = makeCheckContext({ pack: { targetLang: 'de', matching: { diacritics: 'ignore', typos: true } }, text: makeTextResolver({ de: cat }, 'de', 'de') })
    expect(checkItem(koennen, { ich: 'koennte', du: 'Könntest' }, c)).toMatchObject({ correct: true, translit: true })
    expect(checkItem(koennen, { ich: 'konnte', du: 'könntest' }, c).detail?.ich).toBe(false)
  })

  it('ask: only the presented persons are checked; the given form is never asked', () => {
    const gehen = item('c-gehen')
    expect(solveItem(gehen, ctx())).toEqual({ ich: 'gehe', du: 'gehst', er: 'geht' })
    expect(checkItem(gehen, { ich: 'gehe', er: 'geht', wir: 'gehen' }, ctx())).toMatchObject({ correct: true, score: 1 })
    // the wrong number of forms, the given form or a wrong shape is invalid or wrong, never an exception
    expect(checkItem(gehen, { ich: 'gehe' }, ctx())).toMatchObject({ correct: false, invalid: true })
    expect(checkItem(gehen, { ihr: 'geht', ich: 'gehe', du: 'gehst' }, ctx()).correct).toBe(false)
    expect(checkItem(gehen, 'gehe', ctx())).toMatchObject({ correct: false, invalid: true })
  })

  it('solve passes the check; the imperative with the pronoun works', () => {
    for (const id of ['c-sein', 'c-gehen', 'c-gehen-imp']) expect(checkItem(item(id), solveItem(item(id), ctx()), ctx()).correct, id).toBe(true)
    expect(checkItem(item('c-gehen-imp'), { du: 'Gehe', ihr: 'geht', Sie: 'gehen Sie' }, ctx()).correct).toBe(true)
    expect(checkItem(item('c-gehen-imp'), { du: 'geh', ihr: 'geht', Sie: 'gehen' }, ctx()).detail?.Sie).toBe(false)
  })

  it('grades: all right good, half or more hard, less again; typing has no timer', () => {
    const grade = (answer: unknown) => gradeOf(sein, answer, checkItem(sein, answer, ctx()))
    expect(grade(right)).toBe('good')
    expect(grade({ ...right, du: 'x', ihr: 'x' })).toBe('hard')
    expect(grade({ ...right, du: 'x', ihr: 'x', er: 'x' })).toBe('again')
    expect(timerApplies(sein as never)).toBe(false)
  })
})

describe('conjugation: validation and lint codes', () => {
  function game(): GameData {
    return structuredClone({
      format: GAME_DATA_FORMAT,
      version: GAME_DATA_VERSION,
      slug: 'de-verbs-a1',
      builtAt: '2026-11-01T00:00:00.000Z',
      engine: 'test',
      pack: fx.pack,
      catalogs: fx.catalogs,
      defaultLang: 'hr',
      assets: {},
      shell: 'quiz-arena'
    }) as GameData
  }
  const conj = (g: GameData, id: string): Record<string, unknown> => g.pack.items.find((i) => i.id === id) as unknown as Record<string, unknown>
  const only = (g: GameData, code: string): LintProblem[] => lintGameData(g, () => true).filter((p) => p.code === code)

  it('the fixture lints clean', () => {
    expect(lintGameData(game(), () => true)).toEqual([])
  })

  it('CONJ_PERSON_DUPLICATE: a person twice', () => {
    const g = game()
    ;(conj(g, 'c-sein').forms as { person: string }[])[4]!.person = 'ich'
    expect(only(g, 'CONJ_PERSON_DUPLICATE')[0]).toMatchObject({ severity: 'error' })
  })

  it('CONJ_ASK_TOO_MANY: ask larger than the asked forms', () => {
    const g = game()
    conj(g, 'c-gehen').ask = 5
    expect(only(g, 'CONJ_ASK_TOO_MANY')[0]).toMatchObject({ severity: 'error' })
    conj(g, 'c-gehen').ask = 4
    expect(only(g, 'CONJ_ASK_TOO_MANY')).toEqual([])
  })

  it('CONJ_IMPERATIVE_PERSON: wir in the imperative of a German course, not in another language', () => {
    const g = game()
    ;(conj(g, 'c-gehen-imp').forms as { person: string }[])[0]!.person = 'wir'
    expect(only(g, 'CONJ_IMPERATIVE_PERSON')[0]).toMatchObject({ severity: 'error' })
    ;(g.pack as unknown as Record<string, unknown>).targetLang = 'hr'
    expect(only(g, 'CONJ_IMPERATIVE_PERSON')).toEqual([])
  })

  it('CONJ_FORM_DUPLICATE_AMBIGUOUS is a warning for two asked persons with the same form, none when one is given', () => {
    const g = game()
    const forms = conj(g, 'c-gehen').forms as { person: string; given: boolean }[]
    g.catalogs.de!.accepted!['item.c-gehen.form.wir'] = ['gehst'] // wir = du
    expect(only(g, 'CONJ_FORM_DUPLICATE_AMBIGUOUS')[0]).toMatchObject({ severity: 'warning' })
    forms.find((f) => f.person === 'wir')!.given = true
    expect(only(g, 'CONJ_FORM_DUPLICATE_AMBIGUOUS')).toEqual([])
  })

  it('CONJ_FORM_MISMATCH and CONJ_VERB_UNKNOWN (EGS-28) work on the real kind', () => {
    const g = game()
    g.catalogs.de!.accepted!['item.c-sein.form.er'] = ['bist']
    expect(only(g, 'CONJ_FORM_MISMATCH')[0]).toMatchObject({ severity: 'error' })
    g.catalogs.de!.strings['item.c-gehen.verb'] = 'quatschen'
    expect(only(g, 'CONJ_VERB_UNKNOWN')[0]).toMatchObject({ severity: 'warning' })
  })

  it('validate: an item with every form given is refused', () => {
    const g = game()
    for (const f of conj(g, 'c-sein').forms as { given: boolean }[]) f.given = true
    expect(validateCourse(g.pack, g.catalogs).problems.map((p) => p.code)).toContain('CONJ_NOTHING_ASKED')
  })
})

describe('conjugation: authoring and assembling', () => {
  const written = {
    id: 'v1',
    kind: 'conjugation',
    objective: 'u1-o1',
    taught: true,
    verb: 'gehen',
    tense: 'praesens',
    prompt: 'Conjugate gehen.',
    explanation: 'Regular verb.',
    facts: ['f1'],
    forms: [
      { person: 'ich', accepted: ['gehe'] },
      { person: 'du', accepted: ['gehst'] },
      { person: 'er', accepted: ['geht'] }
    ],
    given: ['er'],
    ask: 2
  }

  it('the item-writer shape parses; mistakes say what to fix', () => {
    expect(authoredItemSchema.safeParse(written).success).toBe(true)
    const msg = (over: Record<string, unknown>): string => JSON.stringify(authoredItemSchema.safeParse({ ...written, ...over }).error?.issues ?? [])
    expect(msg({ forms: [{ person: 'ich', accepted: ['gehe'] }, { person: 'ich', accepted: ['gehe'] }] })).toContain('used twice')
    expect(msg({ given: ['wir'] })).toContain('not one of the forms')
    expect(msg({ ask: 3 })).toContain('only 2 form(s) are asked')
    expect(msg({ forms: [{ person: 'ich', accepted: [] }, { person: 'du', accepted: ['gehst'] }] })).toContain('accepted')
  })

  it('renders for the fact-checker', () => {
    const text = renderItemForCheck(authoredItemSchema.parse(written)).text
    expect(text).toContain('Verb: gehen (praesens)')
    expect(text).toContain('er: geht (given)')
  })

  it('assembles into catalogs: taught forms in de.json, prompt in the edition', () => {
    const items = [...assembleInput().items, authoredItemSchema.parse(written)]
    const { pack, catalogs } = assembleCourse(assembleInput({ items, sourceLang: 'hr', targetLang: 'de' }))
    const built = (pack.items as unknown as { id: string }[]).find((i) => i.id === 'v1') as unknown as ConjugationItem
    expect(built).toMatchObject({ kind: 'conjugation', verb: 'item.v1.verb', tense: 'praesens', ask: 2 })
    expect(built.forms.map((f) => [f.person, f.given])).toEqual([
      ['ich', false],
      ['du', false],
      ['er', true]
    ])
    expect(catalogs.de!.strings['item.v1.verb']).toBe('gehen')
    expect(catalogs.de!.accepted!['item.v1.form.du']).toEqual(['gehst'])
    expect(catalogs.de!.strings['item.v1.form.er.label']).toBe('er / sie / es')
    expect(catalogs.hr!.strings['item.v1.prompt']).toBe('Conjugate gehen.')
    expect(catalogs.hr!.strings['item.v1.verb']).toBeUndefined()
    expect(validateCourse(pack, catalogs).problems).toEqual([])
  })
})

describe('conjugation: live quiz and studio editor', () => {
  it('the live quiz skips the kind', () => {
    const qs = selectQuestions(fx.pack, fx.catalogs, 'en', { count: 50, seed: 1 })
    expect(qs.length).toBeGreaterThan(0)
    expect(qs.some((q) => q.itemId.startsWith('c-'))).toBe(false)
  })

  it('the editor model lists the texts of the item and saves tense, ask and given', () => {
    const sein = item('c-sein')
    const fields = itemTextFields(sein as never, fx.pack, fx.catalogs, 'en')
    expect(fields.map((f) => f.path)).toEqual(expect.arrayContaining(['prompt', 'verb', 'forms[0].label', 'forms[0].answer']))
    expect(labelForPath('forms[1].answer')).toContain('Form 2')
    const draft = { ...sein, ask: 2, tense: 'perfekt', forms: sein.forms.map((f) => (f.person === 'ich' ? { ...f, given: true } : f)) }
    expect(buildSave(sein as never, draft as never, noEdits(), fx.pack, fx.catalogs, 'en')?.patch).toMatchObject({ ask: 2, tense: 'perfekt' })
    const cleared = { ...draft, ask: undefined }
    expect(buildSave(draft as never, cleared as never, noEdits(), fx.pack, fx.catalogs, 'en')?.patch).toEqual({ ask: null })
  })
})
