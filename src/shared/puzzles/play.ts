/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Game-time helpers. They never change what they are given: each returns a new value.
 */

import { allCells, answerOf, categoryIndex, cellItems, ownersOf } from './model'
import { stepText } from './text'
import { checkKnights, hintKnights, isCompleteKnights } from './knights'
import { hintTestimony } from './testimony'
import { checkQuiz, hintQuiz } from './quiz'

export const MARKS = ['', 'no', 'yes'] as const
export type Mark = (typeof MARKS)[number]

function _normKey(key: string): string {
  if (key.includes(',')) {
    const [a, b] = key.split(',')
    return `${a}|${b}`
  }
  return key
}

export function cycleMark(marks: Record<string, string>, key: string): Record<string, string> {
  const normKey = _normKey(key)
  const out = { ...marks }
  const cur = out[key] ?? out[normKey] ?? ''
  const nextMap: Record<string, string> = { '': 'no', no: 'yes', yes: '' }
  const nxt = nextMap[cur] ?? ''
  if (nxt) {
    out[key] = nxt
    out[normKey] = nxt
  } else {
    delete out[key]
    delete out[normKey]
  }
  return out
}

export function setMark(marks: Record<string, string>, key: string, value: string): Record<string, string> {
  const normKey = _normKey(key)
  const out = { ...marks }
  if (value) {
    out[key] = value
    out[normKey] = value
  } else {
    delete out[key]
    delete out[normKey]
  }
  return out
}

export const setCross = setMark

export function autoCross(p: any, marks: Record<string, string>, key: string): Record<string, string> {
  const normKey = _normKey(key)
  if ((marks[key] ?? marks[normKey]) !== 'yes') {
    return { ...marks }
  }
  const [a, b] = cellItems(normKey)
  const idx = categoryIndex(p)
  const out = { ...marks }
  for (const cell of allCells(p)) {
    const [x, y] = cellItems(cell)
    if (cell === normKey || out[cell] || out[`${x},${y}`]) continue
    if (idx[x] === idx[a] && idx[y] === idx[b] && (x === a || y === b)) {
      out[cell] = 'no'
      out[`${x},${y}`] = 'no'
    }
  }
  return out
}

export function truth(p: any): Record<string, string> {
  const owner = ownersOf(p)
  const out: Record<string, string> = {}
  for (const c of allCells(p)) {
    const [a, b] = cellItems(c)
    const val = owner[a] === owner[b] ? 'yes' : 'no'
    out[c] = val
    out[`${a},${b}`] = val
  }
  return out
}

export function checkAccusation(
  p: any,
  accusation: Record<string, string>
): { correct: boolean; wrong: string[] } {
  const answer: Record<string, string> = answerOf(p)
  const wrong: string[] = []
  for (const k of Object.keys(answer)) {
    if (accusation[k] !== answer[k]) {
      wrong.push(k)
    }
  }
  return { correct: wrong.length === 0, wrong }
}

export function checkSolution(
  p: any,
  marks: Record<string, string>
): { correct: boolean; wrong: string[] } {
  if (p.kind === 'knights') {
    return checkKnights(p, marks)
  }
  if (p.kind === 'quiz') {
    const r = checkQuiz(p, marks)
    return { correct: r.correct, wrong: r.wrong }
  }
  const t = truth(p)
  const allC = allCells(p)
  const wrong: string[] = []
  for (const c of allC) {
    const [a, b] = cellItems(c)
    const markVal = marks[c] ?? marks[`${a},${b}`]
    const isYes = markVal === 'yes'
    const shouldBeYes = t[c] === 'yes'
    if (isYes !== shouldBeYes) {
      wrong.push(c)
    }
  }
  return { correct: wrong.length === 0, wrong }
}

export function checkMarks(p: any, marks: Record<string, string>): string[] {
  if (p.kind === 'knights') {
    return p.speakers.filter((k: string) => marks[k] && p.solution[k] !== marks[k])
  }
  if (p.kind === 'quiz') {
    return p.questions.filter((q: any) => marks[q.id] && p.solution[q.id] !== marks[q.id]).map((q: any) => q.id)
  }
  const t = truth(p)
  const wrong: string[] = []
  for (const [c, v] of Object.entries(marks)) {
    const norm = _normKey(c)
    if (t[norm] && t[norm] !== v) {
      if (!wrong.includes(norm)) wrong.push(norm)
    }
  }
  return wrong
}

export function isComplete(p: any, marks: Record<string, string>): boolean {
  if (p.kind === 'knights') {
    return isCompleteKnights(p, marks)
  }
  if (p.kind === 'quiz') {
    return p.questions.every((q: any) => marks[q.id] === p.solution[q.id])
  }
  const t = truth(p)
  return allCells(p).every((c) => {
    const [a, b] = cellItems(c)
    const m = marks[c] ?? marks[`${a},${b}`]
    return m === t[c]
  })
}

export function hint(
  p: any,
  marks: Record<string, string>,
  hints = 0
): { kind: string; cell: string; text: string } {
  if (p.kind === 'testimony') {
    return hintTestimony(p, marks, hints)
  }
  if (p.kind === 'knights') {
    return hintKnights(p, marks)
  }
  if (p.kind === 'quiz') {
    return hintQuiz(p, marks)
  }
  const nm = p.names ?? {}
  const bad = checkMarks(p, marks)
  if (bad.length > 0) {
    const [a, b] = cellItems(bad[0]!)
    return { kind: 'wrong', cell: bad[0]!, text: `Look again at ${nm[a]} and ${nm[b]}.` }
  }
  for (const step of p.steps || []) {
    const [a, b] = step.cell
    const key = `${a}|${b}`
    const markVal = marks[key] ?? marks[`${a},${b}`]
    if (markVal !== step.value) {
      return { kind: 'step', cell: key, text: stepText(p, step, nm) }
    }
  }
  return { kind: 'accuse', cell: '', text: 'The grid is complete. Make your accusation.' }
}

// Logic grid specific aliases
export function cycleLogic(marks: Record<string, string>, key: string): Record<string, string> {
  return cycleMark(marks, key)
}

export function setLogicCross(marks: Record<string, string>, key: string, value: string): Record<string, string> {
  return setMark(marks, key, value)
}

export function autoLogicCross(p: any, marks: Record<string, string>, key: string): Record<string, string> {
  return autoCross(p, marks, key)
}

export function checkLogic(p: any, marks: Record<string, string>): { correct: boolean; wrong: string[] } {
  return checkSolution(p, marks)
}

export function hintLogic(p: any, marks: Record<string, string>): { kind: string; cell: string; text: string } {
  return hint(p, marks)
}
