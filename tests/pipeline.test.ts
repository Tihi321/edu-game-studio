import { readFile, readdir, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { publishDecision, pipelineJobId } from '../src/engine/edu/pipeline'
import type { StepsFile } from '../src/engine/edu/pipeline'
import type { ReviewResult } from '../src/engine/review/scoring'
import { lintGameData } from '../src/engine/edu/lint'
import { validateCourse } from '../src/shared/edu'
import { briefSchema, resolveBrief } from '../src/shared/brief'
import { formatsSchema, qualitySchema } from '../src/shared/schemas'
import { failures, waitIdle } from './edu-helpers'
import { BRIEF, courseFile, json, makePipelineEnv, pf, pipelineOf, run, SLUG, statusOf, toolsOf } from './pipeline-helpers'
import type { PipelineEnv } from './pipeline-helpers'

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
      expect(p.steps.filter((s) => s.status === 'skipped').map((s) => s.step).sort()).toEqual(['accepted:u1', 'accepted:u2', 'art_review:all', 'editions:all', 'harvest:all', 'scenes:all', 'scope:all', 'story:all', 'voice_generate:all', 'voice_plan:all'])
      expect(p.steps.find((s) => s.step === 'scenes:all')!.note).toBe('not a language course') // no role-play scenes for a course that teaches no language
      expect(env.author.calls.some((x) => x.startsWith('scene-writer/'))).toBe(false)
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
  })

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
  })

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
  })
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
  })

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
  })

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
  })
})

describe('role-play scenes in the pipeline (EGS-55, HUB-23)', () => {
  const DE = { topic: 'German basics', audience: 'adults', age: 30, sourceLang: 'hr', languages: ['hr', 'en'], targetLang: 'de', cefr: 'A1', units: 2, story: 'none' }
  type Cat = { schema: 1; lang: string; strings: Record<string, string>; accepted?: Record<string, string[]> }
  type Line = { id: string; say?: string; text?: string; reply?: string; help?: string }
  type Pack = {
    items: { id: string; kind: string; tags: string[]; extensions: { facts: string[] } }[]
    shells: { enabled: string[]; config: { roleplay?: { speakers: { id: string; name: string; learner: boolean }[]; scenes: { id: string; unit?: string; title: string; lines: Line[] }[]; garden: { id: string; text: string; gloss: string; item: string }[]; finale: string } } }
    extensions: { pipeline: { requestedShells?: string[] } }
  }
  const stepsFile = (env: PipelineEnv, slug: string, ...p: string[]) => courseFile(env, slug, 'pipeline', ...p)

  it('a German A1 course gets a valid role-play section: scenes per unit and a finale, German in de.json, translations in hr and en, late reply items with accepted lists; a revise round; a restart from scenes changes nothing', async () => {
    const env = await makePipelineEnv({ sceneCheck: (unit, round) => (unit === 'u1' && round === 1 ? 'revise' : 'pass') })
    try {
      const { failed, slug } = await run(env, DE, 90_000)
      expect(failed).toEqual([])
      expect(slug).toBe('german-basics')
      const view = async () => (await toolsOf(env).call('edu_status', { slug })).data.pipeline as Awaited<ReturnType<typeof pipelineOf>>
      let p = await view()
      expect(p.stage, JSON.stringify(p.blockedBy)).toBe('published')
      for (const k of ['scenes:u1', 'scenes:u2', 'scenes:all', 'scenes_check:u1', 'scenes_revise-k2:u1', 'scenes_check-k2:u1', 'scenes_check:u2', 'scenes_check:all', 'scenes_accepted:u1', 'scenes_accepted:u2']) expect(statusOf(p, k), k).toBe('done')
      expect(p.steps.some((x) => x.step.startsWith('scenes_revise') && x.step.endsWith(':u2'))).toBe(false) // only the unit that was sent back is revised
      expect(statusOf(p, 'scenes_accepted:all')).toBeUndefined() // the finale adds no item
      expect(env.author.calls).toEqual(expect.arrayContaining(['scene-writer/scenes:u1', 'scene-writer/scenes:u2', 'scene-writer/scenes:finale', 'scene-writer/scenes_revise:u1', 'fact-checker/scenes_check:u1:k1', 'fact-checker/scenes_check:u1:k2', 'fact-checker/scenes_check:finale:k1']))

      // the section: valid, no lint error (no RP_* error), enabled although the brief never named the shell
      const dir = (...x: string[]) => courseFile(env, slug, 'course', ...x)
      const pack = await json<Pack>(dir('pack.json'))
      const [hr, en, de] = await Promise.all([json<Cat>(dir('text', 'hr.json')), json<Cat>(dir('text', 'en.json')), json<Cat>(dir('text', 'de.json'))])
      expect(validateCourse(pack, { hr, en, de }).problems).toEqual([])
      const game = await json<Parameters<typeof lintGameData>[0]>(courseFile(env, slug, 'build', 'game-data.json'))
      expect(lintGameData(game, () => true).filter((x) => x.severity === 'error')).toEqual([])
      expect(pack.shells.enabled).toContain('roleplay')
      expect(pack.extensions.pipeline.requestedShells ?? []).not.toContain('roleplay')
      const rp = pack.shells.config.roleplay!
      expect(rp.scenes.map((x) => [x.id, x.unit])).toEqual([['u1-s1', 'u1'], ['u2-s1', 'u2'], ['finale', undefined]])
      expect(rp.finale).toBe('finale')
      expect(rp.scenes.map((x) => x.lines.length)).toEqual([10, 10, 12])
      expect(rp.speakers.filter((x) => x.learner)).toHaveLength(1)
      // each unit's writer sees the speakers of the units before it: a later unit's character never takes an earlier one's id (and so its name)
      const said = (i: number) => new Set(rp.scenes[i]!.lines.flatMap((l) => (l.say ? [l.say] : [])))
      expect([...said(1)].filter((id) => said(0).has(id))).toEqual([])
      expect(hr.strings[rp.scenes[0]!.title]).toBe('Scene 1 of u1 (corrected)') // the revised scene is the one in the course

      // German lines in de.json only; translations, help and names in the source catalog and (translated) the english edition
      const say = rp.scenes[0]!.lines.find((l) => l.say)!
      expect(de.strings[say.text!]).toBe('Wir sagen bok, Satz 1.')
      expect(hr.strings[say.text!]).toBeUndefined()
      expect(en.strings[say.text!]).toBeUndefined()
      expect(hr.strings[`${say.text}.tr`]).toBe('Line 1.')
      expect(en.strings[`${say.text}.tr`]).toBe('[English] Line 1.')
      const reply = rp.scenes[0]!.lines.find((l) => l.reply)!
      expect(hr.strings[reply.help!]).toBe('Say it simply (3).')
      expect(en.strings[reply.help!]).toBe('[English] Say it simply (3).')
      expect(hr.strings['rp.sp.anna']).toBe('Anna')
      expect(de.strings['rp.sp.anna']).toBeUndefined()

      // the late items: tagged scene, ids rp-<unit>-<n>, in the pack; the typed ones have an accepted list widened by the coach, in the German catalog
      const late = pack.items.filter((i) => i.tags.includes('scene'))
      expect(late.map((i) => i.id).sort()).toEqual(['rp-u1-1', 'rp-u1-2', 'rp-u2-1', 'rp-u2-2']) // a typed and a choice reply per scene; the third reply reuses an item of the unit
      for (const i of late.filter((x) => x.kind === 'typed')) {
        expect(de.accepted![`item.${i.id}.answer`]!.length, i.id).toBeGreaterThan(1)
        expect(hr.accepted?.[`item.${i.id}.answer`]).toBeUndefined()
      }
      expect(late.every((i) => i.extensions.facts.length > 0)).toBe(true)
      // every reply points at an item of the pack; the garden is derived in code (the scope vocabulary) and watered by an item of the pack
      const ids = new Set(pack.items.map((i) => i.id))
      for (const l of rp.scenes.flatMap((x) => x.lines)) if (l.reply) expect(ids.has(l.reply), l.reply).toBe(true)
      expect(rp.garden).toEqual([{ id: 'w-bok', text: 'rp.w.bok', gloss: 'rp.w.bok.gloss', item: 'rp-u1-1' }])
      expect(de.strings['rp.w.bok']).toBe('bok')
      expect(hr.strings['rp.w.bok.gloss']).toBe('hello')
      // the unit scenes reuse an item of the unit; the finale reuses items of the units and adds none
      expect(rp.scenes[0]!.lines.filter((l) => l.reply).map((l) => l.reply)).toEqual(['rp-u1-1', 'rp-u1-2', expect.stringMatching(/^u1-q\d+$/)])
      const finaleReplies = rp.scenes[2]!.lines.filter((l) => l.reply).map((l) => l.reply!)
      expect(new Set(finaleReplies).size).toBe(4)
      expect(finaleReplies.some((id) => id.startsWith('rp-finale-'))).toBe(false)

      // restart from scenes: run 2 redoes the stage and what follows; the scenes, the items and the section come out the same
      const files = ['u1', 'u2', '_finale'].map((x) => stepsFile(env, slug, 'scenes', `${x}.json`))
      const before = await Promise.all(files.map((f) => readFile(f, 'utf8')))
      const r = await toolsOf(env).call('edu_run_pipeline', { slug, restart: true, from: 'scenes' })
      expect(r.ok, r.text).toBe(true)
      expect(r.data.run).toBe(2)
      await waitIdle(env, slug, 90_000)
      p = await view()
      expect(p).toMatchObject({ run: 2, stage: 'published' })
      expect(p.steps.find((x) => x.step === 'scenes:u1')!.job).toBe(`${slug}--scenes--u1--r2`)
      expect(p.steps.find((x) => x.step === 'accepted:u1')!.job).toBe(`${slug}--accepted--u1--r1`) // before the stage: kept
      expect(await Promise.all(files.map((f) => readFile(f, 'utf8')))).toEqual(before)
      const again = await json<Pack>(dir('pack.json'))
      expect(again.shells.config.roleplay).toEqual(pack.shells.config.roleplay)
      expect(again.items.map((i) => i.id)).toEqual(pack.items.map((i) => i.id))
      expect(env.author.count('scene-writer/scenes:u2')).toBe(2)
      expect(env.author.count('item-writer/items:u1')).toBe(1)
    } finally {
      await env.cleanup()
    }
  }, 60_000)

  it('roleplay: false in the brief skips the stage with its reason and leaves the shell out; a steps.json from before the stage resumes without error', async () => {
    const env = await makePipelineEnv()
    try {
      const { failed, slug } = await run(env, { ...DE, roleplay: false }, 90_000)
      expect(failed).toEqual([])
      const status = async () => (await toolsOf(env).call('edu_status', { slug })).data.pipeline as Awaited<ReturnType<typeof pipelineOf>>
      const p = await status()
      expect(p.stage).toBe('published')
      expect(p.steps.find((x) => x.step === 'scenes:all')).toMatchObject({ status: 'skipped', note: expect.stringMatching(/switched off in the brief/) })
      expect(env.author.calls.some((x) => x.startsWith('scene-writer/'))).toBe(false)
      const pack = await json<Pack>(courseFile(env, slug, 'course', 'pack.json'))
      expect(pack.shells.enabled).not.toContain('roleplay')
      expect(pack.shells.config.roleplay).toBeUndefined()
      // an old run: no stage in steps.json, no roleplay in the resolved brief
      const file = stepsFile(env, slug, 'steps.json')
      const old = await json<StepsFile>(file)
      delete old.steps['scenes:all']
      delete (old.resolved as Partial<typeof old.resolved>).roleplay
      await writeFile(file, JSON.stringify(old))
      const resumed = await toolsOf(env).call('edu_run_pipeline', { slug })
      expect(resumed.ok, resumed.text).toBe(true)
      await waitIdle(env, slug, 30_000)
      const after = await status()
      expect(after).toMatchObject({ run: 1, stage: 'published' })
      expect(after.steps.find((x) => x.step === 'scenes:all')).toMatchObject({ status: 'skipped' })
      expect(after.failed).toBeUndefined()
    } finally {
      await env.cleanup()
    }
  }, 60_000)
})
