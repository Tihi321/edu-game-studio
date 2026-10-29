import { rm } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { Engine } from '../src/engine/engine'
import { pipelineJobId } from '../src/engine/edu/pipeline'
import { runPlaytest } from '../src/engine/edu/playtest'
import { collect } from '../src/engine/models/types'
import { waitIdle } from './edu-helpers'
import { waitFor } from './helpers'
import { BRIEF, courseFile, json, makePipelineEnv, OK_PLAYTEST, pf, pipelineOf, run, SLUG, statusOf, toolsOf } from './pipeline-helpers'

describe('resume, retry and restart', () => {
  it('a restarted engine on the same folder finishes the run: edu_run_pipeline again redoes nothing that was finished', async () => {
    const env = await makePipelineEnv()
    let second: Engine | undefined
    try {
      const { call } = toolsOf(env)
      expect((await call('edu_run_pipeline', { brief: BRIEF })).ok).toBe(true)
      await waitFor(async () => (await env.engine.edu.pipeline.readSteps(SLUG))?.steps['curriculum:all']?.status === 'done', 30_000, 'the curriculum')
      await env.engine.stop()
      second = new Engine({
        dataDir: env.dir,
        emit: () => undefined,
        registry: { mock: env.mock },
        router: { backoffMs: 1, retries: 1 },
        pollMs: 40,
        discover: false,
        searchProviders: [env.provider],
        search: { fetchPage: async () => '' },
        playtest: async () => OK_PLAYTEST
      })
      second.factory = { ...second.factory, max_attempts: 1 }
      await second.start()
      const again = await buildToolsCall(second, 'edu_run_pipeline', { slug: SLUG })
      expect(again.ok, again.text).toBe(true)
      expect((again.data as { run: number }).run).toBe(1)
      await waitFor(async () => (await second!.edu.getCourseMeta(SLUG))?.data && ((await second!.edu.getCourseMeta(SLUG))!.data as { stage?: string }).stage === 'published', 60_000, 'the course to be published')
      expect(env.author.count('director/plan_brief')).toBe(1)
      expect(env.author.count('curriculum-designer/curriculum')).toBe(1)
      expect(env.author.count('publisher/publish')).toBe(1)
    } finally {
      await second?.stop()
      await rm(env.dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    }
  }, 90_000)

  it('a job that fails for good shows its text in edu_status (stage failed); retry: true puts it back and the run finishes', async () => {
    const env = await makePipelineEnv()
    try {
      // the curriculum designer answers with something that is no JSON, until it is fixed
      const undo = env.mock.on({ role: 'curriculum-designer' }, () => 'I would rather not answer in JSON.')
      const { call } = toolsOf(env)
      await call('edu_run_pipeline', { brief: BRIEF })
      await waitIdle(env, SLUG, 30_000)
      const p = await pipelineOf(env)
      expect(p.stage).toBe('failed')
      expect(p.failed).toEqual([expect.objectContaining({ step: 'curriculum:all', failure: expect.stringMatching(/did not return valid JSON twice/) })])
      expect(p.next).toMatch(/retry: true/)
      expect(statusOf(p, 'curriculum:all')).toBe('failed')
      expect(p.steps.some((s) => s.step.startsWith('articles'))).toBe(false) // nothing after the failed step was enqueued
      undo()
      const r = await call('edu_run_pipeline', { slug: SLUG, retry: true })
      expect(r.data.retried).toEqual([pipelineJobId(SLUG, 1, 'curriculum', null)])
      await waitIdle(env, SLUG, 60_000)
      const done = await pipelineOf(env)
      expect(done).toMatchObject({ run: 1, stage: 'published' })
      expect(done.failed).toBeUndefined()
    } finally {
      await env.cleanup()
    }
  }, 90_000)
})

describe('the MCP side', () => {
  it('edu_create_course takes a brief (slug from the topic), edu_run_pipeline refuses what it cannot run', async () => {
    const env = await makePipelineEnv()
    try {
      const { call } = toolsOf(env)
      const made = await call('edu_create_course', { brief: BRIEF })
      expect(made.data).toMatchObject({ slug: SLUG, created: true, stage: 'draft' })
      expect((await env.engine.edu.getCourseMeta(SLUG))!.data).toMatchObject({ stage: 'draft', brief: { topic: 'The Roman Empire' } })
      expect((await call('edu_create_course', { brief: BRIEF })).text).toMatch(/already exists/)
      expect((await call('edu_create_course', { slug: 'x' })).text).toMatch(/give a brief, or slug, title/)
      expect((await call('edu_run_pipeline', {})).text).toMatch(/give a slug.*or a brief/)
      expect((await call('edu_run_pipeline', { slug: 'nope' })).text).toMatch(/no course "nope"/)
      expect((await call('edu_run_pipeline', { brief: { ...BRIEF, model: 'nobody/none' } })).text).toMatch(/unknown model "nobody\/none"/)
      expect((await call('edu_run_pipeline', { brief: { ...BRIEF, format: 'epic' } })).text).toMatch(/no course format "epic"/)
      expect((await call('edu_run_pipeline', { slug: SLUG, restart: true, from: 'dessert' })).text).toMatch(/unknown stage "dessert"/)
      // a course made by hand has no brief
      await call('edu_create_course', { slug: 'by-hand', title: 'T', languages: ['en'], sourceLang: 'en', subject: 's', audience: 'a' })
      expect((await call('edu_run_pipeline', { slug: 'by-hand' })).text).toMatch(/has no brief/)
      // a course with a brief and no run yet: edu_run_pipeline {slug} starts it
      const started = await call('edu_run_pipeline', { slug: SLUG })
      expect(started.data).toMatchObject({ slug: SLUG, run: 1 })
      await waitIdle(env, SLUG, 60_000)
      expect((await pipelineOf(env)).stage).toBe('published')
    } finally {
      await env.cleanup()
    }
  }, 90_000)

  it('the client loop: with model client/claude-code in the brief every role task waits for the client, edu_wait returns for them, each task text is self-contained, and answering them all publishes the course', async () => {
    const env = await makePipelineEnv({ mixed: true })
    try {
      const { call } = toolsOf(env)
      const started = await call('edu_run_pipeline', { brief: { ...BRIEF, model: 'client/claude-code' } })
      expect(started.ok, started.text).toBe(true)
      expect((await env.engine.edu.getCourseMeta(SLUG))!.data).toMatchObject({ models: { '*': 'client/claude-code' } })
      const seen: { role: string; task: string; user: string; hasSchema: boolean }[] = []
      for (let round = 0; round < 80; round++) {
        const w = await call('edu_wait', { slug: SLUG, timeoutSeconds: 60 })
        expect(w.data.timedOut).toBe(false)
        if (!w.data.clientTasks) break
        expect(w.data.hint).toMatch(/edu_get_task/)
        for (;;) {
          const t = await call('edu_get_task', {})
          if (t.data.none) break
          const view = t.data as { taskId: string; meta: Record<string, string>; system: string; user?: string; messages?: { role: string; content: string }[]; schema?: unknown }
          const messages = [{ role: 'system' as const, content: view.system }, ...(view.messages ?? [{ role: 'user', content: view.user ?? '' }]).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))]
          const user = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
          seen.push({ role: view.meta.role!, task: view.meta.task!, user, hasSchema: !!view.schema })
          const { text } = await collect(env.mock.chat({ model: 'claude-code', messages, schema: view.schema as Record<string, unknown> | undefined, meta: { job: view.meta.job, role: view.meta.role, task: view.meta.task, book: view.meta.book, agent: view.meta.agent, unit: view.meta.unit } }))
          const sub = await call('edu_submit_task', { taskId: view.taskId, text })
          expect(sub.data, `${view.meta.role}/${view.meta.task}: ${text.slice(0, 200)}`).toMatchObject({ accepted: true })
        }
      }
      const p = await pipelineOf(env)
      expect(p.stage).toBe('published')
      expect(p.steps.filter((s) => s.status !== 'done' && s.status !== 'skipped')).toEqual([])
      // every task carried what it needs: no unfilled variable, a schema for the JSON answer, the course context
      expect(seen.length).toBeGreaterThan(20)
      for (const t of seen) {
        expect(t.user.replaceAll('{{g1}}', ''), `${t.role}/${t.task}`).not.toContain('{{') // the only double braces are the gap marker the item prompts explain
        expect(t.user.length, `${t.role}/${t.task}`).toBeGreaterThan(200)
        expect(t.hasSchema, `${t.role}/${t.task}`).toBe(true)
      }
      expect(new Set(seen.map((t) => t.role))).toEqual(new Set(['director', 'researcher', 'curriculum-designer', 'subject-expert', 'item-writer', 'misconception-designer', 'fact-checker', 'explainer', 'game-designer', 'art-director', 'art-critic', 'composer', 'accessibility-reviewer', 'playtester', 'publisher']))
      // the no-model steps ran on their own in between
      expect(await json(pf(env, 'lint.json'))).toMatchObject({ ok: true })
    } finally {
      await env.cleanup()
    }
  }, 120_000)

  it('restart from a stage starts run n+1: the outputs from that stage on are redone (new job ids), the ones before are kept', async () => {
    const env = await makePipelineEnv()
    try {
      await run(env)
      expect((await pipelineOf(env)).stage).toBe('published')
      const { call } = toolsOf(env)
      const r = await call('edu_run_pipeline', { slug: SLUG, restart: true, from: 'items' })
      expect(r.ok, r.text).toBe(true)
      expect(r.data.run).toBe(2)
      await waitIdle(env, SLUG, 60_000)
      const p = await pipelineOf(env)
      expect(p).toMatchObject({ run: 2, stage: 'published' })
      expect(p.steps.find((s) => s.step === 'items:u1')!.job).toBe(`${SLUG}--items--u1--r2`)
      expect(p.steps.find((s) => s.step === 'curriculum:all')!.job).toBe(`${SLUG}--curriculum--all--r1`) // before the stage: kept
      expect(p.steps.find((s) => s.step === 'articles:u1')!.job).toBe(`${SLUG}--articles--u1--r1`)
      expect(env.author.count('curriculum-designer/curriculum')).toBe(1)
      expect(env.author.count('item-writer/items:u1')).toBe(2)
      expect(env.author.count('publisher/publish')).toBe(2)
      expect((await env.engine.edu.getCourseMeta(SLUG))!.data).toMatchObject({ run: 2, stage: 'published' })
    } finally {
      await env.cleanup()
    }
  }, 120_000)

  it('story: frame writes a frame story into the pack; story: scriptorium hands the idea over once, and a Scriptorium that is down skips the step', async () => {
    const handed: unknown[] = []
    const fake = (up: boolean) => ({
      url: 'http://fake/scriptorium',
      status: async () => (up ? { up: true as const } : { up: false as const, error: 'Scriptorium is not running at http://fake/scriptorium. Edu Studio never starts it' }),
      handOffStory: async (s: unknown) => (handed.push(s), { story: 'the-scribe' }),
      waitForStory: async () => ({ done: false, reason: 'timeout', story: 'the-scribe', book: null, title: null, stage: null, folder: null })
    })
    const frame = await makePipelineEnv()
    try {
      await run(frame, { ...BRIEF, story: 'frame' })
      const pack = await json<{ extensions: { story: { premise: string; beats: { unit: string }[] } } }>(courseFile(frame, SLUG, 'course', 'pack.json'))
      expect(pack.extensions.story.beats.map((b) => b.unit)).toEqual(['u1', 'u2'])
      expect((await pipelineOf(frame)).stage).toBe('published')
    } finally {
      await frame.cleanup()
    }
    const up = await makePipelineEnv({ engine: { scriptorium: fake(true) } })
    try {
      await run(up, { ...BRIEF, story: 'scriptorium' })
      expect(handed).toHaveLength(1)
      expect(handed[0]).toMatchObject({ idea: expect.stringContaining('scribe'), audience: 'teenagers', length: expect.stringContaining('2000 words'), title: expect.stringContaining('Roman Empire') })
      const p = await pipelineOf(up)
      expect(p).toMatchObject({ stage: 'published' })
      expect(p.steps.find((s) => s.step === 'story:all')).toMatchObject({ status: 'done', note: expect.stringContaining('the-scribe') })
      expect(await json(pf(up, 'story.json'))).toMatchObject({ mode: 'scriptorium', story: 'the-scribe' })
    } finally {
      await up.cleanup()
    }
    const down = await makePipelineEnv({ engine: { scriptorium: fake(false) } })
    try {
      handed.length = 0
      await run(down, { ...BRIEF, story: 'scriptorium' })
      expect(handed).toHaveLength(0)
      const p = await pipelineOf(down)
      expect(p.stage).toBe('published')
      expect(p.steps.find((s) => s.step === 'story:all')).toMatchObject({ status: 'skipped', note: expect.stringContaining('never starts it') })
    } finally {
      await down.cleanup()
    }
  }, 180_000)
})

async function buildToolsCall(engine: Engine, name: string, args: Record<string, unknown>) {
  const { buildTools, callTool } = await import('../src/engine/mcp/tools')
  const tools = buildTools(engine.edu, { control: engine.mcpControl(), clientQueue: engine.clientQueue })
  const r = await callTool(tools, name, args)
  return { ok: !r.isError, text: r.content[0].text, data: (r.structuredContent ?? {}) as Record<string, unknown> }
}

// ---- the real autoplay bot on a pipeline course, only where Chromium is installed ----

async function chromiumAvailable(): Promise<string | null> {
  try {
    const { chromium } = await import('playwright')
    const b = await chromium.launch()
    await b.close()
    return null
  } catch (e) {
    return e instanceof Error ? (e.message.split('\n')[0] ?? 'unknown error') : String(e)
  }
}
const unavailable = await chromiumAvailable()
if (unavailable) console.warn(`[pipeline] the real-bot test is SKIPPED: Chromium cannot be launched (${unavailable}). Run "yarn playwright install chromium".`)

describe.skipIf(!!unavailable)('the pipeline with the real autoplay bot', () => {
  it('the course the mock team made is played by the bot (perfect and the 75 % learner) and published', async () => {
    const env = await makePipelineEnv({ playtest: (dir, opts) => runPlaytest(dir, { ...opts, personas: ['perfect', 'average'], concurrency: 2, timeoutMs: 200_000 }) })
    try {
      await run(env, BRIEF, 200_000)
      const p = await pipelineOf(env)
      expect(p.stage, JSON.stringify(p.blockedBy ?? p.failed)).toBe('published')
      const play = await json<{ ok: boolean; runs: { persona: string; summary: { finished: boolean; consoleErrors: number } }[] }>(pf(env, 'playtest.json'))
      expect(play.ok).toBe(true)
      expect(play.runs.map((r) => [r.persona, r.summary.finished, r.summary.consoleErrors])).toEqual([['perfect', true, 0], ['average', true, 0]])
    } finally {
      await env.cleanup()
    }
  }, 300_000)
})
