import { describe, expect, it } from 'vitest'
import { bandOf, newAdaptive, pickItem, recordOutcome, rngFor, rollingRate, type AdaptiveState } from '../src/shared/edu'

const feed = (s: AdaptiveState, outcomes: boolean[]): AdaptiveState => outcomes.reduce((st, o) => recordOutcome(st, o), s)

describe('adaptive difficulty', () => {
  it('the rolling rate and the band 0.70 to 0.85', () => {
    expect(rollingRate([])).toBeNull()
    expect(rollingRate([true, false, true, true])).toBe(0.75)
    expect(bandOf(0.69)).toBe('low')
    expect(bandOf(0.7)).toBe('in')
    expect(bandOf(0.85)).toBe('in')
    expect(bandOf(0.86)).toBe('high')
  })
  it('goes up when the learner is above the band, down when below, stays inside it', () => {
    expect(feed(newAdaptive(3), [true, true, true, true]).difficulty).toBe(4)
    expect(feed(newAdaptive(3), [true, true, false, false]).difficulty).toBe(2)
    // 3 of 4 = 0.75: inside the band
    expect(feed(newAdaptive(3), [true, true, true, false]).difficulty).toBe(3)
  })
  it('a change clears the window, so the new level is judged on its own answers', () => {
    const up = feed(newAdaptive(2), [true, true, true, true])
    expect(up).toEqual({ window: [], difficulty: 3 })
    expect(feed(up, [true, true, true]).difficulty).toBe(3)
    expect(feed(up, [true, true, true, true]).difficulty).toBe(4)
  })
  it('stays between 1 and 5', () => {
    expect(feed(newAdaptive(5), [true, true, true, true]).difficulty).toBe(5)
    expect(feed(newAdaptive(1), [false, false, false, false]).difficulty).toBe(1)
  })
})

describe('pickItem', () => {
  it('skips recently asked items while others remain, and falls back to the nearest level', () => {
    const rng = rngFor(3, 'pick')
    const two = [
      { id: 'a', difficulty: 3 },
      { id: 'b', difficulty: 3 }
    ]
    for (let i = 0; i < 20; i++) expect(pickItem(two, newAdaptive(3), rng, ['a'])!.id).toBe('b')
    expect(pickItem(two, newAdaptive(3), rng, ['a', 'b'])).not.toBeNull()
    const far = [
      { id: 'x', difficulty: 5 },
      { id: 'y', difficulty: 4 }
    ]
    for (let i = 0; i < 20; i++) expect(pickItem(far, newAdaptive(1), rng)!.id).toBe('y')
    expect(pickItem([], newAdaptive(3), rng)).toBeNull()
  })
})
