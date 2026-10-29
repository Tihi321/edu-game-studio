import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'

/**
 * The autoplay bot end to end: both golden fixtures are built into a game folder with the REAL player bundle (`out/player`, built by the
 * vitest global setup) and `scripts/play.mjs` plays each one in headless Chromium in all three modes, with the keyboard only (`--keyboard`,
 * no mouse click at all) and with axe-core on every distinct screen and item kind (`--axe`: no serious or critical violation). Skipped, with a message, only when
 * Chromium cannot be launched (`yarn playwright install chromium`).
 */

useTemp()

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLAY = path.join(ROOT, 'scripts', 'play.mjs')

async function chromiumAvailable(): Promise<string | null> {
  try {
    const { chromium } = await import('playwright')
    const b = await chromium.launch()
    await b.close()
    return null
  } catch (e) {
    return e instanceof Error ? (e.message.split('\n')[0] ?? 'unknown error') : String(e)
  }
}

const unavailable = await chromiumAvailable()
if (unavailable) console.warn(`[bot.e2e] SKIPPED: Chromium cannot be launched (${unavailable}). Run "yarn playwright install chromium".`)

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

describe.skipIf(!!unavailable)('autoplay bot on the golden fixtures', () => {
  for (const name of FIXTURES) {
    describe(name, () => {
      let dirP: Promise<string> | undefined
      const built = (): Promise<string> =>
        (dirP ??= (async () => {
          const { root } = await copyFixture(name)
          const out = await tmp('edu-bot-')
          const res = await buildCourse(root, out, { playerDir: path.join(ROOT, 'out', 'player') })
          expect(res.problems).toEqual([])
          expect(res.ok).toBe(true)
          return out
        })())

      it.concurrent('perfect: right every time, every unit mastered, the end screen, an empty review queue', { timeout: 300_000 }, async () => {
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

      it.concurrent('keyboard only: Tab, Enter, Space, arrows, digits and typing finish the game, no mouse click, axe is clean', { timeout: 300_000 }, async () => {
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

      it.concurrent('axe: no serious or critical violation on any screen, item kind or feedback of a wrong answer', { timeout: 300_000 }, async () => {
        const right = await play(await built(), ['--mode', 'perfect', '--seed', '4', '--axe'])
        expect(right.summary.failures, right.stderr).toEqual([])
        expectCleanAxe(right.summary)
        const wrong = await play(await built(), ['--mode', 'wrong', '--seed', '5', '--axe'])
        expect(wrong.summary.failures, wrong.stderr).toEqual([])
        expectCleanAxe(wrong.summary)
        expect(wrong.summary.axe?.screens.some((s) => s.startsWith('feedback-wrong-'))).toBe(true)
        expect(wrong.summary.axe?.screens).toContain('review')
      })

      it.concurrent('wrong: every feedback panel explains, the review queue fills and is offered', { timeout: 300_000 }, async () => {
        const { code, summary, stderr } = await play(await built(), ['--mode', 'wrong', '--seed', '2', '--rounds', '2'])
        expect(summary.failures, stderr).toEqual([])
        expect(code).toBe(0)
        expect(summary.consoleErrors).toBe(0)
        expect(summary.finished).toBe(false)
        expect(summary.correct).toBe(0)
        expect(summary.wrong).toBe(summary.steps)
        expect(summary.screens).toEqual(expect.arrayContaining(['feedback', 'summary', 'review']))
        // every wrong answer showed the right answer and the explanation; the distractor explanations were found where the pack has them
        expect(summary.checks.answers).toBe(summary.wrong)
        expect(summary.checks.explanations).toBe(summary.wrong)
        expect(summary.checks.whys).toBeGreaterThan(0)
      })

      it.concurrent('random: a seeded 75 % learner reaches the end within the step bound', { timeout: 300_000 }, async () => {
        const { code, summary, stderr } = await play(await built(), ['--mode', 'random', '--seed', '3', '--accuracy', '0.75'])
        expect(summary.failures, stderr).toEqual([])
        expect(code).toBe(0)
        expect(summary.consoleErrors).toBe(0)
        expect(summary.finished).toBe(true)
        expect(summary.steps).toBeLessThanOrEqual(summary.maxSteps)
        expect(summary.wrong).toBeGreaterThan(0)
        expect(summary.correct).toBeGreaterThan(summary.wrong)
      })
    })
  }

  it('exits non-zero with the reason for a folder that is not a build', async () => {
    const dir = await tmp('edu-bot-empty-')
    await expect(play(dir, ['--mode', 'perfect'])).rejects.toThrow(/no JSON/)
  })
})
