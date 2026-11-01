import { describe, expect, it } from 'vitest'
import { DE_CONNECTORS, RELATIVE_PRONOUNS, conjugate, connectorClass, findConnector, findVerb, relativePronoun, rulesFor, tenseForCefr, type DeTense, languageRulesText } from '../src/shared/lang'

// The tables are model-written and not natively reviewed. Every golden below follows from a rule of German grammar:
// Passiv = werden / wurde / ist ... worden + Partizip II; Konjunktiv II past = hätte / wäre + Partizip II (wäre with sein-verbs);
// Konjunktiv I = infinitive stem + e / est / e / en / et / en (sei for sein).
const form = (inf: string, tense: DeTense, person: string): string[] => conjugate(findVerb(inf)!, tense, person)

const PASSIV: [string, DeTense, string, string][] = [
  ['machen', 'passiv-praesens', 'er', 'wird gemacht'],
  ['öffnen', 'passiv-praesens', 'du', 'wirst geöffnet'],
  ['aufmachen', 'passiv-praesens', 'er', 'wird aufgemacht'],
  ['studieren', 'passiv-praesens', 'du', 'wirst studiert'],
  ['machen', 'passiv-praeteritum', 'er', 'wurde gemacht'],
  ['kaufen', 'passiv-praeteritum', 'du', 'wurdest gekauft'],
  ['machen', 'perfekt-passiv', 'er', 'ist gemacht worden'],
  ['einladen', 'perfekt-passiv', 'du', 'bist eingeladen worden']
]

const K2_PAST: [string, string, string][] = [
  ['gehen', 'ich', 'wäre gegangen'],
  ['kommen', 'du', 'wärst gekommen'],
  ['machen', 'ich', 'hätte gemacht'],
  ['sein', 'ihr', 'wärt gewesen'],
  ['aufstehen', 'ich', 'wäre aufgestanden'],
  ['freuen', 'ich', 'hätte mich gefreut']
]

describe('German B2 tenses: Passiv', () => {
  it('forms the three Passiv tenses (regular, separable, no ge-) and has none for sein-verbs, haben, modals, reflexives or stative verbs', () => {
    for (const [inf, tense, person, expected] of PASSIV) expect(form(inf, tense, person)[0], `${inf} ${tense} ${person}`).toBe(expected)
    for (const inf of ['gehen', 'sein', 'haben', 'können', 'freuen', 'wohnen', 'bleiben', 'liegen']) {
      for (const t of ['passiv-praesens', 'passiv-praeteritum', 'perfekt-passiv'] as DeTense[]) expect(form(inf, t, 'er'), `${inf} ${t}`).toEqual([])
    }
  })
})

describe('German B2 tenses: Konjunktiv II, past', () => {
  it('uses hätte / wäre + Partizip II and accepts the long variants of wäre', () => {
    for (const [inf, person, expected] of K2_PAST) expect(form(inf, 'konjunktiv2-vergangenheit', person)[0], `${inf} ${person}`).toBe(expected)
    expect(form('kommen', 'konjunktiv2-vergangenheit', 'du')).toEqual(['wärst gekommen', 'wärest gekommen'])
    expect(form('sein', 'konjunktiv2-vergangenheit', 'ihr')).toEqual(['wärt gewesen', 'wäret gewesen'])
  })
})

// Konjunktiv I (indirect speech) is a stretch goal of EGS-37; its goldens pass, so it ships.
describe('German B2 tenses: Konjunktiv I (stretch)', () => {
  it('forms Konjunktiv I and its past (sein-verbs take sei, separable and reflexive verbs split)', () => {
    const K1: [string, string, string][] = [['sein', 'ich', 'sei'], ['gehen', 'du', 'gehest'], ['können', 'er', 'könne'], ['sammeln', 'du', 'sammlest'], ['aufstehen', 'er', 'stehe auf'], ['freuen', 'er', 'freue sich']]
    for (const [inf, person, expected] of K1) expect(form(inf, 'konjunktiv1', person)[0], `${inf} ${person}`).toBe(expected)
    const K1P: [string, string, string][] = [['gehen', 'er', 'sei gegangen'], ['machen', 'er', 'habe gemacht'], ['lesen', 'du', 'habest gelesen'], ['freuen', 'er', 'habe sich gefreut']]
    for (const [inf, person, expected] of K1P) expect(form(inf, 'konjunktiv1-vergangenheit', person)[0], `${inf} ${person}`).toBe(expected)
  })
})

describe('B2 tenses are taught at B2', () => {
  it('tenseForCefr says B2 and the new tenses never return an empty form', () => {
    for (const t of ['passiv-praesens', 'passiv-praeteritum', 'perfekt-passiv', 'konjunktiv2-vergangenheit', 'konjunktiv1', 'konjunktiv1-vergangenheit'] as DeTense[]) {
      expect(tenseForCefr(findVerb('machen'), t)).toBe('B2')
    }

    for (const inf of ['sein', 'gehen', 'machen', 'aufstehen', 'freuen', 'sammeln', 'wandern', 'können']) {
      for (const t of ['passiv-praesens', 'konjunktiv2-vergangenheit', 'konjunktiv1'] as DeTense[]) {
        for (const p of ['ich', 'du', 'er', 'wir', 'ihr', 'sie', 'Sie']) for (const f of form(inf, t, p)) expect(f.trim()).not.toBe('')
      }
    }
  })
})

describe('relative pronoun table', () => {
  const FULL: Record<string, string[]> = {
    // gender: [nom, acc, dat, gen]
    m: ['der', 'den', 'dem', 'dessen'],
    f: ['die', 'die', 'der', 'deren'],
    n: ['das', 'das', 'dem', 'dessen'],
    pl: ['die', 'die', 'denen', 'deren']
  }
  it('is the whole table, 16 cells, and puts the preposition in front', () => {
    for (const g of ['m', 'f', 'n', 'pl'] as const) {
      expect((['nom', 'acc', 'dat', 'gen'] as const).map((c) => RELATIVE_PRONOUNS[g][c])).toEqual(FULL[g])
    }

    // puts the preposition in front
    expect(relativePronoun('f', 'dat', 'mit')).toEqual(['mit der', 'der'])
    expect(relativePronoun('m', 'dat', 'In')).toEqual(['in dem', 'dem'])
    expect(relativePronoun('pl', 'acc')).toEqual(['die'])
  })
})

describe('connectors', () => {
  const CLASSES = {
    'verb-final': ['weil', 'dass', 'obwohl', 'während', 'sodass', 'indem', 'falls', 'ob', 'damit', 'nachdem', 'bevor'],
    inversion: ['deshalb', 'trotzdem', 'deswegen', 'außerdem', 'dennoch', 'folglich'],
    coordinating: ['und', 'aber', 'denn', 'oder', 'sondern']
  }
  it('has the three word-order classes, is case-insensitive and unknown words have no class', () => {
    for (const [cls, words] of Object.entries(CLASSES)) {
      for (const w of words) expect(connectorClass(w), w).toBe(cls)
      expect(DE_CONNECTORS.filter((c) => c.class === cls).map((c) => c.word).sort()).toEqual([...words].sort())
    }
    expect(findConnector('Weil')?.class).toBe('verb-final')
    expect(connectorClass('Haus')).toBeUndefined()
  })
})

describe('the B2 rules are level-gated (EGS-36)', () => {
  it('B2 has the grammar rules and the reading rules, A1 and B1 do not; the base rules stay', () => {
    const b2 = languageRulesText('de', false, 'B2')
    expect(b2).toContain('German B2 grammar')
    expect(b2).toContain('GRAMMAR_CONNECTOR_CLASS')
    expect(b2).toContain('German rules')
    for (const level of ['A1', 'A2', 'B1', undefined]) expect(languageRulesText('de', true, level)).not.toContain('German B2 grammar')
    expect(rulesFor('de')!.promptRules).not.toContain('German B2 grammar')
  })
})
