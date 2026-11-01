import { z } from 'zod'
import { BLOOM_LEVELS, findUnitCycle } from '../../shared/course'
import { formOf, normalizeText } from '../../shared/edu'
import { questionKey } from '../research/notes'
import type { ChatMessage } from '../models/types'
import { chatJson } from '../pipeline/llm'
import { buildMessages } from '../pipeline/prompts'
import type { JobContext } from '../queue/scheduler'
import { reviewBodyFor, normalizeReviewJson } from '../review/scoring'
import type { ReviewProblem } from '../review/scoring'
import { citedFactIds, factLines } from './factbase'
import type { Fact } from './factbase'

/**
 * The output contracts of the content roles (EGS-07). Every role answers with one JSON object; here is the zod schema of each answer, the
 * `check...` function for what a schema cannot see (does this fact id exist? is this objective in this unit?) and the pure `apply...` /
 * merge functions that turn an answer into course data. The pipeline (EGS-08) only wires them into jobs:
 *
 *   askRole(ctx, {role, task, vars, schema, check})  -> the checked value, with one repair round (the schema's issues and the check's problems
 *                                                    are sent back to the model, in the words below)
 *
 * Text in an answer is inline (a prompt is a string, not a catalog key); `assemble.ts` turns it into catalog keys. Messages are written for the
 * model that reads them in a repair round: they say what is wrong, where and what to do.
 */

// ---- shared pieces ----

/** Models write `null` for a field they leave out: drop those keys (at any depth) before the schema looks. */
export function dropNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dropNulls)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null).map(([k, x]) => [k, dropNulls(x)]))
  return v
}
const lenient = <S extends z.ZodType>(s: S) => z.preprocess(dropNulls, s) as unknown as S

const text = (what = 'a text') => z.string({ error: `${what} must be a string` }).trim().min(1, `${what} must not be empty`)
const ident = z.string({ error: 'an id must be a string' }).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'an id may only have letters, digits, - and _ (no spaces, dots or accents), and starts with a letter or digit')
const ids = (what: string) => z.array(ident, { error: `${what} must be a list of ids` })

/** A problem found by a `check...` function: `ref` is an id (item, article, objective, unit) or '' for the whole answer. */
export type Problem = ReviewProblem
const problem = (ref: string, issue: string, fix?: string): Problem => ({ ref, issue, ...(fix ? { fix } : {}), severity: 'major' })

/** The problems as the text a model reads in a repair round. */
export function formatProblems(problems: readonly Problem[], max = 20): string {
  const lines = problems.slice(0, max).map((p) => `- ${p.ref ? `${p.ref}: ` : ''}${p.issue}${p.fix ? ` (${p.fix})` : ''}`)
  if (problems.length > max) lines.push(`- ... and ${problems.length - max} more`)
  return lines.join('\n')
}

const dups = (list: readonly string[]): string[] => [...new Set(list.filter((x, i) => list.indexOf(x) !== i))]
const norm = (s: string): string => normalizeText(s, { fold: true })

// ---- asking a role ----

export interface AskRoleInput<T> {
  dataDir: string
  role: string
  task: string
  vars: Record<string, string | number | undefined | null>
  schema: z.ZodType<T>
  /** What the schema cannot see (existing ids, counts ...): the problems are sent back once; if some remain, the job fails with them. */
  check?: (value: T) => Problem[]
  maxTokens?: number
  temperature?: number
}

/**
 * One role's task: builds the prompt (`prompts/<role>/<task>.md` + the rules + the agent's persona), asks for the JSON (`chatJson`: a reply
 * that is no JSON or does not fit the schema is repaired once with the schema's messages), runs `check`, and when it finds problems asks once
 * more with the problems listed. Throws an Error that lists the remaining problems (the scheduler retries the job).
 */
export async function askRole<T>(ctx: JobContext, o: AskRoleInput<T>): Promise<{ value: T; problems: Problem[] }> {
  const { messages } = await buildMessages(o.dataDir, ctx, o.role, o.task, o.vars)
  const opts = { maxTokens: o.maxTokens ?? 8000, temperature: o.temperature ?? 0.3 }
  const first = await chatJson(ctx, messages, o.schema, opts)
  const problems = o.check?.(first.value) ?? []
  if (problems.length === 0) return { value: first.value, problems: [] }
  ctx.log(`${o.role}/${o.task}: ${problems.length} problem(s) in the answer: asking again`)
  const follow: ChatMessage[] = [
    ...messages,
    { role: 'assistant', content: first.chat.text.slice(0, 12_000) },
    { role: 'user', content: `Your answer has problems:\n${formatProblems(problems)}\nReply again with the whole JSON object, with every problem fixed. Keep what was right. No explanations, no code fences.` }
  ]
  const second = await chatJson(ctx, follow, o.schema, opts)
  const again = o.check?.(second.value) ?? []
  if (again.length > 0) throw new Error(`the ${o.role} answer still has problems after a repair round:\n${formatProblems(again)}`)
  return { value: second.value, problems }
}

// ---- director: plan_brief ----

export const planSchema = lenient(
  z.object({
    title: text('the title'),
    summary: text('the summary'),
    units: z.array(z.object({ title: text('a unit title'), focus: text('a unit focus') }), { error: 'units must be a list of {title, focus}' }).min(1, 'give at least one unit').max(12, 'at most 12 units'),
    research: z.array(z.object({ question: text('a question').min(8, 'a research question is a full question'), unit: z.number({ error: 'unit is the number of the unit (1 for the first)' }).int().min(1) })).min(1, 'give research questions')
  })
)
export type Plan = z.output<typeof planSchema>

/** The plan has the number of units the format asks for, and 1 to `max` research questions for each (the unit is its number, from 1). */
export function checkPlan(plan: Plan, o: { units: number; maxQuestionsPerUnit?: number }): Problem[] {
  const out: Problem[] = []
  if (plan.units.length !== o.units) out.push(problem('', `the plan has ${plan.units.length} unit(s), the course has exactly ${o.units}`, `give exactly ${o.units} units`))
  const max = o.maxQuestionsPerUnit ?? 3
  plan.units.forEach((_, i) => {
    const n = plan.research.filter((r) => r.unit === i + 1).length
    if (n === 0) out.push(problem(`unit ${i + 1}`, 'no research question for this unit', 'add 1 to 3 questions whose unit is ' + String(i + 1)))
    else if (n > max) out.push(problem(`unit ${i + 1}`, `${n} research questions, at most ${max}`))
  })
  for (const r of plan.research) {
    if (r.unit > plan.units.length) out.push(problem('', `a research question names unit ${r.unit}, but there are ${plan.units.length} units`))
    if (questionKey(r.question).length < 8) out.push(problem('', `the question "${r.question}" is too short to search for`))
  }
  return out
}

// ---- curriculum-designer: curriculum ----

const bloom = z.enum(BLOOM_LEVELS, { error: `bloom must be one of ${BLOOM_LEVELS.join(', ')}` })

export const curriculumSchema = lenient(
  z.object({
    units: z
      .array(z.object({ id: ident, title: text('a unit title'), summary: text('a unit summary'), requires: ids('requires').default([]) }))
      .min(1, 'give at least one unit'),
    objectives: z
      .array(z.object({ id: ident, unit: ident, bloom, text: text('an objective text'), facts: ids('facts').min(1, 'every objective must rest on at least one fact id from the fact base (facts: ["f1"])') }))
      .min(1, 'give at least one objective')
  })
)
export type Curriculum = z.output<typeof curriculumSchema>

export interface CurriculumContext {
  /** The ids of the fact base. */
  factIds: Iterable<string>
  /** The units the course has (the plan's number). */
  units?: number
  /** Exactly this many objectives in each unit. */
  objectivesPerUnit?: number
  /** The text of every fact by id (`Fact.fact`): with it an objective is also checked against what its facts say (see `OBJECTIVE_CUES`). */
  factTexts?: Record<string, string>
}

/**
 * What an objective can ask for only when its facts say it: a word in the objective (English) and the evidence it needs in the text of the facts it rests on.
 * "Name its causes" with facts that state no cause cannot be answered from the fact base, and the item-writer would have to invent the answer (EGS-08 follow-up).
 * A heuristic on purpose: it only flags the clear cases, and only for English objective texts.
 */
export const OBJECTIVE_CUES: readonly { ask: string; objective: RegExp; evidence: RegExp }[] = [
  { ask: 'causes or reasons', objective: /\b(causes?|reasons?|why)\b/i, evidence: /\b(because|caused?|causes|due to|led to|leads? to|resulted? (?:in|from)|results? (?:in|from)|reasons?|as a result|owing to|thanks to|so that|therefore|since)\b/i },
  { ask: 'consequences or effects', objective: /\b(consequences?|effects?|impacts?|outcomes?)\b/i, evidence: /\b(consequences?|effects?|impacts?|outcomes?|led to|leads? to|resulted? (?:in|from)|results? (?:in|from)|as a result|after which|afterwards?|meant that|ended)\b/i },
  { ask: 'a date or a period', objective: /\b(dates?|years?|when|century|chronolog\w*|period)\b/i, evidence: /\b\d{3,4}\b|\b(century|centuries|BC|BCE|AD|CE|decade|era|period|ancient|medieval)\b/ }
]

/** Ids valid and unique, `requires` known and acyclic, every objective in a known unit with existing facts, every unit with at least one objective. */
export function checkCurriculum(c: Curriculum, o: CurriculumContext): Problem[] {
  const out: Problem[] = []
  const facts = new Set(o.factIds)
  const unitIds = c.units.map((u) => u.id)
  const known = new Set(unitIds)
  if (o.units !== undefined && c.units.length !== o.units) out.push(problem('', `${c.units.length} unit(s) given, the course has exactly ${o.units}`, `give exactly ${o.units} units`))
  for (const d of dups(unitIds)) out.push(problem(d, 'this unit id is used twice', 'every unit id must be unique'))
  for (const d of dups(c.objectives.map((x) => x.id))) out.push(problem(d, 'this objective id is used twice', 'every objective id must be unique'))
  for (const u of c.units) {
    for (const r of u.requires) {
      if (!known.has(r)) out.push(problem(u.id, `requires the unit "${r}", which does not exist`, `use one of: ${unitIds.join(', ')}`))
      else if (r === u.id) out.push(problem(u.id, 'requires itself'))
    }
    const n = c.objectives.filter((x) => x.unit === u.id).length
    if (n === 0) out.push(problem(u.id, 'this unit has no objective', 'every unit needs at least one objective'))
    else if (o.objectivesPerUnit !== undefined && n !== o.objectivesPerUnit) out.push(problem(u.id, `${n} objective(s), each unit has exactly ${o.objectivesPerUnit}`, `give exactly ${o.objectivesPerUnit}`))
  }
  const cycle = findUnitCycle(c.units.map((u) => ({ id: u.id, title: u.title, requires: u.requires.filter((r) => known.has(r)) })))
  if (cycle) out.push(problem('', `the prerequisites form a cycle: ${cycle.join(' -> ')}`, 'a unit may only require units before it'))
  if (!c.units.some((u) => u.requires.length === 0)) out.push(problem('', 'every unit has a prerequisite, so nobody can start', 'the first unit requires nothing'))
  for (const x of c.objectives) {
    if (!known.has(x.unit)) out.push(problem(x.id, `its unit "${x.unit}" does not exist`, `use one of: ${unitIds.join(', ')}`))
    for (const f of x.facts) if (!facts.has(f)) out.push(problem(x.id, `it rests on the fact "${f}", which is not in the fact base`, 'use only fact ids from the fact base'))
    if (o.factTexts) {
      const given = x.facts.filter((f) => facts.has(f))
      const said = given.map((f) => o.factTexts![f] ?? '').join(' ')
      if (given.length > 0 && said.trim()) {
        for (const cue of OBJECTIVE_CUES) {
          if (cue.objective.test(x.text) && !cue.evidence.test(said)) out.push(problem(x.id, `it asks for ${cue.ask}, but the facts it rests on (${given.join(', ')}) state none`, `rest it on a fact that says it, or ask for something the facts support`))
        }
      }
    }
  }
  return out
}

/** The objectives as prompt lines: `- u1-o1 [remember] text (facts: f1, f2)`. */
export function objectiveLines(objectives: Curriculum['objectives'], unit?: string): string {
  return objectives
    .filter((o) => !unit || o.unit === unit)
    .map((o) => `- ${o.id} [${o.bloom}] ${o.text} (facts: ${o.facts.join(', ')})`)
    .join('\n')
}

/** The units as prompt lines: `- u1: Title (requires: none). Summary`. */
export function unitLines(units: Curriculum['units']): string {
  return units.map((u) => `- ${u.id}: ${u.title} (requires: ${u.requires.join(', ') || 'none'}). ${u.summary}`).join('\n')
}

// ---- language-coach: scope, accepted ----

export const scopeSchema = lenient(
  z.object({
    units: z.array(
      z.object({
        unit: ident,
        vocabulary: z.array(z.object({ term: text('a term'), gloss: text('a gloss') })).min(1, 'each unit needs vocabulary'),
        grammar: z.array(z.string()).default([])
      })
    ).min(1)
  })
)
export type Scope = z.output<typeof scopeSchema>

export function checkScope(s: Scope, unitIds: Iterable<string>): Problem[] {
  const known = new Set(unitIds)
  const out: Problem[] = []
  for (const u of s.units) if (!known.has(u.unit)) out.push(problem(u.unit, 'no such unit', `use one of: ${[...known].join(', ')}`))
  for (const k of known) if (!s.units.some((u) => u.unit === k)) out.push(problem(k, 'the unit has no scope', 'give vocabulary for every unit'))
  return out
}

export const acceptedSchema = lenient(z.object({ answers: z.array(z.object({ ref: text('a ref'), accepted: z.array(text('an accepted answer')).min(1, 'give at least the canonical answer') })).default([]) }))
export type AcceptedOutput = z.output<typeof acceptedSchema>

/** The ref of an answer to widen: a typed item's id, or "<item id>.<gap id>" for a gap of a cloze item. */
const acceptedTarget = (items: AuthoredItem[], ref: string): { item: AuthoredItem; list: string[]; bank: string[] } | undefined => {
  const [itemId, gapId] = ref.split('.')
  const item = items.find((i) => i.id === itemId)
  if (!item) return undefined
  if (item.kind === 'typed' && gapId === undefined) return { item, list: item.accepted, bank: [] }
  if (item.kind === 'cloze' && gapId !== undefined) {
    const g = item.gaps.find((x) => x.id === gapId)
    if (g) return { item, list: g.accepted, bank: g.bank ?? [] }
  }
  return undefined
}

/** Every ref names a typed item or a gap of a cloze item; an added answer is not a wrong word of the gap's bank. */
export function checkAccepted(items: AuthoredItem[], out: AcceptedOutput): Problem[] {
  const problems: Problem[] = []
  for (const a of out.answers) {
    const t = acceptedTarget(items, a.ref)
    if (!t) {
      problems.push(problem(a.ref, 'no typed item or cloze gap has this ref', 'use the item id of a typed item, or "<item id>.<gap id>" for a cloze gap'))
      continue
    }
    const canonical = norm(t.list[0] ?? '')
    for (const x of a.accepted) if (t.bank.some((b) => norm(b) === norm(x) && norm(b) !== canonical)) problems.push(problem(a.ref, `the answer "${x}" is a wrong word of the gap's bank`, 'leave it out'))
  }
  return problems
}

/** The items with the coach's alternatives added to the accepted lists: the canonical answer (the writer's first) stays first, nothing repeats. */
export function mergeAccepted(items: AuthoredItem[], out: AcceptedOutput): AuthoredItem[] {
  const extra = new Map<string, string[]>()
  for (const a of out.answers) extra.set(a.ref, [...(extra.get(a.ref) ?? []), ...a.accepted])
  const widen = (list: string[], ref: string): string[] => {
    const seen = new Set(list.map(norm))
    const more: string[] = []
    for (const x of extra.get(ref) ?? []) {
      if (seen.has(norm(x))) continue
      seen.add(norm(x))
      more.push(x)
    }
    return [...list, ...more]
  }
  return items.map((it) => {
    if (it.kind === 'typed') return { ...it, accepted: widen(it.accepted, it.id) }
    if (it.kind === 'cloze') return { ...it, gaps: it.gaps.map((g) => ({ ...g, accepted: widen(g.accepted, `${it.id}.${g.id}`) })) }
    return it
  })
}

// ---- subject-expert: articles ----

export const articlesSchema = lenient(
  z.object({
    articles: z
      .array(z.object({ id: ident, unit: ident, title: text('an article title'), body: text('an article body').min(80, 'an article body is a few paragraphs (at least 80 characters)'), related: ids('related').default([]) }))
      .min(1, 'write at least one article')
  })
)
export type Articles = z.output<typeof articlesSchema>
export type Article = Articles['articles'][number]

export interface ArticleContext {
  factIds: Iterable<string>
  unitIds: Iterable<string>
  /** The unit these articles are for: every article must name it. */
  unit?: string
  /** How many articles the unit gets (`articles_per_unit`). */
  count?: number
  /** Article ids of other units (an id may not repeat; `related` may name them). */
  otherArticleIds?: Iterable<string>
}

/** Every article cites at least one fact, only facts that exist (as `[f3]` in its body); ids unique; `related` known; the unit right. */
export function checkArticles(a: Articles, o: ArticleContext): Problem[] {
  const out: Problem[] = []
  const facts = new Set(o.factIds)
  const units = new Set(o.unitIds)
  const other = new Set(o.otherArticleIds ?? [])
  const mine = new Set(a.articles.map((x) => x.id))
  if (o.count !== undefined && a.articles.length !== o.count) out.push(problem('', `${a.articles.length} article(s) given, the unit has exactly ${o.count}`, `write exactly ${o.count}`))
  for (const d of dups(a.articles.map((x) => x.id))) out.push(problem(d, 'this article id is used twice'))
  for (const x of a.articles) {
    if (other.has(x.id)) out.push(problem(x.id, 'this article id is already used by another unit', 'use a new id'))
    if (!units.has(x.unit)) out.push(problem(x.id, `its unit "${x.unit}" does not exist`, `use one of: ${[...units].join(', ')}`))
    else if (o.unit && x.unit !== o.unit) out.push(problem(x.id, `its unit is "${x.unit}", these articles are for "${o.unit}"`, `set unit to "${o.unit}"`))
    const cited = citedFactIds(x.body)
    if (cited.length === 0) out.push(problem(x.id, 'the article cites no fact', 'cite the facts it rests on in the text as [f3] (or [f3, f5]) right after the claim'))
    for (const f of cited) if (!facts.has(f)) out.push(problem(x.id, `it cites the fact ${f}, which is not in the fact base`, 'cite only fact ids that were given'))
    if (/\[\d+\]/.test(x.body)) out.push(problem(x.id, 'it has a source number like [3]', 'cite facts as [f3], never source numbers'))
    for (const r of x.related) if (!mine.has(r) && !other.has(r)) out.push(problem(x.id, `it relates to the article "${r}", which does not exist`, 'relate only to articles you wrote or that were listed'))
  }
  return out
}

/** The citations of an article in order of first use. */
export const citationsOf = (a: Pick<Article, 'body'>): string[] => citedFactIds(a.body)

/** The article body with `[f3]` markers turned into the numbers of the article's own citation list: `[1]`, `[1, 2]`. */
export function numberCitations(body: string, citations: readonly string[]): string {
  return body.replace(/\[(f\d{1,4}(?:\s*[,;]\s*f\d{1,4})*)\]/g, (_m, list: string) => {
    const ns = list.split(/[,;]/).map((s) => citations.indexOf(s.trim()) + 1).filter((n) => n > 0)
    return ns.length ? `[${[...new Set(ns)].sort((x, y) => x - y).join(', ')}]` : ''
  })
}

// ---- item-writer: items ----

/** The example of a gap marker, passed to the item prompts as `gap_marker` (a template cannot hold a literal double brace: it would be filled in). */
export const GAP_MARKER = '{{g1}}'

/** What the item-writer writes: inline texts, ids, the facts it rests on. `taught` marks, in a language course, an item whose answers are in the taught language. */
const itemCommon = {
  id: ident,
  objective: ident,
  prompt: text('the prompt'),
  explanation: text('the explanation'),
  facts: ids('facts').min(1, 'every item must name at least one fact id it rests on (facts: ["f1"])'),
  hint: text('the hint').optional(),
  didYouKnow: text('didYouKnow').optional(),
  didYouKnowFact: ident.optional(),
  difficulty: z.number({ error: 'difficulty is a number from 1 to 5' }).int().min(1).max(5).optional(),
  taught: z.boolean().optional()
}
const option = z.object({ id: ident, text: text('an option text'), why: text('why').optional() })

function uniqueIds(list: readonly { id: string }[], path: string, ctx: z.RefinementCtx, what: string): void {
  for (const d of dups(list.map((x) => x.id))) ctx.addIssue({ code: 'custom', path: [path], message: `the ${what} id "${d}" is used twice` })
}

const mcqItem = z
  .object({ ...itemCommon, kind: z.literal('mcq'), options: z.array(option).min(2, 'an mcq has at least 2 options').max(6, 'an mcq has at most 6 options'), answer: ident })
  .superRefine((v, ctx) => {
    uniqueIds(v.options, 'options', ctx, 'option')
    if (!v.options.some((o) => o.id === v.answer)) ctx.addIssue({ code: 'custom', path: ['answer'], message: `answer "${v.answer}" is not one of the option ids (${v.options.map((o) => o.id).join(', ')})` })
  })
const trueFalseItem = z.object({ ...itemCommon, kind: z.literal('true-false'), answer: z.boolean({ error: 'answer is true or false (a JSON boolean)' }), why: text('why').optional() })
const multiSelectItem = z
  .object({ ...itemCommon, kind: z.literal('multi-select'), options: z.array(option).min(3, 'a multi-select has at least 3 options').max(8), answers: ids('answers').min(1, 'name at least one right option') })
  .superRefine((v, ctx) => {
    uniqueIds(v.options, 'options', ctx, 'option')
    for (const a of v.answers) if (!v.options.some((o) => o.id === a)) ctx.addIssue({ code: 'custom', path: ['answers'], message: `answer "${a}" is not one of the option ids (${v.options.map((o) => o.id).join(', ')})` })
    if (new Set(v.answers).size >= v.options.length) ctx.addIssue({ code: 'custom', path: ['answers'], message: 'every option is right: a multi-select needs at least one wrong option' })
  })
const clozeItem = z
  .object({
    ...itemCommon,
    kind: z.literal('cloze'),
    text: text('the cloze text'),
    gaps: z.array(z.object({ id: ident, accepted: z.array(text('an accepted answer')).min(1, 'a gap needs its answer in accepted (the first is the canonical one)'), bank: z.array(text('a bank word')).optional() })).min(1, 'a cloze has at least one gap')
  })
  .superRefine((v, ctx) => {
    uniqueIds(v.gaps, 'gaps', ctx, 'gap')
    for (const g of v.gaps) if (!v.text.includes(`{{${g.id}}}`)) ctx.addIssue({ code: 'custom', path: ['text'], message: `the text has no {{${g.id}}} marker for the gap "${g.id}"` })
    for (const m of v.text.matchAll(/\{\{([^{}]*)\}\}/g)) if (!v.gaps.some((g) => g.id === m[1])) ctx.addIssue({ code: 'custom', path: ['text'], message: `the marker {{${m[1]}}} in the text has no gap` })
  })
const typedItem = z.object({ ...itemCommon, kind: z.literal('typed'), accepted: z.array(text('an accepted answer')).min(1, 'give the accepted answers (the first is the canonical one)') })
const matchPairsItem = z
  .object({ ...itemCommon, kind: z.literal('match-pairs'), pairs: z.array(z.object({ id: ident, left: text('left'), right: text('right') })).min(2, 'at least 2 pairs').max(8, 'at most 8 pairs') })
  .superRefine((v, ctx) => uniqueIds(v.pairs, 'pairs', ctx, 'pair'))
const orderItem = z
  .object({ ...itemCommon, kind: z.literal('order'), items: z.array(z.object({ id: ident, text: text('a step text'), when: text('when').optional() })).min(2, 'at least 2 items').max(10, 'at most 10 items'), timeline: z.boolean().optional() })
  .superRefine((v, ctx) => uniqueIds(v.items, 'items', ctx, 'step'))
const sortGroupsItem = z
  .object({
    ...itemCommon,
    kind: z.literal('sort-groups'),
    groups: z.array(z.object({ id: ident, title: text('a group title') })).min(2, 'at least 2 groups').max(5, 'at most 5 groups'),
    items: z.array(z.object({ id: ident, text: text('an entry text'), group: ident, why: text('why').optional() })).min(2).max(12, 'at most 12 entries')
  })
  .superRefine((v, ctx) => {
    uniqueIds(v.groups, 'groups', ctx, 'group')
    uniqueIds(v.items, 'items', ctx, 'entry')
    for (const it of v.items) if (!v.groups.some((g) => g.id === it.group)) ctx.addIssue({ code: 'custom', path: ['items'], message: `the entry "${it.id}" names the group "${it.group}", which is not one of the groups (${v.groups.map((g) => g.id).join(', ')})` })
    for (const g of v.groups) if (!v.items.some((it) => it.group === g.id)) ctx.addIssue({ code: 'custom', path: ['groups'], message: `the group "${g.id}" has no entry` })
  })
const flashcardItem = z.object({ ...itemCommon, kind: z.literal('flashcard'), back: text('the back of the card') })

export const authoredItemSchema = z.discriminatedUnion('kind', [mcqItem, trueFalseItem, multiSelectItem, clozeItem, typedItem, matchPairsItem, orderItem, sortGroupsItem, flashcardItem], {
  error: 'every item needs a kind: mcq, true-false, multi-select, cloze, typed, match-pairs, order, sort-groups or flashcard'
})
export type AuthoredItem = z.output<typeof authoredItemSchema>

export const itemsSchema = lenient(z.object({ items: z.array(authoredItemSchema).min(1, 'write at least one item') }))
export type ItemsOutput = z.output<typeof itemsSchema>

export interface ItemContext {
  /** The objectives the items may name (all of the course, or of the unit). */
  objectives: { id: string; unit: string }[]
  factIds: Iterable<string>
  /** `item_kinds` of the format. */
  allowedKinds: readonly string[]
  /** Items of this unit: every objective of the unit needs its items. */
  unit?: string
  /** Item ids already used elsewhere. */
  existingIds?: Iterable<string>
  /** At least this many items for each objective (the format's `items_per_objective`; never below 2). */
  itemsPerObjective?: number
  /** Every wrong option has its `why` (after the misconception-designer; the lint wants it). */
  requireWhy?: boolean
}

const choiceOptions = (it: AuthoredItem): { id: string; text: string; why?: string; right: boolean }[] =>
  it.kind === 'mcq' ? it.options.map((o) => ({ ...o, right: o.id === it.answer })) : it.kind === 'multi-select' ? it.options.map((o) => ({ ...o, right: it.answers.includes(o.id) })) : []

/**
 * What a schema cannot see: ids unique and not used elsewhere, the objective exists (and belongs to the unit), the facts exist, the kind is
 * allowed, every objective of the unit has enough items in at least two different forms, no two options read the same, no distractor reads
 * like the right answer, a bank word is not a second answer, and (with `requireWhy`) every wrong option has its `why`.
 */
export function checkItems(items: AuthoredItem[], o: ItemContext): Problem[] {
  const out: Problem[] = []
  const facts = new Set(o.factIds)
  const existing = new Set(o.existingIds ?? [])
  const objectives = new Map(o.objectives.map((x) => [x.id, x.unit]))
  for (const d of dups(items.map((i) => i.id))) out.push(problem(d, 'this item id is used twice'))
  for (const it of items) {
    if (existing.has(it.id)) out.push(problem(it.id, 'this item id is already used by another item', 'use a new, unique id'))
    if (!o.allowedKinds.includes(it.kind)) out.push(problem(it.id, `the kind "${it.kind}" is not allowed for this course`, `use one of: ${o.allowedKinds.join(', ')}`))
    const unit = objectives.get(it.objective)
    if (unit === undefined) out.push(problem(it.id, `its objective "${it.objective}" does not exist`, `use one of: ${[...objectives.keys()].join(', ')}`))
    else if (o.unit && unit !== o.unit) out.push(problem(it.id, `its objective "${it.objective}" belongs to the unit "${unit}", these items are for "${o.unit}"`, `use an objective of ${o.unit}: ${[...objectives].filter(([, u]) => u === o.unit).map(([k]) => k).join(', ')}`))
    for (const f of [...it.facts, ...(it.didYouKnowFact ? [it.didYouKnowFact] : [])]) if (!facts.has(f)) out.push(problem(it.id, `it names the fact ${f}, which is not in the fact base`, 'use only fact ids that were given'))
    const opts = choiceOptions(it)
    if (opts.length) {
      const seen = new Map<string, string>()
      for (const x of opts) {
        const n = norm(x.text)
        const first = seen.get(n)
        if (first !== undefined) out.push(problem(it.id, `the options "${first}" and "${x.id}" read the same ("${x.text}")`, 'every option must be different'))
        else seen.set(n, x.id)
      }
      if (o.requireWhy) for (const x of opts) if (!x.right && !x.why) out.push(problem(it.id, `the wrong option "${x.id}" has no why`, 'every wrong option needs the misconception it stands for'))
      if (it.kind === 'mcq' && opts.filter((x) => !x.right).length < 2) out.push(problem(it.id, 'an mcq needs at least 2 wrong options', 'add distractors'))
    }
    if (it.kind === 'cloze') {
      for (const g of it.gaps) {
        const accepted = g.accepted.map(norm)
        for (const b of g.bank ?? []) if (accepted.includes(norm(b)) && b !== g.accepted[0]) out.push(problem(it.id, `the bank word "${b}" of gap "${g.id}" is also an accepted answer`, 'a bank holds one right word and wrong ones'))
      }
    }
  }
  const forObjective = (id: string) => items.filter((i) => i.objective === id)
  const wanted = Math.max(2, o.itemsPerObjective ?? 2)
  for (const [oid, unit] of objectives) {
    if (o.unit && unit !== o.unit) continue
    const mine = forObjective(oid)
    const forms = new Set(mine.map((i) => formOf(i)))
    if (mine.length === 0) out.push(problem(oid, 'this objective has no item', `write at least ${wanted} items for it, in at least two different kinds`))
    else if (mine.length < wanted) out.push(problem(oid, `only ${mine.length} item(s) for this objective, the course wants ${wanted}`, 'add items in other kinds'))
    else if (forms.size < 2) out.push(problem(oid, `every item for this objective is "${[...forms][0]}": it needs at least two different kinds`, 'add an item of another kind (for example a true-false, a cloze or a match-pairs)'))
  }
  return out
}

// ---- misconception-designer: distractors ----

export const distractorsSchema = lenient(
  z.object({
    items: z
      .array(
        z.object({
          id: ident,
          options: z.array(z.object({ id: ident, text: text('an option text'), why: text('the why of an option (the misconception it stands for)').optional() })).optional(),
          why: text('why').optional()
        })
      )
      .min(1, 'return the choice items')
  })
)
export type DistractorsOutput = z.output<typeof distractorsSchema>

/**
 * The designer returns, for each mcq and multi-select item, its full option list: the right options unchanged (same id, same text) and the
 * wrong ones rewritten from real misconceptions, each with its `why`; for a true-false item, the `why`. Every mcq and multi-select item must
 * be covered.
 */
export function checkDistractors(items: AuthoredItem[], out: DistractorsOutput): Problem[] {
  const problems: Problem[] = []
  const byId = new Map(items.map((i) => [i.id, i]))
  const seen = new Set<string>()
  for (const d of out.items) {
    const it = byId.get(d.id)
    if (!it) {
      problems.push(problem(d.id, 'no such item', 'return only items you were given'))
      continue
    }
    seen.add(d.id)
    if (it.kind === 'true-false') {
      if (d.options) problems.push(problem(d.id, 'a true-false item has no options', 'give only why: the misconception behind the wrong choice'))
      if (!d.why) problems.push(problem(d.id, 'a true-false item needs its why', 'say the misconception behind the wrong choice'))
      continue
    }
    if (it.kind !== 'mcq' && it.kind !== 'multi-select') {
      problems.push(problem(d.id, `a ${it.kind} item has no distractors to write`, 'leave it out'))
      continue
    }
    if (!d.options) {
      problems.push(problem(d.id, 'the options are missing', 'give the full list of options, each with id, text and why'))
      continue
    }
    for (const x of dups(d.options.map((o) => o.id))) problems.push(problem(d.id, `the option id "${x}" is used twice`))
    const rightIds = it.kind === 'mcq' ? [it.answer] : it.answers
    for (const rid of rightIds) {
      const was = (it.options.find((o) => o.id === rid))!
      const now = d.options.find((o) => o.id === rid)
      if (!now) problems.push(problem(d.id, `the right option "${rid}" is missing`, 'keep every right option exactly as it was'))
      else if (norm(now.text) !== norm(was.text)) problems.push(problem(d.id, `the right option "${rid}" was changed from "${was.text}" to "${now.text}"`, 'keep every right option exactly as it was'))
    }
    const wrong = d.options.filter((o) => !rightIds.includes(o.id))
    if (it.kind === 'mcq' && wrong.length < 2) problems.push(problem(d.id, `${wrong.length} wrong option(s): an mcq needs at least 2`, 'write 2 to 4 distractors'))
    if (it.kind === 'multi-select' && wrong.length < 1) problems.push(problem(d.id, 'no wrong option: a multi-select needs at least one', 'write distractors'))
    for (const o of wrong) if (!o.why) problems.push(problem(d.id, `the wrong option "${o.id}" has no why`, 'every wrong option needs the misconception it stands for'))
    const texts = new Map<string, string>()
    for (const o of d.options) {
      const n = norm(o.text)
      if (texts.has(n)) problems.push(problem(d.id, `the options "${texts.get(n)}" and "${o.id}" read the same`, 'every option must be different'))
      else texts.set(n, o.id)
    }
  }
  for (const it of items) if ((it.kind === 'mcq' || it.kind === 'multi-select') && !seen.has(it.id)) problems.push(problem(it.id, 'this item was not covered', 'return its full option list with a why for every wrong option'))
  return problems
}

/** The items with the designer's options and whys (call it after `checkDistractors` found nothing). An item the designer did not mention is unchanged. */
export function applyDistractors(items: AuthoredItem[], out: DistractorsOutput): AuthoredItem[] {
  const byId = new Map(out.items.map((d) => [d.id, d]))
  return items.map((it) => {
    const d = byId.get(it.id)
    if (!d) return it
    if (it.kind === 'true-false') return d.why ? { ...it, why: d.why } : it
    if ((it.kind === 'mcq' || it.kind === 'multi-select') && d.options) {
      const rightIds = it.kind === 'mcq' ? [it.answer] : it.answers
      return { ...it, options: d.options.map((o) => (rightIds.includes(o.id) ? { id: o.id, text: o.text } : { id: o.id, text: o.text, why: o.why })) }
    }
    return it
  })
}

// ---- explainer: explain, polish ----

export const explainSchema = lenient(
  z.object({
    items: z
      .array(z.object({ id: ident, explanation: text('the explanation'), hint: text('the hint').optional(), didYouKnow: text('didYouKnow').optional(), didYouKnowFact: ident.optional() }))
      .min(1, 'return the items')
  })
)
export type ExplainOutput = z.output<typeof explainSchema>

/** Every item is covered, a `didYouKnow` names an existing fact (`didYouKnowFact`), ids exist. */
export function checkExplain(items: AuthoredItem[], out: ExplainOutput, factIds: Iterable<string>): Problem[] {
  const problems: Problem[] = []
  const facts = new Set(factIds)
  const ids = new Set(items.map((i) => i.id))
  for (const d of out.items) {
    if (!ids.has(d.id)) problems.push(problem(d.id, 'no such item', 'return only items you were given'))
    if (d.didYouKnow && !d.didYouKnowFact) problems.push(problem(d.id, 'a didYouKnow must name the fact it rests on', 'set didYouKnowFact to a fact id'))
    if (d.didYouKnowFact && !facts.has(d.didYouKnowFact)) problems.push(problem(d.id, `didYouKnowFact "${d.didYouKnowFact}" is not in the fact base`, 'use a fact id that was given'))
    if (d.didYouKnowFact && !d.didYouKnow) problems.push(problem(d.id, 'didYouKnowFact without didYouKnow', 'write the didYouKnow text or drop the fact'))
  }
  for (const d of dups(out.items.map((i) => i.id))) problems.push(problem(d, 'this item is returned twice'))
  for (const it of items) if (!out.items.some((d) => d.id === it.id)) problems.push(problem(it.id, 'this item was not covered', 'return an explanation for every item'))
  return problems
}

/** The explainer's explanation, hint and hook replace the writer's; a hook's fact joins the item's facts. */
export function applyExplain(items: AuthoredItem[], out: ExplainOutput): AuthoredItem[] {
  const byId = new Map(out.items.map((d) => [d.id, d]))
  return items.map((it) => {
    const d = byId.get(it.id)
    if (!d) return it
    const next: AuthoredItem = { ...it, explanation: d.explanation }
    if (d.hint) next.hint = d.hint
    if (d.didYouKnow && d.didYouKnowFact) {
      next.didYouKnow = d.didYouKnow
      next.didYouKnowFact = d.didYouKnowFact
    }
    return next
  })
}

export const polishSchema = lenient(z.object({ strings: z.record(z.string(), z.string(), { error: 'strings is an object: text key -> corrected text' }) }))

/** Keeps only the keys a reviewer flagged (anything else is dropped) and drops empty texts. */
export function applyPolish(strings: Record<string, string>, allowedKeys: Iterable<string>): { kept: Record<string, string>; dropped: string[] } {
  const allowed = new Set(allowedKeys)
  const kept: Record<string, string> = {}
  const dropped: string[] = []
  for (const [k, v] of Object.entries(strings)) {
    if (allowed.has(k) && v.trim()) kept[k] = v.trim()
    else dropped.push(k)
  }
  return { kept, dropped }
}

// ---- revising: only the flagged ids change ----

/**
 * A revise round: the writer returns the corrected entries (by id). Only entries named in `flagged` are replaced; a change to any other entry is
 * ignored; a flagged entry that is not returned is a problem. The result keeps the order of `previous`.
 */
export function mergeRevision<T extends { id: string }>(previous: T[], revised: T[], flagged: Iterable<string>): { merged: T[]; problems: Problem[]; replaced: string[] } {
  const want = new Set(flagged)
  const byId = new Map(revised.map((r) => [r.id, r]))
  const problems: Problem[] = []
  const replaced: string[] = []
  const merged = previous.map((p) => {
    if (!want.has(p.id)) return p
    const r = byId.get(p.id)
    if (!r) {
      problems.push(problem(p.id, 'it was flagged but not returned', 'return the corrected version of every flagged entry'))
      return p
    }
    replaced.push(p.id)
    return r
  })
  return { merged, problems, replaced }
}

// ---- game-designer: design ----

/**
 * The shells the pipeline switches on by itself: the quiz arena and the three that build an automatic layout from the units (EGS-10 to EGS-12).
 * The language role-play and the detective need authored sections (dialogues, cases) that no role writes yet, so they are only recorded as
 * requested (`extensions.pipeline.requestedShells`) and the course does not enable them.
 */
export const PIPELINE_SHELLS = ['quiz-arena', 'encyclopedia', 'mindmaze', 'rpg'] as const

export const designSchema = lenient(
  z.object({
    shells: z.array(z.string()).min(1, 'name at least one shell'),
    quizArena: z.object({ roundLength: z.number().int(), bossLength: z.number().int(), timerSeconds: z.number().int().optional() }),
    difficulty: z.array(z.object({ item: ident, difficulty: z.number().int() })).default([]),
    notes: z.string().default('')
  })
)
export type Design = z.output<typeof designSchema>

export interface DesignData {
  /** The shells that are switched on (known ones only; the quiz arena is always in). */
  enabled: string[]
  /** Shells asked for that need an authored section (or do not exist): recorded in `extensions.pipeline.requestedShells`, not enabled. */
  requested: string[]
  quizArena: { roundLength: number; bossLength: number; timerSeconds?: number }
  difficulty: Record<string, number>
  notes: string
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)))

/** The design clamped to the player's limits (round 3 to 12, boss 4 to 20, timer 5 to 120 s, difficulty 1 to 5), known shells kept, unknown item ids dropped. */
export function normalizeDesign(d: Design, itemIds: Iterable<string>): DesignData {
  const items = new Set(itemIds)
  const shells = [...new Set(d.shells.map((s) => s.trim()).filter(Boolean))]
  const enabled = [...new Set(['quiz-arena', ...shells.filter((s) => (PIPELINE_SHELLS as readonly string[]).includes(s))])]
  return {
    enabled,
    requested: shells.filter((s) => !(PIPELINE_SHELLS as readonly string[]).includes(s)),
    quizArena: {
      roundLength: clamp(d.quizArena.roundLength, 3, 12),
      bossLength: clamp(d.quizArena.bossLength, 4, 20),
      ...(d.quizArena.timerSeconds !== undefined ? { timerSeconds: clamp(d.quizArena.timerSeconds, 5, 120) } : {})
    },
    difficulty: Object.fromEntries(d.difficulty.filter((x) => items.has(x.item)).map((x) => [x.item, clamp(x.difficulty, 1, 5)])),
    notes: d.notes.trim()
  }
}

// ---- narrative-designer: frame, scriptorium_brief ----

export const frameSchema = lenient(
  z.object({
    premise: text('the premise'),
    characters: z.array(z.object({ name: text('a name'), role: text('a role'), description: text('a description') })).min(1, 'give at least one character'),
    intro: text('the intro'),
    outro: text('the outro'),
    unitBeats: z.array(z.object({ unit: ident, beat: text('a beat') })).default([])
  })
)
export type Frame = z.output<typeof frameSchema>

export function checkFrame(f: Frame, unitIds: Iterable<string>): Problem[] {
  const known = new Set(unitIds)
  const out: Problem[] = []
  for (const b of f.unitBeats) if (!known.has(b.unit)) out.push(problem(b.unit, 'no such unit', `use one of: ${[...known].join(', ')}`))
  for (const u of known) if (!f.unitBeats.some((b) => b.unit === u)) out.push(problem(u, 'the unit has no beat', 'give one beat for every unit'))
  return out
}

export const scriptoriumBriefSchema = lenient(z.object({ idea: text('the idea'), audience: text('the audience'), length: text('the length') }))
export type ScriptoriumBrief = z.output<typeof scriptoriumBriefSchema>

// ---- playtester: report ----

export const playtestReportSchema = z.preprocess(normalizeReviewJson, reviewBodyFor('playtester').extend({ deadEnds: z.array(z.string()).default([]) }))
export type PlaytestReport = z.output<typeof playtestReportSchema>

// ---- publisher: publish ----

export const publishSchema = lenient(z.object({ blurb: text('the blurb'), notes: z.string().default('') }))
export type PublishOutput = z.output<typeof publishSchema>

// ---- what each prompt is given ----

/**
 * The variables each seeded prompt (`prompts/<role>/<task>.md`) uses: the contract between a handler and its template. A test checks that
 * every `{{var}}` of a template is listed here and every listed variable is used by the template.
 */
export const PROMPT_VARS = {
  'director/plan_brief': ['topic', 'audience', 'age', 'level', 'language', 'units', 'questions_per_unit', 'format_label', 'notes'],
  'curriculum-designer/curriculum': ['title', 'summary', 'audience', 'age', 'level', 'language', 'units', 'objectives_per_unit', 'unit_plan', 'factbase', 'notes'],
  'language-coach/scope': ['title', 'audience', 'cefr', 'language', 'target_language', 'units', 'objectives', 'factbase'],
  'language-coach/accepted': ['title', 'cefr', 'language', 'target_language', 'items'],
  'subject-expert/articles': ['title', 'audience', 'age', 'level', 'language', 'unit_id', 'unit_title', 'unit_summary', 'objectives', 'factbase', 'articles_per_unit', 'article_id_prefix', 'other_articles', 'scope'],
  'subject-expert/articles_revise': ['title', 'audience', 'age', 'level', 'language', 'unit_id', 'factbase', 'articles', 'problems'],
  'item-writer/items': ['title', 'audience', 'age', 'level', 'language', 'unit_id', 'unit_title', 'objectives', 'factbase', 'articles', 'item_kinds', 'items_per_objective', 'item_id_prefix', 'scope', 'target_language', 'gap_marker'],
  'item-writer/items_revise': ['title', 'audience', 'age', 'level', 'language', 'unit_id', 'objectives', 'factbase', 'item_kinds', 'items', 'problems', 'target_language', 'gap_marker'],
  'misconception-designer/distractors': ['title', 'audience', 'age', 'level', 'language', 'unit_id', 'factbase', 'items'],
  'explainer/explain': ['title', 'audience', 'age', 'level', 'language', 'unit_id', 'factbase', 'items'],
  'explainer/polish': ['title', 'audience', 'age', 'level', 'language', 'strings', 'problems'],
  'game-designer/design': ['title', 'audience', 'age', 'units', 'item_summary', 'shells_available', 'notes'],
  'narrative-designer/frame': ['title', 'topic', 'audience', 'age', 'language', 'units', 'notes'],
  'narrative-designer/scriptorium_brief': ['title', 'topic', 'audience', 'age', 'language', 'units', 'notes'],
  'art-director/plan': ['title', 'subject', 'audience', 'age', 'language', 'style', 'style_words', 'units', 'articles', 'items', 'slots', 'max_item_images', 'characters', 'shells'],
  'art-critic/review': ['title', 'asset_id', 'kind', 'target', 'prompt', 'alt', 'style', 'round', 'scores_example'],
  'composer/plan': ['title', 'subject', 'audience', 'age', 'language', 'style', 'units', 'areas', 'events', 'moods', 'chips', 'chip', 'sounds', 'min_seconds', 'max_seconds', 'shells', 'sfx_engine'],
  'voice-director/plan': ['title', 'subject', 'audience', 'age', 'language', 'source_lang', 'target_lang', 'target_language', 'units', 'narration', 'candidates', 'listening', 'max_narration', 'per_unit'],
  'translator/edition': ['title', 'audience', 'source_language', 'edition_language', 'gap_marker', 'taught_note', 'entries'],
  'playtester/report': ['title', 'audience', 'age', 'units', 'personas', 'lint', 'scores_example'],
  'accessibility-reviewer/review': ['title', 'round', 'audience', 'age', 'level', 'language', 'content', 'scores_example'],
  'child-safety-reviewer/review': ['title', 'round', 'audience', 'age', 'language', 'content', 'scores_example'],
  'publisher/publish': ['title', 'audience', 'language', 'score', 'reviews', 'units']
} as const satisfies Record<string, readonly string[]>

/** The fact base as the prompts show it. */
export const factbaseText = (facts: Fact[]): string => factLines(facts) || '(the fact base is empty)'
