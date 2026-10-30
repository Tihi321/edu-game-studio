import { checkAccusation, checkSolution, cycleMark, allCells, answerOf, categoryKeyOf, cellItems, deduce, generate, isComplete, setMark, truth, verify, autoCross, PuzzleError } from '../puzzles'
import type { Step } from '../puzzles'

/**
 * The detective shell's wrapper over VN Studio's proved puzzle generator (`src/shared/puzzles`, copied unchanged by EGS-01). Pure: no DOM, no
 * node, so the lint, the player, the bot's solver hook and the tests all import it.
 *
 *  - `buildCase()` generates a case from its seed (deterministic) and PROVES it with `verify()` (exactly one solution AND solvable by
 *    deduction alone). A seed the generator cannot make (or that does not verify) falls back to the next seed, at most `SEED_TRIES` in all;
 *    only when every one of them fails does it throw (the lint reports DET_PUZZLE_*). Results are cached per kind / size / seed / band.
 *  - Clue sentences are rendered here, in the edition's language, from the course's own names and aliases (the generator's own prose is
 *    English only and would put a name in the wrong grammatical case in Croatian: the Croatian templates are written so that a name is
 *    never inflected). English output equals the generator's `clueText` for the default names (a test checks it).
 *  - The grid helpers (`cycleMark`, `autoCross` ...) are the generator's `play.ts`.
 *
 * The shell plays the two grid kinds (`murdle`, `logic`). Knights and Knaves, testimony and quiz are not offered (see the section schema).
 */

export const CASE_KINDS = ['murdle', 'logic'] as const
export type CaseKind = (typeof CASE_KINDS)[number]
export const CASE_BANDS = ['easy', 'medium', 'hard'] as const
export const CASE_SIZES = [3, 4] as const

/** How many seeds are tried in all (the spec's seed, then the next ones) before a case is declared impossible. */
export const SEED_TRIES = 8

export interface PuzzleCategory {
  key: string
  items: string[]
}

export interface PuzzleClue {
  id: string
  type: string
  a: string | string[]
  b: string | string[]
  n?: number
}

/** The part of a generated puzzle the shell reads. */
export interface Puzzle {
  kind: CaseKind
  size: number
  seed: number
  band: string
  categories: PuzzleCategory[]
  clues: PuzzleClue[]
  solution: Record<string, Record<string, string>>
  murder?: { place: string; answer: { suspect: string; weapon: string; place: string; motive?: string } }
}

export interface CaseParams {
  kind: CaseKind
  size: number
  seed: number
  band: string
}

export interface BuiltCase {
  puzzle: Puzzle
  /** The seed that gave the puzzle (the spec's seed, or a later one when the generator could not make it). */
  seed: number
  /** How many seeds were skipped before this one. */
  skipped: number
}

type Generator = (opts: { kind: string; size: number; seed: number; band: string }) => unknown

const cache = new Map<string, BuiltCase>()

/**
 * Generates and proves a case. Throws the last error when every seed of `SEED_TRIES` fails. `gen` is for tests (a generator that fails on
 * some seeds proves the fallback); the cache is only used with the real generator.
 */
export function buildCase(params: CaseParams, gen?: Generator): BuiltCase {
  const key = `${params.kind}:${params.size}:${params.seed}:${params.band}`
  if (!gen) {
    const hit = cache.get(key)
    if (hit) return hit
  }
  const make = gen ?? ((o) => generate(o))
  let last: unknown = new PuzzleError('no seed tried')
  for (let i = 0; i < SEED_TRIES; i++) {
    const seed = params.seed + i
    try {
      const p = make({ kind: params.kind, size: params.size, seed, band: params.band })
      verify(p)
      const built: BuiltCase = { puzzle: p as unknown as Puzzle, seed, skipped: i }
      if (!gen) cache.set(key, built)
      return built
    } catch (e) {
      last = e
    }
  }
  throw last instanceof Error ? last : new PuzzleError(String(last))
}

// ---- reading a puzzle ----

export const categoryKeys = (p: Puzzle): string[] => p.categories.map((c) => c.key)
export const entityIds = (p: Puzzle): string[] => p.categories.flatMap((c) => c.items)
export const categoryOf = (p: Puzzle, id: string): string => categoryKeyOf(p, id)

/** Murdle's place is fixed by the case (the body was found there), so the accusation asks for the others. Logic grids have no accusation. */
export function accusationKeys(p: Puzzle): string[] {
  if (p.kind !== 'murdle') return []
  return categoryKeys(p).filter((k) => k !== 'place')
}

/** The right accusation (category key -> entity id), or null for a logic grid. */
export function accusationOf(p: Puzzle): Record<string, string> | null {
  if (p.kind !== 'murdle' || !p.murder) return null
  const a = answerOf({ categories: p.categories, murder: p.murder, solution: p.solution }) as Record<string, string>
  const out: Record<string, string> = {}
  for (const k of accusationKeys(p)) out[k] = a[k] as string
  return out
}

/** The cells that are 'yes' in the solution (keys `a|b`, in the order of the categories). */
export function yesCells(p: Puzzle): string[] {
  const t = truth(p)
  return allCells(p).filter((c) => t[c] === 'yes')
}

/** Every cell of the grid, as `[a, b]` pairs with the category pair they belong to (a table per pair of categories). */
export function gridTables(p: Puzzle): { rows: PuzzleCategory; cols: PuzzleCategory; key: string }[] {
  const out: { rows: PuzzleCategory; cols: PuzzleCategory; key: string }[] = []
  for (let i = 0; i < p.categories.length; i++) for (let j = i + 1; j < p.categories.length; j++) out.push({ rows: p.categories[i] as PuzzleCategory, cols: p.categories[j] as PuzzleCategory, key: `${(p.categories[i] as PuzzleCategory).key}-${(p.categories[j] as PuzzleCategory).key}` })
  return out
}

export type Marks = Record<string, string>
export type MarkValue = '' | 'no' | 'yes'

/** The mark of a cell (`a|b`). */
export const markOf = (marks: Marks, key: string): MarkValue => {
  const [a, b] = cellItems(key)
  return ((marks[key] ?? marks[`${a},${b}`] ?? '') as MarkValue)
}

/** Blank -> no -> yes -> blank. */
export const cycle = (marks: Marks, key: string): Marks => cycleMark(marks, key)
export const setTo = (marks: Marks, key: string, value: MarkValue): Marks => setMark(marks, key, value)

/** A 'yes' strikes the rest of its row and column out (the generator's `autoCross`). */
export const crossOut = (p: Puzzle, marks: Marks, key: string): Marks => autoCross(p, marks, key)

/** The pairs of a grid with a 'yes' mark: where the red string runs on the cork board. */
export function yesPairs(p: Puzzle, marks: Marks): [string, string][] {
  return allCells(p)
    .filter((c) => markOf(marks, c) === 'yes')
    .map((c) => cellItems(c))
}

export interface AccuseResult {
  correct: boolean
  /** Murdle: the categories that are wrong (`weapon`). Logic: the cells that are wrong. */
  wrong: string[]
}

/** Murdle: the accusation (suspect, weapon) against the answer. Logic: the grid against the solution. */
export function checkAccuse(p: Puzzle, accusation: Record<string, string>, marks: Marks): AccuseResult {
  if (p.kind === 'murdle') {
    const full: Record<string, string> = { ...accusation, place: p.murder?.place ?? '' }
    const r = checkAccusation(p, full)
    return { correct: r.correct, wrong: r.wrong.filter((k) => k !== 'place') }
  }
  const r = checkSolution(p, marks)
  return { correct: r.correct, wrong: r.wrong }
}

/** True when the marks alone solve the grid (every 'yes' right and none missing). */
export const gridComplete = (p: Puzzle, marks: Marks): boolean => isComplete(p, marks)

// ---- names, aliases and sentences ----

export interface Namer {
  name(id: string): string
  /** A fact-coded alias ("the planet with the fastest winds"): clue sentences use it instead of the name. */
  alias?(id: string): string | undefined
}

type Tpl = {
  is: Record<string, string>
  not: Record<string, string>
  either: Record<string, string>
  isAny: string
  notAny: string
  eitherAny: string
  logic: { is: string; not: string; either: string; neither: string; oneof: string; before: string; after: string; apart: string }
  hint: {
    wrong: string
    clue: string
    yes: string
    no: string
    elim: string
    last: string
    either: string
    order: string
    trans: string
    verbYes: string
    verbNo: string
    accuse: string
    more: string
  }
  /** English puts `the` in front of a lower-case weapon or place; Croatian never does. */
  articles: boolean
}

const EN: Tpl = {
  is: {
    'suspect,weapon': '{X} had {Y}.',
    'suspect,place': '{X} was in {Y}.',
    'suspect,motive': '{X} acted out of {Y}.',
    'weapon,place': 'Whoever had {X} was in {Y}.',
    'weapon,motive': 'Whoever had {X} acted out of {Y}.',
    'place,motive': 'Whoever was in {X} acted out of {Y}.'
  },
  not: {
    'suspect,weapon': '{X} did not have {Y}.',
    'suspect,place': '{X} was not in {Y}.',
    'suspect,motive': '{X} did not act out of {Y}.',
    'weapon,place': 'Whoever had {X} was not in {Y}.',
    'weapon,motive': 'Whoever had {X} did not act out of {Y}.',
    'place,motive': 'Whoever was in {X} did not act out of {Y}.'
  },
  either: {
    'suspect,place': '{A} was either in {B1} or {B2}.',
    'suspect,weapon': '{A} had either {B1} or {B2}.',
    'weapon,place': '{A} was either in {B1} or {B2}.',
    'weapon,suspect': 'Either {B1} or {B2} had {A}.',
    'place,suspect': 'Either {B1} or {B2} was in {A}.',
    'place,weapon': 'Either {B1} or {B2} was in {A}.',
    'suspect,motive': '{A} acted out of either {B1} or {B2}.',
    'motive,suspect': 'Either {B1} or {B2} acted out of {A}.',
    'weapon,motive': 'Whoever had {A} acted out of either {B1} or {B2}.',
    'motive,weapon': 'Whoever acted out of {A} had either {B1} or {B2}.',
    'place,motive': 'Whoever was in {A} acted out of either {B1} or {B2}.',
    'motive,place': 'Whoever acted out of {A} was either in {B1} or {B2}.'
  },
  isAny: '{X} goes with {Y}.',
  notAny: '{X} does not go with {Y}.',
  eitherAny: '{A} goes with either {B1} or {B2}.',
  logic: {
    is: '{A} goes with {B}.',
    not: '{A} does not go with {B}.',
    either: '{A} goes with either {B1} or {B2}.',
    neither: '{A} goes with neither {B1} nor {B2}.',
    oneof: 'Of {A1} and {A2}, one goes with {B1} and the other with {B2}.',
    before: '{A} came before {B}.',
    after: '{A} came after {B}.',
    apart: '{A} and {B} are exactly {n} places apart.'
  },
  hint: {
    wrong: 'Look again at {A} and {B}.',
    clue: 'Clue {n} says: {text}',
    yes: 'So {A} goes with {B}.',
    no: 'So {A} cannot go with {B}.',
    elim: '{F0} goes with {F1}, so {A} cannot go with {B}.',
    last: 'Everything else for {A} is ruled out, so {A} goes with {B}.',
    either: 'One of the two is ruled out, so {A} goes with {B}.',
    order: 'Counting the places in order, that rules out {A} {B}.',
    trans: '{A} and {B} are linked through {M}, so {A} {verb} {B}.',
    verbYes: 'goes with',
    verbNo: 'cannot go with',
    accuse: 'The grid is complete. Make your accusation.',
    more: 'The clues you have turned say no more. Turn another clue card.'
  },
  articles: true
}

/** Croatian: a name is always in the nominative and never inflected, so no sentence needs a case ending. */
const HR: Tpl = {
  is: {},
  not: {},
  either: {},
  isAny: '{X} i {Y} idu zajedno.',
  notAny: '{X} i {Y} ne idu zajedno.',
  eitherAny: '{A} ide zajedno s jednim od ovih dvoje: {B1} ili {B2}.',
  logic: {
    is: '{A} i {B} idu zajedno.',
    not: '{A} i {B} ne idu zajedno.',
    either: '{A} ide zajedno s jednim od ovih dvoje: {B1} ili {B2}.',
    neither: '{A} ne ide zajedno ni s jednim od ovih dvoje: {B1}, {B2}.',
    oneof: 'Od ove dvije stvari, {A1} i {A2}, jedna ide uz {B1}, a druga uz {B2}.',
    before: 'Redoslijed: {A}, a zatim {B}.',
    after: 'Redoslijed: {B}, a zatim {A}.',
    apart: '{A} i {B}: u redoslijedu ih dijeli točno {n}.'
  },
  hint: {
    wrong: 'Pogledaj ponovno: {A} i {B}.',
    clue: 'Trag {n}: {text}',
    yes: 'Zato {A} i {B} idu zajedno.',
    no: 'Zato {A} i {B} ne idu zajedno.',
    elim: '{F0} i {F1} idu zajedno, pa {A} i {B} ne idu zajedno.',
    last: 'Sve drugo za {A} je isključeno, pa {A} i {B} idu zajedno.',
    either: 'Jedno od dvoje je isključeno, pa {A} i {B} idu zajedno.',
    order: 'Brojanje u redoslijedu isključuje: {A}, {B}.',
    trans: '{A} i {B} povezani su preko: {M}, pa {verb}.',
    verbYes: 'idu zajedno',
    verbNo: 'ne idu zajedno',
    accuse: 'Mreža je gotova. Podigni optužbu.',
    more: 'Okrenuti tragovi ne govore više. Okreni još jedan trag.'
  },
  articles: false
}

const TEMPLATES: Record<string, Tpl> = { en: EN, hr: HR }
const tplFor = (lang: string): Tpl => TEMPLATES[lang] ?? TEMPLATES[lang.split('-')[0] ?? ''] ?? EN

const fill = (tpl: string, vars: Record<string, string | number>): string => {
  let s = tpl
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  return s
}
const cap = (s: string): string => (s.length > 0 ? (s[0] as string).toLocaleUpperCase() + s.slice(1) : s)

/** The words that stand for an entity in a sentence: its alias, else its name (English adds `the` before a lower-case thing). */
export function phrase(p: Puzzle, id: string, who: Namer, lang: string): string {
  const alias = who.alias?.(id)
  if (alias) return alias
  const name = who.name(id)
  const cat = categoryOf(p, id)
  if (tplFor(lang).articles && p.kind === 'murdle' && cat !== 'suspect' && cat !== 'motive' && /^\p{Ll}/u.test(name)) return `the ${name}`
  return name
}

const catPair = (p: Puzzle, a: string, b: string): string => `${categoryOf(p, a)},${categoryOf(p, b)}`

/** One clue as a sentence in the edition's language. */
export function renderClue(p: Puzzle, clue: PuzzleClue, who: Namer, lang: string): string {
  const t = tplFor(lang)
  const P = (id: string): string => phrase(p, id, who, lang)
  const one = (v: string | string[]): string => (Array.isArray(v) ? (v[0] as string) : v)
  if (p.kind === 'logic') {
    const L = t.logic
    const a = clue.a
    const b = clue.b
    switch (clue.type) {
      case 'is':
        return cap(fill(L.is, { A: P(one(a)), B: P(one(b)) }))
      case 'not':
        return cap(fill(L.not, { A: P(one(a)), B: P(one(b)) }))
      case 'either':
        return cap(fill(L.either, { A: P(one(a)), B1: P((b as string[])[0] as string), B2: P((b as string[])[1] as string) }))
      case 'neither':
        return cap(fill(L.neither, { A: P(one(a)), B1: P((b as string[])[0] as string), B2: P((b as string[])[1] as string) }))
      case 'oneof':
        return cap(fill(L.oneof, { A1: P((a as string[])[0] as string), A2: P((a as string[])[1] as string), B1: P((b as string[])[0] as string), B2: P((b as string[])[1] as string) }))
      case 'before':
        return cap(fill(L.before, { A: P(one(a)), B: P(one(b)) }))
      case 'after':
        return cap(fill(L.after, { A: P(one(a)), B: P(one(b)) }))
      case 'apart':
        return cap(fill(L.apart, { A: P(one(a)), B: P(one(b)), n: clue.n ?? 1 })).replace(/ exactly 1 places apart/, ' exactly 1 place apart')
      default:
        throw new PuzzleError(`no sentence for a ${clue.type} clue`)
    }
  }
  const a = one(clue.a)
  const bs = Array.isArray(clue.b) ? clue.b : [clue.b]
  if (clue.type === 'either') {
    const frame = t.either[catPair(p, a, bs[0] as string)] ?? t.eitherAny
    return cap(fill(frame, { A: P(a), B1: P(bs[0] as string), B2: P(bs[1] as string) }))
  }
  // the pair is written in the order of the categories, as the generator does
  const idx = (id: string): number => p.categories.findIndex((c) => c.items.includes(id))
  const [first, second] = idx(a) < idx(bs[0] as string) ? [a, bs[0] as string] : [bs[0] as string, a]
  const frames = clue.type === 'not' ? t.not : t.is
  const frame = frames[catPair(p, first, second)] ?? (clue.type === 'not' ? t.notAny : t.isAny)
  return cap(fill(frame, { X: P(first), Y: P(second) }))
}

// ---- hints ----

export interface Hint {
  kind: 'wrong' | 'step' | 'accuse' | 'more'
  /** The cell the hint is about (`a|b`), or ''. */
  cell: string
  text: string
}

/**
 * The next deduction, from the clues that are face-up ONLY (a clue card still face-down is never leaked): a mark that is wrong first, else
 * the first step of the deduction that the marks do not show yet. 'more' when the turned clues say nothing new, 'accuse' when the grid is
 * complete.
 */
export function hintFor(p: Puzzle, turned: readonly string[], marks: Marks, who: Namer, lang: string): Hint {
  const t = tplFor(lang).hint
  const P = (id: string, c = false): string => (c ? cap(phrase(p, id, who, lang)) : phrase(p, id, who, lang))
  const truthMap = truth(p)
  for (const c of allCells(p)) {
    const m = markOf(marks, c)
    if (m && m !== truthMap[c]) {
      const [a, b] = cellItems(c)
      return { kind: 'wrong', cell: c, text: fill(t.wrong, { A: P(a), B: P(b) }) }
    }
  }
  const clues = p.clues.filter((c) => turned.includes(c.id))
  const res = deduce(p, clues)
  for (const step of res.steps as Step[]) {
    const [a, b] = step.cell as [string, string]
    const key = `${a}|${b}`
    if (markOf(marks, key) === step.value) continue
    const yes = step.value === 'yes'
    const tail = fill(yes ? t.yes : t.no, { A: P(a), B: P(b) })
    let text: string
    const clueLine = (): string => {
      const cl = p.clues.find((c) => c.id === step.clue)
      return cl ? fill(t.clue, { n: cl.id.slice(1), text: renderClue(p, cl, who, lang) }) : ''
    }
    if (step.rule === 'clue') text = `${clueLine()} ${tail}`
    else if (step.rule === 'elim') {
      const f = (step.from as [string, string][])[0] as [string, string]
      text = fill(t.elim, { F0: P(f[0], true), F1: P(f[1]), A: P(a), B: P(b) })
    } else if (step.rule === 'last') text = fill(t.last, { A: P(a), B: P(b) })
    else if (step.rule === 'either') text = `${clueLine()} ${fill(t.either, { A: P(a), B: P(b) })}`
    else if (step.rule === 'order') text = `${clueLine()} ${fill(t.order, { A: P(a), B: P(b) })}`
    else if (step.rule === 'trans') {
      const [f1, f2] = step.from as [[string, string], [string, string]]
      const mid = f1.find((x) => f2.includes(x)) ?? f1[0]
      text = fill(t.trans, { A: P(a), B: P(b), M: P(mid), verb: yes ? t.verbYes : t.verbNo })
    } else text = tail
    return { kind: 'step', cell: key, text }
  }
  if (clues.length < p.clues.length) return { kind: 'more', cell: '', text: t.more }
  return { kind: 'accuse', cell: '', text: t.accuse }
}
