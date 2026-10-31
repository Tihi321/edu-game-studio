import { publicQuestion, MAX_ANSWER_CHARS, type LiveQuestion, type PublicQuestion } from './questions'

/**
 * The state machine of one live quiz room (pure: no DOM, no node, no timers). The clock (`now`) and the token maker are injected, so a
 * test with a fixed clock gets the same scores every time; the server calls `tick()` when the deadline passes.
 *
 *   lobby -> question -> reveal -> leaderboard -> question -> ... -> reveal -> leaderboard -> podium      (closed from anywhere)
 *
 * Rules: one answer per player per question (the first counts); an answer after the deadline is refused; the host can end a question early,
 * and it ends by itself when every connected player has answered. A right answer scores 1000 * (0.5 + 0.5 * remaining / total) plus a
 * streak bonus of 50 per earlier right answer in a row (at most 200); a wrong or missing answer scores 0 and breaks the streak. There is
 * no partial credit. The answer key goes to a player only in the reveal.
 */

export type Phase = 'lobby' | 'question' | 'reveal' | 'leaderboard' | 'podium' | 'closed'

export const MAX_PLAYERS = 60
export const MAX_NICKNAME = 20
export const BASE_POINTS = 1000
export const STREAK_BONUS = 50
export const STREAK_BONUS_MAX = 200

/** Points for a right answer given `remainingMs` of `totalMs` and the number of right answers in a row before it. */
export function pointsFor(remainingMs: number, totalMs: number, streakBefore: number): number {
  const share = totalMs <= 0 ? 0 : Math.min(1, Math.max(0, remainingMs / totalMs))
  return Math.round(BASE_POINTS * (0.5 + 0.5 * share)) + Math.min(STREAK_BONUS_MAX, STREAK_BONUS * Math.max(0, streakBefore))
}

/** Control characters and the invisible formatting marks (zero-width, bidi overrides, line separators). */
const isInvisibleOrControl = (c: number): boolean =>
  c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff

/** A cleaned nickname, or null: trimmed, 1..20 characters, no control characters (it is only ever drawn with textContent). */
export function cleanNickname(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const name = input.trim()
  if (name.length === 0 || [...name].length > MAX_NICKNAME) return null
  for (const ch of name) if (isInvisibleOrControl(ch.codePointAt(0) ?? 0)) return null
  return name
}

export interface RoomOptions {
  questions: LiveQuestion[]
  secondsPerQuestion: number
  lang: string
  title: string
  now: () => number
  /** A fresh unguessable token (the server uses 128 random bits). */
  makeToken: () => string
  maxPlayers?: number
}

interface Player {
  id: string
  nickname: string
  token: string
  score: number
  streak: number
  connected: boolean
  order: number
}

interface Answer {
  at: number
  correct: boolean
  picked: string[]
  text?: string
}

export interface Outcome {
  answered: boolean
  correct: boolean
  points: number
}

export interface LeaderRow {
  rank: number
  id: string
  nickname: string
  score: number
  you: boolean
}

export interface RevealView {
  index: number
  total: number
  kind: string
  prompt: string
  options: { id: string; text: string }[]
  correctIds: string[]
  correctText: string
  explanation: string
  /** How many players picked each option (typed: how many were right and wrong under `right` and `wrong`). */
  counts: Record<string, number>
}

/** What one player (or the page before joining) sees. */
export interface RoomView {
  phase: Phase
  lang: string
  title: string
  playerCount: number
  /** Nicknames in the lobby. */
  players?: string[]
  you?: { id: string; nickname: string; score: number; streak: number; rank: number; answered: boolean }
  question?: PublicQuestion
  reveal?: RevealView & { you: Outcome }
  leaderboard?: { rows: LeaderRow[]; total: number }
  podium?: { rows: LeaderRow[]; total: number }
}

export interface HostView extends RoomView {
  players: string[]
  roster: { id: string; nickname: string; score: number; connected: boolean; answered: boolean }[]
  answered: number
  connected: number
  questionIndex: number
  questionCount: number
}

export type JoinError = 'name' | 'taken' | 'full' | 'started' | 'closed'
export type AnswerError = 'phase' | 'late' | 'already' | 'invalid' | 'unknown'
export type StepError = 'phase' | 'empty'

export class LiveRoom {
  phase: Phase = 'lobby'
  /** The index of the open or last question, -1 in the lobby. */
  index = -1
  /** When the open question ends (ms of the injected clock), or null. */
  deadline: number | null = null
  private readonly players = new Map<string, Player>()
  private readonly byToken = new Map<string, string>()
  private answers = new Map<string, Answer>()
  private outcomes = new Map<string, Outcome>()
  private counts: Record<string, number> = {}
  private startedAt = 0
  private seq = 0
  private readonly listeners = new Set<() => void>()
  readonly totalMs: number

  constructor(private readonly o: RoomOptions) {
    this.totalMs = Math.max(1, Math.round(o.secondsPerQuestion * 1000))
  }

  get questionCount(): number {
    return this.o.questions.length
  }

  /** Calls `fn` after every change of the room; returns the way to stop. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed(): void {
    for (const fn of [...this.listeners]) fn()
  }

  // ---- players ----

  join(nickname: unknown): { ok: true; id: string; token: string } | { ok: false; error: JoinError } {
    if (this.phase === 'closed') return { ok: false, error: 'closed' }
    if (this.phase !== 'lobby') return { ok: false, error: 'started' }
    const name = cleanNickname(nickname)
    if (!name) return { ok: false, error: 'name' }
    if (this.players.size >= (this.o.maxPlayers ?? MAX_PLAYERS)) return { ok: false, error: 'full' }
    const key = name.toLocaleLowerCase()
    for (const p of this.players.values()) if (p.nickname.toLocaleLowerCase() === key) return { ok: false, error: 'taken' }
    const id = `p${++this.seq}`
    const token = this.o.makeToken()
    this.players.set(id, { id, nickname: name, token, score: 0, streak: 0, connected: false, order: this.seq })
    this.byToken.set(token, id)
    this.changed()
    return { ok: true, id, token }
  }

  /** The player id of a token (a kicked player's token is gone). */
  playerOf(token: unknown): string | undefined {
    return typeof token === 'string' ? this.byToken.get(token) : undefined
  }

  hasPlayer(id: string): boolean {
    return this.players.has(id)
  }

  setConnected(id: string, connected: boolean): void {
    const p = this.players.get(id)
    if (!p || p.connected === connected) return
    p.connected = connected
    this.changed()
    // the last player who had not answered left: nobody is waited for any more
    if (!connected) this.tick()
  }

  kick(id: string): boolean {
    const p = this.players.get(id)
    if (!p) return false
    this.players.delete(id)
    this.byToken.delete(p.token)
    this.answers.delete(id)
    this.changed()
    this.tick()
    return true
  }

  // ---- the flow ----

  start(): { ok: true } | { ok: false; error: StepError } {
    if (this.phase !== 'lobby') return { ok: false, error: 'phase' }
    if (this.o.questions.length === 0 || this.players.size === 0) return { ok: false, error: 'empty' }
    this.openQuestion(0)
    return { ok: true }
  }

  private openQuestion(i: number): void {
    this.index = i
    this.phase = 'question'
    this.answers = new Map()
    this.outcomes = new Map()
    this.counts = {}
    this.startedAt = this.o.now()
    this.deadline = this.startedAt + this.totalMs
    this.changed()
  }

  /** Records one answer. The first answer of a player counts; a malformed one is refused and may be retried. */
  answer(id: string, payload: unknown): { ok: true } | { ok: false; error: AnswerError } {
    const p = this.players.get(id)
    if (!p) return { ok: false, error: 'unknown' }
    if (this.phase !== 'question') return { ok: false, error: 'phase' }
    const at = this.o.now()
    if (this.deadline !== null && at > this.deadline) {
      this.tick()
      return { ok: false, error: 'late' }
    }
    if (this.answers.has(id)) return { ok: false, error: 'already' }
    if (JSON.stringify(payload ?? null).length > MAX_ANSWER_CHARS + 100) return { ok: false, error: 'invalid' }
    const q = this.o.questions[this.index]
    const graded = q?.grade(payload)
    if (!graded) return { ok: false, error: 'invalid' }
    this.answers.set(id, { at, correct: graded.correct, picked: graded.picked, ...(graded.text !== undefined ? { text: graded.text } : {}) })
    this.changed()
    this.tick()
    return { ok: true }
  }

  /** Ends the open question at once (the host's button, the deadline, or everybody answered). */
  endQuestion(): { ok: true } | { ok: false; error: StepError } {
    if (this.phase !== 'question') return { ok: false, error: 'phase' }
    const total = this.totalMs
    for (const p of this.sortedPlayers()) {
      const a = this.answers.get(p.id)
      if (a?.correct) {
        const points = pointsFor(Math.max(0, (this.deadline ?? a.at) - a.at), total, p.streak)
        p.score += points
        p.streak += 1
        this.outcomes.set(p.id, { answered: true, correct: true, points })
      } else {
        p.streak = 0
        this.outcomes.set(p.id, { answered: a !== undefined, correct: false, points: 0 })
      }
    }
    const counts: Record<string, number> = {}
    for (const a of this.answers.values()) {
      if (a.text !== undefined) counts[a.correct ? 'right' : 'wrong'] = (counts[a.correct ? 'right' : 'wrong'] ?? 0) + 1
      for (const id of a.picked) counts[id] = (counts[id] ?? 0) + 1
    }
    this.counts = counts
    this.phase = 'reveal'
    this.deadline = null
    this.changed()
    return { ok: true }
  }

  /** reveal -> leaderboard; leaderboard -> the next question, or the podium after the last. */
  next(): { ok: true } | { ok: false; error: StepError } {
    if (this.phase === 'reveal') {
      this.phase = 'leaderboard'
      this.changed()
      return { ok: true }
    }
    if (this.phase === 'leaderboard') {
      if (this.index + 1 < this.o.questions.length) this.openQuestion(this.index + 1)
      else {
        this.phase = 'podium'
        this.changed()
      }
      return { ok: true }
    }
    return { ok: false, error: 'phase' }
  }

  close(): void {
    if (this.phase === 'closed') return
    this.phase = 'closed'
    this.deadline = null
    this.changed()
  }

  /** Ends the question when its time is up or every connected player has answered. Returns whether it did. */
  tick(): boolean {
    if (this.phase !== 'question') return false
    const timeUp = this.deadline !== null && this.o.now() >= this.deadline
    const connected = this.sortedPlayers().filter((p) => p.connected)
    const everyone = connected.length > 0 && connected.every((p) => this.answers.has(p.id))
    if (!timeUp && !everyone) return false
    return this.endQuestion().ok
  }

  // ---- views ----

  private sortedPlayers(): Player[] {
    return [...this.players.values()].sort((a, b) => b.score - a.score || a.order - b.order)
  }

  /** The ranking of every player now (competition ranking: equal scores share a rank). */
  standings(): LeaderRow[] {
    return this.rows()
  }

  /** Rows with competition ranking: players with the same score share a rank. */
  private rows(youId?: string): LeaderRow[] {
    let rank = 0
    let prev = Number.NaN
    return this.sortedPlayers().map((p, i) => {
      if (p.score !== prev) {
        rank = i + 1
        prev = p.score
      }
      return { rank, id: p.id, nickname: p.nickname, score: p.score, you: p.id === youId }
    })
  }

  private remainingMs(): number {
    return this.deadline === null ? 0 : Math.max(0, this.deadline - this.o.now())
  }

  /** The full public view for one player, or for a visitor who has not joined (no `youId`). The key is only in a reveal. */
  view(youId?: string): RoomView {
    const rows = this.rows(youId)
    const me = youId ? rows.find((r) => r.id === youId) : undefined
    const player = youId ? this.players.get(youId) : undefined
    const v: RoomView = { phase: this.phase, lang: this.o.lang, title: this.o.title, playerCount: this.players.size }
    if (player && me) {
      v.you = { id: player.id, nickname: player.nickname, score: player.score, streak: player.streak, rank: me.rank, answered: this.phase === 'question' && this.answers.has(player.id) }
    }
    if (this.phase === 'lobby') v.players = this.sortedPlayersByJoin().map((p) => p.nickname)
    const q = this.o.questions[this.index]
    if (this.phase === 'question' && q) v.question = publicQuestion(q, this.index, this.o.questions.length, this.o.secondsPerQuestion, this.remainingMs())
    if ((this.phase === 'reveal' || this.phase === 'leaderboard') && q) {
      const out = (youId ? this.outcomes.get(youId) : undefined) ?? { answered: false, correct: false, points: 0 }
      v.reveal = {
        index: this.index,
        total: this.o.questions.length,
        kind: q.kind,
        prompt: q.prompt,
        options: q.options.map((o) => ({ id: o.id, text: o.text })),
        correctIds: [...q.correctIds],
        correctText: q.correctText,
        explanation: q.explanation,
        counts: { ...this.counts },
        you: out
      }
    }
    if (this.phase === 'leaderboard') v.leaderboard = { rows: topWithYou(rows, 5), total: rows.length }
    if (this.phase === 'podium') v.podium = { rows: rows.slice(0, 3).map((r) => ({ ...r })), total: rows.length }
    if (this.phase === 'podium' && me && !v.podium!.rows.some((r) => r.you)) v.podium!.rows.push({ ...me })
    return v
  }

  private sortedPlayersByJoin(): Player[] {
    return [...this.players.values()].sort((a, b) => a.order - b.order)
  }

  /** The host's view: the player view without a player, plus the roster, the answer counts and the full ranking. */
  hostView(): HostView {
    const base = this.view()
    const rows = this.rows()
    const roster = this.sortedPlayersByJoin().map((p) => ({ id: p.id, nickname: p.nickname, score: p.score, connected: p.connected, answered: this.answers.has(p.id) }))
    const v: HostView = {
      ...base,
      players: roster.map((r) => r.nickname),
      roster,
      answered: this.phase === 'question' ? this.answers.size : 0,
      connected: roster.filter((r) => r.connected).length,
      questionIndex: this.index,
      questionCount: this.o.questions.length
    }
    if (this.phase === 'leaderboard' || this.phase === 'reveal') v.leaderboard = { rows: rows.slice(0, 10), total: rows.length }
    return v
  }
}

/** The top `n` rows, and the player's own row when they are further down. */
function topWithYou(rows: LeaderRow[], n: number): LeaderRow[] {
  const top = rows.slice(0, n).map((r) => ({ ...r }))
  const me = rows.find((r) => r.you)
  if (me && !top.some((r) => r.you)) top.push({ ...me })
  return top
}
