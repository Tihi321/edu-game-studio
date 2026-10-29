/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The flavour check: does the prose still mean the same constraints?
 */

import { clueItems, clueTrue, ordinalItems, validate } from './model'
import { countSolutions, deduce } from './solver'
import { clueText, renderText, defaultNames, DEFAULT_DESCR } from './text'
import { checkKnightsText } from './knights'
import { checkTestimonyText } from './testimony'
import { checkQuizText } from './quiz'

const _ORDER = ['before', 'after', 'apart'] as const

function _norm(s: any): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function _nameToItem(p: any): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [item, name] of Object.entries(p.names ?? {})) {
    out[_norm(name)] = item
    out[_norm(item)] = item
  }
  for (const [item, phrase] of Object.entries(p.descr ?? {})) {
    const k = _norm(phrase)
    if (!out[k]) out[k] = item
  }
  return out
}

function _item(table: Record<string, string>, name: string): string | undefined {
  return table[_norm(name)]
}

function _equivalent(p: any, c1: any, c2: any): boolean {
  const ordinal = ordinalItems(p)
  const items: string[] = []
  const orderNeeds = ordinal && (_ORDER.includes(c1.type) || _ORDER.includes(c2.type)) ? ordinal : []
  for (const it of [...clueItems(c1), ...clueItems(c2), ...orderNeeds]) {
    if (!items.includes(it)) items.push(it)
  }

  const cat: Record<string, number> = {}
  for (let ci = 0; ci < p.categories.length; ci++) {
    for (const it of p.categories[ci].items) {
      cat[it] = ci
    }
  }

  const people: string[] = p.categories[0].items
  const free = items.filter((it) => cat[it] !== 0)
  const owner: Record<string, string> = {}
  for (const s of people) owner[s] = s
  const used: Record<number, Set<string>> = {}

  function rec(i: number): boolean {
    if (i === free.length) {
      return clueTrue(c1, owner, ordinal) === clueTrue(c2, owner, ordinal)
    }
    const it = free[i]!
    const cIdx = cat[it]!
    if (!used[cIdx]) used[cIdx] = new Set()
    const taken = used[cIdx]!

    for (const person of people) {
      if (taken.has(person)) continue
      taken.add(person)
      owner[it] = person
      const ok = rec(i + 1)
      taken.delete(person)
      if (!ok) return false
    }
    delete owner[it]
    return true
  }

  return rec(0)
}

function _shape(clue: any): [boolean, boolean] {
  const t = clue.type
  if (t === 'either' || t === 'neither') return [false, true]
  if (t === 'oneof') return [true, true]
  return [false, false]
}

export function checkGridText(p: any, readBack: any[], text?: Record<string, string>): { ok: boolean; problems: any[]; differing: string[] } {
  validate(p)
  const table = _nameToItem(p)
  const byId = new Map<string, any>()
  for (const r of readBack) {
    if (r && r.id) byId.set(r.id, r)
  }

  const problems: { clue: string; problem: string }[] = []
  const differing: string[] = []
  const rebuilt: any[] = []

  function bad(clue: any, problem: string): void {
    problems.push({ clue: clue.id, problem })
    differing.push(clue.id)
  }

  for (const clue of p.clues) {
    const r = byId.get(clue.id)
    if (!r) {
      bad(clue, 'the reader gave no clue for this one')
      continue
    }
    if (!['is', 'not', 'either', 'neither', 'oneof', 'before', 'after', 'apart'].includes(r.type)) {
      bad(clue, `unknown clue type "${r.type}"`)
      continue
    }
    if (_ORDER.includes(r.type) && !ordinalItems(p)) {
      bad(clue, `this puzzle has no order: "${r.type}" is not a clue type here`)
      continue
    }
    const [aList, bList] = _shape(r)
    const ra = r.a
    const rb = r.b
    if (
      Array.isArray(ra) !== aList ||
      Array.isArray(rb) !== bList ||
      (aList && ra.length !== 2) ||
      (bList && rb.length !== 2)
    ) {
      bad(
        clue,
        `a ${r.type} clue needs ${aList ? 'two items for a' : 'one item for a'} and ${bList ? 'two items for b' : 'one item for b'}`
      )
      continue
    }
    if (r.type === 'apart' && typeof r.n !== 'number') {
      bad(clue, 'an apart clue needs the number n')
      continue
    }
    const names: string[] = (aList ? ra : [ra]).concat(bList ? rb : [rb])
    const ids = names.map((n) => _item(table, n))
    const unknown = names.filter((_, idx) => ids[idx] === undefined)
    if (unknown.length > 0) {
      bad(clue, `the reader used ${unknown.map((n) => `"${n}"`).join(', ')}, which is not a name of this puzzle`)
      continue
    }
    if (text && text[clue.id]) {
      const prose = _norm(text[clue.id])
      const appears = (n: string) => {
        const it = _item(table, n)
        const forms = [n, p.names?.[it!], p.descr?.[it!]].filter(Boolean)
        return forms.some((f) => _norm(f) && prose.includes(_norm(f)))
      }
      const missing = names.filter((n) => !appears(n))
      if (missing.length > 0) {
        bad(clue, `the reader named ${missing.map((n) => `"${n}"`).join(', ')}, which the prose does not contain`)
        continue
      }
    }

    const k = aList ? 2 : 1
    const back: any = {
      id: clue.id,
      type: r.type,
      a: aList ? ids.slice(0, 2) : ids[0],
      b: bList ? ids.slice(k, k + 2) : ids[k]
    }
    if (r.type === 'apart') {
      back.n = r.n
    }
    if (bList && new Set(ids.slice(k, k + 2)).size !== 2) {
      bad(clue, 'the two options of this clue must differ')
      continue
    }
    if (aList && new Set(ids.slice(0, 2)).size !== 2) {
      bad(clue, 'the two options of this clue must differ')
      continue
    }

    let same: boolean
    try {
      same = _equivalent(p, clue, back)
    } catch {
      same = false
    }
    if (!same) {
      bad(
        clue,
        clue.type !== r.type
          ? `the prose means something else than the clue (${clue.type} read back as ${r.type})`
          : 'the prose means something else than the clue (other items)'
      )
      continue
    }
    rebuilt.push(back)
  }

  if (problems.length === 0) {
    const q = { ...p, clues: rebuilt }
    if (countSolutions(q, 2) !== 1) {
      problems.push({ clue: '', problem: 'the read-back clues do not give exactly one solution' })
    } else if (!deduce(q).solved) {
      problems.push({ clue: '', problem: 'the read-back clues cannot be solved by deduction alone' })
    }
  }

  return { ok: problems.length === 0, problems, differing }
}

export function checkText(p: any, readBack: any[], text?: Record<string, string>): { ok: boolean; problems: any[]; differing: string[] } {
  const kind = p.kind ?? 'murdle'
  if (kind === 'knights') {
    return checkKnightsText(p, readBack, text)
  }
  if (kind === 'testimony') {
    return checkTestimonyText(p, readBack, text)
  }
  if (kind === 'quiz') {
    return checkQuizText(p, readBack, text)
  }
  return checkGridText(p, readBack, text)
}

export { DEFAULT_DESCR }

export function renderClue(p: any, clue: any, names?: Record<string, string>): string {
  return clueText(p, clue, names)
}

export function renderAll(p: any, names?: Record<string, string>): { names: Record<string, string>; text: Record<string, string> } {
  return renderText(p, names)
}

export function renderSolution(p: any, names?: Record<string, string>): Record<string, any> {
  const nm = names ?? p.names ?? defaultNames(p)
  if (p.murder?.answer) {
    const ans = p.murder.answer
    return {
      suspect: nm[ans.suspect] ?? ans.suspect,
      weapon: nm[ans.weapon] ?? ans.weapon,
      place: nm[ans.place] ?? ans.place,
      ...(ans.motive ? { motive: nm[ans.motive] ?? ans.motive } : {})
    }
  }
  return p.solution
}
