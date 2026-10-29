import { lettersKey } from './match'
import { rngFor } from './prng'

/**
 * A crossword built by code from a word list and a seed: the pack stores only the words (catalog keys) and the seed, and the grid is
 * generated per language when the course is built or played. The same words and seed always give the same grid.
 *
 * Letters are the answer folded and upper-cased (`lettersKey`: accents removed, spaces and punctuation dropped), so a Croatian grid
 * has plain letters and the answer is compared the same way (see `checkCrossword`).
 *
 * Method: several attempts, each placing the longest word first and then every other word where it crosses the grid in the most
 * places without touching another word side by side; the attempt with the fewest unplaced words (then the smallest grid) wins.
 */

export interface PuzzleWord {
  id: string
  /** The answer as written in the language; the grid uses `lettersKey(answer)`. */
  answer: string
}

export type CrosswordDir = 'across' | 'down'

export interface CrosswordEntry {
  id: string
  /** The letters on the grid (folded, upper case). */
  answer: string
  row: number
  col: number
  dir: CrosswordDir
  /** The clue number printed in the first cell. An across and a down entry that start in the same cell share a number. */
  number: number
  length: number
}

export interface CrosswordGrid {
  width: number
  height: number
  /** Row-major; null is a black cell. */
  cells: (string | null)[][]
  entries: CrosswordEntry[]
  /** Ids of the words that could not be placed (too few shared letters, or the grid size limit). Empty is the goal. */
  unplaced: string[]
}

export interface CrosswordOptions {
  /** The grid is at most this many cells wide and high (default 15). */
  maxSize?: number
  /** How many layouts to try (default 24). */
  attempts?: number
}

interface Cell {
  ch: string
  across: boolean
  down: boolean
}
interface Placed {
  id: string
  letters: string
  r: number
  c: number
  dir: CrosswordDir
}

const key = (r: number, c: number): string => `${r},${c}`

/** How many cells of the word cross existing letters when placed here, or -1 when the placement is not allowed. */
function crossings(cells: Map<string, Cell>, letters: string[], r: number, c: number, dir: CrosswordDir): number {
  const dr = dir === 'down' ? 1 : 0
  const dc = dir === 'across' ? 1 : 0
  if (cells.has(key(r - dr, c - dc)) || cells.has(key(r + letters.length * dr, c + letters.length * dc))) return -1
  let n = 0
  for (let i = 0; i < letters.length; i++) {
    const rr = r + i * dr
    const cc = c + i * dc
    const cell = cells.get(key(rr, cc))
    if (cell) {
      if (cell.ch !== letters[i] || cell[dir]) return -1
      n++
    } else if (cells.has(key(rr + dc, cc + dr)) || cells.has(key(rr - dc, cc - dr))) {
      return -1
    }
  }
  return n
}

function put(cells: Map<string, Cell>, letters: string[], r: number, c: number, dir: CrosswordDir): void {
  const dr = dir === 'down' ? 1 : 0
  const dc = dir === 'across' ? 1 : 0
  letters.forEach((ch, i) => {
    const k = key(r + i * dr, c + i * dc)
    const cell = cells.get(k) ?? { ch, across: false, down: false }
    cell[dir] = true
    cells.set(k, cell)
  })
}

function bounds(cells: Map<string, Cell>): { r0: number; r1: number; c0: number; c1: number } {
  let r0 = Infinity
  let r1 = -Infinity
  let c0 = Infinity
  let c1 = -Infinity
  for (const k of cells.keys()) {
    const [r, c] = k.split(',').map(Number) as [number, number]
    r0 = Math.min(r0, r)
    r1 = Math.max(r1, r)
    c0 = Math.min(c0, c)
    c1 = Math.max(c1, c)
  }
  return { r0, r1, c0, c1 }
}

function attemptLayout(words: { id: string; letters: string }[], seed: number | string, attempt: number, maxSize: number): { placed: Placed[]; unplaced: string[]; area: number } {
  const rng = rngFor(seed, 'crossword', attempt)
  const order = [...words]
  if (attempt > 0) rng.shuffle(order)
  else order.sort((a, b) => b.letters.length - a.letters.length || a.id.localeCompare(b.id))
  const cells = new Map<string, Cell>()
  const placed: Placed[] = []
  let pending = order
  let first = true
  let progress = true
  while (pending.length > 0 && progress) {
    progress = false
    const still: typeof pending = []
    for (const w of pending) {
      const letters = Array.from(w.letters)
      if (first) {
        put(cells, letters, 0, 0, 'across')
        placed.push({ id: w.id, letters: w.letters, r: 0, c: 0, dir: 'across' })
        first = false
        progress = true
        continue
      }
      // every placement that crosses a placed word
      const options: { r: number; c: number; dir: CrosswordDir; n: number; area: number }[] = []
      for (const p of placed) {
        const pl = Array.from(p.letters)
        const dir: CrosswordDir = p.dir === 'across' ? 'down' : 'across'
        for (let i = 0; i < pl.length; i++) {
          for (let j = 0; j < letters.length; j++) {
            if (pl[i] !== letters[j]) continue
            const r = p.dir === 'across' ? p.r - j : p.r + i
            const c = p.dir === 'across' ? p.c + i : p.c - j
            const n = crossings(cells, letters, r, c, dir)
            if (n < 1) continue
            const dr = dir === 'down' ? 1 : 0
            const dc = dir === 'across' ? 1 : 0
            const b = bounds(cells)
            const r0 = Math.min(b.r0, r)
            const r1 = Math.max(b.r1, r + (letters.length - 1) * dr)
            const c0 = Math.min(b.c0, c)
            const c1 = Math.max(b.c1, c + (letters.length - 1) * dc)
            if (r1 - r0 + 1 > maxSize || c1 - c0 + 1 > maxSize) continue
            options.push({ r, c, dir, n, area: (r1 - r0 + 1) * (c1 - c0 + 1) })
          }
        }
      }
      if (options.length === 0) {
        still.push(w)
        continue
      }
      rng.shuffle(options)
      options.sort((a, b) => b.n - a.n || a.area - b.area)
      const best = options[0]!
      put(cells, letters, best.r, best.c, best.dir)
      placed.push({ id: w.id, letters: w.letters, r: best.r, c: best.c, dir: best.dir })
      progress = true
    }
    pending = still
  }
  const b = cells.size > 0 ? bounds(cells) : { r0: 0, r1: -1, c0: 0, c1: -1 }
  return { placed, unplaced: pending.map((w) => w.id), area: (b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1) }
}

/** Builds the crossword for these words. Words shorter than 2 letters, or whose id repeats, are reported as unplaced. */
export function generateCrossword(words: readonly PuzzleWord[], seed: number | string, opts: CrosswordOptions = {}): CrosswordGrid {
  const maxSize = opts.maxSize ?? 15
  const usable: { id: string; letters: string }[] = []
  const rejected: string[] = []
  const seen = new Set<string>()
  for (const w of words) {
    const letters = lettersKey(w.answer)
    if (letters.length < 2 || seen.has(w.id) || letters.length > maxSize) rejected.push(w.id)
    else usable.push({ id: w.id, letters })
    seen.add(w.id)
  }
  let best: ReturnType<typeof attemptLayout> | null = null
  const attempts = Math.max(1, opts.attempts ?? 24)
  for (let a = 0; a < attempts && usable.length > 0; a++) {
    const r = attemptLayout(usable, seed, a, maxSize)
    if (!best || r.unplaced.length < best.unplaced.length || (r.unplaced.length === best.unplaced.length && r.area < best.area)) best = r
    if (best.unplaced.length === 0 && a >= 8) break
  }
  if (!best) return { width: 0, height: 0, cells: [], entries: [], unplaced: rejected }

  const cells = new Map<string, Cell>()
  for (const p of best.placed) put(cells, Array.from(p.letters), p.r, p.c, p.dir)
  const b = bounds(cells)
  const height = b.r1 - b.r0 + 1
  const width = b.c1 - b.c0 + 1
  const grid: (string | null)[][] = Array.from({ length: height }, () => Array<string | null>(width).fill(null))
  for (const [k, cell] of cells) {
    const [r, c] = k.split(',').map(Number) as [number, number]
    grid[r - b.r0]![c - b.c0] = cell.ch
  }
  const entries: CrosswordEntry[] = best.placed.map((p) => ({ id: p.id, answer: p.letters, row: p.r - b.r0, col: p.c - b.c0, dir: p.dir, number: 0, length: Array.from(p.letters).length }))
  // numbers: row-major over the cells where an entry starts
  let n = 0
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const starting = entries.filter((e) => e.row === r && e.col === c)
      if (starting.length === 0) continue
      n++
      for (const e of starting) e.number = n
    }
  }
  entries.sort((a, b2) => a.number - b2.number || (a.dir === 'across' ? -1 : 1))
  return { width, height, cells: grid, entries, unplaced: [...rejected, ...best.unplaced] }
}

/** Problems of a generated grid (empty when it is a valid crossword of these words). */
export function verifyCrossword(grid: CrosswordGrid, words: readonly PuzzleWord[]): string[] {
  const problems: string[] = []
  const byId = new Map(grid.entries.map((e) => [e.id, e]))
  for (const w of words) {
    const letters = lettersKey(w.answer)
    const e = byId.get(w.id)
    if (!e) {
      if (!grid.unplaced.includes(w.id)) problems.push(`word ${w.id} is neither placed nor reported unplaced`)
      continue
    }
    if (e.answer !== letters) problems.push(`entry ${w.id} has other letters than its word`)
  }
  const cellAt = (r: number, c: number): string | null => grid.cells[r]?.[c] ?? null
  const covered = new Set<string>()
  for (const e of grid.entries) {
    for (let i = 0; i < e.length; i++) {
      const r = e.row + (e.dir === 'down' ? i : 0)
      const c = e.col + (e.dir === 'across' ? i : 0)
      if (cellAt(r, c) !== Array.from(e.answer)[i]) problems.push(`entry ${e.id} does not match the grid at ${r},${c}`)
      covered.add(key(r, c))
    }
  }
  for (let r = 0; r < grid.height; r++) {
    for (let c = 0; c < grid.width; c++) {
      if (cellAt(r, c) !== null && !covered.has(key(r, c))) problems.push(`cell ${r},${c} belongs to no entry`)
    }
  }
  // every run of two or more letters is an entry (no accidental words)
  const isEntry = (r: number, c: number, dir: CrosswordDir, len: number): boolean => grid.entries.some((e) => e.row === r && e.col === c && e.dir === dir && e.length === len)
  for (let r = 0; r < grid.height; r++) {
    for (let c = 0; c < grid.width; c++) {
      if (cellAt(r, c) === null) continue
      for (const dir of ['across', 'down'] as const) {
        const pr = dir === 'down' ? r - 1 : r
        const pc = dir === 'across' ? c - 1 : c
        if (cellAt(pr, pc) !== null) continue
        let len = 0
        while (cellAt(r + (dir === 'down' ? len : 0), c + (dir === 'across' ? len : 0)) !== null) len++
        if (len >= 2 && !isEntry(r, c, dir, len)) problems.push(`a run of ${len} letters at ${r},${c} (${dir}) is not an entry`)
      }
    }
  }
  // one connected piece
  if (grid.entries.length > 1) {
    const parent = new Map<string, string>()
    const find = (x: string): string => {
      let p = x
      while (parent.get(p) !== p) p = parent.get(p)!
      return p
    }
    for (const e of grid.entries) parent.set(e.id, e.id)
    const owner = new Map<string, string>()
    for (const e of grid.entries) {
      for (let i = 0; i < e.length; i++) {
        const k = key(e.row + (e.dir === 'down' ? i : 0), e.col + (e.dir === 'across' ? i : 0))
        const o = owner.get(k)
        if (o !== undefined) parent.set(find(e.id), find(o))
        else owner.set(k, e.id)
      }
    }
    if (new Set(grid.entries.map((e) => find(e.id))).size > 1) problems.push('the crossword is not one connected piece')
  }
  return problems
}

/** The clue numbers of the entries, `{ across: [...], down: [...] }`, for printing the clue list. */
export function clueNumbers(grid: CrosswordGrid): { across: CrosswordEntry[]; down: CrosswordEntry[] } {
  return { across: grid.entries.filter((e) => e.dir === 'across'), down: grid.entries.filter((e) => e.dir === 'down') }
}
