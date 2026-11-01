import { conjugate, findVerb, tenseForCefr } from './de/verbs'
import { DE_ITEM_SHAPES, DE_PROMPT_RULES } from './de/rules'
import { DE_B2_RULES } from './de/rules-b2'
import { DE_READING_ITEM_SHAPES, DE_READING_RULES } from './de/rules-reading'

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
  de: {
    promptRules: DE_PROMPT_RULES,
    itemShapes: DE_ITEM_SHAPES,
    verbTable: { findVerb, conjugate, tenseForCefr }
  }
}

/** The rules of a language, or undefined when it has none (every language but German today). */
export function rulesFor(lang: string | undefined): LanguageRules | undefined {
  return lang ? REGISTRY[lang.toLowerCase()] : undefined
}

/**
 * `{{language_rules}}` for a course: the rules of the taught language, plus the item shapes for the item-writer; empty for a language without rules.
 * German at B2 also gets the B2 grammar rules (EGS-37) and the reading rules (EGS-36); the reading item shapes also go to the writer at B1 (readings).
 * `cefr` is the level of the course; no other level gets the B2 text.
 */
export function languageRulesText(targetLang: string | undefined, forWriter = false, cefr?: string): string {
  const r = rulesFor(targetLang)
  if (!r) return ''
  const de = targetLang?.toLowerCase() === 'de'
  const b2 = de && cefr === 'B2'
  const rules = b2 ? `${r.promptRules}\n\n${DE_B2_RULES}\n\n${DE_READING_RULES}` : r.promptRules
  const shapes = forWriter && r.itemShapes ? (de && (cefr === 'B1' || b2) ? `${r.itemShapes}\n\n${DE_READING_ITEM_SHAPES}` : r.itemShapes) : ''
  return shapes ? `${rules}\n\n${shapes}` : rules
}

export { findVerb, conjugate, tenseForCefr, levelRank, DE_VERBS, DE_TENSES } from './de/verbs'
export type { DeVerb, DeTense } from './de/verbs'
export { DE_CONNECTORS, RELATIVE_PRONOUNS, findConnector, connectorClass, relativePronoun, isConnectorClass, isRelCase, isRelGender } from './de/grammar'
export type { Connector, ConnectorClass, RelCase, RelGender } from './de/grammar'
export { PRONOUN_LABELS, REFLEXIVE_PRONOUNS, DE_PERSONS, isDePerson } from './de/pronouns'
export type { DePerson } from './de/pronouns'
