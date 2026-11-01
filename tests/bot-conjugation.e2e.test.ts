import { describe, expect, it } from 'vitest'
import { buildFixtureGame, expectCleanAxe, expectPassed, play } from './bot-helpers'

/**
 * The autoplay bot on the German verbs fixture (EGS-27, `tests/fixtures/courses/de-verbs-a1`): conjugation items (typed forms per person,
 * one with `ask`, one with a given form) next to an mcq and a typed item. Perfect = every answer right, wrong = none right, random in
 * between, 0 console errors, keyboard only (no mouse click), axe clean. Without Chromium the run fails (`yarn playwright install chromium`).
 */

describe('autoplay bot on de-verbs-a1', () => {
  let dirP: Promise<string> | undefined
  const built = (): Promise<string> => (dirP ??= buildFixtureGame('de-verbs-a1'))

  it.concurrent('perfect: every conjugation form typed right, the course is finished', { timeout: 300_000 }, async () => {
    const r = await play(await built(), ['--mode', 'perfect', '--seed', '1'])
    expectPassed(r)
    expect(r.summary.finished).toBe(true)
    expect(r.summary.wrong).toBe(0)
    expect(r.summary.kinds.conjugation).toBeGreaterThan(0)
  })

  it.concurrent('wrong: no form is right, the feedback shows the right table', { timeout: 300_000 }, async () => {
    const r = await play(await built(), ['--mode', 'wrong', '--seed', '2', '--rounds', '2'])
    expectPassed(r)
    expect(r.summary.correct).toBe(0)
    expect(r.summary.kinds.conjugation).toBeGreaterThan(0)
  })

  it.concurrent('random: a seeded 75 % learner is in between', { timeout: 300_000 }, async () => {
    const r = await play(await built(), ['--mode', 'random', '--seed', '3', '--accuracy', '0.75'])
    expectPassed(r)
    expect(r.summary.wrong).toBeGreaterThan(0)
    expect(r.summary.correct).toBeGreaterThan(r.summary.wrong)
  })

  it.concurrent('keyboard only (Enter moves between the inputs) and axe clean', { timeout: 300_000 }, async () => {
    const r = await play(await built(), ['--mode', 'perfect', '--seed', '1', '--keyboard', '--axe'])
    expectPassed(r)
    expect(r.summary.keyboard?.mouseClicks).toBe(0)
    expect(r.summary.finished).toBe(true)
    expectCleanAxe(r.summary, 4)
  })
})
