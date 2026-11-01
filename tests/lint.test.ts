import { readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { ALL_LINT_CODES, lintGame, lintGameData, summarize, type LintProblem, type LintResult } from '../src/engine/edu/lint'
import { GAME_DATA_FORMAT, GAME_DATA_VERSION, type GameData } from '../src/shared/game-data'
import { builtinItemSchema, type BuiltinItem, type TextCatalog } from '../src/shared/course'
import { checkItem, crosswordFor, hitRegion, makeTextResolver, placementSelection, pointInShape, presentedOrder, solveItem, wordSearchFor, wordsFound, type CheckContext } from '../src/shared/edu'
import { PuzzleError } from '../src/shared/puzzles'
import { SHELL_DEFS, SHELL_LINT_CODES, SHELL_WARNING_CODES, lintShells, validateShellSections } from '../src/shared/shells'
import { detectiveSectionSchema, lintDetective, type DetectiveSection } from '../src/shared/shells/detective'
import type { ShellLintContext } from '../src/shared/shells'
import { loadFixture } from './edu-fixtures'
import { copyFixture, fakeBundle, tmp, useTemp } from './edu-build-helpers'

/**
 * Every lint code, one case each (EGS-42). `CASES` is keyed by code; the enumeration guard at the bottom fails when a code that the
 * source declares has no case (or a case names a code that no longer exists), so a new code cannot be added unnoticed.
 *
 * Shell codes (ENC_, MAZE_, RPG_, RP_, DET_) are rows over the broken-<shell> fixture of the shell (built once with `force`, linted once):
 * the row asserts the code is reported, with the right severity, under the shell's section path.
 */

useTemp()

type Raw = Record<string, unknown>

// ---------- helpers for the pack-level codes ----------

async function game(name: 'solar-system' | 'hr-a1-greetings'): Promise<GameData> {
  const f = await loadFixture(name)
  return structuredClone({
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
  } as GameData)
}
const lint = (d: GameData, assetExists: (url: string) => boolean = () => true): LintProblem[] => lintGameData(d, assetExists)
const codes = (ps: readonly { code: string }[]): string[] => [...new Set(ps.map((p) => p.code))].sort()
const only = (ps: readonly LintProblem[], code: string): LintProblem[] => ps.filter((p) => p.code === code)
const item = (d: GameData, id: string): Raw => {
  const it = d.pack.items.find((i) => i.id === id)
  if (!it) throw new Error(`no item ${id}`)
  return it as Raw
}
const options = (it: Raw): { id: string; text: string; why?: string }[] => it.options as { id: string; text: string; why?: string }[]
const str = (d: GameData, lang: string, key: string, value: string): void => {
  d.catalogs[lang]!.strings[key] = value
}

// ---------- helpers for the shell codes ----------

const SHELL_FIXTURE: Record<string, string> = { ENC_: 'broken-encyclopedia', MAZE_: 'broken-mindmaze', RPG_: 'broken-rpg', RP_: 'broken-roleplay', DET_: 'broken-detective' }
const SHELL_ID: Record<string, string> = { ENC_: 'encyclopedia', MAZE_: 'mindmaze', RPG_: 'rpg', RP_: 'roleplay', DET_: 'detective' }
const brokenRuns = new Map<string, Promise<LintResult>>()
/** The broken fixture is refused by the normal build, builds with `force`, and is linted once per file. */
function brokenLint(name: string): Promise<LintResult> {
  let run = brokenRuns.get(name)
  if (!run) {
    run = (async () => {
      const bundle = await fakeBundle()
      const { root } = await copyFixture(name)
      expect((await buildCourse(root, undefined, { playerDir: bundle })).ok).toBe(false)
      const forced = await buildCourse(root, undefined, { playerDir: bundle, force: true })
      expect(forced.ok && forced.forced).toBe(true)
      return lintGame(forced.outDir)
    })()
    brokenRuns.set(name, run)
  }
  return run
}
function shellRow(code: string): () => Promise<void> {
  const prefix = Object.keys(SHELL_FIXTURE).find((p) => code.startsWith(p))
  if (!prefix) throw new Error(`no broken fixture for ${code}`)
  return async () => {
    const r = await brokenLint(SHELL_FIXTURE[prefix]!)
    const hit = r.problems.filter((p) => p.code === code)
    expect(hit.length, `${code} not reported by ${SHELL_FIXTURE[prefix]}`).toBeGreaterThan(0)
    const severity = SHELL_WARNING_CODES.has(code) ? 'warning' : 'error'
    expect(hit.every((p) => p.severity === severity)).toBe(true)
    expect(hit.every((p) => p.path.startsWith(`shells.config.${SHELL_ID[prefix]}`))).toBe(true)
  }
}

/** Copies `de-b2-reading`, lets the test change the pack and the catalogs, builds and lints (the GLOSS_ rows). */
async function lintReading(edit: (pack: GlossPack, cats: Record<'de' | 'hr' | 'en', { strings: Record<string, string> }>) => void): Promise<LintResult> {
  const bundle = await fakeBundle()
  const { root } = await copyFixture('de-b2-reading')
  const packFile = path.join(root, 'course', 'pack.json')
  const files = { de: path.join(root, 'course', 'text', 'de.json'), hr: path.join(root, 'course', 'text', 'hr.json'), en: path.join(root, 'course', 'text', 'en.json') }
  const pack = JSON.parse(await readFile(packFile, 'utf8')) as GlossPack
  const cats = { de: JSON.parse(await readFile(files.de, 'utf8')), hr: JSON.parse(await readFile(files.hr, 'utf8')), en: JSON.parse(await readFile(files.en, 'utf8')) }
  edit(pack, cats)
  await writeFile(packFile, JSON.stringify(pack, null, 2))
  for (const k of ['de', 'hr', 'en'] as const) await writeFile(files[k], JSON.stringify(cats[k], null, 2))
  const b = await buildCourse(root, undefined, { playerDir: bundle })
  expect(b.problems).toEqual([])
  return lintGame(b.outDir)
}
type Gloss = { id: string; term: string; gloss: string }
type GlossPack = { shells: { config: { encyclopedia: { glossary: Record<string, Gloss[]> } } } }
const GL = 'shells.config.encyclopedia.glossary'

// ---------- German helpers (CONJ_, GRAMMAR_) ----------

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
async function grammarGame(make: (strings: Record<string, string>, accepted: Record<string, string[]>) => Raw): Promise<GameData> {
  const data = await game('hr-a1-greetings')
  ;(data.pack as Raw).targetLang = 'de'
  ;(data.pack as Raw).cefr = 'B2'
  data.catalogs.de ??= { strings: {} } as GameData['catalogs'][string]
  const de = data.catalogs.de!
  de.accepted ??= {}
  const it = make(de.strings, de.accepted)
  ;(data.pack.items as unknown as Raw[]).push({ id: 'g1', objective: (data.pack.items[0] as unknown as Raw).objective, ...it })
  return data
}
const gcloze = (answer: string, grammar: Raw) => (s: Record<string, string>, a: Record<string, string[]>): Raw => {
  s['g1.text'] = 'Die Frau, {{a}} ich helfe, ist nett.'
  s['g1.a'] = answer
  a['g1.a'] = [answer]
  return { kind: 'cloze', text: 'g1.text', gaps: [{ id: 'a', answer: 'g1.a' }], extensions: { grammar } }
}
const prefixed = (d: GameData, p: string): LintProblem[] => lint(d).filter((x) => x.code.startsWith(p))

// ---------- the cases: one per code ----------

const CASES: Record<string, () => Promise<void> | void> = {
  async ITEM_NO_KEY() {
    const d = await game('solar-system')
    expect(only(lint(d), 'ITEM_NO_KEY')).toEqual([])
    item(d, 'q-sun-mcq').answer = 'nope'
    item(d, 'q-order-hotspot').answer = 'nowhere'
    item(d, 'q-giants-multi').answers = ['nope']
    const typed = item(d, 'q-giants-typed')
    d.catalogs.en!.accepted = { ...d.catalogs.en!.accepted, [typed.answer as string]: ['!!!'] } // an own solution that checks wrong
    const ps = only(lint(d), 'ITEM_NO_KEY')
    expect(ps.map((p) => d.pack.items[Number(/\[(\d+)\]/.exec(p.path)![1])]!.id).sort()).toEqual(['q-giants-multi', 'q-giants-typed', 'q-order-hotspot', 'q-sun-mcq'])
    expect(ps.every((p) => p.severity === 'error')).toBe(true)
  },

  async ITEM_MULTI_KEY() {
    const d = await game('solar-system')
    expect(only(lint(d), 'ITEM_MULTI_KEY')).toEqual([]) // multi-select may have many
    const mcq = item(d, 'q-sun-mcq')
    mcq.answers = ['star', 'planet']
    delete mcq.answer
    item(d, 'q-sun-tf').answer = [true, false]
    const ps = only(lint(d), 'ITEM_MULTI_KEY')
    expect(ps).toHaveLength(2)
    expect(ps[0]!.message).toMatch(/exactly one/)
  },

  async ACCEPTED_INCOMPLETE() {
    const d = await game('solar-system')
    const key = item(d, 'q-giants-typed').answer as string
    delete d.catalogs.hr!.accepted![key]
    let ps = only(lint(d), 'ACCEPTED_INCOMPLETE')
    expect(ps).toHaveLength(1)
    expect(ps[0]!.message).toMatch(/in hr\)$/)
    d.catalogs.hr!.accepted![key] = ['Jupiter', '  ']
    ps = only(lint(d), 'ACCEPTED_INCOMPLETE')
    expect(ps).toHaveLength(1)
    expect(ps[0]!.message).toMatch(/is empty/)
    const gapKey = ((item(d, 'q-sun-cloze').gaps as { answer: string }[])[0]!).answer // a cloze gap counts as well
    delete d.catalogs.en!.accepted![gapKey]
    expect(only(lint(d), 'ACCEPTED_INCOMPLETE').some((p) => p.path.includes('gaps[0]'))).toBe(true)
  },

  async DISTRACTOR_DUPLICATE() {
    const d = await game('solar-system')
    const [, a, b] = options(item(d, 'q-sun-mcq'))
    str(d, 'en', a!.text, 'A dwarf planet.')
    str(d, 'en', b!.text, 'a Dwarf  planet!')
    const ps = only(lint(d), 'DISTRACTOR_DUPLICATE')
    expect(ps).toHaveLength(1)
    expect(ps[0]!.message).toMatch(/\(in en\)$/)
    // two cloze bank words that read the same
    const d2 = await game('hr-a1-greetings')
    const gap = (item(d2, 'g-hello-cloze').gaps as { bank: string[] }[])[0]!
    d2.catalogs.hr!.strings['t.gap.jutro2'] = 'Jutro!'
    gap.bank.push('t.gap.jutro2')
    expect(only(lint(d2), 'DISTRACTOR_DUPLICATE')).toHaveLength(1)
  },

  async DISTRACTOR_IS_KEY() {
    // mcq and multi-select
    const d = await game('solar-system')
    const [key, wrong] = options(item(d, 'q-sun-mcq'))
    str(d, 'en', wrong!.text, d.catalogs.en!.strings[key!.text]!.toUpperCase())
    const multi = item(d, 'q-giants-multi')
    const wrongOne = options(multi).find((o) => !(multi.answers as string[]).includes(o.id))!
    str(d, 'hr', wrongOne.text, d.catalogs.hr!.strings[options(multi)[0]!.text]!)
    expect(only(lint(d), 'DISTRACTOR_IS_KEY').length).toBeGreaterThanOrEqual(2)
    // a cloze bank word that reads like the answer
    const d2 = await game('hr-a1-greetings')
    const cloze = item(d2, 'g-hello-cloze')
    expect(only(lint(d2), 'DISTRACTOR_IS_KEY')).toEqual([])
    d2.catalogs.hr!.strings['t.gap.extra'] = 'vecer'
    ;(cloze.gaps as { bank: string[] }[])[0]!.bank.push('t.gap.extra')
    expect(only(lint(d2), 'DISTRACTOR_IS_KEY').map((p) => p.path)).toEqual([`items[${d2.pack.items.indexOf(cloze as never)}].gaps[0].bank[3]`])
    // a typed item's near-miss that is an accepted answer
    const d3 = await game('solar-system')
    item(d3, 'q-giants-typed').extensions = { nearMisses: ['Saturn', 'jupiter'] }
    expect(only(lint(d3), 'DISTRACTOR_IS_KEY').map((p) => p.path)).toEqual([expect.stringMatching(/extensions\.nearMisses\[1\]$/)])
    // regression EGS-53: German keeps umlauts, so warst is no duplicate of wärst
    const d4 = await game('solar-system')
    const [k4, w4] = options(item(d4, 'q-sun-mcq'))
    d4.catalogs.de = structuredClone(d4.catalogs.en!)
    str(d4, 'de', k4!.text, 'wärst')
    str(d4, 'de', w4!.text, 'warst')
    expect(only(lint(d4), 'DISTRACTOR_IS_KEY').filter((p) => p.message.includes('(in de)'))).toEqual([])
    str(d4, 'en', k4!.text, 'wärst')
    str(d4, 'en', w4!.text, 'warst')
    expect(only(lint(d4), 'DISTRACTOR_IS_KEY').filter((p) => p.message.includes('(in en)'))).toHaveLength(1)
  },

  async OBJECTIVE_ONE_FORM() {
    const d = await game('solar-system')
    d.pack.items = d.pack.items.filter((i) => !(i.objective === 'obj-sun' && i.kind !== 'mcq'))
    const one = only(lint(d), 'OBJECTIVE_ONE_FORM')
    expect(one).toHaveLength(1)
    expect(one[0]!.message).toContain('obj-sun')
    // distinct forms count, not items: mcq + true-false are two forms
    const d2 = await game('solar-system')
    d2.pack.items = d2.pack.items.filter((i) => !(i.objective === 'obj-sun' && !['mcq', 'true-false'].includes(i.kind)))
    expect(only(lint(d2), 'OBJECTIVE_ONE_FORM')).toEqual([])
  },

  async OBJECTIVE_NO_ITEMS() {
    const d = await game('solar-system')
    d.pack.items = d.pack.items.filter((i) => i.objective !== 'obj-moons')
    const none = only(lint(d), 'OBJECTIVE_NO_ITEMS')
    expect(none).toHaveLength(1)
    expect(none[0]!.message).toContain('obj-moons')
  },

  async UNIT_NO_OBJECTIVES() {
    const d = await game('solar-system')
    const unit = d.pack.units[2]!.id
    const gone = new Set(d.pack.objectives.filter((o) => o.unit === unit).map((o) => o.id))
    d.pack.objectives = d.pack.objectives.filter((o) => !gone.has(o.id))
    d.pack.items = d.pack.items.filter((i) => !gone.has(i.objective))
    const ps = only(lint(d), 'UNIT_NO_OBJECTIVES')
    expect(ps).toHaveLength(1)
    expect(ps[0]!.message).toContain(unit)
  },

  async ASSET_MISSING() {
    const d = await game('solar-system')
    const [a, b] = d.pack.assets
    const missing = d.assets[a!.id]!
    delete d.assets[b!.id] // an asset with no URL
    const ps = only(lint(d, (url) => url !== missing), 'ASSET_MISSING')
    expect(ps.map((p) => p.path).sort()).toEqual(['assets[0]', 'assets[1]'])
    // end to end: a file removed from the build folder, and a path that climbs out of it
    const bundle = await fakeBundle()
    const { root } = await copyFixture('solar-system')
    const built = await buildCourse(root, undefined, { playerDir: bundle })
    expect((await lintGame(built.outDir)).ok).toBe(true)
    await rm(path.join(built.outDir, 'assets', 'solar-system.svg'))
    expect(codes((await lintGame(built.outDir)).problems)).toEqual(['ASSET_MISSING'])
    const data = JSON.parse(await readFile(path.join(built.outDir, 'game-data.json'), 'utf8')) as GameData
    data.assets[data.pack.assets[0]!.id] = '../course/pack.json'
    await mkdir(built.outDir, { recursive: true })
    await writeFile(path.join(built.outDir, 'game-data.json'), JSON.stringify(data))
    expect(codes((await lintGame(built.outDir)).problems)).toContain('ASSET_MISSING')
  },

  async TEXT_MISSING() {
    const d = await game('solar-system')
    delete d.catalogs.hr!.strings['q-sun-mcq.prompt']
    str(d, 'en', 'q-sun-tf.explanation', '   ')
    str(d, 'en', d.pack.units[0]!.title, '')
    const ps = only(lint(d), 'TEXT_MISSING')
    expect(ps.map((p) => p.path).sort()).toEqual([`items[${d.pack.items.findIndex((i) => i.id === 'q-sun-mcq')}].prompt`, `items[${d.pack.items.findIndex((i) => i.id === 'q-sun-tf')}].explanation`, 'units[0].title'].sort())
    expect(codes(lint(d))).not.toContain('MISSING_TEXT') // not double-reported as the validator's code
    // regression EGS-32: in a language course the edition that lacks the key is named; a taught key in the target catalog serves every edition
    const g = await game('hr-a1-greetings')
    g.pack.languages = ['en', 'de']
    g.catalogs.de = { ...structuredClone(g.catalogs.en!), lang: 'de' }
    delete g.catalogs.en!.strings[Object.keys(g.catalogs.en!.strings).find((k) => k.endsWith('.prompt'))!]
    const lang = only(lint(g), 'TEXT_MISSING')
    expect(lang).toHaveLength(1)
    expect(lang[0]!.message).toMatch(/\(in en\)$/)
  },

  async PREREQ_CYCLE() {
    const d = await game('solar-system')
    d.pack.units[0]!.requires = [d.pack.units[2]!.id]
    expect(only(lint(d), 'PREREQ_CYCLE')).toHaveLength(1)
  },

  async UNIT_UNREACHABLE() {
    const d = await game('solar-system')
    d.pack.units[0]!.requires = [d.pack.units[2]!.id] // a cycle cuts off all three
    expect(only(lint(d), 'UNIT_UNREACHABLE')).toHaveLength(3)
    // a unit behind an unknown prerequisite (no cycle); the validator's code is kept
    const d2 = await game('solar-system')
    d2.pack.units[2]!.requires = [...d2.pack.units[2]!.requires, 'u-ghost']
    const ps = lint(d2)
    expect(only(ps, 'PREREQ_CYCLE')).toEqual([])
    expect(only(ps, 'UNIT_UNREACHABLE').map((p) => p.path)).toEqual(['units[2]'])
    expect(codes(ps)).toContain('UNKNOWN_UNIT')
  },

  async PLACEHOLDER() {
    const texts = ['TODO: write this', 'The answer is TBD.', 'fixme: later', 'Lorem ipsum dolor sit amet', 'Mercury is XXX km wide', 'See [[the planets]] page', 'The answer is {{x}}', 'Fill in {{1}} here', 'A placeholder explanation']
    for (const text of texts) {
      const d = await game('solar-system')
      str(d, 'hr', 'q-sun-tf.explanation', text)
      const ps = only(lint(d), 'PLACEHOLDER')
      expect(ps, text).toHaveLength(1)
      expect(ps[0]!.severity).toBe('error')
      expect(ps[0]!.path).toBe('text[hr].strings[q-sun-tf.explanation]')
    }
    // accepted answers and the pack text are scanned; ordinary words are not
    const d = await game('solar-system')
    d.catalogs.en!.accepted![item(d, 'q-giants-typed').answer as string] = ['Jupiter', 'TODO']
    d.pack.audience = 'lorem ipsum'
    expect(only(lint(d), 'PLACEHOLDER').map((p) => p.path).sort()).toEqual(['audience', `text[en].accepted[${item(d, 'q-giants-typed').answer as string}][1]`].sort())
    const ok = await game('solar-system')
    str(ok, 'en', 'q-sun-tf.explanation', 'Todos los planetas. Next to the Sun, box XX, a todo-list?')
    expect(only(lint(ok), 'PLACEHOLDER')).toEqual([])
  },

  async PLACEHOLDER_ASSET() {
    const d = await game('solar-system')
    const asset = d.pack.assets.find((a) => a.kind === 'audio')!
    str(d, 'en', asset.alt, 'A placeholder tone, not speech.')
    const user = d.pack.items.find((i) => i.asset === asset.id)!
    str(d, 'en', (user as Raw).explanation as string, 'The clip is a placeholder beep.')
    const ps = lint(d)
    expect(only(ps, 'PLACEHOLDER')).toEqual([])
    const w = only(ps, 'PLACEHOLDER_ASSET')
    expect(w).toHaveLength(1)
    expect(w[0]!.severity).toBe('warning')
    expect(summarize('x', ps)).toMatchObject({ ok: true, errors: 0, warnings: 1 }) // warnings alone exit 0; any error does not
    expect(summarize('x', [...ps, { code: 'ITEM_NO_KEY', severity: 'error', path: 'items[0]', message: 'm' }])).toMatchObject({ ok: false, errors: 1 })
  },

  async GAME_DATA_INVALID() {
    const dir = await tmp()
    expect(codes((await lintGame(dir)).problems)).toEqual(['GAME_DATA_INVALID']) // no file
    await writeFile(path.join(dir, 'game-data.json'), '{"format":"other"}')
    expect(codes((await lintGame(dir)).problems)).toEqual(['GAME_DATA_INVALID'])
    await writeFile(path.join(dir, 'game-data.json'), 'nope')
    expect((await lintGame(dir)).ok).toBe(false)
  },

  // ----- German verb table (EGS-28) -----
  async CONJ_FORM_MISMATCH() {
    const p = prefixed(await germanGame([{ person: 'er', answer: 'gehst' }, { person: 'du', answer: 'gehst' }]), 'CONJ_')
    const hit = only(p, 'CONJ_FORM_MISMATCH')
    expect(hit).toHaveLength(1)
    expect(hit[0]!.severity).toBe('error')
    expect(hit[0]!.message).toContain('geht')
    expect(prefixed(await germanGame([{ person: 'er', answer: 'geht' }, { person: 'du', answer: 'gehst' }]), 'CONJ_')).toEqual([]) // right forms pass
    const hr = await germanGame([{ person: 'er', answer: 'gehst' }])
    ;(hr.pack as Raw).targetLang = 'hr' // not taught in German: nothing to check
    expect(prefixed(hr, 'CONJ_')).toEqual([])
    // a Passiv item is checked against its tense
    const passiv = (answer: string) => async () =>
      grammarGame((s, a) => {
        s['g1.verb'] = 'machen'; s['g1.f'] = answer; a['g1.f'] = [answer]; s['g1.l'] = 'er'; s['g1.f2'] = 'wurdest gemacht'; a['g1.f2'] = ['wurdest gemacht']; s['g1.l2'] = 'du'
        return { kind: 'conjugation', verb: 'g1.verb', tense: 'passiv-praeteritum', forms: [{ person: 'er', label: 'g1.l', answer: 'g1.f' }, { person: 'du', label: 'g1.l2', answer: 'g1.f2' }] }
      })
    expect(prefixed(await passiv('wurde gemacht')(), 'CONJ_')).toEqual([])
    expect(codes(prefixed(await passiv('wird gemacht')(), 'CONJ_'))).toEqual(['CONJ_FORM_MISMATCH'])
  },

  async CONJ_VERB_UNKNOWN() {
    const data = await germanGame([{ person: 'er', answer: 'geht' }])
    data.catalogs.de!.strings['item.conj1.verb'] = 'quatschen'
    expect(prefixed(data, 'CONJ_').map((x) => [x.code, x.severity])).toEqual([['CONJ_VERB_UNKNOWN', 'warning']])
  },

  async CONJ_TENSE_LEVEL() {
    const a1 = await germanGame([{ person: 'ich', answer: 'ginge' }], { tense: 'konjunktiv2' })
    expect(prefixed(a1, 'CONJ_').map((x) => [x.code, x.severity])).toEqual([['CONJ_TENSE_LEVEL', 'warning']])
    expect(prefixed(await germanGame([{ person: 'ich', answer: 'ginge' }], { tense: 'konjunktiv2' }, 'B1'), 'CONJ_')).toEqual([])
  },

  // ----- German B2 grammar (EGS-37) -----
  async GRAMMAR_FORM_MISMATCH() {
    const rel = { kind: 'relative', gender: 'f', case: 'dat' }
    expect(prefixed(await grammarGame(gcloze('der', rel)), 'GRAMMAR_')).toEqual([])
    const bad = prefixed(await grammarGame(gcloze('die', rel)), 'GRAMMAR_')
    expect(bad.map((p) => [p.code, p.severity])).toEqual([['GRAMMAR_FORM_MISMATCH', 'error']])
    expect(bad[0]!.message).toContain('der')
    expect(prefixed(await grammarGame(gcloze('mit der', { ...rel, prep: 'mit' })), 'GRAMMAR_')).toEqual([]) // a preposition
    expect(codes(prefixed(await grammarGame(gcloze('der', { kind: 'relative', gender: 'x', case: 'dat' })), 'GRAMMAR_'))).toEqual(['GRAMMAR_FORM_MISMATCH'])
    const hr = await grammarGame(gcloze('die', rel))
    ;(hr.pack as Raw).targetLang = 'hr' // not taught in German: ignored
    expect(prefixed(hr, 'GRAMMAR_')).toEqual([])
  },

  async GRAMMAR_CONNECTOR_CLASS() {
    expect(prefixed(await grammarGame(gcloze('weil', { kind: 'connector', class: 'verb-final' })), 'GRAMMAR_')).toEqual([])
    expect(prefixed(await grammarGame(gcloze('deshalb', { kind: 'connector', class: 'verb-final' })), 'GRAMMAR_').map((p) => [p.code, p.severity])).toEqual([['GRAMMAR_CONNECTOR_CLASS', 'error']])
    const sort = (weilGroup: string) => (s: Record<string, string>): Raw => {
      for (const [k, v] of Object.entries({ 'g1.vf': 'Verb am Ende', 'g1.inv': 'Inversion', 'g1.w': 'weil', 'g1.d': 'deshalb' })) s[k] = v
      return {
        kind: 'sort-groups', groups: [{ id: 'vf', title: 'g1.vf' }, { id: 'inv', title: 'g1.inv' }],
        items: [{ id: 'w', text: 'g1.w', group: weilGroup }, { id: 'd', text: 'g1.d', group: 'inv' }],
        extensions: { grammar: { kind: 'connector-sort', groups: { vf: 'verb-final', inv: 'inversion' } } }
      }
    }
    expect(prefixed(await grammarGame(sort('vf')), 'GRAMMAR_')).toEqual([])
    expect(codes(prefixed(await grammarGame(sort('inv')), 'GRAMMAR_'))).toEqual(['GRAMMAR_CONNECTOR_CLASS'])
  },

  async GRAMMAR_TRANSFORM_ONE_ANSWER() {
    const make = (variants: string[]) => (s: Record<string, string>, a: Record<string, string[]>): Raw => {
      s['g1.q'] = 'Man kauft das Haus. (Passiv)'
      s['g1.ans'] = variants[0]!
      a['g1.ans'] = variants
      return { kind: 'typed', prompt: 'g1.q', answer: 'g1.ans', extensions: { grammar: { kind: 'transform' } } }
    }
    expect(prefixed(await grammarGame(make(['Das Haus wird gekauft.'])), 'GRAMMAR_').map((p) => [p.code, p.severity])).toEqual([['GRAMMAR_TRANSFORM_ONE_ANSWER', 'warning']])
    expect(prefixed(await grammarGame(make(['Das Haus wird gekauft.', 'Das Haus wird von jemandem gekauft.'])), 'GRAMMAR_')).toEqual([])
  },

  // ----- the shared shell codes -----
  async SHELL_SCHEMA() {
    const f = await loadFixture('solar-system')
    const bad = structuredClone(f.pack)
    ;(bad.shells.config as Raw).rpg = { ...(bad.shells.config.rpg as Raw), nope: 1 } // a stray field
    expect(validateShellSections(bad).problems.map((p) => p.code)).toContain('SHELL_SCHEMA')
    for (const def of SHELL_DEFS.values()) expect(def.schema.safeParse({ stray_key_for_the_test: 1 }).success, def.id).toBe(false)
  },

  async SHELL_UNKNOWN() {
    const f = await loadFixture('hr-a1-greetings')
    const p = { ...f.pack, shells: { ...f.pack.shells, enabled: [...f.pack.shells.enabled, 'pinball'] } }
    const ps = lintShells({ pack: p, catalogs: f.catalogs }, {})
    expect(ps).toContainEqual(expect.objectContaining({ code: 'SHELL_UNKNOWN', severity: 'warning' }))
  },

  async SHELL_SECTION_MISSING() {
    const f = await loadFixture('solar-system')
    const pack = structuredClone(f.pack)
    pack.shells.enabled = [...new Set([...pack.shells.enabled, 'roleplay'])]
    delete pack.shells.config.roleplay // the role-play shell requires its section
    const resolvers = Object.fromEntries(pack.languages.map((l) => [l, makeTextResolver(f.catalogs, l, pack.targetLang)]))
    const ps = lintShells({ pack, catalogs: f.catalogs }, resolvers)
    expect(ps.filter((p) => p.code === 'SHELL_SECTION_MISSING').map((p) => p.path)).toEqual(['shells.config.roleplay'])
  },

  // ----- the glossary of a reading (EGS-35) -----
  async GLOSS_TERM_NOT_IN_TEXT() {
    const r = await lintReading((_p, c) => {
      c.de.strings['art.art-homeoffice.gl.pendeln.term'] = 'Pendler'
    })
    const hit = only(r.problems, 'GLOSS_TERM_NOT_IN_TEXT')
    expect(hit.map((p) => p.path)).toEqual([`${GL}.art-homeoffice[4].term`])
    expect(hit[0]!.severity).toBe('error')
  },

  async GLOSS_DUPLICATE() {
    const r = await lintReading((p) => {
      p.shells.config.encyclopedia.glossary['art-radverkehr']!.push({ id: 'again', term: 'art.art-radverkehr.gl.stau.term', gloss: 'art.art-radverkehr.gl.stau.gloss' })
    })
    const hit = only(r.problems, 'GLOSS_DUPLICATE')
    expect(hit.map((p) => p.path)).toEqual([`${GL}.art-radverkehr[12].term`])
    expect(hit[0]!.severity).toBe('error')
  },

  async GLOSS_COVERAGE() {
    const r = await lintReading((p) => {
      p.shells.config.encyclopedia.glossary['art-homeoffice'] = (p.shells.config.encyclopedia.glossary['art-homeoffice'] ?? []).slice(0, 5)
    })
    expect(only(r.problems, 'GLOSS_COVERAGE').map((p) => [p.path, p.severity])).toEqual([[`${GL}.art-homeoffice`, 'warning']])
    expect(r.ok).toBe(true)
  },

  // ----- detective puzzle codes, with an injected case builder -----
  DET_PUZZLE_INVALID: () => detPuzzle('no easy puzzle found for seed 1', 'DET_PUZZLE_INVALID'),
  DET_PUZZLE_NOT_UNIQUE: () => detPuzzle('the puzzle does not have exactly one solution', 'DET_PUZZLE_NOT_UNIQUE'),
  DET_PUZZLE_UNSOLVABLE: () => detPuzzle('the puzzle cannot be solved by deduction alone', 'DET_PUZZLE_UNSOLVABLE')
}

async function detPuzzle(message: string, code: string): Promise<void> {
  const f = await loadFixture('solar-system')
  const section = detectiveSectionSchema.parse(f.pack.shells.config.detective) as DetectiveSection
  const ctx: ShellLintContext = { pack: f.pack, catalogs: f.catalogs, editions: f.pack.languages, resolvers: Object.fromEntries(f.pack.languages.map((l) => [l, makeTextResolver(f.catalogs, l, f.pack.targetLang)])) }
  expect(codes(lintDetective(section, ctx, { build: () => { throw new PuzzleError(message) } }))).toEqual([code])
}

// The shell rows are generated: every shell code that a broken fixture can report gets its row.
const HAND_WRITTEN = new Set(Object.keys(CASES))
for (const code of SHELL_LINT_CODES) if (!HAND_WRITTEN.has(code) && Object.keys(SHELL_FIXTURE).some((p) => code.startsWith(p))) CASES[code] = shellRow(code)

/** Codes whose single case lives in a file this ticket does not own (German-specific or pipeline files); the guard checks the case is there. */
const ELSEWHERE: Record<string, string> = {
  CONJ_PERSON_DUPLICATE: 'conjugation.test.ts',
  CONJ_ASK_TOO_MANY: 'conjugation.test.ts',
  CONJ_IMPERATIVE_PERSON: 'conjugation.test.ts',
  CONJ_FORM_DUPLICATE_AMBIGUOUS: 'conjugation.test.ts',
  ITEM_NO_FACT: 'edu-assemble.test.ts',
  ARTICLE_NO_CITATION: 'edu-assemble.test.ts',
  READING_LENGTH: 'edu-reading.test.ts',
  READING_SENTENCE_LENGTH: 'edu-reading.test.ts',
  READING_ITEM_NO_PASSAGE: 'edu-reading.test.ts',
  READING_ITEM_COUNT: 'edu-reading.test.ts',
  TFNG_OPTIONS: 'edu-reading.test.ts',
  SELFCHECK_NO_MODEL: 'edu-reading.test.ts'
}

describe('lint: one case per code', () => {
  for (const [code, fn] of Object.entries(CASES)) it(code, fn, 60_000)
})

describe('lint: the golden fixtures are clean', () => {
  it('solar-system has no problems; hr-a1-greetings only the placeholder audio as warnings', async () => {
    expect(lint(await game('solar-system'))).toEqual([])
    const problems = lint(await game('hr-a1-greetings'))
    expect(codes(problems)).toEqual(['PLACEHOLDER_ASSET'])
    expect(problems.every((p) => p.severity === 'warning')).toBe(true)
  })

  it('every golden fixture builds and lints end to end with no shell problem, with and without its section (the automatic layout)', async () => {
    for (const name of ['solar-system', 'european-capitals', 'hr-a1-greetings'] as const) {
      for (const dropSections of [false, true]) {
        const bundle = await fakeBundle()
        const { root } = await copyFixture(name)
        if (dropSections) {
          const file = path.join(root, 'course', 'pack.json')
          const pack = JSON.parse(await readFile(file, 'utf8')) as { shells: { config: Record<string, unknown> } }
          delete pack.shells.config.encyclopedia // these two shells lay a course out by themselves
          delete pack.shells.config.rpg
          await writeFile(file, JSON.stringify(pack, null, 2))
        }
        const b = await buildCourse(root, undefined, { playerDir: bundle })
        expect(b.problems, name).toEqual([])
        const r = await lintGame(b.outDir)
        expect(r.errors, name).toBe(0)
        expect(r.problems.filter((p) => /^(ENC|MAZE|RPG|RP|DET|GLOSS|SHELL)_/.test(p.code)), name).toEqual([])
      }
    }
  })

  it('the validator problems come with the lint (UNKNOWN_*, MISSING_WHY ...), as errors', async () => {
    const d = await game('solar-system')
    d.pack.objectives[0]!.unit = 'u-ghost'
    delete options(item(d, 'q-sun-mcq'))[1]!.why
    const ps = lint(d)
    expect(codes(ps)).toEqual(expect.arrayContaining(['UNKNOWN_UNIT', 'MISSING_WHY']))
    expect(ps.filter((p) => p.code === 'MISSING_WHY').every((p) => p.severity === 'error')).toBe(true)
  })
})

describe('lint: enumeration guard', () => {
  it('every code the source declares has exactly one case here (or one named in ELSEWHERE), and no case is stale', async () => {
    const declared = new Set(ALL_LINT_CODES)
    const missing = [...declared].filter((c) => !(c in CASES) && !(c in ELSEWHERE))
    expect(missing, `lint codes without a case: ${missing.join(', ')}`).toEqual([])
    expect([...Object.keys(CASES), ...Object.keys(ELSEWHERE)].filter((c) => !declared.has(c)), 'cases for codes that no longer exist').toEqual([])
    expect(Object.keys(CASES).filter((c) => c in ELSEWHERE)).toEqual([])
    for (const [code, file] of Object.entries(ELSEWHERE)) expect(await readFile(path.join(import.meta.dirname, file), 'utf8'), `${code} in ${file}`).toContain(`${code}`)
  })

  it('no source file reports a code that the code lists leave out', async () => {
    const declared = new Set(ALL_LINT_CODES)
    const roots = [path.join(import.meta.dirname, '..', 'src', 'shared', 'shells'), path.join(import.meta.dirname, '..', 'src', 'engine', 'edu')]
    const files: string[] = []
    for (const r of roots) for (const f of await readdir(r)) if (/^(lint.*|[a-z-]+)\.ts$/.test(f) && (r.endsWith('shells') || f.startsWith('lint'))) files.push(path.join(r, f))
    const used = new Set<string>()
    for (const f of files) for (const m of (await readFile(f, 'utf8')).matchAll(/\bcode: '((?:ENC|MAZE|RPG|RP|DET|GLOSS|CONJ|GRAMMAR|READING|SHELL)_[A-Z0-9_]+)'/g)) used.add(m[1]!)
    expect(used.size).toBeGreaterThan(30) // the scan finds the codes at all
    expect([...used].filter((c) => !declared.has(c))).toEqual([])
  })
})

// ---------- the item checkers (formerly edu-checkers.test.ts) ----------

const common = { objective: 'o1', prompt: 'p', explanation: 'x' }
const parse = (raw: Record<string, unknown>): BuiltinItem => builtinItemSchema.parse({ id: 'i1', ...common, ...raw })
const en: TextCatalog = {
  schema: 1,
  lang: 'en',
  strings: {},
  accepted: { typed: ['Laku noć', 'Good night'], gap1: ['8', 'eight'], gap2: ['atmosphere'], mars: ['Mars'], earth: ['Earth'], venus: ['Venus'], saturn: ['Saturn'], zem: ['Zemlja'] }
}
const mkCtx = (over: Partial<CheckContext> = {}): CheckContext => ({ text: makeTextResolver({ en }, 'en'), ...over })
const ctx = mkCtx()

describe('checkers: one case per item kind', () => {
  it('mcq and true-false: right, wrong, wrong-shaped', () => {
    const mcq = parse({ kind: 'mcq', options: [{ id: 'a', text: 't.a' }, { id: 'b', text: 't.b', why: 'w.b' }], answer: 'a' })
    expect(checkItem(mcq, 'a', ctx)).toMatchObject({ correct: true, score: 1, expected: 'a' })
    expect(checkItem(mcq, 'b', ctx)).toMatchObject({ correct: false, score: 0, expected: 'a' })
    expect(checkItem(mcq, 3, ctx)).toMatchObject({ correct: false, invalid: true })
    const tf = parse({ kind: 'true-false', answer: false })
    expect(checkItem(tf, false, ctx).correct).toBe(true)
    expect(checkItem(tf, true, ctx)).toMatchObject({ correct: false, expected: false })
    expect(checkItem(tf, 'false', ctx).invalid).toBe(true)
  })

  it('multi-select: exact set, partial credit, a wrong extra pick cancels a right one', () => {
    const ms = parse({ kind: 'multi-select', options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: `t.${id}`, why: `w.${id}` })), answers: ['a', 'b'] })
    expect(checkItem(ms, ['b', 'a'], ctx)).toMatchObject({ correct: true, score: 1 })
    expect(checkItem(ms, ['a'], ctx)).toMatchObject({ correct: false, partial: true, score: 0.5 })
    expect(checkItem(ms, ['a', 'b', 'c'], ctx)).toMatchObject({ correct: false, partial: true, score: 0.5 })
    expect(checkItem(ms, ['a', 'c'], ctx)).toMatchObject({ correct: false, partial: false, score: 0 })
    expect(checkItem(ms, 'a', ctx).invalid).toBe(true)
  })

  it('typed: synonym, typo and accent policy, item override, catalog fallback', () => {
    const typed = parse({ kind: 'typed', answer: 'typed' })
    expect(checkItem(typed, 'Laku noć', ctx)).toMatchObject({ correct: true, expected: 'Laku noć' })
    expect(checkItem(typed, 'good night', ctx).correct).toBe(true)
    expect(checkItem(typed, 'dobro jutro', ctx)).toMatchObject({ correct: false })
    expect(checkItem(typed, 42, ctx).invalid).toBe(true)
    expect(checkItem(typed, 'laku noc', mkCtx({ diacritics: 'warn' }))).toMatchObject({ correct: true, diacritics: true })
    expect(checkItem(typed, 'laku noc', mkCtx({ diacritics: 'strict' }))).toMatchObject({ correct: false, diacritics: true })
    expect(checkItem(typed, 'laku nox', ctx)).toMatchObject({ correct: true, typo: true })
    expect(checkItem(typed, 'laku nox', mkCtx({ typos: false })).correct).toBe(false)
    expect(checkItem(parse({ kind: 'typed', answer: 'typed', strictDiacritics: true }), 'laku noc', mkCtx({ diacritics: 'ignore' }))).toMatchObject({ correct: false, diacritics: true })
    expect(checkItem(parse({ kind: 'typed', answer: 'typed', strictDiacritics: false }), 'laku noc', mkCtx({ diacritics: 'strict' })).correct).toBe(true)
    const c: TextCatalog = { schema: 1, lang: 'en', strings: { only: 'Sunce' } }
    expect(checkItem(parse({ kind: 'typed', answer: 'only' }), 'sunce', { text: makeTextResolver({ en: c }, 'en') }).correct).toBe(true)
  })

  it('cloze: partial credit; a typed gap reports a typo, a banked gap does not (regression EGS-49: macht is not machst)', () => {
    const cloze = parse({ kind: 'cloze', text: 't', gaps: [{ id: '1', answer: 'gap1' }, { id: '2', answer: 'gap2', bank: ['gap2', 'x'] }] })
    expect(checkItem(cloze, { '1': '8', '2': 'Atmosphere' }, ctx)).toMatchObject({ correct: true, score: 1 })
    expect(checkItem(cloze, { '1': 'eight', '2': 'moon' }, ctx)).toMatchObject({ correct: false, partial: true, score: 0.5, detail: { '1': true, '2': false } })
    expect(checkItem(cloze, 'x', ctx).invalid).toBe(true)
    expect(checkItem(cloze, {}, ctx).expected).toEqual({ '1': '8', '2': 'atmosphere' })
    expect(checkItem(parse({ kind: 'cloze', text: 't', gaps: [{ id: '1', answer: 'gap2' }] }), { '1': 'atmosphre' }, ctx)).toMatchObject({ correct: true, typo: true })
    expect(checkItem(cloze, { '1': '8', '2': 'atmosphre' }, ctx)).toMatchObject({ correct: false })
  })

  it('match-pairs: all right, partial, wrong', () => {
    const pairs = parse({ kind: 'match-pairs', pairs: [1, 2, 3, 4].map((n) => ({ id: `p${n}`, left: `l${n}`, right: `r${n}` })) })
    expect(checkItem(pairs, { p1: 'p1', p2: 'p2', p3: 'p3', p4: 'p4' }, ctx)).toMatchObject({ correct: true, score: 1 })
    expect(checkItem(pairs, { p1: 'p1', p2: 'p2', p3: 'p4', p4: 'p3' }, ctx)).toMatchObject({ correct: false, partial: true, score: 0.5 })
    expect(checkItem(pairs, { p1: 'p2', p2: 'p1', p3: 'p4', p4: 'p3' }, ctx)).toMatchObject({ score: 0 })
    expect(checkItem(pairs, ['p1'], ctx).invalid).toBe(true)
  })

  it('order: right, swap, wrong; bad ids are invalid; the shuffle is seeded and never the answer', () => {
    const order = parse({ kind: 'order', timeline: true, items: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: `t.${id}` })) })
    expect(checkItem(order, ['a', 'b', 'c', 'd'], ctx)).toMatchObject({ correct: true, score: 1 })
    expect(checkItem(order, ['b', 'a', 'c', 'd'], ctx)).toMatchObject({ correct: false, partial: true, score: 0.5 })
    expect(checkItem(order, ['d', 'c', 'b', 'a'], ctx)).toMatchObject({ score: 0 })
    expect(checkItem(order, ['a', 'a', 'c', 'd'], ctx).invalid).toBe(true)
    expect(presentedOrder(order as never, 1)).toEqual(presentedOrder(order as never, 1))
    for (let s = 0; s < 20; s++) expect(presentedOrder(order as never, s)).not.toEqual(['a', 'b', 'c', 'd'])
  })

  it('sort-groups: right, partial, wrong', () => {
    const sort = parse({ kind: 'sort-groups', groups: [{ id: 'g1', title: 'g1' }, { id: 'g2', title: 'g2' }], items: [{ id: 'x', text: 'x', group: 'g1' }, { id: 'y', text: 'y', group: 'g2' }, { id: 'z', text: 'z', group: 'g1' }] })
    expect(checkItem(sort, { x: 'g1', y: 'g2', z: 'g1' }, ctx).correct).toBe(true)
    const part = checkItem(sort, { x: 'g1', y: 'g1', z: 'g1' }, ctx)
    expect(part).toMatchObject({ correct: false, partial: true })
    expect(part.score).toBeCloseTo(2 / 3)
    expect(checkItem(sort, 'x', ctx).invalid).toBe(true)
  })

  it('hotspot: a region id or a click point, hit testing of the three shapes', () => {
    const hot = parse({
      kind: 'hotspot', asset: 'img', width: 100, height: 100, answer: 'r',
      regions: [
        { id: 'c', label: 'c', shape: { type: 'circle', cx: 20, cy: 20, r: 10 } },
        { id: 'r', label: 'r', shape: { type: 'rect', x: 50, y: 50, w: 20, h: 10 } },
        { id: 'p', label: 'p', shape: { type: 'poly', points: [[10, 60], [40, 60], [25, 90]] } }
      ]
    }) as Extract<BuiltinItem, { kind: 'hotspot' }>
    expect(checkItem(hot, 'r', ctx).correct).toBe(true)
    expect(checkItem(hot, { x: 60, y: 55 }, ctx).correct).toBe(true)
    expect(checkItem(hot, { x: 20, y: 20 }, ctx)).toMatchObject({ correct: false, expected: 'r' })
    expect(checkItem(hot, { x: 'a' }, ctx).invalid).toBe(true)
    expect(hitRegion(hot, 25, 20)).toBe('c')
    expect(hitRegion(hot, 25, 70)).toBe('p')
    expect(hitRegion(hot, 5, 70)).toBeUndefined()
    expect(pointInShape({ type: 'rect', x: 0, y: 0, w: 5, h: 5 }, 5.1, 5)).toBe(false)
  })

  it('listening (choose and type) and flashcard grades', () => {
    const choose = parse({ kind: 'listening', asset: 'aud', transcript: 't', mode: 'choose', options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b', why: 'w' }], answer: 'b' })
    expect(checkItem(choose, 'b', ctx).correct).toBe(true)
    expect(checkItem(choose, 'a', ctx).correct).toBe(false)
    const type = parse({ kind: 'listening', asset: 'aud', transcript: 't', mode: 'type', answer: 'typed', strictDiacritics: true })
    expect(checkItem(type, 'Laku noć', ctx).correct).toBe(true)
    expect(checkItem(type, 'laku noc', ctx)).toMatchObject({ correct: false, diacritics: true })
    expect(builtinItemSchema.safeParse({ id: 'i', ...common, kind: 'listening', asset: 'a', transcript: 't', mode: 'choose', answer: 'a' }).success).toBe(false)
    const f = parse({ kind: 'flashcard', back: 'b' })
    expect(checkItem(f, 'again', ctx)).toMatchObject({ correct: false, score: 0 })
    expect(checkItem(f, 'hard', ctx)).toMatchObject({ correct: true, partial: true, score: 0.6 })
    expect(checkItem(f, 'easy', ctx)).toMatchObject({ correct: true, score: 1 })
    expect(checkItem(f, 'meh', ctx).invalid).toBe(true)
  })

  it('crossword: letters only, folded (Croatian too), the same grid every time', () => {
    const cross = parse({ kind: 'crossword', seed: 3, words: ['mars', 'earth', 'venus', 'saturn'].map((w) => ({ id: w, answer: w, clue: 'c' })) }) as Extract<BuiltinItem, { kind: 'crossword' }>
    expect(checkItem(cross, { mars: 'MARS', earth: 'earth', venus: ' Venus ', saturn: 'SATURN' }, ctx)).toMatchObject({ correct: true, score: 1 })
    expect(checkItem(cross, { mars: 'mars', earth: 'earth', venus: 'venas', saturn: '' }, ctx)).toMatchObject({ correct: false, partial: true, score: 0.5 })
    expect(checkItem(cross, [], ctx).invalid).toBe(true)
    expect(crosswordFor(cross, ctx).grid).toEqual(crosswordFor(cross, ctx).grid)
    const hr: TextCatalog = { schema: 1, lang: 'hr', strings: {}, accepted: { zem: ['Zemlja'], mjesec: ['Mjesec'], sunce: ['Sunce'] } }
    const item = parse({ kind: 'crossword', seed: 1, words: [{ id: 'z', answer: 'zem', clue: 'c' }, { id: 'm', answer: 'mjesec', clue: 'c' }, { id: 's', answer: 'sunce', clue: 'c' }] })
    expect(checkItem(item, { z: 'ZEMLJA', m: 'mjesec', s: 'Sunce' }, { text: makeTextResolver({ hr }, 'hr') }).correct).toBe(true)
  })

  it('word-search: the placements find every word forwards or backwards; a subset is partial; junk is invalid', () => {
    const ws = parse({ kind: 'word-search', words: ['mars', 'earth', 'venus'].map((w) => ({ id: w, answer: w })), seed: 9, directions: 'all' }) as Extract<BuiltinItem, { kind: 'word-search' }>
    expect(checkItem(ws, solveItem(ws, ctx), ctx)).toMatchObject({ correct: true, score: 1 })
    const { grid, words } = wordSearchFor(ws, ctx)
    const reversed = grid.placements.map((p) => {
      const s = placementSelection(p)
      return { start: s.end, end: s.start }
    })
    expect(wordsFound(grid, words, reversed).sort()).toEqual(['earth', 'mars', 'venus'])
    expect(checkItem(ws, [placementSelection(grid.placements[0]!)], ctx)).toMatchObject({ correct: false, partial: true })
    expect(checkItem(ws, 'x', ctx).invalid).toBe(true)
  })

  it('an unknown kind is invalid, never an exception; German transliteration is accepted with a flag, a missing umlaut is wrong', () => {
    expect(checkItem({ ...common, id: 'x', kind: 'nope', difficulty: 3, tags: [] }, 'a', ctx)).toMatchObject({ correct: false, invalid: true })
    const de: TextCatalog = { schema: 1, lang: 'de', strings: {}, accepted: { maedchen: ['Mädchen'], g1: ['Straße'], g2: ['Haus'] } }
    const deCtx = (lang?: string): CheckContext => ({ text: makeTextResolver({ en, de }, 'en', 'de'), ...(lang ? { lang } : {}) })
    const typedDe = parse({ kind: 'typed', answer: 'maedchen' })
    expect(checkItem(typedDe, 'Maedchen', deCtx('de'))).toMatchObject({ correct: true, score: 1, translit: true })
    expect(checkItem(typedDe, 'Madchen', deCtx('de'))).toMatchObject({ correct: false, diacritics: true })
    expect(checkItem(typedDe, 'Madchen', deCtx())).toMatchObject({ correct: true })
    const clozeDe = parse({ kind: 'cloze', text: 't.c', gaps: [{ id: 'a', answer: 'g1' }, { id: 'b', answer: 'g2' }] })
    expect(checkItem(clozeDe, { a: 'Strasse', b: 'haus' }, deCtx('de'))).toMatchObject({ correct: true, translit: true, caps: true })
    expect(checkItem({ ...typedDe, strictDiacritics: false }, 'Madchen', deCtx('de')).correct).toBe(true)
  })
})
