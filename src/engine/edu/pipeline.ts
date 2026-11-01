import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveBrief } from '../../shared/brief'
import type { Brief, ResolvedBrief } from '../../shared/brief'
import type { QualityConfig } from '../../shared/schemas'
import type { Article, AuthoredItem, Curriculum } from './authoring'
import type { JobState, NewJob } from '../queue/jobs'
import { atomicWrite } from '../store/atomic'
import { researchJobId } from '../research/notes'
import { countsAsRevise, decide } from '../review/scoring'
import type { Decision, Gate, ReviewResult } from '../review/scoring'
import type { EduService } from './service'
import { assertSlug, coursesDir } from './paths'

/**
 * The content pipeline's state and its driver (EGS-08). A run is a chain of steps, each a file job in the queue with a deterministic id, that
 * the roles of EGS-06 and EGS-07 do:
 *
 * ```
 * plan -> research x N -> factbase -> curriculum -> scope (language courses)
 *   -> per unit: articles -> items -> distractors -> fact_check (must pass; revise rounds) -> explain -> accepted (language courses)
 *   -> design -> story -> art_plan -> art_generate -> art_review (-> art_generate, art_review ... rounds) -> music_plan -> music_generate -> assemble
 *   -> audience reviews (accessibility, child safety for kids; polish and assemble again on revise)
 *   -> harvest (EGS-36: a flashcard for each glossary entry of the readings; readings only)
 *   -> voice_plan -> voice_generate (EGS-17: after the reviews, so the clips speak the final text; the pack is re-linked)
 *   -> editions (EGS-32: the translator makes the other editions of the final text; skipped with one language) -> build -> lint -> playtest
 *   -> playtest_report -> publish (code: must-pass, threshold, hard gates; the publisher writes the blurb) -> summarize
 * ```
 *
 * Files of a course (`courses/<slug>/`): `course.md` (`brief`, `models`, `run`, `stage`; the body is the run log), `research/`, `factbase/`,
 * `pipeline/` (one JSON file per step output, `steps.json` = the state), `course/` (written by assemble) and `build/`.
 *
 * Job id: `<slug>--<task>[-k<round>]--<unit|all>--r<run>`; a research job is `<slug>--research--q<hash>--r0`. A step key is
 * `<task>[-k<round>]:<unit|all>` (for research `research:q<hash>`). `advance(slug)` derives what to enqueue next from `steps.json`, the files
 * and the queue, never from memory, so it can be called any number of times (after every step, from `edu_run_pipeline`, after a restart).
 */

export const STAGES = ['plan', 'research', 'factbase', 'curriculum', 'scope', 'articles', 'items', 'distractors', 'fact_check', 'explain', 'accepted', 'design', 'story', 'art', 'music', 'assemble', 'review', 'harvest', 'voice', 'editions', 'build', 'lint', 'playtest', 'publish'] as const
export type Stage = (typeof STAGES)[number]

/** The editions the translator has to make: the languages of the brief but the source language and the taught language. */
export const editionLanguages = (R: Pick<ResolvedBrief, 'languages' | 'brief'>): string[] => R.languages.filter((l) => l !== R.brief.sourceLang && l !== R.brief.targetLang)

/** Which stage a task belongs to (for `restart from`). */
const STAGE_OF: Record<string, Stage> = {
  plan: 'plan',
  editions: 'editions',
  harvest: 'harvest',
  research: 'research',
  factbase: 'factbase',
  curriculum: 'curriculum',
  scope: 'scope',
  articles: 'articles',
  articles_revise: 'articles',
  items: 'items',
  items_revise: 'items',
  distractors: 'distractors',
  fact_check: 'fact_check',
  explain: 'explain',
  accepted: 'accepted',
  design: 'design',
  story: 'story',
  art_plan: 'art',
  art_generate: 'art',
  art_review: 'art',
  music_plan: 'music',
  music_generate: 'music',
  voice_plan: 'voice',
  voice_generate: 'voice',
  assemble: 'assemble',
  review_accessibility: 'review',
  review_child_safety: 'review',
  polish: 'review',
  build: 'build',
  lint: 'lint',
  playtest: 'playtest',
  playtest_report: 'playtest',
  publish: 'publish',
  summarize: 'publish'
}

/** The files each stage writes, relative to `pipeline/`; `*` stands for any unit folder or any name. */
const STAGE_FILES: Partial<Record<Stage, string[]>> = {
  plan: ['plan.json'],
  curriculum: ['curriculum.json'],
  scope: ['scope.json'],
  articles: ['units/*/articles.json'],
  items: ['units/*/items.json'],
  distractors: ['units/*/distractors.json'],
  fact_check: ['reviews/fact_check-*'],
  explain: ['units/*/explain.json'],
  accepted: ['units/*/accepted.json'],
  design: ['design.json'],
  story: ['story.json'],
  art: ['art.json', 'reviews/art_review-*'],
  music: ['music.json'],
  assemble: ['assembled.json', 'polish.json'],
  review: ['reviews/review-*'],
  harvest: ['harvest.json'],
  voice: ['voice.json'],
  editions: ['editions.json'],
  lint: ['lint.json'],
  playtest: ['playtest.json', 'report.json'],
  publish: ['publish.json']
}

export type StepStatus = 'queued' | 'done' | 'skipped' | 'blocked'

export interface StepEntry {
  status: StepStatus
  /** The job that does the step, when it is a job. */
  job?: string
  round?: number
  note?: string
  at: string
  /** The model family that wrote it (reviewers avoid it). */
  family?: string
  model?: string
}

export interface StepsFile {
  run: number
  /** The brief and the format, resolved when the run started. */
  resolved: ResolvedBrief
  steps: Record<string, StepEntry>
}

export const stepKey = (task: string, unit: string | null, round = 1): string => `${task}${round > 1 ? `-k${round}` : ''}:${unit ?? 'all'}`
export const pipelineJobId = (slug: string, run: number, task: string, unit: string | null, round = 1): string => `${slug}--${task}${round > 1 ? `-k${round}` : ''}--${unit ?? 'all'}--r${run}`

/** What a review file holds. */
export interface ReviewFile {
  review: ReviewResult
  family?: string
  round: number
}

export interface PipelineStepView {
  step: string
  status: 'queued' | 'running' | 'done' | 'skipped' | 'blocked' | 'failed'
  round?: number
  job?: string
  note?: string
  failure?: string
}

export interface PipelineView {
  run: number
  /** draft, running, blocked, published or failed (a job failed for good: `edu_run_pipeline {retry: true}`). */
  stage: string
  steps: PipelineStepView[]
  /** Why the run is blocked (a must-pass reviewer, a hard gate ...). */
  blockedBy?: string[]
  /** What failed (job failures, with the text). */
  failed?: { step: string; job: string; failure: string }[]
  /** The next thing to do, in words. */
  next: string
}

export interface RunResult {
  slug: string
  run: number
  enqueued: string[]
  stage: string
  steps: PipelineStepView[]
  retried?: string[]
}

interface Ctx {
  slug: string
  st: StepsFile
  enq: string[]
  q: QualityConfig
}

const iso = (): string => new Date().toISOString()

/** The decision of the publisher: the reviews of the run, the quality config, and the hard gates (lint, the bot). Pure. */
export function publishDecision(reviews: ReviewResult[], quality: QualityConfig, lint: { errors: number; problems?: { code: string; path: string }[] } | undefined, playtest: { ok: boolean; failures?: string[] } | undefined): Decision {
  const gates: Gate[] = [
    { name: 'lint', ok: !!lint && lint.errors === 0, reason: !lint ? 'the game was not linted' : `${lint.errors} error(s)${lint.problems?.length ? `: ${lint.problems.slice(0, 3).map((p) => `${p.code} at ${p.path}`).join('; ')}` : ''}` },
    { name: 'playtest', ok: !!playtest && playtest.ok, reason: !playtest ? 'the game was not played by the autoplay bot' : (playtest.failures ?? []).slice(0, 3).join('; ') || 'the autoplay bot failed' }
  ]
  return decide(reviews, quality, gates)
}

export class Pipeline {
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(private readonly svc: EduService) {}

  private get d() {
    return this.svc.deps
  }

  // ---- files ----

  dir(slug: string): string {
    return path.join(coursesDir(this.d.dataDir), assertSlug(slug), 'pipeline')
  }
  file(slug: string, rel: string): string {
    return path.join(this.dir(slug), ...rel.split('/'))
  }

  async readJson<T>(slug: string, rel: string): Promise<T | undefined> {
    try {
      return JSON.parse(await fs.readFile(this.file(slug, rel), 'utf8')) as T
    } catch {
      return undefined
    }
  }

  async writeJson(slug: string, rel: string, data: unknown): Promise<void> {
    await atomicWrite(this.file(slug, rel), JSON.stringify(data, null, 2) + '\n')
  }

  /** The state of the run; null when the course has none. */
  readSteps(slug: string): Promise<StepsFile | null> {
    return this.readJson<StepsFile>(slug, 'steps.json').then((s) => s ?? null)
  }

  async requireSteps(slug: string): Promise<StepsFile> {
    const st = await this.readSteps(slug)
    if (!st) throw new Error(`the course "${slug}" has no pipeline run (edu_run_pipeline starts one)`)
    return st
  }

  private exclusive<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(slug) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.locks.set(slug, next.catch(() => undefined))
    return next
  }

  // ---- reading the outputs ----

  curriculum(slug: string): Promise<Curriculum | undefined> {
    return this.readJson<Curriculum>(slug, 'curriculum.json')
  }
  async articles(slug: string, unit: string): Promise<Article[]> {
    return (await this.readJson<{ articles: Article[] }>(slug, `units/${unit}/articles.json`))?.articles ?? []
  }
  async items(slug: string, unit: string): Promise<AuthoredItem[]> {
    return (await this.readJson<{ items: AuthoredItem[] }>(slug, `units/${unit}/items.json`))?.items ?? []
  }
  readReview(slug: string, name: string): Promise<ReviewFile | undefined> {
    return this.readJson<ReviewFile>(slug, `reviews/${name}.json`)
  }
  factCheckName = (unit: string, round: number): string => `fact_check-${unit}-k${round}-fact-checker`
  audienceName = (role: string, round: number): string => `review-${role}-k${round}`

  // ---- steps ----

  /** Marks a step done (a handler calls it after it wrote its output). */
  markDone(slug: string, key: string, patch: Partial<StepEntry> = {}): Promise<void> {
    return this.exclusive(slug, async () => {
      const st = await this.readSteps(slug)
      if (!st) return
      st.steps[key] = { ...st.steps[key], ...patch, status: 'done', at: iso() }
      await this.writeJson(slug, 'steps.json', st)
    })
  }

  /** Marks a step skipped, with the reason. */
  markSkipped(slug: string, key: string, note: string): Promise<void> {
    return this.exclusive(slug, async () => {
      const st = await this.readSteps(slug)
      if (!st) return
      st.steps[key] = { ...st.steps[key], status: 'skipped', note, at: iso() }
      await this.writeJson(slug, 'steps.json', st)
    })
  }

  /** Marks a step blocked (a gate failed): the run stops there until a restart. */
  markBlocked(slug: string, key: string, note: string): Promise<void> {
    return this.exclusive(slug, async () => {
      const st = await this.readSteps(slug)
      if (!st) return
      st.steps[key] = { ...st.steps[key], status: 'blocked', note, at: iso() }
      await this.writeJson(slug, 'steps.json', st)
    })
  }

  /** `advance` after a step, never throwing (a handler's own work is done; `edu_run_pipeline` can advance again). */
  async advanceSafe(slug: string): Promise<void> {
    try {
      await this.advance(slug)
    } catch (e) {
      this.svc.log(`pipeline ${slug}: advance failed: ${(e as Error).message}`)
    }
  }

  // ---- starting, resuming, restarting ----

  /**
   * Starts a run (or resumes the one in progress). `restart` starts run n+1, clearing the outputs from the stage `from` on; `retry` puts the
   * failed jobs of the current run back in the queue. The brief comes from `course.md`.
   */
  async start(slug: string, o: { restart?: boolean; from?: string; retry?: boolean } = {}): Promise<RunResult> {
    const meta = await this.svc.getCourseMeta(slug)
    const brief = (meta?.data as { brief?: unknown } | undefined)?.brief
    if (!brief) throw new Error(`the course "${slug}" has no brief in its course.md: pass a brief to edu_run_pipeline`)
    if (o.from && !(STAGES as readonly string[]).includes(o.from)) throw new Error(`unknown stage "${o.from}" (stages: ${STAGES.join(', ')})`)
    let retried: string[] | undefined
    await this.exclusive(slug, async () => {
      const existing = await this.readSteps(slug)
      if (!existing || o.restart) {
        const resolved = resolveBrief(brief as Brief, this.d.getFormats())
        const run = (existing?.run ?? 0) + 1
        if (existing && o.restart) {
          this.d.stopBook?.(slug, 'stopped')
          await this.svc.clearQueue(slug)
          await this.clear(slug, existing, o.from ?? 'plan')
        }
        const st: StepsFile = { run, resolved, steps: existing && o.restart ? existing.steps : {} }
        await this.writeJson(slug, 'steps.json', st)
        await this.svc.setCourseMeta(slug, { run, stage: 'running' })
      } else if (o.retry) {
        retried = []
        for (const id of await this.svc.jobIds('failed', slug)) {
          if (id.endsWith(`--r${existing.run}`) || id.endsWith('--r0')) if (await this.d.jobs.retry(id)) retried.push(id)
        }
      }
    })
    const enqueued = await this.advance(slug)
    if (retried?.length || enqueued.length) this.d.kick?.()
    const view = await this.status(slug)
    return { slug, run: view?.run ?? 0, enqueued, stage: view?.stage ?? 'running', steps: view?.steps ?? [], ...(retried ? { retried } : {}) }
  }

  /** Removes the step entries and the output files from a stage on. */
  private async clear(slug: string, st: StepsFile, from: string): Promise<void> {
    const at = STAGES.indexOf(from as Stage)
    for (const key of Object.keys(st.steps)) {
      const task = key.split(':')[0]!.replace(/-k\d+$/, '')
      const stage = STAGE_OF[task]
      if (stage !== undefined && STAGES.indexOf(stage) >= at) delete st.steps[key]
    }
    for (const stage of STAGES.slice(at)) {
      for (const pattern of STAGE_FILES[stage] ?? []) await this.removeMatching(slug, pattern)
    }
  }

  private async removeMatching(slug: string, pattern: string): Promise<void> {
    const parts = pattern.split('/')
    const walk = async (dir: string, i: number): Promise<void> => {
      const part = parts[i]!
      const last = i === parts.length - 1
      let names: string[]
      try {
        names = await fs.readdir(dir)
      } catch {
        return
      }
      for (const n of names) {
        const ok = part === '*' ? true : part.endsWith('*') ? n.startsWith(part.slice(0, -1)) : n === part
        if (!ok) continue
        if (last) await fs.rm(path.join(dir, n), { recursive: true, force: true })
        else await walk(path.join(dir, n), i + 1)
      }
    }
    await walk(this.dir(slug), 0)
  }

  // ---- advance ----

  /** Enqueues what can run now. Returns the job ids it enqueued. Safe to call at any time and any number of times. */
  advance(slug: string): Promise<string[]> {
    return this.exclusive(slug, async () => {
      const st = await this.readSteps(slug)
      if (!st) return []
      const c: Ctx = { slug, st, enq: [], q: this.d.getQuality() }
      const outcome = await this.walk(c)
      await this.writeJson(slug, 'steps.json', st)
      await this.syncStage(slug, st, outcome)
      if (c.enq.length) this.d.kick?.()
      return c.enq
    })
  }

  private async syncStage(slug: string, st: StepsFile, outcome: 'running' | 'blocked' | 'published'): Promise<void> {
    const meta = await this.svc.getCourseMeta(slug)
    const stage = outcome === 'running' ? 'running' : outcome
    if ((meta?.data as { stage?: string } | undefined)?.stage !== stage || (meta?.data as { run?: number } | undefined)?.run !== st.run) await this.svc.setCourseMeta(slug, { stage, run: st.run })
  }

  /** Enqueues the job of a step unless it is done, skipped, blocked or already in the queue. 'done' when the step is finished. */
  private async ensure(c: Ctx, spec: { task: string; role: string; unit?: string | null; round?: number; label?: string; avoidFamily?: string; extra?: Record<string, unknown> }): Promise<'done' | 'wait' | 'blocked'> {
    const unit = spec.unit ?? null
    const round = spec.round ?? 1
    const key = stepKey(spec.task, unit, round)
    const e = c.st.steps[key]
    if (e?.status === 'done' || e?.status === 'skipped') return 'done'
    if (e?.status === 'blocked') return 'blocked'
    const id = pipelineJobId(c.slug, c.st.run, spec.task, unit, round)
    const found = await this.d.jobs.find(id)
    if (found) {
      if (found.state === 'done') {
        c.st.steps[key] = { ...e, status: 'done', job: id, round, at: iso() } // the job finished but the step was not marked (a stop in between)
        return 'done'
      }
      return 'wait'
    }
    const queued = await this.d.jobs.enqueue(
      {
        id,
        task: spec.task,
        role: spec.role,
        book: c.slug,
        unit,
        round,
        requested_by: 'engine',
        label: spec.label ?? `${spec.task}${unit ? ` ${unit}` : ''}${round > 1 ? ` (round ${round})` : ''}`,
        ...(spec.avoidFamily ? { avoid_family: spec.avoidFamily } : {}),
        ...(spec.extra ?? {})
      } as NewJob,
      `Pipeline step ${key} of run ${c.st.run} for the course ${c.slug}.\n`
    )
    c.st.steps[key] = { status: 'queued', job: id, round, at: iso() }
    if (queued) c.enq.push(id)
    return 'wait'
  }

  private skip(c: Ctx, task: string, unit: string | null, note: string, round = 1): void {
    const key = stepKey(task, unit, round)
    if (c.st.steps[key]?.status === 'skipped' || c.st.steps[key]?.status === 'done') return
    c.st.steps[key] = { status: 'skipped', note, round, at: iso() }
  }

  /** Each question of the plan is asked of the researcher (idempotent) and is a step of its own. 'done' when every one is settled. */
  private async research(c: Ctx, plan: { research: { question: string; unit: number }[] }): Promise<'done' | 'wait' | 'blocked'> {
    const R = c.st.resolved
    const per = new Map<number, number>()
    const questions = plan.research.filter((r) => {
      const n = (per.get(r.unit) ?? 0) + 1
      per.set(r.unit, n)
      return n <= Math.max(1, R.researchQuestionsPerUnit)
    })
    let wait = false
    for (const r of questions) {
      const id = researchJobId(c.slug, r.question)
      const key = `research:${id.split('--')[2]}`
      const e = c.st.steps[key]
      if (e?.status === 'done' || e?.status === 'skipped') continue
      const found = await this.d.jobs.find(id)
      if (found?.state === 'done') {
        c.st.steps[key] = { status: 'done', job: id, note: r.question, at: iso() }
        continue
      }
      if (found) {
        c.st.steps[key] = { ...e, status: 'queued', job: id, note: r.question, at: e?.at ?? iso() }
        wait = true
        continue
      }
      const asked = await this.svc.research.ask({ slug: c.slug, question: r.question, askedBy: 'director', purpose: `the research for unit ${r.unit} of the course` })
      if (asked.status === 'created' || asked.status === 'exists') {
        c.st.steps[key] = { status: 'queued', job: asked.id ?? id, note: r.question, at: iso() }
        if (asked.status === 'created' && asked.id) c.enq.push(asked.id)
        wait = true
      } else {
        c.st.steps[key] = { status: 'skipped', note: `${r.question} (${asked.status === 'limit' ? 'the research limit of the course is reached' : asked.status === 'no-researcher' ? 'there is no researcher in agents/' : asked.status})`, at: iso() }
      }
    }
    return wait ? 'wait' : 'done'
  }

  private async walk(c: Ctx): Promise<'running' | 'blocked' | 'published'> {
    const { slug, st, q } = c
    const R = st.resolved

    if ((await this.ensure(c, { task: 'plan', role: 'director', label: 'plan the course' })) !== 'done') return 'running'
    const plan = await this.readJson<{ research: { question: string; unit: number }[] }>(slug, 'plan.json')
    if (!plan) return 'running'
    if ((await this.research(c, plan)) !== 'done') return 'running'
    if ((await this.ensure(c, { task: 'factbase', role: 'director', label: 'merge the research notes into the fact base' })) !== 'done') return 'running'
    if ((await this.ensure(c, { task: 'curriculum', role: 'curriculum-designer', label: 'design the curriculum' })) !== 'done') return 'running'
    if (R.language) {
      if ((await this.ensure(c, { task: 'scope', role: 'language-coach', label: 'the vocabulary and grammar of each unit' })) !== 'done') return 'running'
    } else this.skip(c, 'scope', null, 'not a language course')
    const cur = await this.curriculum(slug)
    if (!cur) return 'running'

    // ---- the units, in parallel ----
    const outcomes: ('done' | 'wait' | 'blocked')[] = []
    for (const u of cur.units) outcomes.push(await this.unitFlow(c, u.id))
    const blocked = outcomes.includes('blocked')
    if (outcomes.some((o) => o === 'wait')) return 'running' // a blocked unit does not stop the others: the run settles when none is left
    if (blocked) return this.settle(c, true)

    // ---- the whole course ----
    if ((await this.ensure(c, { task: 'design', role: 'game-designer', label: 'design the game' })) !== 'done') return 'running'
    if (R.brief.story === 'none') this.skip(c, 'story', null, 'no story asked (story: none)')
    else if ((await this.ensure(c, { task: 'story', role: 'narrative-designer', label: R.brief.story === 'frame' ? 'write the frame story' : 'hand the story to Scriptorium' })) !== 'done') return 'running'
    if ((await this.artFlow(c)) !== 'done') return 'running'
    if ((await this.musicFlow(c)) !== 'done') return 'running'

    // assemble, then the audience reviews; a revise goes through polish and assemble again
    const roles: [string, string][] = [['review_accessibility', 'accessibility-reviewer'], ...(R.kids ? ([['review_child_safety', 'child-safety-reviewer']] as [string, string][]) : [])]
    let k = 1
    for (;;) {
      const a = await this.ensure(c, { task: 'assemble', role: 'director', round: k, label: `assemble the course${k > 1 ? ` (round ${k})` : ''}` })
      if (a !== 'done') return 'running'
      const family = this.familyOf(st)
      const got: ('done' | 'wait' | 'blocked')[] = []
      for (const [task, role] of roles) got.push(await this.ensure(c, { task, role, round: k, avoidFamily: family, label: `${role} reviews the course${k > 1 ? ` (round ${k})` : ''}` }))
      if (got.includes('blocked')) return this.settle(c, true)
      if (got.includes('wait')) return 'running'
      const reviews = (await Promise.all(roles.map(([, role]) => this.readReview(slug, this.audienceName(role, k))))).filter((r): r is ReviewFile => !!r).map((r) => r.review)
      const counted = reviews.filter((r) => countsAsRevise(r, q))
      if (counted.length === 0) break
      const must = counted.filter((r) => q.must_pass.includes(r.role))
      if (k >= q.max_rounds) {
        if (must.length) {
          for (const [task, role] of roles) {
            if (must.some((r) => r.role === role)) {
              const key = stepKey(task, null, k)
              st.steps[key] = { ...st.steps[key], status: 'blocked', note: `must-pass gate: ${role} still says revise after ${k} round(s): ${counted.find((r) => r.role === role)?.notes.slice(0, 300) ?? ''}`.trim(), at: iso() }
            }
          }
          return this.settle(c, true)
        }
        break
      }
      if ((await this.ensure(c, { task: 'polish', role: 'explainer', round: k + 1, label: `polish the texts the reviewers flagged (round ${k + 1})` })) !== 'done') return 'running'
      k++
    }

    if ((await this.harvestFlow(c)) !== 'done') return 'running'
    if ((await this.voiceFlow(c)) !== 'done') return 'running'
    if ((await this.editionsFlow(c)) !== 'done') return 'running'

    for (const [task, role, label] of [
      ['build', 'director', 'build the game'],
      ['lint', 'director', 'lint the game'],
      ['playtest', 'playtester', 'play the game with the autoplay bot'],
      ['playtest_report', 'playtester', 'the playtester reads the bot results']
    ] as const) {
      if ((await this.ensure(c, { task, role, label })) !== 'done') return 'running'
    }
    const pub = await this.ensure(c, { task: 'publish', role: 'publisher', label: 'decide and publish' })
    if (pub === 'blocked') return this.settle(c, true)
    if (pub !== 'done') return 'running'
    return this.settle(c, false)
  }

  /**
   * The harvest step (EGS-36): after the audience reviews (the readings and their glossaries are final), one flashcard for each glossary entry joins the
   * course, with no model. It runs before the voice and the editions, so the cards are spoken and translated like the rest. Skipped with the reason when the
   * course has no readings.
   */
  private async harvestFlow(c: Ctx): Promise<'done' | 'wait' | 'blocked'> {
    const R = c.st.resolved
    if (!(R.reading && R.language)) {
      this.skip(c, 'harvest', null, 'the course has no readings with a glossary')
      return 'done'
    }
    return this.ensure(c, { task: 'harvest', role: 'director', label: 'make the vocabulary cards from the glossaries' })
  }

  /**
   * The editions step (EGS-32): after the voice (the last step that writes text into the pack) and before the build, the translator makes the catalog of
   * every edition that is not the source language (and not the taught language of a language course, whose catalog is the taught phrases). The pack
   * then lists them in `languages`. Skipped when there is none, with the reason.
   */
  private async editionsFlow(c: Ctx): Promise<'done' | 'wait' | 'blocked'> {
    const need = editionLanguages(c.st.resolved)
    if (need.length === 0) {
      this.skip(c, 'editions', null, c.st.resolved.languages.length > 1 ? 'no edition besides the source and the taught language' : 'one language only: no other edition to make')
      return 'done'
    }
    return this.ensure(c, { task: 'editions', role: 'translator', label: `translate the text into ${need.join(', ')}` })
  }

  /**
   * The art steps (EGS-15): the art-director plans the pictures (`art_plan`), the generators make them (`art_generate`, no model) and the
   * art-critic reviews each new version (`art_review`); a picture it sends back is made again with its note (`art_generate-k2`, then
   * `art_review-k2`), up to `max_rounds`. The critic is not a gate: a picture that is still rejected after the last round stays in the course. With
   * `media.art.review: false`, or no model with vision, the review is skipped with the reason. 'done' when the whole flow is settled.
   */
  private async artFlow(c: Ctx): Promise<'done' | 'wait'> {
    const { slug, q } = c
    const media = await this.svc.media.settings(slug)
    if (!media.art.enabled) {
      for (const t of ['art_plan', 'art_generate', 'art_review']) this.skip(c, t, null, 'media.art.enabled is false: the course has no pictures')
      return 'done'
    }
    if ((await this.ensure(c, { task: 'art_plan', role: 'art-director', label: 'plan the pictures' })) !== 'done') return 'wait'
    if ((await this.ensure(c, { task: 'art_generate', role: 'art-director', label: 'make the pictures' })) !== 'done') return 'wait'
    const critic = await this.svc.media.criticAvailable(slug)
    if (!critic.ok) {
      this.skip(c, 'art_review', null, critic.reason ?? 'the art-critic is off')
      return 'done'
    }
    for (let k = 1; ; k++) {
      if ((await this.ensure(c, { task: 'art_review', role: 'art-critic', round: k, extra: { vision: true }, label: `the art-critic looks at the pictures${k > 1 ? ` (round ${k})` : ''}` })) !== 'done') return 'wait'
      const r = await this.readJson<{ revise: { id: string; note: string }[] }>(slug, `reviews/art_review-k${k}.json`)
      if (!r?.revise?.length || k >= q.max_rounds) return 'done'
      if ((await this.ensure(c, { task: 'art_generate', role: 'art-director', round: k + 1, label: `make the pictures again with the critic's notes (round ${k + 1})` })) !== 'done') return 'wait'
    }
  }

  /**
   * The music steps (EGS-16): the composer plans the music of every area and the sound effects (`music_plan`), the generators make them
   * (`music_generate`, no model: Chiptune Studio, ComfyUI ACE-Step, Flow Music only on an explicit opt-in). A provider that is down gives silent
   * placeholders and a note, never a failed run. With `media.music.enabled: false` both steps are skipped. 'done' when the flow is settled.
   */
  private async musicFlow(c: Ctx): Promise<'done' | 'wait'> {
    const media = await this.svc.media.settings(c.slug)
    if (!media.music.enabled) {
      for (const t of ['music_plan', 'music_generate']) this.skip(c, t, null, 'media.music.enabled is false: the course has no music and no sound effects')
      return 'done'
    }
    if ((await this.ensure(c, { task: 'music_plan', role: 'composer', label: 'plan the music and the sound effects' })) !== 'done') return 'wait'
    if ((await this.ensure(c, { task: 'music_generate', role: 'composer', label: 'make the music and the sound effects' })) !== 'done') return 'wait'
    return 'done'
  }

  /**
   * The voice steps (EGS-17): the voice-director plans what is spoken (`voice_plan`: narration, the listening items and the ones derived from taught
   * phrases), the providers speak it by the hub's allocation rule (`voice_generate`, no model: Gemini within the day's quota, VibeTTS, ComfyUI TTS). They run
   * after the audience reviews, so the clips speak the final text, and re-link the pack before the build. Providers that are down give silent
   * placeholders and a note, never a failed run. Skipped when the voice step is off for the course. 'done' when the flow is settled.
   */
  private async voiceFlow(c: Ctx): Promise<'done' | 'wait'> {
    const on = await this.svc.voice.enabled(c.slug)
    if (!on.enabled) {
      for (const t of ['voice_plan', 'voice_generate']) this.skip(c, t, null, on.media.voice.enabled === false ? 'media.voice.enabled is false: the course has no spoken clips' : 'not a language course and media.voice.enabled is not true: no narration or listening audio is made')
      return 'done'
    }
    if ((await this.ensure(c, { task: 'voice_plan', role: 'voice-director', label: 'plan the narration and the listening audio' })) !== 'done') return 'wait'
    if ((await this.ensure(c, { task: 'voice_generate', role: 'voice-director', label: 'speak the clips and link them into the course' })) !== 'done') return 'wait'
    return 'done'
  }

  /** The run is over (published or blocked): the director's summary, then the outcome. */
  private async settle(c: Ctx, blocked: boolean): Promise<'blocked' | 'published'> {
    await this.ensure(c, { task: 'summarize', role: 'director', label: 'summarize the run' })
    return blocked ? 'blocked' : 'published'
  }

  /** The model family that wrote the content of the course (the items' writer): reviewers prefer another one. */
  private familyOf(st: StepsFile): string | undefined {
    for (const [k, e] of Object.entries(st.steps)) if (k.startsWith('items:') && e.family) return e.family
    return undefined
  }

  private async unitFlow(c: Ctx, U: string): Promise<'done' | 'wait' | 'blocked'> {
    const { slug, st, q } = c
    const R = st.resolved
    const w = async (spec: { task: string; role: string; round?: number; avoidFamily?: string; label: string }) => this.ensure(c, { ...spec, unit: U })
    if ((await w({ task: 'articles', role: 'subject-expert', label: `articles of ${U}` })) !== 'done') return 'wait'
    if ((await w({ task: 'items', role: 'item-writer', label: `items of ${U}` })) !== 'done') return 'wait'
    if ((await w({ task: 'distractors', role: 'misconception-designer', label: `wrong choices of ${U}` })) !== 'done') return 'wait'
    let k = 1
    for (;;) {
      const fc = await w({ task: 'fact_check', role: 'fact-checker', round: k, avoidFamily: st.steps[stepKey('items', U, 1)]?.family, label: `fact-check ${U}${k > 1 ? ` (round ${k})` : ''}` })
      if (fc === 'blocked') return 'blocked'
      if (fc !== 'done') return 'wait'
      const rf = await this.readReview(slug, this.factCheckName(U, k))
      const review = rf?.review
      if (!review || !countsAsRevise(review, q)) break
      if (k >= q.max_rounds) {
        if (q.must_pass.includes(review.role)) {
          const key = stepKey('fact_check', U, k)
          st.steps[key] = { ...st.steps[key], status: 'blocked', note: `must-pass gate: ${review.role} still says revise for ${U} after ${k} round(s): ${review.notes.slice(0, 300)}`.trim(), at: iso() }
          return 'blocked'
        }
        break
      }
      const next = k + 1
      const flagged = await this.flagged(slug, U, review)
      let wait = false
      if (flagged.articles.length) {
        if ((await w({ task: 'articles_revise', role: 'subject-expert', round: next, label: `correct the articles of ${U} (round ${next})` })) !== 'done') wait = true
      } else this.skip(c, 'articles_revise', U, 'no article was flagged', next)
      if (flagged.items.length) {
        if ((await w({ task: 'items_revise', role: 'item-writer', round: next, label: `correct the items of ${U} (round ${next})` })) !== 'done') wait = true
      } else this.skip(c, 'items_revise', U, 'no item was flagged', next)
      if (wait) return 'wait'
      if (flagged.items.length && (await w({ task: 'distractors', role: 'misconception-designer', round: next, label: `wrong choices of ${U} (round ${next})` })) !== 'done') return 'wait'
      k = next
    }
    if ((await w({ task: 'explain', role: 'explainer', label: `feedback of ${U}` })) !== 'done') return 'wait'
    if (R.language) {
      if ((await w({ task: 'accepted', role: 'language-coach', label: `accepted answers of ${U}` })) !== 'done') return 'wait'
    } else this.skip(c, 'accepted', U, 'not a language course')
    return 'done'
  }

  /** The ids a fact-check review flagged: articles and items (a review that names none flags every item). */
  async flagged(slug: string, unit: string, review: ReviewResult): Promise<{ articles: string[]; items: string[] }> {
    const articleIds = new Set((await this.articles(slug, unit)).map((a) => a.id))
    const itemIds = new Set((await this.items(slug, unit)).map((i) => i.id))
    const refs = [...new Set(review.problems.map((p) => p.ref))]
    const articles = refs.filter((r) => articleIds.has(r))
    const items = refs.filter((r) => itemIds.has(r))
    if (articles.length === 0 && items.length === 0) return { articles: [], items: [...itemIds] }
    return { articles, items }
  }

  // ---- the decision ----

  /** The publisher's decision from the files of the run. */
  async decision(slug: string): Promise<{ decision: Decision; reviews: ReviewResult[] }> {
    const st = await this.requireSteps(slug)
    const cur = await this.curriculum(slug)
    const reviews: ReviewResult[] = []
    for (const u of cur?.units ?? []) {
      for (let k = 12; k >= 1; k--) {
        const r = await this.readReview(slug, this.factCheckName(u.id, k))
        if (r) {
          reviews.push(r.review)
          break
        }
      }
    }
    for (const role of ['accessibility-reviewer', ...(st.resolved.kids ? ['child-safety-reviewer'] : [])]) {
      for (let k = 12; k >= 1; k--) {
        const r = await this.readReview(slug, this.audienceName(role, k))
        if (r) {
          reviews.push(r.review)
          break
        }
      }
    }
    const report = await this.readJson<{ review: ReviewResult }>(slug, 'report.json')
    if (report) reviews.push(report.review)
    const lint = await this.readJson<{ errors: number; problems?: { code: string; path: string }[] }>(slug, 'lint.json')
    const play = await this.readJson<{ ok: boolean; failures?: string[] }>(slug, 'playtest.json')
    return { decision: publishDecision(reviews, this.d.getQuality(), lint, play), reviews }
  }

  // ---- looking ----

  /** The run as `edu_status` shows it: every step with its status (a failed job is `failed`, with the text), and why a blocked run is blocked. */
  async status(slug: string): Promise<PipelineView | null> {
    const st = await this.readSteps(slug)
    if (!st) return null
    const meta = await this.svc.getCourseMeta(slug)
    const steps: PipelineStepView[] = []
    const failed: { step: string; job: string; failure: string }[] = []
    const blockedBy: string[] = []
    for (const [key, e] of Object.entries(st.steps)) {
      let status: PipelineStepView['status'] = e.status
      let failure: string | undefined
      if (e.status === 'queued' && e.job) {
        const state: JobState | undefined = (await this.d.jobs.find(e.job))?.state
        if (state === 'running') status = 'running'
        else if (state === 'failed') {
          status = 'failed'
          const job = await this.d.jobs.read('failed', e.job)
          failure = String((job?.data as Record<string, unknown> | undefined)?.failure ?? '')
          failed.push({ step: key, job: e.job, failure })
        } else if (state === 'done') status = 'done'
      }
      if (e.status === 'blocked' && e.note) blockedBy.push(`${key}: ${e.note}`)
      steps.push({ step: key, status, ...(e.round && e.round > 1 ? { round: e.round } : {}), ...(e.job ? { job: e.job } : {}), ...(e.note ? { note: e.note } : {}), ...(failure ? { failure } : {}) })
    }
    const publish = await this.readJson<{ published: boolean; reasons?: string[] }>(slug, 'publish.json')
    if (publish && !publish.published) for (const r of publish.reasons ?? []) if (!blockedBy.some((b) => b.includes(r))) blockedBy.push(`publish: ${r}`)
    let stage = String((meta?.data as { stage?: string } | undefined)?.stage ?? 'running')
    if (failed.length && stage === 'running') stage = 'failed'
    const next =
      stage === 'published'
        ? 'The course is published: open courses/' + slug + '/build/index.html to play it.'
        : stage === 'blocked'
          ? 'The run is blocked (see blockedBy). Fix the cause, then edu_run_pipeline {slug, restart: true, from: <stage>} (stages: ' + STAGES.join(', ') + ').'
          : failed.length
            ? 'A job failed for good (see failed). edu_run_pipeline {slug, retry: true} puts the failed jobs back in the queue.'
            : 'The run is going: edu_wait {slug} waits for it (and tells you when a model call waits for you).'
    return { run: st.run, stage, steps, ...(blockedBy.length ? { blockedBy } : {}), ...(failed.length ? { failed } : {}), next }
  }
}
