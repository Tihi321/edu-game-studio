import { describe, expect, it } from 'vitest'
import {
  generateCrossword,
  generateWordSearch,
  lettersKey,
  placementSelection,
  readSelection,
  verifyCrossword,
  verifyWordSearch,
  WORD_SEARCH_DIRS,
  type PuzzleWord
} from '../src/shared/edu'

const w = (...answers: string[]): PuzzleWord[] => answers.map((a, i) => ({ id: `w${i}`, answer: a }))
const PLANETS = w('Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune')
const PLANETS_HR = w('Merkur', 'Venera', 'Zemlja', 'Mars', 'Jupiter', 'Saturn', 'Uran', 'Neptun')

describe('crossword generator', () => {
  it('is deterministic for a seed', () => {
    const a = generateCrossword(PLANETS, 7)
    const b = generateCrossword(PLANETS, 7)
    expect(b).toEqual(a)
    const grids = new Set([1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(generateCrossword(PLANETS, s).cells)))
    expect(grids.size).toBeGreaterThan(1)
  })
  it('places every word and verifies, for 40 seeds, in English and Croatian', () => {
    for (let seed = 0; seed < 40; seed++) {
      for (const words of [PLANETS, PLANETS_HR]) {
        const g = generateCrossword(words, seed)
        expect(g.unplaced).toEqual([])
        expect(g.entries).toHaveLength(words.length)
        expect(verifyCrossword(g, words)).toEqual([])
        expect(g.width).toBeLessThanOrEqual(15)
        expect(g.height).toBeLessThanOrEqual(15)
      }
    }
  })
  it('lays accents folded: a Croatian answer uses plain upper-case letters', () => {
    const g = generateCrossword(w('Zemlja', 'Mjesec', 'Sunce', 'Živjeli'), 3)
    expect(g.unplaced).toEqual([])
    expect(g.entries.find((e) => e.id === 'w3')!.answer).toBe('ZIVJELI')
    expect(g.cells.flat().every((c) => c === null || /^[A-Z]$/.test(c))).toBe(true)
    expect(verifyCrossword(g, w('Zemlja', 'Mjesec', 'Sunce', 'Živjeli'))).toEqual([])
  })
  it('numbers the entries row-major and shares a number between an across and a down entry that start together', () => {
    const g = generateCrossword(PLANETS, 7)
    const numbers = g.entries.map((e) => e.number)
    expect(Math.min(...numbers)).toBe(1)
    expect([...numbers]).toEqual([...numbers].sort((x, y) => x - y))
    // an entry's number is the same as the rank of its start cell among all start cells
    const starts = [...new Set(g.entries.map((e) => `${e.row},${e.col}`))].sort((p, q) => {
      const [pr, pc] = p.split(',').map(Number) as [number, number]
      const [qr, qc] = q.split(',').map(Number) as [number, number]
      return pr - qr || pc - qc
    })
    for (const e of g.entries) expect(e.number).toBe(starts.indexOf(`${e.row},${e.col}`) + 1)
  })
  it('reports a word that shares no letter with the others as unplaced, and short or repeated words too', () => {
    const words: PuzzleWord[] = [...w('Mars', 'Earth'), { id: 'x', answer: 'Qiq' }, { id: 'one', answer: 'A' }, { id: 'w0', answer: 'Mars' }]
    const g = generateCrossword(words, 1)
    expect(g.unplaced).toContain('x')
    expect(g.unplaced).toContain('one')
    expect(g.unplaced).toContain('w0') // the id repeats
    expect(g.entries.map((e) => e.id).sort()).toEqual(['w0', 'w1'])
  })
  it('respects maxSize', () => {
    const g = generateCrossword(PLANETS, 2, { maxSize: 9 })
    expect(g.width).toBeLessThanOrEqual(9)
    expect(g.height).toBeLessThanOrEqual(9)
    expect(generateCrossword(w('Jupiter', 'Mars', 'Earth'), 2, { maxSize: 5 }).unplaced).toContain('w0')
  })
  it('verification catches a damaged grid', () => {
    const g = generateCrossword(PLANETS, 7)
    const bad = structuredClone(g)
    const e = bad.entries[0]!
    bad.cells[e.row]![e.col] = e.answer[0] === 'Q' ? 'Z' : 'Q'
    expect(verifyCrossword(bad, PLANETS).length).toBeGreaterThan(0)
    const stray = structuredClone(g)
    stray.cells[0]![0] = stray.cells[0]![0] === null ? 'Q' : null
    expect(verifyCrossword(stray, PLANETS).length).toBeGreaterThan(0)
  })
  it('handles an empty list', () => {
    expect(generateCrossword([], 1)).toMatchObject({ width: 0, height: 0, entries: [], unplaced: [] })
  })
})

describe('word-search generator', () => {
  it('is deterministic for a seed', () => {
    expect(generateWordSearch(PLANETS, 11)).toEqual(generateWordSearch(PLANETS, 11))
    expect(generateWordSearch(PLANETS, 11).cells).not.toEqual(generateWordSearch(PLANETS, 12).cells)
  })
  it('places every word, reads each back and fills with letters, for 40 seeds and every direction set', () => {
    for (const directions of ['forward', 'diagonal', 'all'] as const) {
      for (let seed = 0; seed < 40; seed++) {
        for (const words of [PLANETS, PLANETS_HR]) {
          const g = generateWordSearch(words, seed, { directions })
          expect(g.unplaced).toEqual([])
          expect(g.placements).toHaveLength(words.length)
          expect(verifyWordSearch(g, words)).toEqual([])
          const allowed = WORD_SEARCH_DIRS[directions].map(([r, c]) => `${r},${c}`)
          for (const p of g.placements) expect(allowed).toContain(`${p.dr},${p.dc}`)
        }
      }
    }
  })
  it('uses folded upper-case letters', () => {
    const words = w('Večer', 'Noć', 'Đak', 'Živjeli')
    const g = generateWordSearch(words, 4)
    expect(g.cells.flat().every((c) => /^[A-Z]$/.test(c))).toBe(true)
    expect(g.placements.find((p) => p.id === 'w2')!.answer).toBe('DAK')
    expect(verifyWordSearch(g, words)).toEqual([])
  })
  it('the placement selection reads the word, forwards or backwards', () => {
    const g = generateWordSearch(PLANETS, 5, { directions: 'all' })
    for (const p of g.placements) {
      const sel = placementSelection(p)
      expect(readSelection(g, sel)).toBe(p.answer)
      const rev = readSelection(g, { start: sel.end, end: sel.start })
      expect(rev).toBe(Array.from(p.answer).reverse().join(''))
    }
  })
  it('readSelection refuses a bent line and leaving the grid', () => {
    const g = generateWordSearch(PLANETS, 5)
    expect(readSelection(g, { start: [0, 0], end: [2, 1] })).toBeNull()
    expect(readSelection(g, { start: [0, 0], end: [0, g.size] })).toBeNull()
    expect(readSelection(g, { start: [1, 1], end: [1, 1] })).toHaveLength(1)
  })
  it('honours an explicit size, grows the grid when none is given, and reports a word that cannot fit', () => {
    const g = generateWordSearch(PLANETS, 3, { size: 12 })
    expect(g.size).toBe(12)
    const long = generateWordSearch(w('Extraordinarily', 'Mars'), 3, { size: 8 })
    expect(long.unplaced).toEqual(['w0'])
    expect(long.size).toBe(8)
    expect(generateWordSearch(w('Extraordinarily', 'Mars'), 3).unplaced).toEqual([])
  })
  it('lettersKey is what both generators use', () => {
    expect(lettersKey('Do viđenja')).toBe('DOVIDENJA')
  })
})
