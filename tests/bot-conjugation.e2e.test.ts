import { describe, expect, it } from 'vitest'
import { buildFixtureGame, expectPassed, play } from './bot-helpers'

/**
 * The autoplay bot on the German verbs fixture (EGS-27, `tests/fixtures/courses/de-verbs-a1`): conjugation items (typed forms per person,
 * one with `ask`, one with a given form) next to an mcq and a typed item: one perfect run (EGS-45 trim). Without Chromium the run fails (`yarn playwright install chromium`).
 */

describe('autoplay bot on de-verbs-a1', () => {
  let dirP: Promise<string> | undefined
  const built = (): Promise<string> => (dirP ??= buildFixtureGame('de-verbs-a1'))

  it.concurrent('perfect: every conjugation form typed right, the course is finished', { timeout: 120_000 }, async () => {
    const r = await play(await built(), ['--mode', 'perfect', '--seed', '1'])
    expectPassed(r)
    expect(r.summary.finished).toBe(true)
    expect(r.summary.wrong).toBe(0)
    expect(r.summary.kinds.conjugation).toBeGreaterThan(0)
  })

})
