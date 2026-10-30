import type { SeededRandom } from '../../../shared/edu'
import { accusationKeys, type Marks, type Puzzle } from '../../../shared/shells/detective-case'
import type { ChaseSection } from '../../../shared/shells/detective'
import type { RoundState } from '../../round'

/**
 * The detective shell's pure state (no DOM, so node tests cover it): a case in play (clue cards, marks, accusation, first-try scores) and
 * a chase in play (place, clock, the witness, the trail). The DOM files read and replace these; every function returns a new value.
 */

// ---- a case ----

export interface CaseState {
  roomId: string
  /** Clue card n (index n-1): the item that turned it, or null while it is face-down. */
  cards: (string | null)[]
  /** The current question run (adaptive pick, a miss comes back after 2-4 others); a new one starts when it is used up. */
  run: RoundState | null
  /** Items asked at least once in this case: a later ask of the same item is a retry (half points, not first-try). */
  seen: string[]
  /** Item id -> score (0..1) of its FIRST answer in this case: the stars come from their mean. */
  firstTry: Record<string, number>
  marks: Marks
  hints: number
  accusation: Record<string, string>
  wrongAccusations: number
  solved: boolean
}

export function newCase(clues: number, roomId: string): CaseState {
  return { roomId, cards: Array.from({ length: clues }, () => null), run: null, seen: [], firstTry: {}, marks: {}, hints: 0, accusation: {}, wrongAccusations: 0, solved: false }
}

export const faceDown = (c: Pick<CaseState, 'cards'>): number[] => c.cards.flatMap((x, i) => (x === null ? [i + 1] : []))
export const turned = (c: Pick<CaseState, 'cards'>): number => c.cards.filter((x) => x !== null).length
/** The clue ids (`c3`) of the cards that are face-up. */
export const turnedIds = (c: Pick<CaseState, 'cards'>): string[] => c.cards.flatMap((x, i) => (x === null ? [] : [`c${i + 1}`]))
/** Items that have turned a card: never asked again in this case. */
export const usedItems = (c: Pick<CaseState, 'cards'>): string[] => c.cards.filter((x): x is string => x !== null)

/** The items a new run may ask: the case's items minus those that already turned a card. */
export const poolOf = (items: readonly string[], c: Pick<CaseState, 'cards'>): string[] => {
  const used = new Set(usedItems(c))
  return items.filter((i) => !used.has(i))
}

/** Mean first-try score of the clue questions, 0..1 (hints cost nothing: they are help, not failure). */
export function caseAccuracy(c: Pick<CaseState, 'firstTry'>): number {
  const v = Object.values(c.firstTry)
  return v.length === 0 ? 0 : v.reduce((s, x) => s + x, 0) / v.length
}

/** The case after an answer: the card turns on a right answer; the first answer to an item is remembered for the stars. */
export function afterAnswer(c: CaseState, card: number, itemId: string, correct: boolean, score: number): CaseState {
  const first = !c.seen.includes(itemId)
  return {
    ...c,
    seen: first ? [...c.seen, itemId] : c.seen,
    firstTry: first ? { ...c.firstTry, [itemId]: score } : c.firstTry,
    cards: correct ? c.cards.map((x, i) => (i === card - 1 ? itemId : x)) : c.cards
  }
}

export type AccuseVerdict = { kind: 'cards' } | { kind: 'pick' } | { kind: 'wrong'; wrong: string[] } | { kind: 'right' }

/**
 * What an accusation does. Face-down cards reject it (the evidence is incomplete: guessing cannot beat the course questions); a murdle
 * accusation must name one per category; anything wrong is named by category only ("the weapon"), never the answer.
 */
export function judge(p: Puzzle, c: CaseState, check: (accusation: Record<string, string>, marks: Marks) => { correct: boolean; wrong: string[] }): AccuseVerdict {
  if (faceDown(c).length > 0) return { kind: 'cards' }
  if (p.kind === 'murdle' && accusationKeys(p).some((k) => !c.accusation[k])) return { kind: 'pick' }
  const r = check(c.accusation, c.marks)
  return r.correct ? { kind: 'right' } : { kind: 'wrong', wrong: r.wrong }
}

// ---- the chase ----

export interface ChaseState {
  /** The place the suspect was last traced to (where the learner stands). */
  at: string
  /** The leg being followed (index into the route). */
  leg: number
  /** Hours since the chase began. */
  hours: number
  /** The clue item of this leg was answered and the witness has spoken. */
  heard: boolean
  /** The travel choices of this leg (the right place among the decoys, shuffled once). */
  options: string[]
  cold: number
  coldHere: boolean
  trail: string[]
  caught: boolean
  /** First-try scores: the clue item of each leg, and the first travel choice of each leg (1 right, 0 cold). */
  scores: number[]
  /** The leg's first travel choice is still to come. */
  firstChoice: boolean
}

export const CLOCK_START = 8
export const HOURS_PER_LEG = 2
export const HOURS_COLD = 1

/** The 4 choices at most: the right place and up to 3 decoys, in a fixed shuffled order per leg. */
export function legOptions(leg: ChaseSection['route'][number], rng: SeededRandom): string[] {
  const decoys = [...new Set(leg.decoys.filter((d) => d !== leg.to))].slice(0, 3)
  return rng.shuffle([leg.to, ...decoys])
}

export function newChase(ch: ChaseSection, rng: SeededRandom): ChaseState {
  return { at: ch.start, leg: 0, hours: 0, heard: false, options: legOptions(ch.route[0] as ChaseSection['route'][number], rng), cold: 0, coldHere: false, trail: [ch.start], caught: false, scores: [], firstChoice: true }
}

/** The clue item of the leg was answered: the witness speaks. A hazy (wrong) answer costs an hour. */
export function heard(c: ChaseState, correct: boolean, score: number): ChaseState {
  return { ...c, heard: true, hours: c.hours + (correct ? 0 : HOURS_COLD), scores: [...c.scores, score] }
}

/** Travel to a place: the right one follows the trail (two hours); a decoy is a cold trail (an hour) and you are back where you were. */
export function travel(c: ChaseState, ch: ChaseSection, place: string, rng: SeededRandom): { state: ChaseState; right: boolean } {
  const leg = ch.route[c.leg] as ChaseSection['route'][number]
  if (place !== leg.to) {
    return { right: false, state: { ...c, hours: c.hours + HOURS_COLD, cold: c.cold + 1, coldHere: true, scores: c.firstChoice ? [...c.scores, 0] : c.scores, firstChoice: false } }
  }
  const next = c.leg + 1
  const caught = next >= ch.route.length
  return {
    right: true,
    state: {
      ...c,
      at: leg.to,
      leg: next,
      hours: c.hours + HOURS_PER_LEG,
      heard: false,
      coldHere: false,
      trail: [...c.trail, leg.to],
      caught,
      scores: c.firstChoice ? [...c.scores, 1] : c.scores,
      firstChoice: true,
      options: caught ? [] : legOptions(ch.route[next] as ChaseSection['route'][number], rng)
    }
  }
}

export const chaseAccuracy = (c: Pick<ChaseState, 'scores'>): number => (c.scores.length === 0 ? 0 : c.scores.reduce((s, x) => s + x, 0) / c.scores.length)

/** "10:00", or "Day 2, 02:00" once the chase runs past midnight. */
export function clockText(hours: number): string {
  const total = CLOCK_START + hours
  const h = total % 24
  const day = Math.floor(total / 24) + 1
  const t = `${String(h).padStart(2, '0')}:00`
  return day > 1 ? `${t} (+${day - 1})` : t
}
