import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'

/**
 * The autoplay bot end to end: both golden fixtures are built into a game folder with the REAL player bundle (`out/player`, built by the
 * vitest global setup) and `scripts/play.mjs` plays them in headless Chromium: a perfect run per fixture and, on the first, a run with the keyboard only (`--keyboard`,
 * no mouse click at all) and with axe-core on every distinct screen and item kind (`--axe`: no serious or critical violation). Without Chromium the run fails (`yarn playwright install chromium`).
 */

useTemp()

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLAY = path.join(ROOT, 'scripts', 'play.mjs')
const PLAYER_OUT = process.env.EDU_TEST_PLAYER_OUT ? path.resolve(ROOT, process.env.EDU_TEST_PLAYER_OUT) : path.join(ROOT, 'out', 'player')

interface BotSummary {
  mode: string
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
  ok: boolean
  failures: string[]
}

function play(dir: string, args: string[]): Promise<{ code: number; summary: BotSummary; stderr: string }> {
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

const FIXTURES = ['solar-system', 'hr-a1-greetings']

/** axe ran on the screens that matter and found nothing serious or critical (the counts are in the bot's JSON summary). */
function expectCleanAxe(summary: BotSummary): void {
  expect(summary.axe, 'the bot ran no axe check').toBeDefined()
  const axe = summary.axe as NonNullable<BotSummary['axe']>
  expect(axe.runs).toBeGreaterThanOrEqual(8)
  expect(axe.violations.critical).toBe(0)
  expect(axe.violations.serious).toBe(0)
  expect(axe.screens).toEqual(expect.arrayContaining(['title', 'map']))
  expect(axe.screens.some((s) => s.startsWith('item-'))).toBe(true)
  expect(axe.screens.some((s) => s.startsWith('feedback-'))).toBe(true)
}

describe('autoplay bot on the golden fixtures', () => {
  for (const name of FIXTURES) {
    describe(name, () => {
      let dirP: Promise<string> | undefined
      const built = (): Promise<string> =>
        (dirP ??= (async () => {
          const { root } = await copyFixture(name)
          const out = await tmp('edu-bot-')
          const res = await buildCourse(root, out, { playerDir: PLAYER_OUT })
          expect(res.problems).toEqual([])
          expect(res.ok).toBe(true)
          return out
        })())

      it.concurrent('perfect: right every time, every unit mastered, the end screen, an empty review queue', { timeout: 120_000 }, async () => {
        const { code, summary, stderr } = await play(await built(), ['--mode', 'perfect', '--seed', '1'])
        expect(summary.failures, stderr).toEqual([])
        expect(code).toBe(0)
        expect(summary.consoleErrors).toBe(0)
        expect(summary.finished).toBe(true)
        expect(summary.wrong).toBe(0)
        expect(summary.correct).toBe(summary.steps)
        expect(summary.steps).toBeLessThanOrEqual(summary.maxSteps)
        expect(summary.screens).toEqual(expect.arrayContaining(['title', 'map', 'item', 'feedback', 'summary', 'end']))
      })

      if (name === 'solar-system')
        it.concurrent('keyboard only: Tab, Enter, Space, arrows, digits and typing finish the game, no mouse click, axe is clean', { timeout: 120_000 }, async () => {
        const { code, summary, stderr } = await play(await built(), ['--mode', 'perfect', '--seed', '1', '--keyboard', '--axe'])
        expect(summary.failures, stderr).toEqual([])
        expect(code).toBe(0)
        expect(summary.consoleErrors).toBe(0)
        expect(summary.finished).toBe(true)
        expect(summary.wrong).toBe(0)
        expect(summary.keyboard?.mouseClicks).toBe(0)
        // the focus was checked after every screen change and a focus ring on every control reached with Tab
        expect(summary.keyboard?.presses).toBeGreaterThan(100)
        expect(summary.keyboard?.focusChecks).toBeGreaterThan(30)
        expect(summary.keyboard?.ringChecks).toBeGreaterThan(50)
        expectCleanAxe(summary)
      })
    })
  }

  it('exits non-zero with the reason for a folder that is not a build', async () => {
    const dir = await tmp('edu-bot-empty-')
    await expect(play(dir, ['--mode', 'perfect'])).rejects.toThrow(/no JSON/)
  })
})
