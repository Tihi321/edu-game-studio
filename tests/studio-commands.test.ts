import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CourseStore } from '../src/engine/edu/store'
import { handleStudioCommand } from '../src/engine/edu/studio-commands'
import { type EngineEvent, type StudioCommand } from '../src/shared/protocol'
import { copyFixture, fakeBundle, useTemp } from './edu-build-helpers'

useTemp()

/** The studio commands on a temporary data folder (never ~/EduGames) with a stand-in player bundle. */
async function setup(fixture: 'solar-system' | 'broken' = 'solar-system') {
  const { dataDir } = await copyFixture(fixture, fixture)
  const courses = new CourseStore(dataDir, { playerDir: await fakeBundle() })
  const events: EngineEvent[] = []
  const run = async (cmd: StudioCommand): Promise<EngineEvent[]> => {
    const from = events.length
    await handleStudioCommand({ courses, emit: (e) => events.push(e), log: () => undefined }, cmd)
    return events.slice(from)
  }
  return { dataDir, courses, run }
}

describe('getCourse', () => {
  it('answers with the validated pack, the text catalogs, the counts and the build state', async () => {
    const { run } = await setup()
    const [e, ...rest] = await run({ type: 'getCourse', slug: 'solar-system' })
    expect(rest).toEqual([])
    expect(e?.type).toBe('course.loaded')
    if (e?.type !== 'course.loaded') return
    expect(e.slug).toBe('solar-system')
    expect(e.pack.items).toHaveLength(28)
    expect(e.pack.matching).toEqual({ diacritics: 'ignore', typos: true }) // defaults are filled
    expect(Object.keys(e.text).sort()).toEqual(['en', 'hr'])
    expect(e.stats).toMatchObject({ units: 3, items: 28 })
    expect(e.build).toEqual({ built: false })
  })
  it('says command.error with the slug for a missing course, a bad slug and a pack that does not match the contract', async () => {
    const { run, dataDir } = await setup()
    const missing = await run({ type: 'getCourse', slug: 'nope' })
    expect(missing).toEqual([{ type: 'command.error', command: 'getCourse', message: expect.stringContaining('no course "nope"'), slug: 'nope' }])
    const bad = await run({ type: 'getCourse', slug: '../x' })
    expect(bad[0]).toMatchObject({ type: 'command.error', slug: '../x' })
    await writeFile(path.join(dataDir, 'courses', 'solar-system', 'course', 'pack.json'), JSON.stringify({ schema: 1, id: 'solar-system' }))
    const contract = await run({ type: 'getCourse', slug: 'solar-system' })
    expect(contract[0]).toMatchObject({ type: 'command.error', command: 'getCourse' })
    expect((contract[0] as { message: string }).message).toContain('does not match the course contract')
  })
})

describe('buildCourse and lintCourse', () => {
  it('builds, reports the files and then the new build state; lint passes on a golden course', async () => {
    const { run } = await setup()
    const built = await run({ type: 'buildCourse', slug: 'solar-system' })
    expect(built.map((e) => e.type)).toEqual(['course.built', 'course.loaded'])
    expect(built[0]).toMatchObject({ ok: true, forced: false, problems: [] })
    expect((built[0] as { files: number }).files).toBeGreaterThan(3)
    expect((built[1] as { build: { built: boolean } }).build.built).toBe(true)
    const linted = await run({ type: 'lintCourse', slug: 'solar-system' })
    expect(linted.map((e) => e.type)).toEqual(['course.linted', 'course.loaded'])
    expect(linted[0]).toMatchObject({ ok: true, errors: 0, built: false })
  })
})

describe('updateItem', () => {
  it('merges the patch and the texts into the files, answers item.updated and then the new course', async () => {
    const { run, dataDir } = await setup()
    const out = await run({ type: 'updateItem', slug: 'solar-system', id: 'q-order-mcq', patch: { difficulty: 4 }, text: { en: { strings: { 'q-order-mcq.prompt': 'Which planet orbits closest to the Sun?' } } } })
    expect(out.map((e) => e.type)).toEqual(['item.updated', 'course.loaded'])
    expect(out[0]).toMatchObject({ slug: 'solar-system', id: 'q-order-mcq', pendingCount: 0 })
    const loaded = out[1] as Extract<EngineEvent, { type: 'course.loaded' }>
    expect(loaded.pack.items.find((i) => i.id === 'q-order-mcq')).toMatchObject({ difficulty: 4 })
    expect(loaded.text.en?.strings['q-order-mcq.prompt']).toBe('Which planet orbits closest to the Sun?')
    const onDisk = JSON.parse(await readFile(path.join(dataDir, 'courses', 'solar-system', 'course', 'text', 'en.json'), 'utf8'))
    expect(onDisk.strings['q-order-mcq.prompt']).toBe('Which planet orbits closest to the Sun?')
  })
})
