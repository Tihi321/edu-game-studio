import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Finds the browser player bundle (`player.js` + `player.css`) that `yarn build:player` writes to `out/player/`. `EDU_PLAYER_DIR` names
 * another folder that holds both files (tests point it at a fake bundle). Otherwise it walks up from `start` (this code: the repo root for
 * `yarn engine`, tests and the Electron build) to the first `out/player/player.js`, never the working directory.
 */
export interface PlayerBundle {
  js: string
  css: string
}

export const PLAYER_BUNDLE_HINT = 'player bundle not found: run yarn build:player (or set EDU_PLAYER_DIR to a folder with player.js and player.css)'

const inFolder = (dir: string): PlayerBundle | undefined => {
  const js = path.join(dir, 'player.js')
  const css = path.join(dir, 'player.css')
  return existsSync(js) && existsSync(css) ? { js, css } : undefined
}

/** The player bundle's files. Throws a clear error when there is none. */
export function findPlayerBundle(env: NodeJS.ProcessEnv = process.env, start: string = __dirname): PlayerBundle {
  if (env.EDU_PLAYER_DIR) {
    const dir = path.resolve(env.EDU_PLAYER_DIR)
    const found = inFolder(dir)
    if (!found) throw new Error(`${PLAYER_BUNDLE_HINT}: EDU_PLAYER_DIR=${dir} has no player.js and player.css`)
    return found
  }
  let dir = start
  for (let i = 0; i < 8; i++) {
    const found = inFolder(path.join(dir, 'out', 'player'))
    if (found) return found
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(PLAYER_BUNDLE_HINT)
}

/** The Edu Studio version (the `package.json` above `start`), for `GameData.engine`. */
export function engineVersion(start: string = __dirname): string {
  let dir = start
  for (let i = 0; i < 8; i++) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: string; version?: string }
      if (pkg.name === 'edu-game-studio' && pkg.version) return pkg.version
    } catch {
      // no package.json here
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return '0.0.0'
}
