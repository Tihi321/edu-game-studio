import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll } from 'vitest'
import { FIXTURES } from './edu-fixtures'

/** Temp folders made by `tmp()`, removed after the test file. Call `useTemp()` once at the top of a test file. */
const made: string[] = []

export async function tmp(prefix = 'edu-build-'): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  made.push(dir)
  return dir
}

export function useTemp(): void {
  afterAll(async () => {
    for (const d of made.splice(0)) await rm(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  })
}

/** A fake player bundle (the tests never depend on the real `out/player/`): a folder with `player.js` and `player.css`. */
export async function fakeBundle(): Promise<string> {
  const dir = await tmp('edu-bundle-')
  await writeFile(path.join(dir, 'player.js'), '/* fake player */\nwindow.__FAKE_PLAYER__ = true;\n')
  await writeFile(path.join(dir, 'player.css'), '/* fake player css */\nbody{margin:0}\n')
  return dir
}

export const BUNDLE_FILES = { js: '/* fake player */\nwindow.__FAKE_PLAYER__ = true;\n', css: '/* fake player css */\nbody{margin:0}\n' }

/** Copies a fixture (`solar-system`, `hr-a1-greetings`, `broken`) into `<temp>/courses/<slug>` and returns the data folder and the course root. */
export async function copyFixture(name: string, slug: string = name): Promise<{ dataDir: string; root: string }> {
  const dataDir = await tmp('edu-data-')
  const root = path.join(dataDir, 'courses', slug)
  await mkdir(root, { recursive: true })
  await cp(path.join(FIXTURES, name), root, { recursive: true })
  return { dataDir, root }
}

/** Evaluates the text of a `game-data.js` and returns what it assigns to `window.EDU_GAME_DATA`. */
export function evalGameDataJs(code: string): unknown {
  const window: Record<string, unknown> = {}
  new Function('window', code)(window)
  return window.EDU_GAME_DATA
}
