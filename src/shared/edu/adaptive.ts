import type { SeededRandom } from './prng'

/**
 * Adaptive difficulty: keep the learner's rolling success rate in the flow band (70 to 85 %). Pure and deterministic: the only randomness
 * is the `SeededRandom` the caller passes to `pickItem`.
 *
 *  - The state keeps the last `windowSize` outcomes (default 10) and a difficulty from 1 to 5.
 *  - After each answer, once `minSamples` (default 4) outcomes are in the window: a rate below 0.70 lowers the difficulty by one, above
 *    0.85 raises it by one, inside the band keeps it. A change clears the window, so the new level is judged on its own answers.
 *  - `pickItem` draws from the candidates with weight 6 for the target difficulty, 2 for one step away, 1 for two steps; further ones
 *    only when nothing is near. Items in `avoid` (just asked) are skipped when anything else is left.
 */

export interface AdaptiveOptions {
  windowSize?: number
  minSamples?: number
  low?: number
  high?: number
  minDifficulty?: number
  maxDifficulty?: number
}

export const BAND_LOW = 0.7
export const BAND_HIGH = 0.85

export interface AdaptiveState {
  /** Newest last. */
  window: boolean[]
  difficulty: number
}

export const newAdaptive = (difficulty = 3): AdaptiveState => ({ window: [], difficulty })

/** Success rate of the window, or null when it is empty. */
export function rollingRate(window: readonly boolean[]): number | null {
  return window.length === 0 ? null : window.filter(Boolean).length / window.length
}

/** Where a rate sits against the band. */
export function bandOf(rate: number, o: AdaptiveOptions = {}): 'low' | 'in' | 'high' {
  return rate < (o.low ?? BAND_LOW) ? 'low' : rate > (o.high ?? BAND_HIGH) ? 'high' : 'in'
}

/** The state after one answer (a new object). */
export function recordOutcome(state: AdaptiveState, correct: boolean, o: AdaptiveOptions = {}): AdaptiveState {
  const size = o.windowSize ?? 10
  const window = [...state.window, correct].slice(-size)
  const rate = rollingRate(window)
  if (rate === null || window.length < (o.minSamples ?? 4)) return { window, difficulty: state.difficulty }
  const min = o.minDifficulty ?? 1
  const max = o.maxDifficulty ?? 5
  const band = bandOf(rate, o)
  const difficulty = band === 'low' ? Math.max(min, state.difficulty - 1) : band === 'high' ? Math.min(max, state.difficulty + 1) : state.difficulty
  return difficulty === state.difficulty ? { window, difficulty } : { window: [], difficulty }
}

export interface Candidate {
  id: string
  difficulty: number
}

/** Picks the next item for the current difficulty. Returns null for an empty candidate list. */
export function pickItem(candidates: readonly Candidate[], state: AdaptiveState, rng: SeededRandom, avoid: readonly string[] = []): Candidate | null {
  let pool = candidates.filter((c) => !avoid.includes(c.id))
  if (pool.length === 0) pool = [...candidates]
  if (pool.length === 0) return null
  const dist = (c: Candidate): number => Math.abs(c.difficulty - state.difficulty)
  let weighted = pool.map((c) => ({ c, w: dist(c) === 0 ? 6 : dist(c) === 1 ? 2 : dist(c) === 2 ? 1 : 0 }))
  if (weighted.every((x) => x.w === 0)) {
    const nearest = Math.min(...pool.map(dist))
    weighted = pool.map((c) => ({ c, w: dist(c) === nearest ? 1 : 0 }))
  }
  const total = weighted.reduce((s, x) => s + x.w, 0)
  let r = rng.next() * total
  for (const x of weighted) {
    if (x.w === 0) continue
    if (r < x.w) return x.c
    r -= x.w
  }
  return weighted.filter((x) => x.w > 0).at(-1)!.c
}
