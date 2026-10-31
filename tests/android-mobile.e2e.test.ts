/// <reference lib="dom" />
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { chromiumUnavailable, PLAYER_OUT } from './bot-helpers'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'

/**
 * The player on a phone (EGS-19), in a real browser: 390x844 with touch, as the Capacitor WebView shows it. The safe-area CSS is in the
 * player, the touch targets are at least 44 px, nothing scrolls sideways, and a fake `window.Capacitor.Plugins.App` back button goes one
 * screen back inside a shell (and exits the app when there is no screen to go back to). Skipped, with a message, only when Chromium cannot
 * be launched.
 */

useTemp()

const unavailable = await chromiumUnavailable()
if (unavailable) console.warn(`[android-mobile.e2e] SKIPPED: Chromium cannot be launched (${unavailable}). Run "yarn playwright install chromium".`)

async function build(): Promise<string> {
  const { root } = await copyFixture('solar-system')
  const out = await tmp('edu-mobile-')
  const res = await buildCourse(root, out, { playerDir: PLAYER_OUT })
  expect(res.ok).toBe(true)
  return out
}

const FAKE_CAPACITOR = `
  window.__back = { listeners: [], exited: 0 }
  window.Capacitor = { Plugins: { App: {
    addListener(event, cb) { if (event === 'backButton') window.__back.listeners.push(cb); return Promise.resolve({ remove() {} }) },
    exitApp() { window.__back.exited++ }
  } } }
`

interface Back {
  __back: { listeners: (() => void)[]; exited: number }
}

describe.skipIf(!!unavailable)('the player on a phone', () => {
  it('has the safe-area CSS, 44 px targets, no sideways scroll, and the Android back button', { timeout: 120_000 }, async () => {
    const dir = await build()
    const css = await readFile(path.join(dir, 'player.css'), 'utf8')
    expect(css).toMatch(/env\(safe-area-inset-top\)/)
    expect(css).toMatch(/env\(safe-area-inset-bottom\)/)
    expect(css).toMatch(/touch-action:\s*manipulation/)
    expect(await readFile(path.join(dir, 'index.html'), 'utf8')).toMatch(/viewport-fit=cover/)

    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
      const page = await context.newPage()
      const errors: string[] = []
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.addInitScript(FAKE_CAPACITOR)
      await page.goto(pathToFileURL(path.join(dir, 'index.html')).href + '?seed=1&shell=quiz-arena')
      await page.waitForSelector('[data-testid="course-title"]')

      const noSideScroll = (): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
      // buttons that are shown but under 44 px high
      const smallButtons = (): Promise<string[]> =>
        page.evaluate(() => {
          const out: string[] = []
          for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))) {
            const r = el.getBoundingClientRect()
            if (r.width === 0 || r.height === 0) continue
            if (r.height < 43.5) out.push(`${el.getAttribute('data-testid') ?? el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`)
          }
          return out
        })

      // the title screen
      expect(await noSideScroll()).toBe(true)
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('button')!).touchAction)).toBe('manipulation')
      expect(await smallButtons(), 'title screen buttons under 44 px').toEqual([])
      expect(await page.evaluate(() => (window as unknown as Back).__back.listeners.length), 'the back button listener is registered').toBe(1)

      // an item screen: start, then the first open unit
      await page.locator('[data-testid="start"]').tap()
      await page.waitForSelector('[data-testid="unit-map"]')
      expect(await noSideScroll()).toBe(true)
      await page.locator('[data-testid^="unit-u"]:enabled').first().tap()
      await page.waitForSelector('[data-testid="item-body"]', { timeout: 10_000 })
      expect(await noSideScroll()).toBe(true)
      expect(await smallButtons(), 'item screen buttons under 44 px').toEqual([])

      // the back button leaves the round through the shell's own control; the app does not exit
      expect(await page.locator('[data-testid="leave"]').count()).toBe(1)
      await page.evaluate(() => (window as unknown as Back).__back.listeners[0]!())
      await page.waitForSelector('[data-testid="unit-map"]', { timeout: 5000 })
      expect(await page.locator('[data-testid="item-body"]').count()).toBe(0)
      expect(await page.evaluate(() => (window as unknown as Back).__back.exited)).toBe(0)

      // the map has a way back to the title (`menu` is not in the list, so the button press exits only when nothing matches): remove every back control
      await page.evaluate(() => document.querySelectorAll('[data-testid="leave"],[data-testid="back"],[data-testid="to-map"],[data-testid="battle-flee"],[data-testid="to-office"]').forEach((e) => e.remove()))
      await page.evaluate(() => (window as unknown as Back).__back.listeners[0]!())
      expect(await page.evaluate(() => (window as unknown as Back).__back.exited)).toBe(1)
      expect(errors).toEqual([])
    } finally {
      await browser.close()
    }
  })

  it('does nothing without Capacitor (a normal browser)', { timeout: 60_000 }, async () => {
    const dir = await build()
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.goto(pathToFileURL(path.join(dir, 'index.html')).href + '?seed=1&shell=quiz-arena')
      await page.waitForSelector('[data-testid="course-title"]')
      expect(await page.evaluate(() => 'Capacitor' in window)).toBe(false)
      expect(errors).toEqual([])
    } finally {
      await browser.close()
    }
  })
})
