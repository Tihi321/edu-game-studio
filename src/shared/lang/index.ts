import { conjugate, findVerb, tenseForCefr } from './de/verbs'
import { DE_PROMPT_RULES } from './de/rules'
import { DE_B2_RULES } from './de/rules-b2'

/** What the pipeline and the lint know about a taught language. */
export interface LanguageRules {
  /** Text for the writer prompts (`{{language_rules}}`). */
  promptRules: string
  /** A deterministic paradigm table, where the language has one. */
  verbTable?: {
    findVerb: typeof findVerb
    conjugate: typeof conjugate
    tenseForCefr: typeof tenseForCefr
  }
}

const REGISTRY: Record<string, LanguageRules> = {
  de: { promptRules: `${DE_PROMPT_RULES}

${DE_B2_RULES}`, verbTable: { findVerb, conjugate, tenseForCefr } }
}

/** The rules of a language, or undefined when it has none (every language but German today). */
export function rulesFor(lang: string | undefined): LanguageRules | undefined {
  return lang ? REGISTRY[lang.toLowerCase()] : undefined
}

export { findVerb, conjugate, tenseForCefr, levelRank, DE_VERBS, DE_TENSES } from './de/verbs'
export type { DeVerb, DeTense } from './de/verbs'
export { DE_CONNECTORS, RELATIVE_PRONOUNS, findConnector, connectorClass, relativePronoun, isConnectorClass, isRelCase, isRelGender } from './de/grammar'
export type { Connector, ConnectorClass, RelCase, RelGender } from './de/grammar'
export { PRONOUN_LABELS, REFLEXIVE_PRONOUNS, DE_PERSONS, isDePerson } from './de/pronouns'
export type { DePerson } from './de/pronouns'
