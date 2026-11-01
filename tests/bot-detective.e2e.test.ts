import { describe, expect, it } from 'vitest'
import { buildFixtureGame, expectCleanAxe, expectPassed, play } from './bot-helpers'
import { useTemp } from './edu-build-helpers'

/**
 * The detective shell played end to end by the autoplay bot (EGS-14, `scripts/bot/detective.mjs`): one perfect run with axe on european-capitals
 * (murdle, a logic grid and the chase), 0 console errors. Wrong and random modes are covered by the fast detective logic tests (EGS-45).
 * Without Chromium the run fails (`yarn playwright install chromium`).
 */

useTemp()

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
  { fixture: 'european-capitals' as const, rooms: 4, chase: true, grid: ['case-facedown-murdle', 'case-facedown-logic', 'case-grid-marked-logic'] }
]

describe('autoplay bot in the detective shell', () => {
  for (const c of CASES) {
    describe(c.fixture, () => {
      let dirP: Promise<string> | undefined
      const built = (): Promise<string> => (dirP ??= buildFixtureGame(c.fixture))
      const run = async (...args: string[]) => play(await built(), [...args, '--shell', 'detective'])

      it.concurrent('perfect + axe: every room to 3 stars (too-early accusation refused, a wrong one refused, hint, grid, right one), the final room, then the chase and the end', { timeout: 120_000 }, async () => {
        const r = await run('--mode', 'perfect', '--seed', '1', '--axe')
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
        expectCleanAxe(s, 10)
        expect(s.axe?.screens).toEqual(expect.arrayContaining(['office', 'case-solved', 'end', 'case-wrong-accusation', ...c.grid]))
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

      it.concurrent('keyboard only: Tab, Enter and Space play the file, no mouse click, axe is clean on every distinct screen', { timeout: 120_000 }, async () => {
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

    })
  }
})
