import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { expectCleanAxe, expectPassed, PLAYER_OUT, play, type BotSummary } from './bot-helpers'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'

/**
 * The MindMaze castle played end to end by the autoplay bot (EGS-11, `scripts/bot/mindmaze.mjs`) on solar-system with its authored castle: one
 * perfect run and one keyboard-only perfect run with axe (no mouse click, no serious or critical violation), 0 console errors (EGS-45 trim). Without Chromium the run fails (`yarn playwright install chromium`).
 */

useTemp()

interface Case {
  title: string
  fixture: 'solar-system' | 'european-capitals'
  /** Drop the course's `mindmaze` section: the castle builds itself from the units and objectives. */
  auto: boolean
  wings: number
}
const CASES: Case[] = [
  { title: 'solar-system (authored castle)', fixture: 'solar-system', auto: false, wings: 3 }
]

describe('autoplay bot in the MindMaze castle', () => {
  for (const c of CASES) {
    describe(c.title, () => {
      let dirP: Promise<string> | undefined
      const built = (): Promise<string> =>
        (dirP ??= (async () => {
          const { root } = await copyFixture(c.fixture)
          if (c.auto) {
            const file = path.join(root, 'course', 'pack.json')
            const pack = JSON.parse(await readFile(file, 'utf8')) as { shells: { enabled: string[]; config: Record<string, unknown> } }
            delete pack.shells.config.mindmaze
            await writeFile(file, JSON.stringify(pack, null, 2))
          }
          const out = await tmp('edu-bot-maze-')
          const res = await buildCourse(root, out, { playerDir: PLAYER_OUT })
          expect(res.problems).toEqual([])
          expect(res.ok).toBe(true)
          return out
        })())
      const run = async (...args: string[]) => play(await built(), [...args, '--shell', 'mindmaze'])
      const maze = (s: BotSummary) => s.maze as { wings: Record<string, number>; doors: number; questions: number; ghosts: number; keys: number; backs: number; digitDoors: number; shape: { auto: boolean; doors: number }[] }

      it.concurrent('perfect: every wing to 3 stars in prerequisite order, torches never drop, the throne, the end', { timeout: 120_000 }, async () => {
        const r = await run('--mode', 'perfect', '--seed', '1')
        expectPassed(r)
        const s = r.summary
        expect(s.shell).toBe('mindmaze')
        expect(s.finished).toBe(true)
        expect(s.wrong).toBe(0)
        expect(s.correct).toBe(s.steps)
        expect(s.steps).toBeLessThanOrEqual(s.maxSteps)
        expect(s.screens).toEqual(expect.arrayContaining(['title', 'castle', 'room', 'item', 'feedback', 'wing-done', 'throne', 'end']))
        const m = maze(s)
        expect(Object.values(m.wings)).toEqual(Array(c.wings).fill(3))
        expect(m.keys).toBe(c.wings)
        expect(m.ghosts).toBe(0)
        expect(m.backs).toBe(c.wings) // an opened door was walked back through and forward again, once per wing
        expect(m.shape.every((w) => w.auto === c.auto)).toBe(true)
        expect(m.shape.every((w) => w.doors >= 4)).toBe(true)
      })

      it.concurrent('keyboard only: Tab, Enter and the number keys walk the castle, no mouse click, axe is clean', { timeout: 120_000 }, async () => {
        const r = await run('--mode', 'perfect', '--seed', '1', '--keyboard', '--axe')
        expectPassed(r)
        const s = r.summary
        expect(s.finished).toBe(true)
        expect(s.wrong).toBe(0)
        expect(s.keyboard?.mouseClicks).toBe(0)
        expect(s.keyboard?.presses).toBeGreaterThan(60)
        expect(s.keyboard?.focusChecks).toBeGreaterThan(30)
        expect(s.keyboard?.ringChecks).toBeGreaterThan(30)
        expect(maze(s).digitDoors).toBeGreaterThan(0) // the number keys walked through at least one open door
        expectCleanAxe(s, 8)
        expect(s.axe?.screens).toEqual(expect.arrayContaining(['castle', 'room', 'wing-done', 'throne-intro', 'throne-result', 'end']))
      })

    })
  }
})
