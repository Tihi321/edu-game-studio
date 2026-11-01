import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

/** The newest modification time (ms) of a file or of anything under a folder; 0 when it does not exist. */
function newest(p: string): number {
  if (!existsSync(p)) return 0
  const st = statSync(p)
  if (!st.isDirectory()) return st.mtimeMs
  return readdirSync(p).reduce((m, name) => Math.max(m, newest(path.join(p, name))), st.mtimeMs)
}

/** Measured in EGS-40: without this setup 72 tests in 12 files fail (they need out/player and out/live); the build itself takes 2-3 s. It is skipped when both bundles are newer than everything they are built from. */
function bundlesAreFresh(root: string, playerOut: string): boolean {
  const outputs = [path.join(playerOut, 'player.js'), path.join(playerOut, 'player.css'), path.join(root, 'out', 'live', 'live.js')]
  if (!outputs.every((f) => existsSync(f))) return false
  const built = Math.min(...outputs.map((f) => statSync(f).mtimeMs))
  const inputs = ['src/player', 'src/live-client', 'src/shared', 'src/design', 'themes', 'vite.player.config.ts', 'vite.live.config.ts', 'package.json', 'yarn.lock']
  return inputs.every((i) => newest(path.join(root, i)) < built)
}

/**
 * Vitest global setup: builds the browser player bundle (out/player/player.js and player.css) once before the test run, so every test
 * that assembles a game folder (engine build, the autoplay bot) finds a fresh bundle. The same build as `yarn build:player`.
 * `EDU_TEST_PLAYER_OUT` (a folder, relative to the repo root) builds it there instead, so two test runs in one checkout do not
 * overwrite each other's bundle; `tests/bot-helpers.ts` (`PLAYER_OUT`) reads the same variable. It also builds the live quiz client
 * (`out/live`, the same build as `yarn build:live`) for the live quiz tests.
 * It is skipped when the bundles are already newer than their sources (EGS-40).
 */
export default async function buildPlayerBundle(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const out = process.env.EDU_TEST_PLAYER_OUT
  if (bundlesAreFresh(root, out ? path.resolve(root, out) : path.join(root, 'out', 'player'))) return
  await build({
    root,
    configFile: path.join(root, 'vite.player.config.ts'),
    logLevel: 'warn',
    ...(out ? { build: { outDir: path.resolve(root, out) } } : {})
  })
  await build({ root, configFile: path.join(root, 'vite.live.config.ts'), logLevel: 'warn' })
}
