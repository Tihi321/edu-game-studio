import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { lintGame, lintGameData, summarize, type LintProblem } from '../src/engine/edu/lint'
import { GAME_DATA_FORMAT, GAME_DATA_VERSION, type GameData } from '../src/shared/game-data'
import { FIXTURES, loadFixture } from './edu-fixtures'
import { copyFixture, fakeBundle, tmp, useTemp } from './edu-build-helpers'

useTemp()

type Raw = Record<string, unknown>
type Name = 'solar-system' | 'hr-a1-greetings'

/** The game data of a golden fixture, as the build would write it (a deep copy: mutate freely). */
async function game(name: Name): Promise<GameData> {
  const f = await loadFixture(name)
  const data: GameData = {
    format: GAME_DATA_FORMAT,
    version: GAME_DATA_VERSION,
    slug: name,
    builtAt: '2026-10-29T00:00:00.000Z',
    engine: 'test',
    pack: f.pack,
    catalogs: f.catalogs,
    defaultLang: f.pack.sourceLang,
    assets: Object.fromEntries(f.pack.assets.map((a) => [a.id, `assets/${a.file.replace(/^assets\//, '')}`])),
    shell: 'quiz-arena'
  }
  return structuredClone(data)
}

const lint = (d: GameData, assetExists: (url: string) => boolean = () => true): LintProblem[] => lintGameData(d, assetExists)
const codes = (ps: readonly { code: string }[]): string[] => [...new Set(ps.map((p) => p.code))].sort()
const item = (d: GameData, id: string): Raw => {
  const it = d.pack.items.find((i) => i.id === id)
  if (!it) throw new Error(`no item ${id}`)
  return it as Raw
}
const options = (it: Raw): { id: string; text: string; why?: string }[] => it.options as { id: string; text: string; why?: string }[]
const str = (d: GameData, lang: string, key: string, value: string): void => {
  d.catalogs[lang]!.strings[key] = value
}
const only = (ps: LintProblem[], code: string): LintProblem[] => ps.filter((p) => p.code === code)

describe('lint: the golden fixtures are clean', () => {
  it('solar-system has no problems at all', async () => {
    expect(lint(await game('solar-system'))).toEqual([])
  })

  it('hr-a1-greetings has no errors, only the placeholder audio as warnings', async () => {
    const problems = lint(await game('hr-a1-greetings'))
    expect(problems.filter((p) => p.severity === 'error')).toEqual([])
    expect(codes(problems)).toEqual(['PLACEHOLDER_ASSET'])
    expect(problems.every((p) => p.severity === 'warning')).toBe(true)
    expect(problems).toHaveLength(2)
  })

  for (const name of ['solar-system', 'hr-a1-greetings'] as const) {
    it(`builds and lints ${name} end to end: exit 0`, async () => {
      const bundle = await fakeBundle()
      const { root } = await copyFixture(name)
      const b = await buildCourse(root, undefined, { playerDir: bundle })
      expect(b.ok).toBe(true)
      const r = await lintGame(b.outDir)
      expect(r.errors).toBe(0)
      expect(r.ok).toBe(true)
      expect(r.slug).toBe(name)
    })
  }
})

describe('lint: each rule', () => {
  it('ITEM_NO_KEY: the key points to no option, region or answer', async () => {
    const d = await game('solar-system')
    item(d, 'q-sun-mcq').answer = 'nope'
    item(d, 'q-order-hotspot').answer = 'nowhere'
    item(d, 'q-giants-multi').answers = ['nope']
    const ps = only(lint(d), 'ITEM_NO_KEY')
    expect(ps.map((p) => d.pack.items[Number(/\[(\d+)\]/.exec(p.path)![1])]!.id).sort()).toEqual(['q-giants-multi', 'q-order-hotspot', 'q-sun-mcq'])
    expect(ps.every((p) => p.severity === 'error')).toBe(true)
  })

  it('ITEM_NO_KEY: an item whose own solution does not check right', async () => {
    const d = await game('solar-system')
    expect(only(lint(d), 'ITEM_NO_KEY')).toEqual([])
    const typed = item(d, 'q-giants-typed')
    d.catalogs.en!.accepted = { ...d.catalogs.en!.accepted, [typed.answer as string]: ['!!!'] } // only punctuation: nothing a learner could type
    expect(only(lint(d), 'ITEM_NO_KEY').map((p) => p.path)).toEqual([`items[${d.pack.items.indexOf(typed as never)}]`])
  })

  it('ITEM_MULTI_KEY: a single-answer item with more than one right answer', async () => {
    const d = await game('solar-system')
    const mcq = item(d, 'q-sun-mcq')
    mcq.answers = ['star', 'planet']
    delete mcq.answer
    const tf = item(d, 'q-sun-tf')
    tf.answer = [true, false]
    const ps = only(lint(d), 'ITEM_MULTI_KEY')
    expect(ps).toHaveLength(2)
    expect(ps[0]!.message).toMatch(/exactly one/)
    // multi-select may have many, a type-listening item is not a choice
    expect(only(lint(await game('solar-system')), 'ITEM_MULTI_KEY')).toEqual([])
  })

  it('ACCEPTED_INCOMPLETE: no accepted list in an edition, or an empty entry', async () => {
    const d = await game('solar-system')
    const typed = item(d, 'q-giants-typed')
    const key = typed.answer as string
    delete d.catalogs.hr!.accepted![key]
    let ps = only(lint(d), 'ACCEPTED_INCOMPLETE')
    expect(ps).toHaveLength(1)
    expect(ps[0]!.message).toContain(key)
    expect(ps[0]!.message).toMatch(/in hr\)$/)
    d.catalogs.hr!.accepted![key] = ['Jupiter', '  ']
    ps = only(lint(d), 'ACCEPTED_INCOMPLETE')
    expect(ps).toHaveLength(1)
    expect(ps[0]!.message).toMatch(/is empty/)
    // a cloze gap and a crossword word count as well
    const cloze = item(d, 'q-sun-cloze')
    const gapKey = (cloze.gaps as { answer: string }[])[0]!.answer
    delete d.catalogs.en!.accepted![gapKey]
    expect(only(lint(d), 'ACCEPTED_INCOMPLETE').some((p) => p.path.includes('gaps[0]'))).toBe(true)
  })

  it('DISTRACTOR_DUPLICATE: two options that read the same in an edition', async () => {
    const d = await game('solar-system')
    const mcq = item(d, 'q-sun-mcq')
    const [, a, b] = options(mcq)
    str(d, 'en', a!.text, 'A dwarf planet.')
    str(d, 'en', b!.text, 'a Dwarf  planet!')
    const ps = only(lint(d), 'DISTRACTOR_DUPLICATE')
    expect(ps).toHaveLength(1)
    expect(ps[0]!.message).toMatch(/\(in en\)$/)
    expect(codes(lint(d))).not.toContain('DISTRACTOR_IS_KEY')
  })

  it('DISTRACTOR_IS_KEY: a distractor that reads like the right option, in a mcq and a multi-select', async () => {
    const d = await game('solar-system')
    const mcq = item(d, 'q-sun-mcq')
    const [key, wrong] = options(mcq)
    str(d, 'en', wrong!.text, d.catalogs.en!.strings[key!.text]!.toUpperCase())
    const multi = item(d, 'q-giants-multi')
    const [first] = options(multi)
    const wrongOne = options(multi).find((o) => !(multi.answers as string[]).includes(o.id))!
    str(d, 'hr', wrongOne.text, d.catalogs.hr!.strings[first!.text]!)
    const ps = only(lint(d), 'DISTRACTOR_IS_KEY')
    expect(ps.length).toBeGreaterThanOrEqual(2)
    expect(codes(lint(d))).not.toContain('DISTRACTOR_DUPLICATE')
  })

  it('DISTRACTOR_IS_KEY and DISTRACTOR_DUPLICATE: a cloze word bank', async () => {
    const d = await game('hr-a1-greetings')
    const cloze = item(d, 'g-hello-cloze')
    const gap = (cloze.gaps as { answer: string; bank: string[] }[])[0]!
    expect(only(lint(d), 'DISTRACTOR_IS_KEY')).toEqual([])
    d.catalogs.hr!.strings['t.gap.extra'] = 'vecer'
    gap.bank.push('t.gap.extra')
    const ps = lint(d)
    expect(only(ps, 'DISTRACTOR_IS_KEY').map((p) => p.path)).toEqual([`items[${d.pack.items.indexOf(cloze as never)}].gaps[0].bank[3]`])
    // two bank words that read the same
    const d2 = await game('hr-a1-greetings')
    const gap2 = (item(d2, 'g-hello-cloze').gaps as { bank: string[] }[])[0]!
    d2.catalogs.hr!.strings['t.gap.jutro2'] = 'Jutro!'
    gap2.bank.push('t.gap.jutro2')
    expect(only(lint(d2), 'DISTRACTOR_DUPLICATE')).toHaveLength(1)
  })

  it('DISTRACTOR_IS_KEY: a near-miss list of a typed item that holds an accepted answer', async () => {
    const d = await game('solar-system')
    const typed = item(d, 'q-giants-typed')
    typed.extensions = { nearMisses: ['Saturn', 'jupiter'] }
    const ps = only(lint(d), 'DISTRACTOR_IS_KEY')
    expect(ps).toHaveLength(1)
    expect(ps[0]!.path).toMatch(/extensions\.nearMisses\[1\]$/)
    typed.extensions = { nearMisses: ['Saturn'] }
    expect(only(lint(d), 'DISTRACTOR_IS_KEY')).toEqual([])
  })

  it('OBJECTIVE_ONE_FORM and OBJECTIVE_NO_ITEMS', async () => {
    const d = await game('solar-system')
    d.pack.items = d.pack.items.filter((i) => !(i.objective === 'obj-sun' && i.kind !== 'mcq')).filter((i) => i.objective !== 'obj-moons')
    const ps = lint(d)
    const one = only(ps, 'OBJECTIVE_ONE_FORM')
    expect(one).toHaveLength(1)
    expect(one[0]!.message).toContain('obj-sun')
    expect(one[0]!.message).toContain('Multiple choice')
    const none = only(ps, 'OBJECTIVE_NO_ITEMS')
    expect(none).toHaveLength(1)
    expect(none[0]!.message).toContain('obj-moons')
  })

  it('OBJECTIVE_ONE_FORM counts distinct forms, not items', async () => {
    const d = await game('solar-system')
    // two items of one form are one form; a multi-select is another form than an mcq
    d.pack.items = d.pack.items.filter((i) => !(i.objective === 'obj-sun' && !['mcq', 'true-false'].includes(i.kind)))
    expect(only(lint(d), 'OBJECTIVE_ONE_FORM')).toEqual([])
  })

  it('UNIT_NO_OBJECTIVES', async () => {
    const d = await game('solar-system')
    const unit = d.pack.units[2]!.id
    const gone = new Set(d.pack.objectives.filter((o) => o.unit === unit).map((o) => o.id))
    d.pack.objectives = d.pack.objectives.filter((o) => !gone.has(o.id))
    d.pack.items = d.pack.items.filter((i) => !gone.has(i.objective))
    const ps = only(lint(d), 'UNIT_NO_OBJECTIVES')
    expect(ps).toHaveLength(1)
    expect(ps[0]!.message).toContain(unit)
  })

  it('ASSET_MISSING: a file that is not in the build, or an asset with no URL', async () => {
    const d = await game('solar-system')
    const [a, b] = d.pack.assets
    const missing = d.assets[a!.id]!
    delete d.assets[b!.id]
    const ps = only(lint(d, (url) => url !== missing), 'ASSET_MISSING')
    expect(ps).toHaveLength(2)
    expect(ps.map((p) => p.path).sort()).toEqual(['assets[0]', 'assets[1]'])
    expect(ps.find((p) => p.path === 'assets[0]')!.message).toContain(missing)
  })

  it('TEXT_MISSING: a key without a string, or with an empty one, in any edition', async () => {
    const d = await game('solar-system')
    delete d.catalogs.hr!.strings['q-sun-mcq.prompt']
    str(d, 'en', 'q-sun-tf.explanation', '   ')
    str(d, 'en', d.pack.units[0]!.title, '')
    const ps = only(lint(d), 'TEXT_MISSING')
    expect(ps.map((p) => p.path).sort()).toEqual([`items[${d.pack.items.findIndex((i) => i.id === 'q-sun-mcq')}].prompt`, `items[${d.pack.items.findIndex((i) => i.id === 'q-sun-tf')}].explanation`, 'units[0].title'].sort())
    expect(ps.find((p) => p.path.endsWith('.prompt'))!.message).toMatch(/\(in hr\)$/)
    // not double-reported as the validator's MISSING_TEXT
    expect(codes(lint(d))).not.toContain('MISSING_TEXT')
  })

  it('PREREQ_CYCLE and UNIT_UNREACHABLE', async () => {
    const d = await game('solar-system')
    d.pack.units[0]!.requires = [d.pack.units[2]!.id]
    const ps = lint(d)
    expect(only(ps, 'PREREQ_CYCLE')).toHaveLength(1)
    expect(only(ps, 'PREREQ_CYCLE')[0]!.message).toMatch(/u-sun-planets -> u-rocky-giant -> u-moons-beyond -> u-sun-planets|cycle/)
    expect(only(ps, 'UNIT_UNREACHABLE')).toHaveLength(3)
  })

  it('UNIT_UNREACHABLE: a unit behind an unknown prerequisite (no cycle)', async () => {
    const d = await game('solar-system')
    d.pack.units[2]!.requires = [...d.pack.units[2]!.requires, 'u-ghost']
    const ps = lint(d)
    expect(only(ps, 'PREREQ_CYCLE')).toEqual([])
    expect(only(ps, 'UNIT_UNREACHABLE').map((p) => p.path)).toEqual(['units[2]'])
    expect(codes(ps)).toContain('UNKNOWN_UNIT') // the validator's code is kept
  })

  const placeholders: [string, string][] = [
    ['TODO', 'TODO: write this'],
    ['TBD', 'The answer is TBD.'],
    ['FIXME', 'fixme: later'],
    ['lorem ipsum', 'Lorem ipsum dolor sit amet'],
    ['XXX', 'Mercury is XXX km wide'],
    ['[[', 'See [[the planets]] page'],
    ['stray {{', 'The answer is {{x}}'],
    ['gap marker outside a cloze', 'Fill in {{1}} here'],
    ['placeholder', 'A placeholder explanation']
  ]
  for (const [label, text] of placeholders) {
    it(`PLACEHOLDER: ${label}`, async () => {
      const d = await game('solar-system')
      str(d, 'hr', 'q-sun-tf.explanation', text)
      const ps = only(lint(d), 'PLACEHOLDER')
      expect(ps).toHaveLength(1)
      expect(ps[0]!.severity).toBe('error')
      expect(ps[0]!.path).toBe('text[hr].strings[q-sun-tf.explanation]')
    })
  }

  it('PLACEHOLDER: accepted answers and the pack text are scanned, and ordinary words are not', async () => {
    const d = await game('solar-system')
    d.catalogs.en!.accepted![item(d, 'q-giants-typed').answer as string] = ['Jupiter', 'TODO']
    d.pack.audience = 'lorem ipsum'
    const ps = only(lint(d), 'PLACEHOLDER')
    expect(ps.map((p) => p.path).sort()).toEqual(['audience', `text[en].accepted[${item(d, 'q-giants-typed').answer as string}][1]`].sort())
    const d2 = await game('solar-system')
    str(d2, 'en', 'q-sun-tf.explanation', 'Todos los planetas. Next to the Sun, box XX, a todo-list?')
    expect(only(lint(d2), 'PLACEHOLDER')).toEqual([])
  })

  it('PLACEHOLDER_ASSET is a warning: the asset and the text of an item that uses it may say placeholder', async () => {
    const d = await game('solar-system')
    const asset = d.pack.assets.find((a) => a.kind === 'audio')!
    str(d, 'en', asset.alt, 'A placeholder tone, not speech.')
    const user = d.pack.items.find((i) => i.asset === asset.id)!
    const expl = (user as Raw).explanation as string
    str(d, 'en', expl, 'The clip is a placeholder beep.')
    const ps = lint(d)
    expect(only(ps, 'PLACEHOLDER')).toEqual([])
    const w = only(ps, 'PLACEHOLDER_ASSET')
    expect(w).toHaveLength(1)
    expect(w[0]!.severity).toBe('warning')
    const result = summarize('x', ps)
    expect(result).toMatchObject({ ok: true, errors: 0, warnings: 1 })
  })

  it('the validator problems come with it (SCHEMA, UNKNOWN_*, MISSING_WHY ...), as errors', async () => {
    const d = await game('solar-system')
    d.pack.objectives[0]!.unit = 'u-ghost'
    const mcq = item(d, 'q-sun-mcq')
    delete options(mcq)[1]!.why
    const ps = lint(d)
    expect(codes(ps)).toEqual(expect.arrayContaining(['UNKNOWN_UNIT', 'MISSING_WHY']))
    expect(ps.filter((p) => p.code === 'MISSING_WHY').every((p) => p.severity === 'error')).toBe(true)
  })
})

describe('lint: results and files', () => {
  it('only warnings is ok (exit 0), any error is not', () => {
    const warn: LintProblem = { code: 'PLACEHOLDER_ASSET', severity: 'warning', path: 'assets[0]', message: 'm' }
    const err: LintProblem = { code: 'ITEM_NO_KEY', severity: 'error', path: 'items[0]', message: 'm' }
    expect(summarize('x', [warn])).toMatchObject({ ok: true, errors: 0, warnings: 1 })
    expect(summarize('x', [warn, err])).toMatchObject({ ok: false, errors: 1, warnings: 1 })
    expect(summarize('x', [])).toMatchObject({ ok: true, errors: 0, warnings: 0 })
  })

  it('lintGame says so when game-data.json is missing or is not a game', async () => {
    const dir = await tmp()
    let r = await lintGame(dir)
    expect(r.ok).toBe(false)
    expect(codes(r.problems)).toEqual(['GAME_DATA_INVALID'])
    await writeFile(path.join(dir, 'game-data.json'), '{"format":"other"}')
    r = await lintGame(dir)
    expect(codes(r.problems)).toEqual(['GAME_DATA_INVALID'])
    await writeFile(path.join(dir, 'game-data.json'), 'nope')
    expect((await lintGame(dir)).ok).toBe(false)
  })

  it('lintGame checks the asset files in the build folder', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('solar-system')
    const b = await buildCourse(root, undefined, { playerDir: bundle })
    expect((await lintGame(b.outDir)).ok).toBe(true)
    await rm(path.join(b.outDir, 'assets', 'solar-system.svg'))
    const r = await lintGame(b.outDir)
    expect(codes(r.problems)).toEqual(['ASSET_MISSING'])
    expect(r.ok).toBe(false)
    // an asset path that climbs out of the build folder never counts as present
    const data = JSON.parse(await readFile(path.join(b.outDir, 'game-data.json'), 'utf8')) as GameData
    data.assets[data.pack.assets[0]!.id] = '../course/pack.json'
    await mkdir(b.outDir, { recursive: true })
    await writeFile(path.join(b.outDir, 'game-data.json'), JSON.stringify(data))
    expect(codes((await lintGame(b.outDir)).problems)).toContain('ASSET_MISSING')
  })
})

describe('lint: the broken fixture', () => {
  const expected = async (heading: string): Promise<string[]> => {
    const md = await readFile(path.join(FIXTURES, 'broken', 'EXPECTED.md'), 'utf8')
    const section = md.split(/^## /m).find((s) => s.startsWith(heading))
    if (!section) throw new Error(`EXPECTED.md has no "${heading}" section`)
    return [...section.matchAll(/^- `([A-Z_]+)`/gm)].map((m) => m[1]!).sort()
  }

  it('does not build the normal way, builds with force, and the lint reports exactly the documented codes', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('broken')
    const refused = await buildCourse(root, undefined, { playerDir: bundle })
    expect(refused.ok).toBe(false)
    const forced = await buildCourse(root, undefined, { playerDir: bundle, force: true })
    expect(forced.ok).toBe(true)
    expect(forced.forced).toBe(true)
    expect(codes(forced.problems)).toEqual(await expected('Expected problem codes of the forced build'))

    const r = await lintGame(forced.outDir)
    expect(r.ok).toBe(false)
    expect(codes(r.problems.filter((p) => p.severity === 'error'))).toEqual(await expected('Expected lint error codes'))
    expect(r.warnings).toBe(0)
    // every code the task asks for is there
    for (const c of ['ITEM_MULTI_KEY', 'DISTRACTOR_DUPLICATE', 'DISTRACTOR_IS_KEY', 'OBJECTIVE_ONE_FORM', 'ASSET_MISSING', 'TEXT_MISSING', 'PREREQ_CYCLE', 'UNIT_UNREACHABLE', 'PLACEHOLDER', 'ACCEPTED_INCOMPLETE', 'ITEM_NO_KEY']) {
      expect(codes(r.problems), c).toContain(c)
    }
  })
})

describe('German verb table lint (EGS-28)', () => {
  /** A hr-a1 game turned into a German course with one hand-made conjugation item (the kind itself comes with EGS-27, so it is read structurally). */
  async function germanGame(forms: { person: string; answer: string }[], extra: Raw = {}, cefr: string | undefined = 'A1'): Promise<GameData> {
    const data = await game('hr-a1-greetings')
    ;(data.pack as Raw).targetLang = 'de'
    ;(data.pack as Raw).cefr = cefr
    data.catalogs.de ??= { strings: {} } as GameData['catalogs'][string]
    const de = data.catalogs.de!
    de.strings['item.conj1.verb'] = 'gehen'
    de.accepted ??= {}
    for (const f of forms) {
      de.strings[`item.conj1.form.${f.person}`] = f.answer
      de.accepted[`item.conj1.form.${f.person}`] = [f.answer]
    }
    ;(data.pack.items as unknown as Raw[]).push({
      id: 'conj1', kind: 'conjugation', objective: (data.pack.items[0] as unknown as Raw).objective, verb: 'item.conj1.verb', tense: 'praesens',
      forms: forms.map((f) => ({ person: f.person, answer: `item.conj1.form.${f.person}` })), ...extra
    })
    return data
  }
  const problems = (data: GameData): LintProblem[] => lintGameData(data, () => true).filter((p) => p.code.startsWith('CONJ_'))

  it('reports CONJ_FORM_MISMATCH (error) for "gehst" as the er form', async () => {
    const p = problems(await germanGame([{ person: 'er', answer: 'gehst' }, { person: 'du', answer: 'gehst' }]))
    const hit = p.filter((x) => x.code === 'CONJ_FORM_MISMATCH')
    expect(hit).toHaveLength(1)
    expect(hit[0]!.severity).toBe('error')
    expect(hit[0]!.path).toMatch(/^items\[\d+\]\.forms\[0\]$/)
    expect(hit[0]!.message).toContain('geht')
  })

  it('accepts right forms', async () => {
    expect(problems(await germanGame([{ person: 'er', answer: 'geht' }, { person: 'du', answer: 'gehst' }]))).toEqual([])
  })

  it('warns CONJ_VERB_UNKNOWN for a verb outside the table and does not fail', async () => {
    const data = await germanGame([{ person: 'er', answer: 'geht' }])
    data.catalogs.de!.strings['item.conj1.verb'] = 'quatschen'
    const p = problems(data)
    expect(p.map((x) => [x.code, x.severity])).toEqual([['CONJ_VERB_UNKNOWN', 'warning']])
  })

  it('warns CONJ_TENSE_LEVEL for Konjunktiv II in an A1 course, not in B1', async () => {
    const a1 = await germanGame([{ person: 'ich', answer: 'ginge' }], { tense: 'konjunktiv2' })
    expect(problems(a1).map((x) => [x.code, x.severity])).toEqual([['CONJ_TENSE_LEVEL', 'warning']])
    const b1 = await germanGame([{ person: 'ich', answer: 'ginge' }], { tense: 'konjunktiv2' }, 'B1')
    expect(problems(b1)).toEqual([])
  })

  it('does nothing for a course not taught in German', async () => {
    const data = await germanGame([{ person: 'er', answer: 'gehst' }])
    ;(data.pack as Raw).targetLang = 'hr'
    expect(problems(data)).toEqual([])
  })
})
