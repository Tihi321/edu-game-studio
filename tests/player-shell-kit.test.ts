import { describe, expect, it } from 'vitest'
import { playableShells } from '../src/player/engine'
import { emptyShellProgress, hasShellProgress, newProgress, parseProgress } from '../src/player/progress'
import { pickNext, recordResult, roundAccuracy, startPool } from '../src/player/round'
import { rngFor } from '../src/shared/edu'
import { loadFixture } from './edu-fixtures'

/** The shell contract (EGS-10): shell choice, the per-shell progress slot, runs over any pool, the section registry, shell strings. */

describe('shell choice', () => {
  it('plays the enabled shells that are registered, in order, falling back to the default shell', () => {
    expect(playableShells(['quiz-arena', 'mindmaze', 'nope'], ['quiz-arena', 'mindmaze', 'rpg'])).toEqual(['quiz-arena', 'mindmaze'])
    expect(playableShells(['nope'], ['quiz-arena'])).toEqual(['quiz-arena'])
    expect(playableShells([], new Set(['quiz-arena']))).toEqual(['quiz-arena'])
    expect(playableShells(['x'], [])).toEqual([])
  })

})

describe('per-shell progress', () => {
  const pack = { id: 'c', units: [{ id: 'u1', title: 't', requires: [] }], items: [{ id: 'i1' }], objectives: [] } as never

  it('keeps each shell its own stars, finish flag and data, and cleans them on import', () => {
    const p = newProgress('c')
    expect(p.shells).toEqual({})
    p.shells.mindmaze = { ...emptyShellProgress(), units: { u1: { stars: 2, best: 0.8, rounds: 1 } }, finished: true, data: { rooms: ['a'] } }
    p.shells['bad id!'] = emptyShellProgress()
    const back = parseProgress(JSON.stringify(p), pack)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.progress.shells.mindmaze).toEqual({ units: { u1: { stars: 2, best: 0.8, rounds: 1 } }, boss: { stars: 0, best: 0, rounds: 0 }, finished: true, data: { rooms: ['a'] } })
    expect(back.progress.shells['bad id!']).toBeUndefined()
    expect(hasShellProgress(back.progress, 'mindmaze')).toBe(true)
    expect(hasShellProgress(back.progress, 'rpg')).toBe(false)
  })

})

describe('runs over any pool (the round logic every shell asks from)', () => {
  it('asks each fresh item once, brings a miss back after other questions, and counts first tries only', async () => {
    const { pack } = await loadFixture('solar-system')
    const pool = pack.items.slice(0, 5).map((i) => i.id)
    let run = startPool(pool, { unitId: 'u-sun-planets' })
    expect(run.size).toBe(5)
    const rng = rngFor(1, 'test')
    const seen: { id: string; retry: boolean }[] = []
    for (let guard = 0; guard < 30; guard++) {
      const pick = pickNext(run, pack, rng, {}, 0)
      if (!pick) break
      seen.push(pick)
      const item = pack.items.find((i) => i.id === pick.id)!
      const correct = !(seen.length === 1)
      run = recordResult(run, pick, item, { correct, score: correct ? 1 : 0 }, correct ? 'good' : 'again')
    }
    expect(seen.filter((s) => !s.retry).map((s) => s.id).sort()).toEqual([...pool].sort())
    expect(seen.some((s) => s.retry && s.id === seen[0]!.id)).toBe(true)
    expect(roundAccuracy(run)).toBeCloseTo(4 / 5)
  })

})
