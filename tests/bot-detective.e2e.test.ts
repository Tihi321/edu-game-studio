import { describe, expect, it } from 'vitest'
import { chromiumUnavailable, buildFixtureGame, expectCleanAxe, expectPassed, play } from './bot-helpers'
import { useTemp } from './edu-build-helpers'

/**
 * The detective shell played end to end by the autoplay bot (EGS-14, `scripts/bot/detective.mjs`) for both fixtures that enable it
 * (solar-system: four murdle cases; european-capitals: murdle, a logic grid and the chase): perfect, wrong and random (seeded) pass with
 * 0 console errors, one keyboard-only perfect run (no mouse click) and an axe run (no serious or critical violation) per fixture.
 * Skipped, with a message, only when Chromium cannot be launched (`yarn playwright install chromium`).
 */

useTemp()

const unavailable = await chromiumUnavailable()
if (unavailable) console.warn(`[bot-detective.e2e] SKIPPED: Chromium cannot be launched (${unavailable}). Run "yarn playwright install chromium".`)

interface Info {
  rooms: { id: string; stars?: number; asked?: number; turned?: number }[]
  cards: number
  cardsRight: number
  hints: number
  wrongAccusations: number
  refusedEarly: number
  cold: number
  legs: number
  caught: boolean
  replays: number
}
const info = (s: Record<string, unknown>): Info => s.detective as Info

const CASES = [
  { fixture: 'solar-system' as const, rooms: 4, chase: false, grid: ['case-facedown-murdle', 'case-grid-marked-murdle'] },
  { fixture: 'european-capitals' as const, rooms: 4, chase: true, grid: ['case-facedown-murdle', 'case-facedown-logic', 'case-grid-marked-logic'] }
]

describe.skipIf(!!unavailable)('autoplay bot in the detective shell', () => {
  for (const c of CASES) {
    describe(c.fixture, () => {
      let dirP: Promise<string> | undefined
      const built = (): Promise<string> => (dirP ??= buildFixtureGame(c.fixture))
      const run = async (...args: string[]) => play(await built(), [...args, '--shell', 'detective'])

      it.concurrent('perfect: every room to 3 stars (too-early accusation refused, a wrong one refused, hint, grid, right one), the final room, then the chase and the end', { timeout: 300_000 }, async () => {
        const r = await run('--mode', 'perfect', '--seed', '1')
        expectPassed(r)
        const s = r.summary
        const d = info(s)
        expect(s.shell).toBe('detective')
        expect(s.finished).toBe(true)
        expect(s.wrong).toBe(0)
        expect(s.correct).toBe(s.steps)
        expect(s.steps).toBeLessThanOrEqual(s.maxSteps)
        expect(s.screens).toEqual(expect.arrayContaining(['title', 'office', 'case', 'item', 'feedback', 'case-solved', 'end']))
        expect(d.rooms).toHaveLength(c.rooms)
        expect(d.rooms.every((x) => x.stars === 3)).toBe(true)
        expect(d.cardsRight).toBe(d.cards)
        expect(d.refusedEarly).toBe(c.rooms)
        expect(d.wrongAccusations).toBe(c.rooms)
        expect(d.hints).toBe(c.rooms)
        expect(d.replays).toBe(0)
        if (c.chase) {
          expect(s.screens).toEqual(expect.arrayContaining(['chase', 'caught']))
          expect(d.caught).toBe(true)
          expect(d.legs).toBe(5)
          expect(d.cold).toBe(1)
          expect(s.steps).toBe(d.cards + 5)
        } else {
          expect(d.caught).toBe(false)
          expect(s.steps).toBe(d.cards)
        }
      })

      it.concurrent('keyboard only: Tab, Enter and Space play the file, no mouse click, axe is clean on every distinct screen', { timeout: 300_000 }, async () => {
        const r = await run('--mode', 'perfect', '--seed', '1', '--keyboard', '--axe')
        expectPassed(r)
        const s = r.summary
        expect(s.finished).toBe(true)
        expect(s.wrong).toBe(0)
        expect(s.keyboard?.mouseClicks).toBe(0)
        expect(s.keyboard?.presses).toBeGreaterThan(100)
        expect(s.keyboard?.focusChecks).toBeGreaterThan(30)
        expect(s.keyboard?.ringChecks).toBeGreaterThan(100)
        expectCleanAxe(s, 10)
        expect(s.axe?.screens).toEqual(expect.arrayContaining(['office', 'case-solved', 'end', 'case-wrong-accusation', ...c.grid]))
        if (c.chase) expect(s.axe?.screens).toEqual(expect.arrayContaining(['chase', 'chase-travel', 'chase-cold-trail', 'caught']))
      })

      it.concurrent('wrong: every clue answer wrong, the cards stay face-down, an accusation is refused, the next door stays locked, no dead end', { timeout: 300_000 }, async () => {
        const r = await run('--mode', 'wrong', '--seed', '2', '--rounds', '1', '--axe')
        expectPassed(r)
        const s = r.summary
        const d = info(s)
        expect(s.finished).toBe(false)
        expect(s.correct).toBe(0)
        expect(s.wrong).toBe(s.steps)
        expect(s.steps).toBe(4)
        expect(d.rooms).toHaveLength(1)
        expect(d.rooms[0]?.turned).toBe(0)
        expect(d.refusedEarly).toBe(2)
        expect(s.screens).not.toContain('case-solved')
        expect(s.screens).not.toContain('chase')
        expect(s.checks.answers).toBe(s.wrong)
        expectCleanAxe(s, 5)
        expect(s.axe?.screens).toEqual(expect.arrayContaining(['office', 'case-facedown-after-wrong']))
      })

      it.concurrent('random: a seeded 75 % learner replays a case that earned under 2 stars and still reaches the end within the step bound', { timeout: 300_000 }, async () => {
        const r = await run('--mode', 'random', '--seed', '3', '--accuracy', '0.75')
        expectPassed(r)
        const s = r.summary
        expect(s.finished).toBe(true)
        expect(s.steps).toBeLessThanOrEqual(s.maxSteps)
        expect(s.screens).toEqual(expect.arrayContaining(['office', 'case', 'case-solved', 'end']))
        expect(s.correct).toBeGreaterThan(0)
        expect(s.wrong).toBeGreaterThan(0)
        if (c.chase) expect(info(s).caught).toBe(true)
      })
    })
  }
})
