import type { CourseItem, CoursePack } from '../shared/course'
import { objectivesOf } from '../shared/course'
import {
  isGrade,
  newAdaptive,
  newSession,
  pickItem,
  recordAnswer,
  recordOutcome,
  type AdaptiveState,
  type CheckResult,
  type Grade,
  type SeededRandom,
  type SessionQueue
} from '../shared/edu'
import type { Card } from '../shared/edu'
import type { RoundKind } from './types'

/**
 * Round logic of the quiz arena, pure (no DOM, no clock: `now` is passed, randomness comes from the caller's `SeededRandom`).
 *
 *  - A round has `size` FRESH questions. The next one is chosen live: a missed item whose gap has passed comes back first (the in-session
 *    queue of `srs.ts`: after 2, then 3, then 4 other questions; at most `MAX_RETRIES` returns per item), else a fresh item chosen by the
 *    adaptive difficulty (`adaptive.ts`), preferring items whose spaced-repetition card is due (at most half the round), and never the
 *    same kind (or, in a boss round, the same unit) twice in a row when anything else is left (interleaving).
 *  - Accuracy for the stars counts only FIRST attempts of fresh questions (score 0..1 each), so a retry never inflates the stars.
 */

export const MAX_RETRIES = 2
export const DEFAULT_ROUND_LENGTH = 7
export const DEFAULT_BOSS_LENGTH = 10
export const DEFAULT_TIMER_SECONDS = 30

export interface QuizConfig {
  roundLength: number
  bossLength: number
  timerSeconds: number
}

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback)

/** `shells.config['quiz-arena']` of the pack, with defaults and limits (round 3 to 12 questions, boss 4 to 20, timer 5 to 120 s). */
export function quizConfig(pack: Pick<CoursePack, 'shells'>): QuizConfig {
  const c = (pack.shells.config['quiz-arena'] ?? {}) as Record<string, unknown>
  return {
    roundLength: clampInt(c.roundLength, 3, 12, DEFAULT_ROUND_LENGTH),
    bossLength: clampInt(c.bossLength, 4, 20, DEFAULT_BOSS_LENGTH),
    timerSeconds: clampInt(c.timerSeconds, 5, 120, DEFAULT_TIMER_SECONDS)
  }
}

export interface RoundResult {
  id: string
  kind: string
  retry: boolean
  correct: boolean
  /** 0..1 */
  score: number
  grade: Grade
}

export interface RoundState {
  kind: RoundKind
  unitId?: string
  /** Fresh questions planned. */
  size: number
  /** Eligible fresh items not asked yet (ids). */
  pool: string[]
  /** Fresh items asked, in order. */
  asked: string[]
  session: SessionQueue
  adaptive: AdaptiveState
  results: RoundResult[]
  /** How many of the fresh items came from a due spaced-repetition card. */
  dueTaken: number
}

/** The items asked for a unit (through the objective -> unit link). */
export function itemsOfUnit(pack: Pick<CoursePack, 'items' | 'objectives'>, unitId: string): CourseItem[] {
  const objectives = new Set(objectivesOf(pack, unitId).map((o) => o.id))
  return pack.items.filter((i) => objectives.has(i.objective))
}

export const unitOfItemId = (pack: Pick<CoursePack, 'items' | 'objectives'>, itemId: string): string | undefined => {
  const item = pack.items.find((i) => i.id === itemId)
  return pack.objectives.find((o) => o.id === item?.objective)?.unit
}

export function startRound(
  pack: Pick<CoursePack, 'items' | 'objectives' | 'units' | 'shells'>,
  kind: RoundKind,
  opts: { unitId?: string; queue?: readonly string[]; difficulty?: number } = {}
): RoundState {
  const cfg = quizConfig(pack)
  let pool: string[]
  let size: number
  if (kind === 'unit') {
    pool = itemsOfUnit(pack, opts.unitId ?? '').map((i) => i.id)
    size = Math.min(cfg.roundLength, pool.length)
  } else if (kind === 'boss') {
    pool = pack.items.map((i) => i.id)
    size = Math.min(cfg.bossLength, pool.length)
  } else {
    const have = new Set(pack.items.map((i) => i.id))
    pool = (opts.queue ?? []).filter((id) => have.has(id))
    size = Math.min(cfg.roundLength, pool.length)
  }
  return {
    kind,
    ...(opts.unitId ? { unitId: opts.unitId } : {}),
    size,
    pool,
    asked: [],
    session: newSession(),
    adaptive: newAdaptive(opts.difficulty ?? (kind === 'boss' ? 4 : 3)),
    results: [],
    dueTaken: 0
  }
}

/**
 * A round over any pool of item ids: what the other shells ask from (a castle wing, a quest, a hunt, a case). `size` fresh questions
 * (default: the whole pool); `pickNext`, `recordResult`, `roundAccuracy` and `missedIds` work on it as on a quiz round, so every shell
 * gets the same adaptive pick, in-session retries, due-card preference and interleaving.
 */
export function startPool(pool: readonly string[], opts: { kind?: RoundKind; unitId?: string; size?: number; difficulty?: number } = {}): RoundState {
  const ids = [...new Set(pool)]
  const kind = opts.kind ?? 'unit'
  return {
    kind,
    ...(opts.unitId ? { unitId: opts.unitId } : {}),
    size: Math.max(0, Math.min(opts.size ?? ids.length, ids.length)),
    pool: ids,
    asked: [],
    session: newSession(),
    adaptive: newAdaptive(opts.difficulty ?? (kind === 'boss' ? 4 : 3)),
    results: [],
    dueTaken: 0
  }
}

const isDueSeen = (card: Card | undefined, now: number): boolean => card !== undefined && card.last !== null && card.due <= now

export interface NextQuestion {
  id: string
  /** Asked again after a miss. */
  retry: boolean
}

/** The next question of the round, or null when the round is over. Does not change the state (`recordResult` does). */
export function pickNext(
  rs: RoundState,
  pack: Pick2,
  rng: SeededRandom,
  cards: Readonly<Record<string, Card>>,
  now: number
): NextQuestion | null {
  const byId = new Map(pack.items.map((i) => [i.id, i]))
  const last = rs.results.at(-1)
  const due = rs.session.pending.filter((p) => p.dueAt <= rs.session.answered && p.id !== last?.id).sort((a, b) => a.dueAt - b.dueAt)[0]
  if (due) return { id: due.id, retry: true }
  if (rs.asked.length < rs.size && rs.pool.length > 0) {
    let candidates = rs.pool.map((id) => byId.get(id)).filter((i): i is CourseItem => i !== undefined)
    const dueSeen = candidates.filter((i) => isDueSeen(cards[i.id], now))
    if (dueSeen.length > 0 && rs.dueTaken < Math.ceil(rs.size / 2)) candidates = dueSeen
    const lastItem = last ? byId.get(last.id) : undefined
    const avoid = lastItem
      ? candidates
          .filter((c) => c.id === lastItem.id || c.kind === lastItem.kind || (rs.kind === 'boss' && unitOfItemId(pack, c.id) === unitOfItemId(pack, lastItem.id)))
          .map((c) => c.id)
      : []
    const picked = pickItem(
      candidates.map((c) => ({ id: c.id, difficulty: c.difficulty })),
      rs.adaptive,
      rng,
      avoid
    )
    if (picked) return { id: picked.id, retry: false }
  }
  // fresh questions are used up: the missed ones that are left come back now, earliest first
  const rest = [...rs.session.pending].sort((a, b) => a.dueAt - b.dueAt)[0]
  return rest ? { id: rest.id, retry: true } : null
}

type Pick2 = Pick<CoursePack, 'items' | 'objectives'>

/** The state after an answer. `grade` feeds both the in-session queue and (by the caller) the SM-2 card. */
export function recordResult(rs: RoundState, pick: NextQuestion, item: Pick<CourseItem, 'kind'>, result: Pick<CheckResult, 'correct' | 'score'>, grade: Grade, cards: Readonly<Record<string, Card>> = {}, now = 0): RoundState {
  let session = recordAnswer(rs.session, pick.id, grade)
  // a question that keeps coming back is dropped from the queue after MAX_RETRIES returns (it stays in the review queue)
  if ((session.misses[pick.id] ?? 0) > MAX_RETRIES) session = { ...session, pending: session.pending.filter((p) => p.id !== pick.id) }
  const fresh = !pick.retry
  return {
    ...rs,
    session,
    adaptive: recordOutcome(rs.adaptive, result.correct),
    pool: fresh ? rs.pool.filter((id) => id !== pick.id) : rs.pool,
    asked: fresh ? [...rs.asked, pick.id] : rs.asked,
    dueTaken: fresh && isDueSeen(cards[pick.id], now) ? rs.dueTaken + 1 : rs.dueTaken,
    results: [...rs.results, { id: pick.id, kind: item.kind, retry: pick.retry, correct: result.correct, score: result.score, grade }]
  }
}

/** First-try accuracy of the fresh questions, 0..1 (0 when nothing was answered). */
export function roundAccuracy(rs: Pick<RoundState, 'results'>): number {
  const first = rs.results.filter((r) => !r.retry)
  return first.length === 0 ? 0 : first.reduce((s, r) => s + r.score, 0) / first.length
}

/** Ids missed on the first try in this round. */
export const missedIds = (rs: Pick<RoundState, 'results'>): string[] => [...new Set(rs.results.filter((r) => !r.retry && !r.correct).map((r) => r.id))]

/** The grade an answer earns: a flashcard's own grade; else wrong = again, shaky (partial, typo, accents) = hard, clean = good. */
export function gradeOf(item: Pick<CourseItem, 'kind'>, answer: unknown, result: CheckResult): Grade {
  if (item.kind === 'flashcard' && isGrade(answer)) return answer
  if (!result.correct) return 'again'
  return result.partial || result.typo || result.diacritics ? 'hard' : 'good'
}

/**
 * Whether the optional timer runs on an item. Never on a flashcard (self-paced), a crossword or a word search (long puzzles), and never
 * on a typed-text answer (typed, a cloze with a typed gap, a listening-type): typing in another language needs time, and the timer
 * would punish the learner for looking for an accent.
 */
export function timerApplies(item: CourseItem): boolean {
  if (item.kind === 'flashcard' || item.kind === 'crossword' || item.kind === 'word-search' || item.kind === 'typed') return false
  if (item.kind === 'listening') return (item as unknown as { mode?: string }).mode !== 'type'
  if (item.kind === 'cloze') return ((item as unknown as { gaps: { bank?: string[] }[] }).gaps ?? []).every((g) => g.bank !== undefined)
  return true
}
