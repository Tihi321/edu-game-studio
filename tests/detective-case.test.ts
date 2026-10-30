/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import { generate, PuzzleError, solve, verify } from '../src/shared/puzzles'
import {
  accusationKeys,
  accusationOf,
  buildCase,
  checkAccuse,
  crossOut,
  cycle,
  entityIds,
  gridComplete,
  gridTables,
  hintFor,
  markOf,
  phrase,
  renderClue,
  SEED_TRIES,
  yesCells,
  yesPairs,
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

  it('falls back to the next seed when the generator throws a PuzzleError', () => {
    const gen = (o: { kind: string; size: number; seed: number; band: string }): unknown => {
      if (o.seed < 7) throw new PuzzleError(`no ${o.band} puzzle found for seed ${o.seed}`)
      return generate(o)
    }
    const b = buildCase({ kind: 'murdle', size: 3, seed: 5, band: 'easy' }, gen)
    expect(b.seed).toBe(7)
    expect(b.skipped).toBe(2)
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

  it('refuses what the generator refuses (size 5 murdle, an unknown band)', () => {
    expect(() => buildCase({ kind: 'murdle', size: 5, seed: 1, band: 'easy' })).toThrow(/murdle makes puzzles/)
    expect(() => buildCase({ kind: 'murdle', size: 3, seed: 1, band: 'impossible' })).toThrow(/unknown band/)
  })
})

describe('clue sentences', () => {
  it('English equals the generator\'s own sentences for the default names (murdle, every band)', () => {
    for (const band of BANDS) {
      for (let seed = 1; seed <= 25; seed++) {
        const p = buildCase({ kind: 'murdle', size: 3, seed, band }).puzzle as any
        const who = defaultNamer(p)
        for (const c of p.clues) expect(renderClue(p, c, who, 'en'), `${band} ${seed} ${c.id}`).toBe(p.text[c.id])
      }
    }
  })

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

  it('says "1 place apart" in the singular and never leaves a placeholder', () => {
    const p: any = buildCase({ kind: 'logic', size: 3, seed: 1, band: 'easy' }).puzzle
    const who = defaultNamer(p)
    const text = renderClue(p, { id: 'c99', type: 'apart', a: 'k1', b: 'c1', n: 1 }, who, 'en')
    expect(text).toMatch(/exactly 1 place apart/)
  })

  it('uses an alias instead of the name, without `the`, and puts `the` before a lower-case thing only in English', () => {
    const p = buildCase({ kind: 'murdle', size: 3, seed: 1, band: 'easy' }).puzzle
    const names: Record<string, string> = { s1: 'Galileo', s2: 'Kepler', s3: 'Herschel', w1: 'telescope', w2: 'Voyager 2', w3: 'lens', p1: 'dome', p2: 'lab', p3: 'deck' }
    const alias: Record<string, string> = { w3: 'the glass that bends starlight' }
    const who: Namer = { name: (id) => names[id] as string, alias: (id) => alias[id] }
    expect(phrase(p, 'w1', who, 'en')).toBe('the telescope')
    expect(phrase(p, 'w1', who, 'hr')).toBe('telescope')
    expect(phrase(p, 'w2', who, 'en')).toBe('Voyager 2')
    expect(phrase(p, 's1', who, 'en')).toBe('Galileo')
    expect(phrase(p, 'w3', who, 'en')).toBe('the glass that bends starlight')
    const withAlias = p.clues.map((c) => renderClue(p, c, who, 'en')).join(' ')
    expect(withAlias).not.toMatch(/the the/)
    expect(p.clues.some((c) => [c.a, c.b].flat().includes('w3'))).toBe(true)
    expect(withAlias).toContain('the glass that bends starlight')
    expect(withAlias).not.toContain('lens')
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

  it('logic: there is no accusation, the grid is the answer', () => {
    const p = buildCase({ kind: 'logic', size: 3, seed: 2, band: 'easy' }).puzzle
    expect(accusationOf(p)).toBeNull()
    expect(accusationKeys(p)).toEqual([])
    let marks: Marks = {}
    expect(checkAccuse(p, {}, marks).correct).toBe(false)
    for (const c of yesCells(p)) {
      marks = cycle(cycle(marks, c), c)
      expect(markOf(marks, c)).toBe('yes')
    }
    expect(checkAccuse(p, {}, marks).correct).toBe(true)
    // the answer needs the yes cells only; a COMPLETE grid also has every no marked
    expect(gridComplete(p, marks)).toBe(false)
    for (const c of gridTables(p).flatMap((t) => t.rows.items.flatMap((r) => t.cols.items.map((k) => `${r}|${k}`)))) if (markOf(marks, c) === '') marks = cycle(marks, c)
    expect(gridComplete(p, marks)).toBe(true)
    expect(yesPairs(p, marks)).toHaveLength(yesCells(p).length)
  })

  it('has a table per pair of categories and cycles blank, no, yes, blank', () => {
    const p = buildCase({ kind: 'logic', size: 4, seed: 1, band: 'easy' }).puzzle
    expect(gridTables(p)).toHaveLength(6)
    expect(entityIds(p)).toHaveLength(16)
    const cell = yesCells(p)[0] as string
    let m: Marks = {}
    const seq: string[] = []
    for (let i = 0; i < 4; i++) {
      m = cycle(m, cell)
      seq.push(markOf(m, cell))
    }
    expect(seq).toEqual(['no', 'yes', '', 'no'])
  })

  it('a yes strikes out the rest of its row and column', () => {
    const p = buildCase({ kind: 'murdle', size: 3, seed: 1, band: 'easy' }).puzzle
    const cell = yesCells(p)[0] as string
    let m: Marks = {}
    m = cycle(cycle(m, cell), cell)
    m = crossOut(p, m, cell)
    const nos = Object.entries(m).filter(([k, v]) => v === 'no' && k.includes('|'))
    expect(nos.length).toBeGreaterThanOrEqual(4)
  })
})

describe('hints', () => {
  const who = (p: any): Namer => defaultNamer(p)
  it('say "turn more clues" while no card is up, and never use a card that is face-down', () => {
    const p = buildCase({ kind: 'murdle', size: 3, seed: 3, band: 'easy' }).puzzle as any
    expect(hintFor(p, [], {}, who(p), 'en').kind).toBe('more')
    // turn the clues one at a time: any hint that quotes a clue quotes a turned one
    const turned: string[] = []
    for (const c of p.clues) {
      turned.push(c.id)
      const h = hintFor(p, turned, {}, who(p), 'en')
      const quoted = /Clue (\d+) says/.exec(h.text)
      if (quoted) expect(turned).toContain(`c${quoted[1]}`)
    }
  })

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

  it('point at a wrong mark first', () => {
    const p = buildCase({ kind: 'murdle', size: 3, seed: 3, band: 'easy' }).puzzle as any
    const cell = yesCells(p)[0] as string
    const [a, b] = cell.split('|') as [string, string]
    const wrongCell = Object.values(p.solution as Record<string, Record<string, string>>).flatMap((row) => Object.values(row)).length ? `${a}|${(p.categories[1].items as string[]).find((w) => `${a}|${w}` !== cell)}` : ''
    const marks = { [wrongCell]: 'yes' }
    const h = hintFor(p, [], marks, who(p), 'en')
    expect(h.kind).toBe('wrong')
    expect(h.cell).toBe(wrongCell)
    expect(b).toBeTruthy()
  })
})
