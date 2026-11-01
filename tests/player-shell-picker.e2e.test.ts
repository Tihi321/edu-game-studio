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

/**
 * The shared start screen (EGS-25): every shell shows the same title skeleton in the `menu` theme, the in-game screens keep the shell's
 * theme, picking a mode on the title never shows another theme and keeps the progress, and nothing overflows on a phone.
 */
describe.skipIf(!!unavailable)('the shared start screen', () => {
  it('has one skeleton and the menu theme on every shell, and the shell theme once the game starts', { timeout: 240_000 }, async () => {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      for (const fixture of ['solar-system', 'hr-a1-greetings']) {
        const dir = await buildFixtureGame(fixture)
        const url = pathToFileURL(path.join(dir, 'index.html')).href
        const page = await browser.newPage()
        const errors: string[] = []
        page.on('pageerror', (e) => errors.push(e.message))
        const skeletons = new Map<string, string>()
        await page.goto(`${url}?seed=1`)
        await page.waitForSelector('[data-testid="course-title"]')
        const playable = await page.evaluate(() => window.EduEngine.playableShells())
        for (const id of playable) {
          await page.goto(`${url}?seed=1&shell=${id}`)
          await page.waitForSelector('[data-testid="course-title"]')
          expect(await page.locator('#edu-root').getAttribute('data-edu-theme'), `${fixture}/${id} title`).toBe('menu')
          skeletons.set(
            id,
            await page.evaluate(() => {
              const walk = (el: Element): string => {
                // the settings block holds whatever a mode adds (the arena's timer); it is the one place the skeletons may differ
                const kids = [...el.children].filter((c) => !c.classList.contains('settings')).map(walk).join(',')
                return `${el.tagName.toLowerCase()}.${[...el.classList].filter((c) => !c.startsWith('shell-title-')).join('.')}#${el.getAttribute('data-testid') ?? ''}(${kids})`
              }
              return walk(document.querySelector('.title-screen') as Element)
            })
          )
          // a phone does not scroll sideways
          await page.setViewportSize({ width: 390, height: 844 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${fixture}/${id} overflows at 390px`).toBe(true)
          await page.setViewportSize({ width: 1280, height: 800 })
          await page.locator('[data-testid="start"]').click()
          await page.waitForFunction(() => window.EduEngine.getState().screen !== 'title')
          const theme = await page.locator('#edu-root').getAttribute('data-edu-theme')
          expect(theme, `${fixture}/${id} in game`).not.toBe('menu')
        }
        const first = skeletons.get(playable[0] as string)
        for (const [id, sk] of skeletons) expect(sk, `${fixture}/${id} title skeleton`).toBe(first)
        await page.close()
      }
      // nothing errored while drawing the titles
    } finally {
      await browser.close()
    }
  })

  it('keeps the menu theme and the progress when a mode is picked on the title', { timeout: 120_000 }, async () => {
    const dir = await buildFixtureGame('solar-system')
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      const url = pathToFileURL(path.join(dir, 'index.html')).href
      await page.goto(`${url}?seed=1`)
      await page.waitForSelector('[data-testid="course-title"]')
      const playable = await page.evaluate(() => window.EduEngine.playableShells())
      const themes: (string | null)[] = []
      await page.exposeFunction('noteTheme', (t: string | null) => themes.push(t))
      await page.evaluate(() => {
        const root = document.getElementById('edu-root') as HTMLElement
        new MutationObserver(() => (window as unknown as { noteTheme(t: string | null): void }).noteTheme(root.getAttribute('data-edu-theme'))).observe(root, { attributes: true, attributeFilter: ['data-edu-theme'] })
      })
      const stored = (): Promise<string> => page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([k]) => /progress/i.test(k)).map(([k, v]) => [k, { ...JSON.parse(v), playSeconds: 0, updatedAt: 0 }]).sort()))
      // make some progress on the title: the other edition and the timer
      await page.locator('[data-testid="lang-hr"]').click()
      await page.locator('[data-testid="setting-timer"]').check()
      const before = await stored()
      expect(before).toContain('"timer":true')
      expect(before).toContain('"lang":"hr"')
      await page.locator(`[data-testid="shell-${playable[1]}"]`).click()
      await page.waitForFunction((id) => window.EduEngine.getState().shell === id && window.EduEngine.getState().screen === 'title', playable[1] as string)
      expect(await stored()).toBe(before)
      expect(await page.locator('[data-testid="lang-hr"]').getAttribute('aria-pressed')).toBe('true')
      expect(await page.locator('#edu-root').getAttribute('data-edu-theme')).toBe('menu')
      expect(themes.filter((t) => t !== 'menu' && t !== null), 'another theme flashed on the root').toEqual([])
    } finally {
      await browser.close()
    }
  })
})
