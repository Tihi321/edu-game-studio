/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Canonical English sentences for each clue type, PoC names, and hint sentences.
 */

import { categoryKeyOf, categoryIndex } from './model'
import { defaultKnightsNames, stepTextKnights, fillKnights } from './knights'
import { defaultTestimonyNames, fillTestimony } from './testimony'
import { defaultQuizNames, renderAllQuiz } from './quiz'
import { SCENARIO, introText } from './logic'
import { checkText } from './flavour'

export const POC_NAMES: Record<string, string[]> = {
  suspect: ['Colonel Ash', 'Doctor Birch', 'Miss Cole', 'Lady Dunn', 'Mr Frost'],
  weapon: ['rope', 'candlestick', 'poison', 'dagger', 'vase'],
  place: ['library', 'kitchen', 'garden', 'cellar', 'study'],
  motive: ['jealousy', 'greed', 'revenge', 'fear', 'love']
}

export const POC_DESCR: Record<string, string[]> = {
  suspect: ['the tall guest', 'the left-handed guest', 'the youngest guest', 'the quiet guest', 'the guest in grey'],
  weapon: ['the heavy weapon', 'the metal weapon', 'the sharp weapon', 'the silent weapon', 'the fragile weapon'],
  place: ['the room upstairs', 'the room by the stairs', 'the room with the fire', 'the room below ground', 'the room facing east']
}

export const DEFAULT_DESCR = POC_DESCR

export const LABELS: Record<string, string> = {
  suspect: 'Suspects',
  weapon: 'Weapons',
  place: 'Places',
  motive: 'Motives'
}

export function safeText(s: string): boolean {
  return !s.includes('[') && !s.includes('{') && !s.includes('%')
}

export function defaultNames(p: any): Record<string, string> {
  if (p.kind === 'knights') {
    return defaultKnightsNames(p)
  }
  if (p.kind === 'testimony') {
    return defaultTestimonyNames(p)
  }
  if (p.kind === 'quiz') {
    return defaultQuizNames(p)
  }
  if (p.kind === 'logic') {
    const have = p.names ?? {}
    const out: Record<string, string> = {}
    for (let cIdx = 0; cIdx < p.categories.length; cIdx++) {
      const sc = SCENARIO.categories[cIdx]
      const c = p.categories[cIdx]
      for (let i = 0; i < c.items.length; i++) {
        const it = c.items[i]!
        out[it] = have[it] ?? (sc && i < sc.names.length ? sc.names[i]! : it)
      }
    }
    return out
  }
  const have = p.names ?? {}
  const names: Record<string, string> = {}
  for (const c of p.categories) {
    const pool = POC_NAMES[c.key] ?? []
    for (let i = 0; i < c.items.length; i++) {
      const it = c.items[i]!
      names[it] = have[it] ?? (i < pool.length ? pool[i]! : it)
    }
  }
  return names
}

export function defaultDescr(p: any): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of p.categories) {
    const pool = POC_DESCR[c.key] ?? []
    for (let i = 0; i < c.items.length; i++) {
      if (i < pool.length) {
        out[c.items[i]!] = pool[i]!
      }
    }
  }
  return out
}

function _cap(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s
}

function _the(cat: string, name: string): string {
  return cat === 'suspect' || cat === 'motive' ? name : `the ${name}`
}

const _IS: Record<string, [string, string]> = {
  'suspect,weapon': ['{X} had {Y}.', '{X} did not have {Y}.'],
  'suspect,place': ['{X} was in {Y}.', '{X} was not in {Y}.'],
  'suspect,motive': ['{X} acted out of {Y}.', '{X} did not act out of {Y}.'],
  'weapon,place': ['Whoever had {X} was in {Y}.', 'Whoever had {X} was not in {Y}.'],
  'weapon,motive': ['Whoever had {X} acted out of {Y}.', 'Whoever had {X} did not act out of {Y}.'],
  'place,motive': ['Whoever was in {X} acted out of {Y}.', 'Whoever was in {X} did not act out of {Y}.']
}

const _EITHER: Record<string, string> = {
  'suspect,place': '{A} was either in {B1} or {B2}.',
  'suspect,weapon': '{A} had either {B1} or {B2}.',
  'weapon,place': '{A} was either in {B1} or {B2}.',
  'weapon,suspect': 'Either {B1} or {B2} had {A}.',
  'place,suspect': 'Either {B1} or {B2} was in {A}.',
  'place,weapon': 'Either {B1} or {B2} was in {A}.',
  'suspect,motive': '{A} acted out of either {B1} or {B2}.',
  'motive,suspect': 'Either {B1} or {B2} acted out of {A}.',
  'weapon,motive': 'Whoever had {A} acted out of either {B1} or {B2}.',
  'motive,weapon': 'Whoever acted out of {A} had either {B1} or {B2}.',
  'place,motive': 'Whoever was in {A} acted out of either {B1} or {B2}.',
  'motive,place': 'Whoever acted out of {A} was either in {B1} or {B2}.'
}

function _murdleText(p: any, clue: any, nm: Record<string, string>): string {
  const descr = p.descr ?? {}
  const pointed = new Set(clue.descr ?? [])

  function np(item: string): string {
    if (pointed.has(item) && descr[item]) {
      return descr[item]
    }
    return _the(categoryKeyOf(p, item), nm[item]!)
  }

  const a = clue.a
  const bs = Array.isArray(clue.b) ? clue.b : [clue.b]
  const ca = categoryKeyOf(p, a)
  const cb = categoryKeyOf(p, bs[0])

  if (clue.type === 'either') {
    const frame = _EITHER[`${ca},${cb}`]
    if (!frame) throw new Error(`no sentence for an either clue of ${ca} and ${cb}`)
    return _cap(
      frame
        .replace('{A}', np(a))
        .replace('{B1}', np(bs[0]))
        .replace('{B2}', np(bs[1]))
    )
  }

  const idx = categoryIndex(p)
  const [first, second] = idx[a]! < idx[bs[0]]! ? [a, bs[0]] : [bs[0], a]
  const cFirst = categoryKeyOf(p, first)
  const cSecond = categoryKeyOf(p, second)
  const frames = _IS[`${cFirst},${cSecond}`]
  if (!frames) throw new Error(`no sentence for a ${clue.type} clue of ${ca} and ${cb}`)
  const tmpl = clue.type === 'not' ? frames[1] : frames[0]
  return _cap(tmpl.replace('{X}', np(first)).replace('{Y}', np(second)))
}

function _ref(p: any, item: string, nm: Record<string, string>): string {
  const cat = p.categories[categoryIndex(p)[item]!]
  const refTmpl = cat.ref ?? '{n}'
  return refTmpl.replace('{n}', nm[item] ?? item)
}

function _logicText(p: any, clue: any, nm: Record<string, string>): string {
  const t = clue.type
  const unit = p.ordinal?.unit ?? ''
  const R = (i: string) => _ref(p, i, nm)
  const a = clue.a
  const b = clue.b

  if (t === 'is') return _cap(`${R(a)} is ${R(b)}.`)
  if (t === 'not') return _cap(`${R(a)} is not ${R(b)}.`)
  if (t === 'either') return _cap(`${R(a)} is either ${R(b[0])} or ${R(b[1])}.`)
  if (t === 'neither') return _cap(`${R(a)} is neither ${R(b[0])} nor ${R(b[1])}.`)
  if (t === 'oneof') return _cap(`Of ${R(a[0])} and ${R(a[1])}, one is ${R(b[0])} and the other is ${R(b[1])}.`)
  if (t === 'before') return _cap(`${R(a)} came before ${R(b)}.`)
  if (t === 'after') return _cap(`${R(a)} came after ${R(b)}.`)
  if (t === 'apart') return _cap(`${R(a)} and ${R(b)} are exactly ${clue.n} ${unit || 'places'} apart.`)
  throw new Error(`no sentence for a ${t} clue`)
}

export function clueText(p: any, clue: any, names?: Record<string, string>): string {
  const nm = names ?? p.names ?? defaultNames(p)
  if (p.kind === 'logic') return _logicText(p, clue, nm)
  return _murdleText(p, clue, nm)
}

export function murderText(p: any, names?: Record<string, string>): string {
  const nm = names ?? p.names ?? defaultNames(p)
  return `The body was found in the ${nm[p.murder.place]}.`
}

function _shared(c1: string[], c2: string[]): string {
  for (const x of c1) {
    if (c2.includes(x)) return x
  }
  return c1[0]!
}

function _theName(p: any, item: string, nm: Record<string, string>, cap = false): string {
  const s = p.kind === 'logic' ? _ref(p, item, nm) : _the(categoryKeyOf(p, item), nm[item]!)
  return cap ? _cap(s) : s
}

function _clueProse(p: any, clue: any, nm: Record<string, string>): string {
  if (!clue) return ''
  return p.text?.[clue.id] ?? clueText(p, clue, nm)
}

export function stepText(p: any, step: any, names?: Record<string, string>): string {
  const nm = names ?? p.names ?? defaultNames(p)
  if (p.kind === 'knights') {
    return stepTextKnights(p, step, nm)
  }
  const [a, b] = step.cell
  const A = _theName(p, a, nm)
  const B = _theName(p, b, nm)
  const yes = step.value === 'yes'
  const rule = step.rule

  if (rule === 'clue') {
    const cl = p.clues?.find((c: any) => c.id === step.clue)
    const num = cl ? cl.id.slice(1) : '?'
    return `Clue ${num} says: ${_clueProse(p, cl, nm)} So ${A} ${yes ? 'goes with' : 'cannot go with'} ${B}.`
  }
  if (rule === 'elim') {
    const f = step.from[0]
    return `${_theName(p, f[0], nm, true)} goes with ${_theName(p, f[1], nm)}, so ${A} cannot go with ${B}.`
  }
  if (rule === 'last') {
    return `Everything else for ${A} is ruled out, so ${A} goes with ${B}.`
  }
  if (rule === 'either') {
    const cl = p.clues?.find((c: any) => c.id === step.clue)
    const num = cl ? cl.id.slice(1) : '?'
    return `Clue ${num} says: ${_clueProse(p, cl, nm)} One of the two is ruled out, so ${A} goes with ${B}.`
  }
  if (rule === 'order') {
    const cl = p.clues?.find((c: any) => c.id === step.clue)
    const num = cl ? cl.id.slice(1) : '?'
    return `Clue ${num} says: ${_clueProse(p, cl, nm)} Counting the places in order, that rules out ${A} ${B}.`
  }
  if (rule === 'trans') {
    const [f1, f2] = step.from
    return `${A} and ${B} are linked through ${_theName(p, _shared(f1, f2), nm)}, so ${A} ${yes ? 'goes with' : 'cannot go with'} ${B}.`
  }
  return `${A} ${yes ? 'goes with' : 'cannot go with'} ${B}.`
}

export function fill(p: any, names?: Record<string, string>): any {
  if (p.kind === 'knights') {
    return fillKnights(p, names)
  }
  if (p.kind === 'logic') {
    const nm = names ? { ...names } : defaultNames(p)
    p.names = nm
    p.text = {}
    for (const c of p.clues) {
      p.text[c.id] = clueText(p, c, nm)
    }
    p.text.intro = introText(p)
    return p
  }
  if (p.kind === 'testimony') {
    return fillTestimony(p, names)
  }
  if (p.kind === 'quiz') {
    const rendered = renderAllQuiz(p, names)
    p.names = rendered.names
    p.text = rendered.text
    return p
  }
  const nm = names ? { ...names } : defaultNames(p)
  p.names = nm
  p.text = {}
  for (const c of p.clues) {
    p.text[c.id] = clueText(p, c, nm)
  }
  if (p.murder) {
    p.text.murder = murderText(p, nm)
  }
  return p
}

export function renderText(p: any, names?: Record<string, string>): { names: Record<string, string>; text: Record<string, string> } {
  const nm = names ? { ...names } : p.names ? { ...p.names } : defaultNames(p)
  const q = { ...p }
  delete q.text
  delete q.names
  fill(q, nm)
  return { names: q.names, text: q.text }
}

export function allSentences(p: any): string[] {
  return [...Object.values(p.text ?? {}), ...Object.values(p.names ?? {})] as string[]
}

export function checkFlavour(p: any, readBack: any[], text?: Record<string, string>): { ok: boolean; problems: any[]; differing: string[] } {
  return checkText(p, readBack, text)
}
