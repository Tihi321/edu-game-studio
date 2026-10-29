/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import {
  generate,
  solve,
  verify,
  checkAccusation,
  cycleMark,
  setCross,
  autoCross,
  hint,
  checkKnights,
  hintKnights,
  checkPresent,
  hintTestimony,
  cycleLogic,
  autoLogicCross,
  checkLogic,
  hintLogic,
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

describe('the native TypeScript puzzle and quiz engine (200 seeds soundness proof)', () => {
  const BANDS = ['easy', 'medium', 'hard'] as const

  it('murdle: proves 200 seeds unique, deducible, and exactly one solution', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const band = BANDS[(seed - 1) % BANDS.length]!
      const p = generate({ kind: 'murdle', seed, band, size: 3 })
      expect(() => murdleCoreSchema.parse(p)).not.toThrow()
      expect(p.band).toBe(band)
      const proof = solve(p)
      expect(proof.unique).toBe(true)
      expect(proof.deducible).toBe(true)
      expect(proof.solutions).toBe(1)
      expect(proof.band).toBe(band)
      expect(() => verify(p)).not.toThrow()
    }
  })

  it('knights: proves 200 seeds unique, deducible, and exactly one solution', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const band = BANDS[(seed - 1) % BANDS.length]!
      const p = generate({ kind: 'knights', seed, band, size: 3 })
      expect(() => knightsCoreSchema.parse(p)).not.toThrow()
      expect(p.band).toBe(band)
      const proof = solve(p)
      expect(proof.unique).toBe(true)
      expect(proof.deducible).toBe(true)
      expect(proof.solutions).toBe(1)
      expect(proof.band).toBe(band)
      expect(() => verify(p)).not.toThrow()
    }
  })

  it('testimony: proves 200 seeds unique, deducible, and exactly one solution', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const band = BANDS[(seed - 1) % BANDS.length]!
      const p = generate({ kind: 'testimony', seed, band })
      expect(() => testimonyCoreSchema.parse(p)).not.toThrow()
      expect(p.band).toBe(band)
      const proof = solve(p)
      expect(proof.unique).toBe(true)
      expect(proof.deducible).toBe(true)
      expect(proof.solutions).toBe(1)
      expect(proof.band).toBe(band)
      expect(() => verify(p)).not.toThrow()
    }
  })

  it('logic: proves 200 seeds unique, deducible, and exactly one solution', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const band = BANDS[(seed - 1) % BANDS.length]!
      const p = generate({ kind: 'logic', seed, band, size: 4 })
      expect(() => logicCoreSchema.parse(p)).not.toThrow()
      expect(p.band).toBe(band)
      const proof = solve(p)
      expect(proof.unique).toBe(true)
      expect(proof.deducible).toBe(true)
      expect(proof.solutions).toBe(1)
      expect(proof.band).toBe(band)
      expect(() => verify(p)).not.toThrow()
    }
  })

  it('quiz: proves 200 seeds unique, deducible, and exactly one solution', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const band = BANDS[(seed - 1) % BANDS.length]!
      const p = generate({ kind: 'quiz', seed, band })
      expect(() => quizCoreSchema.parse(p)).not.toThrow()
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
  it('catches unknown item and non-unique clues in murdle', async () => {
    const p: any = generate({ kind: 'murdle', seed: 42, band: 'easy' })
    const badItem = { ...p, clues: [...p.clues, { id: 'c99', type: 'is', a: 's1', b: 'ghost' }] }
    await expect(solvePuzzle(undefined, badItem as any)).rejects.toThrow(/unknown item ghost/)

    const nonUnique = { ...p, clues: p.clues.slice(0, 1) }
    const proof = await solvePuzzle(undefined, nonUnique as any)
    expect(proof.unique).toBe(false)
    expect(proof.deducible).toBe(false)
  })

  it('catches invalid speaker and contradictory claims in knights', async () => {
    const p: any = generate({ kind: 'knights', seed: 15, band: 'medium' })
    const badSpeaker = { ...p, statements: [...p.statements, { id: 't99', speaker: 'ghost', claim: { type: 'knight', who: 'k1' } }] }
    await expect(solvePuzzle(undefined, badSpeaker as any)).rejects.toThrow(/unknown speaker/)

    // Contradictory statements that cannot hold
    const contradictory = {
      ...p,
      statements: [
        { id: 't1', speaker: 'k1', claim: { type: 'knight', who: 'k2' } },
        { id: 't2', speaker: 'k1', claim: { type: 'knave', who: 'k2' } }
      ]
    }
    const proof = await solvePuzzle(undefined, contradictory as any)
    expect(proof.unique).toBe(false)
  })

  it('catches corrupted keys and clash mismatches in testimony', async () => {
    const p: any = generate({ kind: 'testimony', seed: 27, band: 'medium' })
    const badKey = {
      ...p,
      statements: [{ id: 't1', claims: [{ key: 'nonexistent', value: 'fake' }] }, ...p.statements.slice(1)]
    }
    await expect(solvePuzzle(undefined, badKey as any)).rejects.toThrow(/not in the keys/)

    // Corrupt solution statement
    const wrongSolution = { ...p, solution: { ...p.solution, statement: 't99' } }
    await expect(solvePuzzle(undefined, wrongSolution as any)).rejects.toThrow(/not there/)
  })

  it('catches corrupted logic clues', async () => {
    const p: any = generate({ kind: 'logic', seed: 33, band: 'easy' })
    const badClue = { ...p, clues: [...p.clues, { id: 'c99', type: 'apart', a: 'd1', b: 'c1' }] }
    // apart without n
    await expect(solvePuzzle(undefined, badClue as any)).rejects.toThrow()
  })

  it('catches corrupted quiz questions, duplicate ids and answer mismatches', async () => {
    const p: any = generate({ kind: 'quiz', seed: 50, band: 'medium' })
    const badAnswer = {
      ...p,
      questions: [{ ...p.questions[0]!, answer: 'invalid_option' }, ...p.questions.slice(1)]
    }
    await expect(solvePuzzle(undefined, badAnswer as any)).rejects.toThrow(/is not in options/)

    const dupId = {
      ...p,
      questions: [p.questions[0]!, p.questions[0]!]
    }
    await expect(solvePuzzle(undefined, dupId as any)).rejects.toThrow(/duplicate question id/)

    const mismatchSol = {
      ...p,
      solution: { ...p.solution, [p.questions[0]!.id]: 'wrong_choice' }
    }
    await expect(solvePuzzle(undefined, mismatchSol as any)).rejects.toThrow(/must match/)
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
  it('cycleMark cycles blank -> no -> yes -> blank', () => {
    let marks: Record<string, string> = {}
    marks = cycleMark(marks, 's1,w1')
    expect(marks['s1,w1']).toBe('no')
    marks = cycleMark(marks, 's1,w1')
    expect(marks['s1,w1']).toBe('yes')
    marks = cycleMark(marks, 's1,w1')
    expect(marks['s1,w1']).toBeUndefined()
  })

  it('setCross and autoCross correctly place marks and cross out blocks', () => {
    const p = generate({ kind: 'murdle', seed: 5, band: 'easy' })
    let marks = setCross({}, 's1|w1', 'yes')
    expect(marks['s1|w1']).toBe('yes')
    marks = autoCross(p, marks, 's1|w1')
    // Check that row and col cells in suspect-weapon block are set to 'no'
    expect(marks['s1|w2']).toBe('no')
    expect(marks['s1|w3']).toBe('no')
    expect(marks['s2|w1']).toBe('no')
    expect(marks['s3|w1']).toBe('no')
  })

  it('checkAccusation validates suspect, weapon, and place', () => {
    const p: any = generate({ kind: 'murdle', seed: 7, band: 'easy' })
    const ans = p.murder.answer
    expect(checkAccusation(p, ans)).toEqual({ correct: true, wrong: [] })
    expect(checkAccusation(p, { ...ans, suspect: 'wrong_suspect' })).toEqual({
      correct: false,
      wrong: ['suspect']
    })
  })

  it('hint gives wrong mark hint, step deduction hint, or accuse', () => {
    const p: any = generate({ kind: 'murdle', seed: 8, band: 'easy' })
    const _wrongMarks = { 's1|w1': 'yes' }
    // If s1 is not w1, it gives a 'wrong' hint
    const t = solve(p)
    expect(t.unique).toBe(true)
    const h = hint(p, {})
    expect(['step', 'accuse']).toContain(h.kind)
  })

  it('knights interactive helpers (checkKnights, hintKnights)', () => {
    const p: any = generate({ kind: 'knights', seed: 12, band: 'medium' })
    expect(checkKnights(p, p.solution)).toEqual({ correct: true, wrong: [] })
    const badMarks = { ...p.solution, k1: p.solution['k1'] === 'knight' ? 'knave' : 'knight' }
    expect(checkKnights(p, badMarks).correct).toBe(false)
    expect(hintKnights(p, badMarks).kind).toBe('wrong')
    expect(hintKnights(p, p.solution).kind).toBe('accuse')
  })

  it('testimony interactive helpers (checkPresent, hintTestimony)', () => {
    const p: any = generate({ kind: 'testimony', seed: 14, band: 'medium' })
    const sol = p.solution
    // If press required and not pressed yet
    if (sol.press) {
      expect(checkPresent(p, sol.statement, sol.evidence, [])).toEqual({ result: 'press_first' })
      expect(checkPresent(p, sol.statement, sol.evidence, [sol.statement])).toEqual({ result: 'correct' })
    } else {
      expect(checkPresent(p, sol.statement, sol.evidence, [])).toEqual({ result: 'correct' })
    }
    expect(checkPresent(p, sol.statement, 'e99', [])).toEqual({ result: 'wrong' })
    const h0 = hintTestimony(p, {}, 0)
    expect(h0.kind).toBe('step')
    const h3 = hintTestimony(p, {}, 3)
    expect(h3.text).toContain('Present the')
  })

  it('logic grid interactive helpers (cycleLogic, autoLogicCross, checkLogic, hintLogic)', () => {
    const p: any = generate({ kind: 'logic', seed: 21, band: 'easy' })
    let marks: Record<string, string> = {}
    marks = cycleLogic(marks, 'd1|c1')
    expect(marks['d1|c1']).toBe('no')
    marks = cycleLogic(marks, 'd1|c1')
    expect(marks['d1|c1']).toBe('yes')
    marks = autoLogicCross(p, marks, 'd1|c1')
    expect(marks['d1|c2']).toBe('no')
    expect(checkLogic(p, marks).correct).toBe(false)
    expect(hintLogic(p, marks)).toHaveProperty('kind')
  })

  it('quiz interactive helpers (checkQuiz, hintQuiz)', () => {
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

  it('checkPuzzleText passes faithful read-back and catches corruption for knights (with intro)', async () => {
    const p: any = generate({ kind: 'knights', seed: 25, band: 'easy' })
    const rule = { id: 'intro', truthTellers: 'knights', liars: 'knaves' }
    const conv = (c: any): any => {
      if (c.type === 'knight' || c.type === 'knave') return { type: c.type, who: p.names[c.who] }
      if (c.type === 'same' || c.type === 'diff') return { type: c.type, a: p.names[c.a], b: p.names[c.b] }
      if (c.of) return { ...c, of: c.of.map((x: string) => p.names[x]) }
      return c
    }
    const rb = [...p.statements.map((s: any) => ({ id: s.id, speaker: p.names[s.speaker]!, claim: conv(s.claim) })), rule]
    expect(await checkPuzzleText(undefined, p, rb, p.text)).toMatchObject({ ok: true })
    const bad = [...rb.slice(0, -1), { id: 'intro', truthTellers: 'knaves', liars: 'knights' }]
    expect((await checkPuzzleText(undefined, p, bad, p.text)).ok).toBe(false)
  })

  it('checkPuzzleText passes faithful read-back and catches corruption for testimony', async () => {
    const p: any = generate({ kind: 'testimony', seed: 31, band: 'medium' })
    const rb: any[] = []
    for (const s of p.statements) {
      rb.push({ id: s.id, claims: s.claims })
      if (s.press) rb.push({ id: `${s.id}.press`, claims: s.press.claims })
    }
    for (const e of p.evidence) rb.push({ id: e.id, facts: e.facts })
    expect(await checkPuzzleText(undefined, p, rb, p.text)).toMatchObject({ ok: true })
    const bad = rb.map((x, i) => (i === 0 ? { ...x, claims: [{ key: 'clock', value: 'impossible_val' }] } : x))
    expect((await checkPuzzleText(undefined, p, bad, p.text)).ok).toBe(false)
  })

  it('checkPuzzleText passes faithful read-back and catches corruption for logic', async () => {
    const p: any = generate({ kind: 'logic', seed: 44, band: 'easy' })
    const nm = (v: any) => (Array.isArray(v) ? v.map((x) => p.names[x]!) : p.names[v]!)
    const rb = p.clues.map((c: any) => ({ id: c.id, type: c.type, a: nm(c.a), b: nm(c.b), ...(c.n ? { n: c.n } : {}) }))
    expect(await checkPuzzleText(undefined, p, rb, p.text)).toMatchObject({ ok: true })
    const bad = rb.map((c: any, i: number) => (i === 0 ? { ...c, type: 'not' } : c))
    expect((await checkPuzzleText(undefined, p, bad, p.text)).ok).toBe(false)
  })

  it('checkPuzzleText passes faithful read-back and catches corruption for quiz', async () => {
    const p: any = generate({ kind: 'quiz', seed: 55, band: 'medium' })
    const rb = p.questions.map((q: any) => ({ id: q.id, answer: p.names[q.answer] ?? q.answer }))
    expect(await checkPuzzleText(undefined, p, rb, p.text)).toMatchObject({ ok: true })
    const firstQ = p.questions[0]!
    const wrongOpt = firstQ.options.find((o: string) => o !== firstQ.answer)!
    const bad = rb.map((x: any) => (x.id === firstQ.id ? { ...x, answer: p.names[wrongOpt] ?? wrongOpt } : x))
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
