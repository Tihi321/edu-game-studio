import { describe, expect, it } from 'vitest'
import { buildFixtureGame, expectPassed, play } from './bot-helpers'
import { useTemp } from './edu-build-helpers'

useTemp()

/**
 * The autoplay bot plays the RPG shell (EGS-12) on solar-system (the authored section: three areas, a frame story, named foes): one perfect run
 * on a phone-sized screen (the bot checks every screen for horizontal scroll). Wrong, random, keyboard and axe runs were cut (EGS-45).
 */
describe('autoplay bot in the RPG shell', () => {
  it('perfect on a phone-sized screen: right every time, three stars everywhere, the gates, the final boss, the outro, the end screen', { timeout: 120_000 }, async () => {
    const dir = await buildFixtureGame('solar-system')
    const r = await play(dir, ['--shell', 'rpg', '--mode', 'perfect', '--seed', '1', '--viewport', '360x740'])
    expectPassed(r)
    const s = r.summary
    expect(s.shell).toBe('rpg')
    expect(s.viewport).toBe('360x740')
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
})
