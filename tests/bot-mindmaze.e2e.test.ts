import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { expectCleanAxe, expectPassed, PLAYER_OUT, play, type BotSummary } from './bot-helpers'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'

/**
 * The MindMaze castle played end to end by the autoplay bot (EGS-11, `scripts/bot/mindmaze.mjs`): for every fixture that enables the shell
 * (solar-system and european-capitals with their authored castle) and for solar-system WITHOUT its section (the automatic layout), perfect,
 * wrong and random (seeded) pass with 0 console errors, one keyboard-only perfect run (no mouse click) and an axe run (no serious or critical
 * violation). Without Chromium the run fails (`yarn playwright install chromium`).
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
  { title: 'solar-system (authored castle)', fixture: 'solar-system', auto: false, wings: 3 },
  { title: 'european-capitals (authored castle)', fixture: 'european-capitals', auto: false, wings: 3 },
  { title: 'solar-system (automatic layout, no section)', fixture: 'solar-system', auto: true, wings: 3 }
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

      it.concurrent('perfect: every wing to 3 stars in prerequisite order, torches never drop, the throne, the end', { timeout: 300_000 }, async () => {
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

      it.concurrent('keyboard only: Tab, Enter and the number keys walk the castle, no mouse click, axe is clean', { timeout: 300_000 }, async () => {
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

      it.concurrent('axe: no serious or critical violation on the castle, a room, the ghost scene, the key room, the throne or the feedback of a wrong answer', { timeout: 300_000 }, async () => {
        const right = await run('--mode', 'perfect', '--seed', '4', '--axe')
        expectPassed(right)
        expectCleanAxe(right.summary, 8)
        expect(right.summary.axe?.screens).toEqual(expect.arrayContaining(['castle', 'room', 'room-key', 'wing-done', 'castle-keys', 'throne-intro', 'throne-result', 'end']))
        const wrong = await run('--mode', 'wrong', '--seed', '5', '--axe')
        expectPassed(wrong)
        expectCleanAxe(wrong.summary, 5)
        expect(wrong.summary.axe?.screens).toEqual(expect.arrayContaining(['castle', 'room', 'room-ghost', 'castle-after']))
        expect(wrong.summary.axe?.screens.some((x) => x.startsWith('feedback-wrong-'))).toBe(true)
      })

      it.concurrent('wrong: the torches go out, the ghost leads back and relights, doors still ask, nothing is won, no dead end', { timeout: 300_000 }, async () => {
        const r = await run('--mode', 'wrong', '--seed', '2', '--rounds', '1')
        expectPassed(r)
        const s = r.summary
        expect(s.finished).toBe(false)
        expect(s.correct).toBe(0)
        expect(s.wrong).toBe(s.steps)
        expect(s.steps).toBe(6) // two ghost scenes of three torches each
        expect(maze(s).ghosts).toBe(2)
        expect(maze(s).keys).toBe(0)
        expect(s.screens).toEqual(expect.arrayContaining(['castle', 'room', 'item', 'feedback']))
        expect(s.screens).not.toContain('throne')
        expect(s.checks.answers).toBe(s.wrong)
        expect(s.checks.explanations).toBe(s.wrong)
      })

      it.concurrent('random: a seeded 75 % learner wins every wing and the throne within the step bound', { timeout: 300_000 }, async () => {
        const r = await run('--mode', 'random', '--seed', '3', '--accuracy', '0.75')
        expectPassed(r)
        const s = r.summary
        expect(s.finished).toBe(true)
        expect(s.steps).toBeLessThanOrEqual(s.maxSteps)
        expect(s.wrong).toBeGreaterThan(0)
        expect(s.correct).toBeGreaterThan(s.wrong)
        expect(Object.values(maze(s).wings).every((stars) => stars >= 2)).toBe(true)
      })
    })
  }
})
