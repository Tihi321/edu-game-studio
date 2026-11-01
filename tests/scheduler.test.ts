import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseMd } from '../src/shared/md'
import type { EngineEvent } from '../src/shared/protocol'
import { makeEnv, waitFor } from './helpers'
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

  it('respects depends_on, waiting_on and locks', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }, { role: 'writer', name: 'B' }] })
    const order: string[] = []
    env.engine.scheduler.register('t', async (ctx) => {
      order.push(`start:${ctx.job.id}`)
      await new Promise((r) => setImmediate(r)) // a yield: a broken lock or dependency would show as an overlap
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
    await env.engine.scheduler.tick()
    await env.engine.scheduler.tick()
    expect(await jobsIn(env, 'queued')).toEqual(['j1.md'])
    await env.engine.handleCommand({ type: 'resumeAll' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'done after resume')
    expect(parseMd(await readFile(path.join(env.dir, 'config', 'factory.md'), 'utf8')).data.paused).toBe(false)
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
    await env.engine.scheduler.tick()
    await env.engine.scheduler.tick()
    // The paid request would cost about 4 USD (4096 max tokens at 1000 USD per 1M), more than the 0.5 cap.
    expect(await jobsIn(env, 'done')).toEqual(['local-job.md'])
    expect(await jobsIn(env, 'queued')).toEqual(['paid-job.md'])
    expect(env.engine.budget.spentToday()).toBe(0)
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

  it('fire gracefully finishes the job first, fire now aborts and requeues it', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }, { role: 'writer', name: 'B' }] })
    env.mock.onAny({ text: 'text '.repeat(10), chunkDelayMs: 60, chunks: 10 })
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    const runner = await waitFor(() => env!.engine.scheduler.runningJobs()[0], 8000, 'job running')
    const fileOf = (id: string) => path.join(env!.dir, 'agents', `${id}.md`)
    await env.engine.handleCommand({ type: 'fire', agent: runner.agent })
    expect(existsSync(fileOf(runner.agent))).toBe(true) // still working
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'finished')
    await waitFor(() => !existsSync(fileOf(runner.agent)), 8000, 'file removed')

    const other = env.engine.agents.list()[0]!.id
    env.mock.onAny({ text: 'text '.repeat(40), chunkDelayMs: 60, chunks: 40 })
    await env.engine.jobs.enqueue({ id: 'j2', task: 't', role: 'writer' })
    await waitFor(() => env!.engine.scheduler.runningJobs().length === 1, 8000, 'j2 running')
    await env.engine.handleCommand({ type: 'fire', agent: other, now: true })
    await waitFor(async () => (await jobsIn(env!, 'queued')).includes('j2.md'), 8000, 'j2 requeued')
    expect(existsSync(fileOf(other))).toBe(false)
    expect(await jobsIn(env, 'running')).toEqual([])
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
    await j.enqueue({ id: 'a-old0', task: 't', role: 'writer' })
    await j.enqueue({ id: 'b-new1', task: 't', role: 'writer', priority: 1 })
    await j.enqueue({ id: 'b-new1-dep', task: 't', role: 'writer', priority: 1, depends_on: ['a-old0'] })
    release()
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 4, 8000, 'all done')
    expect(order).toEqual(['b-new1', 'a-old0', 'b-new1-dep'])
  })
})
