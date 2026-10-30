import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { lintGame } from '../src/engine/edu/lint'
import { encyclopediaShell } from '../src/shared/shells/encyclopedia'
import { FIXTURES } from './edu-fixtures'
import { copyFixture, fakeBundle, useTemp } from './edu-build-helpers'

/**
 * The encyclopedia lint end to end (EGS-10): the golden fixtures build and lint clean with the explorer enabled (authored section, and
 * solar-system without its section: the automatic layout), and the broken-encyclopedia fixture (wrong on purpose) is refused by the
 * normal build, builds with `force` and reports exactly the codes of its EXPECTED.md.
 */

useTemp()

const codes = (ps: readonly { code: string }[]): string[] => [...new Set(ps.map((p) => p.code))].sort()

type Pack = { shells: { enabled: string[]; config: Record<string, unknown> } }

async function lintFixture(name: string, edit?: (pack: Pack) => void) {
  const bundle = await fakeBundle()
  const { root } = await copyFixture(name)
  if (edit) {
    const file = path.join(root, 'course', 'pack.json')
    const pack = JSON.parse(await readFile(file, 'utf8')) as Pack
    edit(pack)
    await writeFile(file, JSON.stringify(pack, null, 2))
  }
  const b = await buildCourse(root, undefined, { playerDir: bundle })
  expect(b.problems).toEqual([])
  expect(b.ok).toBe(true)
  return lintGame(b.outDir)
}

describe('encyclopedia: golden fixtures build and lint clean', () => {
  for (const name of ['solar-system', 'european-capitals'] as const) {
    it(`${name} (authored section): 0 problems, 0 errors and 0 warnings`, async () => {
      const r = await lintFixture(name, (p) => {
        expect(p.shells.enabled).toContain('encyclopedia')
        expect(p.shells.config.encyclopedia).toBeTruthy()
      })
      expect(r.problems.filter((p) => p.code.startsWith('ENC_'))).toEqual([])
      expect(r.errors).toBe(0)
      expect(r.warnings).toBe(0)
      expect(r.ok).toBe(true)
    })
  }

  it('solar-system without its section (the automatic layout): lints clean too', async () => {
    const r = await lintFixture('solar-system', (p) => {
      delete p.shells.config.encyclopedia
    })
    expect(r.problems.filter((p) => p.code.startsWith('ENC_') || p.code.startsWith('SHELL_'))).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('solar-system with an empty section {} is the automatic layout as well', async () => {
    const r = await lintFixture('solar-system', (p) => {
      p.shells.config.encyclopedia = {}
    })
    expect(r.problems.filter((p) => p.code.startsWith('ENC_'))).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('european-capitals without its section lints clean as well', async () => {
    const r = await lintFixture('european-capitals', (p) => {
      delete p.shells.config.encyclopedia
    })
    expect(r.problems.filter((p) => p.code.startsWith('ENC_'))).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('a course that does not enable the shell is not linted for it', async () => {
    const r = await lintFixture('solar-system', (p) => {
      p.shells.enabled = p.shells.enabled.filter((s) => s !== 'encyclopedia')
    })
    expect(r.problems.filter((p) => p.code.startsWith('ENC_'))).toEqual([])
  })
})

describe('encyclopedia: the broken fixture', () => {
  const expected = async (heading: string): Promise<string[]> => {
    const md = await readFile(path.join(FIXTURES, 'broken-encyclopedia', 'EXPECTED.md'), 'utf8')
    const section = md.split(/^## /m).find((s) => s.startsWith(heading))
    if (!section) throw new Error(`EXPECTED.md has no "${heading}" section`)
    return [...section.matchAll(/^- `([A-Z_]+)`/gm)].map((m) => m[1]!).sort()
  }

  it('does not build the normal way, builds with force, and the lint reports exactly the documented codes', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('broken-encyclopedia')
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

  it('fires every ENC_ code of the shell, and EXPECTED.md names no other', async () => {
    const documented = [...(await expected('Expected lint error codes')), ...(await expected('Expected lint warning codes'))].filter((c) => c.startsWith('ENC_'))
    expect(documented.sort()).toEqual([...encyclopediaShell.codes].sort())
    // the warnings are the shell's warning codes, the others are errors
    expect((await expected('Expected lint warning codes')).sort()).toEqual([...(encyclopediaShell.warnings ?? [])].sort())
  })

  it('points the messages at the section path of each mistake', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('broken-encyclopedia')
    const forced = await buildCourse(root, undefined, { playerDir: bundle, force: true })
    const r = await lintGame(forced.outDir)
    const at = (code: string) => r.problems.filter((p) => p.code === code).map((p) => p.path)
    expect(at('ENC_HUNT_TARGET_MISSING')).toEqual(['shells.config.encyclopedia.hunts[0].steps[1].article'])
    expect(at('ENC_HUNT_ITEM_MISSING')).toEqual(['shells.config.encyclopedia.hunts[0].steps[2].item'])
    expect(at('ENC_MAP_PLACE_OUTSIDE')).toEqual(['shells.config.encyclopedia.map.places[2]'])
    expect(at('ENC_TIMELINE_ARTICLE_MISSING')).toEqual(['shells.config.encyclopedia.timeline[1].article'])
  })
})
