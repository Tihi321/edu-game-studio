import path from 'node:path'
import type { EngineEvent } from '../shared/protocol'
import { Engine } from './engine'
import type { EngineOptions } from './engine'
import { CourseStore } from './edu/store'
import { initDataFolder, resolveDataDir } from './store/dataFolder'
import { acquireEngineLock } from './store/lock'

/**
 * The CLI for courses: `yarn engine -- <command> ...` (= `node out/engine/index.js <command> ...`). The course commands only read and write
 * the files of the data folder (`courses/<slug>/`): they start no engine, no MCP server and no service, so they also work while the app
 * runs. Exit codes: 0 ok, 1 the course has problems (or the command failed), 2 a wrong command line.
 */

export const USAGE = `Edu Studio command line

Usage:
  yarn engine -- courses                       list the courses in the data folder (courses/<slug>/)
  yarn engine -- import-course <folder> [--slug <s>] [--overwrite]
                                               copy a course folder (course/pack.json, course/text/, course/assets/) into courses/<slug>/course
  yarn engine -- validate <slug>               check the schema, references, texts and asset files (exit 1 on problems)
  yarn engine -- build <slug> [--force]        build courses/<slug>/build/ (index.html, player.js, player.css, game-data.json, game-data.js, assets/);
                                               needs the player bundle (yarn build:player); --force builds despite validation problems
  yarn engine -- lint <slug> [--json]          lint the built game (builds first if there is no build); exit 0 clean (warnings allowed), 1 errors
  yarn engine -- help

  --data <dir>   Data folder. Default: EDU_DATA, else ~/EduGames
  --seed <dir>   Seed folder to copy from (engine commands). Default: the repo's seed/ (or EDU_SEED)
  --verbose      Print the engine log to stderr
`

export const CLI_COMMANDS = new Set(['courses', 'help', 'import-course', 'validate', 'build', 'lint'])

const VALUE_FLAGS = new Set(['data', 'seed', 'slug'])

/** Splits an argument list into words, `--flag value` pairs and `--switch`es. */
export function parseCliArgs(argv: readonly string[]): { words: string[]; values: Record<string, string>; switches: Set<string> } {
  const words: string[] = []
  const values: Record<string, string> = {}
  const switches = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('-')) {
      words.push(a)
      continue
    }
    const eq = a.indexOf('=')
    const name = a.slice(a.startsWith('--') ? 2 : 1, eq < 0 ? undefined : eq)
    if (VALUE_FLAGS.has(name)) {
      const v = eq >= 0 ? a.slice(eq + 1) : argv[++i]
      if (v !== undefined) values[name] = v
    } else switches.add(name)
  }
  return { words, values, switches }
}

export interface CliIo {
  out(line: string): void
}

const stdoutIo: CliIo = { out: (s) => void process.stdout.write(`${s}\n`) }

/**
 * A headless engine for a CLI run: the data folder is created from the seed. It takes the data-folder lock (released by `engine.stop()`):
 * with the app or another engine running on the folder it throws `EngineLockHeldError`.
 */
export async function startHeadless(argv: readonly string[], o: Partial<EngineOptions> & { print?: boolean } = {}): Promise<Engine> {
  const dataDir = resolveDataDir({ argv })
  const lock = await acquireEngineLock(dataDir)
  const seedIdx = argv.indexOf('--seed')
  const verbose = argv.includes('--verbose')
  const engine = new Engine({
    dataDir,
    lock,
    emit: (e: EngineEvent) => {
      o.emit?.(e)
    },
    log: (m) => {
      if (verbose) process.stderr.write(`[engine] ${m}\n`)
    },
    ...o
  })
  try {
    await initDataFolder(dataDir, seedIdx >= 0 && argv[seedIdx + 1] ? path.resolve(argv[seedIdx + 1]!) : undefined)
    await engine.start()
  } catch (e) {
    await lock.release()
    throw e
  }
  return engine
}

const fmtProblem = (p: { code: string; path: string; message: string }): string => `  ${p.code}  ${p.path || '(course)'}  ${p.message}`

/**
 * The entry point of the CLI. `argv` is the argument list without `node` and the script (the command first). `io.out` receives each
 * output line (default: stdout); `env` is passed to the build (`EDU_PLAYER_DIR`). Returns the exit code.
 */
export async function runCli(argv: readonly string[], io: CliIo = stdoutIo, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const { words, values, switches } = parseCliArgs(argv)
  const [command, arg] = words
  const out = io.out
  if (!command || command === 'help' || switches.has('help') || switches.has('h')) {
    out(USAGE)
    return 0
  }
  if (!CLI_COMMANDS.has(command)) {
    out(`unknown command "${command}"`)
    out(USAGE)
    return 2
  }
  const dataDir = resolveDataDir({ argv, env })
  const store = new CourseStore(dataDir, { env })
  const need = (what: string): boolean => {
    if (arg) return true
    out(`${command}: give ${what}`)
    return false
  }
  try {
    switch (command) {
      case 'courses': {
        const courses = await store.list()
        if (courses.length === 0) out(`no courses in ${path.join(dataDir, 'courses')}`)
        for (const c of courses) out(`${c.slug}\t${c.updatedAt}`)
        return 0
      }
      case 'import-course': {
        if (!need('the course folder')) return 2
        const r = await store.importCourse(arg!, { slug: values.slug, overwrite: switches.has('overwrite') })
        out(`imported "${r.slug}" into ${r.dir}`)
        if (r.validation.ok) out('validation: ok')
        else {
          out(`validation: ${r.validation.problems.length} problem(s)`)
          for (const p of r.validation.problems.slice(0, 20)) out(fmtProblem(p))
        }
        return r.validation.ok ? 0 : 1
      }
      case 'validate': {
        if (!need('the course slug')) return 2
        const r = await store.validate(arg!)
        if (r.ok) {
          out(`${r.slug}: valid`)
          return 0
        }
        out(`${r.slug}: ${r.problems.length} problem(s)`)
        for (const p of r.problems) out(fmtProblem(p))
        return 1
      }
      case 'build': {
        if (!need('the course slug')) return 2
        const r = await store.build(arg!, { force: switches.has('force') })
        if (!r.ok) {
          out(`${r.slug}: not built, ${r.problems.length} problem(s) (--force builds anyway)`)
          for (const p of r.problems) out(fmtProblem(p))
          return 1
        }
        out(`${r.slug}: built ${r.files.length} file(s) into ${r.outDir}${r.forced ? ` (forced, ${r.problems.length} problem(s) left: yarn engine -- lint ${r.slug})` : ''}`)
        out(`open ${path.join(r.outDir, 'index.html')}`)
        return 0
      }
      case 'lint': {
        if (!need('the course slug')) return 2
        const r = await store.lint(arg!)
        if (switches.has('json')) out(JSON.stringify(r, null, 2))
        else {
          for (const p of r.problems) out(`${p.severity === 'error' ? 'error  ' : 'warning'}  ${p.code}  ${p.path || '(course)'}  ${p.message}`)
          out(`${r.slug}: ${r.errors} error(s), ${r.warnings} warning(s)${r.built ? ' (built first)' : ''}${r.stale ? ' (the build is older than the course files: run build)' : ''}`)
        }
        return r.ok ? 0 : 1
      }
    }
    out(USAGE)
    return 2
  } catch (e) {
    out(`error: ${(e as Error).message}`)
    return 1
  }
}
