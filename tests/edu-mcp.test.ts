import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildTools, callTool, toolList, type Tool } from '../src/engine/mcp/tools'
import { INSTRUCTIONS } from '../src/engine/mcp/server'
import { FIXTURES } from './edu-fixtures'
import { makeEduEnv } from './edu-helpers'
import type { EduEnv } from './edu-helpers'
import { fakeBundle, useTemp } from './edu-build-helpers'

useTemp()

const COURSE_TOOLS = ['edu_list_courses', 'edu_create_course', 'edu_get_course', 'edu_course_edit', 'edu_item_add', 'edu_item_update', 'edu_item_remove', 'edu_text_set', 'edu_import_course', 'edu_validate', 'edu_build', 'edu_lint', 'edu_status']
const RESEARCH_TOOLS = ['edu_ask_researcher', 'edu_factbase_get', 'edu_run_pipeline']

let env: EduEnv
let tools: Tool[]
let oldBundle: string | undefined

beforeAll(async () => {
  oldBundle = process.env.EDU_PLAYER_DIR
  process.env.EDU_PLAYER_DIR = await fakeBundle()
  env = await makeEduEnv()
  tools = buildTools(env.engine.edu, { control: env.engine.mcpControl(), clientQueue: env.engine.clientQueue })
})
afterAll(async () => {
  if (oldBundle === undefined) delete process.env.EDU_PLAYER_DIR
  else process.env.EDU_PLAYER_DIR = oldBundle
  await env.cleanup()
})

type Data = Record<string, unknown>
/** Calls a tool through the registry; `ok` is false for an error result (then `data` is {error: message}). */
async function call(name: string, args: Data = {}): Promise<{ ok: boolean; data: Data; text: string }> {
  const r = await callTool(tools, name, args)
  const text = r.content[0].text
  return r.isError ? { ok: false, data: { error: text }, text } : { ok: true, data: r.structuredContent as Data, text }
}
const must = async (name: string, args: Data = {}): Promise<Data> => {
  const r = await call(name, args)
  if (!r.ok) throw new Error(`${name} failed: ${r.text}`)
  return r.data
}
const problemCodes = (d: Data, key = 'problems'): string[] => [...new Set((d[key] as { code: string }[]).map((p) => p.code))].sort()
const courseDir = (slug: string): string => path.join(env.dir, 'courses', slug, 'course')
const readPack = async (slug: string) => JSON.parse(await readFile(path.join(courseDir(slug), 'pack.json'), 'utf8')) as { units: { id: string; requires: string[] }[]; objectives: { id: string }[]; items: { id: string; kind: string }[] }

let n = 0
/** A fresh two-edition course (en source, hr). */
async function makeCourse(extra: Data = {}): Promise<string> {
  const slug = `demo-${++n}`
  await must('edu_create_course', { slug, title: 'Demo course', languages: ['en', 'hr'], sourceLang: 'en', subject: 'Demos', audience: 'Testers', ...extra })
  return slug
}

const MCQ = {
  id: 'q-mcq',
  kind: 'mcq',
  objective: 'u1-o1',
  prompt: 'q-mcq.prompt',
  explanation: 'q-mcq.expl',
  options: [
    { id: 'a', text: 'q-mcq.a' },
    { id: 'b', text: 'q-mcq.b', why: 'q-mcq.b.why' }
  ],
  answer: 'a'
}
const MCQ_TEXT = {
  en: { strings: { 'q-mcq.prompt': 'Two plus two?', 'q-mcq.expl': 'It is four.', 'q-mcq.a': 'Four', 'q-mcq.b': 'Five', 'q-mcq.b.why': 'Five is one too many.' } },
  hr: { strings: { 'q-mcq.prompt': 'Dva plus dva?', 'q-mcq.expl': 'To je cetiri.', 'q-mcq.a': 'Cetiri', 'q-mcq.b': 'Pet', 'q-mcq.b.why': 'Pet je jedan previse.' } }
}
const TF = { id: 'q-tf', kind: 'true-false', objective: 'u1-o1', prompt: 'q-tf.prompt', explanation: 'q-tf.expl', answer: true }
const TF_TEXT = {
  en: { strings: { 'q-tf.prompt': 'Two plus two is four.', 'q-tf.expl': 'Yes.' } },
  hr: { strings: { 'q-tf.prompt': 'Dva plus dva je cetiri.', 'q-tf.expl': 'Da.' } }
}

afterEach(() => undefined)

describe('the course tools: the registry', () => {
  it('lists every course tool with a JSON schema, all named edu_*', () => {
    const list = toolList(tools)
    const names = list.map((t) => t.name)
    for (const t of [...COURSE_TOOLS, ...RESEARCH_TOOLS]) expect(names, t).toContain(t)
    expect(names.every((x) => x.startsWith('edu_'))).toBe(true)
    expect(new Set(names).size).toBe(names.length)
    for (const t of list) expect(t.inputSchema.type).toBe('object')
  })

  it('the server instructions name the course tools', () => {
    for (const t of ['edu_create_course', 'edu_item_add', 'edu_text_set', 'edu_validate', 'edu_build', 'edu_lint', ...RESEARCH_TOOLS]) expect(INSTRUCTIONS, t).toContain(t)
  })
})

describe('the course tools: the happy path', () => {
  it('create, add units and items and text, validate, build and lint', async () => {
    const created = await must('edu_create_course', { slug: 'solar', title: 'Sums', languages: ['en', 'hr'], sourceLang: 'en', subject: 'Adding', audience: 'Kids', cefr: 'A1' })
    expect(created).toMatchObject({ slug: 'solar', pendingCount: 0 })
    expect((await must('edu_list_courses')).courses).toEqual([expect.objectContaining({ slug: 'solar' })])

    // the minimal pack and catalogs are on disk, and the title is a string of each edition
    const got = await must('edu_get_course', { slug: 'solar', text: true })
    expect(got.stats).toEqual({ units: 1, objectives: 1, items: 0, byKind: {} })
    expect(got.build).toEqual({ built: false })
    const text = got.text as Record<string, { strings: Record<string, string> }>
    expect(Object.keys(text).sort()).toEqual(['en', 'hr'])
    expect(text.en!.strings['course.title']).toBe('Sums')

    // a second unit and objective, with their text, in one call
    const edit = await must('edu_course_edit', {
      slug: 'solar',
      patch: {
        units: [
          { id: 'u1', title: 'unit.u1.title', requires: [] },
          { id: 'u2', title: 'unit.u2.title', requires: ['u1'] }
        ],
        objectives: [
          { id: 'u1-o1', unit: 'u1', bloom: 'remember', text: 'obj.u1-o1.text', facts: [] },
          { id: 'u2-o1', unit: 'u2', bloom: 'apply', text: 'obj.u2-o1.text', facts: [] }
        ]
      },
      text: { en: { strings: { 'unit.u2.title': 'Unit 2', 'obj.u2-o1.text': 'Add' } }, hr: { strings: { 'unit.u2.title': 'Cjelina 2', 'obj.u2-o1.text': 'Zbrajati' } } }
    })
    expect(edit.pendingCount).toBe(0)

    // items: the pending texts are reported until they are set
    const add = await must('edu_item_add', { slug: 'solar', item: MCQ })
    expect((add.pending as { code: string; path: string }[]).map((p) => p.code)).toContain('MISSING_TEXT')
    expect((add.item as { shuffle: boolean; difficulty: number }).shuffle).toBe(true) // defaults filled
    await must('edu_text_set', { slug: 'solar', lang: 'en', strings: MCQ_TEXT.en.strings })
    const set = await must('edu_text_set', { slug: 'solar', lang: 'hr', strings: MCQ_TEXT.hr.strings })
    expect(set).toMatchObject({ lang: 'hr', strings: 5, pendingCount: 0 })

    await must('edu_item_add', { slug: 'solar', item: TF, text: TF_TEXT })
    await must('edu_item_add', {
      slug: 'solar',
      item: { id: 'q-typed', kind: 'typed', objective: 'u2-o1', prompt: 'q-typed.prompt', explanation: 'q-typed.expl', answer: 'q-typed.answer' },
      text: {
        en: { strings: { 'q-typed.prompt': 'Type four.', 'q-typed.expl': 'Four.' }, accepted: { 'q-typed.answer': ['four'] } },
        hr: { strings: { 'q-typed.prompt': 'Upisi cetiri.', 'q-typed.expl': 'Cetiri.' }, accepted: { 'q-typed.answer': ['cetiri'] } }
      }
    })
    await must('edu_item_add', {
      slug: 'solar',
      item: { id: 'q-mcq2', kind: 'mcq', objective: 'u2-o1', prompt: 'q-mcq2.prompt', explanation: 'q-mcq2.expl', options: [{ id: 'a', text: 'q-mcq2.a' }, { id: 'b', text: 'q-mcq2.b', why: 'q-mcq2.b.why' }], answer: 'a' },
      text: {
        en: { strings: { 'q-mcq2.prompt': 'Three plus one?', 'q-mcq2.expl': 'Four.', 'q-mcq2.a': 'Four', 'q-mcq2.b': 'Six', 'q-mcq2.b.why': 'Six is two too many.' } },
        hr: { strings: { 'q-mcq2.prompt': 'Tri plus jedan?', 'q-mcq2.expl': 'Cetiri.', 'q-mcq2.a': 'Cetiri', 'q-mcq2.b': 'Sest', 'q-mcq2.b.why': 'Sest je dva previse.' } }
      }
    })
    expect((await must('edu_get_course', { slug: 'solar' })).stats).toMatchObject({ units: 2, objectives: 2, items: 4, byKind: { mcq: 2, 'true-false': 1, typed: 1 } })

    const valid = await must('edu_validate', { slug: 'solar' })
    expect(valid).toMatchObject({ ok: true, problems: [] })

    const built = await must('edu_build', { slug: 'solar' })
    expect(built).toMatchObject({ ok: true, forced: false })
    expect(built.files as string[]).toEqual(expect.arrayContaining(['index.html', 'player.js', 'player.css', 'game-data.json', 'game-data.js']))
    const buildDir = path.join(env.dir, 'courses', 'solar', 'build')
    for (const f of ['index.html', 'player.js', 'player.css', 'game-data.json', 'game-data.js']) expect((await stat(path.join(buildDir, f))).isFile(), f).toBe(true)
    expect(await readFile(path.join(buildDir, 'index.html'), 'utf8')).toContain('<title>Sums</title>')

    const linted = await must('edu_lint', { slug: 'solar' })
    expect(linted).toMatchObject({ ok: true, errors: 0, built: false })
    expect(linted.stale).toBeUndefined()

    // edu_status adds the course summary
    const status = await must('edu_status', { slug: 'solar' })
    expect(status.course).toMatchObject({ stats: { items: 4 }, languages: ['en', 'hr'], build: { built: true } })

    // no half-written files are left behind
    for (const dir of [courseDir('solar'), path.join(courseDir('solar'), 'text')]) expect((await readdir(dir)).filter((f) => f.includes('.tmp-'))).toEqual([])
  })

  it('a lint without a build builds first; a lint of a changed course says stale until rebuilt', async () => {
    const slug = await makeCourse()
    await must('edu_item_add', { slug, item: MCQ, text: MCQ_TEXT })
    await must('edu_item_add', { slug, item: TF, text: TF_TEXT })
    const first = await must('edu_lint', { slug })
    expect(first).toMatchObject({ ok: true, built: true })
    await must('edu_text_set', { slug, lang: 'en', strings: { 'q-tf.expl': 'Indeed.' } })
    expect((await must('edu_lint', { slug })).stale).toBe(true)
    expect((await must('edu_lint', { slug, rebuild: true })).stale).toBeUndefined()
  })

  it('lints a fresh course: an objective with no items is an error, the fix makes it pass', async () => {
    const slug = await makeCourse()
    const r = await must('edu_lint', { slug })
    expect(r.ok).toBe(false)
    expect((r.problems as { code: string }[]).map((p) => p.code)).toEqual(['OBJECTIVE_NO_ITEMS'])
  })
})

describe('the course tools: edits are validated and refused', () => {
  it('refuses a duplicate unit id, an unknown prerequisite and a cycle-free-but-broken reference, and writes nothing', async () => {
    const slug = await makeCourse()
    const before = await readFile(path.join(courseDir(slug), 'pack.json'), 'utf8')
    const dup = await call('edu_course_edit', { slug, patch: { units: [{ id: 'u1', title: 'unit.u1.title', requires: [] }, { id: 'u1', title: 'unit.u1.title', requires: [] }] } })
    expect(dup.ok).toBe(false)
    expect(dup.text).toMatch(/DUPLICATE_ID/)
    expect(dup.text).toMatch(/nothing was written/)
    const ghost = await call('edu_course_edit', { slug, patch: { units: [{ id: 'u1', title: 'unit.u1.title', requires: ['u9'] }] } })
    expect(ghost.ok).toBe(false)
    expect(ghost.text).toMatch(/UNKNOWN_UNIT/)
    const badObj = await call('edu_course_edit', { slug, patch: { objectives: [{ id: 'x', unit: 'u1', bloom: 'juggle', text: 'k', facts: [] }] } })
    expect(badObj.ok).toBe(false)
    expect(badObj.text).toMatch(/SCHEMA/)
    expect(await readFile(path.join(courseDir(slug), 'pack.json'), 'utf8')).toBe(before)
  })

  it('refuses fields that have their own tools or never change', async () => {
    const slug = await makeCourse()
    for (const patch of [{ items: [] }, { slug: 'other' }, { id: 'x' }, { schema: 2 }]) {
      const r = await call('edu_course_edit', { slug, patch })
      expect(r.ok, JSON.stringify(patch)).toBe(false)
      expect(r.text).toMatch(/cannot be edited/)
    }
  })

  it('merge-patches objects, deletes with null and replaces arrays', async () => {
    const slug = await makeCourse()
    await must('edu_course_edit', { slug, patch: { shells: { config: { 'quiz-arena': { rounds: 3 } } }, matching: { typos: false }, cefr: 'B1' } })
    let pack = (await must('edu_get_course', { slug })).pack as { shells: { enabled: string[]; config: Record<string, unknown> }; matching: { diacritics: string; typos: boolean }; cefr?: string }
    expect(pack.shells).toEqual({ enabled: ['quiz-arena'], config: { 'quiz-arena': { rounds: 3 } } })
    expect(pack.matching).toEqual({ diacritics: 'ignore', typos: false })
    expect(pack.cefr).toBe('B1')
    await must('edu_course_edit', { slug, patch: { cefr: null, shells: { enabled: ['quiz-arena', 'encyclopedia'] } } })
    pack = (await must('edu_get_course', { slug })).pack as typeof pack
    expect(pack.cefr).toBeUndefined()
    expect(pack.shells.enabled).toEqual(['quiz-arena', 'encyclopedia'])
  })

  it('refuses an item that does not fit its kind, an unknown objective or kind, and a duplicate id', async () => {
    const slug = await makeCourse()
    const noAnswer = await call('edu_item_add', { slug, item: { ...MCQ, answer: undefined }, text: MCQ_TEXT })
    expect(noAnswer.ok).toBe(false)
    expect(noAnswer.text).toMatch(/not a valid mcq/)
    const unknownKind = await call('edu_item_add', { slug, item: { ...MCQ, kind: 'telepathy' } })
    expect(unknownKind.text).toMatch(/unknown item kind "telepathy"/)
    const noObjective = await call('edu_item_add', { slug, item: { ...MCQ, objective: 'ghost' }, text: MCQ_TEXT })
    expect(noObjective.ok).toBe(false)
    expect(noObjective.text).toMatch(/UNKNOWN_OBJECTIVE/)
    const noOption = await call('edu_item_add', { slug, item: { ...MCQ, answer: 'zzz' }, text: MCQ_TEXT })
    expect(noOption.text).toMatch(/UNKNOWN_OPTION/)
    expect((await readPack(slug)).items).toEqual([])
    await must('edu_item_add', { slug, item: MCQ, text: MCQ_TEXT })
    const dup = await call('edu_item_add', { slug, item: MCQ })
    expect(dup.ok).toBe(false)
    expect(dup.text).toMatch(/exists already/)
    expect((await readPack(slug)).items).toHaveLength(1)
    // text for a language the course does not have
    const lang = await call('edu_text_set', { slug, lang: 'de', strings: { a: 'b' } })
    expect(lang.ok).toBe(false)
    expect(lang.text).toMatch(/not an edition/)
  })

  it('refuses a bad text: an empty accepted entry or a bad key', async () => {
    const slug = await makeCourse()
    expect((await call('edu_text_set', { slug, lang: 'en', accepted: { k: [] } })).ok).toBe(false)
    const badKey = await call('edu_text_set', { slug, lang: 'en', strings: { 'bad key!': 'x' } })
    expect(badKey.ok).toBe(false)
    expect(badKey.text).toMatch(/not valid/)
    expect(Object.keys(((await must('edu_get_course', { slug, lang: 'en' })).text as { en: { strings: object } }).en.strings)).not.toContain('bad key!')
  })

  it('updates an item with a merge patch (and its text), refuses an id change, and removes it', async () => {
    const slug = await makeCourse()
    await must('edu_item_add', { slug, item: MCQ, text: MCQ_TEXT })
    const up = await must('edu_item_update', { slug, id: 'q-mcq', patch: { answer: 'b', difficulty: 4 }, text: { en: { strings: { 'q-mcq.expl': 'Five, in this version.' } } } })
    expect(up.item).toMatchObject({ id: 'q-mcq', answer: 'b', difficulty: 4, kind: 'mcq' })
    const bad = await call('edu_item_update', { slug, id: 'q-mcq', patch: { answer: 'zzz' } })
    expect(bad.ok).toBe(false)
    expect(bad.text).toMatch(/UNKNOWN_OPTION/)
    expect((await call('edu_item_update', { slug, id: 'q-mcq', patch: { id: 'renamed' } })).text).toMatch(/cannot change/)
    expect((await call('edu_item_update', { slug, id: 'ghost', patch: {} })).text).toMatch(/no item "ghost"/)
    const got = await must('edu_get_course', { slug, lang: 'en' })
    expect(((got.pack as { items: { answer: string }[] }).items)[0]!.answer).toBe('b')
    expect((got.text as { en: { strings: Record<string, string> } }).en.strings['q-mcq.expl']).toBe('Five, in this version.')
    expect(await must('edu_item_remove', { slug, id: 'q-mcq' })).toMatchObject({ removed: 'q-mcq' })
    expect((await readPack(slug)).items).toEqual([])
    expect((await call('edu_item_remove', { slug, id: 'q-mcq' })).ok).toBe(false)
  })

  it('removes text keys with edu_text_set', async () => {
    const slug = await makeCourse()
    await must('edu_text_set', { slug, lang: 'en', strings: { 'x.a': 'A', 'x.b': 'B' }, accepted: { 'x.b': ['b'] } })
    const r = await must('edu_text_set', { slug, lang: 'en', remove: ['x.a', 'x.b'] })
    expect(r.removed).toBe(2)
    const en = ((await must('edu_get_course', { slug, lang: 'en' })).text as { en: { strings: Record<string, string>; accepted?: Record<string, string[]> } }).en
    expect(Object.keys(en.strings)).not.toContain('x.a')
    expect(Object.keys(en.accepted ?? {})).not.toContain('x.b')
  })

  it('keeps every write when calls arrive at the same time', async () => {
    const slug = await makeCourse()
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5']
    await Promise.all(
      ids.map((id) =>
        must('edu_item_add', {
          slug,
          item: { id, kind: 'true-false', objective: 'u1-o1', prompt: `${id}.prompt`, explanation: `${id}.expl`, answer: true },
          text: { en: { strings: { [`${id}.prompt`]: id, [`${id}.expl`]: 'ok' } }, hr: { strings: { [`${id}.prompt`]: id, [`${id}.expl`]: 'ok' } } }
        })
      )
    )
    expect((await readPack(slug)).items.map((i) => i.id).sort()).toEqual(ids)
    expect((await must('edu_validate', { slug })).ok).toBe(true)
  })
})

describe('the course tools: create and import', () => {
  it('refuses a second course with the same slug, a bad slug and a source language that is not an edition', async () => {
    const slug = await makeCourse()
    expect((await call('edu_create_course', { slug, title: 'Again', languages: ['en'], sourceLang: 'en', subject: 's', audience: 'a' })).text).toMatch(/already exists/)
    expect((await call('edu_create_course', { slug: 'Bad Slug', title: 't', languages: ['en'], sourceLang: 'en', subject: 's', audience: 'a' })).ok).toBe(false)
    expect((await call('edu_create_course', { slug: 'no-source', title: 't', languages: ['hr'], sourceLang: 'en', subject: 's', audience: 'a' })).text).toMatch(/sourceLang/)
  })

  it('creates a language course with a target-language catalog', async () => {
    const slug = await makeCourse({ languages: ['en'], targetLang: 'hr' })
    const got = await must('edu_get_course', { slug, text: true })
    expect(Object.keys(got.text as object).sort()).toEqual(['en', 'hr'])
    expect((got.pack as { targetLang: string }).targetLang).toBe('hr')
    expect((await must('edu_validate', { slug })).ok).toBe(true)
  })

  it('imports a course folder (both folder shapes), refuses to overwrite, and gives it another slug', async () => {
    const src = path.join(FIXTURES, 'solar-system')
    const imp = await must('edu_import_course', { folder: src, slug: 'imported-solar' })
    expect(imp).toMatchObject({ slug: 'imported-solar', validation: { ok: true, problems: [] } })
    expect((await readPack('imported-solar')).units.length).toBe(3)
    expect(JSON.parse(await readFile(path.join(courseDir('imported-solar'), 'pack.json'), 'utf8')).slug).toBe('imported-solar')
    expect((await stat(path.join(courseDir('imported-solar'), 'assets', 'solar-system.svg'))).isFile()).toBe(true)
    const again = await call('edu_import_course', { folder: src, slug: 'imported-solar' })
    expect(again.ok).toBe(false)
    expect(again.text).toMatch(/already exists/)
    // the course/ folder itself, replacing the course
    expect((await must('edu_import_course', { folder: path.join(src, 'course'), slug: 'imported-solar', overwrite: true })).slug).toBe('imported-solar')
    // slug from the pack
    expect((await must('edu_import_course', { folder: path.join(FIXTURES, 'hr-a1-greetings') })).slug).toBe('hr-a1-greetings')
    expect((await call('edu_import_course', { folder: path.join(FIXTURES) })).text).toMatch(/not a course folder/)
    // the imported course builds and lints clean
    expect(await must('edu_build', { slug: 'imported-solar' })).toMatchObject({ ok: true })
    expect(await must('edu_lint', { slug: 'imported-solar' })).toMatchObject({ ok: true, errors: 0 })
  })

  it('validate, build and lint say what is wrong with a broken course', async () => {
    await must('edu_import_course', { folder: path.join(FIXTURES, 'broken'), slug: 'broken' })
    const v = await must('edu_validate', { slug: 'broken' })
    expect(v.ok).toBe(false)
    expect(problemCodes(v)).toEqual(['MISSING_ASSET_FILE', 'MISSING_TEXT', 'SCHEMA', 'UNKNOWN_OPTION'])
    const b = await must('edu_build', { slug: 'broken' })
    expect(b).toMatchObject({ ok: false, files: [] })
    const lint = await must('edu_lint', { slug: 'broken' })
    expect(lint).toMatchObject({ ok: false, built: false })
    expect(problemCodes(lint, 'buildProblems')).toContain('SCHEMA')
    // forced, the lint has a build to look at
    expect(await must('edu_build', { slug: 'broken', force: true })).toMatchObject({ ok: true, forced: true })
    const forced = await must('edu_lint', { slug: 'broken' })
    expect(forced.ok).toBe(false)
    expect(forced.errors).toBeGreaterThan(10)
  })

  it('unknown courses are errors', async () => {
    for (const [tool, args] of [['edu_get_course', {}], ['edu_validate', {}], ['edu_build', {}], ['edu_lint', {}], ['edu_item_add', { item: MCQ }], ['edu_course_edit', { patch: { subject: 'x' } }]] as const) {
      const r = await call(tool, { slug: 'nope', ...args })
      expect(r.ok, tool).toBe(false)
      expect(r.text, tool).toMatch(/no course "nope"/)
    }
    expect((await call('edu_get_course', { slug: '../evil' })).ok).toBe(false)
  })
})
