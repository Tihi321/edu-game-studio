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
  ['arbeiten', 'praesens', 'du', 'arbeitest'],
  ['finden', 'praesens', 'ihr', 'findet'],
  ['reisen', 'praesens', 'du', 'reist'],
  ['öffnen', 'praesens', 'du', 'öffnest'],
  ['sammeln', 'praesens', 'ich', 'sammle'],
  // stem changes e -> i / ie, a -> ä
  ['geben', 'praesens', 'du', 'gibst'],
  ['sprechen', 'praesens', 'du', 'sprichst'],
  ['fahren', 'praesens', 'du', 'fährst'],
  // sein, haben, werden, wissen, tun, modals
  ['sein', 'praesens', 'ich', 'bin'],
  ['haben', 'praesens', 'du', 'hast'],
  ['werden', 'praesens', 'er', 'wird'],
  ['wissen', 'praesens', 'ich', 'weiß'],
  ['tun', 'praesens', 'du', 'tust'],
  ['können', 'praesens', 'er', 'kann'],
  ['müssen', 'praesens', 'du', 'musst'],
  ['wollen', 'praesens', 'ich', 'will'],
  // separable and reflexive
  ['aufstehen', 'praesens', 'ich', 'stehe auf'],
  ['freuen', 'praesens', 'er', 'freut sich'],
  // Perfekt: haben / sein, ge- placement, no ge- for be-/ver-/-ieren
  ['gehen', 'perfekt', 'ich', 'bin gegangen'],
  ['aufstehen', 'perfekt', 'du', 'bist aufgestanden'],
  ['studieren', 'perfekt', 'ich', 'habe studiert'],
  ['freuen', 'perfekt', 'ich', 'habe mich gefreut'],
  // Präteritum
  ['sein', 'praeteritum', 'du', 'warst'],
  ['haben', 'praeteritum', 'er', 'hatte'],
  ['gehen', 'praeteritum', 'ihr', 'gingt'],
  ['finden', 'praeteritum', 'ihr', 'fandet'],
  ['aufstehen', 'praeteritum', 'er', 'stand auf'],
  // Futur I
  ['gehen', 'futur1', 'ich', 'werde gehen'],
  ['freuen', 'futur1', 'ich', 'werde mich freuen'],
  // Imperativ
  ['gehen', 'imperativ', 'du', 'geh'],
  ['gehen', 'imperativ', 'Sie', 'gehen Sie'],
  ['geben', 'imperativ', 'du', 'gib'],
  ['sein', 'imperativ', 'du', 'sei'],
  ['aufstehen', 'imperativ', 'du', 'steh auf'],
  ['freuen', 'imperativ', 'Sie', 'freuen Sie sich'],
  // Konjunktiv II
  ['sein', 'konjunktiv2', 'ich', 'wäre'],
  ['gehen', 'konjunktiv2', 'ich', 'ginge'],
  ['kommen', 'konjunktiv2', 'er', 'käme'],
  ['wissen', 'konjunktiv2', 'du', 'wüsstest'],
  ['erheben', 'praeteritum', 'er', 'erhob'],
  ['fördern', 'praesens', 'du', 'förderst'],
  ['unterstützen', 'praesens', 'du', 'unterstützt'],
  ['verkürzen', 'praeteritum', 'ich', 'verkürzte'],
]

describe('German verb table: golden forms', () => {
  it('conjugates regular, stem-changing, irregular, separable and reflexive verbs in every tense', () => {
    for (const [inf, tense, person, expected] of GOLDEN) {
      expect(findVerb(inf), `${inf} is in the table`).toBeDefined()
      expect(form(inf, tense, person)[0], `${inf} ${tense} ${person}`).toBe(expected)
    }
  })

  it('accepts the alternates', () => {
    expect(form('gehen', 'imperativ', 'du')).toEqual(['geh', 'gehe'])
    expect(form('essen', 'praeteritum', 'du')).toContain('aßt')
    expect(form('gehen', 'konjunktiv2', 'ich')).toEqual(['ginge', 'würde gehen'])
    expect(form('wandern', 'praesens', 'ich')).toEqual(['wandere'])
    expect(form('wandern', 'imperativ', 'du')).toContain('wandre')
    expect(form('sein', 'konjunktiv2', 'du')).toEqual(['wärst', 'wärest'])
    expect(form('haben', 'konjunktiv2', 'du')).toEqual(['hättest'])
  })
})

describe('German verb table: coverage and invariants', () => {
  it('has at least 120 unique verbs covering sein / haben / werden, the modals and levels A1 to B1', () => {
    expect(DE_VERBS.length).toBeGreaterThanOrEqual(120)
    const keys = DE_VERBS.map((v) => `${v.reflexive ? 'sich ' : ''}${v.inf}`)
    expect(new Set(keys).size).toBe(keys.length)

    // covers sein / haben / werden, the six modals and levels A1 to B1', () => {
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

  it('puts ge- in the right place of every participle; regular verbs follow the rule generator', () => {
    for (const v of DE_VERBS) {
      const base = v.sep ? v.inf.slice(v.sep.length) : v.inf
      if (v.sep) expect(v.partizip2.startsWith(v.sep), v.inf).toBe(true)
      const rest = v.sep ? v.partizip2.slice(v.sep.length) : v.partizip2
      const noGe = (/^(be|ver|er|ent|zer|emp|miss)/.test(base) && base !== 'beißen') || /ieren$/.test(base) || v.inf === 'übernachten' || v.inf === 'unterstützen'
      expect(rest.startsWith('ge') && !['gefallen', 'gewinnen', 'gehören'].includes(base), `${v.inf}: ${v.partizip2}`).toBe(!noGe && !['gefallen', 'gewinnen', 'gehören'].includes(base))
    }

    // regular verbs follow the rule generator
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

  it('finds verbs by spelling, knows the level of a tense, registers German and labels the persons', () => {
    expect(findVerb('sich freuen')).toBe(findVerb('freuen'))
    expect(findVerb('Gehen')).toBe(findVerb('gehen'))
    expect(findVerb('gehst')).toBeUndefined()

    // knows the level of a tense
    expect(tenseForCefr(findVerb('gehen'), 'praesens')).toBe('A1')
    expect(tenseForCefr(findVerb('sein'), 'praeteritum')).toBe('A2')
    expect(tenseForCefr(findVerb('gehen'), 'praeteritum')).toBe('B1')
    expect(tenseForCefr(findVerb('gehen'), 'konjunktiv2')).toBe('B1')
    expect(tenseForCefr(findVerb('gehen'), 'futur1')).toBe('B1')

    // registers German with prompt rules and the verb table
    const r = rulesFor('de')!
    expect(r.promptRules).toContain('ä ö ü ß')
    expect(r.verbTable!.findVerb('gehen')).toBeDefined()
    expect(rulesFor('hr')).toBeUndefined()
    expect(rulesFor(undefined)).toBeUndefined()

    // labels the persons
    expect(PRONOUN_LABELS.de!.er).toBe('er / sie / es')
    expect(Object.keys(PRONOUN_LABELS.de!)).toEqual([...DE_PERSONS])
  })
})
