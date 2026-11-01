import type { CoursePack } from '../../shared/course'
import type { TextResolver } from '../../shared/edu'
import { conjugate, findVerb, levelRank, tenseForCefr, type DeTense } from '../../shared/lang/de/verbs'

/**
 * Lint of `conjugation` items against the German verb table (EGS-28).
 *
 * The `conjugation` item kind is added by EGS-27. This module reads an item STRUCTURALLY (kind === 'conjugation', `verb`, `tense`,
 * `forms[].person` / `.answer` as in the EGS-27 schema) so it compiles and runs without the kind being registered. It only does
 * anything when `pack.targetLang === 'de'`.
 */

export const CONJ_LINT_CODES = ['CONJ_FORM_MISMATCH', 'CONJ_VERB_UNKNOWN', 'CONJ_TENSE_LEVEL'] as const
export const CONJ_WARNING_CODES: ReadonlySet<string> = new Set(['CONJ_VERB_UNKNOWN', 'CONJ_TENSE_LEVEL'])

export interface ConjProblem {
  code: (typeof CONJ_LINT_CODES)[number]
  path: string
  message: string
  severity: 'error' | 'warning'
  lang?: string
}

const TENSES = new Set<string>(['praesens', 'perfekt', 'praeteritum', 'futur1', 'imperativ', 'konjunktiv2'])
const clean = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()

/** The problems of one conjugation item (raw pack item) in one edition. */
export function lintConjugationItem(pack: Pick<CoursePack, 'targetLang' | 'cefr'>, item: Record<string, unknown>, at: string, res: TextResolver): ConjProblem[] {
  if (pack.targetLang !== 'de' || item.kind !== 'conjugation') return []
  const out: ConjProblem[] = []
  const verbKey = typeof item.verb === 'string' ? item.verb : ''
  const infinitive = (res.text(verbKey) ?? '').trim()
  const tense = typeof item.tense === 'string' ? item.tense : ''
  if (infinitive === '') return out
  const verb = findVerb(infinitive)
  if (!verb) {
    out.push({ code: 'CONJ_VERB_UNKNOWN', path: `${at}.verb`, severity: 'warning', message: `the verb "${infinitive}" is not in the German verb table: check its forms by hand` })
    return out
  }
  if (!TENSES.has(tense)) return out
  const t = tense as DeTense
  if (pack.cefr && levelRank(tenseForCefr(verb, t)) > levelRank(pack.cefr)) {
    out.push({ code: 'CONJ_TENSE_LEVEL', path: `${at}.tense`, severity: 'warning', message: `the tense "${tense}" of "${verb.inf}" is taught at ${tenseForCefr(verb, t)}, above the course level ${pack.cefr}` })
  }
  const forms = Array.isArray(item.forms) ? (item.forms as { person?: unknown; answer?: unknown }[]) : []
  forms.forEach((f, i) => {
    if (typeof f?.person !== 'string' || typeof f.answer !== 'string') return
    const expected = conjugate(verb, t, f.person)
    if (expected.length === 0) return // a person the tense does not have: CONJ_IMPERATIVE_PERSON (EGS-27) reports it
    const canonical = res.accepted(f.answer)[0]
    if (canonical === undefined || canonical.trim() === '') return // ACCEPTED_INCOMPLETE reports it
    if (!expected.map(clean).includes(clean(canonical))) {
      out.push({
        code: 'CONJ_FORM_MISMATCH',
        path: `${at}.forms[${i}]`,
        severity: 'error',
        message: `"${canonical}" is not a form of "${verb.inf}" (${tense}, ${f.person}); the table has: ${expected.join(' / ')}`
      })
    }
  })
  return out
}
