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
  it('does nothing before four answers', () => {
    expect(feed(newAdaptive(3), [true, true, true]).difficulty).toBe(3)
    expect(feed(newAdaptive(3), [false, false, false]).difficulty).toBe(3)
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
  it('keeps only the last windowSize answers', () => {
    const s = feed(
      newAdaptive(3),
      Array.from({ length: 25 }, (_, i) => i % 4 !== 0)
    )
    expect(s.window.length).toBeLessThanOrEqual(10)
  })
  it('a simulated learner ends up in or near the flow band', () => {
    // success chance falls with difficulty: 0.97, 0.9, 0.8, 0.65, 0.5 for levels 1 to 5
    const p = [0, 0.97, 0.9, 0.8, 0.65, 0.5]
    const rng = rngFor(42, 'learner')
    let s = newAdaptive(1)
    const outcomes: boolean[] = []
    for (let i = 0; i < 600; i++) {
      const ok = rng.next() < p[s.difficulty]!
      outcomes.push(ok)
      s = recordOutcome(s, ok)
    }
    const tail = outcomes.slice(-300)
    const rate = tail.filter(Boolean).length / tail.length
    expect(rate).toBeGreaterThan(0.68)
    expect(rate).toBeLessThan(0.9)
    expect(s.difficulty).toBeGreaterThanOrEqual(2)
    expect(s.difficulty).toBeLessThanOrEqual(4)
  })
})

describe('pickItem', () => {
  const pool = Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, difficulty: (i % 5) + 1 }))
  it('is deterministic for a seed', () => {
    const run = (seed: number): string[] => {
      const rng = rngFor(seed, 'pick')
      return Array.from({ length: 12 }, () => pickItem(pool, newAdaptive(3), rng)!.id)
    }
    expect(run(7)).toEqual(run(7))
    expect(run(7)).not.toEqual(run(8))
  })
  it('prefers the target difficulty and rarely leaves a two-step window', () => {
    const rng = rngFor(1, 'pick')
    const counts = [0, 0, 0, 0, 0, 0]
    for (let i = 0; i < 2000; i++) counts[pickItem(pool, newAdaptive(3), rng)!.difficulty]!++
    expect(counts[3]!).toBeGreaterThan(counts[2]!)
    expect(counts[3]!).toBeGreaterThan(counts[4]!)
    expect(counts[2]!).toBeGreaterThan(counts[1]!)
    expect(counts[1]! + counts[5]!).toBeGreaterThan(0)
  })
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
