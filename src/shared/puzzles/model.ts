/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The puzzle data format (version 1) and helpers that read it.
 */

import { PUZZLE_FORMAT, PUZZLE_BANDS } from '../puzzle'
import type { PuzzleClue, LogicClue } from '../puzzle'

export const FORMAT = PUZZLE_FORMAT
export const RULES = ['clue', 'elim', 'last', 'either', 'order', 'trans'] as const
export type Rule = (typeof RULES)[number]

export const WEIGHTS: Record<string, number> = {
  clue: 1,
  elim: 1,
  last: 2,
  either: 2,
  order: 2,
  trans: 3
}

export const BANDS = PUZZLE_BANDS
export type Band = (typeof BANDS)[number]

export const EASY_RULES = ['clue', 'elim', 'last'] as const

export class PuzzleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PuzzleError'
  }
}

export interface Category {
  key: string
  items: string[]
  ref?: string
}

export type Clue = PuzzleClue | LogicClue

export interface Difficulty {
  steps: number
  score: number
  rules: Record<string, number>
}

export function categories(p: { categories: { key: string }[] }): string[] {
  return p.categories.map((c) => c.key)
}

export function categoryOf(p: { categories: Category[] }, item: string): Category {
  const cat = p.categories.find((c) => c.items.includes(item))
  if (!cat) throw new PuzzleError(`unknown item ${item}`)
  return cat
}

export function otherCategories(p: { categories: Category[] }, key: string): Category[] {
  return p.categories.filter((c) => c.key !== key)
}

export function itemsOf(p: { categories: { key: string; items: string[] }[] }, key: string): string[] {
  for (const c of p.categories) {
    if (c.key === key) return [...c.items]
  }
  throw new PuzzleError(`no category "${key}"`)
}

export function categoryIndex(p: { categories: { items: string[] }[] }): Record<string, number> {
  const out: Record<string, number> = {}
  for (let i = 0; i < p.categories.length; i++) {
    for (const it of p.categories[i]!.items) {
      out[it] = i
    }
  }
  return out
}

export function categoryKeyOf(p: { categories: { key: string; items: string[] }[] }, item: string): string {
  const idx = categoryIndex(p)
  const i = idx[item]
  if (i === undefined) throw new PuzzleError(`unknown item ${item}`)
  return p.categories[i]!.key
}

export function cellKey(pOrIdx: { categories: { items: string[] }[] } | Record<string, number>, a: string, b: string): string {
  const idx = 'categories' in pOrIdx && Array.isArray((pOrIdx as { categories?: unknown }).categories)
    ? categoryIndex(pOrIdx as { categories: { items: string[] }[] })
    : (pOrIdx as Record<string, number>)
  const ia = idx[a]
  const ib = idx[b]
  if (ia === undefined) throw new PuzzleError(`unknown item ${a}`)
  if (ib === undefined) throw new PuzzleError(`unknown item ${b}`)
  if (ia === ib) throw new PuzzleError(`${a} and ${b} are in the same category`)
  return ia < ib ? `${a}|${b}` : `${b}|${a}`
}

export function cellItems(key: string): [string, string] {
  const parts = key.includes('|') ? key.split('|') : key.split(',')
  if (parts.length !== 2) throw new PuzzleError(`invalid cell key "${key}"`)
  return [parts[0]!, parts[1]!]
}

export function allCells(p: { categories: { items: string[] }[] }): string[] {
  const cats = p.categories
  const out: string[] = []
  for (let i = 0; i < cats.length; i++) {
    for (let j = i + 1; j < cats.length; j++) {
      for (const a of cats[i]!.items) {
        for (const b of cats[j]!.items) {
          out.push(`${a}|${b}`)
        }
      }
    }
  }
  return out
}

export function ownersOf(p: { categories: { items: string[] }[]; solution: Record<string, Record<string, string>> }): Record<string, string> {
  const people = p.categories[0]!.items
  const out: Record<string, string> = {}
  for (const s of people) {
    out[s] = s
  }
  for (const s of people) {
    const sol = p.solution[s]
    if (!sol) continue
    for (let i = 1; i < p.categories.length; i++) {
      const catKey = (p.categories[i] as any).key
      const item = sol[catKey]
      if (item) {
        out[item] = s
      }
    }
  }
  return out
}

export function ordinalItems(p: { categories: { key: string; items: string[] }[]; ordinal?: { category: string } }): string[] | null {
  const ordinal = p.ordinal
  if (!ordinal) return null
  for (const c of p.categories) {
    if (c.key === ordinal.category) return [...c.items]
  }
  throw new PuzzleError(`no ordinal category "${ordinal.category}"`)
}

function _pos(owner: Record<string, string>, ordinal: string[], item: string): number {
  const person = owner[item]
  for (let i = 0; i < ordinal.length; i++) {
    if (owner[ordinal[i]!] === person) return i
  }
  throw new PuzzleError(`${item} has no place in the ordinal category`)
}

export function clueTrue(clue: any, owner: Record<string, string>, ordinal?: string[] | null): boolean {
  const t = clue.type
  if (t === 'is') {
    return owner[clue.a] === owner[clue.b]
  }
  if (t === 'not') {
    return owner[clue.a] !== owner[clue.b]
  }
  if (t === 'either') {
    return clue.b.some((b: string) => owner[clue.a] === owner[b])
  }
  if (t === 'neither') {
    return clue.b.every((b: string) => owner[clue.a] !== owner[b])
  }
  if (t === 'oneof') {
    const [a1, a2] = clue.a
    const [b1, b2] = clue.b
    return (
      (owner[a1] === owner[b1] && owner[a2] === owner[b2]) ||
      (owner[a1] === owner[b2] && owner[a2] === owner[b1])
    )
  }
  if (t === 'before' || t === 'after' || t === 'apart') {
    if (!ordinal) throw new PuzzleError('an order clue needs an ordinal category')
    const pa = _pos(owner, ordinal, clue.a)
    const pb = _pos(owner, ordinal, clue.b)
    if (t === 'before') return pa < pb
    if (t === 'after') return pa > pb
    if (typeof clue.n !== 'number' || clue.n < 1) {
      throw new PuzzleError('an apart clue needs the number n')
    }
    return Math.abs(pa - pb) === clue.n
  }
  throw new PuzzleError(`unknown clue type "${t}"`)
}

export function clueItems(clue: any): string[] {
  const out: string[] = []
  for (const key of ['a', 'b']) {
    const v = clue[key]
    if (Array.isArray(v)) {
      out.push(...v)
    } else if (v !== undefined) {
      out.push(v)
    }
  }
  return out
}

export function answerOf(p: { categories: { items: string[] }[]; murder: { place: string }; solution: Record<string, Record<string, string>> }): { suspect: string; weapon: string; place: string; motive?: string } {
  const place = p.murder.place
  for (const s of p.categories[0]!.items) {
    if (p.solution[s]?.place === place) {
      const row: { suspect: string; weapon: string; place: string; motive?: string } = {
        suspect: s,
        weapon: p.solution[s]!.weapon!,
        place
      }
      if (p.solution[s]?.motive) {
        row.motive = p.solution[s]!.motive
      }
      return row
    }
  }
  throw new PuzzleError('nobody was at the murder place')
}

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr]
  const result: T[][] = []
  for (let i = 0; i < arr.length; i++) {
    const current = arr[i]!
    const remaining = arr.slice(0, i).concat(arr.slice(i + 1))
    for (const perm of permutations(remaining)) {
      result.push([current, ...perm])
    }
  }
  return result
}

function cartesianProduct<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]]
  return arrays.reduce<T[][]>(
    (acc, curr) => acc.flatMap((prev) => curr.map((item) => [...prev, item])),
    [[]]
  )
}

export function allOwnerMaps(p: { categories: { items: string[] }[] }): Record<string, string>[] {
  const cats = p.categories
  const people = cats[0]!.items
  const perms = cats.slice(1).map(() => permutations(people))
  const out: Record<string, string>[] = []
  const combos = cartesianProduct(perms)
  for (const combo of combos) {
    const owner: Record<string, string> = {}
    for (const s of people) owner[s] = s
    for (let cIdx = 0; cIdx < combo.length; cIdx++) {
      const cat = cats[cIdx + 1]!
      const perm = combo[cIdx]!
      for (let i = 0; i < cat.items.length; i++) {
        owner[cat.items[i]!] = perm[i]!
      }
    }
    out.push(owner)
  }
  return out
}

export function validate(p: any): void {
  if (p.format !== undefined && p.format !== FORMAT) {
    throw new PuzzleError(`unknown puzzle format ${p.format}`)
  }
  const cats = p.categories || []
  if (cats.length < 3) {
    throw new PuzzleError('a puzzle has at least 3 categories')
  }
  const n = cats[0].items.length
  const seen = new Set<string>()
  for (const c of cats) {
    if (c.items.length !== n) {
      throw new PuzzleError(`every category needs ${n} items`)
    }
    for (const it of c.items) {
      if (seen.has(it)) {
        throw new PuzzleError(`item ${it} is listed twice`)
      }
      seen.add(it)
    }
  }
  if (!p.solution) throw new PuzzleError('puzzle has no solution')
  for (const s of cats[0].items) {
    const row = p.solution[s]
    if (!row) throw new PuzzleError(`no solution for ${s}`)
    for (let i = 1; i < cats.length; i++) {
      const catKey = cats[i].key
      if (!cats[i].items.includes(row[catKey])) {
        throw new PuzzleError(`the solution of ${s} has no valid ${catKey}`)
      }
    }
  }
  for (let i = 1; i < cats.length; i++) {
    const catKey = cats[i].key
    const used = cats[0].items.map((s: string) => p.solution[s][catKey])
    if (new Set(used).size !== n) {
      throw new PuzzleError(`each ${catKey} must be used once`)
    }
  }
  for (const clue of p.clues || []) {
    if (!['is', 'not', 'either', 'neither', 'oneof', 'before', 'after', 'apart'].includes(clue.type)) {
      throw new PuzzleError(`unknown clue type "${clue.type}"`)
    }
    if (clue.type === 'apart' && (typeof clue.n !== 'number' || clue.n < 1)) {
      throw new PuzzleError('an apart clue needs the number n')
    }
    if ((clue.type === 'before' || clue.type === 'after' || clue.type === 'apart') && !p.ordinal) {
      throw new PuzzleError('an order clue needs an ordinal category')
    }
    for (const it of clueItems(clue)) {
      if (!seen.has(it)) {
        throw new PuzzleError(`clue ${clue.id ?? ''} names the unknown item ${it}`)
      }
    }
  }
}
