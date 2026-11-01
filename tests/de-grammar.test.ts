import { describe, expect, it } from 'vitest'
import { DE_CONNECTORS, RELATIVE_PRONOUNS, conjugate, connectorClass, findConnector, findVerb, relativePronoun, rulesFor, tenseForCefr, type DeTense } from '../src/shared/lang'

// The tables are model-written and not natively reviewed. Every golden below follows from a rule of German grammar:
// Passiv = werden / wurde / ist ... worden + Partizip II; Konjunktiv II past = hätte / wäre + Partizip II (wäre with sein-verbs);
// Konjunktiv I = infinitive stem + e / est / e / en / et / en (sei for sein).
const form = (inf: string, tense: DeTense, person: string): string[] => conjugate(findVerb(inf)!, tense, person)

const PASSIV: [string, DeTense, string, string][] = [
  ['machen', 'passiv-praesens', 'er', 'wird gemacht'],
  ['machen', 'passiv-praesens', 'ich', 'werde gemacht'],
  ['öffnen', 'passiv-praesens', 'du', 'wirst geöffnet'],
  ['lesen', 'passiv-praesens', 'wir', 'werden gelesen'],
  ['sehen', 'passiv-praesens', 'ihr', 'werdet gesehen'],
  ['schreiben', 'passiv-praesens', 'sie', 'werden geschrieben'],
  ['aufmachen', 'passiv-praesens', 'er', 'wird aufgemacht'],
  ['besuchen', 'passiv-praesens', 'ich', 'werde besucht'],
  ['studieren', 'passiv-praesens', 'du', 'wirst studiert'],
  ['finden', 'passiv-praesens', 'er', 'wird gefunden'],
  ['einladen', 'passiv-praesens', 'Sie', 'werden eingeladen'],
  ['anrufen', 'passiv-praesens', 'ich', 'werde angerufen'],
  ['machen', 'passiv-praeteritum', 'er', 'wurde gemacht'],
  ['kaufen', 'passiv-praeteritum', 'du', 'wurdest gekauft'],
  ['lesen', 'passiv-praeteritum', 'wir', 'wurden gelesen'],
  ['sehen', 'passiv-praeteritum', 'ihr', 'wurdet gesehen'],
  ['geben', 'passiv-praeteritum', 'ich', 'wurde gegeben'],
  ['abholen', 'passiv-praeteritum', 'sie', 'wurden abgeholt'],
  ['verkaufen', 'passiv-praeteritum', 'er', 'wurde verkauft'],
  ['nehmen', 'passiv-praeteritum', 'sie', 'wurden genommen'],
  ['machen', 'perfekt-passiv', 'er', 'ist gemacht worden'],
  ['lesen', 'perfekt-passiv', 'ich', 'bin gelesen worden'],
  ['bringen', 'perfekt-passiv', 'wir', 'sind gebracht worden'],
  ['bezahlen', 'perfekt-passiv', 'ihr', 'seid bezahlt worden'],
  ['einladen', 'perfekt-passiv', 'du', 'bist eingeladen worden'],
  ['schließen', 'perfekt-passiv', 'sie', 'sind geschlossen worden']
]

const K2_PAST: [string, string, string][] = [
  ['gehen', 'ich', 'wäre gegangen'],
  ['kommen', 'du', 'wärst gekommen'],
  ['machen', 'ich', 'hätte gemacht'],
  ['sehen', 'er', 'hätte gesehen'],
  ['haben', 'wir', 'hätten gehabt'],
  ['sein', 'ich', 'wäre gewesen'],
  ['sein', 'ihr', 'wärt gewesen'],
  ['werden', 'er', 'wäre geworden'],
  ['bleiben', 'wir', 'wären geblieben'],
  ['lesen', 'du', 'hättest gelesen'],
  ['essen', 'ihr', 'hättet gegessen'],
  ['fahren', 'sie', 'wären gefahren'],
  ['aufstehen', 'ich', 'wäre aufgestanden'],
  ['anrufen', 'du', 'hättest angerufen'],
  ['freuen', 'ich', 'hätte mich gefreut'],
  ['freuen', 'wir', 'hätten uns gefreut'],
  ['wissen', 'er', 'hätte gewusst'],
  ['können', 'ich', 'hätte gekonnt'],
  ['schlafen', 'ihr', 'hättet geschlafen'],
  ['studieren', 'ich', 'hätte studiert'],
  ['schwimmen', 'sie', 'wären geschwommen'],
  ['fliegen', 'wir', 'wären geflogen'],
  ['kaufen', 'er', 'hätte gekauft']
]

describe('German B2 tenses: Passiv', () => {
  it.each(PASSIV)('%s %s %s -> %s', (inf, tense, person, expected) => {
    expect(form(inf, tense, person)[0]).toBe(expected)
  })
  it('has at least 20 golden forms', () => expect(PASSIV.length).toBeGreaterThanOrEqual(20))
  it('has no Passiv for sein-verbs, haben, modals, reflexives or stative verbs', () => {
    for (const inf of ['gehen', 'sein', 'haben', 'können', 'freuen', 'wohnen', 'bleiben', 'liegen']) {
      for (const t of ['passiv-praesens', 'passiv-praeteritum', 'perfekt-passiv'] as DeTense[]) expect(form(inf, t, 'er'), `${inf} ${t}`).toEqual([])
    }
  })
})

describe('German B2 tenses: Konjunktiv II, past', () => {
  it.each(K2_PAST)('%s %s -> %s', (inf, person, expected) => {
    expect(form(inf, 'konjunktiv2-vergangenheit', person)[0]).toBe(expected)
  })
  it('has at least 20 golden forms', () => expect(K2_PAST.length).toBeGreaterThanOrEqual(20))
  it('accepts the long variants of wäre', () => {
    expect(form('kommen', 'konjunktiv2-vergangenheit', 'du')).toEqual(['wärst gekommen', 'wärest gekommen'])
    expect(form('sein', 'konjunktiv2-vergangenheit', 'ihr')).toEqual(['wärt gewesen', 'wäret gewesen'])
  })
})

// Konjunktiv I (indirect speech) is a stretch goal of EGS-37; its goldens pass, so it ships.
describe('German B2 tenses: Konjunktiv I (stretch)', () => {
  const K1: [string, string, string][] = [
    ['sein', 'ich', 'sei'], ['sein', 'er', 'sei'], ['sein', 'wir', 'seien'], ['sein', 'ihr', 'seiet'],
    ['gehen', 'er', 'gehe'], ['gehen', 'du', 'gehest'], ['gehen', 'wir', 'gehen'], ['haben', 'er', 'habe'], ['machen', 'ihr', 'machet'],
    ['können', 'er', 'könne'], ['müssen', 'er', 'müsse'], ['wissen', 'er', 'wisse'], ['werden', 'er', 'werde'], ['geben', 'er', 'gebe'],
    ['arbeiten', 'du', 'arbeitest'], ['sammeln', 'er', 'sammle'], ['sammeln', 'du', 'sammlest'], ['aufstehen', 'er', 'stehe auf'],
    ['freuen', 'er', 'freue sich'], ['tun', 'er', 'tue'], ['sehen', 'sie', 'sehen']
  ]
  it.each(K1)('%s %s -> %s', (inf, person, expected) => {
    expect(form(inf, 'konjunktiv1', person)[0]).toBe(expected)
  })
  const K1P: [string, string, string][] = [
    ['gehen', 'er', 'sei gegangen'], ['machen', 'er', 'habe gemacht'], ['sein', 'er', 'sei gewesen'], ['haben', 'er', 'habe gehabt'],
    ['kommen', 'sie', 'seien gekommen'], ['lesen', 'du', 'habest gelesen'], ['lesen', 'ihr', 'habet gelesen'], ['freuen', 'er', 'habe sich gefreut']
  ]
  it.each(K1P)('past: %s %s -> %s', (inf, person, expected) => {
    expect(form(inf, 'konjunktiv1-vergangenheit', person)[0]).toBe(expected)
  })
})

describe('B2 tenses are taught at B2', () => {
  it('tenseForCefr', () => {
    for (const t of ['passiv-praesens', 'passiv-praeteritum', 'perfekt-passiv', 'konjunktiv2-vergangenheit', 'konjunktiv1', 'konjunktiv1-vergangenheit'] as DeTense[]) {
      expect(tenseForCefr(findVerb('machen'), t)).toBe('B2')
    }
  })
  it('the new tenses never return an empty form', () => {
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
  it('is the whole table, 16 cells', () => {
    for (const g of ['m', 'f', 'n', 'pl'] as const) {
      expect((['nom', 'acc', 'dat', 'gen'] as const).map((c) => RELATIVE_PRONOUNS[g][c])).toEqual(FULL[g])
    }
  })
  it('puts the preposition in front', () => {
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
  it.each(Object.entries(CLASSES))('class %s', (cls, words) => {
    for (const w of words) expect(connectorClass(w), w).toBe(cls)
    expect(DE_CONNECTORS.filter((c) => c.class === cls).map((c) => c.word).sort()).toEqual([...words].sort())
  })
  it('is case-insensitive and unknown words have no class', () => {
    expect(findConnector('Weil')?.class).toBe('verb-final')
    expect(connectorClass('Haus')).toBeUndefined()
  })
})

describe('rulesFor(de) carries the B2 rules', () => {
  it('mentions the B2 grammar and keeps the base rules', () => {
    const r = rulesFor('de')!.promptRules
    expect(r).toContain('German B2 grammar')
    expect(r).toContain('GRAMMAR_CONNECTOR_CLASS')
    expect(r).toContain('German rules')
  })
})
