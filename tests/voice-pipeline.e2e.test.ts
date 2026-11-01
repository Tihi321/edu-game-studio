import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPlaytest } from '../src/engine/edu/playtest'
import { courseFile, json, makePipelineEnv, run, toolsOf } from './pipeline-helpers'
import type { PipelineEnv } from './pipeline-helpers'

/** The real autoplay bot on the language course with every asset kind (Chromium), moved out of tests/voice-pipeline.test.ts (EGS-40). */
const SLUG = 'croatian-greetings'
const BRIEF_LANG = { topic: 'Croatian greetings', audience: 'adults', age: 30, sourceLang: 'en', targetLang: 'hr', cefr: 'A1', units: 2, story: 'none', shells: ['quiz-arena', 'rpg'], media: { voice: { narration: true } } }
const HR_CLIPS = ['voice-hr-item-u1-q1-opt-a', 'voice-hr-item-u1-q2-listen-transcript', 'voice-hr-item-u2-q1-opt-a', 'voice-hr-item-u2-q2-listen-transcript']

interface Pack {
  items: { id: string; kind: string }[]
}
const packOf = (env: PipelineEnv) => json<Pack>(courseFile(env, SLUG, 'course', 'pack.json'))
const pf = (env: PipelineEnv, ...p: string[]) => courseFile(env, SLUG, 'pipeline', ...p)

/** Today's Gemini quota with 7 of 10 requests used: Croatian (4 clips) does not fit in the 3 left, English (2 clips) does. */
async function useQuota(env: PipelineEnv, used: number): Promise<void> {
  await (await env.engine.edu.voice.quota()).add(used)
}

describe('the real autoplay bot plays the language course with sound on', () => {
  it('0 console errors, 0 media errors, every image and audio file of the build (pictures, music, sound effects and the 6 spoken clips) is loaded, the course is finished; a broken clip is a media error', async () => {
    const env = await makePipelineEnv({ playtest: (dir, opts) => runPlaytest(dir, { ...opts, personas: ['perfect', 'average'], concurrency: 1, timeoutMs: 200_000 }) })
    try {
      await useQuota(env, 7)
      await run(env, BRIEF_LANG, 250_000)
      const st = (await toolsOf(env).call('edu_status', { slug: SLUG })).data.pipeline as { stage: string; blockedBy?: string[]; failed?: unknown[] }
      expect(st.stage, JSON.stringify(st.blockedBy ?? st.failed)).toBe('published')
      const play = await json<{ ok: boolean; runs: { persona: string; summary: { finished: boolean; consoleErrors: number; mediaErrors: number; steps: number; media: { checked: boolean; images: number; audio: number } } }[] }>(pf(env, 'playtest.json'))
      expect(play.ok).toBe(true)
      expect(play.runs.map((r) => r.persona)).toEqual(['perfect', 'average'])
      for (const r of play.runs) {
        expect([r.summary.finished, r.summary.consoleErrors, r.summary.mediaErrors], r.persona).toEqual([true, 0, 0])
        expect(r.summary.media, r.persona).toEqual({ checked: true, images: 10, audio: 18 })
      }
      // the bot answered the derived listening items too (they are part of the 22 items)
      expect((await packOf(env)).items.filter((i) => i.kind === 'listening')).toHaveLength(4)

      // a clip that does not decode: a media error that fails the run, like a console error
      const build = courseFile(env, SLUG, 'build')
      await writeFile(path.join(build, 'assets', HR_CLIPS[0]!, 'v1.wav'), 'this is not audio')
      const bad = await runPlaytest(build, { personas: ['perfect'], timeoutMs: 120_000 })
      expect(bad.ok).toBe(false)
      expect(bad.runs[0]!.summary!.mediaErrors).toBeGreaterThanOrEqual(1)
      expect(bad.failures.some((f) => new RegExp(`media: ${HR_CLIPS[0]}`).test(f))).toBe(true)
    } finally {
      await env.cleanup()
    }
  }, 500_000)
})
