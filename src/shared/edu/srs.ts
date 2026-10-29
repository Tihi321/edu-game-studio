/**
 * Spaced repetition: SM-2 (SuperMemo 2, Wozniak 1990), chosen over FSRS because it is small, has no trained parameters and its intervals
 * can be pinned exactly in tests. Pure TypeScript: the caller passes `now` (a Date or epoch milliseconds), nothing here reads the clock.
 *
 * Grades map to SM-2 quality q: again = 2 (a lapse), hard = 3, good = 4, easy = 5.
 *   - A lapse (q < 3) restarts the card: reps 0, interval 1 day, `lapses` + 1.
 *   - Otherwise the interval is 1 day after the first success, 6 days after the second, then `round(previous interval * ease)`.
 *   - The ease factor always moves by `0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)` (again -0.32, hard -0.14, good 0, easy +0.10), never below 1.3.
 * Two things SM-2 does not have, for a game: a short-step queue inside one session (`SessionQueue` below: a missed item comes back after
 * 2 to 4 other items) and a `mastery` stage for the unit gate.
 */

export const GRADES = ['again', 'hard', 'good', 'easy'] as const
export type Grade = (typeof GRADES)[number]
export const isGrade = (v: unknown): v is Grade => typeof v === 'string' && (GRADES as readonly string[]).includes(v)

export const DAY_MS = 86_400_000
export const MIN_EASE = 1.3
export const START_EASE = 2.5

const QUALITY: Record<Grade, number> = { again: 2, hard: 3, good: 4, easy: 5 }

export interface Card {
  /** The item id (or any id the caller schedules). */
  id: string
  /** SM-2 easiness factor. */
  ease: number
  /** Days until the next review. 0 for a card never reviewed. */
  interval: number
  /** Successful reviews in a row. */
  reps: number
  lapses: number
  /** Epoch milliseconds when the card is due. */
  due: number
  /** Epoch milliseconds of the last review, or null. */
  last: number | null
}

const ms = (now: Date | number): number => (typeof now === 'number' ? now : now.getTime())
const round2 = (n: number): number => Math.round(n * 100) / 100

/** A new card, due now. */
export function newCard(id: string, now: Date | number = 0): Card {
  return { id, ease: START_EASE, interval: 0, reps: 0, lapses: 0, due: ms(now), last: null }
}

/** The card after one review. Does not change the input. */
export function schedule(card: Card, grade: Grade, now: Date | number): Card {
  const t = ms(now)
  const q = QUALITY[grade]
  const ease = Math.max(MIN_EASE, round2(card.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))))
  if (q < 3) {
    return { ...card, ease, interval: 1, reps: 0, lapses: card.lapses + 1, due: t + DAY_MS, last: t }
  }
  const reps = card.reps + 1
  const interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(card.interval * ease)
  return { ...card, ease, interval, reps, due: t + interval * DAY_MS, last: t }
}

/** Cards due at `now`, the most overdue first (ties by id, so the order is stable). */
export function dueCards(cards: readonly Card[], now: Date | number): Card[] {
  const t = ms(now)
  return cards.filter((c) => c.due <= t).sort((a, b) => a.due - b.due || a.id.localeCompare(b.id))
}

/** New, learning (under 3 successes in a row), young (interval under 21 days) or mature: what the unit gate and the progress bars use. */
export function mastery(card: Card): 'new' | 'learning' | 'young' | 'mature' {
  if (card.last === null) return 'new'
  if (card.reps < 3) return 'learning'
  return card.interval >= 21 ? 'mature' : 'young'
}

// ---- inside one session ----

export interface SessionPending {
  id: string
  /** The card comes back once this many answers were given in the session. */
  dueAt: number
  /** Misses of this item in the session. */
  misses: number
}

export interface SessionQueue {
  /** Answers given so far in this session. */
  answered: number
  pending: SessionPending[]
  /** Misses per item id, kept after the item leaves `pending`. */
  misses: Record<string, number>
}

export const newSession = (): SessionQueue => ({ answered: 0, pending: [], misses: {} })

/** How many other items come between a miss and the retry: 2 after the first miss, 3 after the second, 4 from the third on. */
export const retryGap = (misses: number): number => Math.min(4, 1 + Math.max(1, misses))

/**
 * Records an answer. `again` puts the item back to return after `retryGap` other items; `hard`, `good` and `easy` take it out of the
 * pending list. (Cross-session scheduling is `schedule`, called by the caller with the same grade.)
 */
export function recordAnswer(session: SessionQueue, id: string, grade: Grade): SessionQueue {
  const answered = session.answered + 1
  const rest = session.pending.filter((p) => p.id !== id)
  if (grade !== 'again') return { answered, pending: rest, misses: session.misses }
  const misses = (session.misses[id] ?? 0) + 1
  return { answered, pending: [...rest, { id, dueAt: answered + retryGap(misses), misses }], misses: { ...session.misses, [id]: misses } }
}

/**
 * The next item: a missed item whose gap has passed comes first (the longest waiting first); else the next fresh item; when no fresh
 * item is left the earliest pending one is repeated. null when everything is done.
 */
export function nextItem(session: SessionQueue, fresh: readonly string[]): string | null {
  const due = session.pending.filter((p) => p.dueAt <= session.answered).sort((a, b) => a.dueAt - b.dueAt)[0]
  if (due) return due.id
  const next = fresh.find((id) => !session.pending.some((p) => p.id === id))
  if (next !== undefined) return next
  const first = [...session.pending].sort((a, b) => a.dueAt - b.dueAt)[0]
  return first ? first.id : null
}
