import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { expectCleanAxe, expectPassed, PLAYER_OUT, play, type BotSummary } from './bot-helpers'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'

/**
 * The language role-play shell played end to end by the autoplay bot (EGS-13, `scripts/bot/roleplay.mjs`): for every fixture that enables
 * the shell (hr-a1-greetings: four conversations, the garden of 13 words): one perfect run and one keyboard-only perfect run with axe
 * (no mouse click, no serious or critical violation), 0 console errors (EGS-45 trim). Without Chromium the run fails.
 */

useTemp()

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

describe('autoplay bot in the role-play shell', () => {
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

      it.concurrent('perfect: every conversation to 3 stars in order, translations and clips checked, the garden watered, the finale, the end', { timeout: 120_000 }, async () => {
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

      it.concurrent('keyboard only: Tab, Enter and typing play the conversations, no mouse click, axe is clean', { timeout: 120_000 }, async () => {
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

    })
  }
})
