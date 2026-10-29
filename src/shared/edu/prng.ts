import { SeededRandom } from '../puzzles/prng'

/**
 * The seeded generator of the learning logic is the puzzle engine's Mulberry32 (`puzzles/prng.ts`), reused as it is: same seed, same
 * sequence, in the browser and in node. `rngFor` derives an independent stream for one purpose from a seed, so the crossword of an item
 * does not change when something else draws numbers.
 */
export { SeededRandom }

/** A generator for `seed` and a `salt` (an item id, a language, "order" ...). */
export function rngFor(seed: number | string, ...salt: (string | number)[]): SeededRandom {
  return new SeededRandom([seed, ...salt].join(':'))
}

/** A seeded shuffle that returns a new array and never leaves the input order when the array has two or more different elements. */
export function shuffledCopy<T>(seq: readonly T[], rng: SeededRandom): T[] {
  const out = rng.shuffle([...seq])
  if (out.length > 1 && out.every((v, i) => v === seq[i])) out.push(out.shift() as T)
  return out
}
