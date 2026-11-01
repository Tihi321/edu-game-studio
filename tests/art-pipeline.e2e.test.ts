import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPlaytest } from '../src/engine/edu/playtest'
import { BRIEF, courseFile, json, makePipelineEnv, pf, pipelineOf, run, SLUG } from './pipeline-helpers'

/** The real autoplay bot on a pipeline course with art (Chromium), moved out of tests/art-pipeline.test.ts (EGS-40). */
const BRIEF_RPG = { ...BRIEF, shells: ['quiz-arena', 'rpg'], media: { music: { enabled: false } } }

describe('the real autoplay bot plays a course with art', () => {
  it('0 console errors and 0 media errors; every asset of the build was loaded in the page; a broken image is a media error that fails the run', async () => {
    const env = await makePipelineEnv({ playtest: (dir, opts) => runPlaytest(dir, { ...opts, personas: ['perfect', 'average'], concurrency: 1, timeoutMs: 200_000 }) })
    try {
      await run(env, BRIEF_RPG, 200_000)
      const p = await pipelineOf(env)
      expect(p.stage, JSON.stringify(p.blockedBy ?? p.failed)).toBe('published')
      const play = await json<{ ok: boolean; runs: { persona: string; summary: { finished: boolean; consoleErrors: number; mediaErrors: number; media: { checked: boolean; images: number; audio: number } } }[] }>(pf(env, 'playtest.json'))
      expect(play.ok).toBe(true)
      for (const r of play.runs) {
        expect([r.summary.finished, r.summary.consoleErrors, r.summary.mediaErrors], r.persona).toEqual([true, 0, 0])
        expect(r.summary.media).toEqual({ checked: true, images: 10, audio: 0 })
      }

      // a picture that does not decode: the bot reports it as a media error and the run fails, like a console error
      const build = courseFile(env, SLUG, 'build')
      await writeFile(path.join(build, 'assets', 'img-article-a-u1-1', 'v1.webp'), 'this is not a picture')
      const bad = await runPlaytest(build, { personas: ['perfect'], timeoutMs: 120_000 })
      expect(bad.ok).toBe(false)
      expect(bad.runs[0]!.summary!.mediaErrors).toBeGreaterThanOrEqual(1)
      expect(bad.failures.some((f) => /media: img-article-a-u1-1 \(assets\/img-article-a-u1-1\/v1\.webp\)/.test(f))).toBe(true)
    } finally {
      await env.cleanup()
    }
  }, 400_000)
})
