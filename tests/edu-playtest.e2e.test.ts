import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assembleCourse } from '../src/engine/edu/assemble'
import { runPlaytest } from '../src/engine/edu/playtest'
import { CourseStore } from '../src/engine/edu/store'
import { assembleInput } from './edu-authored-fixture'
import { tmp, useTemp } from './edu-build-helpers'

useTemp()

/** The real autoplay bot on an assembled course (Chromium), moved out of tests/edu-playtest.test.ts (EGS-40). */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('the real autoplay bot on an assembled course', () => {
  it('a course made by assembleCourse is playable: the perfect learner finishes it and the 75 % learner reaches the end, with no console error', { timeout: 240_000 }, async () => {
    const dataDir = await tmp('edu-playtest-')
    const store = new CourseStore(dataDir, { playerDir: path.join(ROOT, 'out', 'player') })
    const { pack, catalogs } = assembleCourse(assembleInput())
    await store.writeAssembled('roman-basics', pack, catalogs)
    const built = await store.build('roman-basics')
    expect(built.ok).toBe(true)
    const r = await runPlaytest(store.buildDir('roman-basics'), { personas: ['perfect', 'average'], concurrency: 2, timeoutMs: 200_000 })
    expect(r.failures).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.runs.map((x) => [x.persona, x.summary?.finished])).toEqual([['perfect', true], ['average', true]])
    expect(r.runs.every((x) => x.summary!.consoleErrors === 0)).toBe(true)
  })
})
