import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCourse, assetUrl, defaultLangOf } from '../src/engine/edu/build'
import { engineVersion, findPlayerBundle, PLAYER_BUNDLE_HINT } from '../src/engine/edu/player-bundle'
import { renderGameDataJs, type GameData } from '../src/shared/game-data'
import { BUNDLE_FILES, copyFixture, evalGameDataJs, fakeBundle, tmp, useTemp } from './edu-build-helpers'

useTemp()

const exists = (p: string) => stat(p).then(() => true, () => false)
const readJson = async <T>(p: string) => JSON.parse(await readFile(p, 'utf8')) as T

describe('findPlayerBundle', () => {
  it('uses EDU_PLAYER_DIR', async () => {
    const dir = await fakeBundle()
    const b = findPlayerBundle({ EDU_PLAYER_DIR: dir } as NodeJS.ProcessEnv)
    expect(b).toEqual({ js: path.join(dir, 'player.js'), css: path.join(dir, 'player.css') })
  })

  it('says what to run when EDU_PLAYER_DIR has no bundle', async () => {
    const dir = await tmp()
    expect(() => findPlayerBundle({ EDU_PLAYER_DIR: dir } as NodeJS.ProcessEnv)).toThrow(/yarn build:player/)
    expect(() => findPlayerBundle({ EDU_PLAYER_DIR: dir } as NodeJS.ProcessEnv)).toThrow(/EDU_PLAYER_DIR/)
  })

  it('walks up from the start folder to out/player', async () => {
    const root = await tmp()
    const out = path.join(root, 'out', 'player')
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, 'player.js'), 'x')
    await writeFile(path.join(out, 'player.css'), 'x')
    const start = path.join(root, 'out', 'engine')
    await mkdir(start, { recursive: true })
    expect(findPlayerBundle({} as NodeJS.ProcessEnv, start)).toEqual({ js: path.join(out, 'player.js'), css: path.join(out, 'player.css') })
  })

  it('needs both files, and throws the hint when there is no bundle', async () => {
    const root = await tmp()
    await mkdir(path.join(root, 'out', 'player'), { recursive: true })
    await writeFile(path.join(root, 'out', 'player', 'player.js'), 'x') // no css
    expect(() => findPlayerBundle({} as NodeJS.ProcessEnv, root)).toThrow(PLAYER_BUNDLE_HINT)
  })

  it('reads the engine version from package.json', () => {
    expect(engineVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('buildCourse: the golden fixtures', () => {
  for (const name of ['solar-system', 'hr-a1-greetings']) {
    it(`builds ${name} into a self-contained folder`, async () => {
      const bundle = await fakeBundle()
      const { root } = await copyFixture(name)
      const res = await buildCourse(root, undefined, { playerDir: bundle, now: new Date('2026-10-29T12:00:00Z') })
      expect(res.ok).toBe(true)
      expect(res.problems).toEqual([])
      expect(res.forced).toBe(false)
      expect(res.outDir).toBe(path.join(root, 'build'))
      const data = await readJson<GameData>(path.join(res.outDir, 'game-data.json'))

      // every file of the layout, and every asset of the pack
      for (const f of ['index.html', 'player.js', 'player.css', 'game-data.json', 'game-data.js']) expect(await exists(path.join(res.outDir, f)), f).toBe(true)
      expect(await readFile(path.join(res.outDir, 'player.js'), 'utf8')).toBe(BUNDLE_FILES.js)
      expect(await readFile(path.join(res.outDir, 'player.css'), 'utf8')).toBe(BUNDLE_FILES.css)
      expect(Object.keys(data.assets).sort()).toEqual(data.pack.assets.map((a) => a.id).sort())
      for (const a of data.pack.assets) {
        expect(data.assets[a.id]).toBe(`assets/${a.file.replace(/^assets\//, '')}`)
        expect(await exists(path.join(res.outDir, ...data.assets[a.id]!.split('/'))), a.id).toBe(true)
      }
      expect([...res.files].sort()).toEqual(['index.html', 'player.css', 'player.js', 'game-data.js', 'game-data.json', ...Object.values(data.assets)].sort())

      // the data
      expect(data).toMatchObject({ format: 'edu-game', version: 1, slug: name, builtAt: '2026-10-29T12:00:00.000Z', shell: 'quiz-arena', engine: engineVersion() })
      expect(data.defaultLang).toBe(defaultLangOf(data.pack))
      expect(Object.keys(data.catalogs).sort()).toEqual(['en', 'hr'])
      expect(data.pack.items.length).toBeGreaterThan(20)

      // game-data.js assigns the same data to window.EDU_GAME_DATA
      expect(evalGameDataJs(await readFile(path.join(res.outDir, 'game-data.js'), 'utf8'))).toEqual(data)
      const html = await readFile(path.join(res.outDir, 'index.html'), 'utf8')
      expect(html).toContain('<script src="game-data.js"></script>')
      expect(html).toContain('<script src="player.js"></script>')
      expect(html).toContain('href="player.css"')
      expect(html).toContain('id="edu-root"')
    })
  }

  it('puts the course title of the default edition (or the subject) in index.html', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('solar-system')
    const enPath = path.join(root, 'course', 'text', 'en.json')
    const en = await readJson<{ strings: Record<string, string> }>(enPath)
    en.strings['course.title'] = 'The <Solar> System & friends'
    await writeFile(enPath, JSON.stringify(en))
    await buildCourse(root, undefined, { playerDir: bundle })
    expect(await readFile(path.join(root, 'build', 'index.html'), 'utf8')).toContain('<title>The &lt;Solar&gt; System &amp; friends</title>')
    // without the string the subject is used
    delete en.strings['course.title']
    await writeFile(enPath, JSON.stringify(en))
    await buildCourse(root, undefined, { playerDir: bundle })
    const data = await readJson<GameData>(path.join(root, 'build', 'game-data.json'))
    expect(await readFile(path.join(root, 'build', 'index.html'), 'utf8')).toContain(`<title>${data.pack.subject}</title>`)
  })

  it('never lets a string close the script tag in game-data.js', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('solar-system')
    const enPath = path.join(root, 'course', 'text', 'en.json')
    const en = await readJson<{ strings: Record<string, string> }>(enPath)
    en.strings['course.title'] = 'x </script><script>alert(1)</script>'
    await writeFile(enPath, JSON.stringify(en))
    await buildCourse(root, undefined, { playerDir: bundle })
    const js = await readFile(path.join(root, 'build', 'game-data.js'), 'utf8')
    expect(js).not.toContain('</script>')
    expect((evalGameDataJs(js) as GameData).catalogs.en!.strings['course.title']).toBe('x </script><script>alert(1)</script>')
    expect(js).toBe(renderGameDataJs(JSON.parse(await readFile(path.join(root, 'build', 'game-data.json'), 'utf8')) as GameData))
  })
})

describe('buildCourse: refusing, forcing, cleaning', () => {
  it('does not build a course with problems, and leaves the old build alone', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('solar-system')
    const first = await buildCourse(root, undefined, { playerDir: bundle })
    expect(first.ok).toBe(true)
    const before = await readFile(path.join(root, 'build', 'game-data.json'), 'utf8')
    const enPath = path.join(root, 'course', 'text', 'en.json')
    const en = await readJson<{ strings: Record<string, string> }>(enPath)
    delete en.strings[Object.keys(en.strings)[0]!]
    await writeFile(enPath, JSON.stringify(en))
    const res = await buildCourse(root, undefined, { playerDir: bundle })
    expect(res.ok).toBe(false)
    expect(res.files).toEqual([])
    expect(res.problems.map((p) => p.code)).toContain('MISSING_TEXT')
    expect(await readFile(path.join(root, 'build', 'game-data.json'), 'utf8')).toBe(before)
  })

  it('reports a missing asset file and builds anyway with force', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('solar-system')
    await rm(path.join(root, 'course', 'assets', 'solar-system.svg'))
    expect((await buildCourse(root, undefined, { playerDir: bundle })).problems.map((p) => p.code)).toEqual(['MISSING_ASSET_FILE'])
    const forced = await buildCourse(root, undefined, { playerDir: bundle, force: true })
    expect(forced.ok).toBe(true)
    expect(forced.forced).toBe(true)
    expect(forced.problems.map((p) => p.code)).toEqual(['MISSING_ASSET_FILE'])
    expect(await exists(path.join(root, 'build', 'assets', 'solar-system.svg'))).toBe(false)
  })

  it('cannot force a pack that does not parse', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('solar-system')
    await writeFile(path.join(root, 'course', 'pack.json'), '{ not json')
    const res = await buildCourse(root, undefined, { playerDir: bundle, force: true })
    expect(res.ok).toBe(false)
    expect(res.problems.some((p) => p.code === 'PARSE')).toBe(true)
  })

  it('cleans its own build folder first', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('solar-system')
    await buildCourse(root, undefined, { playerDir: bundle })
    await writeFile(path.join(root, 'build', 'stale.txt'), 'old')
    await mkdir(path.join(root, 'build', 'assets', 'old'), { recursive: true })
    await buildCourse(root, undefined, { playerDir: bundle })
    expect(await exists(path.join(root, 'build', 'stale.txt'))).toBe(false)
    expect(await exists(path.join(root, 'build', 'assets', 'old'))).toBe(false)
    expect((await readdir(path.join(root, 'build'))).sort()).toEqual(['assets', 'game-data.js', 'game-data.json', 'index.html', 'player.css', 'player.js'])
  })

  it('refuses to clean a folder that is not a build', async () => {
    const bundle = await fakeBundle()
    const { root } = await copyFixture('solar-system')
    const other = await tmp()
    await writeFile(path.join(other, 'precious.txt'), 'keep me')
    await expect(buildCourse(root, other, { playerDir: bundle })).rejects.toThrow(/refusing to clean/)
    expect(await readFile(path.join(other, 'precious.txt'), 'utf8')).toBe('keep me')
    // an empty folder, and an earlier build, are fine
    const empty = await tmp()
    expect((await buildCourse(root, empty, { playerDir: bundle })).ok).toBe(true)
    expect((await buildCourse(root, empty, { playerDir: bundle })).ok).toBe(true)
  })

  it('throws before cleaning when there is no player bundle', async () => {
    const { root } = await copyFixture('solar-system')
    const bundle = await fakeBundle()
    await buildCourse(root, undefined, { playerDir: bundle })
    const none = await tmp()
    await expect(buildCourse(root, undefined, { playerDir: none })).rejects.toThrow(/yarn build:player/)
    expect(await exists(path.join(root, 'build', 'game-data.json'))).toBe(true)
  })
})

describe('assetUrl', () => {
  it('keeps assets under assets/', () => {
    expect(assetUrl('assets/a.svg')).toBe('assets/a.svg')
    expect(assetUrl('assets\\sub\\a.svg')).toBe('assets/sub/a.svg')
    expect(assetUrl('pics/a.svg')).toBe('assets/pics/a.svg')
    expect(assetUrl('./assets/a.svg')).toBe('assets/a.svg')
  })
})
