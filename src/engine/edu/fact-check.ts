import type { JobContext } from '../queue/scheduler'
import { runReview } from '../review/scoring'
import type { ReviewProblem, ReviewResult } from '../review/scoring'
import { citedFactIds, factLines, sourceLines } from './factbase'
import type { Fact, SourceEntry } from './factbase'

/**
 * The fact-checker review (a must-pass gate). Two layers: a deterministic check of the references (`factCheckRefs`: every item and article
 * names facts that exist, and the text cites only facts that exist), whose problems force `revise` whatever the model says; and the
 * fact-checker role's read of the content against the fact base (`factCheck`). The unit-level job that calls it is wired in EGS-08.
 */

/** An article of a unit, as text: its body cites facts as `[f3]`. */
export interface FactCheckArticle {
  id: string
  title?: string
  body: string
  /** The fact ids the article lists as its citations, when it has that list apart from the text. */
  citations?: string[]
}

/** An item of a unit: the fact ids it rests on and the item rendered as text (prompt, options with the right one marked, explanation). */
export interface FactCheckItem {
  id: string
  kind?: string
  facts: string[]
  text: string
}

export interface FactCheckUnit {
  articles: FactCheckArticle[]
  items: FactCheckItem[]
}

const problem = (ref: string, issue: string, fix?: string): ReviewProblem => ({ ref, issue, ...(fix ? { fix } : {}), severity: 'major' })

/**
 * The reference checks that need no model: every item names at least one fact and only facts that exist; every article cites at least one
 * fact (in its text or its `citations`) and only facts that exist. Returns the problems, `ref` = the item or article id.
 */
export function factCheckRefs(factIds: Iterable<string>, unit: FactCheckUnit): ReviewProblem[] {
  const known = new Set(factIds)
  const out: ReviewProblem[] = []
  for (const item of unit.items) {
    const ids = [...new Set(item.facts)]
    if (ids.length === 0) out.push(problem(item.id, 'the item names no fact it rests on', 'add the id of the fact base fact the answer rests on (extensions.facts)'))
    for (const id of ids) if (!known.has(id)) out.push(problem(item.id, `the item names the fact ${id}, which is not in the fact base`, 'use a fact id from the fact base, or drop the item'))
  }
  for (const art of unit.articles) {
    const cited = [...new Set([...citedFactIds(art.body), ...(art.citations ?? [])])]
    if (cited.length === 0) out.push(problem(art.id, 'the article cites no fact', 'cite the facts it rests on as [f1] in the text'))
    for (const id of cited) if (!known.has(id)) out.push(problem(art.id, `the article cites the fact ${id}, which is not in the fact base`, 'cite only facts that are in the fact base'))
  }
  return out
}

/** The articles and items of a unit as the text the fact-checker reads, each with its id. */
export function renderUnit(unit: FactCheckUnit): string {
  const articles = unit.articles.map((a) => `### Article ${a.id}${a.title ? `: ${a.title}` : ''}\n${a.body.trim()}`)
  const items = unit.items.map((i) => `### Item ${i.id}${i.kind ? ` (${i.kind})` : ''}\nFacts it rests on: ${i.facts.length ? i.facts.map((f) => `[${f}]`).join(' ') : '(none)'}\n${i.text.trim()}`)
  return [...articles, ...items].join('\n\n') || '(nothing to check)'
}

export interface FactCheckInput {
  dataDir: string
  /** The course title, for the prompt. */
  title: string
  /** The review round (1 for the first). */
  round: number
  /** The fact base: the facts and the numbered sources. */
  facts: Fact[]
  sources: SourceEntry[]
  unit: FactCheckUnit
}

/**
 * The fact-checker's review of one unit: the reference check first, then the model reads every article and item against the fact base.
 * The result is `revise` when either finds a problem; the reference problems come first in `problems`. The model is always asked, so the
 * writer gets the semantic findings together with the structural ones in one round.
 */
export async function factCheck(ctx: JobContext, input: FactCheckInput): Promise<ReviewResult> {
  const structural = factCheckRefs(input.facts.map((f) => f.id), input.unit)
  const review = await runReview(ctx, {
    role: 'fact-checker',
    task: 'fact_check',
    dataDir: input.dataDir,
    vars: {
      title: input.title,
      round: input.round,
      factbase: factLines(input.facts) || '(the fact base is empty)',
      sources: sourceLines(input.sources) || '(no sources)',
      coverage: structural.length ? structural.map((p) => `- ${p.ref}: ${p.issue}`).join('\n') : '(no problems found by the script)',
      content: renderUnit(input.unit)
    }
  })
  if (structural.length === 0) return review
  const notes = `${structural.length} reference problem(s) found by the script. ${review.notes}`.trim()
  return { ...review, verdict: 'revise', notes, problems: [...structural, ...review.problems.filter((p) => !structural.some((s) => s.ref === p.ref && s.issue === p.issue))] }
}
