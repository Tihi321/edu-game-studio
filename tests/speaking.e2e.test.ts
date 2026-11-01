import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Page } from 'playwright'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { PLAYER_OUT } from './bot-helpers'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'

/**
 * Speaking practice (EGS-18), in a real browser with a fake `SpeechRecognition`: the mic fills the input of a typed item; the learner can edit
 * the text; the shared matcher checks it tolerantly; the button is absent without a
 * recognizer; a denied permission shows a sentence and typing still works. EGS-45 kept two cases: record/replay and permission denied. Without Chromium the run fails (`yarn playwright install chromium`).
 */

useTemp()

type Pack = { items: { id: string; kind: string; objective: string }[]; objectives: { id: string; unit: string }[]; units: { id: string; requires: string[] }[] }

/** A build of hr-a1-greetings with only its typed items. */
async function build(kind: 'typed'): Promise<string> {
  const { root } = await copyFixture('hr-a1-greetings')
  const file = path.join(root, 'course', 'pack.json')
  const pack = JSON.parse(await readFile(file, 'utf8')) as Pack
  pack.items = pack.items.filter((i) => i.kind === kind)
  const objectives = new Set(pack.items.map((i) => i.objective))
  pack.objectives = pack.objectives.filter((o) => objectives.has(o.id))
  const units = new Set(pack.objectives.map((o) => o.unit))
  pack.units = pack.units.filter((u) => units.has(u.id)).map((u) => ({ ...u, requires: u.requires.filter((r) => units.has(r)) }))
  await writeFile(file, JSON.stringify(pack, null, 2))
  const out = await tmp('edu-speak-')
  const res = await buildCourse(root, out, { playerDir: PLAYER_OUT })
  expect(res.problems).toEqual([])
  expect(res.ok).toBe(true)
  return out
}

/** A fake Web Speech API: `start()` says `window.__said` after a moment, `stop()` ends the turn at once; `window.__rec` records what happened. */
const FAKE = `
  window.__said = 'dobar dan'
  window.__rec = { starts: 0, stops: 0, lang: '' }
  window.SpeechRecognition = class {
    start() {
      window.__rec.starts++
      window.__rec.lang = this.lang
      this.t = setTimeout(() => this.finish(), window.__delay ?? 150)
    }
    stop() { window.__rec.stops++; clearTimeout(this.t); this.finish() }
    finish() {
      if (this.done) return
      this.done = true
      if (window.__said) this.onresult && this.onresult({ results: [[{ transcript: window.__said }]] })
      this.onend && this.onend()
    }
  }
`
const NO_RECOGNIZER = `delete window.SpeechRecognition; delete window.webkitSpeechRecognition`

async function open(dir: string, init: string | null, opts: { delay?: number } = {}): Promise<{ page: Page; close: () => Promise<void>; errors: string[] }> {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(`${NO_RECOGNIZER};${opts.delay !== undefined ? `window.__delay = ${opts.delay};` : ''}${init ?? ''}`)
  await page.goto(`${pathToFileURL(path.join(dir, 'index.html')).href}?seed=1`)
  await page.waitForSelector('[data-testid="course-title"]')
  return { page, close: () => browser.close(), errors }
}

async function toFirstItem(page: Page): Promise<void> {
  await page.click('[data-testid="start"]')
  await page.locator('[data-testid="unit-map"] button').first().click()
  await page.waitForSelector('[data-testid="speak"], [data-testid="answer-input"], [data-testid^="gap-"]')
}

// page code is written as strings: this tsconfig has no DOM types
const INPUT_FILLED = `document.querySelector('[data-testid="answer-input"]').value !== ''`
const say = (page: Page, text: string): Promise<unknown> => page.evaluate(`window.__said = ${JSON.stringify(text)}`)
const lastResult = (page: Page): Promise<{ correct: boolean; typo?: boolean } | undefined> => page.evaluate('EduEngine.getState().lastResult')

describe('speak your answer', () => {
  const dirs: Partial<Record<string, Promise<string>>> = {}
  const built = (k: Parameters<typeof build>[0]): Promise<string> => (dirs[k] ??= build(k))

  it('typed: the mic fills the input in the target language, the text can be edited, a typo is accepted', { timeout: 120_000 }, async () => {
    const { page, close, errors } = await open(await built('typed'), FAKE)
    try {
      await toFirstItem(page)
      const mic = page.getByTestId('speak')
      await expect(mic.getAttribute('aria-pressed')).resolves.toBe('false')
      await say(page, 'Dobar dam') // one letter off: the shared matcher is tolerant
      await mic.click()
      await expect(mic.getAttribute('aria-pressed')).resolves.toBe('true')
      expect(await page.getByTestId('speak-status').textContent()).toMatch(/Listening/)
      await page.waitForFunction(INPUT_FILLED)
      expect(await page.inputValue('[data-testid="answer-input"]')).toBe('Dobar dam')
      expect(await page.evaluate('window.__rec.lang')).toBe('hr')
      await expect(mic.getAttribute('aria-pressed')).resolves.toBe('false')
      await expect(page.getByTestId('submit').isEnabled()).resolves.toBe(true)
      expect(await page.getByTestId('speak-status').textContent()).toMatch(/Heard: Dobar dam/)
      // the learner edits it
      await page.fill('[data-testid="answer-input"]', 'Dobar dam!')
      await page.fill('[data-testid="answer-input"]', 'Dobar dan')
      await page.getByTestId('submit').click()
      await page.waitForSelector('[data-testid="feedback"]')
      expect((await lastResult(page))?.correct).toBe(true)
      expect(errors).toEqual([])
    } finally {
      await close()
    }
  })

  it('shows an error sentence when the browser recognizer fails, and typing still works', { timeout: 120_000 }, async () => {
    const failing = `${FAKE}; window.SpeechRecognition = class { start() { setTimeout(() => this.onerror && this.onerror({ error: 'not-allowed' }), 20) } stop() {} }`
    const { page, close } = await open(await built('typed'), failing)
    try {
      await toFirstItem(page)
      await page.getByTestId('speak').click()
      await page.waitForFunction("/not allowed/i.test(document.querySelector('[data-testid=\"speak-status\"]')?.textContent ?? '')")
      await page.fill('[data-testid="answer-input"]', 'Dobar dan')
      await page.getByTestId('submit').click()
      await page.waitForSelector('[data-testid="feedback"]')
      expect((await lastResult(page))?.correct).toBe(true)
    } finally {
      await close()
    }
  })

})
