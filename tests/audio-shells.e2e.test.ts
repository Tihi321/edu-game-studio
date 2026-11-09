import { copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { PLAYER_OUT } from './bot-helpers'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'
import { FIXTURES } from './edu-fixtures'

/**
 * The music and the sound effects in every shell (EGS-22), in a real browser: the course gets a music cue for the menu and for the first unit,
 * and a sound effect; for each shell a recording `Audio` stands in for the real one. The title plays the menu music after the first gesture,
 * "reduce audio" and "sound" stop the music, and (EGS-62, HUB-28) the in-game audio panel works: it opens from the speaker button, the music
 * slider sets the volume of the playing track, the value survives a reload and Escape closes the panel with the focus back on the button.
 * The quiz arena also has the button in a round; the role-play clip ducks the music. Without Chromium the run fails.
 */

useTemp()

type Shell = 'quiz-arena' | 'encyclopedia' | 'mindmaze' | 'rpg' | 'roleplay' | 'detective'
/** The fixture that enables each shell (as in the bot tests). */
const SHELLS: { shell: Shell; fixture: 'solar-system' | 'hr-a1-greetings' | 'european-capitals' }[] = [
  { shell: 'quiz-arena', fixture: 'solar-system' },
  { shell: 'encyclopedia', fixture: 'solar-system' },
  { shell: 'mindmaze', fixture: 'solar-system' },
  { shell: 'rpg', fixture: 'solar-system' },
  { shell: 'roleplay', fixture: 'hr-a1-greetings' },
  { shell: 'detective', fixture: 'european-capitals' }
]

async function buildWithCues(fixture: string): Promise<string> {
  const { root } = await copyFixture(fixture)
  const file = path.join(root, 'course', 'pack.json')
  const pack = JSON.parse(await readFile(file, 'utf8')) as { cues: unknown[]; units: { id: string }[]; assets: { id: string; kind: string; file: string; alt: string }[]; shells?: { config?: { roleplay?: { scenes: { lines: { audio?: string }[] }[] } } } }
  let asset = pack.assets.find((a) => a.kind === 'audio')?.id
  if (!asset) {
    // european-capitals has no sound: borrow the beeps of solar-system
    asset = 'aud-beeps'
    await copyFile(path.join(FIXTURES, 'solar-system', 'course', 'assets', 'eight-beeps.wav'), path.join(root, 'course', 'assets', 'eight-beeps.wav'))
    pack.assets.push({ id: asset, kind: 'audio', file: 'assets/eight-beeps.wav', alt: pack.assets[0]!.alt })
  }
  const u1 = pack.units[0]!.id
  // the first line of the first role-play scene gets a clip (in the fixture the clips are in later scenes, behind turns)
  const scenes = pack.shells?.config?.roleplay?.scenes
  if (scenes) scenes[0]!.lines[0]!.audio = asset
  pack.cues = [
    { id: 'cue-music-menu', on: 'music:menu', asset, loop: true, volume: 0.5 },
    { id: 'cue-music-u1', on: `music:unit-${u1}`, asset, loop: true, volume: 0.6 },
    { id: 'cue-sfx-correct', on: 'correct', asset, loop: false, volume: 0.8 }
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

type Rec = { loop: boolean; paused: boolean; volume: number }
/** The gain curve of the volume sliders (as `volumeGain` in `audio.ts`). */
const gain = (v: number): number => (v / 100) ** 1.6

describe('the game audio in the shells', () => {
  const dirs = new Map<string, Promise<string>>()
  const built = (fixture: string): Promise<string> => {
    if (!dirs.has(fixture)) dirs.set(fixture, buildWithCues(fixture))
    return dirs.get(fixture)!
  }

  for (const { shell, fixture } of SHELLS) {
    it(`${shell}: the menu music after the first gesture, the audio panel (slider, reload, Escape), the toggles stop it`, { timeout: 120_000 }, async () => {
      const dir = await built(fixture)
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const page = await browser.newPage()
        const errors: string[] = []
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
        page.on('pageerror', (e) => errors.push(String(e)))
        await page.addInitScript(RECORDER)
        const url = pathToFileURL(path.join(dir, 'index.html')).href + `?seed=1&shell=${shell}`
        const playing = (): Promise<unknown> => page.waitForFunction(() => (globalThis as unknown as { __audio: Rec[] }).__audio.some((a) => a.loop && !a.paused), null, { timeout: 5000 })
        const volumeNear = (v: number): Promise<unknown> =>
          page.waitForFunction((want) => (globalThis as unknown as { __audio: Rec[] }).__audio.some((a) => a.loop && !a.paused && Math.abs(a.volume - want) < 0.01), v, { timeout: 5000 })
        await page.goto(url)
        await page.waitForSelector('[data-testid="course-title"]')
        await page.keyboard.press('Shift') // a gesture: the browser would allow the music now
        await playing()
        const music = await page.evaluate(() => (globalThis as unknown as { __audio: Rec[] }).__audio.filter((a) => a.loop))
        expect(music, 'a looping music track was made').toHaveLength(1)
        expect(music[0]!.paused).toBe(false)

        // the audio panel: opens from the speaker button, the music slider sets the volume of the playing track
        await volumeNear(0.5)
        await page.locator('[data-testid="audio-settings"]').click()
        await page.waitForSelector('[data-testid="audio-panel"]')
        await page.locator('[data-testid="setting-music-volume"]').fill('50')
        await volumeNear(0.5 * gain(50))
        expect(await page.locator('[data-testid="setting-music-volume-value"]').textContent()).toBe('50')
        await page.keyboard.press('Escape')
        await page.waitForSelector('[data-testid="audio-panel"]', { state: 'detached' })
        expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('audio-settings')

        // the value survives a reload
        await page.reload()
        await page.waitForSelector('[data-testid="course-title"]')
        await page.keyboard.press('Shift')
        await playing()
        await volumeNear(0.5 * gain(50))
        await page.locator('[data-testid="audio-settings"]').click()
        expect(await page.locator('[data-testid="setting-music-volume"]').inputValue()).toBe('50')
        await page.keyboard.press('Escape')

        if (shell === 'quiz-arena') {
          // the button is also in a round
          await page.locator('[data-testid="start"]').click()
          await page.waitForSelector('[data-testid="unit-map"]')
          expect(await page.locator('[data-testid="audio-settings"]').count()).toBe(1)
          await page.locator('[data-testid^="unit-u"]:enabled').first().click()
          await page.waitForSelector('[data-testid="item-body"]', { timeout: 10_000 })
          expect(await page.locator('[data-testid="audio-settings"]').count()).toBe(1)
          await page.goto(url)
          await page.waitForSelector('[data-testid="course-title"]')
        }

        if (shell === 'roleplay') {
          // a role-play clip ducks the music (0.3) while it plays
          await page.locator('[data-testid="start"]').click()
          await page.locator('[data-testid^="scene-"][data-locked="false"]').first().click()
          await page.locator('[data-testid="scene-next"]').click()
          await volumeNear(0.6 * gain(50)) // the music of the scene: the track of its unit
          await page.locator('[data-testid^="line-play-"]').first().click()
          await volumeNear(0.6 * gain(50) * 0.3)
          // EGS-64: the clip stops when the talk goes on to the learner's turn (it did not before) and the music is loud again
          while (!(await page.locator('[data-testid="scene-reply"]').count())) await page.locator('[data-testid="scene-next"]').click()
          await page.locator('[data-testid="scene-reply"]').click()
          await page.waitForSelector('[data-testid="item-body"]')
          expect(await page.evaluate(() => (globalThis as unknown as { __audio: Rec[] }).__audio.filter((a) => !a.loop).every((a) => a.paused))).toBe(true)
          await volumeNear(0.6 * gain(50))
          await page.goto(url)
          await page.waitForSelector('[data-testid="course-title"]')
        }

        // the title toggles stop the music (the settings are shared with the panel)
        await page.keyboard.press('Shift')
        await playing()
        expect(await page.locator('[data-testid="setting-sound"]').count()).toBe(1)
        expect(await page.locator('[data-testid="setting-reduce-audio"]').count()).toBe(1)
        await page.locator('[data-testid="setting-reduce-audio"]').check()
        await page.waitForFunction(() => (globalThis as unknown as { __audio: Rec[] }).__audio.filter((a) => a.loop).every((a) => a.paused), null, { timeout: 5000 })
        await page.locator('[data-testid="setting-reduce-audio"]').uncheck()
        await page.waitForFunction(() => (globalThis as unknown as { __audio: Rec[] }).__audio.some((a) => a.loop && !a.paused), null, { timeout: 5000 })
        await page.locator('[data-testid="setting-sound"]').uncheck()
        await page.waitForFunction(() => (globalThis as unknown as { __audio: Rec[] }).__audio.filter((a) => a.loop).every((a) => a.paused), null, { timeout: 5000 })
        expect(errors).toEqual([])
      } finally {
        await browser.close()
      }
    })
  }
})
