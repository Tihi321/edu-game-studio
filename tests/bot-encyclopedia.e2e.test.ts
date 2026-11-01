import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { buildFixtureGame, expectCleanAxe, expectPassed, PLAYER_OUT, play, type BotSummary } from './bot-helpers'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'

/**
 * The encyclopedia explorer played end to end by the autoplay bot (EGS-10, `scripts/bot/encyclopedia.mjs`), trimmed in EGS-45 to three runs:
 * the explorer on solar-system (authored hunts, timeline and map) and the reader of de-b2-reading, each a perfect run with axe (no serious or
 * critical violation, 0 console errors), and the quiz arena's passage panel. Without Chromium the run fails (`yarn playwright install chromium`).
 */

useTemp()

interface Case {
  title: string
  fixture: 'solar-system' | 'european-capitals'
  /** Drop the course's `encyclopedia` section: the book builds itself from the units, objectives, articles and items. */
  auto: boolean
  /** Hunts played in a perfect run: one per unit and the grand hunt. */
  hunts: number
  /** Questions of a perfect run: every step of every unit hunt once, then the six (or fewer) steps of the grand hunt. */
  steps: number
  /** Collectibles in the codex at the end. */
  collectibles: number
  /** Pins on the map. */
  places: number
}
const CASES: Case[] = [
  { title: 'solar-system (authored section)', fixture: 'solar-system', auto: false, hunts: 4, steps: 15, collectibles: 9, places: 9 }
]

describe('autoplay bot in the encyclopedia explorer', () => {
  for (const c of CASES) {
    describe(c.title, () => {
      let dirP: Promise<string> | undefined
      const built = (): Promise<string> =>
        (dirP ??= (async () => {
          const { root } = await copyFixture(c.fixture)
          if (c.auto) {
            const file = path.join(root, 'course', 'pack.json')
            const pack = JSON.parse(await readFile(file, 'utf8')) as { shells: { enabled: string[]; config: Record<string, unknown> } }
            delete pack.shells.config.encyclopedia
            await writeFile(file, JSON.stringify(pack, null, 2))
          }
          const out = await tmp('edu-bot-enc-')
          const res = await buildCourse(root, out, { playerDir: PLAYER_OUT })
          expect(res.problems).toEqual([])
          expect(res.ok).toBe(true)
          return out
        })())
      const run = async (...args: string[]) => play(await built(), [...args, '--shell', 'encyclopedia'])
      const enc = (s: BotSummary) => s.encyclopedia as { hunts: number; steps: number; search: number; searchEnter: number; index: number; crossLinks: number; related: number; articlesChecked: number; events: number; places: number; collectibles: number; locked: number; reducedMotion: boolean }

      it.concurrent('perfect + axe: every hunt to 3 stars in prerequisite order, the grand hunt, the end; the book is browsed on the way', { timeout: 180_000 }, async () => {
        const r = await run('--mode', 'perfect', '--seed', '1', '--axe')
        expectPassed(r)
        const s = r.summary
        expectCleanAxe(s, 15)
        expect(s.axe?.screens).toEqual(expect.arrayContaining(['explore', 'timeline', 'map', 'codex', 'hunts', 'explore-hunt', 'article-hunt', 'hunt-result', 'hunts-final', 'end']))
        expect(s.shell).toBe('encyclopedia')
        expect(s.finished).toBe(true)
        expect(s.wrong).toBe(0)
        expect(s.correct).toBe(s.steps)
        expect(s.steps).toBe(c.steps)
        expect(s.steps).toBeLessThanOrEqual(s.maxSteps)
        expect(s.screens).toEqual(expect.arrayContaining(['title', 'explore', 'article', 'timeline', 'map', 'codex', 'hunts', 'item', 'feedback', 'end']))
        const e = enc(s)
        expect(e.hunts).toBe(c.hunts)
        expect(e.steps).toBe(c.steps)
        expect(e.collectibles).toBe(c.collectibles)
        expect(e.reducedMotion).toBe(false)
        // the four ways to a page were all used (search, search + Enter, the index, a cross-link or "See also"), the page was checked, a locked chapter was read
        expect(e.search).toBeGreaterThan(0)
        expect(e.searchEnter).toBeGreaterThan(0)
        expect(e.index).toBeGreaterThan(0)
        expect(e.crossLinks + e.related).toBeGreaterThan(0)
        expect(e.articlesChecked).toBeGreaterThanOrEqual(5)
        expect(e.events).toBe(1)
        expect(e.locked).toBe(1)
      })

    })
  }
})

// ---- the reader and the passage panel (EGS-35): the `de-b2-reading` fixture ----

interface ReaderStats {
  chapters: number
  taps: number
  read: number
  deck: number
  toc: number
  arrows: number
  practice: number
  practiceAnswers: number
}
interface PassageStats {
  items: number
  opened: number
  taps: number
}

describe('autoplay bot in the reader of a reading course (de-b2-reading)', () => {
  let dirP: Promise<string> | undefined
  const built = (): Promise<string> => (dirP ??= buildFixtureGame('de-b2-reading'))
  const run = async (shell: string, ...args: string[]) => play(await built(), [...args, '--shell', shell])
  const reader = (s: BotSummary) => (s.encyclopedia as { reader: ReaderStats }).reader
  const passages = (s: BotSummary) => s.passages as PassageStats

  it.concurrent('perfect: the reader opens first; contents, tap-to-gloss, the deck switch, reading to the end, arrow keys and the practice with the text open', { timeout: 180_000 }, async () => {
    const r = await run('encyclopedia', '--mode', 'perfect', '--seed', '1', '--axe')
    expectPassed(r)
    const s = r.summary
    expectCleanAxe(s, 15)
    expect(s.axe?.screens).toEqual(expect.arrayContaining(['reader', 'reader-popover', 'reader-end', 'explore', 'article-hunt']))
    expect(s.finished).toBe(true)
    expect(s.wrong).toBe(0)
    expect(s.screens).toEqual(expect.arrayContaining(['title', 'reader', 'explore', 'article', 'item', 'feedback', 'hunts', 'end']))
    expect(reader(s)).toEqual({ chapters: 2, taps: 2, read: 2, deck: 1, toc: 1, arrows: 2, practice: 2, practiceAnswers: 10 })
    // the ten questions of the practice come with their text open; the hunts' questions have it closed and the bot opens it
    expect(passages(s).items).toBeGreaterThanOrEqual(10)
    expect(passages(s).opened).toBe(passages(s).items)
    expect(passages(s).taps).toBeGreaterThan(0)
  })

  it.concurrent('quiz arena: the questions on a text have a closed "Read the text" panel that opens, shows the text and glosses a word', { timeout: 180_000 }, async () => {
    const r = await run('quiz-arena', '--mode', 'perfect', '--seed', '3', '--axe')
    expectPassed(r)
    const s = r.summary
    expect(s.finished).toBe(true)
    expect(s.wrong).toBe(0)
    expect(passages(s).items).toBe(s.steps)
    expect(passages(s).opened).toBe(s.steps)
    expect(passages(s).taps).toBeGreaterThan(0)
    expectCleanAxe(s, 5)
  })
})
