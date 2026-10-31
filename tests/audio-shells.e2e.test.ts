import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { chromiumUnavailable, expectPassed, play, PLAYER_OUT } from './bot-helpers'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'

/**
 * The music and the sound effects in every shell (EGS-22), in a real browser: the solar-system fixture gets a music cue for the menu and for
 * the first unit, and a sound effect; for each shell a recording `Audio` stands in for the real one. The title plays the menu music after the first
 * gesture, a unit's world plays the unit's track, "reduce audio" and "sound" stop the music, and the sound effect of an answer plays. Skipped, with
 * a message, only when Chromium cannot be launched.
 */

useTemp()

const unavailable = await chromiumUnavailable()
if (unavailable) console.warn(`[audio-shells.e2e] SKIPPED: Chromium cannot be launched (${unavailable}). Run "yarn playwright install chromium".`)



async function buildWithCues(): Promise<string> {
  const { root } = await copyFixture('solar-system')
  const file = path.join(root, 'course', 'pack.json')
  const pack = JSON.parse(await readFile(file, 'utf8')) as { cues: unknown[]; units: { id: string }[] }
  const u1 = pack.units[0]!.id
  pack.cues = [
    { id: 'cue-music-menu', on: 'music:menu', asset: 'aud-beeps', loop: true, volume: 0.5 },
    { id: 'cue-music-u1', on: `music:unit-${u1}`, asset: 'aud-beeps', loop: true, volume: 0.6 },
    { id: 'cue-sfx-correct', on: 'correct', asset: 'aud-beeps', loop: false, volume: 0.8 }
  ]
  await writeFile(file, JSON.stringify(pack, null, 2))
  const out = await tmp('edu-audio-')
  const res = await buildCourse(root, out, { playerDir: PLAYER_OUT })
  expect(res.problems).toEqual([])
  expect(res.ok).toBe(true)
  return out
}

const RECORDER = `
  window.__audio = []
  const Real = window.Audio
  window.Audio = function (src) {
    const rec = { src, volume: 1, loop: false, paused: true, plays: 0, listeners: {} }
    window.__audio.push(rec)
    return {
      get src() { return rec.src },
      get volume() { return rec.volume }, set volume(v) { rec.volume = v },
      get loop() { return rec.loop }, set loop(v) { rec.loop = v },
      get paused() { return rec.paused },
      currentTime: 0,
      play() { rec.paused = false; rec.plays++; return Promise.resolve() },
      pause() { rec.paused = true },
      addEventListener() {}, removeEventListener() {}, load() {}
    }
  }
  window.Audio.prototype = Real.prototype
`

describe.skipIf(!!unavailable)('the game audio in the shells of one course', () => {
  let dirP: Promise<string> | undefined
  const built = (): Promise<string> => (dirP ??= buildWithCues())

  for (const shell of ['quiz-arena', 'encyclopedia', 'mindmaze', 'rpg', 'detective'] as const) {
    it(`${shell}: the menu music after the first gesture, the toggles stop it, the title has both`, { timeout: 120_000 }, async () => {
      const dir = await built()
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const page = await browser.newPage()
        const errors: string[] = []
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
        page.on('pageerror', (e) => errors.push(String(e)))
        await page.addInitScript(RECORDER)
        await page.goto(pathToFileURL(path.join(dir, 'index.html')).href + `?seed=1&shell=${shell}`)
        await page.waitForSelector('[data-testid="course-title"]')
        await page.keyboard.press('Shift') // a gesture: the browser would allow the music now
        await page.waitForFunction(() => (globalThis as unknown as { __audio: { plays: number }[] }).__audio.some((a) => a.plays > 0), null, { timeout: 5000 })
        const music = await page.evaluate(() => (globalThis as unknown as { __audio: { src: string; loop: boolean; paused: boolean }[] }).__audio.filter((a) => a.loop))
        expect(music, 'a looping music track was made').toHaveLength(1)
        expect(music[0]!.paused).toBe(false)
        expect(await page.locator('[data-testid="setting-sound"]').count()).toBe(1)
        expect(await page.locator('[data-testid="setting-reduce-audio"]').count()).toBe(1)
        await page.locator('[data-testid="setting-reduce-audio"]').check()
        await page.waitForFunction(() => (globalThis as unknown as { __audio: { loop: boolean; paused: boolean }[] }).__audio.filter((a) => a.loop).every((a) => a.paused), null, { timeout: 5000 })
        await page.locator('[data-testid="setting-reduce-audio"]').uncheck()
        await page.waitForFunction(() => (globalThis as unknown as { __audio: { loop: boolean; paused: boolean }[] }).__audio.some((a) => a.loop && !a.paused), null, { timeout: 5000 })
        await page.locator('[data-testid="setting-sound"]').uncheck()
        await page.waitForFunction(() => (globalThis as unknown as { __audio: { loop: boolean; paused: boolean }[] }).__audio.filter((a) => a.loop).every((a) => a.paused), null, { timeout: 5000 })
        expect(errors).toEqual([])
      } finally {
        await browser.close()
      }
    })
  }

  for (const shell of ['rpg', 'mindmaze'] as const) {
    it(`${shell}: the bot plays the whole game with the music and the effects on: 0 console errors, 0 media errors`, { timeout: 300_000 }, async () => {
      const r = await play(await built(), ['--mode', 'perfect', '--shell', shell])
      expectPassed(r)
      expect(r.summary.mediaErrors).toBe(0)
      expect(r.summary.finished).toBe(true)
    })
  }
})
