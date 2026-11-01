import type {
  ClozeItem,
  CourseItem,
  CrosswordItem,
  FlashcardItem,
  HotspotItem,
  ListeningItem,
  MatchPairsItem,
  McqItem,
  MultiSelectItem,
  OrderItem,
  SortGroupsItem,
  TrueFalseItem,
  TypedItem,
  WordSearchItem
} from '../shared/course'
import { hitRegion, type CheckResult, type SeededRandom, type TextResolver } from '../shared/edu'
import type { Ui, UiKey } from './i18n'

/**
 * What the feedback panel says after an answer. Pure: the wrong-answer explanation of the CHOSEN distractor (`why`), the explanation of
 * the item, the correct answer as text, the "Did you know?" hook (right answers only) and the notes of the matcher (typo, accents).
 */

export interface Feedback {
  verdict: 'correct' | 'partial' | 'wrong' | 'timeout'
  title: string
  /** The explanation of each wrong choice the learner made (the misconception behind it). */
  whys: string[]
  explanation: string
  /** The right answer as lines of text (empty when there is nothing to show). */
  answer: string[]
  dyk?: string
  notes: string[]
  /** Parts of a partial answer ("Right pairs: 2 of 4"). */
  detail?: string
}

export interface FeedbackContext {
  text: TextResolver
  ui: Ui
  rng: SeededRandom
}

const asObj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** A string with `{{id}}` gap markers filled with the answers. */
const fillGaps = (text: string, fill: (id: string) => string): string => text.replace(/\{\{([^}]+)\}\}/g, (_m, id: string) => fill(id))

/** The right answer of an item as lines of text, in the edition's language. */
export function answerLines(item: CourseItem, ctx: Pick<FeedbackContext, 'text' | 'ui'>): string[] {
  const { text, ui } = ctx
  const t = (k: string): string => text.t(k)
  switch (item.kind) {
    case 'mcq': {
      const i = item as unknown as McqItem
      const o = i.options.find((x) => x.id === i.answer)
      return o ? [t(o.text)] : []
    }
    case 'true-false':
      return [ui((item as unknown as TrueFalseItem).answer ? 'fb.true' : 'fb.false')]
    case 'multi-select': {
      const i = item as unknown as MultiSelectItem
      return i.options.filter((o) => i.answers.includes(o.id)).map((o) => t(o.text))
    }
    case 'cloze': {
      const i = item as unknown as ClozeItem
      const gaps = new Map(i.gaps.map((g) => [g.id, text.canonical(g.answer) ?? '?']))
      return [fillGaps(t(i.text), (id) => gaps.get(id) ?? '?')]
    }
    case 'typed': {
      const c = text.canonical((item as unknown as TypedItem).answer)
      return c ? [c] : []
    }
    case 'match-pairs':
      return (item as unknown as MatchPairsItem).pairs.map((p) => `${t(p.left)} = ${t(p.right)}`)
    case 'order': {
      const i = item as unknown as OrderItem
      return i.items.map((x, n) => `${n + 1}. ${t(x.text)}${x.when ? ` (${t(x.when)})` : ''}`)
    }
    case 'sort-groups': {
      const i = item as unknown as SortGroupsItem
      return i.groups.map((g) => `${t(g.title)}: ${i.items.filter((x) => x.group === g.id).map((x) => t(x.text)).join(', ')}`)
    }
    case 'hotspot': {
      const i = item as unknown as HotspotItem
      const r = i.regions.find((x) => x.id === i.answer)
      return r ? [t(r.label)] : []
    }
    case 'listening': {
      const i = item as unknown as ListeningItem
      if (i.mode === 'choose') {
        const o = (i.options ?? []).find((x) => x.id === i.answer)
        return o ? [t(o.text)] : []
      }
      const c = text.canonical(i.answer)
      return c ? [c] : []
    }
    case 'flashcard':
      return [t((item as unknown as FlashcardItem).back)]
    case 'crossword':
      return (item as unknown as CrosswordItem).words.map((w) => `${t(w.clue)} = ${text.canonical(w.answer) ?? '?'}`)
    case 'word-search':
      return [(item as unknown as WordSearchItem).words.map((w) => text.canonical(w.answer) ?? '?').join(', ')]
    default:
      return []
  }
}

/** The explanations of the wrong choices the learner made. */
export function whysFor(item: CourseItem, answer: unknown, text: TextResolver): string[] {
  const t = (k: string | undefined): string[] => (k && text.hasText(k) ? [text.t(k)] : [])
  switch (item.kind) {
    case 'mcq': {
      const i = item as unknown as McqItem
      return typeof answer === 'string' && answer !== i.answer ? t(i.options.find((o) => o.id === answer)?.why) : []
    }
    case 'listening': {
      const i = item as unknown as ListeningItem
      return i.mode === 'choose' && typeof answer === 'string' && answer !== i.answer ? t((i.options ?? []).find((o) => o.id === answer)?.why) : []
    }
    case 'multi-select': {
      const i = item as unknown as MultiSelectItem
      const picked = Array.isArray(answer) ? answer.filter((a): a is string => typeof a === 'string') : []
      return picked.filter((p) => !i.answers.includes(p)).flatMap((p) => t(i.options.find((o) => o.id === p)?.why))
    }
    case 'true-false': {
      const i = item as unknown as TrueFalseItem
      return typeof answer === 'boolean' && answer !== i.answer ? t(i.why) : []
    }
    case 'hotspot': {
      const i = item as unknown as HotspotItem
      const a = asObj(answer)
      const id = typeof answer === 'string' ? answer : typeof a.x === 'number' && typeof a.y === 'number' ? hitRegion(i, a.x, a.y) : undefined
      return id && id !== i.answer ? t(i.regions.find((r) => r.id === id)?.why) : []
    }
    case 'sort-groups': {
      const i = item as unknown as SortGroupsItem
      const a = asObj(answer)
      return i.items.filter((x) => a[x.id] !== x.group).flatMap((x) => t(x.why))
    }
    default:
      return []
  }
}

const detailKey = (kind: string): UiKey =>
  kind === 'order' ? 'fb.detail.order' : kind === 'sort-groups' ? 'fb.detail.sort' : kind === 'cloze' ? 'fb.detail.gaps' : kind === 'crossword' || kind === 'word-search' ? 'fb.detail.words' : 'fb.matched'

export function buildFeedback(item: CourseItem, answer: unknown, result: CheckResult, ctx: FeedbackContext, timedOut = false): Feedback {
  const { text, ui } = ctx
  const verdict: Feedback['verdict'] = timedOut ? 'timeout' : result.correct ? 'correct' : result.partial ? 'partial' : 'wrong'
  const praise = ui(`praise.${ctx.rng.randint(1, 5)}` as 'praise.1')
  const title = verdict === 'correct' ? (result.typo || result.diacritics || result.translit || result.caps ? ui('verdict.correct') : praise) : verdict === 'timeout' ? ui('verdict.timeout') : verdict === 'partial' ? ui('verdict.partial') : ui('verdict.wrong')
  const lines = answerLines(item, ctx)
  const notes: string[] = []
  const canon = typeof result.expected === 'string' ? result.expected : lines.join(' ')
  if (result.typo) notes.push(ui('fb.typo', { a: canon }))
  if (result.diacritics) notes.push(ui(result.correct ? 'fb.accents' : 'fb.accents.strict', { a: canon }))
  if (result.translit) notes.push(ui('fb.note.translit', { a: canon }))
  if (result.caps) notes.push(ui('fb.note.caps', { a: canon }))
  const detail = result.detail && !result.correct && !timedOut ? Object.values(result.detail) : undefined
  return {
    verdict,
    title,
    whys: result.correct || timedOut ? [] : whysFor(item, answer, text),
    explanation: text.text(item.explanation) ?? '',
    answer: result.correct && item.kind !== 'flashcard' && !(item.kind === 'order' && (item as unknown as OrderItem).timeline) ? [] : lines,
    ...(result.correct && item.didYouKnow && text.hasText(item.didYouKnow) ? { dyk: text.t(item.didYouKnow) } : {}),
    notes,
    ...(detail && detail.length > 1 ? { detail: ui(detailKey(item.kind), { n: detail.filter(Boolean).length, total: detail.length }) } : {})
  }
}
