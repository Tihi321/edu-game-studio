import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { buildDirOf, courseTitleOf } from '../edu/build'
import type { GameData } from '../../shared/game-data'
import { appIdFor, appIdProblem } from './app-id'
import { GITIGNORE, GRADLE_SCRIPT, KEYSTORE_EXAMPLE, capacitorConfig, packageJson, readme, type ProjectInfo } from './templates'

/**
 * Wraps a built game (`courses/<slug>/build/`) into a Capacitor project folder (`courses/<slug>/android/`), EGS-19. Pure file generation:
 * no network, nothing is installed. Run again, it refreshes `www/`, the config, the scripts and the icons and leaves `android/` (the native
 * project), `node_modules/` and every keystore alone. Edu Studio itself has no Capacitor dependency.
 */

export interface AndroidPrepareResult {
  slug: string
  title: string
  appId: string
  /** The generated project folder. */
  dir: string
  /** The files written, relative to `dir` (www/ files are counted in `wwwFiles`). */
  files: string[]
  wwwFiles: number
  /** Where the icon came from: an asset id of the pack, or `generated`. */
  icon: string
  /** True when the folder already had a native `android/` project (left untouched). */
  hasNativeProject: boolean
}

export const androidDirOf = (courseDir: string): string => path.join(courseDir, 'android')

const exists = (p: string): Promise<boolean> => fs.stat(p).then(() => true, () => false)

/** Reads the build's `game-data.json`; throws a plain message when the course is not built. */
export async function readBuild(buildDir: string): Promise<GameData> {
  const file = path.join(buildDir, 'game-data.json')
  if (!(await exists(path.join(buildDir, 'index.html'))) || !(await exists(file))) throw new Error('the course is not built: run edu_build first')
  return JSON.parse(await fs.readFile(file, 'utf8')) as GameData
}

/** Files that never go into the app: source maps and dot files. */
const skipFromWww = (name: string): boolean => name.endsWith('.map') || name.startsWith('.')

async function copyWww(from: string, to: string): Promise<number> {
  await fs.rm(to, { recursive: true, force: true })
  let n = 0
  const walk = async (src: string, dst: string): Promise<void> => {
    await fs.mkdir(dst, { recursive: true })
    for (const e of await fs.readdir(src, { withFileTypes: true })) {
      if (skipFromWww(e.name)) continue
      if (e.isDirectory()) await walk(path.join(src, e.name), path.join(dst, e.name))
      else if (e.isFile()) {
        await fs.copyFile(path.join(src, e.name), path.join(dst, e.name))
        n++
      }
    }
  }
  await walk(from, to)
  return n
}

const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The generated icon: a rounded tile in the player's colours with the first letter of the title. */
function generatedIconSvg(title: string): string {
  const letter = escapeXml([...title.trim()][0]?.toUpperCase() ?? 'E')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><radialGradient id="g" cx="50%" cy="0%" r="90%"><stop offset="0" stop-color="#2c4a3a"/><stop offset="1" stop-color="#101b16"/></radialGradient></defs>
<rect width="1024" height="1024" fill="url(#g)"/>
<rect x="96" y="96" width="832" height="832" rx="160" fill="none" stroke="#e8e4d0" stroke-width="28"/>
<text x="512" y="512" text-anchor="middle" dominant-baseline="central" font-family="Georgia, serif" font-size="520" font-weight="700" fill="#e8e4d0">${letter}</text>
</svg>`
}

/** resources/icon.png (1024) and resources/splash.png (2732): from the pack's cover picture (an image asset with "cover" in its id or file name) when there is one, else generated. */
async function makeIcons(buildDir: string, outDir: string, data: GameData, title: string): Promise<string> {
  const cover = data.pack.assets.find((a) => a.kind === 'image' && /cover/i.test(a.id + a.file) && data.assets[a.id])
  let source: Buffer | undefined
  let origin = 'generated'
  if (cover) {
    const file = path.join(buildDir, ...data.assets[cover.id]!.split('/'))
    try {
      source = await sharp(file).resize(1024, 1024, { fit: 'cover' }).png().toBuffer()
      origin = cover.id
    } catch {
      source = undefined // an unreadable cover falls back to the generated icon
    }
  }
  source ??= await sharp(Buffer.from(generatedIconSvg(title))).png().toBuffer()
  const dir = path.join(outDir, 'resources')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'icon.png'), source)
  const logo = await sharp(source).resize(1024, 1024).toBuffer()
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: '#101b16' } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(path.join(dir, 'splash.png'))
  return origin
}

export interface PrepareOptions {
  /** Overrides `courses/<slug>/build`. */
  buildDir?: string
  /** The course folder name; default the slug in the game data. */
  slug?: string
  /** An Android application id; default `org.edustudio.<slug>`. */
  appId?: string
}

/** Generates (or refreshes) the Android project of the course in `courseDir`. */
export async function prepareAndroid(courseDir: string, opts: PrepareOptions = {}): Promise<AndroidPrepareResult> {
  const buildDir = opts.buildDir ?? buildDirOf(courseDir)
  const data = await readBuild(buildDir)
  const title = courseTitleOf(data.pack, data.catalogs[data.defaultLang])
  const slug = opts.slug ?? data.slug
  const appId = opts.appId ?? appIdFor(slug)
  const problem = appIdProblem(appId)
  if (problem) throw new Error(`invalid appId "${appId}": ${problem}`)
  const info: ProjectInfo = { slug, title, appId }

  const dir = androidDirOf(courseDir)
  await fs.mkdir(path.join(dir, 'scripts'), { recursive: true })
  const files: string[] = []
  const write = async (rel: string, content: string): Promise<void> => {
    await fs.writeFile(path.join(dir, ...rel.split('/')), content)
    files.push(rel)
  }
  await write('package.json', packageJson(info))
  await write('capacitor.config.json', capacitorConfig(info))
  await write('scripts/gradle.mjs', GRADLE_SCRIPT)
  await write('README.md', readme(info))
  await write('.gitignore', GITIGNORE)
  await write('keystore.properties.example', KEYSTORE_EXAMPLE)
  const icon = await makeIcons(buildDir, dir, data, title)
  files.push('resources/icon.png', 'resources/splash.png')
  const wwwFiles = await copyWww(buildDir, path.join(dir, 'www'))
  return { slug, title, appId, dir, files, wwwFiles, icon, hasNativeProject: await exists(path.join(dir, 'android')) }
}
