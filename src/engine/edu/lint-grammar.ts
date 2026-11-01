import type { CoursePack } from '../../shared/course'
import type { TextResolver } from '../../shared/edu'
import { RELATIVE_PRONOUNS, connectorClass, isConnectorClass, isRelCase, isRelGender, relativePronoun } from '../../shared/lang/de/grammar'

/**
 * Lint of the German B2 grammar items (EGS-37). Only for `pack.targetLang === 'de'`; an item opts in with `extensions.grammar`:
 *
 * - `{ kind: 'relative', gender: 'm'|'f'|'n'|'pl', case: 'nom'|'acc'|'dat'|'gen', prep?: string, gap?: string }` on a `cloze`: the canonical answer of the
 *   gap (the first gap unless `gap` names one) must be the pronoun of the table, with the preposition in front when `prep` is given.
 * - `{ kind: 'connector', class: 'verb-final'|'inversion'|'coordinating', gap?: string }` on a `cloze`: the gap's canonical answer must be a connector of that class.
 * - `{ kind: 'connector-sort', groups: { <groupId>: <class> } }` on a `sort-groups`: every item whose text is a connector of the table must sit in a group of its class.
 * - `{ kind: 'transform' }` on a `typed` item: needs two or more accepted variants.
 *
 * The tables were written by a language model and are not natively reviewed (see grammar.ts).
 */

export const GRAMMAR_LINT_CODES = ['GRAMMAR_FORM_MISMATCH', 'GRAMMAR_CONNECTOR_CLASS', 'GRAMMAR_TRANSFORM_ONE_ANSWER'] as const
export const GRAMMAR_WARNING_CODES: ReadonlySet<string> = new Set(['GRAMMAR_TRANSFORM_ONE_ANSWER'])

export interface GrammarProblem {
  code: (typeof GRAMMAR_LINT_CODES)[number]
  path: string
  message: string
  severity: 'error' | 'warning'
}

const clean = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

interface RawGap {
  id?: unknown
  answer?: unknown
}

function pickGap(item: Record<string, unknown>, id: unknown): RawGap | undefined {
  const gaps = (Array.isArray(item.gaps) ? item.gaps : []).filter(isObj) as RawGap[]
  return typeof id === 'string' ? gaps.find((g) => g.id === id) : gaps[0]
}

export function lintGrammarItem(pack: Pick<CoursePack, 'targetLang'>, item: Record<string, unknown>, at: string, res: TextResolver): GrammarProblem[] {
  if (pack.targetLang !== 'de') return []
  const ext = isObj(item.extensions) ? item.extensions : undefined
  const g = ext && isObj(ext.grammar) ? ext.grammar : undefined
  if (!g || typeof g.kind !== 'string') return []
  const out: GrammarProblem[] = []
  const path = `${at}.extensions.grammar`

  if (g.kind === 'relative' || g.kind === 'connector') {
    if (item.kind !== 'cloze') return out
    const gap = pickGap(item, g.gap)
    const canonical = gap && typeof gap.answer === 'string' ? res.accepted(gap.answer)[0] : undefined
    if (g.kind === 'relative') {
      if (!isRelGender(g.gender) || !isRelCase(g.case)) {
        out.push({ code: 'GRAMMAR_FORM_MISMATCH', path, severity: 'error', message: `a relative-pronoun item needs gender (${Object.keys(RELATIVE_PRONOUNS).join(', ')}) and case (nom, acc, dat, gen)` })
        return out
      }
      if (!canonical || canonical.trim() === '') return out // ACCEPTED_INCOMPLETE reports it
      const prep = typeof g.prep === 'string' && g.prep.trim() !== '' ? g.prep : undefined
      const expected = relativePronoun(g.gender, g.case, prep)
      // the table has one pronoun; with a preposition the gap holds "mit dem" (the whole phrase) or only "dem"
      if (!expected.map(clean).includes(clean(canonical))) {
        out.push({ code: 'GRAMMAR_FORM_MISMATCH', path: `${at}.gaps`, severity: 'error', message: `"${canonical}" is not the relative pronoun for ${g.gender} / ${g.case}${prep ? ` after "${prep}"` : ''}; the table has: ${expected.join(' / ')}` })
      }
      return out
    }
    if (!isConnectorClass(g.class)) {
      out.push({ code: 'GRAMMAR_CONNECTOR_CLASS', path, severity: 'error', message: 'a connector item needs a class: verb-final, inversion or coordinating' })
      return out
    }
    if (!canonical || canonical.trim() === '') return out
    const actual = connectorClass(canonical)
    if (actual === undefined) {
      out.push({ code: 'GRAMMAR_CONNECTOR_CLASS', path: `${at}.gaps`, severity: 'error', message: `"${canonical}" is not a connector in the table, so its class ${g.class} cannot be checked` })
    } else if (actual !== g.class) {
      out.push({ code: 'GRAMMAR_CONNECTOR_CLASS', path: `${at}.gaps`, severity: 'error', message: `"${canonical}" is a ${actual} connector, but the item says ${g.class}` })
    }
    return out
  }

  if (g.kind === 'connector-sort') {
    if (item.kind !== 'sort-groups' || !isObj(g.groups)) return out
    const groups = g.groups
    const items = (Array.isArray(item.items) ? item.items : []).filter(isObj)
    items.forEach((it, i) => {
      if (typeof it.text !== 'string' || typeof it.group !== 'string') return
      const word = res.text(it.text)
      if (!word) return
      const actual = connectorClass(word)
      if (actual === undefined) return
      const declared = groups[it.group]
      if (declared !== actual) {
        out.push({ code: 'GRAMMAR_CONNECTOR_CLASS', path: `${at}.items[${i}]`, severity: 'error', message: `"${word}" is a ${actual} connector but sits in the group "${it.group}" (${String(declared)})` })
      }
    })
    return out
  }

  if (g.kind === 'transform') {
    if (item.kind !== 'typed' || typeof item.answer !== 'string') return out
    const variants = new Set(res.accepted(item.answer).map(clean).filter((s) => s !== ''))
    if (variants.size === 1) {
      out.push({ code: 'GRAMMAR_TRANSFORM_ONE_ANSWER', path: `${at}.answer`, severity: 'warning', message: 'a transformation usually has more than one correct sentence (word order, with or without the agent): list the variants in the accepted answers' })
    }
  }
  return out
}
