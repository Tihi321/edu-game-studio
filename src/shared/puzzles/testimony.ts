/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Testimony: an Ace Attorney cross-examination.
 */

import { SeededRandom } from './prng'
import { FORMAT, BANDS, PuzzleError } from './model'
import type { Band } from './model'
import type { TestimonyCore, PuzzleStep } from '../puzzle'

export interface VocabEntry {
  key: string
  label: string
  values: string[]
  item: string
  claim: string
  fact: string
}

export const VOCAB: VocabEntry[] = [
  {
    key: 'clock',
    label: 'the hour the clock struck',
    values: ['nine', 'ten', 'eleven', 'twelve'],
    item: 'pocket watch',
    claim: 'I heard the clock strike {v} just before the scream',
    fact: "It is stopped, and it reads {v} o'clock"
  },
  {
    key: 'door',
    label: 'the state of the study door',
    values: ['locked', 'open', 'ajar'],
    item: 'key log',
    claim: 'The study door was {v} when I passed it',
    fact: 'It says the study door was {v} that evening'
  },
  {
    key: 'lamp',
    label: 'the hall lamp',
    values: ['lit', 'dark', 'dim'],
    item: 'photograph',
    claim: 'The lamp in the hall was {v}',
    fact: 'It shows the hall lamp {v}'
  },
  {
    key: 'weather',
    label: 'the weather that night',
    values: ['raining', 'dry', 'foggy'],
    item: 'weather report',
    claim: 'It was {v} outside',
    fact: 'It says it was {v} that night'
  },
  {
    key: 'weapon',
    label: 'what lay on the table',
    values: ['rope', 'candlestick', 'poison', 'dagger'],
    item: 'inventory',
    claim: 'I saw the {v} on the table',
    fact: 'It lists the {v} on the table'
  },
  {
    key: 'guest',
    label: 'who left first',
    values: ['the doctor', 'the colonel', 'the cook'],
    item: 'guest list',
    claim: '{v} left first',
    fact: 'It shows {v} leaving first'
  },
  {
    key: 'window',
    label: 'the library window',
    values: ['shut', 'broken', 'wide open'],
    item: 'repair bill',
    claim: 'The library window was {v}',
    fact: 'It records the library window as {v}'
  },
  {
    key: 'shoes',
    label: 'the shoes by the door',
    values: ['muddy', 'polished', 'missing'],
    item: 'boot print',
    claim: 'The shoes by the door were {v}',
    fact: 'It shows the shoes by the door {v}'
  }
]

export const BY_KEY: Record<string, VocabEntry> = Object.fromEntries(VOCAB.map((v) => [v.key, v]))
export const TESTIMONY_SIZES: Record<string, [number, number]> = { easy: [4, 3], medium: [5, 4], hard: [6, 5] }
const SIZES = TESTIMONY_SIZES
export const WITNESS = 'Mr Halloran'

function _pairs(items: any[]): Set<string> {
  const out = new Set<string>()
  for (const c of items || []) {
    out.add(`${c.key}|${c.value}`)
  }
  return out
}

export function allClaims(s: any): any[] {
  return [...(s.claims || []), ...((s.press && s.press.claims) || [])]
}

export function clashes(p: any, statements?: any[], evidence?: any[]): any[] {
  const stmts = statements ?? p.statements
  const evids = evidence ?? p.evidence
  const out: any[] = []
  for (const s of stmts) {
    const pressed = ((s.press && s.press.claims) || []).map((c: any) => ({ ...c, via: true }))
    const normal = (s.claims || []).map((c: any) => ({ ...c, via: false }))
    for (const c of [...normal, ...pressed]) {
      for (const e of evids) {
        for (const f of e.facts) {
          if (f.key === c.key && f.value !== c.value) {
            out.push({
              statement: s.id,
              evidence: e.id,
              key: c.key,
              claim: c.value,
              fact: f.value,
              press: c.via
            })
          }
        }
      }
    }
  }
  return out
}

export function nearMisses(p: any): number {
  let n = 0
  for (const s of p.statements) {
    for (const c of allClaims(s)) {
      for (const e of p.evidence) {
        for (const f of e.facts) {
          if (f.key === c.key && f.value === c.value) {
            n++
          }
        }
      }
    }
  }
  return n
}

export function repeats(p: any): string[] {
  const out: string[] = []
  const seen: Record<string, string> = {}
  for (const s of p.statements) {
    const said = Array.from(_pairs(s.claims)).sort().join(',')
    if (seen[said]) {
      out.push(`${s.id} says what ${seen[said]} says`)
    }
    seen[said] = s.id
    const press = _pairs(s.press?.claims)
    const saidSet = _pairs(s.claims)
    if (press.size > 0) {
      let isSubset = true
      for (const item of press) {
        if (!saidSet.has(item)) isSubset = false
      }
      if (isSubset) {
        out.push(`the press line of ${s.id} only repeats the statement`)
      }
      const sKeys = new Set(s.claims.map((c: any) => c.key))
      for (const [pk] of Array.from(press).map((x) => x.split('|'))) {
        if (sKeys.has(pk)) {
          out.push(`the press line of ${s.id} is about the same thing as the statement`)
        }
      }
    }
  }

  const claimed: Record<string, string> = {}
  for (const s of p.statements) {
    for (const c of s.claims) {
      if (claimed[c.key]) {
        out.push(`${claimed[c.key]} and ${s.id} both claim something about ${c.key}`)
      }
      claimed[c.key] = s.id
    }
  }

  const pressed: Record<string, string> = {}
  for (const s of p.statements) {
    for (const c of s.press?.claims || []) {
      if (pressed[c.key]) {
        out.push(`the press lines of ${pressed[c.key]} and ${s.id} are about the same thing (${c.key})`)
      }
      pressed[c.key] = s.id
    }
  }

  const shown: Record<string, string> = {}
  for (const e of p.evidence) {
    for (const f of e.facts) {
      if (shown[f.key]) {
        out.push(`${shown[f.key]} and ${e.id} show the same fact (${f.key})`)
      }
      shown[f.key] = e.id
    }
  }

  return out
}

export function bandOfTestimony(p: any, found?: any[]): Band {
  const cl = found ?? clashes(p)
  const needsPress = cl.some((c) => c.press)
  if (!needsPress) return 'easy'
  return nearMisses(p) >= 4 ? 'hard' : 'medium'
}
const bandOf = bandOfTestimony

export function validateTestimony(p: any): void {
  if (p.format !== undefined && p.format !== FORMAT) {
    throw new PuzzleError(`not a testimony puzzle of format ${FORMAT}`)
  }
  if (p.kind !== 'testimony') {
    throw new PuzzleError('not a testimony puzzle')
  }
  const keys: Record<string, any> = {}
  for (const k of p.keys || []) {
    keys[k.key] = k
  }
  if (Object.keys(keys).length === 0) {
    throw new PuzzleError('a testimony puzzle needs keys (the vocabulary of the facts)')
  }
  for (const k of Object.values(keys)) {
    if (!k.values || k.values.length < 2) {
      throw new PuzzleError(`key ${k.key} needs at least two values`)
    }
  }
  const ids = new Set<string>()
  for (const s of p.statements || []) {
    if (ids.has(s.id)) throw new PuzzleError(`statement ${s.id} is listed twice`)
    ids.add(s.id)
    for (const c of allClaims(s)) {
      if (!keys[c.key] || !keys[c.key].values.includes(c.value)) {
        throw new PuzzleError(`statement ${s.id} claims ${c.key}=${c.value}, which is not in the keys`)
      }
    }
  }
  if ((p.statements || []).length < 2) {
    throw new PuzzleError('a testimony needs at least two statements')
  }
  const eids = new Set<string>()
  for (const e of p.evidence || []) {
    if (eids.has(e.id) || ids.has(e.id)) {
      throw new PuzzleError(`id ${e.id} is used twice`)
    }
    eids.add(e.id)
    for (const f of e.facts) {
      if (!keys[f.key] || !keys[f.key].values.includes(f.value)) {
        throw new PuzzleError(`evidence ${e.id} shows ${f.key}=${f.value}, which is not in the keys`)
      }
    }
  }
  if (eids.size === 0) {
    throw new PuzzleError('a testimony needs evidence')
  }
  const sol = p.solution || {}
  if (!ids.has(sol.statement) || !eids.has(sol.evidence)) {
    throw new PuzzleError('the solution names a statement or evidence that is not there')
  }
}

function _steps(p: any, c: any): PuzzleStep[] {
  const steps: PuzzleStep[] = [{ rule: 'look', statement: c.statement, who: c.evidence, value: c.key }]
  if (c.press) {
    steps.push({ rule: 'press', statement: c.statement, value: '' })
  }
  steps.push({ rule: 'present', statement: c.statement, who: c.evidence, value: '' })
  return steps
}

export function solveTestimony(p: any): {
  unique: boolean
  solutions: number
  deducible: boolean
  band: Band | null
  steps: PuzzleStep[]
  score: number
  rules: Record<string, number>
} {
  validateTestimony(p)
  const found = clashes(p)
  const sol = p.solution
  const ok =
    found.length === 1 &&
    found[0]!.statement === sol.statement &&
    found[0]!.evidence === sol.evidence &&
    found[0]!.press === Boolean(sol.press)
  const steps = found.length === 1 ? _steps(p, found[0]!) : []
  const score =
    p.statements.length * p.evidence.length +
    nearMisses(p) +
    (found.length > 0 && found.some((c) => c.press) ? 3 : 0)
  return {
    unique: found.length === 1,
    solutions: found.length,
    deducible: ok,
    band: ok ? bandOf(p, found) : null,
    steps,
    score,
    rules: { clash: found.length, near: nearMisses(p) }
  }
}

export function verifyTestimony(p: any): any {
  const r = solveTestimony(p)
  if (!r.unique) throw new PuzzleError(`the testimony has ${r.solutions} clashes, not one`)
  if (!r.deducible) throw new PuzzleError('the clash is not the pair the solution names')
  return r
}

function _keyinfo(p: any, key: string): any {
  for (const k of p.keys) {
    if (k.key === key) return k
  }
  throw new PuzzleError(`no key "${key}"`)
}

export function claimSentence(p: any, c: any): string {
  const k = _keyinfo(p, c.key)
  const tmpl = k.claim ?? `The ${k.key} is {v}`
  const s = tmpl.replace('{v}', c.value)
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s
}

export function factSentence(p: any, f: any): string {
  const k = _keyinfo(p, f.key)
  const tmpl = k.fact ?? `The ${k.key} is {v}`
  return tmpl.replace('{v}', f.value)
}

export function defaultTestimonyNames(p: any): Record<string, string> {
  const have = p.names ?? {}
  const out: Record<string, string> = { wit: have.wit ?? WITNESS }
  const used: Record<string, number> = {}
  for (const e of p.evidence) {
    const k = _keyinfo(p, e.facts[0].key)
    const base = k.item ?? e.id
    used[base] = (used[base] ?? 0) + 1
    out[e.id] = have[e.id] ?? (used[base] === 1 ? base : `${base} ${used[base]}`)
  }
  return out
}
const defaultNames = defaultTestimonyNames

export function fillTestimony(p: any, names?: Record<string, string>): any {
  const nm = names ? { ...names } : defaultTestimonyNames(p)
  p.names = nm
  const w = nm.wit
  const text: Record<string, string> = {
    intro: `${w} is giving testimony. Press a statement to hear more, and present the evidence that proves one of them false.`
  }
  for (const s of p.statements) {
    text[s.id] = `${s.claims.map((c: any) => claimSentence(p, c)).join('. ')}.`
    const extra = s.press?.claims || []
    if (extra.length > 0) {
      text[`${s.id}.press`] = `Now that you ask. ${extra.map((c: any) => claimSentence(p, c)).join('. ')}.`
    }
  }
  for (const e of p.evidence) {
    text[e.id] = `${nm[e.id]}: ${e.facts.map((f: any) => factSentence(p, f)).join('. ')}.`
  }
  p.text = text
  return p
}

export function renderAllTestimony(p: any, names?: Record<string, string>): { names: Record<string, string>; text: Record<string, string> } {
  const q = { ...p }
  delete q.text
  delete q.names
  fillTestimony(q, names)
  return { names: q.names, text: q.text }
}

export function generateTestimony(
  size?: number | null,
  seed = 0,
  band = 'medium',
  maxTries = 200
): TestimonyCore & { names: Record<string, string>; text: Record<string, string> } {
  if (!BANDS.includes(band as any)) {
    throw new PuzzleError(`unknown band "${band}" (easy, medium or hard)`)
  }
  const [n, m] = SIZES[band]!
  const rng = new SeededRandom(`vno-puzzles:testimony:${seed}:${band}`)

  for (let tryCount = 0; tryCount < maxTries; tryCount++) {
    const world: Record<string, string> = {}
    for (const v of VOCAB) {
      world[v.key] = rng.choice(v.values)
    }
    const keys = VOCAB.map((v) => v.key)

    const claim = (key: string, truth = true): { key: string; value: string } => {
      const vals = BY_KEY[key]!.values
      const value = truth ? world[key]! : rng.choice(vals.filter((x) => x !== world[key]))
      return { key, value }
    }

    const liarKey = rng.choice(keys)
    const pressed = band !== 'easy'
    const others = keys.filter((k) => k !== liarKey)
    const liarAt = rng.randrange(n)

    const mains = rng.sample(others, pressed ? n : n - 1)
    const allMains = new Set(mains)
    const statements: any[] = []
    const pressKeys: string[] = pressed ? [liarKey] : []

    for (let i = 0; i < n; i++) {
      let st: any
      if (i === liarAt) {
        if (pressed) {
          const main = mains.pop()!
          st = { claims: [claim(main)], press: { claims: [claim(liarKey, false)] } }
        } else {
          st = { claims: [claim(liarKey, false)] }
        }
      } else {
        const main = mains.pop()!
        st = { claims: [claim(main)] }
        if (pressed && rng.random() < 0.5) {
          // VNO-36 rule: exclude all statement main keys from extra_keys for press claims!
          const free = others.filter((k) => !allMains.has(k) && !pressKeys.includes(k))
          if (free.length > 0) {
            const pk = rng.choice(free)
            pressKeys.push(pk)
            st.press = { claims: [claim(pk)] }
          }
        }
      }
      statements.push(st)
    }

    const evidKeys = rng.sample(others, m - 1)
    const evidence: any[] = [{ facts: [claim(liarKey)] }, ...evidKeys.map((k) => ({ facts: [claim(k)] }))]
    if (band === 'hard') {
      const spare = others.filter((k) => !evidKeys.includes(k))
      for (let j = 1; j < evidence.length; j++) {
        if (spare.length > 0 && rng.random() < 0.5) {
          const idx = rng.randrange(spare.length)
          evidence[j]!.facts.push(claim(spare[idx]!))
          spare.splice(idx, 1)
        }
      }
    }

    rng.shuffle(evidence)
    for (let i = 0; i < statements.length; i++) {
      statements[i]!.id = `t${i + 1}`
    }
    for (let j = 0; j < evidence.length; j++) {
      evidence[j]!.id = `e${j + 1}`
    }

    const liarId = statements[liarAt]!.id
    const witness = evidence.find(
      (e) =>
        e.facts[0].key === liarKey &&
        e.facts[0].value === world[liarKey] &&
        e.facts.filter((f: any) => f.key === liarKey).length === 1
    )!.id

    const usedKeys = new Set<string>()
    for (const s of statements) {
      for (const c of allClaims(s)) usedKeys.add(c.key)
    }
    for (const e of evidence) {
      for (const f of e.facts) usedKeys.add(f.key)
    }

    const p: any = {
      format: FORMAT,
      kind: 'testimony',
      size: n,
      seed,
      band,
      witness: 'wit',
      keys: VOCAB.filter((v) => usedKeys.has(v.key)).map((v) => ({ ...v })),
      statements,
      evidence,
      solution: { statement: liarId, evidence: witness, press: pressed }
    }

    if (repeats(p).length > 0) continue

    const found = clashes(p)
    if (found.length !== 1 || found[0].statement !== liarId || found[0].evidence !== witness) {
      continue
    }
    if (bandOf(p, found) !== band) continue

    const res = solveTestimony(p)
    p.difficulty = { steps: res.steps.length, score: res.score, rules: res.rules }
    p.steps = res.steps
    return fillTestimony(p)
  }

  throw new PuzzleError(`no ${band} testimony found for seed ${seed} in ${maxTries} tries`)
}

export function checkPresent(
  p: any,
  statement: string,
  evidence: string,
  pressed: readonly string[] = []
): { result: 'correct' | 'press_first' | 'wrong' } {
  const sol = p.solution
  if (statement !== sol.statement || evidence !== sol.evidence) {
    return { result: 'wrong' }
  }
  if (sol.press && !pressed.includes(statement)) {
    return { result: 'press_first' }
  }
  return { result: 'correct' }
}

export function hintTestimony(
  p: any,
  marks: Record<string, string>,
  hints = 0
): { kind: string; cell: string; text: string } {
  const pressed = Object.entries(marks)
    .filter(([_, v]) => v === 'pressed')
    .map(([k]) => k)
  const nm = p.names ?? defaultNames(p)
  const sol = p.solution
  const found = clashes(p)[0]
  const k = _keyinfo(p, found.key)
  const n = hints

  if (n === 0) {
    return {
      kind: 'step',
      cell: '',
      text: `One statement does not fit a piece of evidence. Look for what the evidence says about ${k.label}.`
    }
  }
  if (sol.press && !pressed.includes(sol.statement) && n === 1) {
    return {
      kind: 'step',
      cell: '',
      text: 'Someone is holding something back. Press the statements and listen.'
    }
  }
  const num = sol.statement.slice(1)
  if (n <= 2) {
    return {
      kind: 'step',
      cell: '',
      text: `Statement ${num} is the one that does not hold.`
    }
  }
  return {
    kind: 'step',
    cell: '',
    text: `Present the ${nm[sol.evidence]} at statement ${num}.`
  }
}

function _set(items: any[], label: string): Set<string> {
  const out = new Set<string>()
  for (const c of items || []) {
    if (!c || typeof c !== 'object' || !c.key || !c.value) {
      throw new Error(`${label}: a claim needs a key and a value`)
    }
    out.add(`${c.key}|${c.value}`)
  }
  return out
}

function _setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const item of a) if (!b.has(item)) return false
  return true
}

export function checkTestimonyText(
  p: any,
  readBack: any[],
  _text?: Record<string, string>
): { ok: boolean; problems: any[]; differing: string[] } {
  validateTestimony(p)
  const byId = new Map<string, any>()
  for (const r of readBack) {
    if (r && r.id) byId.set(r.id, r)
  }

  const problems: { clue: string; problem: string }[] = []
  const differing: string[] = []
  const keys: Record<string, any> = Object.fromEntries(p.keys.map((k: any) => [k.key, k]))

  function bad(ident: string, problem: string): void {
    problems.push({ clue: ident, problem })
    differing.push(ident)
  }

  const rbStatements: any[] = []
  const rbEvidence: any[] = []

  function compare(ident: string, want: Set<string>, field: string): any[] | null {
    const r = byId.get(ident)
    if (!r) {
      bad(ident, 'the reader gave nothing for this one')
      return null
    }
    let got: Set<string>
    try {
      got = _set(r[field], ident)
    } catch (e: any) {
      bad(ident, e.message)
      return null
    }
    for (const item of got) {
      const [k, v] = item.split('|') as [string, string]
      if (!keys[k] || !keys[k].values.includes(v)) {
        bad(ident, `${k}=${v} is not in the keys of this puzzle`)
        return null
      }
    }
    if (!_setsEqual(got, want)) {
      const diffKeys = new Set<string>()
      for (const item of got) if (!want.has(item)) diffKeys.add(item.split('|')[0]!)
      for (const item of want) if (!got.has(item)) diffKeys.add(item.split('|')[0]!)
      bad(ident, `the prose says something else about ${Array.from(diffKeys).sort().join(', ')}, not what is written`)
      return null
    }
    return Array.from(got)
      .sort()
      .map((item) => {
        const [k, v] = item.split('|')
        return { key: k!, value: v! }
      })
  }

  for (const s of p.statements) {
    const base = compare(s.id, _pairs(s.claims), 'claims')
    const extraWant = _pairs(s.press?.claims)
    const extra = extraWant.size > 0 ? compare(`${s.id}.press`, extraWant, 'claims') : []
    if (base !== null && extra !== null) {
      rbStatements.push({
        id: s.id,
        claims: base,
        ...(extra.length > 0 ? { press: { claims: extra } } : {})
      })
    }
  }

  for (const e of p.evidence) {
    const got = compare(e.id, _pairs(e.facts), 'facts')
    if (got !== null) {
      rbEvidence.push({ id: e.id, facts: got })
    }
  }

  if (problems.length === 0) {
    const q = { ...p, statements: rbStatements, evidence: rbEvidence }
    const found = clashes(q)
    const sol = p.solution
    if (found.length !== 1) {
      problems.push({ clue: '', problem: `the read-back puzzle has ${found.length} clashes, not one` })
    } else if (found[0].statement !== sol.statement || found[0].evidence !== sol.evidence) {
      problems.push({ clue: '', problem: 'the read-back puzzle clashes somewhere else' })
    }
  }

  return { ok: problems.length === 0, problems, differing }
}
