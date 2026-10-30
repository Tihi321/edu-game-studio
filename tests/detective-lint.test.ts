import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { lintGame } from '../src/engine/edu/lint'
import { makeTextResolver } from '../src/shared/edu'
import { PuzzleError } from '../src/shared/puzzles'
import { DET_CODES, detectiveSectionSchema, lintDetective, type DetectiveSection } from '../src/shared/shells/detective'
import type { ShellLintContext } from '../src/shared/shells'
import { FIXTURES, loadFixture } from './edu-fixtures'
import { copyFixture, fakeBundle, useTemp } from './edu-build-helpers'

/**
 * The detective section and its lint (EGS-14): the golden fixtures build and lint clean, the broken-detective fixture reports exactly the
 * codes of its EXPECTED.md, the three puzzle codes fire with an injected case builder, and the schema is strict.
 */

useTemp()

const codes = (ps: readonly { code: string }[]): string[] => [...new Set(ps.map((p) => p.code))].sort()

describe('detective: golden fixtures build and lint clean', () => {
  for (const name of ['solar-system', 'european-capitals'] as const) {
    it(`${name}: 0 problems (no error, no warning) from the detective section`, async () => {
      const bundle = await fakeBundle()
      const { root } = await copyFixture(name)
      const b = await buildCourse(root, undefined, { playerDir: bundle })
      expect(b.problems).toEqual([])
      expect(b.ok).toBe(true)
      const r = await lintGame(b.outDir)
      expect(r.errors).toBe(0)
      expect(r.problems.filter((p) => p.code.startsWith('DET_'))).toEqual([])
      expect(r.ok).toBe(true)
    })
  }
})

describe('detective: the broken fixture', () => {
  const expected = async (heading: string): Promise<string[]> => {
    const md = await readFile(path.join(FIXTURES, 'broken-detective', 'EXPECTED.md'), 'utf8')
    const section = md.split(/^## /m).find((s) => s.startsWith(heading))
    if (!section) throw new Error(`EXPECTED.md has no "${heading}" section`)
    return [...section.matchAll(/^- `([A-Z_]+)`/gm)].map((m) => m[1]!).sort()
  }

  it('does not build the normal way, builds with force, and the lint reports exactly the documented codes', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('broken-detective')
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

  it('documents every DET_ code of the shell: the fixture holds all but the three puzzle codes, which the injected builder below covers', async () => {
    const documented = [...(await expected('Expected lint error codes')), ...(await expected('Expected lint warning codes'))].filter((c) => c.startsWith('DET_'))
    const puzzle = ['DET_PUZZLE_INVALID', 'DET_PUZZLE_NOT_UNIQUE', 'DET_PUZZLE_UNSOLVABLE']
    expect([...documented, ...puzzle].sort()).toEqual([...DET_CODES].sort())
  })
})

describe('detective: the puzzle codes, with an injected case builder', () => {
  async function lint(build: () => never): Promise<string[]> {
    const f = await loadFixture('solar-system')
    const section = detectiveSectionSchema.parse(f.pack.shells.config.detective) as DetectiveSection
    const ctx: ShellLintContext = { pack: f.pack, catalogs: f.catalogs, editions: f.pack.languages, resolvers: Object.fromEntries(f.pack.languages.map((l) => [l, makeTextResolver(f.catalogs, l, f.pack.targetLang)])) }
    return codes(lintDetective(section, ctx, { build }))
  }

  it('DET_PUZZLE_INVALID when the generator cannot make the case', async () => {
    expect(await lint(() => { throw new PuzzleError('no easy puzzle found for seed 1') })).toEqual(['DET_PUZZLE_INVALID'])
  })
  it('DET_PUZZLE_NOT_UNIQUE when verify() finds more than one solution', async () => {
    expect(await lint(() => { throw new PuzzleError('the puzzle does not have exactly one solution') })).toEqual(['DET_PUZZLE_NOT_UNIQUE'])
  })
  it('DET_PUZZLE_UNSOLVABLE when deduction alone cannot solve it', async () => {
    expect(await lint(() => { throw new PuzzleError('the puzzle cannot be solved by deduction alone') })).toEqual(['DET_PUZZLE_UNSOLVABLE'])
  })
})

describe('detective: the section schema', () => {
  const base = { rooms: [{ id: 'r', title: 'k', story: 'k', case: { names: {}, items: ['i'] } }] }
  it('fills the defaults (a size 3 easy murdle from seed 1)', () => {
    const s = detectiveSectionSchema.parse(base)
    expect(s.rooms[0]?.case).toMatchObject({ kind: 'murdle', size: 3, seed: 1, band: 'easy', aliases: {}, labels: {} })
  })
  it('refuses unknown keys, sizes the generator does not make, kinds the shell does not play and too many decoys', () => {
    expect(detectiveSectionSchema.safeParse({ ...base, extra: 1 }).success).toBe(false)
    expect(detectiveSectionSchema.safeParse({ rooms: [{ ...base.rooms[0], case: { names: {}, items: ['i'], size: 5 } }] }).success).toBe(false)
    expect(detectiveSectionSchema.safeParse({ rooms: [{ ...base.rooms[0], case: { names: {}, items: ['i'], kind: 'knights' } }] }).success).toBe(false)
    expect(detectiveSectionSchema.safeParse({ rooms: [] }).success).toBe(false)
    const chase = { suspect: 'k', start: 'a', map: 'm', places: [{ id: 'a', name: 'k', x: 1, y: 1 }, { id: 'b', name: 'k', x: 2, y: 2 }], route: [{ from: 'a', to: 'b', item: 'i', decoys: ['a', 'a', 'a', 'a', 'a', 'a'] }] }
    expect(detectiveSectionSchema.safeParse({ ...base, chase }).success).toBe(false)
  })
})
