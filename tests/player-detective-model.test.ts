import { describe, expect, it } from 'vitest'
import { SeededRandom } from '../src/shared/puzzles'
import type { ChaseSection } from '../src/shared/shells/detective'
import { buildCase, accusationOf, yesCells, cycle, type Marks } from '../src/shared/shells/detective-case'
import {
  afterAnswer,
  caseAccuracy,
  chaseAccuracy,
  clockText,
  faceDown,
  heard,
  judge,
  legOptions,
  newCase,
  newChase,
  poolOf,
  travel,
  turned,
  turnedIds,
  CLOCK_START,
  HOURS_COLD,
  HOURS_PER_LEG
} from '../src/player/shells/detective/model'
import { checkAccuse } from '../src/shared/shells/detective-case'

/** The detective shell's pure state (EGS-14): a case in play and a chase in play. No DOM. */

const chase: ChaseSection = {
  final: true,
  suspect: 'k',
  start: 'a',
  map: 'm',
  width: 800,
  height: 600,
  places: ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, name: 'k', x: i, y: i })),
  route: [
    { from: 'a', to: 'b', item: 'i1', decoys: ['c', 'd', 'e', 'a'] },
    { from: 'b', to: 'c', item: 'i2', decoys: ['d'] }
  ]
}

describe('a case in play', () => {
  const p = buildCase({ kind: 'murdle', size: 3, seed: 3, band: 'easy' }).puzzle
  const check = (acc: Record<string, string>, marks: Marks) => checkAccuse(p, acc, marks)

  it('starts with every card face-down and turns a card only on a right answer', () => {
    let c = newCase(p.clues.length, 'r')
    expect(faceDown(c)).toEqual([1, 2, 3, 4, 5, 6])
    c = afterAnswer(c, 2, 'q1', false, 0)
    expect(turned(c)).toBe(0)
    expect(c.firstTry).toEqual({ q1: 0 })
    c = afterAnswer(c, 2, 'q1', true, 1) // the retry turns it, but the first try stays the score
    expect(turnedIds(c)).toEqual(['c2'])
    expect(c.firstTry).toEqual({ q1: 0 })
    expect(c.cards[1]).toBe('q1')
    expect(poolOf(['q1', 'q2', 'q3'], c)).toEqual(['q2', 'q3'])
  })

  it('stars come from the mean first-try score; hints cost nothing', () => {
    let c = newCase(2, 'r')
    expect(caseAccuracy(c)).toBe(0)
    c = afterAnswer(afterAnswer(c, 1, 'a', true, 1), 2, 'b', false, 0)
    expect(caseAccuracy(c)).toBe(0.5)
    expect(caseAccuracy({ firstTry: c.firstTry })).toBe(0.5)
  })

  it('refuses an accusation while a card is face-down, then asks for a pick, names only the wrong categories, and accepts the right one', () => {
    let c = newCase(p.clues.length, 'r')
    expect(judge(p, c, check)).toEqual({ kind: 'cards' })
    c = { ...c, cards: c.cards.map((_x, i) => `q${i}`) }
    expect(judge(p, c, check)).toEqual({ kind: 'pick' })
    const right = accusationOf(p) as Record<string, string>
    const other = p.categories.find((x) => x.key === 'weapon')?.items.find((i) => i !== right.weapon) as string
    expect(judge(p, { ...c, accusation: { ...right, weapon: other } }, check)).toEqual({ kind: 'wrong', wrong: ['weapon'] })
    expect(judge(p, { ...c, accusation: right }, check)).toEqual({ kind: 'right' })
  })

  it('a logic case is judged by its grid', () => {
    const lp = buildCase({ kind: 'logic', size: 3, seed: 1, band: 'easy' }).puzzle
    const lcheck = (acc: Record<string, string>, marks: Marks) => checkAccuse(lp, acc, marks)
    let c = { ...newCase(lp.clues.length, 'l'), cards: Array.from({ length: lp.clues.length }, () => 'q') }
    expect(judge(lp, c, lcheck).kind).toBe('wrong')
    let marks: Marks = {}
    for (const cell of yesCells(lp)) marks = cycle(cycle(marks, cell), cell)
    c = { ...c, marks }
    expect(judge(lp, c, lcheck)).toEqual({ kind: 'right' })
  })
})

describe('a chase in play', () => {
  it('offers the right place and at most 3 decoys, never the right one twice, in a fixed order per seed', () => {
    const a = legOptions(chase.route[0]!, new SeededRandom('x'))
    expect(a).toHaveLength(4)
    expect(a).toContain('b')
    expect(a.filter((x) => x === 'b')).toHaveLength(1)
    expect(legOptions(chase.route[0]!, new SeededRandom('x'))).toEqual(a)
    expect(legOptions(chase.route[1]!, new SeededRandom('x')).sort()).toEqual(['c', 'd'])
  })

  it('a wrong place is a cold trail: an hour, back where she was, the trail is never lost; the right place follows it', () => {
    const rng = new SeededRandom('y')
    let c = newChase(chase, rng)
    expect(c).toMatchObject({ at: 'a', leg: 0, hours: 0, heard: false, trail: ['a'], caught: false })
    c = heard(c, true, 1)
    expect(c.heard).toBe(true)
    const cold = travel(c, chase, 'd', rng)
    expect(cold.right).toBe(false)
    expect(cold.state).toMatchObject({ at: 'a', leg: 0, hours: HOURS_COLD, cold: 1, coldHere: true, trail: ['a'] })
    const warm = travel(cold.state, chase, 'b', rng)
    expect(warm.right).toBe(true)
    expect(warm.state).toMatchObject({ at: 'b', leg: 1, hours: HOURS_COLD + HOURS_PER_LEG, heard: false, coldHere: false, trail: ['a', 'b'], caught: false })
    expect(warm.state.scores).toEqual([1, 0]) // the clue answer, then the first travel choice (a miss)
  })

  it('a hazy witness costs an hour; the last place catches the suspect; accuracy is the mean of the first tries', () => {
    const rng = new SeededRandom('z')
    let c = heard(newChase(chase, rng), false, 0)
    expect(c.hours).toBe(HOURS_COLD)
    c = travel(c, chase, 'b', rng).state
    c = heard(c, true, 1)
    const end = travel(c, chase, 'c', rng)
    expect(end.state.caught).toBe(true)
    expect(end.state.options).toEqual([])
    expect(end.state.trail).toEqual(['a', 'b', 'c'])
    expect(end.state.scores).toEqual([0, 1, 1, 1])
    expect(chaseAccuracy(end.state)).toBe(0.75)
    expect(chaseAccuracy({ scores: [] })).toBe(0)
  })

  it('the clock starts at 08:00 and shows the day after midnight', () => {
    expect(CLOCK_START).toBe(8)
    expect(clockText(0)).toBe('08:00')
    expect(clockText(5)).toBe('13:00')
    expect(clockText(17)).toBe('01:00 (+1)')
  })
})
