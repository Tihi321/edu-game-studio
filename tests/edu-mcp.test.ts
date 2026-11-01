import { mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildTools, callTool, toolList, type Tool } from '../src/engine/mcp/tools'
import { INSTRUCTIONS } from '../src/engine/mcp/server'
import { mcpSnippets } from '../src/renderer/lib/mcp'
import { eduStore } from '../src/renderer/store/store'
import { FIXTURES } from './edu-fixtures'
import { makeEduEnv } from './edu-helpers'
import type { EduEnv } from './edu-helpers'
import { fakeBundle, tmp, useTemp } from './edu-build-helpers'
import { LIVE_OUT } from './live-helpers'

useTemp()

let env: EduEnv
let tools: Tool[]
const saved = { player: process.env.EDU_PLAYER_DIR, live: process.env.EDU_LIVE_DIR }
const rooms: string[] = []

beforeAll(async () => {
  process.env.EDU_PLAYER_DIR = await fakeBundle()
  process.env.EDU_LIVE_DIR = LIVE_OUT
  env = await makeEduEnv()
  tools = buildTools(env.engine.edu, { control: env.engine.mcpControl(), clientQueue: env.engine.clientQueue })
})
afterAll(async () => {
  for (const id of rooms) await callTool(tools, 'edu_live_stop', { roomId: id })
  if (saved.player === undefined) delete process.env.EDU_PLAYER_DIR
  else process.env.EDU_PLAYER_DIR = saved.player
  if (saved.live === undefined) delete process.env.EDU_LIVE_DIR
  else process.env.EDU_LIVE_DIR = saved.live
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
    // a fresh course: an objective with no items is an error
    const fresh = await must('edu_lint', { slug: await makeCourse() })
    expect(fresh.ok).toBe(false)
    expect((fresh.problems as { code: string }[]).map((p) => p.code)).toEqual(['OBJECTIVE_NO_ITEMS'])
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
    // fields that have their own tools or never change
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
    // a bad text: an empty accepted entry or a bad key
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
    // text keys are removed with edu_text_set
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
  it('refuses a second course with the same slug, a bad slug and a source language that is not an edition; creates a language course', async () => {
    const slug = await makeCourse()
    expect((await call('edu_create_course', { slug, title: 'Again', languages: ['en'], sourceLang: 'en', subject: 's', audience: 'a' })).text).toMatch(/already exists/)
    expect((await call('edu_create_course', { slug: 'Bad Slug', title: 't', languages: ['en'], sourceLang: 'en', subject: 's', audience: 'a' })).ok).toBe(false)
    expect((await call('edu_create_course', { slug: 'no-source', title: 't', languages: ['hr'], sourceLang: 'en', subject: 's', audience: 'a' })).text).toMatch(/sourceLang/)
    // a language course gets a target-language catalog
    const lang = await makeCourse({ languages: ['en'], targetLang: 'hr' })
    const got = await must('edu_get_course', { slug: lang, text: true })
    expect(Object.keys(got.text as object).sort()).toEqual(['en', 'hr'])
    expect((got.pack as { targetLang: string }).targetLang).toBe('hr')
    expect((await must('edu_validate', { slug: lang })).ok).toBe(true)
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

// ---------- classroom mode (formerly classroom-mcp.test.ts) ----------

const resultFile = (name: string, o: Data = {}): string =>
  JSON.stringify({
    schema: 1,
    kind: 'edu-student-result',
    courseId: 'clazz',
    student: { name, id: `id-${name}` },
    exportedAt: '2026-11-10T10:00:00.000Z',
    units: { u1: { stars: 3, best: 1, rounds: 1 } },
    boss: { stars: 0, best: 0, rounds: 0 },
    answered: 4,
    right: 3,
    queue: ['q-tf'],
    missed: { 'q-tf': 1 },
    playSeconds: 300,
    ...o
  })
const classDir = (...p: string[]): string => path.join(env.dir, 'courses', 'clazz', ...p)

describe('classroom tools', () => {
  it('edu_class_assign writes, replaces, builds and clears the assignment, and refuses in words', async () => {
    await must('edu_create_course', { slug: 'clazz', title: 'Class course', languages: ['en'], sourceLang: 'en', subject: 'Sums', audience: 'Pupils' })
    await must('edu_item_add', { slug: 'clazz', item: TF, text: { en: TF_TEXT.en } })
    const r = await must('edu_class_assign', { slug: 'clazz', assignment: { title: 'Week 1', units: ['u1'], targetStars: 3, due: '2026-12-01', message: 'Be kind <b>and</b> quick' } })
    expect(r.next).toContain('edu_build')
    type P = { extensions?: { classroom?: { assignment?: Data } } }
    const pack = async (): Promise<P> => JSON.parse(await readFile(classDir('course', 'pack.json'), 'utf8')) as P
    expect((await pack()).extensions!.classroom!.assignment).toMatchObject({ title: 'Week 1', units: ['u1'], targetStars: 3, due: '2026-12-01', message: 'Be kind <b>and</b> quick' })
    // a second call replaces it: an absent due date is gone, not kept
    await must('edu_class_assign', { slug: 'clazz', assignment: { id: 'w2', title: 'Week 2' } })
    const again = (await pack()).extensions!.classroom!.assignment!
    expect(again).toMatchObject({ id: 'w2', title: 'Week 2', units: [], targetStars: 2 })
    expect(again.due).toBeUndefined()
    expect(again.message).toBeUndefined()

    expect((await call('edu_class_assign', { slug: 'nope', assignment: { title: 'x' } })).text).toContain('no course "nope"')
    expect((await call('edu_class_assign', { slug: 'clazz', assignment: { title: 'x', units: ['zz'] } })).text).toContain('unknown unit(s) "zz"')
    expect((await call('edu_class_assign', { slug: 'clazz', assignment: { title: 'x', due: 'soon' } })).text).toContain('does not fit')
    expect((await call('edu_class_assign', { slug: 'clazz', assignment: { title: 'x', message: 'm'.repeat(401) } })).ok).toBe(false)
    expect((await call('edu_class_assign', { slug: 'clazz' })).text).toContain('pass `assignment`')

    expect((await must('edu_class_assign', { slug: 'clazz', assignment: { title: 'Built' }, build: true })).built).toBe(true)
    expect(await readFile(classDir('build', 'game-data.json'), 'utf8')).toContain('"Built"')
    expect((await must('edu_class_assign', { slug: 'clazz', clear: true })).cleared).toBe(true)
    expect((await pack()).extensions?.classroom?.assignment ?? null).toBeNull()
  })

  it('edu_class_report refuses what it cannot read, skips bad files and writes report.md and report.csv', async () => {
    expect((await call('edu_class_report', { slug: 'nope' })).text).toContain('no course "nope"')
    expect((await call('edu_class_report', { slug: 'clazz' })).text).toContain('does not exist')
    await mkdir(classDir('class', 'results'), { recursive: true })
    expect((await call('edu_class_report', { slug: 'clazz' })).text).toContain('no result files')

    const res = classDir('class', 'results')
    await writeFile(path.join(res, 'ana.json'), resultFile('Ana'))
    await writeFile(path.join(res, 'ben.json'), resultFile('=Ben', { units: { u1: { stars: 1, best: 0.5, rounds: 1 } } }))
    await writeFile(path.join(res, 'broken.json'), '{nope')
    await writeFile(path.join(res, 'other.json'), resultFile('Eve', { courseId: 'another' }))
    await writeFile(path.join(res, 'huge.json'), resultFile('Huge', { pad: 'x'.repeat(210 * 1024) }))
    await writeFile(path.join(res, 'notes.txt'), 'ignored')
    const r = await must('edu_class_report', { slug: 'clazz' })
    expect(r).toMatchObject({ filesRead: 5, students: 2, rejectedCount: 3 })
    const report = r.report as { rejected: { source: string; reason: string }[]; items: { item: string; students: number; label?: string }[] }
    expect(report.rejected.map((x) => x.source).sort()).toEqual(['broken.json', 'huge.json', 'other.json'])
    expect(report.rejected.find((x) => x.source === 'huge.json')?.reason).toContain('200 KB')
    expect(report.items[0]).toMatchObject({ item: 'q-tf', students: 2, label: 'Two plus two is four.' })
    expect(await readFile(classDir('class', 'report.md'), 'utf8')).toContain('Left out broken.json')
    expect(await readFile(classDir('class', 'report.csv'), 'utf8')).toContain("'=Ben,") // a formula cell is neutralised
  })

  it('edu_class_report reads only the named files, never a file outside the folder, and another folder given by `folder`', async () => {
    const res = classDir('class', 'results')
    const outside = await tmp('edu-outside-')
    await writeFile(path.join(outside, 'secret.json'), resultFile('Mallory'))
    const r = await must('edu_class_report', { slug: 'clazz', files: ['ana.json', '../../../../../../../../' + path.relative(path.parse(outside).root, path.join(outside, 'secret.json')), 'missing.json'] })
    const report = r.report as { students: { name: string }[]; rejected: { source: string; reason: string }[] }
    expect(report.students.map((s) => s.name)).toEqual(['Ana'])
    expect(report.rejected.map((x) => x.reason).join(' ')).toContain('outside the results folder')
    expect(report.rejected.map((x) => x.reason)).toContain('no such file')
    let linked = true
    try {
      await symlink(path.join(outside, 'secret.json'), path.join(res, 'link.json'), 'file')
    } catch {
      linked = false // creating links needs a privilege on Windows
    }
    if (linked) {
      const rep = (await must('edu_class_report', { slug: 'clazz' })).report as { students: { name: string }[]; rejected: { source: string; reason: string }[] }
      expect(rep.students.map((s) => s.name)).not.toContain('Mallory')
      expect(rep.rejected.find((x) => x.source === 'link.json')?.reason).toContain('leaves the results folder')
    }
    const other = await tmp('edu-results-')
    await writeFile(path.join(other, 'z.json'), resultFile('Zoe'))
    expect(((await must('edu_class_report', { slug: 'clazz', folder: other })).report as { students: { name: string }[] }).students.map((s) => s.name)).toEqual(['Zoe'])
  })
})

// ---------- live quiz (formerly live-mcp.test.ts) ----------

describe('live quiz tools', () => {
  it('edu_live_start refuses a missing course, an unbuilt course and an unknown edition', async () => {
    expect((await call('edu_live_start', { slug: 'nope' })).text).toMatch(/no course/)
    await must('edu_import_course', { folder: path.join(FIXTURES, 'solar-system'), slug: 'solar-live' })
    expect((await call('edu_live_start', { slug: 'solar-live' })).text).toMatch(/not built/)
    await must('edu_build', { slug: 'solar-live' })
    expect((await call('edu_live_start', { slug: 'solar-live', lang: 'de' })).text).toMatch(/no "de" edition/)
    expect((await call('edu_live_start', { slug: 'solar-live', questions: 0 })).ok).toBe(false)
    expect((await call('edu_live_start', { slug: '../x' })).ok).toBe(false)
  })

  it('starts a room on loopback, lists it, serves it and stops it; says when fewer questions exist than asked', async () => {
    const r = await must('edu_live_start', { slug: 'solar-live', questions: 4, secondsPerQuestion: 10, lang: 'hr' })
    rooms.push(r.roomId as string)
    expect(r).toMatchObject({ lan: false, lang: 'hr', questions: 4, secondsPerQuestion: 10, phase: 'lobby' })
    expect(r.code).toMatch(/^\d{6}$/)
    expect(r.hostUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/live\/host\/[0-9a-f]{32}\/$/)
    expect(r.playerUrls).toEqual([`http://127.0.0.1:${String(r.port)}/live/`])
    const join = await fetch(`http://127.0.0.1:${String(r.port)}/live/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: r.code, name: 'Ana' }) })
    expect(join.status).toBe(200)
    const one = await must('edu_live_status', { roomId: r.roomId })
    expect(one).toMatchObject({ roomId: r.roomId, players: 1, phase: 'lobby', questionCount: 4, code: r.code })
    expect('hostUrl' in one).toBe(false) // the host secret is not in the status
    expect(((await must('edu_live_status')).rooms as Data[]).map((x) => x.roomId)).toContain(r.roomId)
    expect(await must('edu_live_stop', { roomId: r.roomId })).toMatchObject({ stopped: true, phase: 'closed', players: 1 })
    await expect(fetch(`http://127.0.0.1:${String(r.port)}/live/info`)).rejects.toThrow()
    expect((await call('edu_live_stop', { roomId: 'nope' })).text).toMatch(/no live room/)

    const many = await must('edu_live_start', { slug: 'solar-live', questions: 50 })
    rooms.push(many.roomId as string)
    expect(many.questions as number).toBeLessThan(50)
    expect(String((many.notes as string[]).join(' '))).toMatch(/only \d+ usable questions/)
  })
})

// ---------- the settings state of the MCP server in the renderer (formerly ui-mcp.test.ts) ----------

describe('MCP settings in the app', () => {
  it('keeps the last mcp.status the engine sent and builds the connect snippets', () => {
    expect(eduStore.getState().mcp).toBeNull()
    eduStore.getState().applyEvents([{ type: 'mcp.status', enabled: true, listening: false, url: null, error: 'Port 7463 is already in use.', port: 7463, tokenSet: true }])
    expect(eduStore.getState().mcp).toMatchObject({ listening: false, error: 'Port 7463 is already in use.', tokenSet: true })
    const s = mcpSnippets('http://127.0.0.1:7463/mcp', false)
    expect(s.http).toBe('claude mcp add --transport http edu-studio http://127.0.0.1:7463/mcp')
    expect(mcpSnippets('http://127.0.0.1:7500/mcp', true).http).toMatch(/--header "Authorization: Bearer <token>"$/)
    expect(s.headless).toMatch(/--mcp-only/)
  })
})

// ---------- the contract: the tool list, the schemas, one call per tool, one refusal ----------

/**
 * One row per registered tool: the arguments of one call and what it must give. `ok` rows must succeed and carry the keys; `refuse` rows
 * must come back as an error result that names the cause. The test below fails when a tool is added or removed without a row and a line in
 * docs/mcp-guide.md.
 */
type Row = { args?: Data; ok: string[] } | { args?: Data; refuse: RegExp }
const S = { slug: 'solar' }
const CONTRACT: Record<string, Row> = {
  edu_list_courses: { ok: ['courses'] },
  edu_status: { args: S, ok: ['jobs', 'course'] },
  edu_wait: { args: { ...S, timeoutSeconds: 1 }, ok: ['timedOut'] },
  edu_languages: { ok: ['languages'] },
  edu_create_course: { args: { slug: 'c2', title: 'T', languages: ['en'], sourceLang: 'en', subject: 's', audience: 'a' }, ok: ['slug', 'pendingCount'] },
  edu_get_course: { args: S, ok: ['pack'] },
  edu_course_edit: { args: { ...S, patch: { subject: 'x' } }, ok: ['pendingCount'] },
  edu_item_add: { args: { ...S, item: {} }, refuse: /unknown item kind/ },
  edu_item_update: { args: { ...S, id: 'ghost', patch: {} }, refuse: /no item "ghost"/ },
  edu_item_remove: { args: { ...S, id: 'ghost' }, refuse: /no item "ghost"/ },
  edu_text_set: { args: { ...S, lang: 'en', strings: { 'x.k': 'v' } }, ok: ['strings'] },
  edu_import_course: { args: { folder: FIXTURES }, refuse: /not a course folder/ },
  edu_validate: { args: S, ok: ['ok', 'problems'] },
  edu_build: { args: S, ok: ['ok', 'files'] },
  edu_lint: { args: S, ok: ['errors', 'problems'] },
  edu_class_assign: { args: { ...S, assignment: { title: 'W' } }, ok: ['assignment'] },
  edu_class_report: { args: S, refuse: /does not exist/ },
  edu_ask_researcher: { args: { ...S, question: 'q' }, refuse: /invalid arguments: question/ },
  edu_factbase_get: { args: S, ok: ['facts', 'sources'] },
  edu_run_pipeline: { args: { slug: 'nope' }, refuse: /no course "nope"/ },
  edu_android_prepare: { args: S, ok: ['appId', 'dir'] },
  edu_asset_list: { args: S, ok: ['assets', 'summary'] },
  edu_asset_plan: { args: { ...S, fallback: true }, ok: ['planned'] },
  edu_asset_generate: { args: S, ok: ['jobs'] },
  edu_music_plan: { args: { ...S, fallback: true }, ok: ['tracks', 'sfx'] },
  edu_voice_plan: { args: { ...S, fallback: true }, refuse: /not a language course/ },
  edu_voice_generate: { args: S, refuse: /not a language course/ },
  edu_voice_status: { ok: ['engines', 'defaultEngine'] },
  edu_voice_quota: { ok: ['quota'] },
  edu_voice_import: { args: { ...S, lang: 'en', key: 'k', file: 'nowhere.wav' }, refuse: /./ },
  edu_asset_set: { args: { ...S, id: 'ghost', prompt: 'p' }, refuse: /no asset "ghost"/ },
  edu_asset_select: { args: { ...S, id: 'ghost', version: 1 }, refuse: /no asset "ghost"/ },
  edu_asset_replace: { args: { ...S, id: 'ghost', file: 'x' }, refuse: /no asset "ghost"/ },
  edu_asset_lock: { args: { ...S, id: 'ghost', locked: true }, refuse: /no asset "ghost"/ },
  edu_media_settings: { args: S, ok: ['media'] },
  edu_stt_status: { ok: ['wanted', 'running'] },
  edu_live_start: { args: { slug: 'nope' }, refuse: /no course/ },
  edu_live_status: { ok: ['rooms'] },
  edu_live_stop: { args: { roomId: 'nope' }, refuse: /no live room/ },
  edu_studios_status: { ok: ['studios'] },
  edu_comfy_status: { ok: ['lanes', 'engines'] },
  edu_comfy_free: { ok: ['results'] },
  edu_client_tasks: { ok: ['waiting', 'leased', 'tasks'] },
  edu_get_task: { ok: ['none'] },
  edu_submit_task: { args: { taskId: 'x#1', text: '{}' }, ok: ['accepted'] },
  edu_release_task: { args: { taskId: 'x#1' }, ok: ['released'] },
  edu_pause_all: { ok: ['paused'] },
  edu_resume_all: { ok: ['paused'] },
  edu_stop_now: { ok: ['stopped'] },
  edu_clear_queue: { args: {}, refuse: /confirm/ }
}

describe('the MCP contract', () => {
  let cenv: EduEnv
  let ctools: Tool[]
  beforeAll(async () => {
    cenv = await makeEduEnv({ client: true, studios: true })
    ctools = buildTools(cenv.engine.edu, { control: cenv.engine.mcpControl(), clientQueue: cenv.engine.clientQueue })
    // no real ComfyUI is asked, and nothing runs while the table is walked
    await writeFile(path.join(cenv.dir, 'config', 'comfy.md'), '---\nkind: comfy\nlanes: [http://127.0.0.1:9]\n---\n')
    await cenv.engine.setPaused(true)
  })
  afterAll(async () => {
    await cenv.cleanup()
  })

  it('the registered tools are exactly the documented ones, each with an object schema, and the server instructions name the main flow', async () => {
    const guide = await readFile(path.join(import.meta.dirname, '..', 'docs', 'mcp-guide.md'), 'utf8')
    const documented = [...new Set([...guide.matchAll(/`(edu_[a-z_]*[a-z])(?![a-z_])/g)].map((m) => m[1]!))].sort()
    const list = toolList(ctools)
    const names = list.map((t) => t.name).sort()
    expect(names).toEqual(documented)
    expect(names).toEqual(Object.keys(CONTRACT).sort()) // every tool has a row below
    expect(new Set(names).size).toBe(names.length)
    for (const t of list) expect(t.inputSchema.type, t.name).toBe('object')
    for (const t of ['edu_create_course', 'edu_item_add', 'edu_text_set', 'edu_validate', 'edu_build', 'edu_lint', 'edu_ask_researcher', 'edu_factbase_get', 'edu_run_pipeline']) expect(INSTRUCTIONS, t).toContain(t)
  })

  it('every tool answers one call: a success carries its keys, a refusal names its cause', async () => {
    const run = async (name: string, args: Data = {}) => {
      const r = await callTool(ctools, name, args)
      return { error: !!r.isError, text: r.content[0].text, data: (r.structuredContent ?? {}) as Data }
    }
    const imp = await run('edu_import_course', { folder: path.join(FIXTURES, 'solar-system'), slug: 'solar' })
    expect(imp.error, imp.text).toBe(false)
    expect((await run('edu_build', S)).error).toBe(false)
    // the queue tools run last: resume lets queued jobs go, stop_now holds them again
    const order = [...Object.keys(CONTRACT).filter((n) => !['edu_pause_all', 'edu_resume_all', 'edu_stop_now'].includes(n)), 'edu_pause_all', 'edu_resume_all', 'edu_stop_now']
    for (const name of order) {
      const row = CONTRACT[name]!
      const r = await run(name, row.args)
      if ('refuse' in row) {
        expect(r.error, `${name} should refuse: ${r.text}`).toBe(true)
        expect(r.text, name).toMatch(row.refuse)
      } else {
        expect(r.error, `${name} failed: ${r.text}`).toBe(false)
        for (const k of row.ok) expect(r.data, `${name}.${k}`).toHaveProperty(k)
      }
    }
    // the languages include Croatian with its native name
    const langs = (await run('edu_languages')).data.languages as { code: string; native: string }[]
    expect(langs.find((l) => l.code === 'hr')).toMatchObject({ native: 'Hrvatski' })
  })
})

describe('the pipeline tools: refusals', () => {
  it('edu_create_course takes a brief (slug from the topic), edu_run_pipeline refuses what it cannot run', async () => {
    const brief = { topic: 'The Roman Empire', audience: 'teenagers', age: 14, sourceLang: 'en', units: 2, story: 'none' }
    expect((await must('edu_create_course', { brief })).slug).toBe('the-roman-empire')
    expect((await call('edu_create_course', { brief })).text).toMatch(/already exists/)
    expect((await call('edu_create_course', { slug: 'x' })).text).toMatch(/give a brief, or slug, title/)
    expect((await call('edu_run_pipeline', {})).text).toMatch(/give a slug.*or a brief/)
    expect((await call('edu_run_pipeline', { slug: 'nope' })).text).toMatch(/no course "nope"/)
    expect((await call('edu_run_pipeline', { brief: { ...brief, model: 'nobody/none' } })).text).toMatch(/unknown model "nobody\/none"/)
    expect((await call('edu_run_pipeline', { brief: { ...brief, format: 'epic' } })).text).toMatch(/no course format "epic"/)
    expect((await call('edu_run_pipeline', { slug: 'the-roman-empire', restart: true, from: 'dessert' })).text).toMatch(/unknown stage "dessert"/)
    const byHand = await makeCourse()
    expect((await call('edu_run_pipeline', { slug: byHand })).text).toMatch(/has no brief/)
  })
})
