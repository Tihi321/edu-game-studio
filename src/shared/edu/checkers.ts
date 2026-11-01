import type {
  ClozeItem,
  CrosswordItem,
  FlashcardItem,
  HotspotItem,
  ListeningItem,
  MatchPairsItem,
  McqItem,
  MultiSelectItem,
  OrderItem,
  RegionShape,
  SortGroupsItem,
  TrueFalseItem,
  TypedItem,
  WordSearchItem
} from '../course'
import { generateCrossword, type CrosswordGrid, type PuzzleWord } from './crossword'
import { lettersKey, matchAnswer, resolveDiacritics, type MatchResult } from './match'
import { shuffledCopy, rngFor } from './prng'
import type { CheckContext, CheckResult } from './registry'
import { isGrade } from './srs'
import { generateWordSearch, readSelection, type Selection, type WordSearchGrid } from './wordsearch'

/**
 * One pure checker per item kind. Every checker takes the item, the learner's answer (an unknown value: a wrong shape is `invalid`, never
 * an exception) and a context with the edition's texts. Answer shapes, all language-neutral except typed text:
 *
 *   mcq             option id (string)                    true-false   boolean
 *   multi-select    option ids (string[])                  cloze        { [gapId]: typed or banked text }
 *   typed           the typed text                         match-pairs  { [pairId of the left side]: pairId of the chosen right side }
 *   order           item ids in the learner's order        sort-groups  { [itemId]: groupId }
 *   hotspot         region id, or a point { x, y } in image pixels
 *   listening       option id (choose) or typed text (type)
 *   flashcard       a grade: again | hard | good | easy
 *   crossword       { [wordId]: typed letters }            word-search  Selection[] ({ start: [row, col], end: [row, col] })
 */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const bad = (expected: unknown): CheckResult => ({ correct: false, score: 0, expected, invalid: true })
const fraction = (right: number, total: number, expected: unknown, detail?: Record<string, boolean>): CheckResult => {
  const score = total === 0 ? 0 : right / total
  const correct = total > 0 && right === total
  return { correct, partial: !correct && right > 0, score, expected, ...(detail ? { detail } : {}) }
}

// ---- recognition ----

export function checkMcq(item: McqItem, answer: unknown): CheckResult {
  if (typeof answer !== 'string') return bad(item.answer)
  const correct = answer === item.answer
  return { correct, score: correct ? 1 : 0, expected: item.answer }
}

export function checkTrueFalse(item: TrueFalseItem, answer: unknown): CheckResult {
  if (typeof answer !== 'boolean') return bad(item.answer)
  const correct = answer === item.answer
  return { correct, score: correct ? 1 : 0, expected: item.answer }
}

/** Score = (right picks - wrong picks) / right options, never below 0; correct only when exactly the right set was picked. */
export function checkMultiSelect(item: MultiSelectItem, answer: unknown): CheckResult {
  const key = [...item.answers].sort()
  if (!isStrArr(answer)) return bad(key)
  const picked = new Set(answer)
  const right = key.filter((k) => picked.has(k)).length
  const wrong = [...picked].filter((p) => !item.answers.includes(p)).length
  const correct = right === key.length && wrong === 0
  const score = Math.max(0, (right - wrong) / key.length)
  return { correct, partial: !correct && score > 0, score, expected: key }
}

// ---- text answers ----

function textResult(input: string, key: string, ctx: CheckContext, strict: boolean | undefined): CheckResult {
  const accepted = ctx.text.accepted(key)
  const m: MatchResult = matchAnswer(input, accepted, { diacritics: resolveDiacritics(strict, ctx.diacritics, ctx.lang), typos: ctx.typos, lang: ctx.lang })
  return {
    correct: m.correct,
    score: m.correct ? 1 : 0,
    expected: m.canonical,
    ...(m.typo ? { typo: true } : {}),
    ...(m.diacritics ? { diacritics: true } : {}),
    ...(m.translit ? { translit: true } : {}),
    ...(m.caps ? { caps: true } : {})
  }
}

export function checkTyped(item: TypedItem, answer: unknown, ctx: CheckContext): CheckResult {
  if (typeof answer !== 'string') return bad(ctx.text.canonical(item.answer) ?? null)
  return textResult(answer, item.answer, ctx, item.strictDiacritics)
}

export function checkCloze(item: ClozeItem, answer: unknown, ctx: CheckContext): CheckResult {
  const expected = Object.fromEntries(item.gaps.map((g) => [g.id, ctx.text.canonical(g.answer) ?? null]))
  if (!isObj(answer)) return bad(expected)
  const detail: Record<string, boolean> = {}
  let typo = false
  let diacritics = false
  let translit = false
  let caps = false
  for (const g of item.gaps) {
    const v = answer[g.id]
    const r = typeof v === 'string' ? textResult(v, g.answer, ctx, item.strictDiacritics) : { correct: false }
    detail[g.id] = r.correct
    if ('typo' in r && r.typo) typo = true
    if ('diacritics' in r && r.diacritics) diacritics = true
    if ('translit' in r && r.translit) translit = true
    if ('caps' in r && r.caps) caps = true
  }
  const res = fraction(Object.values(detail).filter(Boolean).length, item.gaps.length, expected, detail)
  return { ...res, ...(typo ? { typo: true } : {}), ...(diacritics ? { diacritics: true } : {}), ...(translit ? { translit: true } : {}), ...(caps ? { caps: true } : {}) }
}

// ---- matching, ordering, sorting ----

export function checkMatchPairs(item: MatchPairsItem, answer: unknown): CheckResult {
  const expected = Object.fromEntries(item.pairs.map((p) => [p.id, p.id]))
  if (!isObj(answer)) return bad(expected)
  const detail: Record<string, boolean> = {}
  for (const p of item.pairs) detail[p.id] = answer[p.id] === p.id
  return fraction(Object.values(detail).filter(Boolean).length, item.pairs.length, expected, detail)
}

/** The learner's order must hold exactly the item ids; score = share of items in the right position. */
export function checkOrder(item: OrderItem, answer: unknown): CheckResult {
  const key = item.items.map((i) => i.id)
  if (!isStrArr(answer) || answer.length !== key.length || new Set(answer).size !== key.length || answer.some((a) => !key.includes(a))) return bad(key)
  const detail: Record<string, boolean> = {}
  key.forEach((id, i) => {
    detail[id] = answer[i] === id
  })
  return fraction(Object.values(detail).filter(Boolean).length, key.length, key, detail)
}

/** The ids of an order item in a seeded shuffled order that is never the right order (what the player shows first). */
export function presentedOrder(item: OrderItem, seed: number | string): string[] {
  return shuffledCopy(
    item.items.map((i) => i.id),
    rngFor(seed, item.id, 'order')
  )
}

export function checkSortGroups(item: SortGroupsItem, answer: unknown): CheckResult {
  const expected = Object.fromEntries(item.items.map((i) => [i.id, i.group]))
  if (!isObj(answer)) return bad(expected)
  const detail: Record<string, boolean> = {}
  for (const i of item.items) detail[i.id] = answer[i.id] === i.group
  return fraction(Object.values(detail).filter(Boolean).length, item.items.length, expected, detail)
}

// ---- hotspot ----

export function pointInShape(shape: RegionShape, x: number, y: number): boolean {
  if (shape.type === 'circle') return (x - shape.cx) ** 2 + (y - shape.cy) ** 2 <= shape.r ** 2
  if (shape.type === 'rect') return x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h
  // ray casting
  let inside = false
  const p = shape.points
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!
    const [xj, yj] = p[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** The first region (in list order) that holds the point, or undefined. List small regions before big ones that surround them. */
export function hitRegion(item: Pick<HotspotItem, 'regions'>, x: number, y: number): string | undefined {
  return item.regions.find((r) => pointInShape(r.shape, x, y))?.id
}

export function checkHotspot(item: HotspotItem, answer: unknown): CheckResult {
  let id: string | undefined
  if (typeof answer === 'string') id = answer
  else if (isObj(answer) && typeof answer.x === 'number' && typeof answer.y === 'number') id = hitRegion(item, answer.x, answer.y) ?? ''
  else return bad(item.answer)
  const correct = id === item.answer
  return { correct, score: correct ? 1 : 0, expected: item.answer }
}

// ---- listening and flashcard ----

export function checkListening(item: ListeningItem, answer: unknown, ctx: CheckContext): CheckResult {
  if (item.mode === 'choose') {
    if (typeof answer !== 'string') return bad(item.answer)
    const correct = answer === item.answer
    return { correct, score: correct ? 1 : 0, expected: item.answer }
  }
  if (typeof answer !== 'string') return bad(ctx.text.canonical(item.answer) ?? null)
  return textResult(answer, item.answer, ctx, item.strictDiacritics)
}

/** Self-graded: again is wrong, hard is right but shaky (partial, 0.6), good and easy are right. The grade then feeds the scheduler. */
export function checkFlashcard(_item: FlashcardItem, answer: unknown): CheckResult {
  if (!isGrade(answer)) return bad(null)
  if (answer === 'again') return { correct: false, score: 0, expected: null }
  if (answer === 'hard') return { correct: true, partial: true, score: 0.6, expected: null }
  return { correct: true, score: 1, expected: null }
}

// ---- crossword and word search ----

/** The grid of a crossword item in this edition (generated from the item's seed and the accepted answers of this language). */
export function crosswordFor(item: CrosswordItem, ctx: CheckContext): { grid: CrosswordGrid; words: PuzzleWord[] } {
  const words = item.words.flatMap((w) => {
    const a = ctx.text.canonical(w.answer)
    return a ? [{ id: w.id, answer: a }] : []
  })
  return { grid: generateCrossword(words, item.seed, { maxSize: item.maxSize }), words }
}

/** Answers are compared as letters only, accents folded and upper case. */
export function checkCrossword(item: CrosswordItem, answer: unknown, ctx: CheckContext): CheckResult {
  const expected = Object.fromEntries(item.words.map((w) => [w.id, ctx.text.canonical(w.answer) ?? null]))
  if (!isObj(answer)) return bad(expected)
  const detail: Record<string, boolean> = {}
  for (const w of item.words) {
    const canon = ctx.text.canonical(w.answer)
    const v = answer[w.id]
    detail[w.id] = canon !== undefined && typeof v === 'string' && lettersKey(v) !== '' && lettersKey(v) === lettersKey(canon)
  }
  return fraction(Object.values(detail).filter(Boolean).length, item.words.length, expected, detail)
}

export function wordSearchFor(item: WordSearchItem, ctx: CheckContext): { grid: WordSearchGrid; words: PuzzleWord[] } {
  const words = item.words.flatMap((w) => {
    const a = ctx.text.canonical(w.answer)
    return a ? [{ id: w.id, answer: a }] : []
  })
  return { grid: generateWordSearch(words, item.seed, { size: item.size, directions: item.directions }), words }
}

const isSelection = (v: unknown): v is Selection =>
  isObj(v) && Array.isArray(v.start) && Array.isArray(v.end) && v.start.length === 2 && v.end.length === 2 && [...v.start, ...v.end].every((n) => Number.isInteger(n))

/** The ids of the words a list of selections finds (a selection counts when its letters, read either way, spell a word). */
export function wordsFound(grid: WordSearchGrid, words: readonly PuzzleWord[], selections: readonly Selection[]): string[] {
  const found = new Set<string>()
  for (const sel of selections) {
    const letters = readSelection(grid, sel)
    if (!letters) continue
    const rev = Array.from(letters).reverse().join('')
    for (const w of words) {
      const k = lettersKey(w.answer)
      if (k === letters || k === rev) found.add(w.id)
    }
  }
  return [...found]
}

export function checkWordSearch(item: WordSearchItem, answer: unknown, ctx: CheckContext): CheckResult {
  const ids = item.words.map((w) => w.id)
  if (!Array.isArray(answer) || !answer.every(isSelection)) return bad(ids)
  const { grid, words } = wordSearchFor(item, ctx)
  const found = new Set(wordsFound(grid, words, answer))
  const detail = Object.fromEntries(ids.map((id) => [id, found.has(id)]))
  return fraction(found.size, ids.length, ids, detail)
}
