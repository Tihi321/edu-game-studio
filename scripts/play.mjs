#!/usr/bin/env node
/**
 * The autoplay bot: plays a BUILT game folder in headless Chromium over file:// and proves it is playable.
 *
 *   node scripts/play.mjs <build-dir> --mode perfect|wrong|random [--shell <id>] [--seed N] [--accuracy 0.75] [--shots <dir>]
 *                         [--viewport 1280x800] [--max-steps N] [--rounds N] [--keyboard] [--axe] [--no-media-check] [--json] [--verbose]
 *
 * It needs the folder alone (index.html, game-data.json, player.js ...) and `playwright` with Chromium; no TypeScript and no
 * source of this repository is imported. It drives the game ONLY through `data-testid`s and `window.EduEngine.getState()`, and asks
 * `window.EduEngine.debug.solve(itemId)` / `.wrong(itemId)` (the shared `solveItem` running in the page) for answers, so the
 * solving logic (crossword and word-search grids, accepted spellings) is never duplicated here. See docs/player.md.
 *
 *   perfect  every item right; every unit played in prerequisite order to 3 stars, then the boss, then the end screen;
 *            asserts that nothing was ever wrong and that the review queue stays empty.
 *   wrong    every item wrong; asserts the feedback panel (why of the chosen distractor, answer, explanation), that the review queue
 *            fills and that the review screen is offered; --rounds N (default 1) rounds per open unit plus the review screen (it
 *            cannot finish: the boss never opens).
 *   random   a seeded learner who is right with probability --accuracy (default 0.75); must reach the end screen within maxSteps.
 *
 * Game shells (EGS-10+): `--shell <id>` opens the game in that shell (`?shell=<id>`; default: the game's own, `game-data.json` `shell`).
 * This file opens the game and checks the title (and the shell picker when the course plays in two or more shells); the shell's
 * DRIVER (`scripts/bot/<shell>.mjs`, registry `scripts/bot/index.mjs`) plays the rest: it walks the shell's world through its test ids
 * and its `EduEngine.debug.shell` helpers, and answers every question with the shared `answerCurrent` (same item widgets, same
 * feedback checks in every shell). What perfect / wrong / random mean in a shell is in the driver's header. The modes above describe
 * the quiz arena's driver (`scripts/bot/quiz-arena.mjs`).
 *
 * Flags that apply to every mode:
 *   --keyboard  plays with the keyboard ONLY (page.keyboard: Tab / Shift+Tab to reach a control, Enter or Space to use it, arrows in the
 *               word search, digits for options and grades, typing for text): no element click, no mouse. A control that Tab cannot reach,
 *               a focus that is lost after a screen change (it must stay inside #edu-main), the feedback not taking the focus to "next",
 *               or a focused control with no visible outline is a failure.
 *   --axe       injects node_modules/axe-core (or the copy next to the script's repository) into the page and runs it once on every
 *               distinct screen and item kind (title, map, each item kind, each feedback kind, summary, review, end); a serious or
 *               critical violation is a failure; the counts are in the JSON summary (`axe`).
 *
 * Step bound (all modes, unless --max-steps): the driver's `maxSteps`; the quiz arena's is
 * maxSteps = ceil(6 * (units * roundLength + bossLength) * max(1, 0.75 / accuracy)^2)
 * where roundLength and bossLength come from the pack's quiz-arena config (defaults 7 and 10). A round has roundLength fresh questions
 * plus at most two retries per miss; the factor 6 leaves room for retries and for repeating a unit or the boss a few times.
 *
 * Media check (on by default, `--no-media-check` turns it off): every asset URL of game-data.json is loaded in the page. An image must decode, audio must reach
 * `canplaythrough` or `loadedmetadata`. A failure is a `mediaErrors` entry of the summary and fails the run, like a console error.
 *
 * Exit code: 0 success, 1 a failed check (JSON on stdout lists them), 2 bad usage, 3 Chromium cannot be launched.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { DRIVERS } from './bot/index.mjs'

const USAGE = 'usage: node scripts/play.mjs <build-dir> --mode perfect|wrong|random [--shell <id>] [--seed N] [--accuracy 0.75] [--shots <dir>] [--viewport 1280x800] [--max-steps N] [--rounds N] [--keyboard] [--axe] [--no-media-check] [--json] [--verbose]'
const ACTION_TIMEOUT = 8000

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const o = { dir: '', mode: '', shell: '', seed: 1, accuracy: 0.75, shots: '', viewport: { width: 1280, height: 800 }, maxSteps: 0, rounds: 1, keyboard: false, axe: false, media: true, json: false, verbose: false }
  const rest = argv.slice()
  const take = (flag) => {
    const v = rest.shift()
    if (v === undefined) throw new Error(`${flag} needs a value`)
    return v
  }
  while (rest.length) {
    const a = rest.shift()
    if (a === '--mode') o.mode = take(a)
    else if (a === '--shell') o.shell = take(a)
    else if (a === '--seed') o.seed = Number(take(a))
    else if (a === '--accuracy') o.accuracy = Number(take(a))
    else if (a === '--shots') o.shots = take(a)
    else if (a === '--max-steps') o.maxSteps = Number(take(a))
    else if (a === '--rounds') o.rounds = Number(take(a))
    else if (a === '--viewport') {
      const m = /^(\d+)x(\d+)$/.exec(take(a))
      if (!m) throw new Error('--viewport must look like 1280x800')
      o.viewport = { width: Number(m[1]), height: Number(m[2]) }
    } else if (a === '--keyboard') o.keyboard = true
    else if (a === '--axe') o.axe = true
    else if (a === '--no-media-check') o.media = false
    else if (a === '--json') o.json = true
    else if (a === '--verbose') o.verbose = true
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
    else if (!o.dir) o.dir = a
    else throw new Error(`unexpected argument ${a}`)
  }
  if (!o.dir) throw new Error('the build folder is missing')
  if (!['perfect', 'wrong', 'random'].includes(o.mode)) throw new Error('--mode must be perfect, wrong or random')
  if (!Number.isInteger(o.seed) || o.seed < 0 || o.seed >= 2 ** 31) throw new Error('--seed must be an integer from 0 to 2147483647')
  if (!(o.accuracy > 0 && o.accuracy <= 1)) throw new Error('--accuracy must be above 0 and at most 1')
  if (!Number.isInteger(o.rounds) || o.rounds < 1) throw new Error('--rounds must be a positive integer')
  if (!Number.isFinite(o.maxSteps) || o.maxSteps < 0) throw new Error('--max-steps must be a positive number')
  return o
}

/** A small seeded generator (mulberry32) for the random learner. */
function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const tid = (id) => `[data-testid="${id}"]`

// ---------------------------------------------------------------- the run

async function run(opts) {
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch (e) {
    const err = new Error(`playwright is not installed (yarn install): ${e instanceof Error ? e.message : e}`)
    err.exitCode = 3
    throw err
  }

  const dir = path.resolve(opts.dir)
  const dataFile = path.join(dir, 'game-data.json')
  if (!fs.existsSync(path.join(dir, 'index.html')) || !fs.existsSync(dataFile)) throw Object.assign(new Error(`${dir} is not a build folder (index.html or game-data.json is missing)`), { exitCode: 2 })
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
  const pack = data.pack
  const items = new Map(pack.items.map((i) => [i.id, i]))
  const shellId = opts.shell || data.shell || 'quiz-arena'
  const driver = DRIVERS[shellId]
  if (!driver) throw Object.assign(new Error(`the bot has no driver for the shell "${shellId}" (scripts/bot/index.mjs)`), { exitCode: 2 })
  const factor = Math.max(1, 0.75 / opts.accuracy) ** 2
  const maxSteps = opts.maxSteps > 0 ? opts.maxSteps : driver.maxSteps({ pack, data, opts, factor: opts.mode === 'random' ? factor : 1 })

  const started = Date.now()
  const log = (...a) => opts.verbose && console.error('[play]', ...a)
  const failures = []
  const fail = (msg) => {
    if (!failures.includes(msg)) failures.push(msg)
    log('FAIL', msg)
  }
  const consoleErrors = []
  let consoleWarnings = 0
  const mediaErrors = []
  const summary = { mode: opts.mode, shell: shellId, seed: opts.seed, steps: 0, correct: 0, wrong: 0, screens: [], kinds: {}, finished: false, consoleErrors: 0, mediaErrors: 0, media: { checked: opts.media, images: 0, audio: 0 }, durationMs: 0 }
  const screens = new Set()
  const checks = { whys: 0, explanations: 0, answers: 0 }

  let browser
  try {
    browser = await chromium.launch()
  } catch (e) {
    throw Object.assign(new Error(`Chromium cannot be launched (yarn playwright install chromium): ${e instanceof Error ? e.message.split('\n')[0] : e}`), { exitCode: 3 })
  }

  const context = await browser.newContext({ viewport: opts.viewport, acceptDownloads: true })
  const page = await context.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT)
  let axeBusy = false
  page.on('console', (m) => {
    if (m.type() === 'error') {
      if (!axeBusy) consoleErrors.push(`console.error: ${m.text()}`)
    } else if (m.type() === 'warning') consoleWarnings++
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
  page.on('crash', () => consoleErrors.push('page crashed'))
  page.on('requestfailed', (r) => {
    if (r.url().startsWith('file:') && !axeBusy) consoleErrors.push(`request failed: ${r.url()} (${r.failure()?.errorText ?? 'unknown'})`)
  })

  // ------------------------------------------------------------ helpers

  const state = () => page.evaluate(() => window.EduEngine.getState())
  const exists = async (id) => (await page.locator(tid(id)).count()) > 0
  let mouseClicks = 0
  const click = (id) => {
    // keyboard mode never reaches a click: every control is used through press() / activate()
    if (opts.keyboard) throw new Error(`bug in the bot: a mouse click on "${id}" in keyboard mode`)
    mouseClicks++
    return page.locator(tid(id)).click()
  }
  const text = (lang, key) => data.catalogs[lang]?.strings?.[key] ?? (pack.targetLang && pack.targetLang !== lang ? data.catalogs[pack.targetLang]?.strings?.[key] : undefined)

  /** Waits for the published state to differ from `prev` (screen, step count, question or round); a stuck screen is a failure. */
  async function waitChange(prev, what) {
    try {
      await page.waitForFunction(
        (p) => {
          const s = window.EduEngine.getState()
          return s.screen !== p.screen || s.steps !== p.steps || s.itemId !== p.itemId || s.itemIndex !== p.itemIndex || s.round !== p.round
        },
        { screen: prev.screen, steps: prev.steps, itemId: prev.itemId, itemIndex: prev.itemIndex, round: prev.round },
        { timeout: ACTION_TIMEOUT }
      )
    } catch {
      throw new Error(`stuck: no state change after ${what} (screen ${prev.screen}, item ${prev.itemId ?? '-'}) within ${ACTION_TIMEOUT} ms`)
    }
    if (opts.keyboard) await focusInMain(what)
  }

  async function waitScreen(screen, what) {
    try {
      await page.waitForFunction((s) => window.EduEngine.getState().screen === s, screen, { timeout: ACTION_TIMEOUT })
    } catch {
      const s = await state()
      throw new Error(`stuck: expected screen "${screen}" after ${what}, still on "${s.screen}"`)
    }
    screens.add(screen)
  }

  let shotNo = 0
  const shotKeys = new Set()
  /** One screenshot (--shots) and one axe run (--axe) per distinct key: a screen, an item kind, a feedback kind. */
  async function shot(key, label = key) {
    if ((!opts.shots && !opts.axe) || shotKeys.has(key)) return
    shotKeys.add(key)
    await page.waitForTimeout(900) // let the entrance animations finish (a half-faded screen has no real contrast, a half-popped star no real size)
    if (opts.shots) {
      fs.mkdirSync(opts.shots, { recursive: true })
      shotNo++
      const file = `${opts.mode}-${String(shotNo).padStart(2, '0')}-${label}.png`
      await page.screenshot({ path: path.join(opts.shots, file), fullPage: true })
    }
    if (key !== 'failure') await axeRun(label)
  }

  // ------------------------------------------------------------ axe-core, injected from node_modules

  const axeSummary = { runs: 0, violations: { critical: 0, serious: 0, moderate: 0, minor: 0 }, rules: {}, screens: [], minor: [] }
  let axeSource = ''
  async function axeRun(label) {
    if (!opts.axe) return
    if (!axeSource) axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
    axeBusy = true
    try {
      if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) await page.evaluate(axeSource)
      const res = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }))
      axeSummary.runs++
      axeSummary.screens.push(label)
      for (const v of res.violations) {
        axeSummary.violations[v.impact] = (axeSummary.violations[v.impact] ?? 0) + 1
        axeSummary.rules[v.id] = (axeSummary.rules[v.id] ?? 0) + 1
        if (v.impact !== 'serious' && v.impact !== 'critical') axeSummary.minor.push(`${label}: ${v.id} at ${v.nodes[0]?.target?.join(' ') ?? '?'}`)
        if (v.impact === 'serious' || v.impact === 'critical') fail(`axe ${v.impact} on ${label}: ${v.id} (${v.help}) at ${v.nodes[0]?.target?.join(' ') ?? '?'}`)
      }
    } finally {
      await page.waitForTimeout(50) // the failed fetches of file:// stylesheets are reported a moment later
      axeBusy = false
    }
  }

  // ------------------------------------------------------------ keyboard-only helpers (--keyboard): Tab, Shift+Tab, Enter, Space, arrows, digits, typing

  const kb = { presses: 0, focusChecks: 0, ringChecks: 0, tabbableMax: 0 }
  const focusedId = () => page.evaluate(() => document.activeElement?.getAttribute?.('data-testid') ?? null)

  /** In the page: which key (and how many presses of it) moves the focus from where it is to the control with this test id. */
  const tabPlan = (id) =>
    page.evaluate((target) => {
      const visible = (el) => !el.closest('[hidden]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
      const els = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter((el) => !el.disabled && el.tabIndex >= 0 && el.type !== 'hidden' && visible(el))
      const at = document.activeElement
      const t = els.findIndex((e) => e.getAttribute('data-testid') === target)
      if (t < 0) return { found: false, n: 0, dir: 'Tab', tabbable: els.length }
      const here = els.indexOf(at)
      if (here >= 0) return { found: true, n: Math.abs(t - here), dir: t >= here ? 'Tab' : 'Shift+Tab', tabbable: els.length }
      // the focus is on something that cannot be tabbed to (the heading, the page): Tab goes to the next tabbable after it
      let next = 0
      if (at && at !== document.body) {
        next = els.findIndex((e) => !!(at.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) && !(at.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_CONTAINED_BY))
        if (next < 0) next = 0
      }
      return t >= next ? { found: true, n: t - next + 1, dir: 'Tab', tabbable: els.length } : { found: true, n: next - t, dir: 'Shift+Tab', tabbable: els.length }
    }, id)

  async function ringCheck(id) {
    const r = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el instanceof SVGElement) return null // a region of a hotspot is drawn with a stroke
      const cs = getComputedStyle(el)
      return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) }
    })
    kb.ringChecks++
    if (r && (r.style === 'none' || r.width < 2)) fail(`keyboard: "${id}" has no visible focus ring (outline ${r.style} ${r.width}px)`)
  }

  /** Moves the focus to a control with Tab / Shift+Tab only, then checks it really arrived and shows a focus ring. */
  async function tabTo(id) {
    for (let round = 0; round < 4; round++) {
      const p = await tabPlan(id)
      kb.tabbableMax = Math.max(kb.tabbableMax, p.tabbable)
      if (!p.found) throw new Error(`keyboard: "${id}" cannot be reached with Tab (hidden, disabled or out of the tab order)`)
      if (p.n === 0) break
      for (let i = 0; i < p.n; i++) await page.keyboard.press(p.dir)
      kb.presses += p.n
      if ((await focusedId()) === id) break
    }
    if ((await focusedId()) !== id) throw new Error(`keyboard: Tab did not reach "${id}" (the focus is on "${(await focusedId()) ?? 'something without a test id'}")`)
    await ringCheck(id)
  }

  const activate = async (id, key = 'Enter') => {
    await tabTo(id)
    await page.keyboard.press(key)
  }
  const typeInto = async (id, value) => {
    await tabTo(id)
    await page.keyboard.type(value)
  }
  /** A button press: a click with the mouse, Tab + Enter with --keyboard. */
  const press = (id) => (opts.keyboard ? activate(id) : click(id))

  /** After a screen change the focus must be inside the game (not on the page behind it). */
  async function focusInMain(what) {
    const inside = await page.evaluate(() => {
      const main = document.getElementById('edu-main') ?? document.getElementById('edu-root')
      return !!main && main.contains(document.activeElement) && document.activeElement !== main
    })
    kb.focusChecks++
    if (!inside) fail(`keyboard: the focus is not inside the game after ${what}`)
  }

  async function overflowCheck(where) {
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
    if (o.sw > o.iw) fail(`horizontal overflow at ${where}: ${o.sw} > ${o.iw}`)
  }

  const ask = (which, itemId) => page.evaluate(([w, id]) => window.EduEngine.debug[w](id), [which, itemId])

  /** Moves the rows of an order item into `target` with the up buttons. */
  async function setOrder(target) {
    for (let i = 0; i < target.length; i++) {
      const cur = await page.$$eval('[data-testid^="order-row-"]', (els) => els.map((e) => e.dataset.testid.slice('order-row-'.length)))
      let at = cur.indexOf(target[i])
      while (at > i) {
        await click(`order-up-${target[i]}`)
        at--
      }
    }
  }

  /** Order item with the keyboard: Tab to the "move up" button of a row and press Enter until it is in place. */
  async function setOrderKeyboard(target) {
    for (let i = 0; i < target.length; i++) {
      const cur = await page.$$eval('[data-testid^="order-row-"]', (els) => els.map((e) => e.dataset.testid.slice('order-row-'.length)))
      let at = cur.indexOf(target[i])
      while (at > i) {
        await activate(`order-up-${target[i]}`)
        at--
      }
    }
  }

  /** The 0-based place of an option among the options shown (number keys count in displayed order). */
  const optionIndex = async (id) => (await page.$$eval('[data-testid^="option-"]', (els) => els.map((e) => e.dataset.testid.slice('option-'.length)))).indexOf(String(id))

  /** Choose an option: the number key on every other answer, Tab + Enter on the rest, so both ways are exercised. */
  async function chooseKeyboard(id) {
    const i = await optionIndex(id)
    if (i >= 0 && i < 9 && answered % 2 === 0) await page.keyboard.press(String(i + 1))
    else await activate(`option-${id}`)
  }

  /** The word search with arrow keys: the grid is one tab stop, arrows move, Enter picks the first and the last letter of a word. */
  async function wordSearchKeyboard(selections) {
    const where = () => page.evaluate(() => {
      const m = /^cell-(\d+)-(\d+)$/.exec(document.activeElement?.getAttribute('data-testid') ?? '')
      return m ? [Number(m[1]), Number(m[2])] : null
    })
    const goTo = async (r, c) => {
      let pos = await where()
      if (!pos) {
        await tabTo(await page.locator('[data-testid^="cell-"][tabindex="0"]').first().getAttribute('data-testid'))
        pos = await where()
      }
      for (const [axis, plus, minus] of [[0, 'ArrowDown', 'ArrowUp'], [1, 'ArrowRight', 'ArrowLeft']]) {
        while (pos[axis] !== (axis === 0 ? r : c)) {
          await page.keyboard.press(pos[axis] < (axis === 0 ? r : c) ? plus : minus)
          pos = await where()
        }
      }
    }
    for (const sel of selections) {
      await goTo(sel.start[0], sel.start[1])
      await page.keyboard.press('Enter')
      await goTo(sel.end[0], sel.end[1])
      await page.keyboard.press('Enter')
    }
    if (selections.length === 0) await activate('submit') // give up
  }

  /** The same answers as perform(), given with the keyboard only. */
  async function performKeyboard(item, right, ans) {
    switch (item.kind) {
      case 'mcq':
      case 'true-false':
        await chooseKeyboard(ans)
        break
      case 'multi-select':
        for (const id of ans) {
          const i = await optionIndex(id)
          if (i >= 0 && i < 9) await page.keyboard.press(String(i + 1))
          else await activate(`option-${id}`, ' ')
        }
        await activate('submit')
        break
      case 'cloze':
        for (const g of item.gaps) {
          if (g.bank) {
            const key = right ? g.answer : (g.bank.find((b) => b !== g.answer) ?? g.answer)
            await activate(`bank-${g.id}-${key}`, ' ')
          } else await typeInto(`gap-${g.id}`, String(ans[g.id] ?? ''))
        }
        await activate('submit')
        break
      case 'typed':
        await typeInto('answer-input', String(ans))
        await page.keyboard.press('Enter')
        break
      case 'listening':
        await activate('audio-play')
        if (item.mode === 'choose') await chooseKeyboard(ans)
        else {
          await typeInto('answer-input', String(ans))
          await page.keyboard.press('Enter')
        }
        break
      case 'match-pairs':
        for (const [l, r] of Object.entries(ans)) {
          await activate(`pair-left-${l}`, ' ')
          await activate(`pair-right-${r}`, ' ')
        }
        await activate('submit')
        break
      case 'order':
        await setOrderKeyboard(ans)
        await activate('submit')
        break
      case 'sort-groups':
        for (const [id, g] of Object.entries(ans)) await activate(`group-${g}-${id}`, ' ')
        await activate('submit')
        break
      case 'hotspot':
        await activate(`region-${ans}`)
        break
      case 'flashcard': {
        await activate('flip')
        await page.keyboard.press(String(['again', 'hard', 'good', 'easy'].indexOf(ans) + 1))
        break
      }
      case 'crossword':
        for (const [id, t] of Object.entries(ans)) await typeInto(`word-${id}`, String(t))
        await activate('submit')
        break
      case 'word-search':
        await wordSearchKeyboard(ans)
        break
      default:
        throw new Error(`the bot cannot drive the item kind "${item.kind}"`)
    }
  }

  /** Answers the question on screen. `right` says which kind of answer to give. Returns the answer given (for the expectations). */
  async function perform(item, right) {
    const ans = await ask(right ? 'solve' : 'wrong', item.id)
    if (ans === undefined) throw new Error(`the page has no ${right ? 'solution' : 'wrong answer'} for ${item.id} (${item.kind})`)
    if (opts.keyboard) {
      await performKeyboard(item, right, ans)
      return ans
    }
    switch (item.kind) {
      case 'mcq':
      case 'true-false':
        await click(`option-${ans}`)
        break
      case 'multi-select':
        for (const id of ans) await click(`option-${id}`)
        await click('submit')
        break
      case 'cloze':
        for (const g of item.gaps) {
          if (g.bank) {
            const key = right ? g.answer : (g.bank.find((b) => b !== g.answer) ?? g.answer)
            await click(`bank-${g.id}-${key}`)
          } else await page.locator(tid(`gap-${g.id}`)).fill(String(ans[g.id] ?? ''))
        }
        await click('submit')
        break
      case 'typed':
        await page.locator(tid('answer-input')).fill(String(ans))
        await click('submit')
        break
      case 'listening':
        await click('audio-play')
        if (item.mode === 'choose') await click(`option-${ans}`)
        else {
          await page.locator(tid('answer-input')).fill(String(ans))
          await click('submit')
        }
        break
      case 'match-pairs':
        for (const [l, r] of Object.entries(ans)) {
          await click(`pair-left-${l}`)
          await click(`pair-right-${r}`)
        }
        await click('submit')
        break
      case 'order':
        await setOrder(ans)
        await click('submit')
        break
      case 'sort-groups':
        for (const [id, g] of Object.entries(ans)) await click(`group-${g}-${id}`)
        await click('submit')
        break
      case 'hotspot':
        await page.locator(tid(`region-${ans}`)).dispatchEvent('click')
        break
      case 'flashcard':
        await click('flip')
        await click(`grade-${ans}`)
        break
      case 'crossword':
        for (const [id, t] of Object.entries(ans)) await page.locator(tid(`word-${id}`)).fill(String(t))
        await click('submit')
        break
      case 'word-search':
        for (const sel of ans) {
          await click(`cell-${sel.start[0]}-${sel.start[1]}`)
          await click(`cell-${sel.end[0]}-${sel.end[1]}`)
        }
        if (ans.length === 0) await click('submit') // give up
        // all words found: the item sends itself
        break
      default:
        throw new Error(`the bot cannot drive the item kind "${item.kind}"`)
    }
    return ans
  }

  /** Whether the feedback of this wrong answer must show an explanation of the chosen choice (`why`). */
  function whyExpected(item, ans, lang) {
    const has = (key) => !!key && !!text(lang, key)
    switch (item.kind) {
      case 'mcq':
        return item.answer !== ans && has(item.options.find((o) => o.id === ans)?.why)
      case 'listening':
        return item.mode === 'choose' && item.answer !== ans && has((item.options ?? []).find((o) => o.id === ans)?.why)
      case 'multi-select':
        return ans.filter((p) => !item.answers.includes(p)).some((p) => has(item.options.find((o) => o.id === p)?.why))
      case 'true-false':
        return item.answer !== ans && has(item.why)
      case 'hotspot':
        return item.answer !== ans && has(item.regions.find((r) => r.id === ans)?.why)
      case 'sort-groups':
        return item.items.some((x) => ans[x.id] !== x.group && has(x.why))
      default:
        return false
    }
  }

  let answered = 0
  const rng = prng(opts.seed ^ 0x9e3779b9)
  /** Whether to answer this item right: by mode. */
  const wantRight = () => (opts.mode === 'perfect' ? true : opts.mode === 'wrong' ? false : rng() < opts.accuracy)

  /** Answers one question and checks the feedback. */
  async function answerCurrent(s) {
    const item = items.get(s.itemId)
    if (!item) throw new Error(`the game shows an item that is not in game-data.json: ${s.itemId}`)
    if (answered >= maxSteps * (opts.mode === 'wrong' ? opts.rounds : 1)) throw new Error(`step bound exceeded: more than ${maxSteps} answers without finishing`)
    if (s.roundKind === 'boss') await shot('item-boss', `item-boss-${item.kind}`)
    await shot(`item-${item.kind}`)
    const right = wantRight()
    const lang = s.lang
    const ans = await perform(item, right)
    answered++
    await waitChange(s, `answering ${item.id} (${item.kind})`)
    const after = await state()
    if (after.screen !== 'feedback') throw new Error(`expected the feedback screen after answering ${item.id}, got "${after.screen}"`)
    screens.add('feedback')
    summary.kinds[item.kind] = (summary.kinds[item.kind] ?? 0) + 1
    const ok = after.lastResult?.correct === true
    if (ok) summary.correct++
    else summary.wrong++
    if (ok !== right) fail(`${item.id} (${item.kind}): expected the answer to be ${right ? 'right' : 'wrong'}, the game says ${ok ? 'right' : 'wrong'}`)
    await shot(`feedback-${ok ? 'right' : 'wrong'}-${item.kind}`, `feedback-${ok ? 'right' : 'wrong'}-${item.kind}`)
    if (opts.mode === 'perfect' && after.reviewQueue.length > 0) fail(`the review queue is not empty after right answers: ${after.reviewQueue.join(', ')}`)
    if (!right) {
      const miss = (what) => fail(`${item.id} (${item.kind}): the feedback of a wrong answer has no ${what}`)
      if (!(await exists('feedback'))) miss('feedback panel')
      if (!(await exists('feedback-answer'))) miss('feedback-answer')
      else checks.answers++
      if (text(lang, item.explanation) && !(await exists('feedback-explanation'))) miss('feedback-explanation')
      else if (text(lang, item.explanation)) checks.explanations++
      if (whyExpected(item, ans, lang)) {
        if (!(await exists('feedback-why'))) miss('feedback-why (the explanation of the chosen distractor)')
        else checks.whys++
      }
      if (!after.reviewQueue.includes(item.id)) fail(`${item.id}: a missed item is not in the review queue`)
    }
    if (opts.keyboard && (await focusedId()) !== 'next') fail(`keyboard: the focus is not on "next" after the feedback of ${item.id} (it is on "${(await focusedId()) ?? 'nothing'}")`)
    await press('next')
    await waitChange(after, `next after ${item.id}`)
    return item
  }

  /** Answers the questions on screen until the screen is no longer `item` (a round ends, a door opens, a battle turn ends). */
  async function answerWhileItem(label) {
    for (let guard = 0; guard < maxSteps + 50; guard++) {
      const s = await state()
      screens.add(s.screen)
      if (s.screen !== 'item') return s
      await answerCurrent(s)
    }
    throw new Error(`the questions of ${label} did not end`)
  }

  /** Presses a control that opens a question (a unit, a door, an NPC) and checks that the question screen came. */
  async function openQuestion(testid, label) {
    const prev = await state()
    await press(testid)
    await waitChange(prev, `opening ${label}`)
    const s = await state()
    if (s.screen !== 'item') throw new Error(`${label} did not open a question (screen "${s.screen}")`)
    return s
  }

  /** Presses a control and waits for the published state to change (and, with `screen`, for that screen). */
  async function pressAndWait(testid, what = testid, screen) {
    const prev = await state()
    await press(testid)
    await waitChange(prev, what)
    if (screen) await waitScreen(screen, what)
    return state()
  }

  // ------------------------------------------------------------ the media check

  /** Loads every asset of the build in the page: an image must decode, audio must reach canplaythrough or loadedmetadata. */
  async function checkMedia() {
    const kindOf = new Map(pack.assets.map((a) => [a.id, a.kind]))
    const list = Object.entries(data.assets ?? {}).map(([id, url]) => ({ id, url, kind: kindOf.get(id) ?? 'image' }))
    summary.media.images = list.filter((a) => a.kind !== 'audio').length
    summary.media.audio = list.filter((a) => a.kind === 'audio').length
    if (list.length === 0) return
    const bad = await page.evaluate(async (items) => {
      const out = []
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      await Promise.all(
        items.map(async (a) => {
          const url = new URL(a.url, document.baseURI).href
          try {
            if (a.kind === 'audio') {
              const el = new Audio()
              el.preload = 'auto'
              await Promise.race([
                new Promise((resolve, reject) => {
                  el.addEventListener('canplaythrough', resolve, { once: true })
                  el.addEventListener('loadedmetadata', resolve, { once: true })
                  el.addEventListener('error', () => reject(new Error('the audio cannot be loaded' + (el.error ? ' (' + (el.error.message || 'code ' + el.error.code) + ')' : ''))), { once: true })
                  el.src = url
                  el.load()
                }),
                wait(8000).then(() => {
                  throw new Error('the audio did not load within 8 s')
                })
              ])
            } else {
              const img = new Image()
              img.src = url
              await img.decode()
            }
          } catch (e) {
            out.push({ id: a.id, url: a.url, error: e instanceof Error ? e.message : String(e) })
          }
        })
      )
      return out
    }, list)
    for (const b of bad) {
      mediaErrors.push(b)
      fail('media: ' + b.id + ' (' + b.url + '): ' + b.error)
    }
  }

  /** The shell's own bot helpers in the page (`EduEngine.debug.shell.<name>(...args)`): read-only, see docs/player.md. */
  const shellDebug = (name, ...args) => page.evaluate(([n, a]) => {
    const fn = window.EduEngine.debug.shell?.[n]
    if (typeof fn !== 'function') throw new Error(`the shell has no debug helper "${n}"`)
    return fn(...a)
  }, [name, args])

  /** Everything a shell driver (scripts/bot/<shell>.mjs) needs. */
  const bot = {
    page, opts, data, pack, items, tid, text, log, fail, summary, screens, checks, maxSteps, shellId, driver,
    state, exists, click, press, activate, typeInto, tabTo, focusedId, waitChange, waitScreen, shot, overflowCheck, focusInMain,
    ask, answerCurrent, answerWhileItem, openQuestion, pressAndWait, shellDebug, wantRight, rng,
    get answered() {
      return answered
    }
  }

  // ------------------------------------------------------------ the game: the title here, the rest by the shell's driver

  try {
    await page.goto(pathToFileURL(path.join(dir, 'index.html')).href + `?seed=${opts.seed}` + (opts.shell ? `&shell=${encodeURIComponent(opts.shell)}` : ''))
    await page.waitForSelector(tid('course-title'))
    let st = await state()
    if (st.screen !== 'title') throw new Error(`the game did not open on the title screen (got "${st.screen}")`)
    if (st.seed !== opts.seed) fail(`the seed was not applied: asked ${opts.seed}, the game reports ${st.seed}`)
    if (st.shell !== shellId) fail(`the game runs the shell "${st.shell}", the bot expected "${shellId}"`)
    const playable = await page.evaluate(() => (typeof window.EduEngine.playableShells === 'function' ? window.EduEngine.playableShells() : []))
    if (playable.length > 1) {
      if (!(await exists('shell-picker'))) fail(`the title has no shell-picker although the course plays in ${playable.join(', ')}`)
      else if ((await page.locator(tid(`shell-${st.shell}`)).getAttribute('aria-pressed')) !== 'true') fail(`the shell picker does not mark "${st.shell}" as the current game style`)
    }
    summary.shell = st.shell
    screens.add('title')
    if (opts.media) await checkMedia()
    await shot('title')
    await overflowCheck('title')
    await driver.play(bot)

    st = await state()
    summary.finished = st.finished === true
    if (st.steps !== answered) fail(`the game counted ${st.steps} answers, the bot gave ${answered}`)
    summary.steps = answered
    if (opts.mode === 'perfect' && summary.wrong > 0) fail(`${summary.wrong} answer(s) were wrong in perfect mode`)
    if (opts.mode === 'wrong' && summary.correct > 0) fail(`${summary.correct} answer(s) were right in wrong mode`)
    if (opts.mode !== 'wrong' && !summary.finished) fail('the game was not finished')
    await overflowCheck('final screen')
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e))
    try {
      await shot('failure', 'failure')
    } catch {
      /* the page may be gone */
    }
    summary.steps = answered
  } finally {
    await browser.close().catch(() => undefined)
  }

  summary.screens = [...screens]
  for (const e of consoleErrors) fail(e)
  summary.consoleErrors = consoleErrors.length
  summary.mediaErrors = mediaErrors.length
  if (mediaErrors.length) summary.mediaErrorList = mediaErrors
  summary.consoleWarnings = consoleWarnings
  summary.maxSteps = maxSteps
  summary.checks = checks
  if (opts.keyboard) summary.keyboard = { ...kb, mouseClicks }
  if (opts.axe) summary.axe = axeSummary
  summary.viewport = `${opts.viewport.width}x${opts.viewport.height}`
  summary.ok = failures.length === 0
  summary.failures = failures
  summary.durationMs = Date.now() - started
  return summary
}

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : e}\n${USAGE}`)
    process.exit(2)
  }
  try {
    const summary = await run(opts)
    console.log(opts.json ? JSON.stringify(summary) : JSON.stringify(summary, null, 2))
    process.exit(summary.ok ? 0 : 1)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(e?.exitCode ?? 2)
  }
}

main()
