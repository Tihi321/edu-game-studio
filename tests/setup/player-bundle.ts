import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

/**
 * Vitest global setup: builds the browser player bundle (out/player/player.js and player.css) once before the test run, so every test
 * that assembles a game folder (engine build, the autoplay bot) finds a fresh bundle. The same build as `yarn build:player`.
 */
export default async function buildPlayerBundle(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  await build({ root, configFile: path.join(root, 'vite.player.config.ts'), logLevel: 'warn' })
}
