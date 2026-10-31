import type { CoursePack, McqItem, MultiSelectItem, TextCatalog, TrueFalseItem, TypedItem } from '../course'
import { checkMcq, checkMultiSelect, checkTrueFalse, checkTyped } from '../edu/checkers'
import { makeTextResolver, type TextResolver } from '../edu/text'
import { rngFor, shuffledCopy } from '../edu/prng'
import { liveText } from './strings'

/**
 * Questions of a live quiz, made from a course pack (pure: no DOM, no node). Only choice kinds with one fixed key and typed answers go
 * live: mcq, true-false, multi-select, typed. The learners' answers are checked with the shared checkers; partial credit never exists
 * (a multi-select is right only when exactly the right set was picked). A `LiveQuestion` holds the key; `publicQuestion` is what a player
 * may see before the reveal: the prompt and the options (id and text), nothing else.
 */

export const LIVE_KINDS = ['mcq', 'true-false', 'multi-select', 'typed'] as const
export type LiveKind = (typeof LIVE_KINDS)[number]

export const MAX_ANSWER_CHARS = 500

export interface LiveOption {
  id: string
  text: string
}

export interface Graded {
  correct: boolean
  /** Option ids picked (empty for typed). */
  picked: string[]
  /** The typed text, trimmed. */
  text?: string
}

export interface LiveQuestion {
  /** The course item (for the host's log; never sent to players). */
  itemId: string
  unitId: string
  kind: LiveKind
  prompt: string
  /** Empty for typed. */
  options: LiveOption[]
  multi: boolean
  explanation: string
  /** The reveal: ids of the right options, or for typed the canonical text. */
  correctIds: string[]
  correctText: string
  /**
   * Checks a player's payload: `{option}` (mcq, true-false), `{options: []}` (multi-select), `{text}` (typed). null = the payload is
   * malformed or names an unknown option (it does not count as an answer and the player may try again).
   */
  grade(payload: unknown): Graded | null
}

/** What a player sees while the question is open. */
export interface PublicQuestion {
  index: number
  total: number
  kind: LiveKind
  prompt: string
  options: LiveOption[]
  multi: boolean
  seconds: number
  remainingMs: number
}

export interface QuestionPicks {
  count: number
  seed: number | string
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

type LiveItem = McqItem | TrueFalseItem | MultiSelectItem | TypedItem

function makeQuestion(item: LiveItem, unitId: string, pack: CoursePack, text: TextResolver, seed: string): LiveQuestion | null {
  if (!text.hasText(item.prompt)) return null
  const ctx = { text, diacritics: pack.matching.diacritics, typos: pack.matching.typos }
  const t = liveText(text.lang)
  const base = { itemId: item.id, unitId, prompt: text.t(item.prompt), explanation: text.text(item.explanation) ?? '' }
  const rng = rngFor(seed, item.id)

  if (item.kind === 'true-false') {
    return {
      ...base,
      kind: 'true-false',
      options: [
        { id: 'true', text: t('tf.true') },
        { id: 'false', text: t('tf.false') }
      ],
      multi: false,
      correctIds: [String(item.answer)],
      correctText: '',
      grade: (p) => {
        if (!isObj(p) || (p.option !== 'true' && p.option !== 'false')) return null
        return { correct: checkTrueFalse(item, p.option === 'true').correct, picked: [p.option] }
      }
    }
  }
  if (item.kind === 'typed') {
    const canonical = text.canonical(item.answer)
    if (!canonical) return null
    return {
      ...base,
      kind: 'typed',
      options: [],
      multi: false,
      correctIds: [],
      correctText: canonical,
      grade: (p) => {
        if (!isObj(p) || typeof p.text !== 'string') return null
        const typed = p.text.trim()
        if (typed.length === 0 || typed.length > MAX_ANSWER_CHARS) return null
        return { correct: checkTyped(item, typed, ctx).correct, picked: [], text: typed }
      }
    }
  }
  const opts = item.options.map((o) => ({ id: o.id, text: text.t(o.text) }))
  if (opts.some((o, i) => !text.hasText(item.options[i]!.text))) return null
  const ordered = item.shuffle === false ? opts : shuffledCopy(opts, rng)
  const known = new Set(opts.map((o) => o.id))
  if (item.kind === 'mcq') {
    return {
      ...base,
      kind: 'mcq',
      options: ordered,
      multi: false,
      correctIds: [item.answer],
      correctText: '',
      grade: (p) => {
        if (!isObj(p) || typeof p.option !== 'string' || !known.has(p.option)) return null
        return { correct: checkMcq(item, p.option).correct, picked: [p.option] }
      }
    }
  }
  return {
    ...base,
    kind: 'multi-select',
    options: ordered,
    multi: true,
    correctIds: [...item.answers].sort(),
    correctText: '',
    grade: (p) => {
      if (!isObj(p) || !Array.isArray(p.options) || p.options.length === 0) return null
      const ids: unknown[] = p.options
      if (!ids.every((x): x is string => typeof x === 'string' && known.has(x))) return null
      const picked = [...new Set(ids)]
      return { correct: checkMultiSelect(item, picked).correct, picked }
    }
  }
}

/**
 * Picks `count` questions: the allowed kinds only, items without their texts in the edition left out, a seeded shuffle inside each unit,
 * units taken in turn (round-robin from a seeded unit order) so the quiz is balanced over the units, then the picked questions are shuffled
 * once more. The same pack, language and seed give the same list. Fewer than `count` come back when the course has fewer usable items.
 */
export function selectQuestions(pack: CoursePack, catalogs: Readonly<Record<string, TextCatalog>>, lang: string, picks: QuestionPicks): LiveQuestion[] {
  const text = makeTextResolver(catalogs, lang, pack.targetLang)
  const unitOf = new Map(pack.objectives.map((o) => [o.id, o.unit]))
  const seed = String(picks.seed)
  const perUnit = new Map<string, LiveQuestion[]>()
  for (const item of pack.items) {
    if (!(LIVE_KINDS as readonly string[]).includes(item.kind)) continue
    const unitId = unitOf.get(item.objective)
    if (!unitId) continue
    const q = makeQuestion(item as unknown as LiveItem, unitId, pack, text, seed)
    if (!q) continue
    const list = perUnit.get(unitId) ?? []
    list.push(q)
    perUnit.set(unitId, list)
  }
  const unitIds = shuffledCopy([...perUnit.keys()], rngFor(seed, 'units'))
  const queues = unitIds.map((u) => shuffledCopy(perUnit.get(u) ?? [], rngFor(seed, 'unit', u)))
  const out: LiveQuestion[] = []
  const want = Math.max(0, Math.floor(picks.count))
  while (out.length < want && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const next = q.shift()
      if (next && out.length < want) out.push(next)
    }
  }
  return shuffledCopy(out, rngFor(seed, 'order'))
}

/** The question as a player sees it while it is open. No key, no explanation, no accepted answers, no item id. */
export function publicQuestion(q: LiveQuestion, index: number, total: number, seconds: number, remainingMs: number): PublicQuestion {
  return { index, total, kind: q.kind, prompt: q.prompt, options: q.options.map((o) => ({ id: o.id, text: o.text })), multi: q.multi, seconds, remainingMs }
}
