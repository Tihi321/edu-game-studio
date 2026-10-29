/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Knights and Knaves: some speakers always tell the truth (knights), others always lie (knaves).
 */

import { SeededRandom } from './prng'
import { FORMAT, BANDS, PuzzleError } from './model'
import type { Band } from './model'
import type { KnightsClaim, KnightsCore, PuzzleStep } from '../puzzle'

export const KNIGHT = 'knight'
export const KNAVE = 'knave'
const WEIGHTS: Record<string, number> = { direct: 1, split: 4 }
export const KNIGHTS_WEIGHTS = WEIGHTS
export const RULES_KK = ['direct', 'split'] as const
export const NAMES = ['Aldo', 'Brin', 'Cass', 'Dara', 'Evo']

export const CLAIMS = [
  'knight',
  'knave',
  'same',
  'diff',
  'some_knave',
  'all_knight',
  'exactly',
  'not',
  'and',
  'or'
] as const

export function claimVars(c: KnightsClaim | any): Set<string> {
  const t = c.type
  if (t === 'knight' || t === 'knave') return new Set([c.who])
  if (t === 'same' || t === 'diff') return new Set([c.a, c.b])
  if (t === 'some_knave' || t === 'all_knight' || t === 'exactly') return new Set(c.of)
  if (t === 'not') return claimVars(c.c)
  if (t === 'and' || t === 'or') {
    const a = claimVars(c.a)
    const b = claimVars(c.b)
    return new Set([...a, ...b])
  }
  throw new PuzzleError(`unknown claim type "${t}"`)
}

export function evalClaim(c: KnightsClaim | any, isKnight: Record<string, boolean>): boolean {
  const t = c.type
  if (t === 'knight') return !!isKnight[c.who]
  if (t === 'knave') return !isKnight[c.who]
  if (t === 'same') return isKnight[c.a] === isKnight[c.b]
  if (t === 'diff') return isKnight[c.a] !== isKnight[c.b]
  if (t === 'some_knave') return c.of.some((x: string) => !isKnight[x])
  if (t === 'all_knight') return c.of.every((x: string) => !!isKnight[x])
  if (t === 'exactly') return c.of.filter((x: string) => !!isKnight[x]).length === c.k
  if (t === 'not') return !evalClaim(c.c, isKnight)
  if (t === 'and') return evalClaim(c.a, isKnight) && evalClaim(c.b, isKnight)
  if (t === 'or') return evalClaim(c.a, isKnight) || evalClaim(c.b, isKnight)
  throw new PuzzleError(`unknown claim type "${t}"`)
}

export const claimTrue = evalClaim

function* _assignments(sp: readonly string[]): Generator<Record<string, boolean>> {
  const n = sp.length
  const total = 1 << n
  for (let mask = 0; mask < total; mask++) {
    const a: Record<string, boolean> = {}
    for (let i = 0; i < n; i++) {
      a[sp[i]!] = (mask & (1 << i)) !== 0
    }
    yield a
  }
}

function _consistent(stmts: any[], a: Record<string, boolean>): boolean {
  return stmts.every((s) => a[s.speaker] === evalClaim(s.claim, a))
}

export function countSolutionsKnights(p: any, limit = 2, statements?: any[]): number {
  const use = statements ?? p.statements
  let n = 0
  for (const a of _assignments(p.speakers)) {
    if (_consistent(use, a)) {
      n++
      if (n >= limit) break
    }
  }
  return n
}
const countSolutions = countSolutionsKnights

export function solutionOf(p: any): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(p.solution)) {
    out[k] = v === KNIGHT
  }
  return out
}

function _local(stmt: any, state: Record<string, boolean>): [Record<string, boolean>[], string[]] {
  const vars = Array.from(new Set([stmt.speaker, ...claimVars(stmt.claim)])).sort()
  const unknown = vars.filter((v) => state[v] === undefined)
  const out: Record<string, boolean>[] = []
  const total = 1 << unknown.length
  for (let mask = 0; mask < total; mask++) {
    const a: Record<string, boolean> = {}
    for (const v of vars) {
      if (state[v] !== undefined) a[v] = state[v]!
    }
    for (let i = 0; i < unknown.length; i++) {
      a[unknown[i]!] = (mask & (1 << i)) !== 0
    }
    if (a[stmt.speaker] === evalClaim(stmt.claim, a)) {
      out.push(a)
    }
  }
  return [out, unknown]
}

function _propagate(stmts: any[], state: Record<string, boolean>, steps: any[] | null): string | null {
  let changed = true
  while (changed) {
    changed = false
    for (const s of stmts) {
      const [sols, unknown] = _local(s, state)
      if (sols.length === 0) return s.id
      for (const v of unknown) {
        const vals = new Set(sols.map((a) => a[v]))
        if (vals.size === 1) {
          const val = vals.values().next().value!
          state[v] = val
          if (steps !== null) {
            steps.push({
              rule: 'direct',
              statement: s.id,
              who: v,
              value: val ? KNIGHT : KNAVE
            })
          }
          changed = true
        }
      }
    }
  }
  return null
}

function _result(p: any, state: Record<string, boolean>, steps: any[], solved: boolean): any {
  const rules: Record<string, number> = {}
  for (const s of steps) {
    rules[s.rule] = (rules[s.rule] ?? 0) + 1
  }
  const score = Object.entries(rules).reduce((acc, [r, n]) => acc + (WEIGHTS[r] ?? 1) * n, 0)
  return {
    solved: solved && Object.keys(state).length === p.speakers.length,
    steps,
    rules,
    score,
    splits: rules['split'] ?? 0
  }
}

export function deduceKnights(p: any, statements?: any[]): any {
  const use = statements ?? p.statements
  const steps: any[] = []
  const state: Record<string, boolean> = {}
  if (_propagate(use, state, steps) !== null) {
    return _result(p, state, steps, false)
  }
  while (Object.keys(state).length < p.speakers.length) {
    let decided = false
    const remaining = p.speakers.filter((x: string) => state[x] === undefined)
    for (const v of remaining) {
      const bad: Record<string, string | null> = {}
      for (const val of [true, false]) {
        const trial = { ...state, [v]: val }
        bad[String(val)] = _propagate(use, trial, null)
      }
      if (bad['true'] !== null && bad['false'] !== null) {
        return _result(p, state, steps, false)
      }
      if (bad['true'] !== null || bad['false'] !== null) {
        const wrong = bad['true'] !== null
        state[v] = !wrong
        steps.push({
          rule: 'split',
          who: v,
          value: !wrong ? KNIGHT : KNAVE,
          contradicts: wrong ? KNIGHT : KNAVE,
          statement: bad[String(wrong)]
        })
        if (_propagate(use, state, steps) !== null) {
          return _result(p, state, steps, false)
        }
        decided = true
        break
      }
    }
    if (!decided) {
      return _result(p, state, steps, false)
    }
  }
  const sol = solutionOf(p)
  const isCorrect = p.speakers.every((k: string) => state[k] === sol[k])
  return _result(p, state, steps, isCorrect)
}
const deduce = deduceKnights

export function deduceFastKnights(p: any, statements?: any[]): boolean {
  const use = statements ?? p.statements
  return deduceKnights(p, use).solved
}
const _deduceFast = deduceFastKnights

export function bandOfKnights(res: any): Band {
  const s = res.splits ?? 0
  return s === 0 ? 'easy' : s === 1 ? 'medium' : 'hard'
}
const bandOf = bandOfKnights

export function validateKnights(p: any): void {
  if (p.format !== undefined && p.format !== FORMAT) {
    throw new PuzzleError(`unknown puzzle format ${p.format}`)
  }
  if (p.kind !== 'knights') {
    throw new PuzzleError('not a knights puzzle')
  }
  const sp = p.speakers || []
  if (sp.length < 2 || sp.length > 5 || new Set(sp).size !== sp.length) {
    throw new PuzzleError('a Knights and Knaves puzzle has 2 to 5 different speakers')
  }
  for (const k of sp) {
    if (p.solution?.[k] !== KNIGHT && p.solution?.[k] !== KNAVE) {
      throw new PuzzleError(`the solution has no knight or knave for ${k}`)
    }
  }
  const ids = new Set<string>()
  for (const s of p.statements || []) {
    if (ids.has(s.id)) throw new PuzzleError(`statement ${s.id} is listed twice`)
    ids.add(s.id)
    if (!sp.includes(s.speaker)) {
      throw new PuzzleError(`statement ${s.id} has an unknown speaker ${s.speaker}`)
    }
    for (const v of claimVars(s.claim)) {
      if (!sp.includes(v)) {
        throw new PuzzleError(`statement ${s.id} names the unknown speaker ${v}`)
      }
    }
  }
}

export function solveKnights(p: any): {
  unique: boolean
  solutions: number
  deducible: boolean
  band: Band | null
  steps: PuzzleStep[]
  score: number
  rules: Record<string, number>
} {
  validateKnights(p)
  const n = countSolutions(p, 2)
  const res = deduce(p)
  return {
    unique: n === 1,
    solutions: n,
    deducible: res.solved,
    band: res.solved ? bandOf(res) : null,
    steps: res.steps,
    score: res.score,
    rules: res.rules
  }
}

export function verifyKnights(p: any): any {
  validateKnights(p)
  const a = solutionOf(p)
  for (const s of p.statements) {
    if (a[s.speaker] !== evalClaim(s.claim, a)) {
      throw new PuzzleError(`statement ${s.id} does not hold in the solution`)
    }
  }
  if (countSolutions(p, 2) !== 1) {
    throw new PuzzleError('the puzzle does not have exactly one solution')
  }
  const res = deduce(p)
  if (!res.solved) {
    throw new PuzzleError('the puzzle cannot be solved without guessing')
  }
  return res
}

function _list(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]!
}

function _lower(s: string): string {
  const firstWord = s.split(' ')[0]
  if (['At', 'All', 'Exactly', 'It', 'Either'].includes(firstWord ?? '')) {
    return s[0]!.toLowerCase() + s.slice(1)
  }
  return s
}

export function renderClaim(p: any, c: any, nm: Record<string, string>): string {
  const t = c.type
  let of = ''
  if (c.of) {
    const isAll = c.of.length === p.speakers.length && c.of.every((x: string) => p.speakers.includes(x))
    of = isAll ? 'us' : _list(c.of.map((x: string) => nm[x]!))
  }
  if (t === 'knight') return `${nm[c.who]} is a knight`
  if (t === 'knave') return `${nm[c.who]} is a knave`
  if (t === 'same') return `${nm[c.a]} and ${nm[c.b]} are the same kind`
  if (t === 'diff') return `${nm[c.a]} and ${nm[c.b]} are different kinds`
  if (t === 'some_knave') return `At least one of ${of} is a knave`
  if (t === 'all_knight') return `All of ${of} are knights`
  if (t === 'exactly') return `Exactly ${c.k} of ${of} ${c.k === 1 ? 'is a knight' : 'are knights'}`
  if (t === 'not') return `It is not true that ${_lower(renderClaim(p, c.c, nm))}`
  if (t === 'and') return `${renderClaim(p, c.a, nm)}, and ${_lower(renderClaim(p, c.b, nm))}`
  if (t === 'or') return `Either ${_lower(renderClaim(p, c.a, nm))}, or ${_lower(renderClaim(p, c.b, nm))}`
  throw new PuzzleError(`no sentence for a ${t} claim`)
}

export const claimText = renderClaim

export function statementText(p: any, s: any, nm: Record<string, string>): string {
  return `${nm[s.speaker]} says: "${renderClaim(p, s.claim, nm)}."`
}

export function defaultKnightsNames(p: any): Record<string, string> {
  const have = p.names ?? {}
  const out: Record<string, string> = {}
  for (let i = 0; i < p.speakers.length; i++) {
    const k = p.speakers[i]!
    out[k] = have[k] ?? (i < NAMES.length ? NAMES[i]! : k)
  }
  return out
}
const defaultNames = defaultKnightsNames

export function fillKnights(p: any, names?: Record<string, string>): any {
  const nm = names ? { ...names } : defaultKnightsNames(p)
  p.names = nm
  p.text = {}
  for (const s of p.statements) {
    p.text[s.id] = statementText(p, s, nm)
  }
  p.text.intro = 'On this island knights always tell the truth and knaves always lie. Who is a knight and who is a knave?'
  return p
}

export function renderAllKnights(p: any, names?: Record<string, string>): { names: Record<string, string>; text: Record<string, string> } {
  const q = { ...p }
  delete q.text
  delete q.names
  fillKnights(q, names)
  return { names: q.names, text: q.text }
}

export function stepTextKnights(p: any, step: any, nm: Record<string, string>): string {
  const sid = step.statement
  const st = p.statements?.find((s: any) => s.id === sid)
  const quote = st ? p.text?.[sid] ?? statementText(p, st, nm) : ''
  const who = nm[step.who] ?? step.who
  if (step.rule === 'direct') {
    return `Look at what ${st ? nm[st.speaker] : who} says: ${quote} Given what is known, only one case fits: ${who} is a ${step.value}.`
  }
  const owner = st ? nm[st.speaker] : 'one of the statements'
  return `Suppose ${who} were a ${step.contradicts}. Following the statements, what ${owner} says cannot hold. So ${who} is a ${step.value}.`
}
const stepText = stepTextKnights

function _subsets(rng: SeededRandom, sp: string[], lo = 2): string[][] {
  const out: string[][] = []
  for (let r = lo; r <= sp.length; r++) {
    const total = 1 << sp.length
    for (let mask = 0; mask < total; mask++) {
      let count = 0
      for (let i = 0; i < sp.length; i++) if (mask & (1 << i)) count++
      if (count === r) {
        const combo: string[] = []
        for (let i = 0; i < sp.length; i++) {
          if (mask & (1 << i)) combo.push(sp[i]!)
        }
        out.push(combo)
      }
    }
  }
  rng.shuffle(out)
  return out.slice(0, 8)
}

function _claims(rng: SeededRandom, sp: string[], band: string): any[] {
  const pool: any[] = []
  for (const x of sp) {
    pool.push({ type: 'knight', who: x })
    pool.push({ type: 'knave', who: x })
  }
  for (let i = 0; i < sp.length; i++) {
    for (let j = i + 1; j < sp.length; j++) {
      pool.push({ type: 'same', a: sp[i]!, b: sp[j]! })
      pool.push({ type: 'diff', a: sp[i]!, b: sp[j]! })
    }
  }
  if (band !== 'easy') {
    for (const ofList of _subsets(rng, sp)) {
      pool.push({ type: 'some_knave', of: ofList })
      pool.push({ type: 'all_knight', of: ofList })
      for (let k = 0; k <= ofList.length; k++) {
        pool.push({ type: 'exactly', k, of: ofList })
      }
    }
  }
  if (band === 'hard') {
    const simple = pool.filter((c) => ['knight', 'knave', 'same', 'diff'].includes(c.type))
    for (let i = 0; i < 12; i++) {
      const [a, b] = rng.sample(simple, 2)
      pool.push({ type: rng.choice(['and', 'or']), a, b })
    }
    for (const c of rng.sample(simple, Math.min(4, simple.length))) {
      pool.push({ type: 'not', c })
    }
  }
  rng.shuffle(pool)
  return pool
}

function _withIds(base: any, stmts: any[]): any {
  return {
    ...base,
    statements: stmts.map((s, idx) => ({ ...s, id: `t${idx + 1}` }))
  }
}

export function generateKnights(size = 3, seed = 0, band = 'medium', maxTries = 400): KnightsCore & { names: Record<string, string>; text: Record<string, string> } {
  if (size < 2 || size > 5) {
    throw new PuzzleError(`Knights and Knaves has 2 to 5 speakers, not ${size}`)
  }
  if (!BANDS.includes(band as any)) {
    throw new PuzzleError(`unknown band "${band}" (easy, medium or hard)`)
  }
  const rng = new SeededRandom(`vno-puzzles:knights:${seed}:${band}:${size}`)
  const sp = Array.from({ length: size }, (_, i) => `k${i + 1}`)

  for (let tryCount = 0; tryCount < maxTries; tryCount++) {
    const truth: Record<string, boolean> = {}
    for (const k of sp) truth[k] = rng.random() < 0.5
    if (size >= 3 && (Object.values(truth).every(Boolean) || !Object.values(truth).some(Boolean))) {
      continue
    }
    const cands: any[] = []
    for (const c of _claims(rng, sp, band)) {
      for (const x of sp) {
        if (truth[x] === evalClaim(c, truth) && !((c.type === 'knight' || c.type === 'knave') && c.who === x)) {
          cands.push({ speaker: x, claim: c })
        }
      }
    }
    rng.shuffle(cands)
    const solution: Record<string, 'knight' | 'knave'> = {}
    for (const k of sp) solution[k] = truth[k] ? KNIGHT : KNAVE
    const base: any = {
      format: FORMAT,
      kind: 'knights',
      size,
      seed,
      band,
      speakers: sp,
      solution
    }

    const chosen: any[] = []
    for (const c of cands) {
      chosen.push(c)
      const q = _withIds(base, chosen)
      if (countSolutions(q, 2) === 1) break
    }
    if (countSolutions(_withIds(base, chosen), 2) !== 1) continue

    const keep = [...chosen]
    for (const x of sp) {
      if (!keep.some((c) => c.speaker === x)) {
        const extra = cands.find((c) => c.speaker === x && !keep.includes(c))
        if (extra) keep.push(extra)
      }
    }

    const order = Array.from({ length: keep.length }, (_, i) => i)
    rng.shuffle(order)
    const gone = new Set<number>()
    for (const i of order) {
      const trial = keep.filter((_, idx) => idx !== i && !gone.has(idx))
      if (sp.every((x) => trial.some((c) => c.speaker === x)) && countSolutions(_withIds(base, trial), 2) === 1) {
        gone.add(i)
      }
    }

    const stmts = keep.filter((_, idx) => !gone.has(idx))
    if (new Set(stmts.map((c) => c.speaker)).size !== sp.length) continue

    rng.shuffle(stmts)
    const p = _withIds(base, stmts)
    const res = deduce(p)
    if (!res.solved || bandOf(res) !== band) continue

    p.difficulty = { steps: res.steps.length, score: res.score, rules: res.rules }
    p.steps = res.steps
    return fillKnights(p)
  }

  throw new PuzzleError(`no ${band} knights puzzle found for seed ${seed} in ${maxTries} tries`)
}

export function checkKnights(p: any, marks: Record<string, string>): { correct: boolean; wrong: string[] } {
  const wrong = p.speakers.filter((k: string) => marks[k] !== p.solution[k])
  return { correct: wrong.length === 0, wrong }
}

export function hintKnights(p: any, marks: Record<string, string>): { kind: string; cell: string; text: string } {
  const nm = p.names ?? defaultNames(p)
  const bad = p.speakers.filter((k: string) => marks[k] && marks[k] !== p.solution[k])
  if (bad.length > 0) {
    return { kind: 'wrong', cell: bad[0]!, text: `Look again at ${nm[bad[0]!]}.` }
  }
  for (const step of p.steps) {
    if (marks[step.who] !== step.value) {
      return { kind: 'step', cell: step.who, text: stepText(p, step, nm) }
    }
  }
  return { kind: 'accuse', cell: '', text: 'Everyone is marked. Submit your answer.' }
}

export function isCompleteKnights(p: any, marks: Record<string, string>): boolean {
  return p.speakers.every((k: string) => marks[k] === p.solution[k])
}

function _norm(s: any): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function _readClaim(rc: any, table: Record<string, string>, sp: string[]): any {
  if (!rc || typeof rc !== 'object' || !CLAIMS.includes(rc.type)) {
    throw new Error(`unknown claim type "${rc?.type ?? rc}"`)
  }
  const one = (name: string): string => {
    const i = table[_norm(name)]
    if (!i) throw new Error(`"${name}" is not a speaker of this puzzle`)
    return i
  }
  const t = rc.type
  if (t === 'knight' || t === 'knave') return { type: t, who: one(rc.who) }
  if (t === 'same' || t === 'diff') return { type: t, a: one(rc.a), b: one(rc.b) }
  if (t === 'some_knave' || t === 'all_knight') return { type: t, of: (rc.of || []).map(one) }
  if (t === 'exactly') {
    if (typeof rc.k !== 'number') throw new Error('an exactly claim needs the number k')
    return { type: t, k: rc.k, of: (rc.of || []).map(one) }
  }
  if (t === 'not') return { type: t, c: _readClaim(rc.c, table, sp) }
  return { type: t, a: _readClaim(rc.a, table, sp), b: _readClaim(rc.b, table, sp) }
}

function _claimNames(rc: any, out: string[], groups?: string[]): string[] {
  if (rc && typeof rc === 'object') {
    for (const key of ['who', 'a', 'b']) {
      if (typeof rc[key] === 'string') out.push(rc[key])
    }
    if (Array.isArray(rc.of)) {
      const target = groups ?? out
      for (const x of rc.of) if (typeof x === 'string') target.push(x)
    }
    for (const key of ['c', 'a', 'b']) {
      if (rc[key] && typeof rc[key] === 'object') _claimNames(rc[key], out, groups)
    }
  }
  return out
}

function _checkIntro(r: any, intro: string, bad: (s: any, p: string) => void): [string, string] | null {
  const it = { id: 'intro' }
  if (!r) {
    bad(it, 'the reader gave no rule for the intro: answer {"id": "intro", "truthTellers": ..., "liars": ...}')
    return null
  }
  const tt = r.truthTellers
  const li = r.liars
  if (typeof tt !== 'string' || typeof li !== 'string' || !_norm(tt) || !_norm(li)) {
    bad(it, 'the intro rule needs the words of the prose for those who always tell the truth (truthTellers) and for those who always lie (liars)')
    return null
  }
  const prose = _norm(intro)
  const gone = [tt, li].filter((w) => !prose.includes(_norm(w)))
  if (gone.length > 0) {
    bad(it, `the reader named ${gone.map((w) => `"${w}"`).join(', ')}, which the intro does not contain`)
    return null
  }
  if (_norm(tt) === _norm(li)) {
    bad(it, 'the intro rule gives the same words to those who tell the truth and those who lie')
    return null
  }
  const wordsTt = _norm(tt).split(' ')
  const wordsLi = _norm(li).split(' ')
  if (wordsTt.some((w) => w.startsWith('knave')) || wordsLi.some((w) => w.startsWith('knight'))) {
    bad(it, 'the intro says that knaves tell the truth or that knights lie: knights always tell the truth and knaves always lie')
    return null
  }
  return [tt, li]
}

export function checkKnightsText(p: any, readBack: any[], text?: Record<string, string>): { ok: boolean; problems: any[]; differing: string[] } {
  validateKnights(p)
  const table: Record<string, string> = {}
  for (const [k, name] of Object.entries(p.names ?? {})) {
    table[_norm(name)] = k
    table[_norm(k)] = k
  }
  const byId = new Map<string, any>()
  for (const r of readBack) {
    if (r && r.id) byId.set(r.id, r)
  }

  const problems: { clue: string; problem: string }[] = []
  const differing: string[] = []
  const rebuilt: any[] = []

  function bad(s: any, problem: string): void {
    problems.push({ clue: s.id, problem })
    differing.push(s.id)
  }

  let rule: [string, string] | null = null
  const intro = text?.intro
  if (intro) {
    rule = _checkIntro(byId.get('intro'), intro, bad)
  }

  for (const s of p.statements) {
    const r = byId.get(s.id)
    if (!r) {
      bad(s, 'the reader gave no statement for this one')
      continue
    }
    const sid = table[_norm(r.speaker ?? '')]
    if (!sid) {
      bad(s, `the reader named the speaker "${r.speaker}", who is not a speaker of this puzzle`)
      continue
    }
    let claim: any
    try {
      claim = _readClaim(r.claim, table, p.speakers)
    } catch (e: any) {
      bad(s, e.message)
      continue
    }
    if (text && text[s.id]) {
      const prose = _norm(text[s.id])
      const groups: string[] = []
      const direct = [r.speaker, ..._claimNames(r.claim, [], groups)]
      const saysUs = prose.split(' ').includes('us')
      const appears = (n: string) => {
        const it = table[_norm(n)]
        return prose.includes(_norm(n)) || (it !== undefined && p.names?.[it] && prose.includes(_norm(p.names[it])))
      }
      const checkList = saysUs ? direct : direct.concat(groups)
      const missing = checkList.filter((n) => n && !appears(n))
      if (missing.length > 0) {
        bad(s, `the reader named ${missing.map((n) => `"${n}"`).join(', ')}, which the prose does not contain`)
        continue
      }
    }

    if (rule && r.claim && (r.claim.type === 'knight' || r.claim.type === 'knave')) {
      const prose = text?.[s.id] ? _norm(text[s.id]) : ''
      const hasTruth = prose.includes(_norm(rule[0]))
      const hasLie = prose.includes(_norm(rule[1]))
      const expect = hasTruth && !hasLie ? 'knight' : hasLie && !hasTruth ? 'knave' : null
      if (expect && r.claim.type !== expect) {
        bad(
          s,
          `the statement uses the intro's words for ${expect === 'knight' ? 'those who tell the truth' : 'those who lie'}, but the reader read a ${r.claim.type}: the intro and the statements disagree about who tells the truth`
        )
        continue
      }
    }

    if (sid !== s.speaker) {
      bad(s, 'the prose is said by someone else than the statement says')
      continue
    }

    let same = true
    for (const a of _assignments(p.speakers)) {
      if (evalClaim(s.claim, a) !== evalClaim(claim, a)) {
        same = false
        break
      }
    }
    if (!same) {
      bad(s, 'the prose means something else than the statement')
      continue
    }
    rebuilt.push({ id: s.id, speaker: sid, claim })
  }

  if (problems.length === 0) {
    const q = { ...p, statements: rebuilt }
    if (countSolutions(q, 2) !== 1) {
      problems.push({ clue: '', problem: 'the read-back statements do not give exactly one solution' })
    } else if (!deduce(q).solved) {
      problems.push({ clue: '', problem: 'the read-back statements cannot be solved without guessing' })
    }
  }

  return { ok: problems.length === 0, problems, differing }
}
