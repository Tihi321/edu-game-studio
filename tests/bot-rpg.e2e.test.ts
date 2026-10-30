import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { buildFixtureGame, chromiumUnavailable, expectCleanAxe, expectPassed, PLAYER_OUT, play } from './bot-helpers'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'

useTemp()

/**
 * The autoplay bot plays the RPG shell (EGS-12): solar-system (the authored section: three areas, a frame story, named foes) and the automatic
 * layout on three courses that have no section (a copy of solar-system without it, european-capitals and hr-a1-greetings with the shell
 * switched on). perfect, wrong and random (seeded) with 0 console errors, one keyboard-only run (0 mouse clicks) and an axe run each.
 */

const unavailable = await chromiumUnavailable()

/** A copy of a golden fixture that plays in the RPG shell with the automatic layout (no section), built with the real player bundle. */
async function autoGame(fixture: string): Promise<string> {
  const { root } = await copyFixture(fixture, `${fixture}-rpg-auto`)
  const file = path.join(root, 'course', 'pack.json')
  const pack = JSON.parse(await readFile(file, 'utf8')) as { shells: { enabled: string[]; config: Record<string, unknown> } }
  pack.shells.enabled = ['quiz-arena', 'rpg']
  pack.shells.config = { 'quiz-arena': pack.shells.config['quiz-arena'] ?? {} }
  await writeFile(file, JSON.stringify(pack, null, 2))
  const out = await tmp('edu-bot-rpg-')
  const res = await buildCourse(root, out, { playerDir: PLAYER_OUT })
  expect(res.problems).toEqual([])
  expect(res.ok).toBe(true)
  return out
}

const GAMES: { name: string; label: string; build: () => Promise<string>; full: boolean }[] = [
  { name: 'solar-system', label: 'solar-system (authored section)', build: () => buildFixtureGame('solar-system'), full: true },
  { name: 'solar-auto', label: 'solar-system without its section (automatic layout)', build: () => autoGame('solar-system'), full: false },
  { name: 'european-capitals', label: 'european-capitals (automatic layout)', build: () => autoGame('european-capitals'), full: true },
  { name: 'hr-a1-greetings', label: 'hr-a1-greetings (automatic layout)', build: () => autoGame('hr-a1-greetings'), full: false }
]

describe.skipIf(!!unavailable)('autoplay bot in the RPG shell', () => {
  for (const g of GAMES) {
    describe(g.label, () => {
      let dirP: Promise<string> | undefined
      const built = (): Promise<string> => (dirP ??= g.build())
      const run = async (args: string[]) => play(await built(), ['--shell', 'rpg', ...args])

      it.concurrent('perfect: right every time, three stars everywhere, the gates, the final boss, the outro, the end screen', { timeout: 300_000 }, async () => {
        const r = await run(['--mode', 'perfect', '--seed', '1'])
        expectPassed(r)
        const s = r.summary
        expect(s.shell).toBe('rpg')
        expect(s.finished).toBe(true)
        expect(s.wrong).toBe(0)
        expect(s.correct).toBe(s.steps)
        expect(s.steps).toBeLessThanOrEqual(s.maxSteps)
        expect(s.screens).toEqual(expect.arrayContaining(['title', 'intro', 'areas', 'world', 'dialogue', 'battle', 'item', 'feedback', 'quest-done', 'inventory', 'boss', 'outro', 'end']))
        const rpg = s.rpg as { areas: number; foes: number; bosses: number; faints: number; gateChecks: number; scrolls: number }
        expect(rpg.areas).toBeGreaterThanOrEqual(3)
        expect(rpg.bosses).toBe(rpg.areas)
        expect(rpg.foes).toBeGreaterThanOrEqual(rpg.areas)
        expect(rpg.faints).toBe(0)
        expect(rpg.gateChecks).toBe(1) // the first foe refused before the quest was taken
        expect(rpg.scrolls).toBeGreaterThan(0)
      })

      it.concurrent('wrong: the hero faints and wakes at the inn, the quest and the foe stay, the review queue fills, no star', { timeout: 300_000 }, async () => {
        const r = await run(['--mode', 'wrong', '--seed', '2', '--rounds', '2'])
        expectPassed(r)
        const s = r.summary
        expect(s.finished).toBe(false)
        expect(s.correct).toBe(0)
        expect(s.wrong).toBe(s.steps)
        expect((s.rpg as { faints: number }).faints).toBe(2)
        expect(s.screens).toEqual(expect.arrayContaining(['battle', 'item', 'feedback', 'inventory']))
        expect(s.checks.answers).toBe(s.wrong)
      })

      it.concurrent('random: a seeded 75 % learner replays what falls short and beats the final boss within the step bound', { timeout: 300_000 }, async () => {
        const r = await run(['--mode', 'random', '--seed', '3', '--accuracy', '0.75'])
        expectPassed(r)
        const s = r.summary
        expect(s.finished).toBe(true)
        expect(s.steps).toBeLessThanOrEqual(s.maxSteps)
        expect(s.wrong).toBeGreaterThan(0)
        expect(s.correct).toBeGreaterThan(s.wrong)
      })

      if (g.full)
        it.concurrent('keyboard only: arrow keys, WASD, Tab and Enter play the whole quest, no mouse click, axe is clean on every screen', { timeout: 300_000 }, async () => {
          const r = await run(['--mode', 'perfect', '--seed', '1', '--keyboard', '--axe'])
          expectPassed(r)
          const s = r.summary
          expect(s.finished).toBe(true)
          expect(s.keyboard?.mouseClicks).toBe(0)
          expect(s.keyboard?.presses).toBeGreaterThan(100)
          expect(s.keyboard?.focusChecks).toBeGreaterThan(30)
          expect(s.keyboard?.ringChecks).toBeGreaterThan(50)
          expectCleanAxe(s, 20)
          expect(s.axe?.screens).toEqual(expect.arrayContaining(['title', 'intro', 'areas', 'world', 'dialogue', 'battle', 'inventory', 'quest-done', 'boss', 'outro', 'end']))
          expect(s.axe?.screens.some((x) => x.startsWith('feedback-'))).toBe(true)
        })
      else
        it.concurrent('axe: no serious or critical violation on any screen', { timeout: 300_000 }, async () => {
          const r = await run(['--mode', 'perfect', '--seed', '4', '--axe'])
          expectPassed(r)
          expectCleanAxe(r.summary, 20)
        })
    })
  }

  it('plays on a phone-sized screen without horizontal scroll (the bot checks every screen)', { timeout: 300_000 }, async () => {
    const dir = await buildFixtureGame('solar-system')
    const r = await play(dir, ['--shell', 'rpg', '--mode', 'perfect', '--seed', '1', '--viewport', '360x740'])
    expectPassed(r)
    expect(r.summary.viewport).toBe('360x740')
  })
})
