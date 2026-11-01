import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Page } from 'playwright'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { PLAYER_OUT } from './bot-helpers'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'

/**
 * Speaking practice (EGS-18), in a real browser with a fake `SpeechRecognition`: the mic fills the input of a typed item, a cloze gap and a
 * listening-in-type-mode item; the learner can edit the text; the shared matcher checks it tolerantly; the button is absent without a
 * recognizer, for a course without a target language and when the learner switches it off; the keyboard works (Enter/Space, Escape);
 * axe finds no serious or critical violation on the item screen with the mic. Without Chromium the run fails (`yarn playwright install chromium`).
 */

useTemp()

type Pack = { items: { id: string; kind: string; mode?: string; objective: string; gaps?: { bank?: unknown }[] }[]; objectives: { id: string; unit: string }[]; units: { id: string; requires: string[] }[]; targetLang?: string; extensions: Record<string, unknown> }

/** A build of hr-a1-greetings with only the items of one kind (cloze without word banks, so every gap is typed), or of solar-system (no target language). */
async function build(kind: 'typed' | 'cloze' | 'listening' | 'solar', extensions?: Record<string, unknown>): Promise<string> {
  const { root } = await copyFixture(kind === 'solar' ? 'solar-system' : 'hr-a1-greetings')
  const file = path.join(root, 'course', 'pack.json')
  const pack = JSON.parse(await readFile(file, 'utf8')) as Pack
  if (kind !== 'solar') {
    pack.items = pack.items.filter((i) => (kind === 'listening' ? i.kind === 'listening' && i.mode === 'type' : i.kind === kind))
    for (const i of pack.items) for (const g of i.gaps ?? []) delete g.bank
    const objectives = new Set(pack.items.map((i) => i.objective))
    pack.objectives = pack.objectives.filter((o) => objectives.has(o.id))
    const units = new Set(pack.objectives.map((o) => o.unit))
    pack.units = pack.units.filter((u) => units.has(u.id)).map((u) => ({ ...u, requires: u.requires.filter((r) => units.has(r)) }))
  }
  if (extensions) pack.extensions = { ...pack.extensions, ...extensions }
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
const PRESSED_TRUE = `document.querySelector('[data-testid="speak"]')?.getAttribute('aria-pressed') === 'true'`
const PRESSED_FALSE = `document.querySelector('[data-testid="speak"]')?.getAttribute('aria-pressed') === 'false'`
const INPUT_FILLED = `document.querySelector('[data-testid="answer-input"]').value !== ''`
const say = (page: Page, text: string): Promise<unknown> => page.evaluate(`window.__said = ${JSON.stringify(text)}`)
const lastResult = (page: Page): Promise<{ correct: boolean; typo?: boolean } | undefined> => page.evaluate('EduEngine.getState().lastResult')
const itemId = (page: Page): Promise<string> => page.evaluate('EduEngine.getState().itemId')

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

  it('typed: the spoken text is checked tolerantly without editing', { timeout: 120_000 }, async () => {
    const { page, close } = await open(await built('typed'), FAKE)
    try {
      await toFirstItem(page)
      expect(await itemId(page)).toMatch(/typed/)
      await say(page, 'dobar dam')
      await page.getByTestId('speak').click()
      await page.waitForFunction(INPUT_FILLED)
      await page.getByTestId('submit').click()
      await page.waitForSelector('[data-testid="feedback"]')
      const r = await lastResult(page)
      expect(r?.correct).toBe(true)
      expect(r?.typo).toBe(true)
    } finally {
      await close()
    }
  })

  it('keyboard: Enter starts, Escape stops, the transcript fills the input; no focus is lost', { timeout: 120_000 }, async () => {
    const { page, close } = await open(await built('typed'), FAKE, { delay: 60_000 })
    try {
      await toFirstItem(page)
      await page.getByTestId('speak').focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction(PRESSED_TRUE)
      await page.keyboard.press('Escape')
      await page.waitForFunction(PRESSED_FALSE)
      expect(await page.inputValue('[data-testid="answer-input"]')).toBe('dobar dan')
      expect(await page.evaluate('window.__rec')).toMatchObject({ starts: 1, stops: 1 })
      // a second press stops, too (Space on the button)
      await page.getByTestId('speak').focus()
      await page.keyboard.press('Space')
      await page.waitForFunction(PRESSED_TRUE)
      await page.keyboard.press('Space')
      await page.waitForFunction(PRESSED_FALSE)
      // Escape in the input also stops
      await page.getByTestId('speak').click()
      await page.waitForFunction(PRESSED_TRUE)
      await page.focus('[data-testid="answer-input"]')
      await page.keyboard.press('Escape')
      await page.waitForFunction(PRESSED_FALSE)
    } finally {
      await close()
    }
  })

  it('no recognizer: no mic button on the item and no toggle on the title', { timeout: 120_000 }, async () => {
    const { page, close } = await open(await built('typed'), null)
    try {
      expect(await page.getByTestId('setting-speak').count()).toBe(0)
      await toFirstItem(page)
      expect(await page.getByTestId('answer-input').count()).toBe(1)
      expect(await page.getByTestId('speak').count()).toBe(0)
    } finally {
      await close()
    }
  })

  it('a course without a target language has no mic even with a recognizer', { timeout: 120_000 }, async () => {
    const { page, close } = await open(await built('solar'), FAKE)
    try {
      expect(await page.getByTestId('setting-speak').count()).toBe(0)
      await page.click('[data-testid="start"]')
      await page.locator('[data-testid="unit-map"] button').first().click()
      await page.waitForSelector('[data-testid="item"], [data-testid="submit"], .choice, [data-testid^="option-"]', { timeout: 10_000 }).catch(() => undefined)
      expect(await page.getByTestId('speak').count()).toBe(0)
    } finally {
      await close()
    }
  })

  it('the learner can switch it off on the title; the choice is kept; the title says where the audio goes', { timeout: 120_000 }, async () => {
    const dir = await built('typed')
    const { page, close } = await open(dir, FAKE)
    try {
      expect(await page.getByTestId('speak-privacy').textContent()).toMatch(/browser vendor/)
      await page.getByTestId('setting-speak').uncheck()
      await toFirstItem(page)
      expect(await page.getByTestId('speak').count()).toBe(0)
    } finally {
      await close()
    }
  })

  it('cloze: the transcript fills the gap in focus or the first empty gap', { timeout: 120_000 }, async () => {
    const { page, close } = await open(await built('cloze'), FAKE)
    try {
      await toFirstItem(page)
      await say(page, 'večer')
      await page.getByTestId('speak').click()
      await page.waitForFunction("Array.from(document.querySelectorAll('input.gap-input')).some((i) => i.value !== '')")
      expect(await page.locator('input.gap-input').first().inputValue()).toBe('večer')
      await expect(page.getByTestId('submit').isEnabled()).resolves.toBe(true)
    } finally {
      await close()
    }
  })

  it('listening in type mode has the mic too', { timeout: 120_000 }, async () => {
    const { page, close } = await open(await built('listening'), FAKE)
    try {
      await toFirstItem(page)
      await say(page, 'zovem se ana')
      await page.getByTestId('speak').click()
      await page.waitForFunction(INPUT_FILLED)
      await page.getByTestId('submit').click()
      await page.waitForSelector('[data-testid="feedback"]')
      expect((await lastResult(page))?.correct).toBe(true)
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

  it('axe: no serious or critical violation on the item screen with the mic, idle and listening', { timeout: 120_000 }, async () => {
    const { page, close } = await open(await built('typed'), FAKE, { delay: 60_000 })
    try {
      await toFirstItem(page)
      await page.addScriptTag({ path: createRequire(import.meta.url).resolve('axe-core/axe.min.js') })
      const run = (): Promise<{ id: string; impact: string }[]> =>
        page.evaluate('axe.run().then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact })))')
      const bad = (v: { impact: string }[]): unknown[] => v.filter((x) => x.impact === 'serious' || x.impact === 'critical')
      expect(bad(await run())).toEqual([])
      await page.getByTestId('speak').click()
      await page.waitForFunction(PRESSED_TRUE)
      expect(bad(await run())).toEqual([])
      await page.keyboard.press('Escape')
    } finally {
      await close()
    }
  })
})
