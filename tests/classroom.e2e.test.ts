import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildCourse } from '../src/engine/edu/build'
import { parseStudentResult, studentResultSchema } from '../src/shared/classroom'
import { PLAYER_OUT } from './bot-helpers'
import { copyFixture, tmp, useTemp } from './edu-build-helpers'

/**
 * Classroom mode in a real browser (EGS-20): the solar-system fixture is built with an assignment. The title of the quiz arena and of another
 * shell show the banner (title, target, due date, the teacher's message as plain text), the learner types a name, and "Send to my teacher"
 * downloads a result file that parses with the schema, has the name and the stars of the saved progress, and holds no more than the summary.
 * Without Chromium the run fails (`yarn playwright install chromium`).
 */

useTemp()

async function buildWithAssignment(): Promise<{ dir: string; packId: string; u1: string }> {
  const { root } = await copyFixture('solar-system')
  const file = path.join(root, 'course', 'pack.json')
  const pack = JSON.parse(await readFile(file, 'utf8')) as { id: string; units: { id: string }[]; extensions?: Record<string, unknown> }
  const u1 = pack.units[0]!.id
  pack.extensions = {
    ...(pack.extensions ?? {}),
    classroom: { assignment: { id: 'wk1', title: 'Week 1: the planets', units: [u1], targetStars: 2, due: '2026-12-01', message: 'Read <b>carefully</b>', createdAt: '2026-11-01T08:00:00.000Z' } }
  }
  await writeFile(file, JSON.stringify(pack, null, 2))
  const out = await tmp('edu-class-')
  const res = await buildCourse(root, out, { playerDir: PLAYER_OUT })
  expect(res.problems).toEqual([])
  expect(res.ok).toBe(true)
  return { dir: out, packId: pack.id, u1 }
}

describe('classroom mode in the built player', () => {
  let built: Promise<{ dir: string; packId: string; u1: string }> | undefined
  const game = () => (built ??= buildWithAssignment())

  for (const shell of ['quiz-arena', 'encyclopedia'] as const) {
    it(`${shell}: the banner, a name, and Send to my teacher saves a result file`, { timeout: 120_000 }, async () => {
      const { dir, packId, u1 } = await game()
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const context = await browser.newContext({ acceptDownloads: true })
        const page = await context.newPage()
        const errors: string[] = []
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
        page.on('pageerror', (e) => errors.push(String(e)))
        // a learner who has already earned 3 stars in the first unit and missed a question
        const progress = { version: 1, pack: packId, units: { [u1]: { stars: 3, best: 1, rounds: 1 } }, boss: { stars: 0, best: 0, rounds: 0 }, cards: {}, queue: [], score: 40, bestCombo: 2, answered: 10, right: 9, settings: { timer: false, sound: true }, updatedAt: 1, shells: {} }
        await page.addInitScript(([key, value]) => {
          // only the first load: a reload must see what the player saved
          const ls = (globalThis as unknown as { localStorage: Storage }).localStorage
          if (ls.getItem(key as string) === null) ls.setItem(key as string, value as string)
        }, [`edu-studio:progress:${packId}`, JSON.stringify(progress)])
        await page.goto(pathToFileURL(path.join(dir, 'index.html')).href + `?seed=1&shell=${shell}`)
        await page.waitForSelector('[data-testid="course-title"]')

        const banner = page.getByTestId('assignment-banner')
        await banner.waitFor()
        expect(await banner.textContent()).toContain('Week 1: the planets')
        expect(await page.getByTestId('assignment-target').textContent()).toContain('2')
        expect(await page.getByTestId('assignment-due').textContent()).toContain('2026')
        // the message is plain text: markup is shown as typed, never parsed
        expect(await page.getByTestId('assignment-message').textContent()).toBe('Read <b>carefully</b>')
        expect(await page.locator('[data-testid="assignment-message"] b').count()).toBe(0)

        // no name yet: the button says so and downloads nothing
        await page.getByTestId('send-teacher').click()
        expect(await page.getByTestId('title-message').textContent()).toContain('name')

        await page.getByTestId('student-name').fill('Test Pupil')
        const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('send-teacher').click()])
        expect(download.suggestedFilename()).toMatch(/-Test-Pupil-result\.json$/)
        const file = path.join(await tmp('edu-dl-'), 'result.json')
        await download.saveAs(file)
        const text = await readFile(file, 'utf8')
        const parsed = parseStudentResult(text)
        expect(parsed.ok).toBe(true)
        const result = studentResultSchema.parse(JSON.parse(text))
        expect(result.student.name).toBe('Test Pupil')
        expect(result.courseId).toBe(packId)
        expect(result.assignmentId).toBe('wk1')
        expect(result.units[u1]?.stars).toBe(3)
        expect(result).toMatchObject({ answered: 10, right: 9 })
        expect(text).not.toContain('"score"')
        expect(text).not.toContain('"cards"')
        // the name is kept for next time
        await page.reload()
        await page.waitForSelector('[data-testid="student-name"]')
        expect(await page.getByTestId('student-name').inputValue()).toBe('Test Pupil')
        expect(errors).toEqual([])
      } finally {
        await browser.close()
      }
    })
  }

  it('the quiz arena marks the assigned unit and counts the seconds of play', { timeout: 120_000 }, async () => {
    const { dir, packId, u1 } = await game()
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.goto(pathToFileURL(path.join(dir, 'index.html')).href + '?seed=1&shell=quiz-arena')
      await page.waitForSelector('[data-testid="start"]')
      await page.getByTestId('start').click()
      await page.getByTestId(`assigned-${u1}`).waitFor()
      expect(await page.getByTestId(`unit-${u1}`).getAttribute('data-assigned')).toBe('true')
      for (let i = 0; i < 7; i++) {
        await page.keyboard.press('Shift')
        await page.waitForTimeout(1000)
      }
      const seconds = await page.evaluate((key) => (JSON.parse((globalThis as unknown as { localStorage: Storage }).localStorage.getItem(key) ?? '{}') as { playSeconds?: number }).playSeconds ?? 0, `edu-studio:progress:${packId}`)
      expect(seconds).toBeGreaterThanOrEqual(5)
      expect(seconds).toBeLessThan(30)
    } finally {
      await browser.close()
    }
  })
})
