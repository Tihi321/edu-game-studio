import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { expectCleanAxe, expectPassed, PLAYER_OUT, play, type BotSummary } from './bot-helpers'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'

/**
 * The language role-play shell played end to end by the autoplay bot (EGS-13, `scripts/bot/roleplay.mjs`): for every fixture that enables
 * the shell (hr-a1-greetings: four conversations, the garden of 13 words; de-roleplay-a1, EGS-57: the shape the scene generator writes, German
 * text in the target catalog, umlauts to type): one perfect run and one keyboard-only perfect run with axe (no mouse click, no serious or
 * critical violation), 0 console errors (EGS-45 trim). The German fixture also gets a wrong run (the help lines, the third miss shows the
 * reply, the scene still ends) and a random run, because it is the one that stands for generated courses. Without Chromium the run fails.
 */

useTemp()

interface Case {
  fixture: 'hr-a1-greetings' | 'de-roleplay-a1'
  /** Scenes with a unit (not the finale) and the words of the garden. */
  scenes: number
  words: number
  /** Replies of the first scene: every one is missed twice (a recovery line each time) before the right reply is shown. */
  firstTurns: number
  /** Lower bounds of the keyboard run (key presses, focus checks, ring checks) and whether the fixture has audio clips (it plays them). */
  keys: [number, number, number]
  clips: boolean
  /** Some garden word is not asked in a scene, so a watering run is due (a generated garden uses scene replies only: every plant has grown by the end of the scenes). */
  watering: boolean
  /** Also a wrong run and a random run (the generated shape). */
  allModes?: boolean
}
const CASES: Case[] = [
  { fixture: 'hr-a1-greetings', scenes: 3, words: 13, firstTurns: 4, keys: [60, 30, 30], clips: true, watering: true },
  { fixture: 'de-roleplay-a1', scenes: 2, words: 12, firstTurns: 4, keys: [15, 10, 10], clips: false, watering: false, allModes: true }
]

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

      it.concurrent('perfect: every conversation to 3 stars in order, translations and clips checked, the garden watered, the finale, the end', { timeout: 240_000 }, async () => {
        const r = await run('--mode', 'perfect', '--seed', '1', '--viewport', '375x667')
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
        expect(rp.clips).toBeGreaterThanOrEqual(c.clips ? 1 : 0)
        expect(rp.recovery).toBe(0)
        expect(rp.gardenRuns).toBeGreaterThanOrEqual(c.watering ? 1 : 0)
        expect(rp.plantsGrown).toBe(c.words)
      })

      it.concurrent('keyboard only: Tab, Enter and typing play the conversations, no mouse click, axe is clean', { timeout: 240_000 }, async () => {
        const r = await run('--mode', 'perfect', '--seed', '1', '--keyboard', '--axe')
        expectPassed(r)
        const s = r.summary
        expect(s.finished).toBe(true)
        expect(s.wrong).toBe(0)
        expect(s.keyboard?.mouseClicks).toBe(0)
        expect(s.keyboard?.presses).toBeGreaterThan(c.keys[0])
        expect(s.keyboard?.focusChecks).toBeGreaterThan(c.keys[1])
        expect(s.keyboard?.ringChecks).toBeGreaterThan(c.keys[2])
        expectCleanAxe(s, 8)
        expect(s.axe?.screens).toEqual(expect.arrayContaining(['scenes', 'scene-start', 'scene-translated', 'scene-question', 'scene-done', 'garden', 'end']))
      })

      if (c.allModes) {
        it.concurrent('wrong: every reply missed three times shows the help line each time, then the right reply, and the scene still ends', { timeout: 240_000 }, async () => {
          const r = await run('--mode', 'wrong', '--seed', '1')
          expectPassed(r)
          const s = r.summary
          expect(s.correct).toBe(0)
          expect(s.wrong).toBeGreaterThan(0)
          const rp = stats(s)
          expect(rp.scenesPlayed).toBe(1) // the open scene; the next one and the finale stay locked
          expect(rp.recovery).toBe(c.firstTurns * 2) // a help line after each of the first two misses; the third shows the reply
        })

        it.concurrent('random: a seeded learner masters the units, waters the garden, earns the finale and reaches the end', { timeout: 280_000 }, async () => {
          const r = await run('--mode', 'random', '--seed', '3')
          expectPassed(r)
          const s = r.summary
          expect(s.finished).toBe(true)
          expect(s.steps).toBeLessThanOrEqual(s.maxSteps)
          expect(stats(s).scenesPlayed).toBeGreaterThanOrEqual(c.scenes + 1)
        })
      }
    })
  }
})
