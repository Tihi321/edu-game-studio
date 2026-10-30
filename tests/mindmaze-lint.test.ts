import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { lintGame } from '../src/engine/edu/lint'
import { FIXTURES } from './edu-fixtures'
import { copyFixture, fakeBundle, useTemp } from './edu-build-helpers'

/**
 * The MindMaze lint end to end (EGS-11): the golden fixtures build and lint clean with the castle enabled, and the broken-mindmaze
 * fixture (a castle that is wrong on purpose) is refused by the normal build, builds with `force` and reports exactly the codes of its
 * EXPECTED.md.
 */

useTemp()

const codes = (ps: readonly { code: string }[]): string[] => [...new Set(ps.map((p) => p.code))].sort()

describe('mindmaze: golden fixtures build and lint clean', () => {
  for (const name of ['solar-system', 'european-capitals'] as const) {
    it(`${name}: 0 problems, 0 errors and 0 warnings from the castle`, async () => {
      const bundle = await fakeBundle()
      const { root } = await copyFixture(name)
      const b = await buildCourse(root, undefined, { playerDir: bundle })
      expect(b.problems).toEqual([])
      expect(b.ok).toBe(true)
      const r = await lintGame(b.outDir)
      expect(r.errors).toBe(0)
      expect(r.problems.filter((p) => p.code.startsWith('MAZE_'))).toEqual([])
      expect(r.ok).toBe(true)
    })
  }
})

describe('mindmaze: the broken fixture', () => {
  const expected = async (heading: string): Promise<string[]> => {
    const md = await readFile(path.join(FIXTURES, 'broken-mindmaze', 'EXPECTED.md'), 'utf8')
    const section = md.split(/^## /m).find((s) => s.startsWith(heading))
    if (!section) throw new Error(`EXPECTED.md has no "${heading}" section`)
    return [...section.matchAll(/^- `([A-Z_]+)`/gm)].map((m) => m[1]!).sort()
  }

  it('does not build the normal way, builds with force, and the lint reports exactly the documented codes', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('broken-mindmaze')
    const refused = await buildCourse(root, undefined, { playerDir: bundle })
    expect(refused.ok).toBe(false)
    const forced = await buildCourse(root, undefined, { playerDir: bundle, force: true })
    expect(forced.ok).toBe(true)
    expect(forced.forced).toBe(true)
    expect(codes(forced.problems)).toEqual(await expected('Expected problem codes of the forced build'))

    const r = await lintGame(forced.outDir)
    expect(r.ok).toBe(false)
    expect(codes(r.problems.filter((p) => p.severity === 'error'))).toEqual(await expected('Expected lint error codes'))
    expect(codes(r.problems.filter((p) => p.severity === 'warning'))).toEqual(await expected('Expected lint warning codes'))
  })

  it('names every MAZE_ code of the shell somewhere in EXPECTED.md', async () => {
    const { MAZE_CODES } = await import('../src/shared/shells/mindmaze')
    const documented = [...(await expected('Expected lint error codes')), ...(await expected('Expected lint warning codes'))]
    expect(documented.sort()).toEqual([...MAZE_CODES].sort())
  })
})
