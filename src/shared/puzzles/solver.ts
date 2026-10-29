/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The solver for grid puzzles (Murdle, logic grids).
 */

import {
  type Band,
  type Difficulty,
  EASY_RULES,
  RULES,
  WEIGHTS,
  allOwnerMaps,
  categoryIndex,
  clueItems,
  clueTrue,
  ordinalItems,
  ownersOf,
  validate
} from './model'
import type { PuzzleStep } from '../puzzle'
import { solveKnights } from './knights'
import { solveTestimony } from './testimony'
import { solveQuiz } from './quiz'

const _ORDER_TYPES = ['before', 'after', 'apart'] as const

export interface Step extends PuzzleStep {
  rule: string
  cell?: [string, string]
  value: string
  clue?: string
  from?: [string, string][]
  who?: string
  statement?: string
}

export interface SolveResult {
  solved: boolean
  contradiction: any
  grid: Record<string, string>
  steps: Step[]
  rules: Record<string, number>
  score: number
}

const _MAPS_CACHE = new Map<string, Record<string, string>[]>()

function _maps(p: any): Record<string, string>[] {
  const key = p.categories.map((c: any) => c.items.join(',')).join(';')
  let got = _MAPS_CACHE.get(key)
  if (!got) {
    got = allOwnerMaps(p)
    _MAPS_CACHE.set(key, got)
  }
  return got
}

export function countSolutionsBrute(p: any, limit = 2, clues?: any[]): number {
  const use = clues ?? p.clues
  const ordinal = ordinalItems(p)
  let n = 0
  for (const owner of _maps(p)) {
    if (use.every((c: any) => clueTrue(c, owner, ordinal))) {
      n++
      if (n >= limit) break
    }
  }
  return n
}

function _search(p: any, use: any[], limit: number, collect?: Record<string, string>[]): number {
  const cats = p.categories
  const people: string[] = cats[0].items
  const ordinal = ordinalItems(p)
  const items: [number, string][] = []
  for (let ci = 1; ci < cats.length; ci++) {
    for (const it of cats[ci].items) {
      items.push([ci, it])
    }
  }
  const at: Record<string, number> = {}
  for (let i = 0; i < items.length; i++) {
    at[items[i]![1]] = i
  }
  const orderNeeds = ordinal ? [...ordinal] : []
  const byLast: any[][] = Array.from({ length: items.length }, () => [])

  for (const c of use) {
    let names = clueItems(c)
    if (_ORDER_TYPES.includes(c.type)) {
      names = names.concat(orderNeeds)
    }
    let last = -1
    for (const x of names) {
      if (at[x] !== undefined && at[x]! > last) {
        last = at[x]!
      }
    }
    const idx = Math.max(last, 0)
    if (idx < byLast.length) {
      byLast[idx]!.push(c)
    }
  }

  const owner: Record<string, string> = {}
  for (const s of people) owner[s] = s
  const used: Set<string>[] = Array.from({ length: cats.length }, () => new Set())
  let count = 0

  function dfs(i: number): boolean {
    if (i === items.length) {
      count++
      if (collect) {
        collect.push({ ...owner })
      }
      return count >= limit
    }
    const [ci, it] = items[i]!
    for (const person of people) {
      if (used[ci]!.has(person)) continue
      used[ci]!.add(person)
      owner[it] = person
      if (byLast[i]!.every((c) => clueTrue(c, owner, ordinal)) && dfs(i + 1)) {
        return true
      }
      used[ci]!.delete(person)
    }
    delete owner[it]
    return false
  }

  if (items.length > 0) {
    dfs(0)
  }
  return count
}

export function countSolutions(p: any, limit = 2, clues?: any[]): number {
  return _search(p, clues ?? p.clues, limit)
}

export function solutions(p: any, clues?: any[], limit = 1000): Record<string, string>[] {
  const out: Record<string, string>[] = []
  _search(p, clues ?? p.clues, limit, out)
  return out
}

export class Grid {
  p: any
  clues: any[]
  idx: Record<string, number>
  cats: string[][]
  ordinal: string[] | null
  state: Map<string, number>

  constructor(p: any, clues: any[]) {
    this.p = p
    this.clues = clues
    this.idx = categoryIndex(p)
    this.cats = p.categories.map((c: any) => [...c.items])
    this.ordinal = ordinalItems(p)
    this.state = new Map()
    for (let i = 0; i < this.cats.length; i++) {
      for (let j = i + 1; j < this.cats.length; j++) {
        for (const a of this.cats[i]!) {
          for (const b of this.cats[j]!) {
            this.state.set(this.key(a, b), 0)
          }
        }
      }
    }
  }

  key(a: string, b: string): string {
    return this.idx[a]! < this.idx[b]! ? `${a}|${b}` : `${b}|${a}`
  }

  get(a: string, b: string): number {
    return this.state.get(this.key(a, b)) ?? 0
  }

  known(): boolean {
    for (const v of this.state.values()) {
      if (v === 0) return false
    }
    return true
  }

  positions(x: string): Set<number> {
    const o = this.ordinal!
    const idxInO = o.indexOf(x)
    if (idxInO !== -1) return new Set([idxInO])
    const out = new Set<number>()
    for (let i = 0; i < o.length; i++) {
      if (this.get(x, o[i]!) !== -1) {
        out.add(i)
      }
    }
    return out
  }
}

type RuleYield = [string, number, Record<string, any>]

export function applyIs(g: Grid, a: string, b: string, info: Record<string, any>): RuleYield {
  return [g.key(a, b), 1, info]
}

export function applyNot(g: Grid, a: string, b: string, info: Record<string, any>): RuleYield {
  return [g.key(a, b), -1, info]
}

export function applyEither(g: Grid, a: string, b1: string, b2: string, info: Record<string, any>): RuleYield[] {
  const out: RuleYield[] = []
  if (g.get(a, b1) === -1) out.push([g.key(a, b2), 1, { ...info, from: [g.key(a, b1).split('|')] }])
  if (g.get(a, b2) === -1) out.push([g.key(a, b1), 1, { ...info, from: [g.key(a, b2).split('|')] }])
  return out
}

function* _clueRule(g: Grid): Generator<RuleYield> {
  for (const c of g.clues) {
    const t = c.type
    if (t === 'is') {
      yield [g.key(c.a, c.b), 1, { clue: c.id }]
    } else if (t === 'not') {
      yield [g.key(c.a, c.b), -1, { clue: c.id }]
    } else if (t === 'neither') {
      for (const b of c.b) {
        yield [g.key(c.a, b), -1, { clue: c.id }]
      }
    } else if (t === 'either') {
      const cat = g.cats[g.idx[c.b[0]]!]!
      for (const x of cat) {
        if (!c.b.includes(x)) {
          yield [g.key(c.a, x), -1, { clue: c.id }]
        }
      }
    } else if (t === 'oneof') {
      const cat = g.cats[g.idx[c.b[0]]!]!
      for (const a of c.a) {
        for (const x of cat) {
          if (!c.b.includes(x)) {
            yield [g.key(a, x), -1, { clue: c.id }]
          }
        }
      }
    }
  }
}

function* _elimRule(g: Grid): Generator<RuleYield> {
  for (const [cell, v] of g.state.entries()) {
    if (v !== 1) continue
    const [a, b] = cell.split('|') as [string, string]
    const catB = g.cats[g.idx[b]!]!
    for (const x of catB) {
      if (x !== b) {
        yield [g.key(a, x), -1, { from: [[a, b]] }]
      }
    }
    const catA = g.cats[g.idx[a]!]!
    for (const x of catA) {
      if (x !== a) {
        yield [g.key(x, b), -1, { from: [[a, b]] }]
      }
    }
  }
}

function* _lastRule(g: Grid): Generator<RuleYield> {
  for (let i = 0; i < g.cats.length; i++) {
    for (let j = i + 1; j < g.cats.length; j++) {
      for (const a of g.cats[i]!) {
        const row = g.cats[j]!.map((b) => g.key(a, b))
        const unknown = row.filter((c) => g.state.get(c) === 0)
        if (unknown.length === 1 && !row.some((c) => g.state.get(c) === 1)) {
          yield [unknown[0]!, 1, { from: row.filter((c) => c !== unknown[0]).map((c) => c.split('|')) }]
        }
      }
      for (const b of g.cats[j]!) {
        const col = g.cats[i]!.map((a) => g.key(a, b))
        const unknown = col.filter((c) => g.state.get(c) === 0)
        if (unknown.length === 1 && !col.some((c) => g.state.get(c) === 1)) {
          yield [unknown[0]!, 1, { from: col.filter((c) => c !== unknown[0]).map((c) => c.split('|')) }]
        }
      }
    }
  }
}

function* _eitherRule(g: Grid): Generator<RuleYield> {
  for (const c of g.clues) {
    if (c.type === 'either') {
      const [b1, b2] = c.b
      if (g.get(c.a, b1) === -1) {
        yield [g.key(c.a, b2), 1, { clue: c.id, from: [g.key(c.a, b1).split('|')] }]
      }
      if (g.get(c.a, b2) === -1) {
        yield [g.key(c.a, b1), 1, { clue: c.id, from: [g.key(c.a, b2).split('|')] }]
      }
    } else if (c.type === 'oneof') {
      const [a1, a2] = c.a
      const [b1, b2] = c.b
      const first = [g.key(a1, b1), g.key(a2, b2)]
      const second = [g.key(a1, b2), g.key(a2, b1)]
      if (first.some((k) => g.state.get(k) === -1)) {
        for (const k of second) {
          yield [k, 1, { clue: c.id, from: first.filter((x) => g.state.get(x) === -1).map((x) => x.split('|')) }]
        }
      }
      if (second.some((k) => g.state.get(k) === -1)) {
        for (const k of first) {
          yield [k, 1, { clue: c.id, from: second.filter((x) => g.state.get(x) === -1).map((x) => x.split('|')) }]
        }
      }
    }
  }
}

function* _orderRule(g: Grid): Generator<RuleYield> {
  if (!g.ordinal) return
  const o = g.ordinal
  for (const c of g.clues) {
    const t = c.type
    if (!_ORDER_TYPES.includes(t)) continue
    const a = c.a
    const b = c.b
    const pa = g.positions(a)
    const pb = g.positions(b)
    let ok: (i: number, j: number) => boolean
    if (t === 'before') {
      ok = (i, j) => i < j
    } else if (t === 'after') {
      ok = (i, j) => i > j
    } else {
      const n = c.n
      ok = (i, j) => Math.abs(i - j) === n
    }
    if (!o.includes(a)) {
      for (const i of Array.from(pa).sort((x, y) => x - y)) {
        let hasMatch = false
        for (const j of pb) {
          if (ok(i, j)) {
            hasMatch = true
            break
          }
        }
        if (!hasMatch) {
          yield [g.key(a, o[i]!), -1, { clue: c.id }]
        }
      }
    }
    if (!o.includes(b)) {
      for (const j of Array.from(pb).sort((x, y) => x - y)) {
        let hasMatch = false
        for (const i of pa) {
          if (ok(i, j)) {
            hasMatch = true
            break
          }
        }
        if (!hasMatch) {
          yield [g.key(b, o[j]!), -1, { clue: c.id }]
        }
      }
    }
  }
}

function* _transRule(g: Grid): Generator<RuleYield> {
  for (const [cell, v] of g.state.entries()) {
    if (v !== 1) continue
    const [a, b] = cell.split('|') as [string, string]
    const pairs: [string, string][] = [
      [a, b],
      [b, a]
    ]
    for (const [mid, other] of pairs) {
      for (let catI = 0; catI < g.cats.length; catI++) {
        if (catI === g.idx[mid] || catI === g.idx[other]) continue
        for (const x of g.cats[catI]!) {
          const w = g.get(mid, x)
          if (w === 0) continue
          yield [g.key(other, x), w, { from: [cell.split('|'), g.key(mid, x).split('|')] }]
        }
      }
    }
  }
}

const _RULE_FUNCS: Record<string, (g: Grid) => Generator<RuleYield>> = {
  clue: _clueRule,
  elim: _elimRule,
  last: _lastRule,
  either: _eitherRule,
  order: _orderRule,
  trans: _transRule
}

export function propagate(g: Grid, allowed: readonly string[] = RULES): { contradiction: any } | null {
  for (const rule of RULES) {
    if (!allowed.includes(rule)) continue
    for (const [cell, value] of _RULE_FUNCS[rule]!(g)) {
      const cur = g.state.get(cell)!
      if (cur === value) continue
      if (cur !== 0) {
        return { contradiction: { rule, cell: cell.split('|') } }
      }
      g.state.set(cell, value)
    }
  }
  return null
}

export function deduce(p: any, clues?: any[], allowed: readonly string[] = RULES): SolveResult {
  const use = clues ?? p.clues
  const g = new Grid(p, use)
  const steps: Step[] = []
  let contradiction: any = null
  let progress = true

  while (progress && !g.known()) {
    progress = false
    for (const rule of RULES) {
      if (!allowed.includes(rule)) continue
      for (const [cell, value, info] of _RULE_FUNCS[rule]!(g)) {
        const cur = g.state.get(cell)!
        if (cur === value) continue
        if (cur !== 0) {
          contradiction = { rule, cell: cell.split('|') }
          break
        }
        g.state.set(cell, value)
        const step: Step = {
          rule,
          cell: cell.split('|') as [string, string],
          value: value === 1 ? 'yes' : 'no',
          ...info
        }
        steps.push(step)
        progress = true
        break
      }
      if (progress || contradiction) break
    }
    if (contradiction) break
  }

  const grid: Record<string, string> = {}
  for (const [c, v] of g.state.entries()) {
    grid[c] = v === 1 ? 'yes' : v === -1 ? 'no' : ''
  }

  let solved = false
  if (!contradiction && g.known()) {
    const owner = ownersOf(p)
    solved = Array.from(g.state.entries()).every(([cell, v]) => {
      const [a, b] = cell.split('|') as [string, string]
      return (owner[a] === owner[b]) === (v === 1)
    })
  }

  const rules: Record<string, number> = {}
  for (const r of RULES) rules[r] = 0
  for (const s of steps) rules[s.rule] = (rules[s.rule] ?? 0) + 1

  const activeRules: Record<string, number> = {}
  for (const [r, n] of Object.entries(rules)) {
    if (n > 0) activeRules[r] = n
  }

  const score = Object.entries(rules).reduce((acc, [r, n]) => acc + (WEIGHTS[r] ?? 1) * n, 0)
  return { solved, contradiction, grid, steps, rules: activeRules, score }
}

export function deduceFast(p: any, clues?: any[], allowed: readonly string[] = RULES): boolean {
  const use = clues ?? p.clues
  const g = new Grid(p, use)
  let changed = true

  while (changed && !g.known()) {
    changed = false
    for (const rule of RULES) {
      if (!allowed.includes(rule)) continue
      for (const [cell, value] of _RULE_FUNCS[rule]!(g)) {
        const cur = g.state.get(cell)!
        if (cur === value) continue
        if (cur !== 0) return false
        g.state.set(cell, value)
        changed = true
      }
    }
  }

  if (!g.known()) return false
  const owner = ownersOf(p)
  return Array.from(g.state.entries()).every(([cell, v]) => {
    const [a, b] = cell.split('|') as [string, string]
    return (owner[a] === owner[b]) === (v === 1)
  })
}

export function bandOf(p: any, result?: SolveResult, clues?: any[]): Band {
  const use = clues ?? p.clues
  const r = result ?? deduce(p, use)
  const rules = r.rules
  const trans = rules['trans'] ?? 0
  if (p.ordinal) {
    if (trans >= (p.hardTrans ?? 8)) {
      return 'hard'
    }
    return trans > 0 || (rules['either'] ?? 0) > 0 || use.some((c: any) => c.type === 'either' || c.type === 'oneof')
      ? 'medium'
      : 'easy'
  }
  const hasIs = use.some((c: any) => c.type === 'is')
  if (trans >= 3 && !hasIs) return 'hard'
  if (trans > 0 || (rules['either'] ?? 0) > 0 || (rules['order'] ?? 0) > 0) {
    return 'medium'
  }
  return 'easy'
}

export const bandFor = bandOf

export function allowedFor(band: string, p?: any): readonly string[] {
  if (band === 'easy') {
    return p && p.ordinal ? [...EASY_RULES, 'order'] : EASY_RULES
  }
  return RULES
}

export function difficulty(p: any, result?: SolveResult): Difficulty {
  const r = result ?? deduce(p)
  return { steps: r.steps.length, score: r.score, rules: r.rules }
}

export function isMinimal(p: any, clues: any[], allowed: readonly string[] = RULES): boolean {
  for (let i = 0; i < clues.length; i++) {
    const trial = clues.slice(0, i).concat(clues.slice(i + 1))
    const q = { ...p, clues: trial.map((c: any, idx: number) => ({ ...c, id: `c${idx + 1}` })) }
    if (deduceFast(q, trial, allowed)) {
      return false
    }
  }
  return true
}

export function solve(p: any): {
  unique: boolean
  solutions: number
  deducible: boolean
  band: Band | null
  steps: PuzzleStep[]
  score: number
  rules: Record<string, number>
} {
  const kind = p.kind ?? 'murdle'
  if (kind === 'knights') {
    return solveKnights(p)
  }
  if (kind === 'testimony') {
    return solveTestimony(p)
  }
  if (kind === 'quiz') {
    return solveQuiz(p)
  }
  validate(p)
  const n = countSolutions(p, 2)
  const res = deduce(p)
  return {
    unique: n === 1,
    solutions: n,
    deducible: res.solved,
    band: res.solved ? bandOf(p, res) : null,
    steps: res.steps,
    score: res.score,
    rules: res.rules
  }
}
