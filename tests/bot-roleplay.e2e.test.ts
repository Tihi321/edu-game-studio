import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { chromiumUnavailable, expectCleanAxe, expectPassed, PLAYER_OUT, play, type BotSummary } from './bot-helpers'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'

/**
 * The language role-play shell played end to end by the autoplay bot (EGS-13, `scripts/bot/roleplay.mjs`): for every fixture that enables
 * the shell (hr-a1-greetings: four conversations, the garden of 13 words), perfect, wrong and random (seeded) pass with 0 console errors, one
 * keyboard-only perfect run (no mouse click) and an axe run (no serious or critical violation). Skipped, with a message, only when Chromium
 * cannot be launched (`yarn playwright install chromium`).
 */

useTemp()

const unavailable = await chromiumUnavailable()
if (unavailable) console.warn(`[bot-roleplay.e2e] SKIPPED: Chromium cannot be launched (${unavailable}). Run "yarn playwright install chromium".`)

interface Case {
  fixture: 'hr-a1-greetings'
  /** Scenes with a unit (not the finale) and the words of the garden. */
  scenes: number
  words: number
  /** Replies of the first scene: every one is missed twice (a recovery line each time) before the right reply is shown. */
  firstTurns: number
}
const CASES: Case[] = [{ fixture: 'hr-a1-greetings', scenes: 3, words: 13, firstTurns: 4 }]

interface Stats {
  scenesPlayed: number
  lines: number
  translations: number
  clips: number
  recovery: number
  gardenRuns: number
  plantsGrown: number
}
const stats = (s: BotSummary): Stats => s.roleplay as Stats

describe.skipIf(!!unavailable)('autoplay bot in the role-play shell', () => {
  for (const c of CASES) {
    describe(c.fixture, () => {
      let dirP: Promise<string> | undefined
      const built = (): Promise<string> =>
        (dirP ??= (async () => {
          const { root } = await copyFixture(c.fixture)
          const out = await tmp('edu-bot-rp-')
          const res = await buildCourse(root, out, { playerDir: PLAYER_OUT })
          expect(res.problems).toEqual([])
          expect(res.ok).toBe(true)
          return out
        })())
      const run = async (...args: string[]) => play(await built(), [...args, '--shell', 'roleplay'])

      it.concurrent('perfect: every conversation to 3 stars in order, translations and clips checked, the garden watered, the finale, the end', { timeout: 300_000 }, async () => {
        const r = await run('--mode', 'perfect', '--seed', '1')
        expectPassed(r)
        const s = r.summary
        expect(s.shell).toBe('roleplay')
        expect(s.finished).toBe(true)
        expect(s.wrong).toBe(0)
        expect(s.correct).toBe(s.steps)
        expect(s.steps).toBeLessThanOrEqual(s.maxSteps)
        expect(s.screens).toEqual(expect.arrayContaining(['title', 'scenes', 'scene', 'item', 'feedback', 'scene-done', 'garden', 'end']))
        const rp = stats(s)
        expect(rp.scenesPlayed).toBe(c.scenes + 1) // the finale too
        expect(rp.translations).toBe(c.scenes + 1) // one per scene
        expect(rp.clips).toBeGreaterThanOrEqual(1)
        expect(rp.recovery).toBe(0)
        expect(rp.gardenRuns).toBeGreaterThanOrEqual(1)
        expect(rp.plantsGrown).toBe(c.words)
      })

      it.concurrent('keyboard only: Tab, Enter and typing play the conversations, no mouse click, axe is clean', { timeout: 300_000 }, async () => {
        const r = await run('--mode', 'perfect', '--seed', '1', '--keyboard', '--axe')
        expectPassed(r)
        const s = r.summary
        expect(s.finished).toBe(true)
        expect(s.wrong).toBe(0)
        expect(s.keyboard?.mouseClicks).toBe(0)
        expect(s.keyboard?.presses).toBeGreaterThan(60)
        expect(s.keyboard?.focusChecks).toBeGreaterThan(30)
        expect(s.keyboard?.ringChecks).toBeGreaterThan(30)
        expectCleanAxe(s, 8)
        expect(s.axe?.screens).toEqual(expect.arrayContaining(['scenes', 'scene-start', 'scene-translated', 'scene-question', 'scene-done', 'garden', 'end']))
      })

      it.concurrent('axe: no serious or critical violation on the scenes, a recovery line, the locked scenes, the wilted garden and a wrong answer', { timeout: 300_000 }, async () => {
        const wrong = await run('--mode', 'wrong', '--seed', '5', '--axe')
        expectPassed(wrong)
        expectCleanAxe(wrong.summary, 8)
        expect(wrong.summary.axe?.screens).toEqual(expect.arrayContaining(['scenes', 'scene-help', 'scene-done', 'scenes-locked', 'garden-wilted']))
        expect(wrong.summary.axe?.screens.some((x) => x.startsWith('feedback-wrong-'))).toBe(true)
      })

      it.concurrent('wrong: the speaker helps after every miss, the right reply is shown after the third, the scene still ends with 0 stars; the rest stays locked, the plants wilt', { timeout: 300_000 }, async () => {
        const r = await run('--mode', 'wrong', '--seed', '2', '--rounds', '1')
        expectPassed(r)
        const s = r.summary
        expect(s.finished).toBe(false)
        expect(s.correct).toBe(0)
        expect(s.wrong).toBe(s.steps)
        expect(s.screens).toEqual(expect.arrayContaining(['scenes', 'scene', 'item', 'feedback', 'scene-done', 'garden']))
        expect(s.screens).not.toContain('end')
        const rp = stats(s)
        expect(rp.scenesPlayed).toBe(1) // only the first unit's scene is open
        expect(rp.recovery).toBe(c.firstTurns * 2) // misses 1 and 2 of every turn come back to the scene screen with a recovery line
        expect(s.steps).toBeGreaterThanOrEqual(c.firstTurns * 3)
        expect(rp.gardenRuns).toBe(1)
        expect(s.checks.answers).toBe(s.wrong)
        expect(s.checks.explanations).toBe(s.wrong)
      })

      it.concurrent('random: a seeded 75 % learner replays every scene to mastery, waters the garden and beats the finale within the step bound', { timeout: 300_000 }, async () => {
        const r = await run('--mode', 'random', '--seed', '7', '--accuracy', '0.75')
        expectPassed(r)
        const s = r.summary
        expect(s.finished).toBe(true)
        expect(s.steps).toBeLessThanOrEqual(s.maxSteps)
        expect(s.wrong).toBeGreaterThan(0)
        expect(s.correct).toBeGreaterThan(s.wrong)
        expect(stats(s).scenesPlayed).toBeGreaterThanOrEqual(c.scenes + 1)
        expect(stats(s).recovery).toBeGreaterThan(0)
      })
    })
  }
})
