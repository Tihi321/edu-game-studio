/**
 * German B2 grammar tables (EGS-37): connectors by word-order class and the relative pronoun table. Pure data, no dependency.
 *
 * HONESTY NOTE: written by a language model and NOT reviewed by a native speaker. `tests/de-grammar.test.ts` checks a set of goldens that
 * follow from the rules of German grammar. The Passiv / Konjunktiv tenses live in `verbs.ts` (`conjugate`).
 */

export type ConnectorClass = 'verb-final' | 'inversion' | 'coordinating'

export interface Connector {
  word: string
  /** verb-final: the finite verb goes to the end of the clause ("weil er kommt"); inversion: the verb follows the connector ("deshalb kommt er"); coordinating: no change of word order ("und er kommt"). */
  class: ConnectorClass
  /** English gloss. */
  meaning: string
  level: 'A1' | 'A2' | 'B1' | 'B2'
}

export const DE_CONNECTORS: readonly Connector[] = [
  { word: 'weil', class: 'verb-final', meaning: 'because', level: 'A1' },
  { word: 'dass', class: 'verb-final', meaning: 'that', level: 'A2' },
  { word: 'obwohl', class: 'verb-final', meaning: 'although', level: 'B1' },
  { word: 'während', class: 'verb-final', meaning: 'while, whereas', level: 'B1' },
  { word: 'sodass', class: 'verb-final', meaning: 'so that (result)', level: 'B2' },
  { word: 'indem', class: 'verb-final', meaning: 'by (doing)', level: 'B2' },
  { word: 'falls', class: 'verb-final', meaning: 'in case, if', level: 'B1' },
  { word: 'ob', class: 'verb-final', meaning: 'whether', level: 'A2' },
  { word: 'damit', class: 'verb-final', meaning: 'so that (purpose)', level: 'B1' },
  { word: 'nachdem', class: 'verb-final', meaning: 'after', level: 'B1' },
  { word: 'bevor', class: 'verb-final', meaning: 'before', level: 'B1' },
  { word: 'deshalb', class: 'inversion', meaning: 'therefore', level: 'A2' },
  { word: 'trotzdem', class: 'inversion', meaning: 'nevertheless', level: 'B1' },
  { word: 'deswegen', class: 'inversion', meaning: 'for that reason', level: 'A2' },
  { word: 'außerdem', class: 'inversion', meaning: 'besides', level: 'B1' },
  { word: 'dennoch', class: 'inversion', meaning: 'yet, still', level: 'B2' },
  { word: 'folglich', class: 'inversion', meaning: 'consequently', level: 'B2' },
  { word: 'und', class: 'coordinating', meaning: 'and', level: 'A1' },
  { word: 'aber', class: 'coordinating', meaning: 'but', level: 'A1' },
  { word: 'denn', class: 'coordinating', meaning: 'because', level: 'A2' },
  { word: 'oder', class: 'coordinating', meaning: 'or', level: 'A1' },
  { word: 'sondern', class: 'coordinating', meaning: 'but rather', level: 'A2' }
]

const CONNECTOR_INDEX = new Map(DE_CONNECTORS.map((c) => [c.word, c]))

/** The table entry of a connector word (case-insensitive: "Weil" at the start of a sentence), or undefined. */
export function findConnector(word: string): Connector | undefined {
  return CONNECTOR_INDEX.get(word.normalize('NFC').trim().toLowerCase())
}

export function connectorClass(word: string): ConnectorClass | undefined {
  return findConnector(word)?.class
}

export const CONNECTOR_CLASSES: readonly ConnectorClass[] = ['verb-final', 'inversion', 'coordinating']
export const isConnectorClass = (x: unknown): x is ConnectorClass => typeof x === 'string' && (CONNECTOR_CLASSES as readonly string[]).includes(x)

// ---------------------------------------------------------------- relative pronouns

/** The gender / number of the noun the relative clause refers to: masculine, feminine, neuter, plural. */
export type RelGender = 'm' | 'f' | 'n' | 'pl'
/** The case the pronoun has inside the relative clause. */
export type RelCase = 'nom' | 'acc' | 'dat' | 'gen'
export const REL_GENDERS: readonly RelGender[] = ['m', 'f', 'n', 'pl']
export const REL_CASES: readonly RelCase[] = ['nom', 'acc', 'dat', 'gen']

export const RELATIVE_PRONOUNS: Record<RelGender, Record<RelCase, string>> = {
  m: { nom: 'der', acc: 'den', dat: 'dem', gen: 'dessen' },
  f: { nom: 'die', acc: 'die', dat: 'der', gen: 'deren' },
  n: { nom: 'das', acc: 'das', dat: 'dem', gen: 'dessen' },
  pl: { nom: 'die', acc: 'die', dat: 'denen', gen: 'deren' }
}

export const isRelGender = (x: unknown): x is RelGender => typeof x === 'string' && (REL_GENDERS as readonly string[]).includes(x)
export const isRelCase = (x: unknown): x is RelCase => typeof x === 'string' && (REL_CASES as readonly string[]).includes(x)

/**
 * The accepted answers for a relative pronoun gap: the pronoun, preceded by the preposition when one is given ("mit dem", "in der").
 * With a preposition the bare pronoun is also accepted, for a gap that holds only the pronoun (`['mit dem', 'dem']`).
 */
export function relativePronoun(gender: RelGender, grammaticalCase: RelCase, preposition?: string): string[] {
  const p = RELATIVE_PRONOUNS[gender][grammaticalCase]
  const prep = preposition?.normalize('NFC').trim().toLowerCase()
  return prep ? [`${prep} ${p}`, p] : [p]
}
