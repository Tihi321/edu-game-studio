import path from 'node:path'
import type { EngineEvent } from '../shared/protocol'
import { Engine } from './engine'
import type { EngineOptions } from './engine'
import { initDataFolder, resolveDataDir } from './store/dataFolder'
import { acquireEngineLock, EngineLockHeldError } from './store/lock'

/**
 * The CLI for courses: `yarn engine -- <command> ...`. It starts the same engine as the app headless, runs one command and stops it.
 * Only `help` and `courses` exist so far; EGS-03 adds `build` and `lint`, EGS-08 the pipeline commands.
 */

export const USAGE = `Edu Studio command line

Usage:
  yarn engine -- courses [--data <dir>]    list the courses in the data folder (courses/<slug>/)
  yarn engine -- help

  --data <dir>   Data folder. Default: EDU_DATA, else ~/EduGames
  --seed <dir>   Seed folder to copy from. Default: the repo's seed/ (or EDU_SEED)
  --verbose      Print the engine log to stderr
`

export const CLI_COMMANDS = new Set(['courses', 'help'])

const out = (s: string) => process.stdout.write(s + '\n')

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

/** The entry point of the CLI: starts a headless engine, runs the command, stops the engine. */
export async function runCli(argv: readonly string[]): Promise<number> {
  const command = argv.find((a) => !a.startsWith('-'))
  if (!command || command === 'help' || argv.includes('--help') || argv.includes('-h')) {
    out(USAGE)
    return 0
  }
  let engine: Engine
  try {
    engine = await startHeadless(argv)
  } catch (e) {
    if (!(e instanceof EngineLockHeldError)) throw e
    out(e.message)
    return 1
  }
  try {
    if (command === 'courses') {
      const courses = await engine.edu.listCourses()
      if (courses.length === 0) out(`no courses in ${path.join(engine.dataDir, 'courses')}`)
      for (const c of courses) out(`${c.slug}\t${c.updatedAt}`)
      return 0
    }
    out(USAGE)
    return 2
  } catch (e) {
    out(`error: ${(e as Error).message}`)
    return 1
  } finally {
    await engine.stop()
  }
}
