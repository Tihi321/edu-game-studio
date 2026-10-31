import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

/**
 * Vitest global setup: builds the browser player bundle (out/player/player.js and player.css) once before the test run, so every test
 * that assembles a game folder (engine build, the autoplay bot) finds a fresh bundle. The same build as `yarn build:player`.
 * `EDU_TEST_PLAYER_OUT` (a folder, relative to the repo root) builds it there instead, so two test runs in one checkout do not
 * overwrite each other's bundle; `tests/bot-helpers.ts` (`PLAYER_OUT`) reads the same variable. It also builds the live quiz client
 * (`out/live`, the same build as `yarn build:live`) for the live quiz tests.
 */
export default async function buildPlayerBundle(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const out = process.env.EDU_TEST_PLAYER_OUT
  await build({
    root,
    configFile: path.join(root, 'vite.player.config.ts'),
    logLevel: 'warn',
    ...(out ? { build: { outDir: path.resolve(root, out) } } : {})
  })
  await build({ root, configFile: path.join(root, 'vite.live.config.ts'), logLevel: 'warn' })
}
