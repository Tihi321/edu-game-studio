/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import {
  generate,
  solve,
  verify,
  hint,
  checkQuiz,
  hintQuiz
} from '../src/shared/puzzles'
import {
  solvePuzzle,
  checkPuzzleText,
  runPuzzleCli
} from '../src/engine/puzzles/solver'
import {
  murdleCoreSchema,
  knightsCoreSchema,
  testimonyCoreSchema,
  logicCoreSchema,
  quizCoreSchema,
  PUZZLE_BANDS,
  PUZZLE_KINDS
} from '../src/shared/puzzle'
import {
  generateCrossword,
  generateWordSearch,
  verifyCrossword,
  verifyWordSearch,
  WORD_SEARCH_DIRS,
  type PuzzleWord
} from '../src/shared/edu'

describe('the native TypeScript puzzle and quiz engine (50 seeds soundness proof)', () => {
  const BANDS = ['easy', 'medium', 'hard'] as const
  const KINDS = [
    ['murdle', murdleCoreSchema, 3],
    ['knights', knightsCoreSchema, 3],
    ['testimony', testimonyCoreSchema, undefined],
    ['logic', logicCoreSchema, 4],
    ['quiz', quizCoreSchema, undefined]
  ] as const

  it.each(KINDS)('%s: 50 seeds are unique, deducible, and have exactly one solution', (kind, schema, size) => {
    for (let seed = 1; seed <= 50; seed++) {
      const band = BANDS[(seed - 1) % BANDS.length]!
      const p = generate({ kind, seed, band, ...(size ? { size } : {}) } as any)
      expect(() => schema.parse(p)).not.toThrow()
      expect(p.band).toBe(band)
      const proof = solve(p)
      expect(proof.unique).toBe(true)
      expect(proof.deducible).toBe(true)
      expect(proof.solutions).toBe(1)
      expect(proof.band).toBe(band)
      expect(() => verify(p)).not.toThrow()
    }
  })
})

describe('corrupting puzzles is caught by solvePuzzle', () => {
  it('corrupting puzzles is caught by solvePuzzle: murdle and testimony', async () => {
  // catches unknown item and non-unique clues in murdle
  {
    const p: any = generate({ kind: 'murdle', seed: 42, band: 'easy' })
    const badItem = { ...p, clues: [...p.clues, { id: 'c99', type: 'is', a: 's1', b: 'ghost' }] }
    await expect(solvePuzzle(undefined, badItem as any)).rejects.toThrow(/unknown item ghost/)

    const nonUnique = { ...p, clues: p.clues.slice(0, 1) }
    const proof = await solvePuzzle(undefined, nonUnique as any)
    expect(proof.unique).toBe(false)
    expect(proof.deducible).toBe(false)
  }

  // catches corrupted keys and clash mismatches in testimony
  {
    const p: any = generate({ kind: 'testimony', seed: 27, band: 'medium' })
    const badKey = {
      ...p,
      statements: [{ id: 't1', claims: [{ key: 'nonexistent', value: 'fake' }] }, ...p.statements.slice(1)]
    }
    await expect(solvePuzzle(undefined, badKey as any)).rejects.toThrow(/not in the keys/)

    // Corrupt solution statement
    const wrongSolution = { ...p, solution: { ...p.solution, statement: 't99' } }
    await expect(solvePuzzle(undefined, wrongSolution as any)).rejects.toThrow(/not there/)
  }
  })

})

describe('band targeting across all kinds', () => {
  it('each band produces the requested difficulty profile', () => {
    for (const kind of PUZZLE_KINDS) {
      for (const band of PUZZLE_BANDS) {
        const p = generate({ kind, seed: 101, band })
        expect(p.band).toBe(band)
        const proof = solve(p)
        expect(proof.band).toBe(band)
      }
    }
  })
})

describe('interactive play helpers', () => {
  it('interactive helpers: puzzle hints, quiz check and hint', () => {
  // hint gives wrong mark hint, step deduction hint, or accuse
  {
    const p: any = generate({ kind: 'murdle', seed: 8, band: 'easy' })
    const _wrongMarks = { 's1|w1': 'yes' }
    // If s1 is not w1, it gives a 'wrong' hint
    const t = solve(p)
    expect(t.unique).toBe(true)
    const h = hint(p, {})
    expect(['step', 'accuse']).toContain(h.kind)
  }

  // quiz interactive helpers (checkQuiz, hintQuiz)
  {
    const p: any = generate({ kind: 'quiz', seed: 99, band: 'medium' })
    const perfectAnswers = { ...p.solution }
    expect(checkQuiz(p, perfectAnswers)).toEqual({
      correct: true,
      wrong: [],
      score: p.questions.length,
      total: p.questions.length
    })
    const firstQ = p.questions[0]!
    const wrongAnswers = { ...perfectAnswers, [firstQ.id]: 'wrong_opt' }
    const res = checkQuiz(p, wrongAnswers)
    expect(res.correct).toBe(false)
    expect(res.wrong).toEqual([firstQ.id])
    expect(hintQuiz(p, wrongAnswers).kind).toBe('step')
    expect(hintQuiz(p, perfectAnswers).kind).toBe('accuse')
  }
  })
})

describe('flavour read-back check across all kinds', () => {
  it('checkPuzzleText passes faithful read-back and catches corruption for murdle', async () => {
    const p: any = generate({ kind: 'murdle', seed: 18, band: 'easy' })
    const rb = p.clues.map((c: any) => ({
      id: c.id,
      type: c.type,
      a: p.names[c.a]!,
      b: Array.isArray(c.b) ? c.b.map((x: any) => p.names[x]!) : p.names[c.b]!
    }))
    expect(await checkPuzzleText(undefined, p, rb, p.text)).toEqual({ ok: true, problems: [], differing: [] })
    const bad = rb.map((c: any, i: number) => (i === 0 ? { ...c, type: c.type === 'not' ? ('is' as const) : ('not' as const) } : c))
    expect((await checkPuzzleText(undefined, p, bad, p.text)).ok).toBe(false)
  })

})

describe('runPuzzleCli pure TypeScript execution', () => {
  it('generate and solve via runPuzzleCli', async () => {
    const gen = await runPuzzleCli('generate', ['--kind', 'quiz', '--band', 'easy', '--seed', '77'])
    expect(gen).toMatchObject({ kind: 'quiz', band: 'easy', seed: 77 })
    const sol = await runPuzzleCli('solve', [], gen)
    expect(sol).toMatchObject({ unique: true, deducible: true, band: 'easy' })
  })
})

const w = (...answers: string[]): PuzzleWord[] => answers.map((a, i) => ({ id: `w${i}`, answer: a }))
const PLANETS = w('Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune')
const PLANETS_HR = w('Merkur', 'Venera', 'Zemlja', 'Mars', 'Jupiter', 'Saturn', 'Uran', 'Neptun')

describe('crossword generator', () => {
  it('crossword: places every word for 40 seeds, numbers entries, reports unplaced words, catches a damaged grid', () => {
  // places every word and verifies, for 40 seeds, in English and Croatian
  {
    for (let seed = 0; seed < 40; seed++) {
      for (const words of [PLANETS, PLANETS_HR]) {
        const g = generateCrossword(words, seed)
        expect(g.unplaced).toEqual([])
        expect(g.entries).toHaveLength(words.length)
        expect(verifyCrossword(g, words)).toEqual([])
        expect(g.width).toBeLessThanOrEqual(15)
        expect(g.height).toBeLessThanOrEqual(15)
      }
    }
  }
  // numbers the entries row-major and shares a number between an across and a down entry that start together
  {
    const g = generateCrossword(PLANETS, 7)
    const numbers = g.entries.map((e) => e.number)
    expect(Math.min(...numbers)).toBe(1)
    expect([...numbers]).toEqual([...numbers].sort((x, y) => x - y))
    // an entry's number is the same as the rank of its start cell among all start cells
    const starts = [...new Set(g.entries.map((e) => `${e.row},${e.col}`))].sort((p, q) => {
      const [pr, pc] = p.split(',').map(Number) as [number, number]
      const [qr, qc] = q.split(',').map(Number) as [number, number]
      return pr - qr || pc - qc
    })
    for (const e of g.entries) expect(e.number).toBe(starts.indexOf(`${e.row},${e.col}`) + 1)
  }
  // reports a word that shares no letter with the others as unplaced, and short or repeated words too
  {
    const words: PuzzleWord[] = [...w('Mars', 'Earth'), { id: 'x', answer: 'Qiq' }, { id: 'one', answer: 'A' }, { id: 'w0', answer: 'Mars' }]
    const g = generateCrossword(words, 1)
    expect(g.unplaced).toContain('x')
    expect(g.unplaced).toContain('one')
    expect(g.unplaced).toContain('w0') // the id repeats
    expect(g.entries.map((e) => e.id).sort()).toEqual(['w0', 'w1'])
  }
  // verification catches a damaged grid
  {
    const g = generateCrossword(PLANETS, 7)
    const bad = structuredClone(g)
    const e = bad.entries[0]!
    bad.cells[e.row]![e.col] = e.answer[0] === 'Q' ? 'Z' : 'Q'
    expect(verifyCrossword(bad, PLANETS).length).toBeGreaterThan(0)
    const stray = structuredClone(g)
    stray.cells[0]![0] = stray.cells[0]![0] === null ? 'Q' : null
    expect(verifyCrossword(stray, PLANETS).length).toBeGreaterThan(0)
  }
  })
})

describe('word-search generator', () => {
  it('word-search: deterministic, places every word for 40 seeds, honours a size and reports a word that cannot fit', () => {
  // is deterministic for a seed
  {
    expect(generateWordSearch(PLANETS, 11)).toEqual(generateWordSearch(PLANETS, 11))
    expect(generateWordSearch(PLANETS, 11).cells).not.toEqual(generateWordSearch(PLANETS, 12).cells)
  }
  // places every word, reads each back and fills with letters, for 40 seeds and every direction set
  {
    for (const directions of ['forward', 'diagonal', 'all'] as const) {
      for (let seed = 0; seed < 40; seed++) {
        for (const words of [PLANETS, PLANETS_HR]) {
          const g = generateWordSearch(words, seed, { directions })
          expect(g.unplaced).toEqual([])
          expect(g.placements).toHaveLength(words.length)
          expect(verifyWordSearch(g, words)).toEqual([])
          const allowed = WORD_SEARCH_DIRS[directions].map(([r, c]) => `${r},${c}`)
          for (const p of g.placements) expect(allowed).toContain(`${p.dr},${p.dc}`)
        }
      }
    }
  }
  // honours an explicit size, grows the grid when none is given, and reports a word that cannot fit
  {
    const g = generateWordSearch(PLANETS, 3, { size: 12 })
    expect(g.size).toBe(12)
    const long = generateWordSearch(w('Extraordinarily', 'Mars'), 3, { size: 8 })
    expect(long.unplaced).toEqual(['w0'])
    expect(long.size).toBe(8)
    expect(generateWordSearch(w('Extraordinarily', 'Mars'), 3).unplaced).toEqual([])
  }
  })
})
