import { promises as fs } from 'node:fs'
import path from 'node:path'
import { coursePackSchema, textCatalogSchema, type CoursePack, type TextCatalog } from '../../shared/course'
import { DEFAULT_SHELL, GAME_DATA_FORMAT, GAME_DATA_VERSION, renderGameDataJs, renderIndexHtml, type GameData } from '../../shared/game-data'
import { validateCourse } from '../../shared/edu/validate'
import type { Problem } from '../../shared/edu/registry'
import { atomicWrite } from '../store/atomic'
import { assetFileProblems, loadCourseFolder } from './course-io'
import { engineVersion, findPlayerBundle } from './player-bundle'

/**
 * Builds a course into a game folder that works over `file://` (see `src/shared/game-data.ts` for the layout):
 *
 * ```
 * courses/<slug>/course/{pack.json, text/<lang>.json, assets/*}   the source (`courseDir` is `courses/<slug>`)
 * courses/<slug>/build/{index.html, player.js, player.css, game-data.json, game-data.js, assets/*}
 * ```
 *
 * A course with problems is not built (they are returned). `force` builds anyway when the files parse (the broken test fixture does
 * this, so the lint has something to report). Only the course's own `build/` folder is ever cleaned.
 */

export interface BuildOptions {
  /** Build although `validateCourse` or the asset-file check reports problems (the pack and the catalogs must still parse). */
  force?: boolean
  /** Environment for `EDU_PLAYER_DIR` (default: process.env). */
  env?: NodeJS.ProcessEnv
  /** A folder with `player.js` and `player.css`, instead of `findPlayerBundle`. */
  playerDir?: string
  /** The build time (tests pin it). */
  now?: Date
}

export interface BuildResult {
  ok: boolean
  outDir: string
  /** Problems of the course (validation, files). With `force` they are still listed although the build went on. */
  problems: Problem[]
  /** Whether the build ran although there were problems. */
  forced: boolean
  /** Files written, relative to `outDir`. */
  files: string[]
  data?: GameData
}

export const GAME_DATA_FILE = 'game-data.json'

/** `<courseDir>/build`. */
export const buildDirOf = (courseDir: string): string => path.join(courseDir, 'build')

/** The asset URL inside a build: `course/assets/a.svg` -> `assets/a.svg`; a file outside `assets/` is put under it. */
export function assetUrl(file: string): string {
  const rel = file.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^assets\//, '')
  return `assets/${rel}`
}

const exists = (p: string): Promise<boolean> => fs.stat(p).then(() => true, () => false)

async function isBuildFolder(dir: string): Promise<boolean> {
  try {
    const d = JSON.parse(await fs.readFile(path.join(dir, GAME_DATA_FILE), 'utf8')) as { format?: unknown }
    return d.format === GAME_DATA_FORMAT
  } catch {
    return false
  }
}

/** Empties `outDir` (or creates it). It only does so for `<courseDir>/build`, an earlier build, or an empty folder. */
async function prepareOutDir(courseDir: string, outDir: string): Promise<void> {
  const isOwn = path.resolve(outDir) === path.resolve(buildDirOf(courseDir))
  if (await exists(outDir)) {
    const entries = await fs.readdir(outDir)
    if (!isOwn && entries.length > 0 && !(await isBuildFolder(outDir))) throw new Error(`refusing to clean "${outDir}": it is not the build/ folder of the course and not a previous build`)
    await fs.rm(outDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  }
  await fs.mkdir(outDir, { recursive: true })
}

/** The edition the player opens in: the source language when it is an edition, else the first. */
export const defaultLangOf = (pack: Pick<CoursePack, 'sourceLang' | 'languages'>): string => (pack.languages.includes(pack.sourceLang) ? pack.sourceLang : (pack.languages[0] ?? pack.sourceLang))

/** The title of a course in one edition: the catalog string `course.title`, else the subject. */
export const courseTitleOf = (pack: Pick<CoursePack, 'subject'>, catalog: TextCatalog | undefined): string => catalog?.strings['course.title'] || pack.subject

/**
 * Builds `courseDir/course/` into `outDir` (default `<courseDir>/build`). `slug` of the game data is the pack's slug.
 * Nothing is written (and nothing cleaned) when the course has problems and `force` is not set.
 */
export async function buildCourse(courseDir: string, outDir: string = buildDirOf(courseDir), opts: BuildOptions = {}): Promise<BuildResult> {
  const force = opts.force === true
  const loaded = await loadCourseFolder(courseDir)
  const res = validateCourse(loaded.pack, loaded.catalogs)
  const problems: Problem[] = [...loaded.problems, ...res.problems, ...(await assetFileProblems(courseDir, loaded.pack))]
  const fail = (): BuildResult => ({ ok: false, outDir, problems, forced: false, files: [] })
  if (problems.length > 0 && !force) return fail()

  // forced: the pack and the catalogs must at least parse
  let pack = res.pack
  let catalogs = res.catalogs
  if (!pack || !catalogs) {
    const p = coursePackSchema.safeParse(loaded.pack)
    if (!p.success) return fail()
    pack = p.data
    catalogs = {}
    for (const raw of Object.values(loaded.catalogs)) {
      const c = textCatalogSchema.safeParse(raw)
      if (!c.success) return fail()
      catalogs[c.data.lang] = c.data
    }
  }
  const needed = new Set([...pack.languages, ...(pack.targetLang ? [pack.targetLang] : [])])
  catalogs = Object.fromEntries(Object.entries(catalogs).filter(([lang]) => needed.has(lang)))

  // before anything is cleaned: no bundle, no build
  const bundleFiles = findPlayerBundle(opts.playerDir ? { ...(opts.env ?? process.env), EDU_PLAYER_DIR: opts.playerDir } : opts.env)

  const defaultLang = defaultLangOf(pack)
  const assets: Record<string, string> = {}
  const copies: { from: string; to: string }[] = []
  for (const a of pack.assets) {
    const url = assetUrl(a.file)
    assets[a.id] = url
    const from = path.join(courseDir, 'course', ...a.file.split('/'))
    if (path.relative(path.join(courseDir, 'course'), from).startsWith('..')) continue // reported as MISSING_ASSET_FILE
    if (await exists(from)) copies.push({ from, to: path.join(outDir, ...url.split('/')) })
  }

  const data: GameData = {
    format: GAME_DATA_FORMAT,
    version: GAME_DATA_VERSION,
    slug: pack.slug,
    builtAt: (opts.now ?? new Date()).toISOString(),
    engine: engineVersion(),
    pack,
    catalogs,
    defaultLang,
    assets,
    shell: pack.shells.enabled[0] ?? DEFAULT_SHELL
  }

  await prepareOutDir(courseDir, outDir)
  const files: string[] = []
  const write = async (name: string, content: string): Promise<void> => {
    await atomicWrite(path.join(outDir, name), content)
    files.push(name)
  }
  await write('index.html', renderIndexHtml({ title: courseTitleOf(pack, catalogs[defaultLang]), lang: defaultLang }))
  for (const [name, from] of [['player.js', bundleFiles.js], ['player.css', bundleFiles.css]] as const) {
    await fs.copyFile(from, path.join(outDir, name))
    files.push(name)
  }
  await write(GAME_DATA_FILE, JSON.stringify(data, null, 2) + '\n')
  await write('game-data.js', renderGameDataJs(data))
  for (const c of copies) {
    await fs.mkdir(path.dirname(c.to), { recursive: true })
    await fs.copyFile(c.from, c.to)
    files.push(path.relative(outDir, c.to).split(path.sep).join('/'))
  }
  return { ok: true, outDir, problems, forced: problems.length > 0, files, data }
}
