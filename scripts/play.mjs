#!/usr/bin/env node
/**
 * The autoplay bot: plays a BUILT game folder in headless Chromium over file:// and proves it is playable.
 *
 *   node scripts/play.mjs <build-dir> --mode perfect|wrong|random [--seed N] [--accuracy 0.75] [--shots <dir>]
 *                         [--viewport 1280x800] [--max-steps N] [--rounds N] [--json] [--verbose]
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
 * Step bound (all modes, unless --max-steps): maxSteps = ceil(6 * (units * roundLength + bossLength) * max(1, 0.75 / accuracy)^2)
 * where roundLength and bossLength come from the pack's quiz-arena config (defaults 7 and 10). A round has roundLength fresh questions
 * plus at most two retries per miss; the factor 6 leaves room for retries and for repeating a unit or the boss a few times.
 *
 * Exit code: 0 success, 1 a failed check (JSON on stdout lists them), 2 bad usage, 3 Chromium cannot be launched.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const USAGE = 'usage: node scripts/play.mjs <build-dir> --mode perfect|wrong|random [--seed N] [--accuracy 0.75] [--shots <dir>] [--viewport 1280x800] [--max-steps N] [--rounds N] [--json] [--verbose]'
const ACTION_TIMEOUT = 8000

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const o = { dir: '', mode: '', seed: 1, accuracy: 0.75, shots: '', viewport: { width: 1280, height: 800 }, maxSteps: 0, rounds: 1, json: false, verbose: false }
  const rest = argv.slice()
  const take = (flag) => {
    const v = rest.shift()
    if (v === undefined) throw new Error(`${flag} needs a value`)
    return v
  }
  while (rest.length) {
    const a = rest.shift()
    if (a === '--mode') o.mode = take(a)
    else if (a === '--seed') o.seed = Number(take(a))
    else if (a === '--accuracy') o.accuracy = Number(take(a))
    else if (a === '--shots') o.shots = take(a)
    else if (a === '--max-steps') o.maxSteps = Number(take(a))
    else if (a === '--rounds') o.rounds = Number(take(a))
    else if (a === '--viewport') {
      const m = /^(\d+)x(\d+)$/.exec(take(a))
      if (!m) throw new Error('--viewport must look like 1280x800')
      o.viewport = { width: Number(m[1]), height: Number(m[2]) }
    } else if (a === '--json') o.json = true
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
  const arena = pack.shells?.config?.['quiz-arena'] ?? {}
  const roundLength = arena.roundLength ?? 7
  const bossLength = arena.bossLength ?? 10
  const factor = Math.max(1, 0.75 / opts.accuracy) ** 2
  const maxSteps = opts.maxSteps > 0 ? opts.maxSteps : Math.ceil(6 * (pack.units.length * roundLength + bossLength) * (opts.mode === 'random' ? factor : 1))

  const started = Date.now()
  const log = (...a) => opts.verbose && console.error('[play]', ...a)
  const failures = []
  const fail = (msg) => {
    if (!failures.includes(msg)) failures.push(msg)
    log('FAIL', msg)
  }
  const consoleErrors = []
  let consoleWarnings = 0
  const summary = { mode: opts.mode, seed: opts.seed, steps: 0, correct: 0, wrong: 0, screens: [], kinds: {}, finished: false, consoleErrors: 0, durationMs: 0 }
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
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`)
    else if (m.type() === 'warning') consoleWarnings++
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
  page.on('crash', () => consoleErrors.push('page crashed'))
  page.on('requestfailed', (r) => {
    if (r.url().startsWith('file:')) consoleErrors.push(`request failed: ${r.url()} (${r.failure()?.errorText ?? 'unknown'})`)
  })

  // ------------------------------------------------------------ helpers

  const state = () => page.evaluate(() => window.EduEngine.getState())
  const exists = async (id) => (await page.locator(tid(id)).count()) > 0
  const click = (id) => page.locator(tid(id)).click()
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
  async function shot(key, label = key) {
    if (!opts.shots || shotKeys.has(key)) return
    shotKeys.add(key)
    fs.mkdirSync(opts.shots, { recursive: true })
    await page.waitForTimeout(500) // let the entrance animations finish
    shotNo++
    const file = `${opts.mode}-${String(shotNo).padStart(2, '0')}-${label}.png`
    await page.screenshot({ path: path.join(opts.shots, file), fullPage: true })
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

  /** Answers the question on screen. `right` says which kind of answer to give. Returns the answer given (for the expectations). */
  async function perform(item, right) {
    const ans = await ask(right ? 'solve' : 'wrong', item.id)
    if (ans === undefined) throw new Error(`the page has no ${right ? 'solution' : 'wrong answer'} for ${item.id} (${item.kind})`)
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
    await click('next')
    await waitChange(after, `next after ${item.id}`)
    return item
  }

  /** Plays the round on screen to its summary. */
  async function playRound(label) {
    for (let guard = 0; guard < maxSteps + 50; guard++) {
      const s = await state()
      screens.add(s.screen)
      if (s.screen === 'summary') return s
      if (s.screen !== 'item') throw new Error(`unexpected screen "${s.screen}" in round ${label}`)
      await answerCurrent(s)
    }
    throw new Error(`the round ${label} did not end`)
  }

  const startRound = async (testid, label) => {
    const prev = await state()
    await click(testid)
    await waitChange(prev, `opening ${label}`)
    const s = await state()
    if (s.screen !== 'item') throw new Error(`${label} did not open a question (screen "${s.screen}")`)
    return s
  }

  /** Summary screen: screenshot and light checks, then back to the map. */
  async function leaveSummary(label, roundKind) {
    await shot(`summary-${roundKind}`, `summary-${roundKind}`)
    await overflowCheck(`summary of ${label}`)
    const prev = await state()
    await click('to-map')
    await waitChange(prev, `to-map after ${label}`)
    await waitScreen('map', 'to-map')
  }

  // ------------------------------------------------------------ the game

  const unitOpen = async (id) => !(await page.locator(tid(`unit-${id}`)).isDisabled()) && (await page.locator(tid(`unit-${id}`)).getAttribute('data-locked')) !== 'true'

  try {
    await page.goto(pathToFileURL(path.join(dir, 'index.html')).href + `?seed=${opts.seed}`)
    await page.waitForSelector(tid('course-title'))
    let st = await state()
    if (st.screen !== 'title') throw new Error(`the game did not open on the title screen (got "${st.screen}")`)
    if (st.seed !== opts.seed) fail(`the seed was not applied: asked ${opts.seed}, the game reports ${st.seed}`)
    screens.add('title')
    await shot('title')
    await overflowCheck('title')
    {
      const prev = st
      await click('start')
      await waitChange(prev, 'start')
      await waitScreen('map', 'start')
    }
    await shot('map')
    await overflowCheck('map')

    if (opts.mode === 'wrong') {
      // one round per unit that is open (no unit is ever mastered), then the review screen
      for (const u of pack.units) for (let r = 0; r < opts.rounds; r++) {
        if (!(await unitOpen(u.id))) continue
        const s = await startRound(`unit-${u.id}`, `unit ${u.id}`)
        if (s.roundKind !== 'unit' || s.unitId !== u.id) fail(`unit ${u.id}: the round is ${s.roundKind}/${s.unitId}`)
        const sum = await playRound(u.id)
        if (!(await exists('summary-misses'))) fail(`unit ${u.id}: the summary lists no misses after an all-wrong round`)
        if (sum.mastery[u.id] !== 0) fail(`unit ${u.id}: an all-wrong round earned ${sum.mastery[u.id]} star(s)`)
        await leaveSummary(u.id, 'unit')
      }
      st = await state()
      if (st.reviewQueue.length === 0) fail('the review queue is empty after answering everything wrong')
      if (!(await exists('review'))) fail('the review entry is not offered on the map')
      else {
        const prev = await state()
        await click('review')
        await waitChange(prev, 'review')
        await waitScreen('review', 'review')
        await shot('review')
        await overflowCheck('review')
        for (const id of st.reviewQueue) if (!(await exists(`review-item-${id}`))) fail(`the review screen does not list ${id}`)
        if (!(await exists('practice'))) fail('the review screen has no practice button')
        const p2 = await state()
        await page.locator(tid('to-map')).last().click() // the review screen has a small back button and a big one
        await waitChange(p2, 'to-map from review')
        await waitScreen('map', 'to-map from review')
      }
      if (await page.locator(tid('boss')).isEnabled()) fail('the boss is open although no unit was mastered')
    } else {
      // perfect and random: play units in prerequisite order, then the boss, until the end screen
      let bossTries = 0
      for (let guard = 0; guard < 400; guard++) {
        st = await state()
        if (st.screen !== 'map') throw new Error(`expected the map, got "${st.screen}"`)
        const target = opts.mode === 'perfect' ? 3 : 2 // perfect: every unit to 3 stars; random: mastered
        let next
        for (const u of pack.units) if ((st.mastery[u.id] ?? 0) < target && (await unitOpen(u.id))) {
          next = u
          break
        }
        if (next) {
          const s = await startRound(`unit-${next.id}`, `unit ${next.id}`)
          if (s.roundKind !== 'unit' || s.unitId !== next.id) fail(`unit ${next.id}: the round is ${s.roundKind}/${s.unitId}`)
          await playRound(next.id)
          await leaveSummary(next.id, 'unit')
          continue
        }
        const stuckUnit = pack.units.find((u) => (st.mastery[u.id] ?? 0) < target)
        if (stuckUnit) throw new Error(`deadlock: unit ${stuckUnit.id} has ${st.mastery[stuckUnit.id]} star(s) and no open unit is left to play`)
        if (opts.mode === 'perfect') {
          for (const u of pack.units) if (st.mastery[u.id] !== 3) fail(`unit ${u.id} has ${st.mastery[u.id]} stars after perfect play`)
        }
        await shot('map-mastered')
        if (await exists('finish')) {
          const prev = await state()
          await click('finish')
          await waitChange(prev, 'finish')
          break
        }
        if (!(await page.locator(tid('boss')).isEnabled())) throw new Error('every unit is mastered but the boss is not open')
        if (++bossTries > 30) throw new Error('the boss was not beaten in 30 tries')
        const s = await startRound('boss', 'the boss')
        if (s.roundKind !== 'boss') fail(`the boss opened a "${s.roundKind}" round`)
        await playRound('boss')
        const hasFinish = await exists('finish')
        await shot('summary-boss', 'summary-boss')
        await overflowCheck('summary of the boss')
        if (hasFinish) {
          const prev = await state()
          await click('finish')
          await waitChange(prev, 'finish')
          break
        }
        if (opts.mode === 'perfect') fail('a perfect boss round did not offer the end screen')
        await leaveSummary('boss', 'boss-retry')
      }
      st = await state()
      if (st.screen !== 'end' || !st.finished) throw new Error(`the end screen was not reached (screen "${st.screen}")`)
      screens.add('end')
      await shot('end')
      await overflowCheck('end')
      for (const id of ['end-title', 'play-again', 'to-title']) if (!(await exists(id))) fail(`the end screen has no ${id}`)
      if (opts.mode === 'perfect') {
        for (const u of pack.units) if (st.mastery[u.id] !== 3) fail(`unit ${u.id} has ${st.mastery[u.id]} stars at the end`)
        if (st.reviewQueue.length > 0) fail(`the review queue is not empty at the end: ${st.reviewQueue.join(', ')}`)
      }
    }

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
  summary.consoleWarnings = consoleWarnings
  summary.maxSteps = maxSteps
  summary.checks = checks
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
