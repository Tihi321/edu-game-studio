import { z } from 'zod'
import { AUDIO_KINDS, IMAGE_KINDS } from '../../shared/media'
import { languageInfo } from '../../shared/languages'
import type { ResolvedBrief } from '../../shared/brief'
import type { TextCatalog } from '../../shared/course'
import { loadCourseFolder } from './course-io'
import type { VoiceGenerateResult } from './voice-service'
import type { HandlerOptions, JobContext, Scheduler } from '../queue/scheduler'
import type { JobFile } from '../queue/jobs'
import { countsAsRevise, runReview, scoresExample } from '../review/scoring'
import type { ReviewResult } from '../review/scoring'
import { assembleCourse, renderCourseForReview } from './assemble'
import { applyEdition, checkEdition, chunkEntries, editionEntries, editionSchema } from './editions'
import {
  acceptedSchema,
  applyDistractors,
  applyPolish,
  articlesSchema,
  askRole,
  checkAccepted,
  checkArticles,
  checkCurriculum,
  checkDistractors,
  checkExplain,
  checkFrame,
  checkItems,
  checkPlan,
  checkScope,
  curriculumSchema,
  designSchema,
  distractorsSchema,
  explainSchema,
  formatProblems,
  frameSchema,
  GAP_MARKER,
  itemsSchema,
  mergeRevision,
  normalizeDesign,
  objectiveLines,
  planSchema,
  playtestReportSchema,
  polishSchema,
  publishSchema,
  scopeSchema,
  scriptoriumBriefSchema,
  unitLines
} from './authoring'
import type { AcceptedOutput, Article, AuthoredItem, Curriculum, DesignData, ExplainOutput, Frame, Problem } from './authoring'
import { factbaseText } from './authoring'
import { factCheck } from './fact-check'
import type { FactCheckItem } from './fact-check'
import { playtestDigest } from './playtest'
import type { PlaytestResult } from './playtest'
import { editionLanguages, stepKey } from './pipeline'
import type { Pipeline, ReviewFile, StepsFile } from './pipeline'
import type { EduService } from './service'

/**
 * The job handlers of the content pipeline (EGS-08), one per task. Each reads its inputs from the files of the course (`pipeline/`), asks its
 * role (`askRole`: the prompt, the JSON schema, the checks and one repair round), writes its output file, marks its step done in `steps.json`
 * and calls `Pipeline.advance`, which enqueues what can run next. A job that belongs to an earlier run (after a restart) does nothing.
 */

const langName = (code: string): string => languageInfo(code)?.name ?? code

interface H {
  ctx: JobContext
  slug: string
  unit: string | null
  round: number
  st: StepsFile
  R: ResolvedBrief
}

interface Done {
  note: string
  path?: string
  /** How the step ends (default done): skipped (a reason, the run goes on) or blocked (a gate failed: the run stops). */
  status?: 'done' | 'skipped' | 'blocked'
}

/** The items as the prompts show them: a JSON array, one item per line. */
export const itemsJson = (items: readonly unknown[]): string => (items.length ? `[\n${items.map((i) => JSON.stringify(i)).join(',\n')}\n]` : '[]')

/** An item as text for the fact-checker: the question, every option with the right ones marked, the key and the explanation. */
export function renderItemForCheck(it: AuthoredItem): FactCheckItem {
  const lines: string[] = [`Question: ${it.prompt}`]
  switch (it.kind) {
    case 'mcq':
      for (const o of it.options) lines.push(`- ${o.id}: ${o.text}${o.id === it.answer ? ' (RIGHT)' : ''}`)
      break
    case 'multi-select':
      for (const o of it.options) lines.push(`- ${o.id}: ${o.text}${it.answers.includes(o.id) ? ' (RIGHT)' : ''}`)
      break
    case 'true-false':
      lines.push(`Answer: ${it.answer ? 'true' : 'false'}`)
      break
    case 'cloze':
      lines.push(`Text: ${it.text}`, ...it.gaps.map((g) => `Gap ${g.id}: ${g.accepted.join(' | ')}${g.bank ? ` (word bank: ${g.bank.join(', ')})` : ''}`))
      break
    case 'typed':
      lines.push(`Accepted answers: ${it.accepted.join(' | ')}`)
      break
    case 'match-pairs':
      lines.push(...it.pairs.map((p) => `Pair: ${p.left} = ${p.right}`))
      break
    case 'order':
      lines.push('Correct order:', ...it.items.map((x, i) => `${i + 1}. ${x.text}${x.when ? ` (${x.when})` : ''}`))
      break
    case 'sort-groups':
      lines.push(...it.groups.map((g) => `Group ${g.title}: ${it.items.filter((x) => x.group === g.id).map((x) => x.text).join(', ')}`))
      break
    case 'conjugation':
      lines.push(`Verb: ${it.verb} (${it.tense})`, ...it.forms.map((f) => `${f.person}: ${f.accepted.join(' | ')}${it.given?.includes(f.person) ? ' (given)' : ''}`))
      break
    case 'flashcard':
      lines.push(`Back: ${it.back}`)
      break
  }
  lines.push(`Explanation: ${it.explanation}`)
  return { id: it.id, kind: it.kind, facts: it.facts, text: lines.join('\n') }
}

/** The choice items that still need distractors written: an mcq or multi-select with a wrong option without its why. */
export function needsDistractors(items: readonly AuthoredItem[]): AuthoredItem[] {
  return items.filter((it) => {
    if (it.kind === 'mcq') return it.options.some((o) => o.id !== it.answer && !o.why)
    if (it.kind === 'multi-select') return it.options.some((o) => !it.answers.includes(o.id) && !o.why)
    return false
  })
}

/** What the misconception-designer is asked about: the choice items without their reasons, and (first round) the true-false items without theirs. */
export const distractorTargets = (items: readonly AuthoredItem[], round: number): AuthoredItem[] => [...needsDistractors(items), ...items.filter((i) => i.kind === 'true-false' && !i.why && round <= 1)]

export function registerPipelineHandlers(sched: Scheduler, svc: EduService): void {
  const P: Pipeline = svc.pipeline
  const d = svc.deps
  const dataDir = d.dataDir

  /** Registers a pipeline task: the job's own work, then the step is marked done and the pipeline advances. */
  const step = (task: string, fn: (h: H) => Promise<Done>, opts: HandlerOptions = {}): void => {
    sched.register(
      task,
      async (ctx) => {
        const slug = ctx.job.book
        if (!slug) throw new Error(`the ${task} job has no course`)
        const st = await P.requireSteps(slug)
        const run = /--r(\d+)$/.exec(ctx.job.id)?.[1]
        if (run !== undefined && Number(run) !== st.run) return { result: `skipped: the job belongs to run ${run}, the course is at run ${st.run}` }
        const unit = ctx.job.unit && ctx.job.unit !== 'all' ? ctx.job.unit : null
        const round = ctx.job.round > 0 ? ctx.job.round : 1
        // the step was finished already (the engine stopped right after it, so the job came back): nothing to redo
        const finished = st.steps[stepKey(task, unit, round)]?.status
        if (finished === 'done' || finished === 'skipped' || finished === 'blocked') {
          await P.advanceSafe(slug)
          return { result: `already ${finished}: nothing to do` }
        }
        const out = await fn({ ctx, slug, unit, round, st, R: st.resolved })
        const key = stepKey(task, unit, round)
        if (out.status === 'blocked') await P.markBlocked(slug, key, out.note)
        else if (out.status === 'skipped') await P.markSkipped(slug, key, out.note)
        else await P.markDone(slug, key, { job: ctx.job.id, round, note: out.note, ...(ctx.model ? { family: ctx.model.family, model: ctx.model.ref } : {}) })
        await P.advanceSafe(slug)
        return { result: out.note, ...(out.path ? { resultPath: out.path } : {}) }
      },
      opts
    )
  }

  // the researcher's job (EGS-06) is registered by the service; when it finishes, the pipeline marks the question and goes on
  svc.afterResearch = async (slug, jobId) => {
    const st = await P.readSteps(slug)
    const key = `research:${jobId.split('--')[2]}`
    if (!st || !(key in st.steps)) return
    await P.markDone(slug, key, { job: jobId })
    await P.advanceSafe(slug)
  }

  // ---- helpers over the files ----

  const common = async (h: Pick<H, 'slug' | 'R'>) => {
    const plan = await P.readJson<{ title: string; summary: string; units: { title: string; focus: string }[] }>(h.slug, 'plan.json')
    const b = h.R.brief
    return {
      plan,
      vars: {
        title: plan?.title ?? b.topic,
        audience: b.audience,
        age: b.age ?? 'not given',
        level: b.level ?? h.R.cefr ?? 'general',
        language: langName(b.sourceLang)
      }
    }
  }
  const curriculumOf = async (slug: string): Promise<Curriculum> => {
    const c = await P.curriculum(slug)
    if (!c) throw new Error('there is no curriculum yet')
    return c
  }
  const factsOf = async (slug: string) => (await svc.factbase.get(slug))
  const unitScope = async (slug: string, unit: string): Promise<string> => {
    const scope = await P.readJson<{ units: { unit: string; vocabulary: { term: string; gloss: string }[]; verbs?: { inf: string; tense: string; level: string }[]; grammar: string[] }[] }>(slug, 'scope.json')
    const u = scope?.units.find((x) => x.unit === unit)
    if (!u) return '(none)'
    const verbs = u.verbs?.length ? `Verbs (a verb unit; write conjugation or verb items on these): ${u.verbs.map((v) => `${v.inf} (${v.tense}, ${v.level})`).join('; ')}\n` : ''
    return `${verbs}Vocabulary: ${u.vocabulary.map((v) => `${v.term} = ${v.gloss}`).join('; ') || '(none)'}\nGrammar: ${u.grammar.join('; ') || '(none)'}`
  }
  /** The sentence the curriculum and scope prompts get about verb units (empty when the format has none). */
  const verbUnitsNote = (R: { verbUnits: number; verbsPerUnit: number; language: boolean }, task: 'curriculum' | 'scope'): string => {
    if (!R.language || R.verbUnits === 0) return ''
    return task === 'curriculum'
      ? `Verb units: mark exactly ${R.verbUnits} unit(s) with "verb": true. A verb unit has objectives that are all about one verb group (for example sein, haben and the regular present; the modal verbs; the perfect tense; separable or reflexive verbs; the past tense; the subjunctive; the future), and its title names the group. Put the verb units where the learner is ready for them.`
      : `Units marked [VERB UNIT] are verb units. For each of them give "verbs": exactly ${R.verbsPerUnit} entries {"inf": the infinitive, "tense": the tense drilled, "level": the CEFR level the verb belongs to} that belong to the verb group of the unit, besides "vocabulary" (which may be shorter there, 4 to 8 entries).`
  }
  const objectivesFor = (c: Curriculum) => c.objectives.map((o) => ({ id: o.id, unit: o.unit }))
  const otherItemIds = async (slug: string, c: Curriculum, unit: string): Promise<string[]> => {
    const ids: string[] = []
    for (const u of c.units) if (u.id !== unit) ids.push(...(await P.items(slug, u.id)).map((i) => i.id))
    return ids
  }
  const writeUnit = (slug: string, unit: string, file: string, data: unknown) => P.writeJson(slug, `units/${unit}/${file}.json`, data)

  // ---- plan, factbase, curriculum, scope ----

  step('plan', async (h) => {
    const { R } = h
    const b = R.brief
    const { value } = await askRole(h.ctx, {
      dataDir,
      role: 'director',
      task: 'plan_brief',
      vars: { topic: b.topic, audience: b.audience, age: b.age ?? 'not given', level: b.level ?? R.cefr ?? 'general', language: langName(b.sourceLang), units: R.units, questions_per_unit: Math.max(1, R.researchQuestionsPerUnit), format_label: R.format.label, notes: b.notes ?? 'none' },
      schema: planSchema,
      check: (p) => checkPlan(p, { units: R.units, maxQuestionsPerUnit: Math.max(1, R.researchQuestionsPerUnit) })
    })
    await P.writeJson(h.slug, 'plan.json', value)
    return { note: `${value.units.length} unit(s), ${value.research.length} research question(s)`, path: 'pipeline/plan.json' }
  })

  step(
    'factbase',
    async (h) => {
      const m = await svc.factbase.mergeNotes(h.slug)
      const v = await svc.factbase.get(h.slug)
      if (v.facts.length === 0) {
        throw new Error(
          `the fact base has no usable fact (${v.notes} research note(s), ${v.pendingNotes.length} not merged). Research needs a researcher agent and a search provider (config/providers.md, search_order), ` +
            'and facts from the model\'s own knowledge are only kept when allow_unverified_facts is true in config/factory.md'
        )
      }
      return { note: `${v.facts.length} fact(s) from ${v.sources.length} source(s) (${m.added.length} new, ${m.skippedUnverified} unverified left out)`, path: `courses/${h.slug}/factbase/facts.md` }
    },
    { noModel: true }
  )

  step('curriculum', async (h) => {
    const { plan, vars } = await common(h)
    if (!plan) throw new Error('there is no plan yet')
    const fb = await factsOf(h.slug)
    const { R } = h
    const { value } = await askRole(h.ctx, {
      dataDir,
      role: 'curriculum-designer',
      task: 'curriculum',
      vars: { ...vars, summary: plan.summary, units: R.units, objectives_per_unit: R.objectivesPerUnit, unit_plan: plan.units.map((u, i) => `${i + 1}. ${u.title}: ${u.focus}`).join('\n'), factbase: factbaseText(fb.facts), notes: R.brief.notes ?? 'none', verb_units_note: verbUnitsNote(R, 'curriculum') },
      schema: curriculumSchema,
      check: (c) => checkCurriculum(c, { factIds: fb.facts.map((f) => f.id), units: R.units, objectivesPerUnit: R.objectivesPerUnit, factTexts: Object.fromEntries(fb.facts.map((f) => [f.id, f.fact])), ...(R.language ? { verbUnits: R.verbUnits } : {}) })
    })
    await P.writeJson(h.slug, 'curriculum.json', value)
    return { note: `${value.units.length} unit(s), ${value.objectives.length} objective(s)`, path: 'pipeline/curriculum.json' }
  })

  step('scope', async (h) => {
    const { vars } = await common(h)
    const cur = await curriculumOf(h.slug)
    const fb = await factsOf(h.slug)
    const { R } = h
    const { value } = await askRole(h.ctx, {
      dataDir,
      role: 'language-coach',
      task: 'scope',
      vars: { title: vars.title, audience: vars.audience, cefr: R.cefr ?? 'A1', language: vars.language, target_language: langName(R.brief.targetLang ?? ''), units: unitLines(cur.units), objectives: objectiveLines(cur.objectives), factbase: factbaseText(fb.facts), verb_units_note: verbUnitsNote(R, 'scope') },
      schema: scopeSchema,
      check: (s) => checkScope(s, cur.units.map((u) => u.id), cur.units.filter((u) => u.verb).map((u) => u.id))
    })
    await P.writeJson(h.slug, 'scope.json', value)
    return { note: `${value.units.length} unit(s) of vocabulary`, path: 'pipeline/scope.json' }
  })

  // ---- per unit ----

  const unitInfo = async (h: H) => {
    const cur = await curriculumOf(h.slug)
    const u = cur.units.find((x) => x.id === h.unit)
    if (!u) throw new Error(`the curriculum has no unit "${h.unit}"`)
    return { cur, u }
  }

  step(
    'articles',
    async (h) => {
      const { cur, u } = await unitInfo(h)
      const { vars } = await common(h)
      const fb = await factsOf(h.slug)
      const R = h.R
      if (R.articlesPerUnit === 0) {
        await writeUnit(h.slug, u.id, 'articles', { articles: [], round: 1 })
        return { note: 'the format has no articles' }
      }
      // The units are written in parallel, so a unit may be written before the others. The ids are fixed by the prompt (`a-<unit>-1` ...), so the
      // articles a unit has not written yet are known by their planned ids and `related` may name them.
      const others: { id: string; title: string }[] = []
      for (const o of cur.units) {
        if (o.id === u.id) continue
        const written = await P.articles(h.slug, o.id)
        if (written.length) others.push(...written)
        else for (let n = 1; n <= R.articlesPerUnit; n++) others.push({ id: `a-${o.id}-${n}`, title: `${o.title} (planned, not written yet: link to it only when it fits)` })
      }
      const { value } = await askRole(h.ctx, {
        dataDir,
        role: 'subject-expert',
        task: 'articles',
        vars: { ...vars, unit_id: u.id, unit_title: u.title, unit_summary: u.summary, objectives: objectiveLines(cur.objectives, u.id), factbase: factbaseText(fb.facts), articles_per_unit: R.articlesPerUnit, article_id_prefix: `a-${u.id}-`, other_articles: others.map((a) => `- ${a.id}: ${a.title}`).join('\n') || '(none)', scope: R.language ? await unitScope(h.slug, u.id) : '' },
        schema: articlesSchema,
        check: (a) => checkArticles(a, { factIds: fb.facts.map((f) => f.id), unitIds: cur.units.map((x) => x.id), unit: u.id, count: R.articlesPerUnit, otherArticleIds: others.map((x) => x.id) })
      })
      await writeUnit(h.slug, u.id, 'articles', { articles: value.articles, round: 1 })
      return { note: `${value.articles.length} article(s)`, path: `pipeline/units/${u.id}/articles.json` }
    },
    { skipModel: async (job) => (await jobResolved(job))?.articlesPerUnit === 0 }
  )

  const jobResolved = async (job: JobFile): Promise<ResolvedBrief | undefined> => (job.data.book ? (await P.readSteps(job.data.book))?.resolved : undefined)

  step('items', async (h) => {
    const { cur, u } = await unitInfo(h)
    const { vars } = await common(h)
    const fb = await factsOf(h.slug)
    const R = h.R
    const articles = await P.articles(h.slug, u.id)
    const existing = await otherItemIds(h.slug, cur, u.id)
    const { value } = await askRole(h.ctx, {
      dataDir,
      role: 'item-writer',
      task: 'items',
      vars: {
        ...vars,
        unit_id: u.id,
        unit_title: u.title,
        objectives: objectiveLines(cur.objectives, u.id),
        factbase: factbaseText(fb.facts),
        articles: articles.map((a) => `### ${a.id}: ${a.title}\n${a.body}`).join('\n\n') || '(none)',
        item_kinds: R.itemKinds.join(', '),
        items_per_objective: R.itemsPerObjective,
        item_id_prefix: `${u.id}-q`,
        scope: R.language ? await unitScope(h.slug, u.id) : '',
        target_language: R.brief.targetLang ? langName(R.brief.targetLang) : '',
        gap_marker: GAP_MARKER
      },
      schema: itemsSchema,
      check: (o) => checkItems(o.items, { objectives: objectivesFor(cur), factIds: fb.facts.map((f) => f.id), allowedKinds: R.itemKinds, unit: u.id, existingIds: existing, itemsPerObjective: R.itemsPerObjective })
    })
    await writeUnit(h.slug, u.id, 'items', { items: value.items, round: 1 })
    return { note: `${value.items.length} item(s)`, path: `pipeline/units/${u.id}/items.json` }
  })

  step(
    'distractors',
    async (h) => {
      const { u } = await unitInfo(h)
      const { vars } = await common(h)
      const fb = await factsOf(h.slug)
      const items = await P.items(h.slug, u.id)
      const given = distractorTargets(items, h.round)
      if (given.length === 0) return { note: 'no choice item needs wrong choices' }
      const { value } = await askRole(h.ctx, {
        dataDir,
        role: 'misconception-designer',
        task: 'distractors',
        vars: { ...vars, unit_id: u.id, factbase: factbaseText(fb.facts), items: itemsJson(given) },
        schema: distractorsSchema,
        check: (out) => checkDistractors(given, out)
      })
      const merged = applyDistractors(items, value)
      await writeUnit(h.slug, u.id, 'distractors', { out: value, round: h.round })
      await writeUnit(h.slug, u.id, 'items', { items: merged, round: h.round })
      return { note: `${value.items.length} item(s) got wrong choices from real misconceptions`, path: `pipeline/units/${u.id}/distractors.json` }
    },
    { skipModel: async (job) => distractorTargets(await P.items(job.data.book ?? '', job.data.unit ?? ''), job.data.round).length === 0 }
  )

  step(
    'fact_check',
    async (h) => {
      const { u } = await unitInfo(h)
      const { vars } = await common(h)
      const fb = await factsOf(h.slug)
      const items = await P.items(h.slug, u.id)
      const review = await factCheck(h.ctx, {
        dataDir,
        title: vars.title,
        round: h.round,
        facts: fb.facts,
        sources: fb.sources,
        unit: { articles: (await P.articles(h.slug, u.id)).map((a) => ({ id: a.id, title: a.title, body: a.body })), items: items.map(renderItemForCheck) }
      })
      await P.writeJson(h.slug, `reviews/${P.factCheckName(u.id, h.round)}.json`, { review, round: h.round } satisfies ReviewFile)
      return { note: `${review.verdict}, accuracy ${review.scores.accuracy ?? '?'}${review.problems.length ? `, ${review.problems.length} problem(s)` : ''}`, path: `pipeline/reviews/${P.factCheckName(u.id, h.round)}.json` }
    },
    { reviewing: true }
  )

  /** The problems of the last review that flagged this unit's content, as text for a revise prompt. */
  const lastReview = async (h: H, unit: string): Promise<ReviewResult> => {
    const r = await P.readReview(h.slug, P.factCheckName(unit, h.round - 1))
    if (!r) throw new Error(`there is no review of round ${h.round - 1} for ${unit}`)
    return r.review
  }

  step('articles_revise', async (h) => {
    const { cur, u } = await unitInfo(h)
    const { vars } = await common(h)
    const fb = await factsOf(h.slug)
    const review = await lastReview(h, u.id)
    const prev = await P.articles(h.slug, u.id)
    const flagged = (await P.flagged(h.slug, u.id, review)).articles
    const others: Article[] = []
    for (const o of cur.units) if (o.id !== u.id) others.push(...(await P.articles(h.slug, o.id)))
    const problems = review.problems.filter((p) => flagged.includes(p.ref))
    let merged: Article[] = prev
    await askRole(h.ctx, {
      dataDir,
      role: 'subject-expert',
      task: 'articles_revise',
      vars: { ...vars, unit_id: u.id, factbase: factbaseText(fb.facts), articles: JSON.stringify(prev.filter((a) => flagged.includes(a.id)), null, 1), problems: formatProblems(problems) },
      schema: articlesSchema,
      check: (out) => {
        const m = mergeRevision(prev, out.articles, flagged)
        merged = m.merged
        return [...m.problems, ...checkArticles({ articles: merged }, { factIds: fb.facts.map((f) => f.id), unitIds: cur.units.map((x) => x.id), unit: u.id, otherArticleIds: others.map((x) => x.id) })]
      }
    })
    await writeUnit(h.slug, u.id, 'articles', { articles: merged, round: h.round })
    return { note: `${flagged.length} article(s) corrected`, path: `pipeline/units/${u.id}/articles.json` }
  })

  step('items_revise', async (h) => {
    const { cur, u } = await unitInfo(h)
    const { vars } = await common(h)
    const fb = await factsOf(h.slug)
    const R = h.R
    const review = await lastReview(h, u.id)
    const prev = await P.items(h.slug, u.id)
    const flagged = (await P.flagged(h.slug, u.id, review)).items
    const existing = await otherItemIds(h.slug, cur, u.id)
    const problems: Problem[] = review.problems.filter((p) => flagged.includes(p.ref))
    let merged: AuthoredItem[] = prev
    await askRole(h.ctx, {
      dataDir,
      role: 'item-writer',
      task: 'items_revise',
      vars: {
        ...vars,
        unit_id: u.id,
        objectives: objectiveLines(cur.objectives, u.id),
        factbase: factbaseText(fb.facts),
        item_kinds: R.itemKinds.join(', '),
        items: itemsJson(prev.filter((i) => flagged.includes(i.id))),
        problems: formatProblems(problems.length ? problems : [{ ref: '', issue: review.notes || 'the fact-checker sent the items back' }]),
        target_language: R.brief.targetLang ? langName(R.brief.targetLang) : '',
        gap_marker: GAP_MARKER
      },
      schema: itemsSchema,
      check: (out) => {
        const m = mergeRevision(prev, out.items, flagged)
        merged = m.merged
        return [...m.problems, ...checkItems(merged, { objectives: objectivesFor(cur), factIds: fb.facts.map((f) => f.id), allowedKinds: R.itemKinds, unit: u.id, existingIds: existing, itemsPerObjective: R.itemsPerObjective })]
      }
    })
    // a corrected choice item has lost the wrong choices' reasons: the distractor step of this round writes them again
    await writeUnit(h.slug, u.id, 'items', { items: merged, round: h.round })
    return { note: `${flagged.length} item(s) corrected`, path: `pipeline/units/${u.id}/items.json` }
  })

  step('explain', async (h) => {
    const { u } = await unitInfo(h)
    const { vars } = await common(h)
    const fb = await factsOf(h.slug)
    const items = await P.items(h.slug, u.id)
    const { value } = await askRole(h.ctx, {
      dataDir,
      role: 'explainer',
      task: 'explain',
      vars: { ...vars, unit_id: u.id, factbase: factbaseText(fb.facts), items: itemsJson(items) },
      schema: explainSchema,
      check: (out) => checkExplain(items, out, fb.facts.map((f) => f.id))
    })
    await writeUnit(h.slug, u.id, 'explain', value)
    return { note: `feedback for ${value.items.length} item(s)`, path: `pipeline/units/${u.id}/explain.json` }
  })

  /** The typed answers and cloze gaps of a unit: `ref`, the question and the canonical answer. */
  const answerRefs = (items: readonly AuthoredItem[]): { ref: string; line: string }[] =>
    items.flatMap((it) =>
      it.kind === 'typed' ? [{ ref: it.id, line: `${it.id}: ${it.prompt} -> ${it.accepted[0]}` }] : it.kind === 'cloze' ? it.gaps.map((g) => ({ ref: `${it.id}.${g.id}`, line: `${it.id}.${g.id}: ${it.text} (gap ${g.id}) -> ${g.accepted[0]}` })) : []
    )

  step(
    'accepted',
    async (h) => {
      const { u } = await unitInfo(h)
      const items = await P.items(h.slug, u.id)
      const refs = answerRefs(items)
      if (refs.length === 0) {
        await writeUnit(h.slug, u.id, 'accepted', { answers: [] })
        return { note: 'no typed answer or gap' }
      }
      const { vars } = await common(h)
      const R = h.R
      const { value } = await askRole(h.ctx, {
        dataDir,
        role: 'language-coach',
        task: 'accepted',
        vars: { title: vars.title, cefr: R.cefr ?? 'A1', language: vars.language, target_language: langName(R.brief.targetLang ?? ''), items: refs.map((r) => r.line).join('\n') },
        schema: acceptedSchema,
        check: (out) => checkAccepted(items, out)
      })
      await writeUnit(h.slug, u.id, 'accepted', value)
      return { note: `${value.answers.length} answer list(s) widened`, path: `pipeline/units/${u.id}/accepted.json` }
    },
    { skipModel: async (job) => answerRefs(await P.items(job.data.book ?? '', job.data.unit ?? '')).length === 0 }
  )

  // ---- the whole course ----

  const allItems = async (slug: string, cur: Curriculum): Promise<AuthoredItem[]> => (await Promise.all(cur.units.map((u) => P.items(slug, u.id)))).flat()

  step('design', async (h) => {
    const cur = await curriculumOf(h.slug)
    const { vars } = await common(h)
    const items = await allItems(h.slug, cur)
    const kindsOf = (unit: string) => {
      const ids = new Set(cur.objectives.filter((o) => o.unit === unit).map((o) => o.id))
      const counts = new Map<string, number>()
      for (const it of items) if (ids.has(it.objective)) counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1)
      return [...counts].map(([k, n]) => `${k} ${n}`).join(', ')
    }
    const { value } = await askRole(h.ctx, {
      dataDir,
      role: 'game-designer',
      task: 'design',
      vars: {
        title: vars.title,
        audience: vars.audience,
        age: vars.age,
        units: cur.units.map((u) => `- ${u.id}: ${u.title} (${kindsOf(u.id) || 'no items'})`).join('\n'),
        item_summary: items.map((i) => `${i.id} ${i.kind} ${i.difficulty ?? 3}`).join('\n'),
        shells_available: 'quiz-arena',
        notes: `${h.R.brief.notes ?? 'none'}. Shells asked for: ${h.R.brief.shells.join(', ')}.`
      },
      schema: designSchema
    })
    const data: DesignData = normalizeDesign(value, items.map((i) => i.id))
    await P.writeJson(h.slug, 'design.json', data)
    return { note: `round ${data.quizArena.roundLength}, boss ${data.quizArena.bossLength}, ${Object.keys(data.difficulty).length} difficulties`, path: 'pipeline/design.json' }
  })

  step('story', async (h) => {
    const cur = await curriculumOf(h.slug)
    const { vars } = await common(h)
    const base = { title: vars.title, topic: h.R.brief.topic, audience: vars.audience, age: vars.age, language: vars.language, units: unitLines(cur.units), notes: h.R.brief.notes ?? 'none' }
    if (h.R.brief.story === 'frame') {
      const { value } = await askRole(h.ctx, { dataDir, role: 'narrative-designer', task: 'frame', vars: base, schema: frameSchema, check: (f) => checkFrame(f, cur.units.map((u) => u.id)) })
      await P.writeJson(h.slug, 'story.json', { mode: 'frame', frame: value })
      return { note: `a frame story with ${value.characters.length} character(s)`, path: 'pipeline/story.json' }
    }
    // scriptorium: the brief for the book factory, handed over when it is running (it is never started from here)
    const { value } = await askRole(h.ctx, { dataDir, role: 'narrative-designer', task: 'scriptorium_brief', vars: base, schema: scriptoriumBriefSchema })
    const client = await svc.scriptorium()
    const status = await client.status()
    if (!status.up) {
      await P.writeJson(h.slug, 'story.json', { mode: 'scriptorium', brief: value, skipped: status.error })
      return { status: 'skipped', note: `Scriptorium is not available, the course goes on without the story (${status.error})`, path: 'pipeline/story.json' }
    }
    const r = await client.handOffStory({ ...value, title: vars.title })
    await P.writeJson(h.slug, 'story.json', { mode: 'scriptorium', brief: value, story: r.story })
    return { note: `handed to Scriptorium as the story "${r.story}"`, path: 'pipeline/story.json' }
  })

  // ---- art (EGS-15): plan, make, review ----

  step('art_plan', async (h) => {
    const src = await svc.media.artSourceFromPipeline(h.slug)
    const r = await svc.media.planArt(h.ctx, h.slug, src)
    return { note: `${r.plan.entries.length} picture(s) planned${r.plan.source === 'fallback' ? ' (from the course text: the art-director gave no usable answer)' : ''}, ${r.added.length} new, ${r.kept.length} kept from earlier`, path: 'pipeline/art.json' }
  })

  step(
    'art_generate',
    async (h) => {
      const prev = h.round > 1 ? await P.readJson<{ revise: { id: string; note: string }[] }>(h.slug, `reviews/art_review-k${h.round - 1}.json`) : undefined
      const again = prev?.revise ?? []
      const rep = await svc.media.generate(h.slug, {
        ...(again.length ? { ids: again.map((r) => r.id), force: true, extraPrompts: Object.fromEntries(again.map((r) => [r.id, `Correct this: ${r.note}`])) } : {}),
        signal: h.ctx.signal,
        log: (m) => h.ctx.log(m)
      })
      const bits = [
        `${rep.generated.length} picture(s) made`,
        ...(rep.placeholders.length ? [`${rep.placeholders.length} placeholder(s) stand in (${rep.down ? `the image provider is down: ${rep.down.slice(0, 140)}` : (rep.failed[0]?.error ?? 'failed').slice(0, 140)})`] : []),
        ...(rep.skipped.length && !again.length ? [`${rep.skipped.length} already there`] : []),
        ...(rep.warnings.length ? [`${rep.warnings.length} warning(s): ${rep.warnings.slice(0, 2).map((w) => `${w.id}: ${w.warning}`).join('; ').slice(0, 200)}`] : [])
      ]
      return { note: bits.join(', '), path: `courses/${h.slug}/course/assets.json` }
    },
    { noModel: true }
  )

  step(
    'art_review',
    async (h) => {
      const r = await svc.media.reviewRound(h.ctx, h.slug, h.round, d.getQuality())
      return {
        note: `${r.reviewed} picture(s) reviewed, ${r.approved} approved${r.revise.length ? `, ${r.revise.length} sent back` : ''}${r.rejected.length ? `, ${r.rejected.length} still rejected after the last round (they stay in the course): ${r.rejected.slice(0, 5).join(', ')}` : ''}`,
        path: `pipeline/reviews/art_review-k${h.round}.json`
      }
    },
    { reviewing: true }
  )

  // ---- music (EGS-16): plan, make ----

  step('music_plan', async (h) => {
    const src = await svc.music.sourceFromPipeline(h.slug)
    const r = await svc.music.plan(h.ctx, h.slug, src)
    return { note: `${r.plan.tracks.length} track(s) and ${r.plan.sfx.length} sound effect(s) planned${r.plan.source === 'fallback' ? ' (from the course text: the composer gave no usable answer)' : ''}, ${r.added.length} new, ${r.kept.length} kept from earlier${r.plan.warnings?.length ? `; ${r.plan.warnings[0]}` : ''}`, path: 'pipeline/music.json' }
  })

  step(
    'music_generate',
    async (h) => {
      const rep = await svc.music.generate(h.slug, { signal: h.ctx.signal, log: (m) => h.ctx.log(m) })
      const bits = [
        `${rep.generated.length} sound(s) made`,
        ...(rep.placeholders.length ? [`${rep.placeholders.length} placeholder(s) stand in (${rep.down ? `a provider is down: ${rep.down.slice(0, 160)}` : (rep.failed[0]?.error ?? 'failed').slice(0, 140)})`] : []),
        ...(rep.skipped.length ? [`${rep.skipped.length} already there`] : []),
        ...(rep.warnings.length ? [`${rep.warnings.length} warning(s): ${rep.warnings.slice(0, 2).map((w) => `${w.id}: ${w.warning}`).join('; ').slice(0, 200)}`] : [])
      ]
      return { note: bits.join(', '), path: `courses/${h.slug}/course/assets.json` }
    },
    { noModel: true }
  )

  const voiceNote = (rep: VoiceGenerateResult): string => {
    const by: Record<string, number> = {}
    for (const a of Object.values(rep.allocation)) for (const [k, n] of Object.entries(a.made ?? {})) by[k] = (by[k] ?? 0) + n
    const bits = [
      `${rep.made.length} clip(s) spoken${Object.keys(by).length ? ` (${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}`,
      ...(rep.kept.length ? [`${rep.kept.length} already there`] : []),
      ...(rep.placeholders.length ? [`${rep.placeholders.length} placeholder(s) stand in (nothing could speak them)`] : []),
      ...Object.values(rep.allocation).filter((a) => a.need > 0).map((a) => `${a.lang}: ${a.provider}`),
      ...(rep.warnings.length ? [`${rep.warnings.length} warning(s): ${rep.warnings.slice(0, 2).join('; ').slice(0, 200)}`] : [])
    ]
    return bits.join(', ')
  }

  // ---- editions (EGS-32): the translator makes the other languages of the text ----

  step('editions', async (h) => {
    const R = h.R
    const langs = editionLanguages(R)
    if (langs.length === 0) return { status: 'skipped', note: 'no edition besides the source and the taught language' }
    const loaded = await loadCourseFolder(svc.courses.root(h.slug))
    const source = loaded.catalogs[R.brief.sourceLang] as TextCatalog | undefined
    if (!source) throw new Error(`there is no text catalog for the source language "${R.brief.sourceLang}"`)
    const target = R.brief.targetLang ? (loaded.catalogs[R.brief.targetLang] as TextCatalog | undefined) : undefined
    const entries = editionEntries(source, target)
    const { vars } = await common(h)
    const made: Record<string, { strings: Record<string, string>; accepted: Record<string, string[]> }> = {}
    for (const lang of langs) {
      const into = { strings: {} as Record<string, string>, accepted: {} as Record<string, string[]> }
      for (const chunk of chunkEntries(entries)) {
        const { value } = await askRole(h.ctx, {
          dataDir,
          role: 'translator',
          task: 'edition',
          vars: {
            title: vars.title,
            audience: vars.audience,
            source_language: langName(R.brief.sourceLang),
            edition_language: langName(lang),
            gap_marker: GAP_MARKER,
            taught_note: R.brief.targetLang ? ` The course teaches ${langName(R.brief.targetLang)}: the taught phrases are not among the entries and are never translated; if an entry quotes one, keep the quote as it is.` : '',
            entries: chunk.map((e) => JSON.stringify(e)).join('\n')
          },
          schema: editionSchema,
          check: (out) => checkEdition(chunk, out),
          maxTokens: 16_000
        })
        applyEdition(chunk, value, into)
      }
      made[lang] = into
    }
    const added = await svc.courses.addEditions(h.slug, made)
    const summary = { languages: langs, keys: entries.length, taughtKept: target ? Object.keys(target.strings).length : 0 }
    await P.writeJson(h.slug, 'editions.json', summary)
    return { note: `${langs.join(', ')}: ${entries.length} text(s) each${target ? `, ${summary.taughtKept} taught text(s) of ${R.brief.targetLang} left as they are` : ''}; the course has ${added.languages.join(', ')}`, path: 'pipeline/editions.json' }
  })

  // ---- voice (EGS-17): plan, speak ----

  step('voice_plan', async (h) => {
    const r = await svc.voice.plan(h.ctx, h.slug)
    const narration = r.plan.clips.filter((c) => c.role === 'narration').length
    return { note: `${r.plan.clips.length} clip(s) planned (${r.plan.clips.length - narration} listening, ${narration} narration), ${r.plan.derived.length} listening item(s) made from taught phrases${r.plan.source === 'fallback' ? ' (from the course text: the voice-director gave no usable answer)' : ''}, ${r.added.length} new, ${r.kept.length} kept from earlier`, path: 'pipeline/voice.json' }
  })

  step(
    'voice_generate',
    async (h) => {
      const rep = await svc.voice.generate(h.slug, { signal: h.ctx.signal, log: (m) => h.ctx.log(m) })
      return { note: voiceNote(rep), path: 'pipeline/voice.json' }
    },
    { noModel: true }
  )

  sched.register('asset_voice_plan', async (ctx) => {
    const slug = ctx.job.book
    if (!slug) throw new Error('the asset_voice_plan job has no course')
    const r = await svc.voice.plan(ctx, slug)
    const linked = await svc.media.relink(slug)
    return { result: `${r.plan.clips.length} clip(s) planned (${r.plan.source}), ${r.plan.derived.length} derived listening item(s), ${r.added.length} new, ${r.kept.length} kept${linked ? `, pack linked to ${linked.assets} asset(s)` : ''}`, resultPath: 'pipeline/voice.json' }
  })

  sched.register(
    'asset_voice_generate',
    async (ctx) => {
      const slug = ctx.job.book
      if (!slug) throw new Error('the asset_voice_generate job has no course')
      const p = (ctx.job as { params?: { lang?: string; force?: boolean } }).params ?? {}
      const rep = await svc.voice.generate(slug, { ...(p.lang ? { lang: p.lang } : {}), ...(p.force ? { force: true } : {}), signal: ctx.signal, log: (m) => ctx.log(m) })
      return { result: voiceNote(rep), resultPath: 'pipeline/voice.json' }
    },
    { noModel: true }
  )

  // the tools' own jobs (`edu_asset_plan`, `edu_asset_generate`): not steps of a run, so they work on a hand-made course too
  sched.register('asset_plan', async (ctx) => {
    const slug = ctx.job.book
    if (!slug) throw new Error('the asset_plan job has no course')
    const src = await svc.media.artSourceFromPack(slug)
    const r = await svc.media.planArt(ctx, slug, src)
    const linked = await svc.media.relink(slug)
    return { result: `${r.plan.entries.length} picture(s) planned (${r.plan.source}), ${r.added.length} new, ${r.kept.length} kept${linked ? `, pack linked to ${linked.assets} asset(s)` : ''}`, resultPath: 'pipeline/art.json' }
  })

  sched.register('asset_music_plan', async (ctx) => {
    const slug = ctx.job.book
    if (!slug) throw new Error('the asset_music_plan job has no course')
    const src = await svc.music.sourceFromPack(slug)
    const r = await svc.music.plan(ctx, slug, src)
    const linked = await svc.media.relink(slug)
    return { result: `${r.plan.tracks.length} track(s) and ${r.plan.sfx.length} sound effect(s) planned (${r.plan.source}), ${r.added.length} new, ${r.kept.length} kept${linked ? `, pack linked to ${linked.assets} asset(s)` : ''}`, resultPath: 'pipeline/music.json' }
  })

  sched.register(
    'asset_generate',
    async (ctx) => {
      const slug = ctx.job.book
      if (!slug) throw new Error('the asset_generate job has no course')
      const p = (ctx.job as { params?: { ids?: string[]; force?: boolean; kind?: string } }).params ?? {}
      const job = { ids: p.ids, force: p.force, kind: p.kind, signal: ctx.signal, log: (m: string) => ctx.log(m) }
      // pictures and sounds: a kind says which (no kind: both)
      const none = { generated: [], skipped: [], failed: [], placeholders: [], warnings: [] } as { generated: string[]; skipped: string[]; failed: unknown[]; placeholders: string[]; warnings: unknown[]; down?: string }
      const rep = !p.kind || IMAGE_KINDS.has(p.kind) ? await svc.media.generate(slug, job) : none
      const sounds = !p.kind || AUDIO_KINDS.has(p.kind) ? await svc.music.generate(slug, job) : none
      const linked = await svc.media.relink(slug)
      const down = rep.down ?? sounds.down
      return { result: `${rep.generated.length + sounds.generated.length} made, ${rep.skipped.length + sounds.skipped.length} skipped, ${rep.placeholders.length + sounds.placeholders.length} placeholder(s)${down ? ` (down: ${down.slice(0, 120)})` : ''}${linked ? `, pack linked (${linked.links} link(s)${linked.cues !== undefined ? `, ${linked.cues} cue(s)` : ''})` : ''}`, resultPath: `courses/${slug}/course/assets.json` }
    },
    { noModel: true }
  )

  const readText = async (slug: string, lang: string): Promise<TextCatalog | undefined> => {
    const loaded = await loadCourseFolder(svc.courses.root(slug))
    return loaded.catalogs[lang] as TextCatalog | undefined
  }

  step(
    'assemble',
    async (h) => {
      const cur = await curriculumOf(h.slug)
      const { plan } = await common(h)
      const R = h.R
      const items = await allItems(h.slug, cur)
      const articles = (await Promise.all(cur.units.map((u) => P.articles(h.slug, u.id)))).flat()
      const explain: ExplainOutput = { items: [] }
      const accepted: AcceptedOutput = { answers: [] }
      for (const u of cur.units) {
        explain.items.push(...((await P.readJson<ExplainOutput>(h.slug, `units/${u.id}/explain.json`))?.items ?? []))
        accepted.answers.push(...((await P.readJson<AcceptedOutput>(h.slug, `units/${u.id}/accepted.json`))?.answers ?? []))
      }
      const design = await P.readJson<DesignData>(h.slug, 'design.json')
      const story = await P.readJson<{ mode: string; frame?: Frame }>(h.slug, 'story.json')
      const polish = await P.readJson<{ strings: Record<string, string> }>(h.slug, 'polish.json')
      const { pack, catalogs, itemKeys } = assembleCourse({
        slug: h.slug,
        title: plan?.title ?? R.brief.topic,
        subject: R.brief.topic,
        audience: R.brief.audience,
        sourceLang: R.brief.sourceLang,
        ...(R.brief.targetLang ? { targetLang: R.brief.targetLang } : {}),
        ...(R.cefr ? { cefr: R.cefr } : {}),
        verbsPerUnit: R.verbsPerUnit,
        run: h.st.run,
        brief: R.brief,
        factbase: await svc.factbase.toPack(h.slug),
        curriculum: cur,
        articles,
        items,
        explain,
        accepted,
        ...(design ? { design } : {}),
        ...(story?.frame ? { story: story.frame } : {}),
        ...(polish ? { polish: polish.strings } : {}),
        media: await svc.media.mergeFor(h.slug)
      })
      await svc.courses.writeAssembled(h.slug, pack, catalogs)
      const content = renderCourseForReview(pack as never, catalogs, R.brief.sourceLang, R.brief.targetLang)
      await P.writeJson(h.slug, 'assembled.json', { round: h.round, itemKeys, content })
      return { note: `${items.length} item(s), ${articles.length} article(s), ${Object.keys(catalogs[R.brief.sourceLang]!.strings).length} text(s)`, path: `courses/${h.slug}/course/pack.json` }
    },
    { noModel: true }
  )

  const audienceReview = (task: string, role: string): void =>
    step(
      task,
      async (h) => {
        const { vars } = await common(h)
        const asm = await P.readJson<{ content: string }>(h.slug, 'assembled.json')
        if (!asm) throw new Error('the course is not assembled yet')
        const review = await runReview(h.ctx, { role, task: 'review', dataDir, vars: { ...vars, round: h.round, content: asm.content } })
        await P.writeJson(h.slug, `reviews/${P.audienceName(role, h.round)}.json`, { review, round: h.round } satisfies ReviewFile)
        return { note: `${review.verdict}, ${Object.entries(review.scores).map(([k, v]) => `${k} ${v}`).join(', ')}${review.problems.length ? `, ${review.problems.length} problem(s)` : ''}`, path: `pipeline/reviews/${P.audienceName(role, h.round)}.json` }
      },
      { reviewing: true }
    )
  audienceReview('review_accessibility', 'accessibility-reviewer')
  audienceReview('review_child_safety', 'child-safety-reviewer')

  step('polish', async (h) => {
    const { vars } = await common(h)
    const R = h.R
    const asm = await P.readJson<{ itemKeys: Record<string, string[]> }>(h.slug, 'assembled.json')
    if (!asm) throw new Error('the course is not assembled yet')
    const roles = ['accessibility-reviewer', ...(R.kids ? ['child-safety-reviewer'] : [])]
    const counted: ReviewResult[] = []
    for (const role of roles) {
      const r = await P.readReview(h.slug, P.audienceName(role, h.round - 1))
      if (r && countsAsRevise(r.review, d.getQuality())) counted.push(r.review)
    }
    const src = (await readText(h.slug, R.brief.sourceLang))?.strings ?? {}
    const tgt = R.brief.targetLang ? ((await readText(h.slug, R.brief.targetLang))?.strings ?? {}) : {}
    const all: Record<string, string> = { ...tgt, ...src }
    // a problem names a text key, or the id of an item or an article (all its texts)
    const keys = new Set<string>()
    for (const r of counted) {
      for (const p of r.problems) {
        if (p.ref in all) keys.add(p.ref)
        else if (asm.itemKeys[p.ref]) for (const k of asm.itemKeys[p.ref]!) keys.add(k)
        else for (const k of [`art.${p.ref}.title`, `art.${p.ref}.body`]) if (k in all) keys.add(k)
      }
    }
    const flagged = [...keys].slice(0, 60)
    const polish = (await P.readJson<{ strings: Record<string, string> }>(h.slug, 'polish.json')) ?? { strings: {} }
    if (flagged.length === 0) {
      await P.writeJson(h.slug, 'polish.json', polish)
      return { note: 'the reviewers named no text key: nothing to polish' }
    }
    const { value } = await askRole(h.ctx, {
      dataDir,
      role: 'explainer',
      task: 'polish',
      vars: { title: vars.title, audience: vars.audience, age: vars.age, level: vars.level, language: vars.language, strings: JSON.stringify(Object.fromEntries(flagged.map((k) => [k, all[k]])), null, 1), problems: counted.map((r) => `${r.role}: ${formatProblems(r.problems)}`).join('\n') },
      schema: polishSchema
    })
    const { kept, dropped } = applyPolish(value.strings, flagged)
    await P.writeJson(h.slug, 'polish.json', { strings: { ...polish.strings, ...kept } })
    return { note: `${Object.keys(kept).length} text(s) polished${dropped.length ? `, ${dropped.length} unflagged key(s) ignored` : ''}`, path: 'pipeline/polish.json' }
  })

  step(
    'build',
    async (h) => {
      const r = await svc.courses.build(h.slug)
      if (!r.ok) throw new Error(`the course cannot be built: ${r.problems.slice(0, 5).map((p) => `${p.code} at ${p.path}: ${p.message}`).join('; ')}`)
      return { note: `built ${r.files.length} file(s)`, path: `courses/${h.slug}/build/index.html` }
    },
    { noModel: true }
  )

  step(
    'lint',
    async (h) => {
      const r = await svc.courses.lint(h.slug, { rebuild: false })
      await P.writeJson(h.slug, 'lint.json', { ok: r.ok, errors: r.errors, warnings: r.warnings, problems: r.problems.slice(0, 40) })
      return { note: r.ok ? `clean (${r.warnings} warning(s))` : `${r.errors} error(s), ${r.warnings} warning(s): a hard gate of the publisher`, path: 'pipeline/lint.json' }
    },
    { noModel: true }
  )

  step(
    'playtest',
    async (h) => {
      const r = await svc.playtest(h.slug)
      await P.writeJson(h.slug, 'playtest.json', r)
      return { note: r.ok ? `${r.runs.length} learner(s) played the game, all passed` : `the bot failed: ${r.failures.slice(0, 3).join('; ')}`, path: 'pipeline/playtest.json' }
    },
    { noModel: true }
  )

  step(
    'playtest_report',
    async (h) => {
      const cur = await curriculumOf(h.slug)
      const { vars } = await common(h)
      const play = await P.readJson<PlaytestResult>(h.slug, 'playtest.json')
      const lint = await P.readJson<{ ok: boolean; errors: number; warnings: number; problems: { code: string; path: string; message: string }[] }>(h.slug, 'lint.json')
      const { value } = await askRole(h.ctx, {
        dataDir,
        role: 'playtester',
        task: 'report',
        vars: {
          title: vars.title,
          audience: vars.audience,
          age: vars.age,
          units: cur.units.map((u) => u.title).join('; '),
          personas: play ? playtestDigest(play) : '(the bot did not run)',
          lint: lint ? `${lint.errors} error(s), ${lint.warnings} warning(s)${lint.problems.slice(0, 5).map((p) => `\n- ${p.code} ${p.path}: ${p.message}`).join('')}` : '(not linted)',
          scores_example: scoresExample('playtester')
        },
        schema: playtestReportSchema
      })
      const review: ReviewResult = { role: 'playtester', verdict: value.verdict, scores: value.scores as Record<string, number>, notes: value.notes, problems: value.problems }
      await P.writeJson(h.slug, 'report.json', { review, deadEnds: value.deadEnds })
      return { note: `${review.verdict}, ${Object.entries(review.scores).map(([k, v]) => `${k} ${v}`).join(', ')}${value.deadEnds.length ? `, ${value.deadEnds.length} dead end(s)` : ''}`, path: 'pipeline/report.json' }
    },
    { reviewing: true }
  )

  step(
    'publish',
    async (h) => {
      const { decision, reviews } = await P.decision(h.slug)
      const at = new Date().toISOString()
      if (!decision.publish) {
        await P.writeJson(h.slug, 'publish.json', { published: false, score: decision.score, byDimension: decision.byDimension, reasons: decision.reasons, at })
        return { status: 'blocked', note: decision.reasons.join('; ') }
      }
      const cur = await curriculumOf(h.slug)
      const { vars } = await common(h)
      const { value } = await askRole(h.ctx, {
        dataDir,
        role: 'publisher',
        task: 'publish',
        vars: { title: vars.title, audience: vars.audience, language: vars.language, score: decision.score, reviews: reviews.map((r) => `- ${r.role}: ${r.verdict} (${Object.entries(r.scores).map(([k, v]) => `${k} ${v}`).join(', ')}) ${r.notes}`).join('\n'), units: cur.units.map((u) => u.title).join('; ') },
        schema: publishSchema
      })
      await P.writeJson(h.slug, 'publish.json', { published: true, score: decision.score, byDimension: decision.byDimension, blurb: value.blurb, notes: value.notes, at })
      return { note: `published, score ${decision.score}`, path: 'pipeline/publish.json' }
    },
    { skipModel: async (job) => !(await P.decision(job.data.book ?? '')).decision.publish }
  )

  step('summarize', async (h) => {
    const view = await P.status(h.slug)
    const { vars } = await common(h)
    const lines = (view?.steps ?? []).map((s) => `- ${s.step}: ${s.status}${s.note ? ` (${s.note})` : ''}${s.failure ? ` FAILED: ${s.failure}` : ''}`).join('\n')
    const { value } = await askRole(h.ctx, {
      dataDir,
      role: 'director',
      task: 'summarize_run',
      vars: { title: vars.title, slug: h.slug, steps: lines },
      schema: z.object({ summary: z.string().min(1), redo: z.array(z.object({ step: z.string(), reason: z.string() })).default([]) })
    })
    const text = `\n## Run ${h.st.run}: ${new Date().toISOString().slice(0, 10)}\n\n${value.summary.trim()}\n${value.redo.length ? `\nRedo:\n${value.redo.map((r) => `- ${r.step}: ${r.reason}`).join('\n')}\n` : ''}`
    await svc.setCourseMeta(h.slug, {}, { body: (old) => (old.trim() ? old.replace(/\s*$/, '\n') : '# Run log\n') + text })
    return { note: value.summary.slice(0, 200) }
  })
}
