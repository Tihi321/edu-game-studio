import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPlaytest } from '../src/engine/edu/playtest'
import { BRIEF, courseFile, json, makePipelineEnv, pf, pipelineOf, run, SLUG } from './pipeline-helpers'

/** The real autoplay bot and the real player on a pipeline course with art and music (Chromium), moved out of tests/music-pipeline.test.ts (EGS-40). */
const BRIEF_RPG = { ...BRIEF, shells: ['quiz-arena', 'rpg'] }

describe('the real autoplay bot and the real player play a course with art and music', () => {
  it('the bot plays with sound on: 0 console errors and 0 media errors, every image and audio file of the build was loaded; a broken sound is a media error that fails the run', async () => {
    const env = await makePipelineEnv({ playtest: (dir, opts) => runPlaytest(dir, { ...opts, personas: ['perfect', 'average'], concurrency: 1, timeoutMs: 200_000 }) })
    try {
      await run(env, BRIEF_RPG, 200_000)
      const p = await pipelineOf(env)
      expect(p.stage, JSON.stringify(p.blockedBy ?? p.failed)).toBe('published')
      const play = await json<{ ok: boolean; runs: { persona: string; summary: { finished: boolean; consoleErrors: number; mediaErrors: number; media: { checked: boolean; images: number; audio: number } } }[] }>(pf(env, 'playtest.json'))
      expect(play.ok).toBe(true)
      for (const r of play.runs) {
        expect([r.summary.finished, r.summary.consoleErrors, r.summary.mediaErrors], r.persona).toEqual([true, 0, 0])
        expect(r.summary.media).toEqual({ checked: true, images: 10, audio: 12 })
      }

      // a sound that does not decode: the bot reports it as a media error and the run fails, like a console error
      const build = courseFile(env, SLUG, 'build')
      await writeFile(path.join(build, 'assets', 'sfx-correct', 'v1.wav'), 'this is not audio')
      const bad = await runPlaytest(build, { personas: ['perfect'], timeoutMs: 120_000 })
      expect(bad.ok).toBe(false)
      expect(bad.runs[0]!.summary!.mediaErrors).toBeGreaterThanOrEqual(1)
      expect(bad.failures.some((f) => /media: sfx-correct \(assets\/sfx-correct\/v1\.wav\)/.test(f))).toBe(true)
    } finally {
      await env.cleanup()
    }
  }, 400_000)

  it('in the real player: the menu music starts, "reduce audio" and "sounds" stop it and are kept with the progress, a round starts the unit\'s music, and a broken file is a console error', async () => {
    const env = await makePipelineEnv()
    try {
      await run(env, BRIEF, 120_000)
      expect((await pipelineOf(env)).stage).toBe('published')
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const page = await browser.newPage()
        const errors: string[] = []
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(m.text())
        })
        page.on('pageerror', (e) => errors.push(String(e)))
        // every Audio element the player makes is recorded (the browser may refuse to play before a click; what the player does with the elements is what counts)
        await page.addInitScript(
          `window.__made = []; const Native = window.Audio; window.Audio = function (src) { const el = new Native(src); window.__made.push({ src: String(src || ''), el }); return el }`
        )
        const url = `file:///${courseFile(env, SLUG, 'build', 'index.html').replace(/\\/g, '/')}`
        await page.goto(url)
        await page.waitForSelector('[data-testid="course-title"]')
        const made = (): Promise<{ src: string; paused: boolean; volume: number; loop: boolean }[]> => page.evaluate("window.__made.map((m) => ({ src: m.src.replace(/^.*\\/assets\\//, 'assets/'), paused: m.el.paused, volume: m.el.volume, loop: m.el.loop }))")
        // the menu music: one track, looping, fading in
        await expect.poll(async () => (await made()).filter((m) => m.src === 'assets/mus-menu/v1.wav').length).toBe(1)
        await expect.poll(async () => (await made()).find((m) => m.src === 'assets/mus-menu/v1.wav')!.volume, { timeout: 5000 }).toBeGreaterThan(0.3)
        expect((await made()).find((m) => m.src === 'assets/mus-menu/v1.wav')).toMatchObject({ loop: true })

        // "reduce audio" is next to the sound toggle; turning it on stops the music at once and is kept with the progress
        expect(await page.locator('[data-testid="setting-sound"]').count()).toBe(1)
        await page.locator('[data-testid="setting-reduce-audio"]').check()
        expect((await made()).find((m) => m.src === 'assets/mus-menu/v1.wav')!.paused).toBe(true)
        expect(await page.evaluate("Object.entries(localStorage).filter(([k]) => k.startsWith('edu-studio:progress:')).map(([, v]) => JSON.parse(v).settings)")).toEqual([expect.objectContaining({ reduceAudio: true, sound: true })])
        await page.reload()
        await page.waitForSelector('[data-testid="course-title"]')
        expect(await page.locator('[data-testid="setting-reduce-audio"]').isChecked()).toBe(true)
        expect((await made()).filter((m) => m.src.includes('/mus-'))).toEqual([]) // no music at all while audio is reduced

        // off again: the menu music is back; starting a unit round changes the music to the unit's track, one at a time
        await page.locator('[data-testid="setting-reduce-audio"]').uncheck()
        await expect.poll(async () => (await made()).filter((m) => m.src === 'assets/mus-menu/v1.wav').length).toBe(1)
        await page.locator('[data-testid="start"]').click()
        await page.locator('[data-testid="unit-u1"]').click()
        await expect.poll(async () => (await made()).some((m) => m.src === 'assets/mus-unit-u1/v1.wav')).toBe(true)
        await expect.poll(async () => (await made()).filter((m) => m.src.includes('/mus-') && !m.paused).length, { timeout: 5000 }).toBe(1)
        expect(errors).toEqual([])
      } finally {
        await browser.close()
      }
    } finally {
      await env.cleanup()
    }
  }, 240_000)
})
