import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { copyFixture, tmp } from './edu-build-helpers'

/**
 * Shared by the bot end-to-end tests of the game shells (`tests/bot-<shell>.e2e.test.ts`, EGS-10+): building a
 * fixture with the REAL player bundle (`out/player`, built by the vitest global setup) and running `scripts/play.mjs`. Call `useTemp()`
 * (edu-build-helpers) at the top of the test file.
 */

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const PLAY = path.join(ROOT, 'scripts', 'play.mjs')
/** The real player bundle the vitest global setup built: `out/player`, or `EDU_TEST_PLAYER_OUT` (see tests/setup/player-bundle.ts). */
export const PLAYER_OUT = process.env.EDU_TEST_PLAYER_OUT ? path.resolve(ROOT, process.env.EDU_TEST_PLAYER_OUT) : path.join(ROOT, 'out', 'player')

/**
 * Throws when Chromium cannot be launched, so an e2e run on a machine without a browser FAILS (never skips). The e2e config calls it in a
 * `beforeAll` of every test file (tests/setup/e2e-chromium.ts).
 */
export async function requireChromium(): Promise<void> {
  try {
    const { chromium } = await import('playwright')
    const b = await chromium.launch()
    await b.close()
  } catch (e) {
    const why = e instanceof Error ? (e.message.split('\n')[0] ?? 'unknown error') : String(e)
    throw new Error(`Chromium cannot be launched (${why}). Run "yarn playwright install chromium".`, { cause: e })
  }
}

export interface BotSummary {
  mode: string
  shell: string
  seed: number
  steps: number
  correct: number
  wrong: number
  screens: string[]
  kinds: Record<string, number>
  finished: boolean
  consoleErrors: number
  maxSteps: number
  checks: { whys: number; explanations: number; answers: number }
  keyboard?: { presses: number; focusChecks: number; ringChecks: number; tabbableMax: number; mouseClicks: number }
  axe?: { runs: number; violations: { critical: number; serious: number; moderate: number; minor: number }; rules: Record<string, number>; screens: string[] }
  /** Whatever a shell's driver adds (rooms visited, battles won, clues found ...). */
  [extra: string]: unknown
  ok: boolean
  failures: string[]
}

export function play(dir: string, args: string[]): Promise<{ code: number; summary: BotSummary; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [PLAY, dir, '--json', ...args], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024, timeout: 280_000 }, (err, stdout, stderr) => {
      const code = err ? ((err as { code?: number }).code ?? 1) : 0
      try {
        resolve({ code: typeof code === 'number' ? code : 1, summary: JSON.parse(stdout) as BotSummary, stderr })
      } catch {
        reject(new Error(`the bot printed no JSON (exit ${String(code)}): ${stdout.slice(0, 500)} ${stderr.slice(0, 500)}`))
      }
    })
  })
}

/** Builds a fixture (by folder name under tests/fixtures/courses) into a temp game folder, once per call site (memoise the promise). */
export async function buildFixtureGame(name: string): Promise<string> {
  const { root } = await copyFixture(name)
  const out = await tmp('edu-bot-')
  const res = await buildCourse(root, out, { playerDir: PLAYER_OUT })
  expect(res.problems).toEqual([])
  expect(res.ok).toBe(true)
  return out
}

/** A run that passed: no failure, exit 0, no console error. */
export function expectPassed(r: { code: number; summary: BotSummary; stderr: string }): void {
  expect(r.summary.failures, r.stderr).toEqual([])
  expect(r.code).toBe(0)
  expect(r.summary.consoleErrors).toBe(0)
}

/** axe ran on the screens that matter and found nothing serious or critical. */
export function expectCleanAxe(summary: BotSummary, minRuns = 4): void {
  expect(summary.axe, 'the bot ran no axe check').toBeDefined()
  const axe = summary.axe as NonNullable<BotSummary['axe']>
  expect(axe.runs).toBeGreaterThanOrEqual(minRuns)
  expect(axe.violations.critical).toBe(0)
  expect(axe.violations.serious).toBe(0)
  expect(axe.screens).toContain('title')
  expect(axe.screens.some((s) => s.startsWith('item-'))).toBe(true)
}
