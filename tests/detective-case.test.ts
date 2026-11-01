/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import { generate, PuzzleError, solve, verify } from '../src/shared/puzzles'
import {
  accusationKeys,
  accusationOf,
  buildCase,
  checkAccuse,
  hintFor,
  renderClue,
  SEED_TRIES,
  type Marks,
  type Namer,
  type Puzzle
} from '../src/shared/shells/detective-case'

/**
 * The detective shell's wrapper over the proved puzzle generator (EGS-14): the proofs (every kind and size the shell uses, 200 seeds each:
 * unique AND deducible), the seed fallback, the clue sentences (English equals the generator's own, Croatian is grammar-free, aliases), the
 * accusation, the marks and the hints (which never leak a face-down card).
 */

const BANDS = ['easy', 'medium', 'hard'] as const
const defaultNamer = (p: any): Namer => ({ name: (id) => p.names[id] })

describe('proofs: every kind and size the shell uses, 200 seeds each', () => {
  const kinds: [string, number][] = [
    ['murdle', 3],
    ['murdle', 4],
    ['logic', 3],
    ['logic', 4]
  ]
  // 200 proofs of a size-4 logic grid take about 10 s alone and longer while the e2e files share the CPU: a generous bound, not a race
  it.each(kinds)('%s of size %i: every seed gives a case with exactly one solution that deduction solves', { timeout: 120_000 }, (kind, size) => {
    let fellBack = 0
    for (let seed = 1; seed <= 200; seed++) {
      const band = BANDS[(seed - 1) % BANDS.length] as string
      const built = buildCase({ kind: kind as 'murdle' | 'logic', size, seed, band })
      const proof = solve(built.puzzle as any)
      expect(proof.unique, `${kind} ${size} seed ${seed}`).toBe(true)
      expect(proof.deducible, `${kind} ${size} seed ${seed}`).toBe(true)
      expect(proof.solutions).toBe(1)
      expect(() => verify(built.puzzle as any)).not.toThrow()
      expect(built.puzzle.clues.length).toBeGreaterThan(0)
      if (built.skipped > 0) fellBack++
    }
    // the generator makes every seed of these kinds: the fallback is a safety net, not the normal path
    expect(fellBack).toBe(0)
  })
})

describe('buildCase: seeds, cache and the fallback', () => {
  it('is deterministic and cached', () => {
    const a = buildCase({ kind: 'murdle', size: 3, seed: 11, band: 'easy' })
    const b = buildCase({ kind: 'murdle', size: 3, seed: 11, band: 'easy' })
    expect(b).toBe(a)
    expect(JSON.stringify(generate({ kind: 'murdle', size: 3, seed: 11, band: 'easy' }))).toBe(JSON.stringify(a.puzzle))
    expect(a.seed).toBe(11)
    expect(a.skipped).toBe(0)
  })

  it('falls back when a puzzle does not verify, and throws when every seed fails', () => {
    const bad = (o: { kind: string; size: number; seed: number; band: string }): unknown => {
      const p: any = generate(o)
      return o.seed === 3 ? { ...p, clues: p.clues.slice(0, 1) } : p // too few clues: not unique
    }
    const b = buildCase({ kind: 'murdle', size: 3, seed: 3, band: 'easy' }, bad)
    expect(b.seed).toBe(4)
    expect(() =>
      buildCase({ kind: 'murdle', size: 3, seed: 1, band: 'easy' }, () => {
        throw new PuzzleError('nope')
      })
    ).toThrow('nope')
    let calls = 0
    try {
      buildCase({ kind: 'murdle', size: 3, seed: 1, band: 'easy' }, () => {
        calls++
        throw new PuzzleError('nope')
      })
    } catch {
      /* expected */
    }
    expect(calls).toBe(SEED_TRIES)
  })

})

describe('clue sentences', () => {
  it('renders every clue type of both kinds in English and Croatian, with no placeholder left and every name in place', () => {
    const seen = new Set<string>()
    for (const kind of ['murdle', 'logic'] as const) {
      for (const band of BANDS) {
        for (let seed = 1; seed <= 12; seed++) {
          const p = buildCase({ kind, size: 3, seed, band }).puzzle as Puzzle
          const who: Namer = { name: (id) => `<<${id}>>` }
          for (const c of p.clues) {
            seen.add(`${kind}:${c.type}`)
            for (const lang of ['en', 'hr']) {
              const s = renderClue(p, c, who, lang)
              expect(s, `${kind} ${c.type} ${lang}`).not.toMatch(/[{}]/)
              const ids = [c.a, c.b].flat() as string[]
              for (const id of ids) expect(s).toContain(`<<${id}>>`)
              if (lang === 'hr') expect(s).not.toMatch(/\b(the|was|had|is|and|either)\b/)
            }
          }
        }
      }
    }
    for (const t of ['is', 'not', 'either']) expect(seen.has(`murdle:${t}`), `murdle ${t}`).toBe(true)
    for (const t of ['before', 'neither', 'oneof']) expect(seen.has(`logic:${t}`), `logic ${t}`).toBe(true)
  })

})

describe('the accusation and the grid', () => {
  it('murdle: the answer is accepted, anything else is not, and only the wrong categories are named', () => {
    const p = buildCase({ kind: 'murdle', size: 3, seed: 4, band: 'medium' }).puzzle
    const right = accusationOf(p) as Record<string, string>
    expect(Object.keys(right).sort()).toEqual(accusationKeys(p).sort())
    expect(accusationKeys(p)).toEqual(['suspect', 'weapon'])
    expect(checkAccuse(p, right, {})).toEqual({ correct: true, wrong: [] })
    const other = (key: string, id: string): string => (p.categories.find((c) => c.key === key) as any).items.find((i: string) => i !== id)
    const bad = checkAccuse(p, { ...right, weapon: other('weapon', right.weapon as string) }, {})
    expect(bad.correct).toBe(false)
    expect(bad.wrong).toEqual(['weapon'])
    expect(checkAccuse(p, { suspect: other('suspect', right.suspect as string), weapon: other('weapon', right.weapon as string) }, {}).wrong.sort()).toEqual(['suspect', 'weapon'])
  })

})

describe('hints', () => {
  const who = (p: any): Namer => defaultNamer(p)
  it('walk the learner to the end: following the hints fills the grid and then says to accuse', () => {
    for (const lang of ['en', 'hr']) {
      for (const kind of ['murdle', 'logic'] as const) {
        const p = buildCase({ kind, size: 3, seed: 5, band: 'medium' }).puzzle as any
        const all = p.clues.map((c: any) => c.id)
        let marks: Marks = {}
        let guard = 0
        for (;;) {
          const h = hintFor(p, all, marks, who(p), lang)
          expect(h.text.length).toBeGreaterThan(5)
          expect(h.text).not.toMatch(/[{}]/)
          if (h.kind === 'accuse') break
          expect(h.kind).toBe('step')
          const step = (solve(p) as any).steps.find((s: any) => `${s.cell[0]}|${s.cell[1]}` === h.cell)
          marks = step ? { ...marks, [h.cell]: step.value } : marks
          if (++guard > 200) throw new Error('the hints never ended')
        }
        expect(guard).toBeGreaterThan(0)
      }
    }
  })

})
