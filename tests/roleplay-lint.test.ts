import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { lintGame } from '../src/engine/edu/lint'
import { ROLEPLAY_CODES, roleplayShell, roleplaySectionSchema } from '../src/shared/shells/roleplay'
import { FIXTURES } from './edu-fixtures'
import { copyFixture, fakeBundle, useTemp } from './edu-build-helpers'

/**
 * The role-play lint end to end (EGS-13): the golden fixture that enables the shell builds and lints with no role-play problem, and the
 * broken-roleplay fixture (a section that is wrong on purpose) is refused by the normal build, builds with `force` and reports exactly the
 * codes of its EXPECTED.md.
 */

useTemp()

const codes = (ps: readonly { code: string }[]): string[] => [...new Set(ps.map((p) => p.code))].sort()

describe('roleplay: the golden fixture builds and lints clean', () => {
  it('hr-a1-greetings: no problem from the shell (no RP_ error or warning)', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('hr-a1-greetings')
    const b = await buildCourse(root, undefined, { playerDir: bundle })
    expect(b.problems).toEqual([])
    expect(b.ok).toBe(true)
    const r = await lintGame(b.outDir)
    expect(r.errors).toBe(0)
    expect(r.problems.filter((p) => p.code.startsWith('RP_'))).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('a course that does not enable the shell is not linted by it', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('solar-system')
    const b = await buildCourse(root, undefined, { playerDir: bundle })
    const r = await lintGame(b.outDir)
    expect(r.problems.filter((p) => p.code.startsWith('RP_') || p.code === 'SHELL_SECTION_MISSING')).toEqual([])
  })
})

describe('roleplay: the broken fixture', () => {
  const expected = async (heading: string): Promise<string[]> => {
    const md = await readFile(path.join(FIXTURES, 'broken-roleplay', 'EXPECTED.md'), 'utf8')
    const section = md.split(/^## /m).find((s) => s.startsWith(heading))
    if (!section) throw new Error(`EXPECTED.md has no "${heading}" section`)
    return [...section.matchAll(/^- `([A-Z_]+)`/gm)].map((m) => m[1]!).sort()
  }

  it('does not build the normal way, builds with force, and the lint reports exactly the documented codes', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('broken-roleplay')
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

  it('names every RP_ code of the shell somewhere in EXPECTED.md', async () => {
    const documented = [...(await expected('Expected lint error codes')), ...(await expected('Expected lint warning codes'))].filter((c) => c.startsWith('RP_'))
    expect(documented.sort()).toEqual([...ROLEPLAY_CODES].sort())
  })
})

describe('roleplay: the section schema', () => {
  it('fills the defaults of an empty section and refuses unknown keys', () => {
    expect(roleplaySectionSchema.parse({})).toEqual({ speakers: [], scenes: [], garden: [] })
    expect(roleplaySectionSchema.safeParse({ scenes: [], extra: 1 }).success).toBe(false)
  })

  it('is registered as a shell that requires its section, with the postcard theme', () => {
    expect(roleplayShell.id).toBe('roleplay')
    expect(roleplayShell.theme).toBe('postcard')
    expect(roleplayShell.requiresSection).toBe(true)
    expect(roleplayShell.warnings).toEqual(['RP_TEXT_NOT_TARGET', 'RP_REPLY_NOT_PRODUCTION', 'RP_CEFR_ABOVE_COURSE'])
  })
})
