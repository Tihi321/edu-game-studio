import { conjugate, findVerb, tenseForCefr } from './de/verbs'
import { DE_ITEM_SHAPES, DE_PROMPT_RULES } from './de/rules'

/** What the pipeline and the lint know about a taught language. */
export interface LanguageRules {
  /** Text for the writer prompts (`{{language_rules}}`). */
  promptRules: string
  /** Item shapes only the item-writer gets (the German `conjugation` kind). */
  itemShapes?: string
  /** A deterministic paradigm table, where the language has one. */
  verbTable?: {
    findVerb: typeof findVerb
    conjugate: typeof conjugate
    tenseForCefr: typeof tenseForCefr
  }
}

const REGISTRY: Record<string, LanguageRules> = {
  de: { promptRules: DE_PROMPT_RULES, itemShapes: DE_ITEM_SHAPES, verbTable: { findVerb, conjugate, tenseForCefr } }
}

/** The rules of a language, or undefined when it has none (every language but German today). */
export function rulesFor(lang: string | undefined): LanguageRules | undefined {
  return lang ? REGISTRY[lang.toLowerCase()] : undefined
}

/** `{{language_rules}}` for a course: the rules of the taught language, plus the item shapes for the item-writer; empty for a language without rules. */
export function languageRulesText(targetLang: string | undefined, forWriter = false): string {
  const r = rulesFor(targetLang)
  if (!r) return ''
  return forWriter && r.itemShapes ? `${r.promptRules}

${r.itemShapes}` : r.promptRules
}

export { findVerb, conjugate, tenseForCefr, levelRank, DE_VERBS, DE_TENSES } from './de/verbs'
export type { DeVerb, DeTense } from './de/verbs'
export { PRONOUN_LABELS, REFLEXIVE_PRONOUNS, DE_PERSONS, isDePerson } from './de/pronouns'
export type { DePerson } from './de/pronouns'
