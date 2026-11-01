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
    expect(documented.sort()).toEqual([...encyclopediaShell.codes].filter((c) => c.startsWith('ENC_')).sort())
    // the warnings are the shell's warning codes, the others are errors
    expect((await expected('Expected lint warning codes')).sort()).toEqual([...(encyclopediaShell.warnings ?? [])].filter((c) => c.startsWith('ENC_')).sort())
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

// ---- the glossary of a reading (EGS-35) ----

type Catalog = { strings: Record<string, string> }
type GlossPack = Pack & { shells: { config: { encyclopedia: { glossary: Record<string, { id: string; term: string; gloss: string }[]> } } } }

/** Copies `de-b2-reading`, lets the test change the pack and the catalogs, builds (forced when the validator would refuse) and lints. */
async function lintReading(edit?: (pack: GlossPack, cats: { de: Catalog; hr: Catalog; en: Catalog }) => void, force = false) {
  const bundle = await fakeBundle()
  const { root } = await copyFixture('de-b2-reading')
  const packFile = path.join(root, 'course', 'pack.json')
  const files = { de: path.join(root, 'course', 'text', 'de.json'), hr: path.join(root, 'course', 'text', 'hr.json'), en: path.join(root, 'course', 'text', 'en.json') }
  const pack = JSON.parse(await readFile(packFile, 'utf8')) as GlossPack
  const cats = { de: JSON.parse(await readFile(files.de, 'utf8')) as Catalog, hr: JSON.parse(await readFile(files.hr, 'utf8')) as Catalog, en: JSON.parse(await readFile(files.en, 'utf8')) as Catalog }
  edit?.(pack, cats)
  await writeFile(packFile, JSON.stringify(pack, null, 2))
  for (const k of ['de', 'hr', 'en'] as const) await writeFile(files[k], JSON.stringify(cats[k], null, 2))
  const b = await buildCourse(root, undefined, { playerDir: bundle, ...(force ? { force: true } : {}) })
  if (!force) expect(b.problems).toEqual([])
  expect(b.ok).toBe(true)
  return { build: b, lint: await lintGame(b.outDir) }
}
const GL = 'shells.config.encyclopedia.glossary'

describe('encyclopedia: the de-b2-reading fixture and the GLOSS_ codes', () => {
  it('builds and lints clean: two readings of about 400 words with 12 glosses each, in two editions', async () => {
    const { lint, build } = await lintReading()
    expect(build.problems).toEqual([])
    expect(lint.errors).toBe(0)
    expect(lint.warnings).toBe(0)
    expect(lint.problems.filter((p) => p.code.startsWith('GLOSS_'))).toEqual([])
    expect(lint.ok).toBe(true)
  })

  it('GLOSS_TERM_NOT_IN_TEXT: a term that is not in the text of its article', async () => {
    const { lint } = await lintReading((_p, c) => {
      c.de.strings['art.art-homeoffice.gl.pendeln.term'] = 'Pendler'
    })
    const hit = lint.problems.filter((p) => p.code === 'GLOSS_TERM_NOT_IN_TEXT')
    expect(hit.map((p) => p.path)).toEqual([`${GL}.art-homeoffice[4].term`])
    expect(hit[0]?.severity).toBe('error')
    expect(lint.ok).toBe(false)
  })

  it('GLOSS_DUPLICATE: the same term twice in one text', async () => {
    const { lint } = await lintReading((p) => {
      const list = p.shells.config.encyclopedia.glossary['art-radverkehr'] as { id: string; term: string; gloss: string }[]
      list.push({ id: 'again', term: 'art.art-radverkehr.gl.stau.term', gloss: 'art.art-radverkehr.gl.stau.gloss' })
    })
    const hit = lint.problems.filter((p) => p.code === 'GLOSS_DUPLICATE')
    expect(hit.map((p) => p.path)).toEqual([`${GL}.art-radverkehr[12].term`])
    expect(hit[0]?.severity).toBe('error')
  })

  it('GLOSS_COVERAGE: fewer than 8 entries for a text of 300 words or more is a warning, not an error', async () => {
    const { lint } = await lintReading((p) => {
      p.shells.config.encyclopedia.glossary['art-homeoffice'] = (p.shells.config.encyclopedia.glossary['art-homeoffice'] ?? []).slice(0, 5)
    })
    const hit = lint.problems.filter((p) => p.code === 'GLOSS_COVERAGE')
    expect(hit.map((p) => [p.path, p.severity])).toEqual([[`${GL}.art-homeoffice`, 'warning']])
    expect(lint.errors).toBe(0)
    expect(lint.ok).toBe(true)
  })

  it('a gloss missing in one edition is TEXT_MISSING (in en); a glossary of an unknown article is UNKNOWN_ARTICLE', async () => {
    const missing = await lintReading((_p, c) => {
      delete c.en.strings['art.art-homeoffice.gl.mittelweg.gloss']
    }, true)
    expect(codes(missing.build.problems)).toEqual(['MISSING_TEXT'])
    const miss = missing.lint.problems.filter((p) => p.code === 'TEXT_MISSING' && p.message.includes('(in en)'))
    expect(miss.map((p) => p.path)).toEqual([`${GL}.art-homeoffice[10].gloss`])

    const unknown = await lintReading((p) => {
      p.shells.config.encyclopedia.glossary['art-nope'] = []
    }, true)
    expect(codes(unknown.build.problems)).toEqual(['UNKNOWN_ARTICLE'])
  })

  it('a duplicate gloss id inside one text is DUPLICATE_ID (the validator refuses it)', async () => {
    const dup = await lintReading((p) => {
      const list = p.shells.config.encyclopedia.glossary['art-homeoffice'] as { id: string; term: string; gloss: string }[]
      list.push({ ...(list[0] as { id: string; term: string; gloss: string }) })
    }, true)
    expect(codes(dup.build.problems)).toContain('DUPLICATE_ID')
  })

  it('the shell lists the GLOSS_ codes, the coverage one as a warning', () => {
    for (const c of ['GLOSS_TERM_NOT_IN_TEXT', 'GLOSS_DUPLICATE', 'GLOSS_COVERAGE']) expect(encyclopediaShell.codes).toContain(c)
    expect(encyclopediaShell.warnings).toContain('GLOSS_COVERAGE')
    expect(encyclopediaShell.warnings).not.toContain('GLOSS_DUPLICATE')
  })
})
