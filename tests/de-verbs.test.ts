import { describe, expect, it } from 'vitest'
import { DE_PERSONS, DE_VERBS, PRONOUN_LABELS, conjugate, findVerb, rulesFor, tenseForCefr, type DeTense } from '../src/shared/lang'

// The table is model-written and not natively reviewed. The golden forms below are ones that follow from the rules of German grammar.
const form = (inf: string, tense: DeTense, person: string): string[] => conjugate(findVerb(inf)!, tense, person)

// [infinitive, tense, person, canonical (first) form]
const GOLDEN: [string, DeTense, string, string][] = [
  // regular -en verbs, -t/-d stems (-est / -et), sibilant stems (du -t), consonant + m/n stems
  ['machen', 'praesens', 'ich', 'mache'],
  ['machen', 'praesens', 'du', 'machst'],
  ['machen', 'praesens', 'er', 'macht'],
  ['machen', 'praesens', 'ihr', 'macht'],
  ['arbeiten', 'praesens', 'du', 'arbeitest'],
  ['arbeiten', 'praesens', 'er', 'arbeitet'],
  ['finden', 'praesens', 'ihr', 'findet'],
  ['reisen', 'praesens', 'du', 'reist'],
  ['heißen', 'praesens', 'du', 'heißt'],
  ['tanzen', 'praesens', 'du', 'tanzt'],
  ['öffnen', 'praesens', 'du', 'öffnest'],
  ['kommen', 'praesens', 'du', 'kommst'],
  ['wohnen', 'praesens', 'du', 'wohnst'],
  ['sammeln', 'praesens', 'ich', 'sammle'],
  // stem changes e -> i / ie, a -> ä
  ['geben', 'praesens', 'du', 'gibst'],
  ['nehmen', 'praesens', 'er', 'nimmt'],
  ['sprechen', 'praesens', 'du', 'sprichst'],
  ['essen', 'praesens', 'du', 'isst'],
  ['lesen', 'praesens', 'er', 'liest'],
  ['sehen', 'praesens', 'du', 'siehst'],
  ['fahren', 'praesens', 'du', 'fährst'],
  ['schlafen', 'praesens', 'er', 'schläft'],
  ['laufen', 'praesens', 'du', 'läufst'],
  // sein, haben, werden, wissen, tun, modals
  ['sein', 'praesens', 'ich', 'bin'],
  ['sein', 'praesens', 'du', 'bist'],
  ['sein', 'praesens', 'ihr', 'seid'],
  ['haben', 'praesens', 'du', 'hast'],
  ['werden', 'praesens', 'er', 'wird'],
  ['wissen', 'praesens', 'ich', 'weiß'],
  ['wissen', 'praesens', 'ihr', 'wisst'],
  ['tun', 'praesens', 'du', 'tust'],
  ['können', 'praesens', 'er', 'kann'],
  ['müssen', 'praesens', 'du', 'musst'],
  ['wollen', 'praesens', 'ich', 'will'],
  // separable and reflexive
  ['aufstehen', 'praesens', 'ich', 'stehe auf'],
  ['abfahren', 'praesens', 'du', 'fährst ab'],
  ['einkaufen', 'praesens', 'wir', 'kaufen ein'],
  ['freuen', 'praesens', 'er', 'freut sich'],
  ['freuen', 'praesens', 'wir', 'freuen uns'],
  // Perfekt: haben / sein, ge- placement, no ge- for be-/ver-/-ieren
  ['gehen', 'perfekt', 'ich', 'bin gegangen'],
  ['machen', 'perfekt', 'er', 'hat gemacht'],
  ['aufstehen', 'perfekt', 'du', 'bist aufgestanden'],
  ['anrufen', 'perfekt', 'ich', 'habe angerufen'],
  ['besuchen', 'perfekt', 'wir', 'haben besucht'],
  ['studieren', 'perfekt', 'ich', 'habe studiert'],
  ['arbeiten', 'perfekt', 'sie', 'haben gearbeitet'],
  ['freuen', 'perfekt', 'ich', 'habe mich gefreut'],
  // Präteritum
  ['sein', 'praeteritum', 'du', 'warst'],
  ['sein', 'praeteritum', 'wir', 'waren'],
  ['haben', 'praeteritum', 'er', 'hatte'],
  ['gehen', 'praeteritum', 'ihr', 'gingt'],
  ['machen', 'praeteritum', 'du', 'machtest'],
  ['arbeiten', 'praeteritum', 'du', 'arbeitetest'],
  ['finden', 'praeteritum', 'ihr', 'fandet'],
  ['können', 'praeteritum', 'ich', 'konnte'],
  ['aufstehen', 'praeteritum', 'er', 'stand auf'],
  // Futur I
  ['gehen', 'futur1', 'ich', 'werde gehen'],
  ['aufstehen', 'futur1', 'er', 'wird aufstehen'],
  ['freuen', 'futur1', 'ich', 'werde mich freuen'],
  // Imperativ
  ['gehen', 'imperativ', 'du', 'geh'],
  ['gehen', 'imperativ', 'ihr', 'geht'],
  ['gehen', 'imperativ', 'Sie', 'gehen Sie'],
  ['arbeiten', 'imperativ', 'du', 'arbeite'],
  ['geben', 'imperativ', 'du', 'gib'],
  ['essen', 'imperativ', 'du', 'iss'],
  ['lesen', 'imperativ', 'du', 'lies'],
  ['fahren', 'imperativ', 'du', 'fahr'],
  ['sein', 'imperativ', 'du', 'sei'],
  ['sein', 'imperativ', 'Sie', 'seien Sie'],
  ['aufstehen', 'imperativ', 'du', 'steh auf'],
  ['freuen', 'imperativ', 'Sie', 'freuen Sie sich'],
  // Konjunktiv II
  ['sein', 'konjunktiv2', 'ich', 'wäre'],
  ['sein', 'konjunktiv2', 'ihr', 'wärt'],
  ['haben', 'konjunktiv2', 'du', 'hättest'],
  ['können', 'konjunktiv2', 'ich', 'könnte'],
  ['müssen', 'konjunktiv2', 'du', 'müsstest'],
  ['gehen', 'konjunktiv2', 'ich', 'ginge'],
  ['kommen', 'konjunktiv2', 'er', 'käme'],
  ['machen', 'konjunktiv2', 'ich', 'würde machen'],
  ['wissen', 'konjunktiv2', 'du', 'wüsstest']
]

describe('German verb table: golden forms', () => {
  it('has at least 40 golden forms', () => expect(GOLDEN.length).toBeGreaterThanOrEqual(40))
  it.each(GOLDEN)('%s %s %s = %s', (inf, tense, person, expected) => {
    expect(findVerb(inf), `${inf} is in the table`).toBeDefined()
    expect(form(inf, tense, person)[0]).toBe(expected)
  })

  it('accepts the alternates', () => {
    expect(form('gehen', 'imperativ', 'du')).toEqual(['geh', 'gehe'])
    expect(form('essen', 'praeteritum', 'du')).toContain('aßt')
    expect(form('gehen', 'konjunktiv2', 'ich')).toEqual(['ginge', 'würde gehen'])
    expect(form('wandern', 'praesens', 'ich')).toEqual(['wandere'])
    expect(form('wandern', 'imperativ', 'du')).toContain('wandre')
  })
})

describe('German verb table: coverage and invariants', () => {
  it('has at least 120 verbs with unique infinitives per reflexivity', () => {
    expect(DE_VERBS.length).toBeGreaterThanOrEqual(120)
    const keys = DE_VERBS.map((v) => `${v.reflexive ? 'sich ' : ''}${v.inf}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('covers sein / haben / werden, the six modals and levels A1 to B1', () => {
    for (const inf of ['sein', 'haben', 'werden', 'können', 'müssen', 'dürfen', 'sollen', 'wollen', 'mögen']) expect(findVerb(inf)).toBeDefined()
    for (const level of ['A1', 'A2', 'B1']) expect(DE_VERBS.filter((v) => v.level === level).length).toBeGreaterThan(10)
    expect(DE_VERBS.filter((v) => v.sep).length).toBeGreaterThanOrEqual(20)
    expect(DE_VERBS.filter((v) => v.reflexive).length).toBeGreaterThanOrEqual(8)
  })

  it('gives a form for every verb, tense and person (modals have no imperative)', () => {
    for (const v of DE_VERBS) {
      for (const tense of ['praesens', 'perfekt', 'praeteritum', 'futur1', 'konjunktiv2'] as const)
        for (const p of DE_PERSONS) {
          const f = conjugate(v, tense, p)
          expect(f.length, `${v.inf} ${tense} ${p}`).toBeGreaterThan(0)
          for (const x of f) expect(x).toMatch(/^[a-zäöüß]+( [a-zäöüß]+)*$/)
        }
      for (const p of ['du', 'ihr', 'Sie']) expect(conjugate(v, 'imperativ', p).length > 0, `${v.inf} imperativ ${p}`).toBe(!v.modal)
      for (const p of ['ich', 'er', 'wir', 'sie']) expect(conjugate(v, 'imperativ', p)).toEqual([])
    }
  })

  it('puts ge- in the right place of every participle', () => {
    for (const v of DE_VERBS) {
      const base = v.sep ? v.inf.slice(v.sep.length) : v.inf
      if (v.sep) expect(v.partizip2.startsWith(v.sep), v.inf).toBe(true)
      const rest = v.sep ? v.partizip2.slice(v.sep.length) : v.partizip2
      const noGe = (/^(be|ver|er|ent|zer|emp|miss)/.test(base) && base !== 'beißen') || /ieren$/.test(base) || v.inf === 'übernachten'
      expect(rest.startsWith('ge') && !['gefallen', 'gewinnen', 'gehören'].includes(base), `${v.inf}: ${v.partizip2}`).toBe(!noGe && !['gefallen', 'gewinnen', 'gehören'].includes(base))
    }
  })

  it('regular verbs follow the rule generator', () => {
    const weak = DE_VERBS.filter((v) => !v.presOverrides && !v.k2 && v.praet3.endsWith('te') && v.partizip2.endsWith('t'))
    expect(weak.length).toBeGreaterThan(60)
    for (const v of weak) {
      const base = v.sep ? v.inf.slice(v.sep.length) : v.inf
      const du = conjugate(v, 'praesens', 'du')[0]!.split(' ')[0]!
      const er = conjugate(v, 'praesens', 'er')[0]!.split(' ')[0]!
      expect(du, v.inf).toMatch(/(st|t)$/)
      expect(er, v.inf).toMatch(/t$/)
      expect(conjugate(v, 'praesens', 'wir')[0]!.split(' ')[0], v.inf).toBe(base)
      expect(conjugate(v, 'praeteritum', 'ich')[0]!.split(' ')[0], v.inf).toBe(v.praet3)
    }
  })

  it('finds verbs by infinitive and reflexive spelling', () => {
    expect(findVerb('sich freuen')).toBe(findVerb('freuen'))
    expect(findVerb('Gehen')).toBe(findVerb('gehen'))
    expect(findVerb('gehst')).toBeUndefined()
  })

  it('knows the level of a tense', () => {
    expect(tenseForCefr(findVerb('gehen'), 'praesens')).toBe('A1')
    expect(tenseForCefr(findVerb('sein'), 'praeteritum')).toBe('A2')
    expect(tenseForCefr(findVerb('gehen'), 'praeteritum')).toBe('B1')
    expect(tenseForCefr(findVerb('gehen'), 'konjunktiv2')).toBe('B1')
    expect(tenseForCefr(findVerb('gehen'), 'futur1')).toBe('B1')
  })
})

describe('language registry and pronouns', () => {
  it('registers German with prompt rules and the verb table', () => {
    const r = rulesFor('de')!
    expect(r.promptRules).toContain('ä ö ü ß')
    expect(r.verbTable!.findVerb('gehen')).toBeDefined()
    expect(rulesFor('hr')).toBeUndefined()
    expect(rulesFor(undefined)).toBeUndefined()
  })
  it('labels the persons', () => {
    expect(PRONOUN_LABELS.de!.er).toBe('er / sie / es')
    expect(Object.keys(PRONOUN_LABELS.de!)).toEqual([...DE_PERSONS])
  })
})
