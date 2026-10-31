import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildTools, callTool, type Tool } from '../src/engine/mcp/tools'
import { makeEduEnv, type EduEnv } from './edu-helpers'
import { fakeBundle, tmp, useTemp } from './edu-build-helpers'

useTemp()

let env: EduEnv
let tools: Tool[]
let oldBundle: string | undefined
type Data = Record<string, unknown>

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

const dir = (slug: string, ...p: string[]): string => path.join(env.dir, 'courses', slug, ...p)

async function course(slug: string): Promise<void> {
  await must('edu_create_course', { slug, title: 'Class course', languages: ['en'], sourceLang: 'en', subject: 'Sums', audience: 'Pupils' })
  await must('edu_item_add', {
    slug,
    item: { id: 'q-tf', kind: 'true-false', objective: 'u1-o1', prompt: 'q-tf.prompt', explanation: 'q-tf.expl', answer: true },
    text: { en: { strings: { 'q-tf.prompt': 'Two plus two is four.', 'q-tf.expl': 'Yes.' } } }
  })
}

describe('edu_class_assign', () => {
  it('writes the assignment into pack.extensions.classroom and says the game needs a rebuild', async () => {
    await course('clazz')
    const r = await must('edu_class_assign', { slug: 'clazz', assignment: { title: 'Week 1', units: ['u1'], targetStars: 3, due: '2026-12-01', message: 'Be kind <b>and</b> quick' } })
    expect(r.next).toContain('edu_build')
    const pack = JSON.parse(await readFile(dir('clazz', 'course', 'pack.json'), 'utf8')) as { extensions: { classroom: { assignment: Data } } }
    expect(pack.extensions.classroom.assignment).toMatchObject({ title: 'Week 1', units: ['u1'], targetStars: 3, due: '2026-12-01', message: 'Be kind <b>and</b> quick' })
    // a second call replaces it: an absent due date is gone, not kept
    await must('edu_class_assign', { slug: 'clazz', assignment: { id: 'w2', title: 'Week 2' } })
    const again = JSON.parse(await readFile(dir('clazz', 'course', 'pack.json'), 'utf8')) as { extensions: { classroom: { assignment: Data } } }
    expect(again.extensions.classroom.assignment).toMatchObject({ id: 'w2', title: 'Week 2', units: [], targetStars: 2 })
    expect(again.extensions.classroom.assignment.due).toBeUndefined()
    expect(again.extensions.classroom.assignment.message).toBeUndefined()
  })
  it('refuses in words: unknown course, unknown unit, bad date, long message, nothing to assign', async () => {
    expect((await call('edu_class_assign', { slug: 'nope', assignment: { title: 'x' } })).text).toContain('no course "nope"')
    expect((await call('edu_class_assign', { slug: 'clazz', assignment: { title: 'x', units: ['zz'] } })).text).toContain('unknown unit(s) "zz"')
    expect((await call('edu_class_assign', { slug: 'clazz', assignment: { title: 'x', due: 'soon' } })).text).toContain('does not fit')
    expect((await call('edu_class_assign', { slug: 'clazz', assignment: { title: 'x', message: 'm'.repeat(401) } })).ok).toBe(false)
    expect((await call('edu_class_assign', { slug: 'clazz' })).text).toContain('pass `assignment`')
  })
  it('build: true builds the game, clear: true removes the assignment', async () => {
    const r = await must('edu_class_assign', { slug: 'clazz', assignment: { title: 'Built' }, build: true })
    expect(r.built).toBe(true)
    expect(await readFile(dir('clazz', 'build', 'game-data.json'), 'utf8')).toContain('"Built"')
    const c = await must('edu_class_assign', { slug: 'clazz', clear: true })
    expect(c.cleared).toBe(true)
    const pack = JSON.parse(await readFile(dir('clazz', 'course', 'pack.json'), 'utf8')) as { extensions?: { classroom?: Data } }
    expect(pack.extensions?.classroom?.assignment ?? null).toBeNull()
  })
})

describe('edu_class_report', () => {
  it('refuses an unknown course, a missing folder and an empty folder, in words', async () => {
    expect((await call('edu_class_report', { slug: 'nope' })).text).toContain('no course "nope"')
    expect((await call('edu_class_report', { slug: 'clazz' })).text).toContain('does not exist')
    await mkdir(dir('clazz', 'class', 'results'), { recursive: true })
    expect((await call('edu_class_report', { slug: 'clazz' })).text).toContain('no result files')
  })

  it('reads the folder, lists and skips bad files, writes report.md and report.csv', async () => {
    const res = dir('clazz', 'class', 'results')
    await writeFile(path.join(res, 'ana.json'), resultFile('Ana'))
    await writeFile(path.join(res, 'ben.json'), resultFile('=Ben', { units: { u1: { stars: 1, best: 0.5, rounds: 1 } } }))
    await writeFile(path.join(res, 'broken.json'), '{nope')
    await writeFile(path.join(res, 'other.json'), resultFile('Eve', { courseId: 'another' }))
    await writeFile(path.join(res, 'huge.json'), resultFile('Huge', { pad: 'x'.repeat(210 * 1024) }))
    await writeFile(path.join(res, 'notes.txt'), 'ignored')
    const r = await must('edu_class_report', { slug: 'clazz' })
    expect(r).toMatchObject({ filesRead: 5, students: 2, rejectedCount: 3 })
    const report = r.report as { rejected: { source: string; reason: string }[]; students: { name: string; finished: boolean }[]; items: { item: string; students: number; label?: string }[] }
    expect(report.rejected.map((x) => x.source).sort()).toEqual(['broken.json', 'huge.json', 'other.json'])
    expect(report.rejected.find((x) => x.source === 'huge.json')?.reason).toContain('200 KB')
    expect(report.items[0]).toMatchObject({ item: 'q-tf', students: 2, label: 'Two plus two is four.' })
    const md = await readFile(dir('clazz', 'class', 'report.md'), 'utf8')
    expect(md).toContain('Ana')
    expect(md).toContain('Left out broken.json')
    const csv = await readFile(dir('clazz', 'class', 'report.csv'), 'utf8')
    expect(csv).toContain("'=Ben,")
    expect((await must('edu_class_report', { slug: 'clazz', format: 'markdown' })).markdown).toContain('# Class report')
    expect((await must('edu_class_report', { slug: 'clazz', format: 'csv' })).csv).toContain('student,')
  })

  it('reads only the named files and never a file outside the folder', async () => {
    const res = dir('clazz', 'class', 'results')
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
      const all = await must('edu_class_report', { slug: 'clazz' })
      const rep = all.report as { students: { name: string }[]; rejected: { source: string; reason: string }[] }
      expect(rep.students.map((s) => s.name)).not.toContain('Mallory')
      expect(rep.rejected.find((x) => x.source === 'link.json')?.reason).toContain('leaves the results folder')
    }
  })

  it('reads another folder given by `folder`', async () => {
    const other = await tmp('edu-results-')
    await writeFile(path.join(other, 'z.json'), resultFile('Zoe'))
    const r = await must('edu_class_report', { slug: 'clazz', folder: other })
    expect((r.report as { students: { name: string }[] }).students.map((s) => s.name)).toEqual(['Zoe'])
  })
})
