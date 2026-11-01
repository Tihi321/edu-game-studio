import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { buildFixtureGame, chromiumUnavailable, expectCleanAxe, expectPassed, PLAYER_OUT, play, type BotSummary } from './bot-helpers'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'

/**
 * The encyclopedia explorer played end to end by the autoplay bot (EGS-10, `scripts/bot/encyclopedia.mjs`): for every fixture that enables
 * the shell (solar-system and european-capitals with their authored hunts, timeline and map) and for solar-system WITHOUT its section (the
 * automatic layout), perfect, wrong and random (seeded) pass with 0 console errors, one keyboard-only perfect run (no mouse click) and an
 * axe run (no serious or critical violation). Skipped, with a message, only when Chromium cannot be launched
 * (`yarn playwright install chromium`). The wrong and random mouse runs use prefers-reduced-motion (the driver sets it).
 */

useTemp()

const unavailable = await chromiumUnavailable()
if (unavailable) console.warn(`[bot-encyclopedia.e2e] SKIPPED: Chromium cannot be launched (${unavailable}). Run "yarn playwright install chromium".`)

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
  { title: 'solar-system (authored section)', fixture: 'solar-system', auto: false, hunts: 4, steps: 15, collectibles: 9, places: 9 },
  { title: 'european-capitals (authored section)', fixture: 'european-capitals', auto: false, hunts: 4, steps: 17, collectibles: 11, places: 12 },
  { title: 'solar-system (automatic layout, no section)', fixture: 'solar-system', auto: true, hunts: 4, steps: 10, collectibles: 5, places: 0 }
]

describe.skipIf(!!unavailable)('autoplay bot in the encyclopedia explorer', () => {
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

      it.concurrent('perfect: every hunt to 3 stars in prerequisite order, the grand hunt, the end; the book is browsed on the way', { timeout: 300_000 }, async () => {
        const r = await run('--mode', 'perfect', '--seed', '1')
        expectPassed(r)
        const s = r.summary
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

      it.concurrent('keyboard only: Tab, Enter and the arrow keys read, search, hunt and finish; no mouse click, axe is clean', { timeout: 300_000 }, async () => {
        const r = await run('--mode', 'perfect', '--seed', '1', '--keyboard', '--axe')
        expectPassed(r)
        const s = r.summary
        expect(s.finished).toBe(true)
        expect(s.wrong).toBe(0)
        expect(s.keyboard?.mouseClicks).toBe(0)
        expect(s.keyboard?.presses).toBeGreaterThan(100)
        expect(s.keyboard?.focusChecks).toBeGreaterThan(50)
        expect(s.keyboard?.ringChecks).toBeGreaterThan(50)
        expectCleanAxe(s, 15)
        expect(s.axe?.screens).toEqual(expect.arrayContaining(['explore', 'timeline', 'map', 'codex', 'hunts', 'explore-hunt', 'article-hunt', 'hunt-result', 'hunts-final', 'end']))
        expect(enc(s).places).toBe(c.places > 0 ? 1 : 0)
      })

      it.concurrent('axe: no serious or critical violation on a wrong answer, the retry clue, the locked chapters or on a phone', { timeout: 300_000 }, async () => {
        const wrong = await run('--mode', 'wrong', '--seed', '5', '--axe')
        expectPassed(wrong)
        expectCleanAxe(wrong.summary, 12)
        expect(wrong.summary.axe?.screens).toEqual(expect.arrayContaining(['explore', 'article-hunt', 'hunt-result', 'hunts-final']))
        expect(wrong.summary.axe?.screens.some((x) => x.startsWith('feedback-wrong-'))).toBe(true)
        const phone = await run('--mode', 'perfect', '--seed', '2', '--keyboard', '--axe', '--viewport', '390x844')
        expectPassed(phone)
        expectCleanAxe(phone.summary, 15)
        expect(phone.summary.viewport).toBe('390x844')
      })

      it.concurrent('wrong: the clue stays pinned, a missed clue comes back, the codex stays empty, nothing is won, no dead end', { timeout: 300_000 }, async () => {
        const r = await run('--mode', 'wrong', '--seed', '2', '--rounds', '2')
        expectPassed(r)
        const s = r.summary
        expect(s.finished).toBe(false)
        expect(s.correct).toBe(0)
        expect(s.wrong).toBe(s.steps)
        // the first chapter only is open: its hunt is played twice, every clue asked once and twice more as a retry
        expect(s.steps).toBeGreaterThanOrEqual(2 * 3)
        expect(enc(s).hunts).toBe(2)
        expect(enc(s).collectibles).toBe(0)
        expect(enc(s).reducedMotion).toBe(true)
        expect(s.screens).toEqual(expect.arrayContaining(['explore', 'article', 'item', 'feedback', 'hunts', 'codex']))
        expect(s.screens).not.toContain('end')
        expect(s.checks.answers).toBe(s.wrong)
        expect(s.checks.explanations).toBe(s.wrong)
      })

      it.concurrent('random: a seeded 75 % learner masters every hunt and wins the grand hunt within the step bound', { timeout: 300_000 }, async () => {
        const r = await run('--mode', 'random', '--seed', '7', '--accuracy', '0.75')
        expectPassed(r)
        const s = r.summary
        expect(s.finished).toBe(true)
        expect(s.steps).toBeLessThanOrEqual(s.maxSteps)
        expect(s.wrong).toBeGreaterThan(0)
        expect(s.correct).toBeGreaterThan(s.wrong)
        expect(enc(s).collectibles).toBeGreaterThan(0)
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

describe.skipIf(!!unavailable)('autoplay bot in the reader of a reading course (de-b2-reading)', () => {
  let dirP: Promise<string> | undefined
  const built = (): Promise<string> => (dirP ??= buildFixtureGame('de-b2-reading'))
  const run = async (shell: string, ...args: string[]) => play(await built(), [...args, '--shell', shell])
  const reader = (s: BotSummary) => (s.encyclopedia as { reader: ReaderStats }).reader
  const passages = (s: BotSummary) => s.passages as PassageStats

  it.concurrent('perfect: the reader opens first; contents, tap-to-gloss, the deck switch, reading to the end, arrow keys and the practice with the text open', { timeout: 300_000 }, async () => {
    const r = await run('encyclopedia', '--mode', 'perfect', '--seed', '1')
    expectPassed(r)
    const s = r.summary
    expect(s.finished).toBe(true)
    expect(s.wrong).toBe(0)
    expect(s.screens).toEqual(expect.arrayContaining(['title', 'reader', 'explore', 'article', 'item', 'feedback', 'hunts', 'end']))
    expect(reader(s)).toEqual({ chapters: 2, taps: 2, read: 2, deck: 1, toc: 1, arrows: 2, practice: 2, practiceAnswers: 10 })
    // the ten questions of the practice come with their text open; the hunts' questions have it closed and the bot opens it
    expect(passages(s).items).toBeGreaterThanOrEqual(10)
    expect(passages(s).opened).toBe(passages(s).items)
    expect(passages(s).taps).toBeGreaterThan(0)
  })

  it.concurrent('keyboard only: Tab, Enter, Space and the arrow keys read, gloss, switch the deck and practise; axe is clean on the reader and its popover', { timeout: 300_000 }, async () => {
    const r = await run('encyclopedia', '--mode', 'perfect', '--seed', '1', '--keyboard', '--axe')
    expectPassed(r)
    const s = r.summary
    expect(s.finished).toBe(true)
    expect(s.keyboard?.mouseClicks).toBe(0)
    expect(reader(s).read).toBe(2)
    expectCleanAxe(s, 15)
    expect(s.axe?.screens).toEqual(expect.arrayContaining(['reader', 'reader-popover', 'reader-end', 'explore', 'article-hunt']))
  })

  it.concurrent('phone: the reader fits 390 x 844 (no overflow), axe is clean', { timeout: 300_000 }, async () => {
    const r = await run('encyclopedia', '--mode', 'perfect', '--seed', '2', '--keyboard', '--axe', '--viewport', '390x844')
    expectPassed(r)
    expectCleanAxe(r.summary, 15)
    expect(r.summary.axe?.screens).toEqual(expect.arrayContaining(['reader', 'reader-popover']))
  })

  it.concurrent('wrong: a text is practised with every answer wrong; the text stays available and nothing is won', { timeout: 300_000 }, async () => {
    const r = await run('encyclopedia', '--mode', 'wrong', '--seed', '2', '--rounds', '1')
    expectPassed(r)
    expect(r.summary.finished).toBe(false)
    expect(r.summary.correct).toBe(0)
    expect(reader(r.summary).chapters).toBe(2)
    expect(reader(r.summary).practice).toBe(2)
    expect(passages(r.summary).opened).toBe(passages(r.summary).items)
  })

  it.concurrent('random: a seeded 75 % learner reads, practises and wins the hunts', { timeout: 300_000 }, async () => {
    const r = await run('encyclopedia', '--mode', 'random', '--seed', '7', '--accuracy', '0.75')
    expectPassed(r)
    expect(r.summary.finished).toBe(true)
    expect(reader(r.summary).read).toBe(2)
  })

  it.concurrent('quiz arena: the questions on a text have a closed "Read the text" panel that opens, shows the text and glosses a word', { timeout: 300_000 }, async () => {
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
