import type { PuzzleWord } from './crossword'
import { lettersKey } from './match'
import { rngFor } from './prng'

/**
 * A word search built by code from a word list and a seed: the same words and seed always give the same grid. Letters are folded and
 * upper-cased (`lettersKey`), so a Croatian puzzle has plain letters. The filler letters are drawn from the letters of the words
 * themselves, so the grid looks like the language.
 */

export type WordSearchDirections = 'forward' | 'diagonal' | 'all'

/** [rowStep, colStep] of each allowed direction. */
export const WORD_SEARCH_DIRS: Record<WordSearchDirections, readonly (readonly [number, number])[]> = {
  forward: [
    [0, 1],
    [1, 0]
  ],
  diagonal: [
    [0, 1],
    [1, 0],
    [1, 1],
    [-1, 1]
  ],
  all: [
    [0, 1],
    [1, 0],
    [1, 1],
    [-1, 1],
    [0, -1],
    [-1, 0],
    [-1, -1],
    [1, -1]
  ]
}

export interface WordSearchPlacement {
  id: string
  /** The letters hidden in the grid. */
  answer: string
  row: number
  col: number
  dr: number
  dc: number
}

export interface WordSearchGrid {
  size: number
  /** `cells[row][col]`, one upper-case letter each. */
  cells: string[][]
  placements: WordSearchPlacement[]
  /** Words that did not fit (empty is the goal). */
  unplaced: string[]
}

export interface WordSearchOptions {
  size?: number
  directions?: WordSearchDirections
}

export type Point = [row: number, col: number]
/** What the player selects: the first and the last cell of a straight line. */
export interface Selection {
  start: Point
  end: Point
}

/** The default grid side for these words: roomy enough to place them all, never smaller than the longest word or 6. */
export function defaultSize(lengths: readonly number[]): number {
  const total = lengths.reduce((s, n) => s + n, 0)
  return Math.max(6, ...lengths, Math.ceil(Math.sqrt(total * 2.4)))
}

function tryLayout(words: { id: string; letters: string[] }[], size: number, dirs: readonly (readonly [number, number])[], seed: number | string, attempt: number): { cells: (string | null)[][]; placements: WordSearchPlacement[]; unplaced: string[] } {
  const rng = rngFor(seed, 'wordsearch', size, attempt)
  const cells: (string | null)[][] = Array.from({ length: size }, () => Array<string | null>(size).fill(null))
  const placements: WordSearchPlacement[] = []
  const unplaced: string[] = []
  const order = [...words].sort((a, b) => b.letters.length - a.letters.length || a.id.localeCompare(b.id))
  for (const w of order) {
    let done = false
    for (let t = 0; t < 400 && !done; t++) {
      const [dr, dc] = rng.choice(dirs)
      const r = rng.randrange(size)
      const c = rng.randrange(size)
      const er = r + dr * (w.letters.length - 1)
      const ec = c + dc * (w.letters.length - 1)
      if (er < 0 || er >= size || ec < 0 || ec >= size) continue
      let ok = true
      for (let i = 0; i < w.letters.length && ok; i++) {
        const cur = cells[r + dr * i]![c + dc * i]
        if (cur !== null && cur !== w.letters[i]) ok = false
      }
      if (!ok) continue
      w.letters.forEach((ch, i) => {
        cells[r + dr * i]![c + dc * i] = ch
      })
      placements.push({ id: w.id, answer: w.letters.join(''), row: r, col: c, dr, dc })
      done = true
    }
    if (!done) unplaced.push(w.id)
  }
  return { cells, placements, unplaced }
}

/** Builds the word search. Words shorter than 2 letters, longer than the grid or with a repeated id are reported as unplaced. */
export function generateWordSearch(words: readonly PuzzleWord[], seed: number | string, opts: WordSearchOptions = {}): WordSearchGrid {
  const dirs = WORD_SEARCH_DIRS[opts.directions ?? 'diagonal']
  const usable: { id: string; letters: string[] }[] = []
  const rejected: string[] = []
  const seen = new Set<string>()
  for (const w of words) {
    const letters = Array.from(lettersKey(w.answer))
    if (letters.length < 2 || seen.has(w.id)) rejected.push(w.id)
    else usable.push({ id: w.id, letters })
    seen.add(w.id)
  }
  const base = opts.size ?? defaultSize(usable.map((w) => w.letters.length))
  const sizes = opts.size ? [opts.size] : [base, base + 1, base + 2, base + 3]
  let best: ReturnType<typeof tryLayout> | null = null
  let bestSize = base
  for (const size of sizes) {
    for (let a = 0; a < 12; a++) {
      const r = tryLayout(usable.filter((w) => w.letters.length <= size), size, dirs, seed, a)
      const unplacedAll = [...r.unplaced, ...usable.filter((w) => w.letters.length > size).map((w) => w.id)]
      if (!best || unplacedAll.length < best.unplaced.length) {
        best = { ...r, unplaced: unplacedAll }
        bestSize = size
      }
      if (best.unplaced.length === 0) break
    }
    if (best && best.unplaced.length === 0) break
  }
  const size = bestSize
  const cells = best?.cells ?? Array.from({ length: size }, () => Array<string | null>(size).fill(null))
  const pool = usable.flatMap((w) => w.letters)
  const fill = rngFor(seed, 'wordsearch-fill', size)
  const filled = cells.map((row) => row.map((ch) => ch ?? (pool.length > 0 ? fill.choice(pool) : 'A')))
  return { size, cells: filled, placements: best?.placements ?? [], unplaced: [...rejected, ...(best?.unplaced ?? [])] }
}

/** The letters along a straight line from `start` to `end` (horizontal, vertical or diagonal), or null if it is not a line or leaves the grid. */
export function readSelection(grid: Pick<WordSearchGrid, 'size' | 'cells'>, sel: Selection): string | null {
  const [r0, c0] = sel.start
  const [r1, c1] = sel.end
  const dr = Math.sign(r1 - r0)
  const dc = Math.sign(c1 - c0)
  const len = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0)) + 1
  if (Math.abs(r1 - r0) !== 0 && Math.abs(c1 - c0) !== 0 && Math.abs(r1 - r0) !== Math.abs(c1 - c0)) return null
  let out = ''
  for (let i = 0; i < len; i++) {
    const ch = grid.cells[r0 + dr * i]?.[c0 + dc * i]
    if (ch === undefined) return null
    out += ch
  }
  return out
}

/** The selection that marks a placement. */
export function placementSelection(p: WordSearchPlacement): Selection {
  const n = Array.from(p.answer).length - 1
  return { start: [p.row, p.col], end: [p.row + p.dr * n, p.col + p.dc * n] }
}

/** Problems of a generated grid (empty when every placed word reads back and the cells are all letters). */
export function verifyWordSearch(grid: WordSearchGrid, words: readonly PuzzleWord[]): string[] {
  const problems: string[] = []
  if (grid.cells.length !== grid.size || grid.cells.some((r) => r.length !== grid.size)) problems.push('the grid is not square')
  for (const w of words) {
    const p = grid.placements.find((x) => x.id === w.id)
    if (!p) {
      if (!grid.unplaced.includes(w.id)) problems.push(`word ${w.id} is neither placed nor reported unplaced`)
      continue
    }
    if (readSelection(grid, placementSelection(p)) !== lettersKey(w.answer)) problems.push(`word ${w.id} does not read back from its placement`)
  }
  for (const row of grid.cells) for (const ch of row) if (!/^\p{L}$/u.test(ch)) problems.push(`a cell holds ${JSON.stringify(ch)}, not a letter`)
  return problems
}
