/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Multiple-choice Quiz puzzle generator, solver, and player helpers.
 */

import { SeededRandom } from './prng'
import { FORMAT, BANDS, PuzzleError } from './model'
import type { Band } from './model'
import type { QuizCore, QuizQuestion, PuzzleStep } from '../puzzle'

interface QuestionTemplate {
  prompt: string
  correct: string
  distractors: string[]
}

const QUESTION_BANK: QuestionTemplate[] = [
  {
    prompt: 'Who was observed in the grand library shortly before the grandfather clock struck nine?',
    correct: 'Colonel Ash',
    distractors: ['Doctor Birch', 'Miss Cole', 'Lady Dunn', 'Mr Frost']
  },
  {
    prompt: 'Which weapon was retrieved from the locked conservatory display case?',
    correct: 'antique dagger',
    distractors: ['silver candlestick', 'braided rope', 'heavy vase', 'vial of poison']
  },
  {
    prompt: 'Where was the secret passage behind the book shelves discovered?',
    correct: 'study',
    distractors: ['wine cellar', 'ballroom', 'billiard room', 'observatory']
  },
  {
    prompt: 'What piece of physical evidence directly contradicted the witness testimony?',
    correct: 'stopped pocket watch',
    distractors: ['torn letter', 'muddy boot print', 'forged will', 'broken seal']
  },
  {
    prompt: 'Which motive was confirmed by the intercepted encrypted ledger?',
    correct: 'blackmail',
    distractors: ['jealousy', 'inheritance', 'professional rivalry', 'political revenge']
  },
  {
    prompt: 'What unusual scent was noted lingering near the crime scene?',
    correct: 'bitter almonds',
    distractors: ['burnt pipe tobacco', 'damp earth', 'lavender water', 'kerosene']
  },
  {
    prompt: 'Who was the last person seen leaving through the side garden gate?',
    correct: 'the hooded courier',
    distractors: ['the estate groundskeeper', 'the evening maid', 'the carriage driver', 'the visiting doctor']
  },
  {
    prompt: 'What item was found concealed beneath the floorboards in the attic?',
    correct: 'brass key',
    distractors: ['leather diary', 'ruby pendant', 'stained handkerchief', 'wax seal stamp']
  },
  {
    prompt: 'At what time did the station train arrive on the night of the incident?',
    correct: 'ten forty-five',
    distractors: ['nine fifteen', 'eleven thirty', 'midnight sharp', 'ten o clock']
  },
  {
    prompt: 'Which room had its window latch deliberately forced open from the inside?',
    correct: 'parlor',
    distractors: ['scullery', 'music room', 'dining hall', 'guest bedroom']
  }
]

export function defaultQuizNames(p: any): Record<string, string> {
  return p.names ?? {}
}

export function renderAllQuiz(p: any, names?: Record<string, string>): { names: Record<string, string>; text: Record<string, string> } {
  const nm: Record<string, string> = { ...(p.names ?? {}), ...(names ?? {}) }
  for (const q of p.questions || []) {
    for (const opt of q.options || []) {
      if (!nm[opt]) nm[opt] = opt
    }
  }
  const text: Record<string, string> = {
    intro: p.text?.intro ?? 'Answer the following multiple-choice questions.'
  }
  for (const q of p.questions || []) {
    text[q.id] = p.text?.[q.id] ?? `Question ${q.id}`
  }
  return { names: nm, text }
}

export function generateQuiz(
  seed = 0,
  count?: number | null,
  band: Band = 'medium'
): QuizCore & { names: Record<string, string>; text: Record<string, string> } {
  if (!BANDS.includes(band)) {
    throw new PuzzleError(`unknown band "${band}" (easy, medium or hard)`)
  }
  const defaultCount = band === 'easy' ? 3 : band === 'medium' ? 4 : 5
  const qCount = Math.max(1, Math.min(10, count ?? defaultCount))
  const rng = new SeededRandom(`vno-puzzles:quiz:${seed}:${band}:${qCount}`)

  const numDistractors = band === 'easy' ? 2 : band === 'medium' ? 3 : 4
  const pickedTemplates = rng.sample(QUESTION_BANK, qCount)

  const questions: QuizQuestion[] = []
  const solution: Record<string, string> = {}
  const names: Record<string, string> = {}
  const text: Record<string, string> = {
    intro: 'Answer the following questions carefully based on the investigation.'
  }

  for (let i = 0; i < pickedTemplates.length; i++) {
    const tmpl = pickedTemplates[i]!
    const qId = `q${i + 1}`
    text[qId] = tmpl.prompt

    const pickedDistractors = rng.sample(tmpl.distractors, numDistractors)
    const allOptionsText = [tmpl.correct, ...pickedDistractors]
    rng.shuffle(allOptionsText)

    const optIds: string[] = []
    let answerId = ''
    for (let j = 0; j < allOptionsText.length; j++) {
      const optId = `${qId}_o${j + 1}`
      optIds.push(optId)
      names[optId] = allOptionsText[j]!
      if (allOptionsText[j] === tmpl.correct) {
        answerId = optId
      }
    }

    questions.push({
      id: qId,
      options: optIds,
      answer: answerId
    })
    solution[qId] = answerId
  }

  const weight = band === 'hard' ? 3 : band === 'medium' ? 2 : 1
  const steps: PuzzleStep[] = questions.map((q) => ({
    rule: 'answer',
    who: q.id,
    value: q.answer
  }))

  const difficulty = {
    steps: qCount,
    score: qCount * weight,
    rules: { quiz: qCount }
  }

  return {
    format: FORMAT,
    kind: 'quiz',
    seed,
    band,
    questions,
    solution,
    difficulty,
    steps,
    names,
    text
  }
}

export function validateQuiz(p: any): void {
  if (p.format !== undefined && p.format !== FORMAT) {
    throw new PuzzleError(`unknown puzzle format ${p.format}`)
  }
  if (p.kind !== 'quiz') {
    throw new PuzzleError('not a quiz puzzle')
  }
  if (!Array.isArray(p.questions) || p.questions.length === 0 || p.questions.length > 10) {
    throw new PuzzleError('a quiz puzzle must have between 1 and 10 questions')
  }
  const seenIds = new Set<string>()
  for (const q of p.questions) {
    if (seenIds.has(q.id)) {
      throw new PuzzleError(`duplicate question id "${q.id}"`)
    }
    seenIds.add(q.id)
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) {
      throw new PuzzleError(`question "${q.id}" options must have between 2 and 6 choices`)
    }
    if (!q.options.includes(q.answer)) {
      throw new PuzzleError(`question "${q.id}" answer "${q.answer}" is not in options`)
    }
    if (p.solution?.[q.id] !== q.answer) {
      throw new PuzzleError(`solution["${q.id}"] must match question answer "${q.answer}"`)
    }
  }
}

export function solveQuiz(p: any): {
  unique: boolean
  solutions: number
  deducible: boolean
  band: Band | null
  steps: PuzzleStep[]
  score: number
  rules: Record<string, number>
} {
  validateQuiz(p)
  const steps: PuzzleStep[] = p.steps ?? p.questions.map((q: any) => ({
    rule: 'answer',
    who: q.id,
    value: q.answer
  }))
  const score = p.difficulty?.score ?? p.questions.length * 2
  const rules = p.difficulty?.rules ?? { quiz: p.questions.length }
  const band = p.band ?? 'medium'
  return {
    unique: true,
    solutions: 1,
    deducible: true,
    band,
    steps,
    score,
    rules
  }
}

export function verifyQuiz(p: any): any {
  return solveQuiz(p)
}

export function checkQuiz(
  p: QuizCore,
  answers: Record<string, string>
): { correct: boolean; wrong: string[]; score: number; total: number } {
  const wrong: string[] = []
  for (const q of p.questions) {
    if (answers[q.id] !== q.answer) {
      wrong.push(q.id)
    }
  }
  return {
    correct: wrong.length === 0,
    wrong,
    score: p.questions.length - wrong.length,
    total: p.questions.length
  }
}

export function hintQuiz(
  p: QuizCore,
  answers: Record<string, string>
): { kind: 'step' | 'accuse'; cell: string; text: string } {
  for (const q of p.questions) {
    if (answers[q.id] !== q.answer) {
      const prompt = (p as any).text?.[q.id] ?? `question ${q.id}`
      return {
        kind: 'step',
        cell: q.id,
        text: `Review question ${q.id}: "${prompt}". Carefully verify your selected option.`
      }
    }
  }
  return {
    kind: 'accuse',
    cell: '',
    text: 'All questions have been answered correctly. Submit your quiz.'
  }
}

function _norm(s: any): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function checkQuizText(
  p: any,
  readBack: any[],
  _text?: Record<string, string>
): { ok: boolean; problems: any[]; differing: string[] } {
  validateQuiz(p)
  const byId = new Map<string, any>()
  for (const r of readBack) {
    if (r && r.id) byId.set(r.id, r)
  }

  const problems: { clue: string; problem: string }[] = []
  const differing: string[] = []

  function bad(ident: string, problem: string): void {
    problems.push({ clue: ident, problem })
    differing.push(ident)
  }

  for (const q of p.questions) {
    const r = byId.get(q.id)
    if (!r) {
      bad(q.id, 'the reader gave no answer for this question')
      continue
    }
    const readerAnswer = r.answer ?? r.value ?? r.option
    if (!readerAnswer) {
      bad(q.id, 'the reader gave no answer option')
      continue
    }
    const expectedId = q.answer
    const expectedText = p.names?.[expectedId]
    const matches =
      _norm(readerAnswer) === _norm(expectedId) ||
      (expectedText && _norm(readerAnswer) === _norm(expectedText))
    if (!matches) {
      bad(q.id, `the reader answered "${readerAnswer}", expected "${expectedText ?? expectedId}"`)
    }
  }

  return { ok: problems.length === 0, problems, differing }
}
