import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProviderError } from '../src/engine/models/types'
import { parseMd } from '../src/shared/md'
import type { EngineEvent } from '../src/shared/protocol'
import { watchDataFolder } from '../src/engine/store/watcher'
import { makeEnv, sleep, waitFor } from './helpers'
import type { TestEnv } from './helpers'

let env: TestEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const jobsIn = (e: TestEnv, state: string) => readdir(path.join(e.dir, 'jobs', state)).then((f) => f.filter((n) => n.endsWith('.md')))

/** The standard test handler: one model call, result is the reply. */
function registerChat(e: TestEnv, task = 't', hooks: { before?: () => void; after?: () => void } = {}) {
  e.engine.scheduler.register(task, async (ctx) => {
    hooks.before?.()
    try {
      const r = await ctx.chat({ messages: [{ role: 'user', content: `do ${ctx.job.id}` }] })
      return { result: r.text }
    } finally {
      hooks.after?.()
    }
  })
}

const reviewers = (n: number) => Array.from({ length: n }, (_, i) => ({ role: 'line-editor', name: `Rev ${i + 1}` }))

describe('scheduler', () => {
  it('runs a job end to end: files, events, log, handover', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'Ann' }] })
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'b1--t--u1--r0', task: 't', role: 'writer', book: 'b1', unit: 'u1', requested_by: 'architect-ada' }, 'Please write unit one.')
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'job done')
    const done = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'b1--t--u1--r0.md'), 'utf8'))
    expect(done.data).toMatchObject({ id: 'b1--t--u1--r0', agent: 'writer-ann', model: 'loc/m1', paid: false, requested_by: 'architect-ada', attempts: 0 })
    expect(done.data.prompt_version).toMatch(/^[0-9a-f]{8}$/)
    expect(done.body).toContain('Please write unit one.')
    expect(done.body).toContain('do b1--t--u1--r0')
    expect(done.body).toContain('## Result')

    const types = env.events.map((e) => e.type)
    expect(types).toContain('job.started')
    expect(types).toContain('job.token')
    expect(types).toContain('spend')
    const handovers = env.events.filter((e): e is Extract<EngineEvent, { type: 'handover' }> => e.type === 'handover')
    expect(handovers.map((h) => [h.from, h.to, !!h.done])).toEqual([['architect-ada', 'writer-ann', false], ['architect-ada', 'writer-ann', true]])
    const states = env.events.filter((e) => e.type === 'agent.state').map((e) => (e as { state: string }).state)
    expect(states).toEqual(['idle', 'working', 'idle'])

    await env.engine.logs.flush()
    const agentLog = await readFile(path.join(env.dir, 'logs', 'agents', 'writer-ann.md'), 'utf8')
    expect(agentLog).toContain('requested by: architect-ada')
    expect(agentLog).toContain('Mock reply for writer')
    expect(existsSync(path.join(env.dir, 'courses', 'b1', 'log.md'))).toBe(true)
    // the spend row for a local model: cost 0
    const spend = await readdir(path.join(env.dir, 'logs', 'spend'))
    expect(spend).toHaveLength(1)
  })

  it('tells the office when a job falls back to another model', async () => {
    env = await makeEnv({
      providers: [{ id: 'loc', local: true, models: ['m1'] }, { id: 'alt', local: true, models: ['m2'] }],
      roles: { writer: ['loc/m1', 'alt/m2'] },
      agents: [{ role: 'writer', name: 'Ann' }]
    })
    env.mock.onAny((req) => {
      if (req.model === 'm1') throw new ProviderError('bad request', 400, false)
      return 'from m2'
    })
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'b1--t--u1--r0', task: 't', role: 'writer', book: 'b1', unit: 'u1', requested_by: 'engine' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'job done')
    const models = env.events.flatMap((e) => (e.type === 'job.started' || e.type === 'job.model' ? [`${e.type}:${e.model}`] : []))
    expect(models).toEqual(['job.started:loc/m1', 'job.model:alt/m2'])
  })

  it('tells the office why an agent gets no answer, and clears it once a request is answered', async () => {
    env = await makeEnv({
      providers: [{ id: 'loc', local: true, models: ['m1'] }, { id: 'alt', local: true, models: ['m2'] }],
      roles: { writer: ['loc/m1', 'alt/m2'] },
      agents: [{ role: 'writer', name: 'Ann' }]
    })
    let fail = true
    env.mock.onAny((req) => {
      if (req.model === 'm1') throw new ProviderError('HTTP 429: {"error":{"message":"Rate limit exceeded: free-models-per-day"}}', 429, true)
      if (fail) throw new ProviderError('HTTP 400: model does not support this request', 400, false)
      return 'from m2'
    })
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'b1--t--u1--r0', task: 't', role: 'writer', book: 'b1', unit: 'u1', requested_by: 'engine', max_attempts: 1 })
    await waitFor(async () => (await jobsIn(env!, 'failed')).length === 1, 5000, 'job failed')
    const problems = () => env!.events.flatMap((e) => (e.type === 'agent.problem' ? [e.problem ? `${e.problem.kind}:${e.problem.model}${e.problem.failed ? ':failed' : ''}` : 'cleared'] : []))
    expect(problems()).toEqual(['day-limit:loc/m1', 'bad-request:alt/m2', 'bad-request:alt/m2:failed'])
    // the snapshot keeps it, so a reloaded window shows it too
    const snap = await env.engine.snapshot()
    expect(snap.agents.find((a) => a.id === 'writer-ann')?.problem).toMatchObject({ kind: 'bad-request', model: 'alt/m2', failed: true })
    fail = false
    await env.engine.jobs.enqueue({ id: 'b1--t--u2--r0', task: 't', role: 'writer', book: 'b1', unit: 'u2', requested_by: 'engine' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'job done')
    expect(problems().at(-1)).toBe('cleared') // loc is used up for today, so the job went straight to alt, which answered
    expect((await env.engine.snapshot()).agents.find((a) => a.id === 'writer-ann')?.problem).toBeUndefined()
  })

  it('a job that falls back to another provider gives the first one its slot back', async () => {
    env = await makeEnv({
      providers: [{ id: 'loc', local: true, concurrency: 1, models: ['m1'] }, { id: 'alt', local: true, models: ['m2'] }],
      roles: { writer: ['loc/m1', 'alt/m2'] },
      agents: [{ role: 'writer', name: 'Ann' }, { role: 'writer', name: 'Bob' }]
    })
    env.mock.onAny((req) => {
      if (req.model === 'm1') throw new ProviderError('bad request', 400, false)
      return { text: 'slow answer '.repeat(4), chunks: 4, chunkDelayMs: 60 }
    })
    let active = 0
    let max = 0
    registerChat(env, 't', { before: () => (max = Math.max(max, ++active)), after: () => active-- })
    for (const u of ['u1', 'u2']) await env.engine.jobs.enqueue({ id: `b1--t--${u}--r0`, task: 't', role: 'writer', book: 'b1', unit: u, requested_by: 'engine' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 2, 5000, 'jobs done')
    expect(max).toBe(2) // the second job did not wait for loc's only slot while the first one ran on alt
  })

  it('3 books x parallel reviews respect provider concurrency and all finish', async () => {
    env = await makeEnv({ providers: [{ id: 'loc', local: true, concurrency: 2 }], roles: { 'line-editor': ['loc/m1'] }, agents: reviewers(6) })
    env.mock.onAny({ text: 'review notes '.repeat(4), chunkDelayMs: 25, chunks: 4 })
    let active = 0
    let max = 0
    registerChat(env, 't', { before: () => (max = Math.max(max, ++active)), after: () => active-- })
    for (const book of ['b1', 'b2', 'b3']) for (const r of ['continuity', 'line', 'copy']) {
      await env.engine.jobs.enqueue({ id: `${book}--review--${r}--r0`, task: 't', role: 'line-editor', book })
    }
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 9, 15000, '9 jobs done')
    expect(max).toBe(2)
    expect(await jobsIn(env, 'queued')).toEqual([])
    expect(await jobsIn(env, 'running')).toEqual([])
  })

  it('respects depends_on, waiting_on and locks', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }, { role: 'writer', name: 'B' }] })
    const order: string[] = []
    env.engine.scheduler.register('t', async (ctx) => {
      order.push(`start:${ctx.job.id}`)
      await sleep(80)
      order.push(`end:${ctx.job.id}`)
      return { result: 'ok' }
    })
    const j = env.engine.jobs
    await j.enqueue({ id: 'first', task: 't', role: 'writer' })
    await j.enqueue({ id: 'second', task: 't', role: 'writer', depends_on: ['first'] })
    await j.enqueue({ id: 'lock1', task: 't', role: 'writer', locks: ['bible:b1'] })
    await j.enqueue({ id: 'lock2', task: 't', role: 'writer', locks: ['bible:b1'] })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 4, 8000, 'all done')
    expect(order.indexOf('start:second')).toBeGreaterThan(order.indexOf('end:first'))
    const a = order.indexOf('end:lock1')
    const b = order.indexOf('end:lock2')
    const first = Math.min(a, b)
    const secondStart = order.indexOf(a < b ? 'start:lock2' : 'start:lock1')
    expect(secondStart).toBeGreaterThan(first) // the two locked jobs never overlap
  })

  it('pause all stops new claims and is saved in config/factory.md; resume continues', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }] })
    registerChat(env)
    await env.engine.handleCommand({ type: 'pauseAll' })
    expect(parseMd(await readFile(path.join(env.dir, 'config', 'factory.md'), 'utf8')).data.paused).toBe(true)
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await sleep(400)
    expect(await jobsIn(env, 'queued')).toEqual(['j1.md'])
    await env.engine.handleCommand({ type: 'resumeAll' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'done after resume')
    expect(parseMd(await readFile(path.join(env.dir, 'config', 'factory.md'), 'utf8')).data.paused).toBe(false)
  })

  it('starts paused when factory.md says so (survives a restart)', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }], paused: true })
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await sleep(300)
    expect(await jobsIn(env, 'done')).toEqual([])
    expect(env.engine.factory.paused).toBe(true)
  })

  it('stop now aborts the stream, puts the job back in queued/ and pauses', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }] })
    env.mock.onAny({ text: 'slow '.repeat(40), chunkDelayMs: 50, chunks: 40 })
    let aborted = false
    env.engine.scheduler.register('t', async (ctx) => {
      try {
        await ctx.chat({ messages: [{ role: 'user', content: 'x' }] })
      } catch (e) {
        aborted = (e as Error).name === 'AbortError'
        throw e
      }
      return { result: 'x' }
    })
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await waitFor(() => env!.events.some((e) => e.type === 'job.token'), 5000, 'streaming')
    await env.engine.handleCommand({ type: 'stopNow' })
    await waitFor(async () => (await jobsIn(env!, 'queued')).length === 1, 3000, 'job back in queued')
    expect(aborted).toBe(true)
    expect(await jobsIn(env, 'running')).toEqual([])
    expect(await jobsIn(env, 'done')).toEqual([])
    expect(env.engine.factory.paused).toBe(true)
    expect(parseMd(await readFile(path.join(env.dir, 'jobs', 'queued', 'j1.md'), 'utf8')).data.attempts).toBe(0)
  })

  it('stop (one agent) requeues its job without counting an attempt, and the job runs again', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }] })
    let runs = 0
    env.mock.onAny(() => (++runs === 1 ? { text: 'slow '.repeat(40), chunkDelayMs: 40, chunks: 40 } : 'quick'))
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await waitFor(() => env!.events.some((e) => e.type === 'job.token'), 5000, 'streaming')
    await env.engine.handleCommand({ type: 'stop', agent: 'writer-a' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 8000, 'done on second run')
    expect(parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'j1.md'), 'utf8')).data.attempts).toBe(0)
  })

  it('the budget cap blocks paid jobs while local jobs continue', async () => {
    env = await makeEnv({
      providers: [{ id: 'paid', price: 1000, models: ['p'] }, { id: 'loc', local: true, concurrency: 2 }],
      roles: { writer: ['paid/p'], 'line-editor': ['loc/m1'] },
      caps: { daily: 0.5 },
      agents: [{ role: 'writer', name: 'W' }, { role: 'line-editor', name: 'L' }]
    })
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'paid-job', task: 't', role: 'writer' })
    await env.engine.jobs.enqueue({ id: 'local-job', task: 't', role: 'line-editor' })
    await waitFor(async () => (await jobsIn(env!, 'done')).includes('local-job.md'), 5000, 'local job done')
    await sleep(300)
    // The paid request would cost about 4 USD (4096 max tokens at 1000 USD per 1M), more than the 0.5 cap.
    expect(await jobsIn(env, 'done')).toEqual(['local-job.md'])
    expect(await jobsIn(env, 'queued')).toEqual(['paid-job.md'])
    expect(env.engine.budget.spentToday()).toBe(0)
  })

  it('once a cap is reached, a paid-first role falls through to its local model', async () => {
    env = await makeEnv({
      providers: [{ id: 'paid', price: 1, models: ['p'] }, { id: 'loc', local: true }],
      roles: { writer: ['paid/p', 'loc/m1'] },
      caps: { daily: 1 },
      agents: [{ role: 'writer', name: 'W' }]
    })
    registerChat(env)
    await env.engine.budget.record({ time: new Date(), agent: 'x', book: '', role: 'writer', provider: 'paid', model: 'p', tokensIn: 1, tokensCached: 0, tokensOut: 1, costUsd: 1, ms: 1 })
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'done')
    const done = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'j1.md'), 'utf8'))
    expect(done.data).toMatchObject({ model: 'loc/m1', paid: false })
  })

  it('falls back through the role list on provider errors and records the model used', async () => {
    env = await makeEnv({
      providers: [{ id: 'a', local: true, models: ['x'] }, { id: 'b', local: true, models: ['y'] }],
      roles: { writer: ['a/x', 'b/y'] },
      agents: [{ role: 'writer', name: 'W' }]
    })
    env.mock.onAny((req) => {
      if (req.model === 'x') throw Object.assign(new Error('down'), { name: 'ProviderError' })
      return 'from y'
    })
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'done')
    expect(parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'j1.md'), 'utf8')).data.model).toBe('b/y')
  })

  it('a failing handler is retried, then moved to failed/ with the reason', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'W' }] })
    env.engine.scheduler.register('boom', async () => {
      throw new Error('kaboom')
    })
    await env.engine.jobs.enqueue({ id: 'once', task: 'boom', role: 'writer', max_attempts: 1 })
    await env.engine.jobs.enqueue({ id: 'twice', task: 'boom', role: 'writer', max_attempts: 3 })
    await waitFor(async () => (await jobsIn(env!, 'failed')).includes('once.md'), 10000, 'failed')
    const failed = parseMd(await readFile(path.join(env.dir, 'jobs', 'failed', 'once.md'), 'utf8'))
    expect(failed.data).toMatchObject({ attempts: 1, failure: 'kaboom' })
    const retry = await waitFor(async () => {
      const j = await env!.engine.jobs.read('queued', 'twice')
      return j && j.data.attempts === 1 ? j : null
    }, 10000, 'retry queued')
    expect(retry.data.not_before).toBeTruthy()
    expect(env.events.some((e) => e.type === 'agent.state' && e.state === 'error')).toBe(true)
  }, 20000)

  it('enqueue is idempotent by id, in any state', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'W' }] })
    registerChat(env)
    expect(await env.engine.jobs.enqueue({ id: 'same', task: 't', role: 'writer' })).toBe(true)
    expect(await env.engine.jobs.enqueue({ id: 'same', task: 't', role: 'writer' })).toBe(false)
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'done')
    expect(await env.engine.jobs.enqueue({ id: 'same', task: 't', role: 'writer' })).toBe(false)
  })

  it('suspends on waiting_on: the job leaves the agent and resumes when the other job is done', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'W' }] })
    let first = true
    env.engine.scheduler.register('ask', async () => {
      if (first) {
        first = false
        await env!.engine.jobs.enqueue({ id: 'research-1', task: 'quick', role: 'writer' })
        return { suspendOn: 'research-1' }
      }
      return { result: 'resumed' }
    })
    env.engine.scheduler.register('quick', async () => ({ result: 'fact' }))
    await env.engine.jobs.enqueue({ id: 'scene', task: 'ask', role: 'writer' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 2, 6000, 'both done')
    const scene = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'scene.md'), 'utf8'))
    expect(scene.body).toContain('resumed')
  })
})

describe('agent controls and hot reload', () => {
  it('hire writes an agent file that works at once; pause and resume persist', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] } })
    registerChat(env)
    await env.engine.handleCommand({ type: 'hire', role: 'writer', name: 'New Hire' })
    const file = path.join(env.dir, 'agents', 'writer-new-hire.md')
    expect(parseMd(await readFile(file, 'utf8')).data).toMatchObject({ kind: 'agent', role: 'writer', name: 'New Hire', paused: false, max_parallel: 1 })
    await env.engine.handleCommand({ type: 'pause', agent: 'writer-new-hire' })
    expect(parseMd(await readFile(file, 'utf8')).data.paused).toBe(true)
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await sleep(300)
    expect(await jobsIn(env, 'queued')).toEqual(['j1.md'])
    expect(env.events.some((e) => e.type === 'agent.state' && e.agent === 'writer-new-hire' && e.state === 'paused')).toBe(true)
    await env.engine.handleCommand({ type: 'resume', agent: 'writer-new-hire' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'done')
  })

  it('fire gracefully finishes the job first, fire now aborts and requeues it', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }, { role: 'writer', name: 'B' }] })
    env.mock.onAny({ text: 'text '.repeat(10), chunkDelayMs: 60, chunks: 10 })
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    const runner = await waitFor(() => env!.engine.scheduler.runningJobs()[0], 3000, 'job running')
    const fileOf = (id: string) => path.join(env!.dir, 'agents', `${id}.md`)
    await env.engine.handleCommand({ type: 'fire', agent: runner.agent })
    expect(existsSync(fileOf(runner.agent))).toBe(true) // still working
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'finished')
    await waitFor(() => !existsSync(fileOf(runner.agent)), 3000, 'file removed')

    const other = env.engine.agents.list()[0]!.id
    env.mock.onAny({ text: 'text '.repeat(40), chunkDelayMs: 60, chunks: 40 })
    await env.engine.jobs.enqueue({ id: 'j2', task: 't', role: 'writer' })
    await waitFor(() => env!.engine.scheduler.runningJobs().length === 1, 3000, 'j2 running')
    await env.engine.handleCommand({ type: 'fire', agent: other, now: true })
    await waitFor(async () => (await jobsIn(env!, 'queued')).includes('j2.md'), 3000, 'j2 requeued')
    expect(existsSync(fileOf(other))).toBe(false)
    expect(await jobsIn(env, 'running')).toEqual([])
  })

  it('setModel with an agent writes that agent file; with a role writes config/roles.md; both apply from the next job', async () => {
    env = await makeEnv({
      providers: [{ id: 'a', local: true, models: ['x'] }, { id: 'b', local: true, models: ['y'] }, { id: 'c', local: true, models: ['z'] }],
      roles: { writer: ['a/x'] },
      agents: [{ role: 'writer', name: 'W' }]
    })
    registerChat(env)
    const modelOf = async (id: string) => parseMd(await readFile(path.join(env!.dir, 'jobs', 'done', `${id}.md`), 'utf8')).data.model
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'j1')
    expect(await modelOf('j1')).toBe('a/x')

    await env.engine.handleCommand({ type: 'setModel', role: 'writer', model: 'b/y' })
    const roles = parseMd(await readFile(path.join(env.dir, 'config', 'roles.md'), 'utf8'))
    expect((roles.data.roles as Record<string, { models: string[] }>).writer!.models).toEqual(['b/y', 'a/x'])
    expect(roles.body).toBe('test roles\n') // body kept
    await env.engine.jobs.enqueue({ id: 'j2', task: 't', role: 'writer' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 2, 5000, 'j2')
    expect(await modelOf('j2')).toBe('b/y')

    await env.engine.handleCommand({ type: 'setModel', agent: 'writer-w', model: 'c/z' })
    expect(parseMd(await readFile(path.join(env.dir, 'agents', 'writer-w.md'), 'utf8')).data.model).toBe('c/z')
    await env.engine.jobs.enqueue({ id: 'j3', task: 't', role: 'writer' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 3, 5000, 'j3')
    expect(await modelOf('j3')).toBe('c/z')

    await env.engine.handleCommand({ type: 'setModel', agent: 'writer-w', model: 'nope/none' })
    expect(env.logs.some((l) => l.includes('unknown model'))).toBe(true)
  })

  it('setModel on a busy agent switches its running job: the request in flight starts again on the new model, earlier ones are kept', async () => {
    env = await makeEnv({
      providers: [{ id: 'a', local: true, models: ['x'] }, { id: 'b', local: true, models: ['y'] }],
      roles: { writer: ['a/x'] },
      agents: [{ role: 'writer', name: 'W' }]
    })
    env.mock.onAny((req) => {
      const second = req.messages[0]!.content === 'second'
      return second && req.model === 'x' ? { text: 'slow '.repeat(40), chunkDelayMs: 50, chunks: 40 } : `${req.model} answers`
    })
    env.engine.scheduler.register('t', async (ctx) => {
      const one = await ctx.chat({ messages: [{ role: 'user', content: 'first' }] })
      const two = await ctx.chat({ messages: [{ role: 'user', content: 'second' }] })
      return { result: `${one.text} / ${two.text}` }
    })
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await waitFor(() => env!.mock.calls.length === 2 && env!.events.filter((e) => e.type === 'job.token').length > 1, 5000, 'second request streaming')
    await env.engine.handleCommand({ type: 'setModel', agent: 'writer-w', model: 'b/y' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'done on the new model')
    const done = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'j1.md'), 'utf8'))
    expect(done.data.model).toBe('b/y')
    expect(done.data.attempts).toBe(0)
    expect(done.body).toContain('x answers / y answers') // the first request is not asked again
    expect(env.mock.calls.map((c) => c.model)).toEqual(['x', 'x', 'y'])
    expect(env.events.some((e) => e.type === 'job.model' && e.model === 'b/y')).toBe(true)
  })

  it('fallback_shared gives every role the fallback rows in order, and off keeps each role its own', async () => {
    env = await makeEnv({
      providers: [{ id: 'api', price: 1, models: ['p', 'q'] }, { id: 'strata', local: true, models: ['s'] }, { id: 'lmstudio', local: true, models: ['l'] }],
      roles: { 'line-editor': ['strata/s', 'lmstudio/l', 'api/p'], writer: ['api/p', 'strata/s'] },
      agents: []
    })
    const save = (fallbacks: string[], fallbackShared: boolean) =>
      env!.engine.handleCommand({ type: 'saveSettings', fallbacks, fallbackShared })
    expect(env.engine.registry.roleModelRefs('line-editor')).toEqual(['strata/s', 'lmstudio/l', 'api/p'])

    await save(['api/q', 'lmstudio/l', 'strata/s'], true)
    const saved = parseMd(await readFile(path.join(env.dir, 'config', 'settings.md'), 'utf8')).data
    expect(saved.fallbacks).toEqual(['api/q', 'lmstudio/l', 'strata/s'])
    expect(saved.fallback_shared).toBe(true)
    // api/p takes the first API row's place; the rows keep their order
    expect(env.engine.registry.roleModelRefs('line-editor')).toEqual(['api/p', 'lmstudio/l', 'strata/s'])
    expect(env.engine.registry.roleModelRefs('writer')).toEqual(['api/p', 'lmstudio/l', 'strata/s'])
    const snap = await env.engine.snapshot()
    expect(snap.roleDefaults['line-editor']).toBe('api/p')
    expect(snap.settings).toMatchObject({ fallbacks: ['api/q', 'lmstudio/l', 'strata/s'], fallbackShared: true })
    expect(snap.models.find((m) => m.ref === 'api/p')?.kind).toBe('paid')
    expect(snap.models.find((m) => m.ref === 'lmstudio/l')?.kind).toBe('lmstudio')

    await save(['api/q', 'lmstudio/l', 'strata/s'], false)
    expect(env.engine.registry.roleModelRefs('line-editor')).toEqual(['strata/s', 'lmstudio/l', 'api/p'])
  })

  it('edits to agent and config files apply without a restart (watcher)', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [] })
    registerChat(env)
    const w = watchDataFolder(env.dir, (e) => void env!.engine.handleWatch(e), { debounceMs: 30 })
    await w.ready
    try {
      const { writeMd } = await import('../src/engine/store/atomic')
      await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
      await sleep(250)
      expect(await jobsIn(env, 'done')).toEqual([]) // nobody to do it
      await writeMd(path.join(env.dir, 'agents', 'writer-late.md'), { kind: 'agent', role: 'writer', name: 'Late', model: null, focus: [], pin: null, max_parallel: 1, paused: false }, 'persona\n')
      await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 6000, 'new agent picks the job up')

      // pause all through the file, without the command
      await writeMd(path.join(env.dir, 'config', 'factory.md'), { kind: 'factory', paused: true, max_attempts: 3 }, '')
      await waitFor(() => env!.engine.factory.paused, 3000, 'factory reloaded')
      await env.engine.jobs.enqueue({ id: 'j2', task: 't', role: 'writer' })
      await sleep(300)
      expect(await jobsIn(env, 'queued')).toEqual(['j2.md'])

      // an invalid edit keeps the previous version and logs it
      await writeMd(path.join(env.dir, 'agents', 'writer-late.md'), { kind: 'agent', role: 'writer', name: 'Late', max_parallel: 'many' }, '')
      await waitFor(() => env!.logs.some((l) => l.includes('could not reload agents/writer-late.md')), 3000, 'error logged')
      expect(env.engine.agents.get('writer-late')?.data.max_parallel).toBe(1)
    } finally {
      await w.close()
    }
  })

  it('snapshot lists agents, states and spend', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }] })
    await sleep(150)
    await env.engine.handleCommand({ type: 'snapshot' })
    const snap = env.events.find((e) => e.type === 'snapshot')
    expect(snap).toMatchObject({ paused: false, agents: [{ id: 'writer-a', role: 'writer', state: 'idle' }], spend: { dailyCap: 5, monthlyCap: 40 } })
    await env.engine.handleCommand({ type: 'ping', id: 'p1' })
    expect(env.events.some((e) => e.type === 'pong' && e.id === 'p1')).toBe(true)
  })
})

describe('scheduler with a client provider', () => {
  const clientEnv = () =>
    makeEnv({
      providers: [{ id: 'client', kind: 'client', local: true, concurrency: 8, models: ['claude-code'] }],
      roles: { writer: ['client/claude-code'] },
      agents: [{ role: 'writer', name: 'A' }]
    })

  it('a job on client waits in the queue, is answered over it and completes, at no cost', async () => {
    env = await clientEnv()
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'b1--t--u1--r0', task: 't', role: 'writer', book: 'b1', unit: 'u1' }, 'Write it.')
    const q = env.engine.clientQueue
    await waitFor(() => q.counts().waiting === 1, 5000, 'a task waits')
    expect(await jobsIn(env, 'running')).toEqual(['b1--t--u1--r0.md']) // parked, still running
    expect(q.list()[0]).toMatchObject({ id: 'b1--t--u1--r0#1', job: 'b1--t--u1--r0', call: 1, role: 'writer', task: 't', book: 'b1', agent: 'writer-a', unit: 'u1' })
    const t = q.lease({ book: 'b1' })!
    expect(t.messages.at(-1)?.content).toBe('do b1--t--u1--r0')
    expect(q.submit(t.id, 'The answer from the client.')).toEqual({ accepted: true })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'job done')
    const done = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'b1--t--u1--r0.md'), 'utf8'))
    expect(done.data).toMatchObject({ model: 'client/claude-code', paid: false, attempts: 0 })
    expect(done.body).toContain('The answer from the client.')
    const spend = env.events.filter((e) => e.type === 'spend') as { costUsd: number; provider: string }[]
    expect(spend).toHaveLength(1)
    expect(spend[0]).toMatchObject({ provider: 'client', costUsd: 0 })
    expect(q.counts()).toEqual({ waiting: 0, leased: 0 })
  })

  it('a schema that fails on submit leaves the task leased, and the fixed answer goes through', async () => {
    env = await clientEnv()
    let got = ''
    env.engine.scheduler.register('t', async (ctx) => {
      const r = await ctx.chat({ messages: [{ role: 'user', content: 'json please' }], schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } })
      got = r.text
      return { result: 'x' }
    })
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    const q = env.engine.clientQueue
    await waitFor(() => q.counts().waiting === 1, 5000, 'a task waits')
    const t = q.lease()!
    expect(t.schema).toBeTruthy()
    expect(q.submit(t.id, 'I would rather talk.')).toMatchObject({ accepted: false })
    expect(q.submit(t.id, '{"ok": "yes"}')).toMatchObject({ accepted: false, problems: ['ok: expected boolean, got string'] })
    expect(q.counts()).toEqual({ waiting: 0, leased: 1 })
    expect(await jobsIn(env, 'done')).toEqual([])
    expect(q.submit(t.id, '{"ok": true}')).toEqual({ accepted: true })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'job done')
    expect(got).toBe('{"ok": true}')
  })

  it('stopping the agent drops the task and requeues the job without an attempt; the new request is a new task', async () => {
    env = await clientEnv()
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    const q = env.engine.clientQueue
    await waitFor(() => q.counts().waiting === 1, 5000, 'a task waits')
    const first = q.lease()!
    await env.engine.handleCommand({ type: 'stop', agent: 'writer-a' })
    await waitFor(() => q.list().map((x) => x.id).join() === 'j1#2', 8000, 'the job asks again')
    expect(q.submit(first.id, 'late')).toMatchObject({ accepted: false, problems: [expect.stringContaining('task not found')] })
    expect(q.submit('j1#2', 'second try')).toEqual({ accepted: true })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 8000, 'done')
    expect(parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'j1.md'), 'utf8')).data.attempts).toBe(0)
  })
})

describe('a job parked on the client does not hold its agent (V6)', () => {
  const clientEnv = (concurrency: number, maxParallel = 1) =>
    makeEnv({
      providers: [{ id: 'client', kind: 'client', local: true, concurrency, models: ['claude-code'] }],
      roles: { writer: ['client/claude-code'] },
      agents: [{ role: 'writer', name: 'A', maxParallel }]
    })

  it('three jobs of one agent (max_parallel 1) all park as client tasks', async () => {
    env = await clientEnv(4)
    registerChat(env)
    for (const u of ['u1', 'u2', 'u3']) await env.engine.jobs.enqueue({ id: `b1--t--${u}--r0`, task: 't', role: 'writer', book: 'b1', unit: u })
    const q = env.engine.clientQueue
    await waitFor(() => q.counts().waiting === 3, 5000, 'three tasks wait')
    expect(await jobsIn(env, 'running')).toHaveLength(3)
    for (const t of q.list()) q.submit(t.id, 'answer')
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 3, 8000, 'all done')
  })

  it('a job on a real model still takes the agent: only one runs at a time', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }] })
    let active = 0
    let max = 0
    registerChat(env, 't', { before: () => (max = Math.max(max, ++active)), after: () => active-- })
    env.mock.onAny({ text: 'slow answer', chunks: 4, chunkDelayMs: 40 })
    for (const u of ['u1', 'u2', 'u3']) await env.engine.jobs.enqueue({ id: `b1--t--${u}--r0`, task: 't', role: 'writer', book: 'b1', unit: u })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 3, 10000, 'all done')
    expect(max).toBe(1)
  })

  it('the client provider concurrency caps the parked jobs', async () => {
    env = await clientEnv(2)
    registerChat(env)
    for (const u of ['u1', 'u2', 'u3']) await env.engine.jobs.enqueue({ id: `b1--t--${u}--r0`, task: 't', role: 'writer', book: 'b1', unit: u })
    const q = env.engine.clientQueue
    await waitFor(() => q.counts().waiting === 2, 5000, 'two tasks wait')
    await sleep(300)
    expect(q.counts().waiting).toBe(2)
    expect(await jobsIn(env, 'queued')).toHaveLength(1)
    // answering one frees a slot for the third
    q.submit(q.list()[0]!.id, 'answer')
    await waitFor(() => q.list().some((t) => t.job.includes('u3')), 5000, 'the third parks')
  })
})

describe('jobs that need no model do not wait for a slot (V18)', () => {
  it('a skipModel job runs while the only provider has no capacity, and a lazy chat waits for it', async () => {
    env = await makeEnv({
      providers: [{ id: 'loc', local: true, concurrency: 1, models: ['m1'] }, { id: 'alt', local: true, concurrency: 4, models: ['m2'] }],
      roles: { writer: ['loc/m1', 'alt/m2'] },
      agents: [{ role: 'writer', name: 'A' }, { role: 'writer', name: 'B' }, { role: 'writer', name: 'C' }]
    })
    const order: string[] = []
    let lazyModel: string | undefined
    let modelAtStart: string | undefined = 'unset'
    env.mock.onAny({ text: 'slow answer', chunks: 6, chunkDelayMs: 60 })
    env.engine.scheduler.register('hold', async (ctx) => {
      order.push('hold:start')
      await ctx.chat({ messages: [{ role: 'user', content: 'x' }] })
      order.push('hold:end')
      return { result: 'ok' }
    })
    env.engine.scheduler.register(
      'skip',
      async () => {
        order.push('skip:ran')
        return { result: 'no model needed' }
      },
      { skipModel: async () => true }
    )
    env.engine.scheduler.register(
      'lazy',
      async (ctx) => {
        order.push('lazy:start')
        modelAtStart = ctx.model?.ref
        const r = await ctx.chat({ messages: [{ role: 'user', content: 'y' }] })
        lazyModel = r.model.ref
        order.push('lazy:end')
        return { result: 'ok' }
      },
      { skipModel: async () => true }
    )
    await env.engine.jobs.enqueue({ id: 'hold1', task: 'hold', role: 'writer' })
    await waitFor(() => order.includes('hold:start'), 5000, 'hold started')
    await env.engine.jobs.enqueue({ id: 'skip1', task: 'skip', role: 'writer' })
    await env.engine.jobs.enqueue({ id: 'lazy1', task: 'lazy', role: 'writer' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 3, 10000, 'all done')
    // the no-op job ran while hold still had the only slot of loc; the lazy job started at once but its chat waited for loc
    expect(order.indexOf('skip:ran')).toBeLessThan(order.indexOf('hold:end'))
    expect(order.indexOf('lazy:start')).toBeLessThan(order.indexOf('hold:end'))
    expect(order.indexOf('lazy:end')).toBeGreaterThan(order.indexOf('hold:end'))
    expect(modelAtStart).toBeUndefined()
    expect(lazyModel).toBe('loc/m1') // the first candidate, not the fallback it could have had at once
    const done = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'lazy1.md'), 'utf8'))
    expect(done.data).toMatchObject({ model: 'loc/m1', paid: false })
  })

  it('an error in skipModel counts as false: the job waits for its slot as usual', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }] })
    env.engine.scheduler.register(
      't',
      async (ctx) => {
        const r = await ctx.chat({ messages: [{ role: 'user', content: 'x' }] })
        return { result: `${ctx.model?.ref} ${r.text.length > 0}` }
      },
      { skipModel: async () => Promise.reject(new Error('boom')) }
    )
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'done')
    expect(parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'j1.md'), 'utf8')).body).toContain('loc/m1 true')
  })
})

describe('job priority (V11)', () => {
  it('a later priority-1 job runs before an earlier priority-0 job, and dependencies still win', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }] })
    const order: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    env.engine.scheduler.register('gate', async () => {
      await gate
      return { result: 'ok' }
    })
    env.engine.scheduler.register('t', async (ctx) => {
      order.push(ctx.job.id)
      return { result: 'ok' }
    })
    const j = env.engine.jobs
    await j.enqueue({ id: 'gate1', task: 'gate', role: 'writer' })
    await waitFor(async () => (await jobsIn(env!, 'running')).length === 1, 5000, 'gate running')
    await j.enqueue({ id: 'old0', task: 't', role: 'writer' })
    await sleep(15)
    await j.enqueue({ id: 'new1', task: 't', role: 'writer', priority: 1 })
    await j.enqueue({ id: 'new1-dep', task: 't', role: 'writer', priority: 1, depends_on: ['old0'] })
    release()
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 4, 8000, 'all done')
    expect(order).toEqual(['new1', 'old0', 'new1-dep'])
  })

  describe('lanes', () => {
    /** Four no-model jobs on one art-director agent (max_parallel 1): which of them run together. */
    const run = async (lanes: Record<string, string | undefined>) => {
      env = await makeEnv({ roles: { art: ['loc/m1'] }, agents: [{ role: 'art', name: 'Art' }] })
      const live = new Set<string>()
      const together: string[] = []
      let release: () => void = () => {}
      const gate = new Promise<void>((r) => (release = r))
      env.engine.scheduler.register(
        't',
        async (ctx) => {
          live.add(ctx.job.id)
          together.push([...live].sort().join('+'))
          await gate
          live.delete(ctx.job.id)
          return { result: 'ok' }
        },
        { noModel: true }
      )
      for (const [id, lane] of Object.entries(lanes)) await env.engine.jobs.enqueue({ id, task: 't', role: 'art', ...(lane ? { lane } : {}) })
      await sleep(600)
      const first = [...live].sort()
      release()
      await waitFor(async () => (await jobsIn(env!, 'done')).length === Object.keys(lanes).length, 8000, 'all done')
      return { first, together }
    }

    it('a flow job and a job without a lane run at the same time', async () => {
      const r = await run({ comfy1: undefined, flow1: 'flow' })
      expect(r.first).toEqual(['comfy1', 'flow1'])
    })

    it('two jobs without a lane still run one at a time', async () => {
      const r = await run({ comfy1: undefined, comfy2: undefined })
      expect(r.first).toHaveLength(1)
      expect(r.together.every((t) => !t.includes('+'))).toBe(true)
    })

    it('two jobs of the flow lane run one at a time, with a job without a lane beside them', async () => {
      const r = await run({ comfy1: undefined, flow1: 'flow', flow2: 'flow' })
      expect(r.first).toHaveLength(2)
      expect(r.first).toContain('comfy1')
      expect(r.together.every((t) => t.split('+').filter((x) => x.startsWith('flow')).length <= 1)).toBe(true)
    })
  })
})
