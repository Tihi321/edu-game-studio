import type { z } from 'zod'
import type { CourseAsset, CourseItem, CoursePack, TextCatalog } from '../course'
import type { DiacriticsPolicy } from './match'
import type { TextResolver } from './text'

/**
 * The item-kind registry: the runtime counterpart of the zod union in `course.ts`. Each kind registers its schema, its checker, how to
 * read its answer key, a human form label and what it refers to (text keys, options, assets), so the validator, the lint, the bot and the
 * shells work for ANY registered kind. A later kind (a `speaking` item, a teacher-made kind) is one `registerItemKind` call; no consumer
 * changes. The built-in kinds register in `kinds.ts` (imported by `index.ts` and `validate.ts`).
 */

export interface CheckContext {
  /** Texts of the edition the item is played in. */
  text: TextResolver
  /** The course default for accents (`pack.matching.diacritics`). */
  diacritics?: DiacriticsPolicy
  /** Typo tolerance on typed answers (default true; `pack.matching.typos`). */
  typos?: boolean
  /** Language of the answer texts (`pack.targetLang`, else the edition); selects the language rules of the matcher (German). */
  lang?: string
}

/** The ONE way to build a check context from a pack and an edition's text resolver (player, quiz arena, lint, live quiz, bot). */
export function makeCheckContext(o: { pack: { matching?: { diacritics?: DiacriticsPolicy; typos?: boolean }; targetLang?: string }; text: TextResolver; targetLang?: string }): CheckContext {
  return { text: o.text, diacritics: o.pack.matching?.diacritics, typos: o.pack.matching?.typos, lang: o.targetLang ?? o.pack.targetLang ?? o.text.lang }
}

export interface CheckResult {
  /** Fully right (for a typed answer: accepted, a typo or a warned accent included). */
  correct: boolean
  /** Some of it is right but not all (multi-select, pairs, order, sort, cloze, crossword, word search; a hard flashcard). */
  partial?: boolean
  /** 0 to 1: the fraction of the answer that is right. */
  score: number
  /** The language-neutral answer key, or for a text answer the canonical text in this edition. */
  expected: unknown
  /** A typed answer was accepted although a letter was off: show "accepted, mind the spelling". */
  typo?: boolean
  /** The accents were off (accepted under `warn`, rejected under `strict`). */
  diacritics?: boolean
  /** German: accepted with ae / oe / ue / ss for the umlauts / sharp s (a note, never a lost grade). */
  translit?: boolean
  /** German: accepted although a noun was typed in lower case (a note, never a lost grade). */
  caps?: boolean
  /** The answer had the wrong shape. */
  invalid?: boolean
  /** Per-part results (gap, pair, item or word ids) for shells that mark parts. */
  detail?: Record<string, boolean>
}

export interface TextRef {
  /** Where in the item, such as `options[1].why`. */
  path: string
  key: string
  /** `string`: the key needs a `strings` entry; `accepted`: it needs an `accepted` list (a typed answer). */
  role: 'string' | 'accepted'
}

export interface Problem {
  code: string
  path: string
  message: string
}

export interface ValidationContext {
  pack: CoursePack
  catalogs: Readonly<Record<string, TextCatalog>>
  assets: ReadonlyMap<string, CourseAsset>
  /** The languages whose catalogs the item must be complete in (the editions). */
  languages: readonly string[]
}

export interface ItemKindDef<I extends CourseItem = CourseItem> {
  kind: string
  /** The form the learner meets, in words ("Multiple choice"). The lint counts distinct forms per objective. */
  form: string
  /** true when the learner produces the answer (typing, ordering, placing), false when they only recognise it. */
  recall: boolean
  /** Checks the whole item (common fields included). */
  schema: z.ZodType<I>
  check(item: I, answer: unknown, ctx: CheckContext): CheckResult
  /** The language-neutral answer key (ids, indexes, numbers; for text answers the catalog key). */
  keyOf(item: I): unknown
  /** An answer that `check` accepts: what the autoplay bot plays. */
  solve(item: I, ctx: CheckContext): unknown
  /** Every catalog key the item uses. */
  textRefs(item: I): TextRef[]
  /** Kind-specific integrity (unknown option, duplicate id, missing gap marker ...). Paths are relative to the item. */
  validate?(item: I, vctx: ValidationContext): Problem[]
  /** The wrong choices of a choice-like item with the key of their misconception explanation, so every distractor can be required to have one. */
  distractors?(item: I): { path: string; id: string; why: string | undefined }[]
}

/** The registered kinds. Read it freely; add with `registerItemKind`. */
export const ITEM_KINDS: Map<string, ItemKindDef> = new Map()

/** Registers a kind. A kind that is already registered is an error unless `replace` is true. */
export function registerItemKind<I extends CourseItem>(def: ItemKindDef<I>, opts: { replace?: boolean } = {}): void {
  if (ITEM_KINDS.has(def.kind) && !opts.replace) throw new Error(`item kind "${def.kind}" is already registered`)
  ITEM_KINDS.set(def.kind, def as unknown as ItemKindDef)
}

/** Removes a kind (for tests of the registry). Returns whether it was registered. */
export function unregisterItemKind(kind: string): boolean {
  return ITEM_KINDS.delete(kind)
}

export const getItemKind = (kind: string): ItemKindDef | undefined => ITEM_KINDS.get(kind)

/** Checks an answer with the checker of the item's kind. An unknown kind or a wrong-shaped answer is `invalid`, never an exception. */
export function checkItem(item: CourseItem, answer: unknown, ctx: CheckContext): CheckResult {
  const def = ITEM_KINDS.get(item.kind)
  if (!def) return { correct: false, score: 0, expected: null, invalid: true }
  try {
    return def.check(item, answer, ctx)
  } catch {
    return { correct: false, score: 0, expected: def.keyOf(item), invalid: true }
  }
}

/** The answer key of an item (`null` for an unknown kind). */
export const answerKeyOf = (item: CourseItem): unknown => ITEM_KINDS.get(item.kind)?.keyOf(item) ?? null

/** A right answer for an item, for the bot (`undefined` for an unknown kind). */
export const solveItem = (item: CourseItem, ctx: CheckContext): unknown => ITEM_KINDS.get(item.kind)?.solve(item, ctx)

/** The human form label of an item's kind (the kind id for an unknown kind). */
export const formOf = (item: Pick<CourseItem, 'kind'>): string => ITEM_KINDS.get(item.kind)?.form ?? item.kind
