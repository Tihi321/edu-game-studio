/// <reference lib="dom" />
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { PLAYER_OUT } from './bot-helpers'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'
import { FIXTURES } from './edu-fixtures'

/**
 * The player on a phone (EGS-19), in a real browser: 390x844 with touch, as the Capacitor WebView shows it. The safe-area CSS is in the
 * player, the touch targets are at least 44 px, nothing scrolls sideways, and a fake `window.Capacitor.Plugins.App` back button goes one
 * screen back inside a shell (and exits the app when there is no screen to go back to). Without Chromium the run fails.
 */

useTemp()

async function build(fixture = 'solar-system'): Promise<string> {
  const { root } = await copyFixture(fixture)
  // the speaker button is drawn only for a game with sound: a fixture without an audio asset borrows the beeps of solar-system
  const file = path.join(root, 'course', 'pack.json')
  const pack = JSON.parse(await readFile(file, 'utf8')) as { assets: { id: string; kind: string; file: string; alt: string }[] }
  if (!pack.assets.some((a) => a.kind === 'audio')) {
    await copyFile(path.join(FIXTURES, 'solar-system', 'course', 'assets', 'eight-beeps.wav'), path.join(root, 'course', 'assets', 'eight-beeps.wav'))
    pack.assets.push({ id: 'aud-beeps', kind: 'audio', file: 'assets/eight-beeps.wav', alt: pack.assets[0]!.alt })
    await writeFile(file, JSON.stringify(pack, null, 2))
  }
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

describe('the player on a phone', () => {
  it('has the safe-area CSS and the Android back button', { timeout: 120_000 }, async () => {
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

      // the title screen
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('button')!).touchAction)).toBe('manipulation')
      expect(await page.evaluate(() => (window as unknown as Back).__back.listeners.length), 'the back button listener is registered').toBe(1)

      // an item screen: start, then the first open unit
      await page.locator('[data-testid="start"]').tap()
      await page.waitForSelector('[data-testid="unit-map"]')
      await page.locator('[data-testid^="unit-u"]:enabled').first().tap()
      await page.waitForSelector('[data-testid="item-body"]', { timeout: 10_000 })

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

  // Every shell on a 360x740 phone with touch (HUB-28): the title screen and the first world screen do not scroll sideways, no button is
  // under 44 px high, and the speaker button (`audio-settings`, fixed top-right) is shown and covers no other button.
  const SHELLS = [
    { shell: 'quiz-arena', fixture: 'solar-system', world: 'unit-map' },
    { shell: 'encyclopedia', fixture: 'solar-system', world: 'explore-title' },
    { shell: 'mindmaze', fixture: 'solar-system', world: 'castle-map' },
    { shell: 'rpg', fixture: 'solar-system', world: 'areas-title' },
    { shell: 'roleplay', fixture: 'hr-a1-greetings', world: 'scenes-title' },
    { shell: 'detective', fixture: 'european-capitals', world: 'office-title' }
  ] as const
  for (const c of SHELLS)
    it(`${c.shell}: no sideways scroll, 44 px buttons and a free speaker button at 360x740`, { timeout: 120_000 }, async () => {
      const dir = await build(c.fixture)
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const context = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
        const page = await context.newPage()
        const errors: string[] = []
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
        page.on('pageerror', (e) => errors.push(String(e)))
        await page.goto(pathToFileURL(path.join(dir, 'index.html')).href + `?seed=1&shell=${c.shell}`)
        await page.waitForSelector('[data-testid="course-title"]')

        const problems = (): Promise<string[]> =>
          page.evaluate(() => {
            const out: string[] = []
            if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`sideways scroll ${document.documentElement.scrollWidth} > ${window.innerWidth}`)
            const shown = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]')).filter((el) => {
              const r = el.getBoundingClientRect()
              return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
            })
            const name = (el: HTMLElement): string => el.getAttribute('data-testid') ?? el.tagName
            for (const el of shown) {
              const r = el.getBoundingClientRect()
              if (r.height < 43.5) out.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)} under 44 px high`)
            }
            const speaker = document.querySelector<HTMLElement>('[data-testid="audio-settings"]')
            const sr = speaker?.getBoundingClientRect()
            if (!speaker || !sr || sr.width === 0) out.push('no visible audio-settings button')
            else
              for (const el of shown) {
                if (el === speaker) continue
                const r = el.getBoundingClientRect()
                if (r.left < sr.right && r.right > sr.left && r.top < sr.bottom && r.bottom > sr.top) out.push(`${name(el)} overlaps the speaker button`)
              }
            return out
          })

        expect(await problems(), 'title screen').toEqual([])
        await page.locator('[data-testid="start"]').tap()
        if (c.shell === 'rpg') {
          await page.waitForSelector('[data-testid="story-skip"], [data-testid="areas-title"]')
          if (await page.locator('[data-testid="story-skip"]').count()) await page.locator('[data-testid="story-skip"]').tap()
        }
        await page.waitForSelector(`[data-testid="${c.world}"]`, { timeout: 10_000 })
        expect(await problems(), 'first world screen').toEqual([])
        expect(errors).toEqual([])
      } finally {
        await browser.close()
      }
    })
})
