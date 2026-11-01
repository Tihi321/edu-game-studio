import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { publishDecision, pipelineJobId } from '../src/engine/edu/pipeline'
import type { StepsFile } from '../src/engine/edu/pipeline'
import type { ReviewResult } from '../src/engine/review/scoring'
import { validateCourse } from '../src/shared/edu'
import { briefSchema, resolveBrief } from '../src/shared/brief'
import { formatsSchema, qualitySchema } from '../src/shared/schemas'
import { failures } from './edu-helpers'
import { BRIEF, courseFile, json, makePipelineEnv, pf, pipelineOf, run, SLUG, statusOf, toolsOf } from './pipeline-helpers'

describe('the brief', () => {
  const formats = formatsSchema.parse({ kind: 'formats', formats: [{ id: 'quick', label: 'Quick', units: 2 }, { id: 'language-a1', label: 'Language', units: 4, language: true, cefr: 'A1' }] }).formats

  it('has defaults, and kids follows the age; the format sizes the course and the brief overrides it; a bad brief is refused in words', () => {
    expect(briefSchema.safeParse({ audience: 'x' }).success).toBe(false)
    expect(() => resolveBrief({ topic: 'Rome', audience: 'adults', format: 'epic' }, formats)).toThrow(/no course format "epic" in config\/formats\.md \(formats: quick, language-a1\)/)
    expect(briefSchema.safeParse({ topic: 'Rome', audience: 'adults', model: 'claude' }).error?.issues[0]?.message).toMatch(/provider\/model/)
    const b = briefSchema.parse({ topic: 'Volcanoes', audience: 'children', age: 9 })
    expect(b).toMatchObject({ sourceLang: 'en', shells: ['quiz-arena'], story: 'none' })
    const r = resolveBrief(b, formats)
    expect(r).toMatchObject({ units: 2, objectivesPerUnit: 3, itemsPerObjective: 3, articlesPerUnit: 1, kids: true, language: false, languages: ['en'] })
    expect(resolveBrief({ ...b, age: 14, units: 5, objectivesPerUnit: 2 }, formats)).toMatchObject({ units: 5, objectivesPerUnit: 2, kids: false })
    expect(resolveBrief({ ...b, age: 14, kids: true }, formats).kids).toBe(true)
    expect(resolveBrief({ topic: 'Rome', audience: 'adults' }, formats).kids).toBe(false)
    const lang = resolveBrief({ topic: 'Croatian', audience: 'adults', targetLang: 'hr', sourceLang: 'en', languages: ['hr', 'de'] }, formats)
    expect(lang).toMatchObject({ units: 4, language: true, cefr: 'A1', languages: ['en', 'hr', 'de'] })
  })

  it('a language brief picks language-<cefr> (A1, A2, B1); C1 and C2 without a format fail in words, B2 has its own format (EGS-36); the verb-unit numbers come with the format (EGS-29)', async () => {
    const { readFile } = await import('node:fs/promises')
    const { parseMdWith } = await import('../src/shared/md')
    const seedFormats = parseMdWith(await readFile('seed/config/formats.md', 'utf8'), formatsSchema).data.formats
    const b = { topic: 'German', audience: 'adults', sourceLang: 'hr', targetLang: 'de' }
    expect(resolveBrief(b, seedFormats)).toMatchObject({ format: { id: 'language-a1' }, units: 4, verbUnits: 1, verbsPerUnit: 6, language: true })
    expect(resolveBrief({ ...b, cefr: 'A1' }, seedFormats).format.id).toBe('language-a1')
    expect(resolveBrief({ ...b, cefr: 'A2' }, seedFormats)).toMatchObject({ format: { id: 'language-a2' }, units: 5, itemsPerObjective: 4, verbUnits: 2, cefr: 'A2' })
    expect(resolveBrief({ ...b, cefr: 'B1' }, seedFormats)).toMatchObject({ format: { id: 'language-b1' }, units: 6, articlesPerUnit: 2, verbUnits: 2 })
    expect(resolveBrief({ ...b, cefr: 'A2', units: 1 }, seedFormats).verbUnits).toBe(1)
    expect(resolveBrief({ ...b, cefr: 'B2' }, seedFormats)).toMatchObject({ format: { id: 'language-b2' }, units: 6, itemsPerObjective: 5, articlesPerUnit: 2, verbUnits: 1, cefr: 'B2', reading: true, readingWords: [350, 700], glossaryPerText: [10, 20] })
    expect(resolveBrief({ ...b, cefr: 'B1' }, seedFormats)).toMatchObject({ reading: true, readingWords: [200, 400], glossaryPerText: [6, 12] })
    expect(resolveBrief({ ...b, cefr: 'A2' }, seedFormats).reading).toBe(false)
    expect(resolveBrief({ topic: 'Rome', audience: 'adults', format: 'language-b2' }, seedFormats).reading).toBe(false) // not a language course: no readings
    expect(() => resolveBrief({ ...b, cefr: 'C1' }, seedFormats)).toThrow(/out of scope \(HUB-22\)/)
    expect(() => resolveBrief({ ...b, cefr: 'C2' }, seedFormats)).toThrow(/out of scope \(HUB-22\)/)
    expect(resolveBrief({ ...b, cefr: 'C1', format: 'language-b1' }, seedFormats).format.id).toBe('language-b1') // a named format wins
    expect(resolveBrief({ topic: 'Rome', audience: 'adults', cefr: 'B2' }, seedFormats).format.id).toBe('quick') // not a language course
    // conjugation is an authored kind since EGS-27: the language formats ask the item-writer for it, the other formats do not list it
    expect(seedFormats.find((x) => x.id === 'language-a1')!.item_kinds).toContain('conjugation')
    expect(resolveBrief(b, seedFormats).itemKinds).toContain('conjugation')
    expect(resolveBrief({ topic: 'Rome', audience: 'adults' }, seedFormats).itemKinds).not.toContain('conjugation')
    expect(resolveBrief({ topic: 'Rome', audience: 'adults' }, seedFormats).verbUnits).toBe(0)
  })
})

describe('the publisher\'s decision: hard gates and must-pass reviewers', () => {
  const q = qualitySchema.parse({ kind: 'quality' })
  const good: ReviewResult[] = [
    { role: 'fact-checker', verdict: 'pass' as const, scores: { accuracy: 9 }, notes: '', problems: [] },
    { role: 'accessibility-reviewer', verdict: 'pass' as const, scores: { accessibility: 9, readability: 9 }, notes: '', problems: [] },
    { role: 'playtester', verdict: 'pass' as const, scores: { flow: 9, difficulty: 8 }, notes: '', problems: [] }
  ]
  it('publishes with a clean lint and a passing bot; lint errors, a failed bot, a missing lint or a must-pass revise reject, each with its reason', () => {
    expect(publishDecision(good, q, { errors: 0 }, { ok: true }).publish).toBe(true)
    const lint = publishDecision(good, q, { errors: 2, problems: [{ code: 'ITEM_NO_KEY', path: 'items[3]' }] }, { ok: true })
    expect(lint.publish).toBe(false)
    expect(lint.reasons).toEqual(['hard gate failed: lint: 2 error(s): ITEM_NO_KEY at items[3]'])
    const bot = publishDecision(good, q, { errors: 0 }, { ok: false, failures: ['perfect: the game was not finished'] })
    expect(bot.reasons).toEqual(['hard gate failed: playtest: perfect: the game was not finished'])
    expect(publishDecision(good, q, undefined, undefined).reasons).toEqual(['hard gate failed: lint: the game was not linted', 'hard gate failed: playtest: the game was not played by the autoplay bot'])
    const must = publishDecision([{ ...good[0]!, verdict: 'revise' as const, notes: 'wrong key' }, ...good.slice(1)], q, { errors: 0 }, { ok: true })
    expect(must.reasons[0]).toMatch(/must-pass gate failed: fact-checker says revise. wrong key/)
  })
})

describe('the whole pipeline on the mock team', () => {
  it('a brief becomes a published course in one edu_run_pipeline call: every step done, the pack valid, the lint clean, every item and article resting on facts', async () => {
    const env = await makePipelineEnv()
    try {
      const { started, failed, slug } = await run(env)
      expect(slug).toBe(SLUG)
      expect(started).toMatchObject({ run: 1, created: true, enqueued: [pipelineJobId(SLUG, 1, 'plan', null)] })
      expect(failed).toEqual([])
      expect(await failures(env)).toEqual([])
      const p = await pipelineOf(env)
      expect(p).toMatchObject({ run: 1, stage: 'published' })
      expect(p.next).toMatch(/published/)
      const bad = p.steps.filter((s) => !['done', 'skipped'].includes(s.status))
      expect(bad).toEqual([])
      expect(p.steps.filter((s) => s.status === 'skipped').map((s) => s.step).sort()).toEqual(['accepted:u1', 'accepted:u2', 'art_review:all', 'editions:all', 'harvest:all', 'scope:all', 'story:all', 'voice_generate:all', 'voice_plan:all'])
      expect(p.steps.find((s) => s.step === 'art_review:all')!.note).toMatch(/no model with vision/) // the mock model has no vision: the art-critic is skipped, with the reason
      expect(statusOf(p, 'music_plan:all')).toBe('done')
      expect(statusOf(p, 'music_generate:all')).toBe('done')
      expect(p.steps.find((s) => s.step === 'voice_plan:all')!.note).toMatch(/not a language course/) // narration is opt-in: a course that is not a language course skips the voice steps
      expect(statusOf(p, 'art_plan:all')).toBe('done')
      expect(statusOf(p, 'art_generate:all')).toBe('done')

      // the files of the course
      const meta = await env.engine.edu.getCourseMeta(slug)
      expect(meta!.data).toMatchObject({ kind: 'course', stage: 'published', run: 1, brief: { topic: 'The Roman Empire', units: 2 } })
      expect(meta!.body).toMatch(/## Run 1: \d{4}-\d\d-\d\d\n\nThe course was built and published/)
      const publish = await json<{ published: boolean; score: number; blurb: string }>(pf(env, 'publish.json'))
      expect(publish).toMatchObject({ published: true, blurb: expect.stringContaining('friendly rounds') })
      expect(publish.score).toBeGreaterThanOrEqual(7)
      const steps = await json<StepsFile>(pf(env, 'steps.json'))
      expect(steps.run).toBe(1)
      expect(steps.resolved).toMatchObject({ units: 2, objectivesPerUnit: 3, itemsPerObjective: 3, kids: false })

      // the pack: valid, rests on the fact base, lints clean
      const pack = await json<{ items: { id: string; extensions: { facts: string[] } }[]; encyclopedia: { articles: { id: string; citations: string[] }[] }; factbase: { id: string }[]; units: unknown[]; extensions: { pipeline: { run: number; generatedBy: string } } }>(courseFile(env, slug, 'course', 'pack.json'))
      const catalog = await json<{ strings: Record<string, string> }>(courseFile(env, slug, 'course', 'text', 'en.json'))
      expect(validateCourse(pack, { en: { schema: 1, lang: 'en', ...catalog } }).problems).toEqual([])
      const ids = new Set(pack.factbase.map((f) => f.id))
      expect(ids.size).toBe(8)
      expect(pack.units).toHaveLength(2)
      expect(pack.items).toHaveLength(18)
      for (const it of pack.items) {
        expect(it.extensions.facts.length, it.id).toBeGreaterThan(0)
        for (const f of it.extensions.facts) expect(ids.has(f), `${it.id} ${f}`).toBe(true)
      }
      expect(pack.encyclopedia.articles).toHaveLength(2)
      for (const a of pack.encyclopedia.articles) expect(a.citations.length, a.id).toBeGreaterThan(0)
      // the units are written in parallel, yet each unit's first article links to the other unit's: the planned ids (a-u<n>-1) were in the prompt, no repair round was needed
      const related = pack.encyclopedia.articles as unknown as { id: string; related: string[] }[]
      for (const x of related) expect(related.find((o) => o.id !== x.id)!.id, x.id).toBeTruthy()
      expect(related.map((x) => x.related)).toEqual([['a-u2-1'], ['a-u1-1']])
      expect(env.author.calls.filter((x) => x.startsWith('subject-expert/articles:'))).toHaveLength(2)
      expect(pack.extensions.pipeline).toMatchObject({ run: 1, generatedBy: 'edu-pipeline' })
      expect(await json(pf(env, 'lint.json'))).toMatchObject({ ok: true, errors: 0, warnings: 0 })
      expect((await readdir(courseFile(env, slug, 'build'))).sort()).toEqual(expect.arrayContaining(['game-data.json', 'index.html', 'player.js']))

      // what the roles were asked, once each (the two units in parallel)
      const c = env.author.calls
      for (const once of ['director/plan_brief', 'curriculum-designer/curriculum', 'game-designer/design', 'accessibility-reviewer/review:k1', 'playtester/report', 'publisher/publish', 'director/summarize_run']) expect(c.filter((x) => x === once), once).toHaveLength(1)
      for (const u of ['u1', 'u2']) for (const t of ['subject-expert/articles', 'item-writer/items', 'misconception-designer/distractors', 'explainer/explain']) expect(c, `${t} ${u}`).toContain(`${t}:${u}`)
      expect(c.some((x) => x.startsWith('child-safety'))).toBe(false) // a course for teenagers needs no child-safety review
      expect(env.counters.searches).toHaveLength(4) // two questions per unit, as the format says
      // reviewers asked for another family than the writers (here every model is the same one: the record is what counts)
      expect(steps.steps['items:u1']!.family).toBeTruthy()
    } finally {
      await env.cleanup()
    }
  }, 90_000)

  it('a course for children has the child-safety review, and the audience age is in every prompt', async () => {
    const env = await makePipelineEnv()
    try {
      const { failed } = await run(env, { ...BRIEF, topic: 'Volcanoes', age: 9, audience: 'children' })
      expect(failed).toEqual([])
      expect(env.author.calls).toContain('child-safety-reviewer/review:k1')
      expect((await toolsOf(env).call('edu_status', { slug: 'volcanoes' })).data.pipeline).toMatchObject({ stage: 'published' })
    } finally {
      await env.cleanup()
    }
  }, 60_000)

  it('a language course: scope and accepted answers, taught answers in the target-language catalog', async () => {
    const env = await makePipelineEnv()
    try {
      const { failed, slug } = await run(env, { topic: 'Croatian greetings', audience: 'adults', age: 30, sourceLang: 'en', targetLang: 'hr', cefr: 'A1', units: 2 })
      expect(failed).toEqual([])
      expect(slug).toBe('croatian-greetings')
      const p = (await toolsOf(env).call('edu_status', { slug })).data.pipeline as { stage: string; steps: { step: string; status: string }[] }
      expect(p.stage).toBe('published')
      expect(p.steps.filter((s) => ['scope:all', 'accepted:u1', 'accepted:u2'].includes(s.step)).map((s) => s.status)).toEqual(['done', 'done', 'done'])
      expect(env.author.calls).toEqual(expect.arrayContaining(['language-coach/scope', 'language-coach/accepted']))
      const hr = await json<{ strings: Record<string, string>; accepted: Record<string, string[]> }>(courseFile(env, slug, 'course', 'text', 'hr.json'))
      expect(Object.keys(hr.accepted).length).toBeGreaterThan(0)
      const pack = await json<{ targetLang: string; cefr: string; extensions: { language?: { verbUnits: string[]; verbsPerUnit: number } } }>(courseFile(env, slug, 'course', 'pack.json'))
      expect(pack).toMatchObject({ targetLang: 'hr', cefr: 'A1' })
      // the verb unit of the format is marked in the curriculum and gets verbs in the scope (EGS-29)
      expect(pack.extensions.language).toEqual({ verbUnits: ['u1'], verbsPerUnit: 6 })
      const scope = await json<{ units: { unit: string; verbs?: unknown[] }[] }>(courseFile(env, slug, 'pipeline', 'scope.json'))
      expect(scope.units.map((u) => u.verbs?.length ?? 0)).toEqual([1, 0])
    } finally {
      await env.cleanup()
    }
  }, 90_000)
})

describe('revise loops and gates', () => {
  it('a fact-check revise in round 1 sends the unit to items_revise, round 2 passes, the course publishes; round-2 job ids have -k2', async () => {
    const env = await makePipelineEnv({ factCheck: (unit, round) => (unit === 'u1' && round === 1 ? 'revise' : 'pass') })
    try {
      const { failed } = await run(env)
      expect(failed).toEqual([])
      const p = await pipelineOf(env)
      expect(p.stage).toBe('published')
      const jobs = p.steps.map((s) => s.job).filter(Boolean)
      for (const id of ['items_revise-k2--u1', 'distractors-k2--u1', 'fact_check-k2--u1']) expect(jobs, id).toContain(`${SLUG}--${id}--r1`)
      expect(statusOf(p, 'articles_revise-k2:u1')).toBe('skipped') // no article was flagged
      expect(statusOf(p, 'items_revise-k2:u1')).toBe('done')
      expect(p.steps.some((s) => s.step.endsWith(':u2') && s.step.includes('-k2'))).toBe(false) // the other unit passed at once
      expect(env.author.calls).toEqual(expect.arrayContaining(['item-writer/items_revise:u1', 'misconception-designer/distractors:u1', 'fact-checker/fact_check:u1:k2']))
      // the round-1 review is kept and the final course has the corrected items
      expect((await json<{ review: { verdict: string } }>(pf(env, 'reviews', 'fact_check-u1-k1-fact-checker.json'))).review.verdict).toBe('revise')
      const items = await json<{ items: { id: string; prompt: string }[] }>(pf(env, 'units', 'u1', 'items.json'))
      expect(items.items.some((i) => /\(corrected\)/.test(i.prompt))).toBe(true)
      expect(items.items).toHaveLength(9)
    } finally {
      await env.cleanup()
    }
  }, 90_000)

  it('a must-pass reviewer that always says revise stops the publish after max_rounds: stage blocked, publish never ran, the reasons name the role, the director explains', async () => {
    const env = await makePipelineEnv({ factCheck: (unit) => (unit === 'u2' ? 'revise' : 'pass') })
    try {
      const { failed } = await run(env)
      expect(failed).toEqual([])
      const p = await pipelineOf(env)
      expect(p.stage).toBe('blocked')
      expect(p.blockedBy).toEqual([expect.stringMatching(/^fact_check-k2:u2: must-pass gate: fact-checker still says revise for u2 after 2 round\(s\)/)])
      expect(p.next).toMatch(/blocked.*restart: true, from/)
      expect(statusOf(p, 'fact_check-k2:u2')).toBe('blocked')
      expect(p.steps.some((s) => ['design:all', 'assemble:all', 'publish:all'].includes(s.step))).toBe(false)
      expect(statusOf(p, 'summarize:all')).toBe('done') // the director explains the block
      expect(statusOf(p, 'explain:u1')).toBe('done') // the other unit went on to the end
      expect(env.author.count('fact-checker/fact_check:u2')).toBe(2) // max_rounds: 2
      expect(await env.engine.edu.getCourseMeta(SLUG)).toMatchObject({ data: { stage: 'blocked' } })
      await expect(readFile(pf(env, 'publish.json'), 'utf8')).rejects.toThrow()
    } finally {
      await env.cleanup()
    }
  }, 90_000)

  it('an audience review that says revise goes through polish and assemble again; round 2 passes and the polished text is in the course', async () => {
    const env = await makePipelineEnv({ review: (role, round) => (round === 1 ? 'revise' : 'pass') })
    try {
      const { failed } = await run(env)
      expect(failed).toEqual([])
      const p = await pipelineOf(env)
      expect(p.stage).toBe('published')
      for (const key of ['review_accessibility:all', 'polish-k2:all', 'assemble-k2:all', 'review_accessibility-k2:all']) expect(statusOf(p, key), key).toBe('done')
      expect(env.author.calls).toEqual(expect.arrayContaining(['explainer/polish', 'accessibility-reviewer/review:k2']))
      const polish = await json<{ strings: Record<string, string> }>(pf(env, 'polish.json'))
      const keys = Object.keys(polish.strings)
      expect(keys.length).toBeGreaterThan(0)
      const catalog = await json<{ strings: Record<string, string> }>(courseFile(env, SLUG, 'course', 'text', 'en.json'))
      expect(catalog.strings[keys[0]!]).toMatch(/\(polished\)$/)
      expect(await json(pf(env, 'lint.json'))).toMatchObject({ ok: true })
    } finally {
      await env.cleanup()
    }
  }, 90_000)
})

