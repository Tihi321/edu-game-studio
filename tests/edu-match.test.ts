import { describe, expect, it } from 'vitest'
import { foldDiacritics, levenshtein, lettersKey, matchAnswer, normalizeText, resolveDiacritics } from '../src/shared/edu'

describe('normalisation', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(normalizeText('  Dobro   sam,  HVALA!! ')).toBe('dobro sam hvala')
    expect(normalizeText("Don't")).toBe('dont')
    expect(normalizeText('Do-viđenja')).toBe('do viđenja')
  })
  it('folds accents, the stroked d and dj', () => {
    expect(foldDiacritics('čćšžđ ČĆŠŽĐ')).toBe('ccszd CCSZD')
    expect(normalizeText('Doviđenja', { fold: true })).toBe('dovidenja')
    expect(normalizeText('Dovidjenja', { fold: true })).toBe('dovidenja')
    expect(foldDiacritics('Zoë café Łódź')).toBe('Zoe cafe Lodz')
    expect(lettersKey('Laku noć!')).toBe('LAKUNOC')
  })
  it('levenshtein distance, with an early stop', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('hvala', 'hvla')).toBe(1)
    expect(levenshtein('abc', 'xyz', 1)).toBe(2)
    expect(levenshtein('', 'abc')).toBe(3)
  })
})

describe('matchAnswer', () => {
  const night = ['Laku noć']
  it('accepts the exact answer in any case and spacing', () => {
    const r = matchAnswer('  laku   NOĆ ', night)
    expect(r).toMatchObject({ correct: true, exact: true, typo: false, diacritics: false, matched: 'Laku noć' })
  })
  it('folds č/c, š/s, ž/z, đ/d and dj under the default policy (ignore)', () => {
    expect(matchAnswer('laku noc', night)).toMatchObject({ correct: true, diacritics: false })
    expect(matchAnswer('dovidjenja', ['Doviđenja'])).toMatchObject({ correct: true })
    expect(matchAnswer('dovidenja', ['Doviđenja'])).toMatchObject({ correct: true })
    expect(matchAnswer('zivjeli', ['Živjeli'])).toMatchObject({ correct: true })
    expect(matchAnswer('Sunce', ['Sunce'])).toMatchObject({ exact: true })
  })
  it('warn: right but reports the accent difference', () => {
    expect(matchAnswer('laku noc', night, { diacritics: 'warn' })).toMatchObject({ correct: true, diacritics: true, typo: false })
    expect(matchAnswer('laku noć', night, { diacritics: 'warn' })).toMatchObject({ correct: true, diacritics: false })
  })
  it('strict: a missing accent is a near-miss, not correct, and not a typo', () => {
    const r = matchAnswer('laku noc', night, { diacritics: 'strict' })
    expect(r).toMatchObject({ correct: false, diacritics: true, typo: false, matched: 'Laku noć' })
    expect(matchAnswer('laku noć', night, { diacritics: 'strict' }).correct).toBe(true)
    expect(matchAnswer('dovidjenja', ['Doviđenja'], { diacritics: 'strict' })).toMatchObject({ correct: false, diacritics: true })
  })
  it('accepts a one-letter typo in a word of 4 or more letters and says so', () => {
    expect(matchAnswer('hvla', ['Hvala'])).toMatchObject({ correct: true, typo: true, exact: false })
    expect(matchAnswer('hvalaa', ['Hvala'])).toMatchObject({ correct: true, typo: true })
    expect(matchAnswer('hvela', ['Hvala'])).toMatchObject({ correct: true, typo: true })
    expect(matchAnswer('Jupiter', ['Jupiter']).typo).toBe(false)
    expect(matchAnswer('jupitr', ['Jupiter'])).toMatchObject({ correct: true, typo: true })
  })
  it('rejects distance 2 and swapped letters', () => {
    expect(matchAnswer('hvl', ['Hvala']).correct).toBe(false)
    expect(matchAnswer('hvaal', ['Hvala']).correct).toBe(false) // a swap costs two edits
    expect(matchAnswer('jupitar', ['Jupiter'])).toMatchObject({ correct: true, typo: true })
    expect(matchAnswer('jupipar', ['Jupiter']).correct).toBe(false)
    expect(matchAnswer('jupipar', ['Jupiter']).distance).toBe(2)
  })
  it('gives no typo tolerance to short words', () => {
    expect(matchAnswer('tan', ['dan']).correct).toBe(false)
    expect(matchAnswer('ba', ['da']).correct).toBe(false)
    expect(matchAnswer('bok', ['Bok'])).toMatchObject({ correct: true, exact: true })
    expect(matchAnswer('bak', ['Bok']).correct).toBe(false)
    expect(matchAnswer('mars', ['Mars']).exact).toBe(true)
    expect(matchAnswer('mors', ['Mars'])).toMatchObject({ correct: true, typo: true }) // 4 letters: allowed
  })
  it('typo tolerance can be switched off, and its minimum length changed', () => {
    expect(matchAnswer('hvla', ['Hvala'], { typos: false }).correct).toBe(false)
    expect(matchAnswer('mors', ['Mars'], { minTypoLength: 5 }).correct).toBe(false)
  })
  it('accepts synonyms from the list and reports the one that matched', () => {
    const acc = ['Zovem se Ana', 'Ja se zovem Ana']
    expect(matchAnswer('ja se zovem ana', acc)).toMatchObject({ correct: true, matched: 'Ja se zovem Ana', canonical: 'Zovem se Ana' })
    expect(matchAnswer('moon', ['Moon', 'The Moon'])).toMatchObject({ correct: true })
    expect(matchAnswer('the moon', ['Moon', 'The Moon'])).toMatchObject({ correct: true, matched: 'The Moon' })
  })
  it('a typo against a multi-word answer is accepted, a missing word is not', () => {
    expect(matchAnswer('dobro sam hvla', ['Dobro sam, hvala.'])).toMatchObject({ correct: true, typo: true })
    expect(matchAnswer('dobro sam', ['Dobro sam, hvala.']).correct).toBe(false)
  })
  it('strict policy still allows a real typo, measured with accents', () => {
    expect(matchAnswer('laku nox', night, { diacritics: 'strict' })).toMatchObject({ correct: true, typo: true })
    expect(matchAnswer('lakoo noc', night, { diacritics: 'strict' }).correct).toBe(false)
  })
  it('never matches an empty or punctuation-only input', () => {
    expect(matchAnswer('', night).correct).toBe(false)
    expect(matchAnswer(' ?! ', night).correct).toBe(false)
    expect(matchAnswer('x', []).correct).toBe(false)
  })
  it('the item policy overrides the course default', () => {
    expect(resolveDiacritics(true, 'ignore')).toBe('strict')
    expect(resolveDiacritics(false, 'strict')).toBe('ignore')
    expect(resolveDiacritics(undefined, 'warn')).toBe('warn')
    expect(resolveDiacritics(undefined, undefined)).toBe('ignore')
  })
})
