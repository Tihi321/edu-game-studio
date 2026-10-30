import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { useTemp } from './edu-build-helpers'
import { buildFixtureGame, chromiumUnavailable } from './bot-helpers'

/**
 * The game-style picker (EGS-10): one course, several shells. The title of every shell shows `shell-picker` when the course plays in
 * two or more; picking one unmounts the shell and mounts the other (keyboard, no reload), the choice is remembered per course, and
 * `?shell=<id>` opens a shell directly. Skipped, with a message, when Chromium cannot be launched.
 */

useTemp()
const unavailable = await chromiumUnavailable()
if (unavailable) console.warn(`[shell-picker.e2e] SKIPPED: Chromium cannot be launched (${unavailable}).`)

describe.skipIf(!!unavailable)('the game-style picker', () => {
  it('switches shells from the title, remembers the choice and honours ?shell=', { timeout: 120_000 }, async () => {
    const dir = await buildFixtureGame('solar-system')
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      const errors: string[] = []
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
      page.on('pageerror', (e) => errors.push(e.message))
      const url = pathToFileURL(path.join(dir, 'index.html')).href
      const state = () => page.evaluate(() => window.EduEngine.getState())
      await page.goto(`${url}?seed=1`)
      await page.waitForSelector('[data-testid="course-title"]')
      const playable = await page.evaluate(() => window.EduEngine.playableShells())
      expect(playable.length).toBeGreaterThanOrEqual(2)
      expect((await state()).shell).toBe(playable[0])
      expect(await page.locator(`[data-testid="shell-${playable[0]}"]`).getAttribute('aria-pressed')).toBe('true')

      // with the keyboard: focus the other style and press Enter
      const other = playable[1] as string
      await page.locator(`[data-testid="shell-${other}"]`).focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction((id) => window.EduEngine.getState().shell === id && window.EduEngine.getState().screen === 'title', other)
      expect(await page.locator('[data-testid="app"]').getAttribute('data-shell')).toBe(other)
      expect(await page.locator(`[data-testid="shell-${other}"]`).getAttribute('aria-pressed')).toBe('true')
      expect(await page.locator('h1').count()).toBe(1)

      // remembered after a reload without ?shell=
      await page.goto(`${url}?seed=1`)
      await page.waitForSelector('[data-testid="course-title"]')
      expect((await state()).shell).toBe(other)

      // ?shell= wins; an unknown or disabled shell falls back to a playable one
      await page.goto(`${url}?seed=1&shell=${playable[0]}`)
      await page.waitForSelector('[data-testid="course-title"]')
      expect((await state()).shell).toBe(playable[0])
      await page.goto(`${url}?seed=1&shell=pinball`)
      await page.waitForSelector('[data-testid="course-title"]')
      expect(playable).toContain((await state()).shell)
      expect(errors).toEqual([])
    } finally {
      await browser.close()
    }
  })
})
