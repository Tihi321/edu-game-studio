import { describe, expect, it } from 'vitest'
import { Engine } from '../src/engine/engine'
import { pipelineJobId } from '../src/engine/edu/pipeline'
import { collect } from '../src/engine/models/types'
import { waitIdle } from './edu-helpers'
import { BRIEF, json, makePipelineEnv, pf, pipelineOf, run, SLUG, statusOf, toolsOf } from './pipeline-helpers'

describe('resume, retry and restart', () => {
  it('a restarted engine on the same folder finishes the run: edu_run_pipeline again redoes nothing that was finished', async () => {
    const env = await makePipelineEnv()
    try {
      // the first model call after the curriculum parks on a gate: the stop lands at a known point, not by timing
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      let parked!: () => void
      const reached = new Promise<void>((r) => (parked = r))
      const undoGate = env.mock.on({ role: 'subject-expert' }, async () => {
        parked()
        await gate
        throw Object.assign(new Error('the engine was stopped'), { name: 'AbortError' })
      })
      expect((await toolsOf(env).call('edu_run_pipeline', { brief: BRIEF })).ok).toBe(true)
      await reached
      const before = (await env.engine.edu.pipeline.readSteps(SLUG))!.steps
      expect(before['curriculum:all']?.status).toBe('done')
      const stopping = env.engine.stop()
      release()
      await stopping
      undoGate()
      const doneBefore = Object.entries(before).filter(([, s]) => s.status === 'done').map(([k, s]): [string, string | undefined] => [k, s.job])
      expect(doneBefore.length).toBeGreaterThanOrEqual(3) // plan, research or curriculum steps were finished before the stop

      const second = await env.reopen()
      second.factory = { ...second.factory, max_attempts: 1 }
      const again = await buildToolsCall(second, 'edu_run_pipeline', { slug: SLUG })
      expect(again.ok, again.text).toBe(true)
      expect((again.data as { run: number }).run).toBe(1)
      expect((await second.edu.waitIdle(SLUG, { timeoutMs: 30_000 })).timedOut).toBe(false)
      const after = (await second.edu.pipeline.readSteps(SLUG))!.steps
      for (const [k, job] of doneBefore) expect(after[k], k).toMatchObject({ status: 'done', job }) // kept, same job id
      expect((await second.edu.getCourseMeta(SLUG))!.data).toMatchObject({ stage: 'published' })
      expect(env.author.count('director/plan_brief')).toBe(1)
      expect(env.author.count('curriculum-designer/curriculum')).toBe(1)
      expect(env.author.count('publisher/publish')).toBe(1)
    } finally {
      await env.cleanup()
    }
  }, 15_000)

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
  })
})

describe('the MCP side', () => {
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
  })

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
  })
})

async function buildToolsCall(engine: Engine, name: string, args: Record<string, unknown>) {
  const { buildTools, callTool } = await import('../src/engine/mcp/tools')
  const tools = buildTools(engine.edu, { control: engine.mcpControl(), clientQueue: engine.clientQueue })
  const r = await callTool(tools, name, args)
  return { ok: !r.isError, text: r.content[0].text, data: (r.structuredContent ?? {}) as Record<string, unknown> }
}
