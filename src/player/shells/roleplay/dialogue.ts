import type { CourseItem } from '../../../shared/course'
import type { TextResolver } from '../../../shared/edu/text'
import { isReply, isSay, lineById, walkScene, type RpReplyLine, type RpSayLine, type RpScene } from '../../../shared/shells/roleplay'

/**
 * The dialogue walker of the role-play shell (EGS-13): pure (no DOM, no clock), so it is unit-tested in node.
 *
 * A scene is a chain of lines (`walkScene`). The learner meets them one by one: a `say` line is revealed with `scene-next`, a `reply`
 * line is a question (the learner's turn). A right answer puts the learner's bubble in the log and the talk goes on. A miss never
 * stops the talk for good: the speaker says the last line again, slowly (a `help` entry), the same turn is asked again, up to
 * `MAX_TRIES` answers in all; after the last miss the right reply is shown (a `you` entry with outcome `shown`) and the scene goes on:
 * never a dead end. Only the FIRST answer of a turn counts for the stars; the item stays in the review queue until it is answered right.
 */

/** First try plus two retries (the quiz arena's MAX_RETRIES is 2). */
export const MAX_TRIES = 3

export type LogEntry =
  | { kind: 'say'; lineId: string; speaker: string }
  | { kind: 'you'; lineId: string; outcome: 'right' | 'shown'; text: string | null }
  | { kind: 'help'; lineId: string; speaker: string; attempt: number }

export interface Turn {
  lineId: string
  itemId: string
  /** Answers given to this turn (1 = right first time). */
  tries: number
  /** The score (0..1) of the FIRST answer: what the stars count. */
  score: number
  right: boolean
  /** The right reply was shown after the last miss. */
  shown: boolean
}

export interface SceneState {
  sceneId: string
  /** The next line to meet, or null when the chain is over. */
  cursor: string | null
  log: LogEntry[]
  turns: Turn[]
  /** A missed turn asked again (the line id and how many answers it has had). */
  retry: { lineId: string; tries: number } | null
}

export type Step = { type: 'say'; line: RpSayLine } | { type: 'turn'; line: RpReplyLine; retry: boolean; tries: number } | { type: 'done' }

export function startScene(scene: Pick<RpScene, 'id' | 'start' | 'lines'>): SceneState {
  return { sceneId: scene.id, cursor: lineById(scene, scene.start) ? scene.start : null, log: [], turns: [], retry: null }
}

/** What happens next: a line to reveal, a question to ask (fresh or again), or the end. */
export function stepOf(scene: Pick<RpScene, 'lines'>, st: SceneState): Step {
  if (st.retry) {
    const line = lineById(scene, st.retry.lineId)
    if (line && isReply(line)) return { type: 'turn', line, retry: true, tries: st.retry.tries }
  }
  const line = lineById(scene, st.cursor)
  if (!line) return { type: 'done' }
  return isReply(line) ? { type: 'turn', line, retry: false, tries: 0 } : { type: 'say', line }
}

/** Reveals the `say` line at the cursor (no change when the next step is not a line). */
export function reveal(scene: Pick<RpScene, 'lines'>, st: SceneState): SceneState {
  const step = stepOf(scene, st)
  if (step.type !== 'say') return st
  return { ...st, cursor: step.line.next, log: [...st.log, { kind: 'say', lineId: step.line.id, speaker: step.line.say }] }
}

/** The last line somebody said to the learner, in the log. */
export const lastSay = (st: Pick<SceneState, 'log'>): Extract<LogEntry, { kind: 'say' }> | undefined => [...st.log].reverse().find((e): e is Extract<LogEntry, { kind: 'say' }> => e.kind === 'say')

export interface TurnOutcome {
  correct: boolean
  /** 0..1 of the answer (partial credit counts for the stars). */
  score: number
  /** The text of the learner's bubble (the right reply, spelt right), or null for a turn with nothing to say (a dictation). */
  text: string | null
}

/**
 * The scene after the learner answered the turn `stepOf` named. Right: the learner's bubble joins the log and the cursor moves on.
 * Wrong: the last speaker helps (`help` entry) and the turn comes again, until `MAX_TRIES` answers; then the right reply is shown and
 * the cursor moves on.
 */
export function answerTurn(scene: Pick<RpScene, 'lines'>, st: SceneState, outcome: TurnOutcome): SceneState {
  const step = stepOf(scene, st)
  if (step.type !== 'turn') return st
  const { line } = step
  const tries = step.tries + 1
  const helper = lastSay(st)?.speaker ?? ''
  const fresh = !step.retry
  const turns = fresh
    ? [...st.turns, { lineId: line.id, itemId: line.reply, tries, score: Math.max(0, Math.min(1, outcome.score)), right: outcome.correct, shown: false }]
    : st.turns.map((t) => (t.lineId === line.id ? { ...t, tries, right: t.right || outcome.correct } : t))
  if (outcome.correct) {
    return { ...st, turns, retry: null, cursor: line.next, log: [...st.log, { kind: 'you', lineId: line.id, outcome: 'right', text: outcome.text }] }
  }
  if (tries >= MAX_TRIES) {
    return {
      ...st,
      turns: turns.map((t) => (t.lineId === line.id ? { ...t, shown: true } : t)),
      retry: null,
      cursor: line.next,
      log: [...st.log, { kind: 'help', lineId: line.id, speaker: helper, attempt: tries }, { kind: 'you', lineId: line.id, outcome: 'shown', text: outcome.text }]
    }
  }
  return { ...st, turns, retry: { lineId: line.id, tries }, log: [...st.log, { kind: 'help', lineId: line.id, speaker: helper, attempt: tries }] }
}

/** Skips a turn whose item cannot be shown (the player has no renderer for its kind): the talk goes on. */
export function skipTurn(scene: Pick<RpScene, 'lines'>, st: SceneState): SceneState {
  const step = stepOf(scene, st)
  if (step.type !== 'turn') return st
  return { ...st, retry: null, cursor: step.line.next }
}

export const isDone = (scene: Pick<RpScene, 'lines'>, st: SceneState): boolean => stepOf(scene, st).type === 'done'

/** First-try accuracy of the turns met so far, 0..1 (0 when none was answered). */
export function accuracy(st: Pick<SceneState, 'turns'>): number {
  return st.turns.length === 0 ? 0 : st.turns.reduce((s, t) => s + t.score, 0) / st.turns.length
}

/** How many learner turns the scene has on its path. */
export const turnCount = (scene: RpScene): number => walkScene(scene).path.filter((id) => isReply(lineById(scene, id) as RpReplyLine | RpSayLine)).length

/**
 * The `listen` lines that are still hidden: a say line with `listen` and a clip stays a sound until the learner has answered the next
 * turn (the dictation: hear first, then read). Without a clip (`hasAudio` false) the text is always shown.
 */
export function hiddenLines(scene: RpScene, st: Pick<SceneState, 'log'>, hasAudio: (assetId: string) => boolean): Set<string> {
  const path = walkScene(scene).path
  const out = new Set<string>()
  st.log.forEach((e, i) => {
    if (e.kind !== 'say') return
    const line = lineById(scene, e.lineId)
    if (!line || !isSay(line) || !line.listen || !line.audio || !hasAudio(line.audio)) return
    const at = path.indexOf(line.id)
    const turnAfter = path.slice(at + 1).some((id) => isReply(lineById(scene, id) as RpReplyLine | RpSayLine))
    const answered = st.log.slice(i + 1).some((x) => x.kind === 'you')
    if (turnAfter && !answered) out.add(line.id)
  })
  return out
}

// ---- the learner's bubble ----

interface ChoiceLike {
  options?: { id: string; text: string }[]
  answer?: unknown
  mode?: string
  text?: string
  gaps?: { id: string; answer: string }[]
}

/**
 * The words of the learner's bubble: the line's own `youSay`, else the item's right reply spelt right (a typed answer's canonical form,
 * the text of the right option, a cloze sentence with its gaps filled). Null when the item has no sentence to say (a dictation, true or
 * false, ordering ...): the learner's bubble is then left out.
 */
export function replyText(item: CourseItem | undefined, line: Pick<RpReplyLine, 'youSay'>, text: TextResolver): string | null {
  if (line.youSay && text.hasText(line.youSay)) return text.t(line.youSay)
  if (!item) return null
  const it = item as unknown as ChoiceLike
  switch (item.kind) {
    case 'typed':
      return typeof it.answer === 'string' ? (text.canonical(it.answer) ?? null) : null
    case 'mcq': {
      const o = it.options?.find((x) => x.id === it.answer)
      return o ? text.t(o.text) : null
    }
    case 'listening': {
      if (it.mode !== 'choose') return null
      const o = it.options?.find((x) => x.id === it.answer)
      return o ? text.t(o.text) : null
    }
    case 'cloze': {
      if (!it.text || !it.gaps) return null
      let s = text.t(it.text)
      for (const g of it.gaps) s = s.split(`{{${g.id}}}`).join(text.canonical(g.answer) ?? text.t(g.answer))
      return s
    }
    default:
      return null
  }
}
