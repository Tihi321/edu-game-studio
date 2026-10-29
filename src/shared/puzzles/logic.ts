/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Logic grids (Puzzle Baron).
 */

import { SeededRandom } from './prng'
import { FORMAT, BANDS, PuzzleError, clueTrue, ownersOf, ordinalItems, validate } from './model'
import { allowedFor, bandOf, countSolutions, deduce, deduceFast, difficulty, solve, Grid } from './solver'
import { clueText } from './text'
import type { LogicCore } from '../puzzle'

export const SCENARIO = {
  intro: 'The bakery delivered one order each day. Work out which delivery was which.',
  categories: [
    { key: 'day', ref: 'the {n} delivery', names: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], prefix: 'd' },
    { key: 'customer', ref: 'the delivery to {n}', names: ['Ana', 'Boris', 'Cleo', 'Dino', 'Eva'], prefix: 'c' },
    { key: 'cake', ref: 'the {n} delivery', names: ['lemon cake', 'poppy roll', 'plum tart', 'honey bun', 'rye loaf'], prefix: 'k' },
    { key: 'town', ref: 'the delivery to {n}', names: ['Oakville', 'Pinebrook', 'Riverton', 'Stonegate', 'Wheatley'], prefix: 't' }
  ],
  unit: 'days'
}

export const LOGIC_SIZES = [3, 4, 5] as const
const SIZES = LOGIC_SIZES
export const HARD_TRANS: Record<number, number> = { 3: 3, 4: 6, 5: 10 }

export const LogicGrid = Grid
export const solveLogic = solve

export function defaultLogicNames(p: any): Record<string, string> {
  const have = p.names ?? {}
  const out: Record<string, string> = {}
  for (let cIdx = 0; cIdx < p.categories.length; cIdx++) {
    const sc = SCENARIO.categories[cIdx]
    const c = p.categories[cIdx]
    for (let i = 0; i < c.items.length; i++) {
      const it = c.items[i]!
      out[it] = have[it] ?? (sc && i < sc.names.length ? sc.names[i]! : it)
    }
  }
  return out
}
const defaultNames = defaultLogicNames

export function introText(_p?: any): string {
  return SCENARIO.intro
}

function _skeleton(rng: SeededRandom, size: number): [any[], Record<string, Record<string, string>>] {
  const cats: any[] = []
  for (const sc of SCENARIO.categories) {
    cats.push({
      key: sc.key,
      items: Array.from({ length: size }, (_, i) => `${sc.prefix}${i + 1}`),
      ref: sc.ref
    })
  }
  const perms: string[][] = []
  for (let i = 1; i < cats.length; i++) {
    const items = [...cats[i]!.items]
    rng.shuffle(items)
    perms.push(items)
  }
  const solution: Record<string, Record<string, string>> = {}
  const people = cats[0]!.items
  for (let i = 0; i < people.length; i++) {
    const s = people[i]!
    solution[s] = {}
    for (let k = 0; k < perms.length; k++) {
      solution[s]![cats[k + 1]!.key] = perms[k]![i]!
    }
  }
  return [cats, solution]
}

function _pos(owner: Record<string, string>, people: string[], item: string): number {
  return people.indexOf(owner[item]!)
}

function _pool(rng: SeededRandom, cats: any[], owner: Record<string, string>, band: string): any[] {
  const people: string[] = cats[0].items
  const items: [number, string][] = []
  for (let ci = 0; ci < cats.length; ci++) {
    for (const it of cats[ci].items) {
      items.push([ci, it])
    }
  }
  const pool: any[] = []

  for (let x = 0; x < items.length; x++) {
    for (let y = 0; y < items.length; y++) {
      const [ci, a] = items[x]!
      const [cj, b] = items[y]!
      if (ci === cj) continue
      if (x < y) {
        if (owner[a] === owner[b]) {
          if (band !== 'hard') {
            pool.push({ type: 'is', a, b })
          }
        } else {
          pool.push({ type: 'not', a, b })
        }
      }
      const pa = _pos(owner, people, a)
      const pb = _pos(owner, people, b)
      if (pa < pb) {
        pool.push({ type: 'before', a, b })
      }
      if (x < y && pa !== pb) {
        pool.push({ type: 'apart', a, b, n: Math.abs(pa - pb) })
      }
    }
  }

  if (band !== 'easy') {
    for (const [ci, a] of items) {
      for (let cj = 0; cj < cats.length; cj++) {
        if (cj === ci) continue
        const trueItems = cats[cj].items.filter((b: string) => owner[b] === owner[a])
        const falseItems = cats[cj].items.filter((b: string) => owner[b] !== owner[a])
        for (const f of falseItems) {
          const pair = [trueItems[0]!, f]
          rng.shuffle(pair)
          pool.push({ type: 'either', a, b: pair })
        }
        if (falseItems.length >= 2) {
          for (let i = 0; i < falseItems.length; i++) {
            for (let j = i + 1; j < falseItems.length; j++) {
              pool.push({ type: 'neither', a, b: [falseItems[i]!, falseItems[j]!] })
            }
          }
        }
      }
    }
    for (let ci = 0; ci < cats.length; ci++) {
      for (let cj = 0; cj < cats.length; cj++) {
        if (ci === cj) continue
        const catI = cats[ci].items
        const catJ = cats[cj].items
        for (let i = 0; i < catI.length; i++) {
          for (let j = i + 1; j < catI.length; j++) {
            const a1 = catI[i]!
            const a2 = catI[j]!
            const t1 = catJ.find((b: string) => owner[b] === owner[a1])!
            const t2 = catJ.find((b: string) => owner[b] === owner[a2])!
            const pair = [t1, t2]
            rng.shuffle(pair)
            pool.push({ type: 'oneof', a: [a1, a2], b: pair })
          }
        }
      }
    }
  } else {
    for (const [ci, a] of items) {
      for (let cj = 0; cj < cats.length; cj++) {
        if (cj === ci) continue
        const falseItems = cats[cj].items.filter((b: string) => owner[b] !== owner[a])
        if (falseItems.length >= 2) {
          for (let i = 0; i < falseItems.length; i++) {
            for (let j = i + 1; j < falseItems.length; j++) {
              pool.push({ type: 'neither', a, b: [falseItems[i]!, falseItems[j]!] })
            }
          }
        }
      }
    }
  }

  rng.shuffle(pool)
  return pool
}

function _allowed(band: string): readonly string[] {
  if (band === 'easy') {
    return allowedFor('easy', { ordinal: true })
  }
  if (band === 'medium') {
    return [...allowedFor('easy', { ordinal: true }), 'either']
  }
  return allowedFor('hard')
}

function _numbered(clues: any[]): any[] {
  return clues.map((c, i) => ({ ...c, id: `c${i + 1}` }))
}

function _withIds(p: any, clues: any[]): any {
  return { ...p, clues: _numbered(clues) }
}

function _minimal(p: any, clues: any[], allowed: readonly string[], rng: SeededRandom): any[] {
  const keep = [...clues]
  const order = Array.from({ length: keep.length }, (_, i) => i)
  rng.shuffle(order)
  const gone = new Set<number>()
  for (const i of order) {
    const trial = keep.filter((_, idx) => idx !== i && !gone.has(idx))
    if (deduceFast(_withIds(p, trial), undefined, allowed)) {
      gone.add(i)
    }
  }
  return keep.filter((_, idx) => !gone.has(idx))
}

export function generateLogic(
  size = 4,
  seed = 0,
  band = 'medium',
  maxTries = 200
): LogicCore & { names: Record<string, string>; text: Record<string, string> } {
  if (!SIZES.includes(size as any)) {
    throw new PuzzleError(`logic grids have ${SIZES.join(' or ')} items per category, not ${size}`)
  }
  if (!BANDS.includes(band as any)) {
    throw new PuzzleError(`unknown band "${band}" (easy, medium or hard)`)
  }
  const rng = new SeededRandom(`vno-puzzles:logic:${seed}:${band}:${size}`)

  for (let tryCount = 0; tryCount < maxTries; tryCount++) {
    const [cats, solution] = _skeleton(rng, size)
    const base: any = {
      format: FORMAT,
      kind: 'logic',
      size,
      seed,
      band,
      categories: cats,
      solution,
      ordinal: { category: cats[0]!.key, unit: SCENARIO.unit },
      hardTrans: HARD_TRANS[size]
    }
    const allowed = _allowed(band)
    const owner = ownersOf({ ...base, clues: [] })
    const pool = _pool(rng, cats, owner, band)
    const chosen: any[] = []

    for (const c of pool) {
      chosen.push(c)
      if (chosen.length % 3 === 0 && deduceFast(_withIds(base, chosen), undefined, allowed)) {
        break
      }
    }
    if (!deduceFast(_withIds(base, chosen), undefined, allowed)) {
      continue
    }

    const clues = _minimal(base, chosen, allowed, rng)
    rng.shuffle(clues)
    const p = _withIds(base, clues)
    const res = deduce(p)
    if (!res.solved || bandOf(p, res) !== band || countSolutions(p, 2) !== 1) {
      continue
    }
    if (band === 'medium' && !clues.some((c) => c.type === 'either' || c.type === 'oneof')) {
      continue
    }
    p.difficulty = difficulty(p, res)
    p.steps = res.steps
    return fillLogic(p)
  }

  throw new PuzzleError(`no ${band} logic grid found for seed ${seed} in ${maxTries} tries`)
}

export function fillLogic(p: any, names?: Record<string, string>): any {
  const nm = names ? { ...names } : defaultNames(p)
  p.names = nm
  p.text = {}
  for (const c of p.clues) {
    p.text[c.id] = clueText(p, c, nm)
  }
  p.text.intro = introText(p)
  return p
}

export function verifyLogic(p: any): any {
  validate(p)
  const owner = ownersOf(p)
  const ordinal = ordinalItems(p)
  for (const c of p.clues) {
    if (!clueTrue(c, owner, ordinal)) {
      throw new PuzzleError(`clue ${c.id} is false in the solution`)
    }
  }
  if (countSolutions(p, 2) !== 1) {
    throw new PuzzleError('the puzzle does not have exactly one solution')
  }
  const res = deduce(p)
  if (!res.solved) {
    throw new PuzzleError('the puzzle cannot be solved by deduction alone')
  }
  return res
}

export function renderLogicClue(p: any, clue: any, nm?: Record<string, string>): string {
  return clueText(p, clue, nm)
}

export function renderAllLogic(p: any, names?: Record<string, string>): { names: Record<string, string>; text: Record<string, string> } {
  const q = { ...p }
  delete q.text
  delete q.names
  fillLogic(q, names)
  return { names: q.names, text: q.text }
}
