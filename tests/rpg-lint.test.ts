import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { lintGame } from '../src/engine/edu/lint'
import { makeTextResolver, validateCourse } from '../src/shared/edu'
import { SHELL_DEFS, sectionOf, validateShellSections } from '../src/shared/shells'
import { RPG_ERROR_CODES, RPG_WARNING_CODES, rpgShell } from '../src/shared/shells/rpg'
import type { RpgSection } from '../src/shared/shells/rpg-layout'
import type { ShellLintContext, ShellLintProblem } from '../src/shared/shells/types'
import { copyFixture, fakeBundle, useTemp } from './edu-build-helpers'
import { FIXTURE_NAMES, FIXTURES, loadFixture, type LoadedFixture } from './edu-fixtures'

useTemp()

/** The lint of the RPG shell (EGS-12): the golden fixtures are clean, every code fires on a broken variant, the broken fixture reports exactly its codes. */

const ctxOf = (f: LoadedFixture): ShellLintContext => ({
  pack: f.pack,
  catalogs: f.catalogs,
  editions: f.pack.languages,
  resolvers: Object.fromEntries(f.pack.languages.map((l) => [l, makeTextResolver(f.catalogs, l, f.pack.targetLang)]))
})
const codes = (ps: readonly { code: string }[]): string[] => [...new Set(ps.map((p) => p.code))].sort()
const lint = (f: LoadedFixture, section: RpgSection | undefined): ShellLintProblem[] => rpgShell.lint(section, ctxOf(f))

let solar: Promise<LoadedFixture> | undefined
const solarSystem = (): Promise<LoadedFixture> => (solar ??= loadFixture('solar-system'))
const sectionOfSolar = async (): Promise<RpgSection> => structuredClone(sectionOf<RpgSection>((await solarSystem()).pack, 'rpg') as RpgSection)

describe('rpg lint: the golden fixtures', () => {
  it('registers the shell with its codes', () => {
    expect(SHELL_DEFS.get('rpg')).toBe(rpgShell)
    expect(rpgShell.requiresSection).toBe(false)
    expect(rpgShell.theme).toBe('pixel')
    expect([...rpgShell.codes].sort()).toEqual([...RPG_ERROR_CODES, ...RPG_WARNING_CODES].sort())
    expect(RPG_ERROR_CODES).toHaveLength(11)
    expect([...RPG_WARNING_CODES]).toEqual(['RPG_FOE_ITEM_OTHER_UNIT', 'RPG_NO_STORY'])
  })

  it('solar-system: the authored section is clean (no error, no warning) and validates', async () => {
    const f = await solarSystem()
    const section = sectionOf<RpgSection>(f.pack, 'rpg')
    expect(section).toBeDefined()
    expect(lint(f, section)).toEqual([])
    expect(validateShellSections(f.pack).problems).toEqual([])
    expect(f.pack.shells.enabled).toContain('rpg')
  })

  for (const name of FIXTURE_NAMES) {
    it(`${name}: the automatic layout (no section) lints clean`, async () => {
      const f = await loadFixture(name)
      expect(lint(f, undefined)).toEqual([])
      // an empty section behaves the same (the layout is automatic)
      expect(lint(f, rpgShell.schema.parse({}))).toEqual([RPG_NO_STORY_WARNING])
    })
  }

  it('solar-system without its section: the automatic layout lints clean', async () => {
    const f = await solarSystem()
    const noSection = structuredClone(f.pack)
    delete noSection.shells.config.rpg
    const g = { ...f, pack: noSection }
    expect(lint(g, sectionOf<RpgSection>(noSection, 'rpg'))).toEqual([])
  })
})

const RPG_NO_STORY_WARNING: ShellLintProblem = { code: 'RPG_NO_STORY', path: 'story.intro', message: 'the section has no frame story (no intro lines)', severity: 'warning' }

describe('rpg lint: every code fires on a broken variant of the golden section', () => {
  const only = async (mutate: (s: RpgSection) => void): Promise<string[]> => {
    const s = await sectionOfSolar()
    mutate(s)
    return codes(lint(await solarSystem(), s))
  }

  it('RPG_MAP_RAGGED: a row of another width', async () => {
    expect(await only((s) => (s.areas[0]!.map[2] = s.areas[0]!.map[2]!.slice(1)))).toContain('RPG_MAP_RAGGED')
  })

  it('RPG_MAP_NO_START: no "@"', async () => {
    expect(await only((s) => (s.areas[0]!.map = s.areas[0]!.map.map((r) => r.replace('@', '.'))))).toContain('RPG_MAP_NO_START')
  })

  it('RPG_MAP_UNREACHABLE: a foe walled in, and a gate walled off', async () => {
    const walled = await only((s) => {
      const a = s.areas[0]!
      // wall the whole column in front of the gate off from the rest
      a.map = a.map.map((r, y) => (y >= 1 && y <= 7 ? r.slice(0, 12) + '#' + r.slice(13) : r))
    })
    expect(walled).toContain('RPG_MAP_UNREACHABLE')
    // a foe in a pocket of trees
    const put = (rows: string[], x: number, y: number, ch: string): void => {
      rows[y] = rows[y]!.slice(0, x) + ch + rows[y]!.slice(x + 1)
    }
    const pocket = await only((s) => {
      const a = s.areas[1]! // the foe f-allrock stands at 6,6
      for (const [x, y] of [[6, 5], [5, 6], [7, 6], [6, 7]] as const) put(a.map, x, y, 'T')
    })
    expect(pocket).toContain('RPG_MAP_UNREACHABLE')
  })

  it('RPG_SPOT_BLOCKED: someone on a wall, outside the map, on water, on the start, or two on one tile', async () => {
    const onWall = await sectionOfSolar()
    onWall.areas[0]!.foes[0]!.at = [0, 0]
    const f = await solarSystem()
    expect(lint(f, onWall).filter((p) => p.code === 'RPG_SPOT_BLOCKED')).toHaveLength(1)
    const outside = await sectionOfSolar()
    outside.areas[0]!.foes[0]!.at = [40, 40]
    expect(lint(f, outside).filter((p) => p.code === 'RPG_SPOT_BLOCKED')[0]!.message).toContain('outside the map')
    const water = await sectionOfSolar()
    water.areas[0]!.foes[0]!.at = [9, 2]
    expect(lint(f, water).filter((p) => p.code === 'RPG_SPOT_BLOCKED')[0]!.message).toContain('water')
    const start = await sectionOfSolar()
    start.areas[0]!.foes[0]!.at = [1, 3]
    expect(lint(f, start).filter((p) => p.code === 'RPG_SPOT_BLOCKED')[0]!.message).toContain('start')
    const twice = await sectionOfSolar()
    twice.areas[0]!.foes[0]!.at = [11, 2]
    expect(lint(f, twice).filter((p) => p.code === 'RPG_SPOT_BLOCKED')[0]!.message).toContain('shares')
  })

  it('RPG_NO_QUEST_GIVER and RPG_DIALOGUE_EMPTY', async () => {
    expect(await only((s) => s.areas[0]!.npcs.forEach((n) => (n.quest = false)))).toContain('RPG_NO_QUEST_GIVER')
    expect(await only((s) => (s.areas[1]!.npcs[1]!.lines = []))).toContain('RPG_DIALOGUE_EMPTY')
  })

  it('RPG_AREA_UNIT_MISSING, RPG_UNIT_NO_AREA', async () => {
    expect(await only((s) => (s.areas[2]!.unit = 'u-nowhere'))).toEqual(expect.arrayContaining(['RPG_AREA_UNIT_MISSING', 'RPG_UNIT_NO_AREA']))
    expect(await only((s) => s.areas.pop())).toEqual(['RPG_UNIT_NO_AREA'])
  })

  it('RPG_FOE_NO_ITEMS, RPG_FOE_ITEM_MISSING and RPG_QUEST_UNWINNABLE', async () => {
    expect(await only((s) => (s.areas[0]!.foes[0]!.items = []))).toEqual(expect.arrayContaining(['RPG_FOE_NO_ITEMS', 'RPG_QUEST_UNWINNABLE']))
    expect(await only((s) => (s.areas[0]!.foes[0]!.items = ['q-ghost']))).toEqual(expect.arrayContaining(['RPG_FOE_ITEM_MISSING', 'RPG_QUEST_UNWINNABLE']))
    // one good item left: still winnable, only the missing one is reported
    const some = await only((s) => (s.areas[0]!.foes[0]!.items = ['q-sun-mcq', 'q-ghost']))
    expect(some).toContain('RPG_FOE_ITEM_MISSING')
    expect(some).not.toContain('RPG_QUEST_UNWINNABLE')
  })

  it('RPG_FOE_ITEM_OTHER_UNIT and RPG_NO_STORY are warnings', async () => {
    const s = await sectionOfSolar()
    s.areas[0]!.foes[0]!.items = ['q-sun-mcq', 'q-types-mcq']
    s.story.intro = []
    const ps = lint(await solarSystem(), s)
    expect(codes(ps)).toEqual(['RPG_FOE_ITEM_OTHER_UNIT', 'RPG_NO_STORY'])
    expect(ps.every((p) => p.severity === 'warning')).toBe(true)
  })

  it('RPG_QUEST_UNWINNABLE: a course without items', async () => {
    const f = await solarSystem()
    const empty = { ...f, pack: { ...f.pack, items: [] } }
    expect(codes(lint(empty as LoadedFixture, undefined))).toContain('RPG_QUEST_UNWINNABLE')
  })

  it('the validator blocks unknown units, items and assets and missing texts, so the build refuses them', async () => {
    const f = await solarSystem()
    const raw = structuredClone(f.rawPack) as Record<string, unknown>
    const cfg = (raw.shells as { config: { rpg: RpgSection } }).config.rpg
    cfg.areas[0]!.unit = 'u-nowhere'
    cfg.areas[1]!.foes[0]!.items = ['q-ghost']
    cfg.areas[2]!.foes[0]!.sprite = 'rpg-no-such-image'
    cfg.areas[2]!.name = 'rpg.no.such.key'
    const res = validateCourse(raw, f.rawCatalogs)
    expect(res.ok).toBe(false)
    const got = codes(res.problems)
    expect(got).toEqual(expect.arrayContaining(['UNKNOWN_UNIT', 'UNKNOWN_ITEM', 'UNKNOWN_ASSET', 'MISSING_TEXT']))
  })

  it('SHELL_SCHEMA: a bad map character or a stray field does not parse', async () => {
    const s = await sectionOfSolar()
    expect(rpgShell.schema.safeParse({ ...s, nope: 1 }).success).toBe(false)
    const bad = structuredClone(s)
    bad.areas[0]!.map[1] = '#xx#'
    expect(rpgShell.schema.safeParse(bad).success).toBe(false)
    expect(rpgShell.schema.safeParse({ areas: [{ ...s.areas[0], map: ['##'] }] }).success).toBe(false) // fewer than three rows
  })
})

describe('rpg lint: the broken fixture', () => {
  const expected = async (heading: string): Promise<string[]> => {
    const md = await readFile(path.join(FIXTURES, 'broken-rpg', 'EXPECTED.md'), 'utf8')
    const section = md.split(/^## /m).find((s) => s.startsWith(heading))
    if (!section) throw new Error(`EXPECTED.md has no "${heading}" section`)
    return [...section.matchAll(/^- `([A-Z_]+)`/gm)].map((m) => m[1]!).sort()
  }

  it('does not build the normal way, builds with force, and the lint reports exactly the documented codes', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('broken-rpg')
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
    // every error code of the shell is there
    for (const c of RPG_ERROR_CODES) expect(codes(r.problems), c).toContain(c)
    for (const c of RPG_WARNING_CODES) expect(codes(r.problems), c).toContain(c)
    // every problem is under the section's path
    for (const p of r.problems.filter((x) => x.code.startsWith('RPG_'))) expect(p.path.startsWith('shells.config.rpg'), p.path).toBe(true)
  })
})
