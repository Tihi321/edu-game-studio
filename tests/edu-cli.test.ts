import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CLI_COMMANDS, parseCliArgs, runCli } from '../src/engine/educli'
import { FIXTURES } from './edu-fixtures'
import { fakeBundle, tmp, useTemp } from './edu-build-helpers'

useTemp()

let bundle: string
beforeAll(async () => {
  bundle = await fakeBundle()
})

interface Run {
  code: number
  out: string
  lines: string[]
}

/** Runs the CLI function with a data folder, capturing what it prints. */
async function cli(dataDir: string, ...args: string[]): Promise<Run> {
  const lines: string[] = []
  const code = await runCli([...args, '--data', dataDir], { out: (l) => lines.push(l) }, { ...process.env, EDU_PLAYER_DIR: bundle })
  return { code, out: lines.join('\n'), lines }
}

describe('parseCliArgs', () => {
  it('splits words, valued flags and switches', () => {
    expect(parseCliArgs(['build', 'x', '--data', '/d', '--force', '--slug=s', '--json'])).toEqual({ words: ['build', 'x'], values: { data: '/d', slug: 's' }, switches: new Set(['force', 'json']) })
    expect(parseCliArgs(['--data', '/d', 'lint', 'x']).words).toEqual(['lint', 'x'])
  })

  it('knows the commands', () => {
    expect([...CLI_COMMANDS].sort()).toEqual(['build', 'courses', 'help', 'import-course', 'lint', 'validate'])
  })
})

describe('the engine CLI', () => {
  it('prints help (exit 0) and rejects an unknown command (exit 2)', async () => {
    const dir = await tmp()
    for (const args of [[], ['help'], ['--help']]) {
      const r = await cli(dir, ...args)
      expect(r.code).toBe(0)
      for (const c of ['courses', 'import-course', 'validate', 'build', 'lint', '--force', '--json']) expect(r.out).toContain(c)
    }
    const bad = await cli(dir, 'dance')
    expect(bad.code).toBe(2)
    expect(bad.out).toContain('unknown command "dance"')
  })

  it('needs a slug or a folder (exit 2)', async () => {
    const dir = await tmp()
    for (const c of ['validate', 'build', 'lint', 'import-course']) expect((await cli(dir, c)).code, c).toBe(2)
  })

  it('imports, lists, validates, builds and lints the golden fixtures: all exit 0', async () => {
    const dir = await tmp()
    expect(await cli(dir, 'courses')).toMatchObject({ code: 0, out: expect.stringContaining('no courses') })
    for (const name of ['solar-system', 'hr-a1-greetings']) {
      const imp = await cli(dir, 'import-course', path.join(FIXTURES, name))
      expect(imp.code, imp.out).toBe(0)
      expect(imp.out).toContain('validation: ok')
    }
    const list = await cli(dir, 'courses')
    expect(list.code).toBe(0)
    expect(list.lines.map((l) => l.split('\t')[0]).sort()).toEqual(['hr-a1-greetings', 'solar-system'])
    for (const slug of ['solar-system', 'hr-a1-greetings']) {
      expect(await cli(dir, 'validate', slug)).toMatchObject({ code: 0, out: `${slug}: valid` })
      const build = await cli(dir, 'build', slug)
      expect(build.code, build.out).toBe(0)
      expect(build.out).toContain('built')
      expect((await stat(path.join(dir, 'courses', slug, 'build', 'index.html'))).isFile()).toBe(true)
      const lint = await cli(dir, 'lint', slug)
      expect(lint.code, lint.out).toBe(0)
      expect(lint.out).toMatch(/0 error\(s\)/)
    }
    // the placeholder audio of hr-a1-greetings is a warning that still exits 0
    expect((await cli(dir, 'lint', 'hr-a1-greetings')).out).toMatch(/warning {2}PLACEHOLDER_ASSET/)
  })

  it('lint builds first when there is no build', async () => {
    const dir = await tmp()
    await cli(dir, 'import-course', path.join(FIXTURES, 'solar-system'))
    const r = await cli(dir, 'lint', 'solar-system')
    expect(r.code).toBe(0)
    expect(r.out).toContain('(built first)')
    expect((await cli(dir, 'lint', 'solar-system')).out).not.toContain('(built first)')
  })

  it('lint --json prints the result', async () => {
    const dir = await tmp()
    await cli(dir, 'import-course', path.join(FIXTURES, 'hr-a1-greetings'))
    const r = await cli(dir, 'lint', 'hr-a1-greetings', '--json')
    expect(r.code).toBe(0)
    const parsed = JSON.parse(r.out) as { ok: boolean; errors: number; warnings: number; problems: { code: string; severity: string }[] }
    expect(parsed).toMatchObject({ ok: true, errors: 0, warnings: 2 })
    expect(parsed.problems.every((p) => p.code === 'PLACEHOLDER_ASSET' && p.severity === 'warning')).toBe(true)
  })

  it('the broken fixture: validate exits 1, build exits 1, build --force exits 0, lint exits 1 with the codes', async () => {
    const dir = await tmp()
    expect((await cli(dir, 'import-course', path.join(FIXTURES, 'broken'))).code).toBe(1) // imported, but it does not validate
    const v = await cli(dir, 'validate', 'broken')
    expect(v.code).toBe(1)
    expect(v.out).toMatch(/SCHEMA/)
    const b = await cli(dir, 'build', 'broken')
    expect(b.code).toBe(1)
    expect(b.out).toContain('--force')
    // a lint with nothing built and nothing buildable is a failure too
    expect((await cli(dir, 'lint', 'broken')).code).toBe(1)
    const forced = await cli(dir, 'build', 'broken', '--force')
    expect(forced.code, forced.out).toBe(0)
    expect(forced.out).toContain('forced')
    const lint = await cli(dir, 'lint', 'broken')
    expect(lint.code).toBe(1)
    for (const c of ['ITEM_MULTI_KEY', 'DISTRACTOR_DUPLICATE', 'DISTRACTOR_IS_KEY', 'OBJECTIVE_ONE_FORM', 'ASSET_MISSING', 'TEXT_MISSING', 'PREREQ_CYCLE', 'PLACEHOLDER', 'ACCEPTED_INCOMPLETE']) expect(lint.out, c).toContain(c)
    expect(lint.out).toMatch(/\d+ error\(s\), 0 warning\(s\)/)
    const json = JSON.parse((await cli(dir, 'lint', 'broken', '--json')).out) as { ok: boolean }
    expect(json.ok).toBe(false)
  })

  it('import-course: refuses to replace unless --overwrite, takes --slug, and fails on a folder that is not a course', async () => {
    const dir = await tmp()
    expect((await cli(dir, 'import-course', path.join(FIXTURES, 'solar-system'))).code).toBe(0)
    const again = await cli(dir, 'import-course', path.join(FIXTURES, 'solar-system'))
    expect(again.code).toBe(1)
    expect(again.out).toMatch(/already exists/)
    expect((await cli(dir, 'import-course', path.join(FIXTURES, 'solar-system'), '--overwrite')).code).toBe(0)
    const renamed = await cli(dir, 'import-course', path.join(FIXTURES, 'solar-system'), '--slug', 'sun')
    expect(renamed.code).toBe(0)
    expect(JSON.parse(await readFile(path.join(dir, 'courses', 'sun', 'course', 'pack.json'), 'utf8')).slug).toBe('sun')
    const bad = await cli(dir, 'import-course', FIXTURES)
    expect(bad.code).toBe(1)
    expect(bad.out).toMatch(/not a course folder/)
  })

  it('says so when there is no course, or no player bundle (exit 1)', async () => {
    const dir = await tmp()
    for (const c of ['validate', 'build', 'lint']) {
      const r = await cli(dir, c, 'ghost')
      expect(r.code, c).toBe(1)
      expect(r.out).toContain('no course "ghost"')
    }
    await cli(dir, 'import-course', path.join(FIXTURES, 'solar-system'))
    const lines: string[] = []
    const none = await tmp()
    const code = await runCli(['build', 'solar-system', '--data', dir], { out: (l) => lines.push(l) }, { ...process.env, EDU_PLAYER_DIR: none })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('yarn build:player')
  })

  it('starts no engine: the data folder only gets courses/', async () => {
    const dir = await tmp()
    await cli(dir, 'import-course', path.join(FIXTURES, 'solar-system'))
    await cli(dir, 'build', 'solar-system')
    await cli(dir, 'lint', 'solar-system')
    expect(await readdir(dir)).toEqual(['courses'])
  })
})
