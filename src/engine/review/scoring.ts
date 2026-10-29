import { z } from 'zod'
import type { QualityConfig } from '../../shared/schemas'
import { chatJson } from '../pipeline/llm'
import { buildMessages } from '../pipeline/prompts'
import type { ChatMessage } from '../models/types'
import type { JobContext } from '../queue/scheduler'

/**
 * The review contract every reviewer role answers with: `{verdict, scores, notes, problems}`. Ported from Scriptorium's scoring, with the
 * problems itemised by `ref` (an item id, an article id, a text key) so a writer can fix exactly what was flagged.
 */

export interface ReviewProblem {
  /** What the problem is about: an item id, an article id, a text key, or '' for the course as a whole. */
  ref: string
  issue: string
  fix?: string
  severity?: 'major' | 'minor'
}

export interface ReviewResult {
  role: string
  verdict: 'pass' | 'revise'
  /** 1 to 10 per dimension (see `ROLE_DIMENSIONS`). */
  scores: Record<string, number>
  notes: string
  problems: ReviewProblem[]
}

/** Dimensions each reviewer role scores (1-10). The misconception-designer writes content, it is not a reviewer. */
export const ROLE_DIMENSIONS: Record<string, string[]> = {
  'fact-checker': ['accuracy'],
  'accessibility-reviewer': ['accessibility', 'readability'],
  'child-safety-reviewer': ['age_fit'],
  playtester: ['flow', 'difficulty'],
  /** relevance: the picture shows what its plan line says; clarity: readable, no garbled text or artefacts. */
  'art-critic': ['relevance', 'clarity']
}

export function dimensionsFor(role: string): string[] {
  return ROLE_DIMENSIONS[role] ?? ['quality']
}

/** The scores object of a reviewer's prompt as an example: `{"accessibility": 8, "readability": 8}`. */
export function scoresExample(role: string): string {
  return `{${dimensionsFor(role).map((d) => `"${d}": 8`).join(', ')}}`
}

// ---- the schema ----

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

const text = (o: Obj, ...keys: string[]): string => {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return ''
}

/** A score key as the engine keeps it: `Age Fit` and `age-fit` are `age_fit`. */
const dimensionKey = (k: string): string => k.trim().toLowerCase().replace(/[\s-]+/g, '_')

/** One finding as a model may write it (a line of text, or an object with its own key names) in the contract's shape. */
function problemOf(item: unknown): ReviewProblem | null {
  if (typeof item === 'string') return item.trim() ? { ref: '', issue: item.trim() } : null
  if (!isObj(item)) return null
  const issue = text(item, 'issue', 'problem', 'description', 'claim', 'text', 'detail', 'type')
  if (!issue) return null
  const fix = text(item, 'fix', 'suggestion', 'change')
  const severity = text(item, 'severity').toLowerCase()
  return { ref: text(item, 'ref', 'id', 'item', 'article', 'key'), issue, ...(fix ? { fix } : {}), ...(severity === 'major' || severity === 'minor' ? { severity } : {}) } as ReviewProblem
}

/**
 * A reviewer's JSON before it is checked. Models vary: a verdict in capitals, a score of 0 or 11 or as a string, findings written as text
 * lines or as objects with other key names. The verdict is lower-cased, scores become numbers between 1 and 10 (a score that is no number
 * is dropped), `notes` and `problems` get their defaults, and every finding becomes `{ref, issue, fix?, severity?}`.
 */
export function normalizeReviewJson(raw: unknown): unknown {
  if (!isObj(raw)) return raw
  const out: Obj = { ...raw }
  if (typeof raw.verdict === 'string') out.verdict = raw.verdict.trim().toLowerCase()
  if (isObj(raw.scores)) {
    const scores: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw.scores)) {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN
      if (Number.isFinite(n)) scores[dimensionKey(k)] = clamp(n, 1, 10)
    }
    out.scores = scores
  } else if (raw.scores === undefined || raw.scores === null) out.scores = {}
  out.notes = typeof raw.notes === 'string' ? raw.notes : raw.notes === undefined || raw.notes === null ? '' : String(raw.notes)
  const list = Array.isArray(raw.problems) ? raw.problems : typeof raw.problems === 'string' ? [raw.problems] : []
  out.problems = list.map(problemOf).filter((p): p is ReviewProblem => !!p)
  return out
}

const problemSchema = z.object({
  ref: z.string().default(''),
  issue: z.string().min(1),
  fix: z.string().optional(),
  severity: z.enum(['major', 'minor']).optional()
})

const body = (dims: string[]) =>
  z.object({
    verdict: z.enum(['pass', 'revise']),
    scores: z.object(Object.fromEntries(dims.map((d) => [d, z.number().min(1).max(10)]))).catchall(z.number().min(1).max(10)),
    notes: z.string().default(''),
    problems: z.array(problemSchema).default([])
  })

/** The review JSON of any reviewer: scores are any dimensions, 1 to 10. */
export const reviewSchema = z.preprocess(normalizeReviewJson, z.object({
  verdict: z.enum(['pass', 'revise']),
  scores: z.record(z.string(), z.number().min(1).max(10)).default({}),
  notes: z.string().default(''),
  problems: z.array(problemSchema).default([])
}))

/** The schema of one reviewer role: its own dimensions are required, so structured output and the repair round both insist on them. */
export function reviewSchemaFor(role: string) {
  return z.preprocess(normalizeReviewJson, body(dimensionsFor(role)))
}

/** The object schema of one reviewer role (before the normalising step), for a role whose answer has more fields than a review (the playtester's `deadEnds`). */
export const reviewBodyFor = (role: string) => body(dimensionsFor(role))

// ---- reading a review ----

/** The lowest score of a review, or undefined when it has none. */
export function lowestScore(r: Pick<ReviewResult, 'scores'>): number | undefined {
  const v = Object.values(r.scores)
  return v.length ? Math.min(...v) : undefined
}

/**
 * Does this review send the content back? A reviewer in `must_pass` that says `revise` always does. Any other reviewer's `revise` counts
 * only with a score below `revise_below`: "revise" with only good scores is a pass. A revise without scores counts (nothing says it is fine).
 */
export function countsAsRevise(review: ReviewResult, quality: QualityConfig): boolean {
  if (review.verdict !== 'revise') return false
  if (quality.must_pass.includes(review.role)) return true
  const lowest = lowestScore(review)
  return lowest === undefined || lowest < quality.revise_below
}

/** The reviews that send the content back, for the revise loop. */
export const reviewsThatRevise = (reviews: ReviewResult[], quality: QualityConfig): ReviewResult[] => reviews.filter((r) => countsAsRevise(r, quality))

/** Average of every dimension across reviewers, then the weighted mean of those averages. */
export function weightedScore(reviews: ReviewResult[], weights: Record<string, number>): { score: number; byDimension: Record<string, number> } {
  const sums = new Map<string, { sum: number; n: number }>()
  for (const r of reviews) {
    for (const [dim, v] of Object.entries(r.scores)) {
      const e = sums.get(dim) ?? { sum: 0, n: 0 }
      e.sum += v
      e.n++
      sums.set(dim, e)
    }
  }
  const byDimension: Record<string, number> = {}
  let num = 0
  let den = 0
  for (const [dim, e] of sums) {
    const avg = e.sum / e.n
    byDimension[dim] = Number(avg.toFixed(2))
    const w = weights[dim] ?? 1
    num += avg * w
    den += w
  }
  return { score: den > 0 ? Number((num / den).toFixed(2)) : 0, byDimension }
}

/** A hard gate the publisher must also clear: lint errors, a failed bot run ... Not a review score: it cannot be outvoted. */
export interface Gate {
  name: string
  ok: boolean
  reason?: string
}

export interface Decision {
  publish: boolean
  score: number
  byDimension: Record<string, number>
  reasons: string[]
}

/**
 * The publisher's rule: a must-pass reviewer that says `revise` rejects; so does a hard gate that is not ok. Otherwise the weighted score
 * must reach the threshold.
 */
export function decide(reviews: ReviewResult[], quality: QualityConfig, gates: Gate[] = []): Decision {
  const { score, byDimension } = weightedScore(reviews, quality.weights)
  const reasons: string[] = []
  for (const r of reviews) {
    if (quality.must_pass.includes(r.role) && r.verdict !== 'pass') {
      reasons.push(`must-pass gate failed: ${r.role} says revise. ${r.notes.slice(0, 400)}`.trim())
    }
  }
  for (const g of gates) if (!g.ok) reasons.push(`hard gate failed: ${g.name}${g.reason ? `: ${g.reason.slice(0, 400)}` : ''}`)
  if (score < quality.threshold) reasons.push(`weighted score ${score} is below the threshold ${quality.threshold}`)
  return { publish: reasons.length === 0, score, byDimension, reasons }
}

// ---- asking a reviewer ----

const COUNTS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+\S/

/**
 * Why a "revise" has no usable notes, or null when it has. A revise must say what to change: notes that are too short, that promise a list
 * ("three fixes below") and give none or fewer, or that stop in the middle of a sentence, are not enough, unless `problems` carries the findings.
 */
export function notesProblem(verdict: string, notes: string, problems: readonly unknown[]): string | null {
  if (verdict !== 'revise') return null
  const n = notes.trim()
  const lines = n.split('\n')
  const items = lines.filter((l) => LIST_ITEM.test(l)).length
  const total = items + problems.length
  if (n.length < 40 && problems.length === 0) return 'the notes are too short to say what to change'
  if ((/\b(below|as follows|the following|here are)\b/i.test(n) || /:\s*$/.test(n)) && total === 0) return 'the notes promise a list of fixes but give none'
  const promised = /\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:[\w-]+\s+){0,2}(?:fixes|problems|issues|changes|points|items|concerns|errors|slips)\b/i.exec(n)
  if (promised) {
    const count = COUNTS[promised[1]!.toLowerCase()] ?? Number(promised[1])
    if (count >= 2 && count <= 10 && count > total) return `the notes promise ${count} items but give ${total}`
  }
  const last = lines.filter((l) => l.trim()).pop() ?? ''
  if (problems.length === 0 && !LIST_ITEM.test(last) && !/[.!?"'”’)\]]$/.test(n)) return 'the notes stop in the middle of a sentence'
  return null
}

export interface RunReviewInput {
  /** The reviewer role: the prompt is `prompts/<role>/<task>.md` and the scores are its dimensions. */
  role: string
  task: string
  /** The variables of the prompt. `scores_example` is added. */
  vars: Record<string, string | number | undefined | null>
  dataDir: string
  maxTokens?: number
}

/**
 * Asks a reviewer: builds the prompt, asks for the review JSON (one repair round if it is not valid, see `chatJson`) and returns it as a
 * `ReviewResult`. A `revise` that says nothing usable (no problems, notes that promise a list) is asked once more in the same job; if it
 * still says nothing, it is kept with a warning in the job log (a course never fails over this).
 */
export async function runReview(ctx: JobContext, input: RunReviewInput): Promise<ReviewResult> {
  const schema = reviewSchemaFor(input.role)
  const { messages } = await buildMessages(input.dataDir, ctx, input.role, input.task, { scores_example: scoresExample(input.role), ...input.vars })
  const opts = { maxTokens: input.maxTokens ?? 6000, temperature: 0.2 }
  const first = await chatJson(ctx, messages, schema, opts)
  let value = first.value as z.output<ReturnType<typeof body>>
  const reason = notesProblem(value.verdict, value.notes, value.problems)
  if (reason) {
    ctx.log(`the review said revise without usable notes (${reason}): asking again`)
    const follow: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: first.chat.text.slice(0, 6000) },
      {
        role: 'user',
        content: `Your verdict is revise, but ${reason}. Reply again with the whole JSON object: the same verdict and scores, and every finding in "problems", one item each: {"ref": the item or article id, "issue": what is wrong, "fix": what to change}.`
      }
    ]
    const second = await chatJson(ctx, follow, schema, { ...opts, temperature: 0.2 })
    value = second.value as typeof value
    const again = notesProblem(value.verdict, value.notes, value.problems)
    if (again) ctx.log(`warning: the review said revise without usable notes (${again}); kept as it is`)
  }
  return { role: input.role, verdict: value.verdict, scores: value.scores as Record<string, number>, notes: value.notes, problems: value.problems }
}
