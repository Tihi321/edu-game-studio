import { describe, expect, it } from 'vitest'
import { runPlaytest } from '../src/engine/edu/playtest'
import { BRIEF, json, makePipelineEnv, pf, pipelineOf, run } from './pipeline-helpers'

/** The pipeline with the REAL autoplay bot (Chromium), moved out of tests/pipeline-run.test.ts (EGS-40). */

describe('the pipeline with the real autoplay bot', () => {
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
