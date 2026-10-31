import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Finds the live quiz client (`live.js` + `live.css`) that `yarn build:live` writes to `out/live/`, the way `findPlayerBundle` finds the
 * player: `EDU_LIVE_DIR` names another folder with both files; otherwise it walks up from `start` to the first `out/live/live.js`.
 */
export interface LiveClientFiles {
  js: string
  css: string
}

export const LIVE_CLIENT_HINT = 'live client not found: run yarn build:live (or set EDU_LIVE_DIR to a folder with live.js and live.css)'

const inFolder = (dir: string): LiveClientFiles | undefined => {
  const js = path.join(dir, 'live.js')
  const css = path.join(dir, 'live.css')
  return existsSync(js) && existsSync(css) ? { js, css } : undefined
}

export function findLiveClient(env: NodeJS.ProcessEnv = process.env, start: string = __dirname): LiveClientFiles {
  if (env.EDU_LIVE_DIR) {
    const dir = path.resolve(env.EDU_LIVE_DIR)
    const found = inFolder(dir)
    if (!found) throw new Error(`${LIVE_CLIENT_HINT}: EDU_LIVE_DIR=${dir} has no live.js and live.css`)
    return found
  }
  let dir = start
  for (let i = 0; i < 8; i++) {
    const found = inFolder(path.join(dir, 'out', 'live'))
    if (found) return found
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(LIVE_CLIENT_HINT)
}
