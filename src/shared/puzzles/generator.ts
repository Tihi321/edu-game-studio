/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The generator for Murdle, logic grids, knights, testimony, and quiz.
 */

import { SeededRandom } from './prng'
import { BANDS, FORMAT, PuzzleError, answerOf, clueTrue, ownersOf, validate, ordinalItems } from './model'
import type { Band } from './model'
import { allowedFor, bandOf, countSolutions, deduce, deduceFast, difficulty } from './solver'
import { defaultDescr, fill } from './text'
import { generateLogic, verifyLogic } from './logic'
import { generateKnights, verifyKnights } from './knights'
import { generateTestimony, verifyTestimony } from './testimony'
import { generateQuiz, verifyQuiz } from './quiz'
import type { PuzzleGenerated } from '../puzzle'

const KEYS = ['suspect', 'weapon', 'place'] as const
const PREFIX: Record<string, string> = { suspect: 's', weapon: 'w', place: 'p', motive: 'm' }
export const SIZES = [3, 4] as const

function _skeleton(rng: SeededRandom, size: number, motive = false): [any[], Record<string, Record<string, string>>] {
  const keys = motive ? [...KEYS, 'motive'] : [...KEYS]
  const cats = keys.map((k) => ({
    key: k,
    items: Array.from({ length: size }, (_, i) => `${PREFIX[k]}${i + 1}`)
  }))
  const shuffled: string[][] = []
  for (let cIdx = 1; cIdx < cats.length; cIdx++) {
    const items = [...cats[cIdx]!.items]
    rng.shuffle(items)
    shuffled.push(items)
  }
  const solution: Record<string, Record<string, string>> = {}
  for (let i = 0; i < cats[0]!.items.length; i++) {
    const s = cats[0]!.items[i]!
    solution[s] = {}
    for (let k = 0; k < shuffled.length; k++) {
      solution[s]![cats[k + 1]!.key] = shuffled[k]![i]!
    }
  }
  return [cats, solution]
}

function _pool(rng: SeededRandom, cats: any[], owner: Record<string, string>, band: string): any[] {
  const pool: any[] = []
  const items: [number, string][] = []
  for (let ci = 0; ci < cats.length; ci++) {
    for (const it of cats[ci].items) {
      items.push([ci, it])
    }
  }

  for (let x = 0; x < items.length; x++) {
    for (let y = x + 1; y < items.length; y++) {
      const [ci, a] = items[x]!
      const [cj, b] = items[y]!
      if (ci === cj) continue
      if (owner[a] === owner[b]) {
        if (band !== 'hard') {
          pool.push({ type: 'is', a, b })
        }
      } else {
        pool.push({ type: 'not', a, b })
      }
    }
  }

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
    }
  }

  rng.shuffle(pool)
  return pool
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

function _pointAtTraits(rng: SeededRandom, p: any, clues: any[]): [any[], Record<string, string>] {
  const descr = defaultDescr(p)
  const out: any[] = []
  for (const c of clues) {
    const items = [c.a].concat(Array.isArray(c.b) ? c.b : [c.b])
    const pick = items.filter((it) => descr[it] && rng.random() < 0.5)
    out.push(pick.length > 0 ? { ...c, descr: pick } : c)
  }
  return [out, descr]
}

export interface GenerateOptions {
  kind?: string
  size?: number | null
  seed?: number
  band?: string
  maxTries?: number
  motive?: boolean
  attrs?: boolean
  count?: number
}

export function generate(
  kindOrOptions?: string | GenerateOptions,
  sizeArg?: number | null,
  seedArg = 0,
  bandArg = 'medium',
  maxTriesArg = 200,
  motiveArg = false,
  attrsArg = false
): PuzzleGenerated {
  let kind = 'murdle'
  let size: number | null = 3
  let seed = 0
  let band = 'medium'
  let maxTries = 200
  let motive = false
  let attrs = false
  let count: number | undefined

  if (typeof kindOrOptions === 'object' && kindOrOptions !== null) {
    kind = kindOrOptions.kind ?? 'murdle'
    size = kindOrOptions.size ?? null
    seed = kindOrOptions.seed ?? 0
    band = kindOrOptions.band ?? 'medium'
    maxTries = kindOrOptions.maxTries ?? 200
    motive = kindOrOptions.motive ?? false
    attrs = kindOrOptions.attrs ?? false
    count = kindOrOptions.count
  } else if (typeof kindOrOptions === 'string') {
    kind = kindOrOptions
    size = sizeArg ?? null
    seed = seedArg
    band = bandArg
    maxTries = maxTriesArg
    motive = motiveArg
    attrs = attrsArg
  }

  if (size === null || size === undefined) {
    size = ({ murdle: 3, logic: 4, knights: 3, testimony: 3, quiz: 4 } as Record<string, number>)[kind] ?? 3
  }

  if (kind === 'logic') {
    return generateLogic(size, seed, band, maxTries)
  }
  if (kind === 'knights') {
    return generateKnights(size, seed, band, maxTries)
  }
  if (kind === 'testimony') {
    return generateTestimony(size, seed, band, maxTries)
  }
  if (kind === 'quiz') {
    return generateQuiz(seed, count ?? size, band as Band)
  }
  if (kind !== 'murdle') {
    throw new PuzzleError(`unknown puzzle kind "${kind}" (murdle, logic, knights, testimony or quiz)`)
  }
  if (!SIZES.includes(size as any)) {
    throw new PuzzleError(`murdle makes puzzles of ${SIZES.join(' or ')} items per category, not ${size}`)
  }
  if (!BANDS.includes(band as any)) {
    throw new PuzzleError(`unknown band "${band}" (easy, medium or hard)`)
  }

  let tag = `vno-puzzles:${kind}:${seed}:${band}`
  if (size !== 3 || motive || attrs) {
    tag += `:${size}${motive ? 'm' : ''}${attrs ? 'a' : ''}`
  }
  const rng = new SeededRandom(tag)
  const allowed = allowedFor(band)

  for (let tryCount = 0; tryCount < maxTries; tryCount++) {
    const [cats, solution] = _skeleton(rng, size, motive)
    const base: any = {
      format: FORMAT,
      kind,
      size,
      seed,
      band,
      categories: cats,
      solution
    }
    const owner = ownersOf({ ...base, clues: [] })
    const pool = _pool(rng, cats, owner, band)
    const chosen: any[] = []
    let gotIs = 0

    for (const c of pool) {
      if (c.type === 'is' && band === 'medium') {
        if (gotIs > 0) continue
        gotIs++
      }
      chosen.push(c)
      if (deduceFast(_withIds(base, chosen), undefined, allowed)) {
        break
      }
    }
    if (!deduceFast(_withIds(base, chosen), undefined, allowed)) {
      continue
    }

    const clues = _minimal(base, chosen, allowed, rng)
    let p = _withIds(base, clues)
    let res = deduce(p)
    if (!res.solved || bandOf(p, res) !== band) {
      continue
    }

    rng.shuffle(clues)
    p = _withIds(base, clues)
    res = deduce(p)
    if (!res.solved || bandOf(p, res) !== band || countSolutions(p, 2) !== 1) {
      continue
    }

    if (attrs) {
      const [pointed, descr] = _pointAtTraits(rng, p, p.clues)
      p.clues = pointed
      p.descr = descr
    }

    const place = rng.choice(cats[2]!.items)
    p.murder = { place }
    p.murder.answer = answerOf(p)
    p.difficulty = difficulty(p, res)
    p.steps = res.steps
    return fill(p)
  }

  throw new PuzzleError(`no ${band} puzzle found for seed ${seed} in ${maxTries} tries`)
}

export function verify(p: any): any {
  const kind = p.kind ?? 'murdle'
  if (kind === 'knights') {
    return verifyKnights(p)
  }
  if (kind === 'logic') {
    return verifyLogic(p)
  }
  if (kind === 'testimony') {
    return verifyTestimony(p)
  }
  if (kind === 'quiz') {
    return verifyQuiz(p)
  }

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
