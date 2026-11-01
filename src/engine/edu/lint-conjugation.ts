import type { CoursePack } from '../../shared/course'
import type { TextResolver } from '../../shared/edu'
import { conjugate, findVerb, levelRank, tenseForCefr, type DeTense } from '../../shared/lang/de/verbs'

/**
 * Lint of `conjugation` items (EGS-27 structure, EGS-28 verb table).
 *
 * The structural checks (duplicate person, `ask` too large, ambiguous forms, imperative persons) work on the raw pack item; the checks against
 * the German verb table only run when `pack.targetLang === 'de'`.
 */

export const CONJ_LINT_CODES = ['CONJ_PERSON_DUPLICATE', 'CONJ_ASK_TOO_MANY', 'CONJ_IMPERATIVE_PERSON', 'CONJ_FORM_DUPLICATE_AMBIGUOUS', 'CONJ_FORM_MISMATCH', 'CONJ_VERB_UNKNOWN', 'CONJ_TENSE_LEVEL'] as const
export const CONJ_WARNING_CODES: ReadonlySet<string> = new Set(['CONJ_FORM_DUPLICATE_AMBIGUOUS', 'CONJ_VERB_UNKNOWN', 'CONJ_TENSE_LEVEL'])

export interface ConjProblem {
  code: (typeof CONJ_LINT_CODES)[number]
  path: string
  message: string
  severity: 'error' | 'warning'
  lang?: string
}

const TENSES = new Set<string>(['praesens', 'perfekt', 'praeteritum', 'futur1', 'imperativ', 'konjunktiv2'])
const clean = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()

const DE_IMPERATIVE_PERSONS = new Set(['du', 'ihr', 'Sie'])

interface RawForm {
  person?: unknown
  answer?: unknown
  given?: unknown
}

/** The checks that need no verb table: persons, `ask`, forms that cannot be told apart. */
function structure(pack: Pick<CoursePack, 'targetLang'>, item: Record<string, unknown>, at: string, res: TextResolver): ConjProblem[] {
  const out: ConjProblem[] = []
  const forms = (Array.isArray(item.forms) ? item.forms : []).filter((f): f is RawForm => typeof f === 'object' && f !== null)
  const seen = new Set<string>()
  forms.forEach((f, i) => {
    if (typeof f.person !== 'string') return
    if (seen.has(f.person)) out.push({ code: 'CONJ_PERSON_DUPLICATE', path: `${at}.forms[${i}].person`, severity: 'error', message: `the person "${f.person}" appears twice in the forms` })
    seen.add(f.person)
  })
  const asked = forms.filter((f) => f.given !== true)
  if (typeof item.ask === 'number' && item.ask > asked.length) {
    out.push({ code: 'CONJ_ASK_TOO_MANY', path: `${at}.ask`, severity: 'error', message: `ask is ${item.ask} but only ${asked.length} form(s) are asked (the others are given)` })
  }
  if (pack.targetLang === 'de' && item.tense === 'imperativ') {
    forms.forEach((f, i) => {
      if (typeof f.person === 'string' && !DE_IMPERATIVE_PERSONS.has(f.person)) out.push({ code: 'CONJ_IMPERATIVE_PERSON', path: `${at}.forms[${i}].person`, severity: 'error', message: `the imperative has no form for "${f.person}" (only du, ihr, Sie)` })
    })
  }
  const byForm = new Map<string, string[]>()
  for (const f of asked) {
    if (typeof f.person !== 'string' || typeof f.answer !== 'string') continue
    const canonical = res.accepted(f.answer)[0]
    if (canonical === undefined || canonical.trim() === '') continue
    const key = clean(canonical)
    byForm.set(key, [...(byForm.get(key) ?? []), f.person])
  }
  for (const [form, persons] of byForm) {
    if (persons.length > 1) out.push({ code: 'CONJ_FORM_DUPLICATE_AMBIGUOUS', path: `${at}.forms`, severity: 'warning', message: `"${form}" is the form of ${persons.join(' and ')}, all asked: the learner cannot tell which person is meant (give one of them)` })
  }
  return out
}

/** The problems of one conjugation item (raw pack item) in one edition. */
export function lintConjugationItem(pack: Pick<CoursePack, 'targetLang' | 'cefr'>, item: Record<string, unknown>, at: string, res: TextResolver): ConjProblem[] {
  if (item.kind !== 'conjugation') return []
  const out: ConjProblem[] = []
  out.push(...structure(pack, item, at, res))
  if (pack.targetLang !== 'de') return out
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
