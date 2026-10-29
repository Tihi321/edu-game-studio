/**
 * Deterministic seeded pseudo-random number generator (Mulberry32).
 */

export class SeededRandom {
  private s: number

  constructor(seed: number | string = 0) {
    if (typeof seed === 'string') {
      let h = 2166136261 >>> 0
      for (let i = 0; i < seed.length; i++) {
        h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0
      }
      this.s = h || 1
    } else {
      this.s = (seed >>> 0) || 1
    }
  }

  next(): number {
    let t = (this.s += 0x6d2b79f5) >>> 0
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  random(): number {
    return this.next()
  }

  randint(a: number, b: number): number {
    if (a > b) throw new Error(`randint: a (${a}) > b (${b})`)
    return a + Math.floor(this.next() * (b - a + 1))
  }

  randrange(a: number, b?: number): number {
    if (b === undefined) {
      if (a <= 0) throw new Error(`randrange: bound must be positive`)
      return Math.floor(this.next() * a)
    }
    if (a >= b) throw new Error(`randrange: a (${a}) must be less than b (${b})`)
    return a + Math.floor(this.next() * (b - a))
  }

  choice<T>(seq: readonly T[]): T {
    if (seq.length === 0) throw new Error('Cannot choose from an empty sequence')
    return seq[this.randrange(seq.length)]!
  }

  sample<T>(seq: readonly T[], k: number): T[] {
    if (k < 0 || k > seq.length) throw new Error(`Sample size (${k}) out of bounds for sequence of length ${seq.length}`)
    const pool = [...seq]
    const result: T[] = []
    for (let i = 0; i < k; i++) {
      const idx = this.randint(0, pool.length - 1)
      result.push(pool[idx]!)
      pool.splice(idx, 1)
    }
    return result
  }

  shuffle<T>(seq: T[]): T[] {
    for (let i = seq.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const tmp = seq[i]!
      seq[i] = seq[j]!
      seq[j] = tmp
    }
    return seq
  }
}
