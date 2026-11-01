import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Locator, Page } from 'playwright'
import { startLiveServer, type LiveHandle } from '../src/engine/live/server'
import { selectQuestions, type LiveQuestion } from '../src/shared/live'
import { LIVE_OUT, loadFixture } from './live-helpers'

/**
 * The live quiz in a real browser (EGS-21): a host page and three player pages (separate browser contexts, one at 390x844 with touch)
 * play a 3-question quiz of the solar-system fixture against the real server and the real built client (`out/live`, built by the vitest
 * global setup). Checks the leaderboard order after each question, the podium, the explanation in the reveal, 0 console errors and axe
 * (no serious or critical violation) on the question and the leaderboard screens. Without Chromium the run fails (`yarn playwright install chromium`).
 */

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

let handle: LiveHandle | undefined
let browser: Browser | undefined
afterAll(async () => {
  await browser?.close()
  await handle?.close()
})

async function axeViolations(page: Page): Promise<{ id: string; impact: string | null | undefined; nodes: number }[]> {
  // evaluate() is not blocked by the page's CSP; the page itself keeps its strict one
  await page.evaluate(axeSource)
  const res = (await page.evaluate("axe.run(document, { resultTypes: ['violations'] })")) as { violations: { id: string; impact: string | null; nodes: unknown[] }[] }
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))
}

/** The nicknames of a list of rows (the screen-reader-only " (you)" is dropped). */
async function nicks(list: Locator): Promise<string[]> {
  return (await list.locator('li .nick').allTextContents()).map((t) => t.replace(/ \(you\)$/, ''))
}

/** What a player does to answer `q` right (`true`) or wrong (`false`). */
async function answer(page: Page, q: LiveQuestion, right: boolean): Promise<void> {
  if (q.kind === 'typed') {
    await page.getByTestId('live-answer-input').fill(right ? q.correctText : 'zzz qqq')
    await page.getByTestId('live-submit').click()
  } else if (q.kind === 'multi-select') {
    const ids = right ? q.correctIds : [q.options.find((o) => !q.correctIds.includes(o.id))!.id]
    for (const id of ids) await page.getByTestId(`live-option-${id}`).click()
    await page.getByTestId('live-submit').click()
  } else {
    const id = right ? q.correctIds[0]! : q.options.find((o) => !q.correctIds.includes(o.id))!.id
    await page.getByTestId(`live-option-${id}`).click()
  }
  // locked, or (for the last player to answer) the reveal that follows at once
  await page.locator('[data-testid=live-locked]:not([hidden]), [data-testid=live-verdict]').first().waitFor({ state: 'visible', timeout: 10_000 })
}

describe('the live quiz in a browser', () => {
  it('plays three questions with a host page and three players, with the right leaderboard and podium', { timeout: 120_000 }, async () => {
    const { pack, catalogs } = await loadFixture('solar-system')
    const questions = selectQuestions(pack, catalogs, 'en', { count: 3, seed: 11 })
    expect(questions).toHaveLength(3)
    handle = await startLiveServer({ questions, secondsPerQuestion: 30, lang: 'en', title: pack.subject, client: { js: `${LIVE_OUT}/live.js`, css: `${LIVE_OUT}/live.css` } })
    const h = handle
    const { chromium, devices } = await import('playwright')
    browser = await chromium.launch()
    const errors: string[] = []
    const watch = (page: Page, who: string): void => {
      page.on('console', (m) => m.type() === 'error' && errors.push(`${who}: ${m.text()}`))
      page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`))
      page.on('requestfailed', (r) => errors.push(`${who}: request failed ${r.url()}`))
    }
    const ctx = async (opts: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> => (browser as Browser).newContext(opts)

    const hostPage = await (await ctx({ viewport: { width: 1100, height: 800 } })).newPage()
    watch(hostPage, 'host')
    await hostPage.goto(h.hostUrl)
    await expect.poll(() => hostPage.getByTestId('host-code').textContent(), { timeout: 10_000, interval: 50 }).toBe(h.code)
    await expect.poll(() => hostPage.getByTestId('host-start').isDisabled(), { timeout: 10_000, interval: 50 }).toBe(true)

    const phone = devices['Pixel 7'] ? { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, hasTouch: true } : { viewport: { width: 390, height: 844 }, hasTouch: true }
    const pages: Record<'ana' | 'bo' | 'cy', Page> = {
      ana: await (await ctx(phone)).newPage(),
      bo: await (await ctx({ viewport: { width: 1000, height: 700 } })).newPage(),
      cy: await (await ctx({ viewport: { width: 1000, height: 700 } })).newPage()
    }
    const names = { ana: 'Ana', bo: 'Bo <b>x</b>', cy: 'Cy' }
    for (const k of ['ana', 'bo', 'cy'] as const) {
      const p = pages[k]
      watch(p, k)
      await p.goto(h.playerUrls[0]!)
      await p.getByTestId('live-code').fill(h.code)
      await p.getByTestId('live-name').fill(names[k])
      if (k === 'ana') {
        // a wrong code is refused with a message first
        await p.getByTestId('live-code').fill('1')
        await p.getByTestId('live-join').click()
        await expect.poll(() => p.getByTestId('live-error').textContent(), { timeout: 10_000, interval: 50 }).not.toBe('')
        await p.getByTestId('live-code').fill(h.code)
      }
      await p.getByTestId('live-join').click()
      await expect.poll(() => p.getByTestId('live-you').textContent(), { timeout: 10_000, interval: 50 }).toContain(names[k])
    }
    await expect.poll(() => hostPage.getByTestId('host-players').locator('li').count(), { timeout: 10_000, interval: 50 }).toBe(3)
    // nicknames are text: the markup did not become an element
    expect(await pages.bo.locator('b').count()).toBe(0)
    await hostPage.getByTestId('host-start').click()

    const order = ['Ana', 'Bo <b>x</b>', 'Cy']
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!
      for (const p of Object.values(pages)) await expect.poll(() => p.getByTestId('live-prompt').textContent(), { timeout: 10_000, interval: 50 }).toBe(q.prompt)
      // no key on the page while the question is open
      if (q.explanation) expect(await pages.ana.content()).not.toContain(q.explanation)
      await expect.poll(() => hostPage.getByTestId('host-prompt').textContent(), { timeout: 10_000, interval: 50 }).toBe(q.prompt)
      if (i === 0) expect(await axeViolations(pages.ana)).toEqual([])
      await answer(pages.ana, q, true)
      await pages.bo.waitForTimeout(250)
      await answer(pages.bo, q, true)
      await expect.poll(() => hostPage.getByTestId('host-answered').textContent(), { timeout: 10_000, interval: 50 }).toBe('2 of 3 answered')
      await pages.cy.waitForTimeout(250)
      await answer(pages.cy, q, false)
      // everybody answered: the reveal comes by itself
      for (const p of Object.values(pages)) await p.getByTestId('live-verdict').waitFor({ state: 'visible', timeout: 10_000 })
      await expect.poll(() => pages.ana.getByTestId('live-verdict').getAttribute('data-correct'), { timeout: 10_000, interval: 50 }).toBe('true')
      await expect.poll(() => pages.cy.getByTestId('live-verdict').getAttribute('data-correct'), { timeout: 10_000, interval: 50 }).toBe('false')
      if (q.explanation) await expect.poll(() => pages.cy.getByTestId('live-explanation').textContent(), { timeout: 10_000, interval: 50 }).toBe(q.explanation)
      await expect.poll(() => pages.ana.getByTestId('live-points').textContent(), { timeout: 10_000, interval: 50 }).toContain('+')
      await hostPage.getByTestId('host-next').click()
      for (const p of Object.values(pages)) await p.getByTestId('live-leaderboard').waitFor({ state: 'visible', timeout: 10_000 })
      expect(await nicks(pages.cy.getByTestId('live-leaderboard'))).toEqual(order)
      await expect.poll(() => pages.cy.getByTestId('live-rank').textContent(), { timeout: 10_000, interval: 50 }).toContain('3')
      await expect.poll(() => pages.ana.getByTestId('live-rank').textContent(), { timeout: 10_000, interval: 50 }).toContain('1')
      if (i === 0) expect(await axeViolations(pages.ana)).toEqual([])
      await hostPage.getByTestId('host-next').click()
    }

    for (const p of Object.values(pages)) await p.getByTestId('live-podium').waitFor({ state: 'visible', timeout: 10_000 })
    expect(await nicks(pages.ana.getByTestId('live-podium'))).toEqual(order)
    await expect.poll(() => pages.bo.getByTestId('live-rank').textContent(), { timeout: 10_000, interval: 50 }).toContain('2')
    const beforeClose = errors.slice() // closing the room ends the event streams: a browser under load reports those as failed requests, which is not an error of the game
    await hostPage.getByTestId('host-close').click()
    for (const p of Object.values(pages)) await p.getByTestId('live-closed').waitFor({ state: 'visible', timeout: 10_000 })
    // the one console line allowed is the browser's note about the wrong code Ana typed on purpose (a 403)
    expect(beforeClose.filter((e) => !e.startsWith('ana: Failed to load resource') || !e.includes('403'))).toEqual([])
    expect(beforeClose.filter((e) => e.includes('403'))).toHaveLength(1)
  })
})
