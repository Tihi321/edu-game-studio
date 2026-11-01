/**
 * The encyclopedia explorer's driver for the autoplay bot (scripts/play.mjs): title -> explore -> hunts -> end, with the timeline, the
 * map and the codex visited on the way.
 *
 *   perfect  for each unit in prerequisite order the bot starts its hunt and, per clue, reads the clue pinned on the page, finds the target
 *            article (by SEARCH on one step, by the INDEX, by SEARCH + ENTER, by a CROSS-LINK or "See also" in turn), presses
 *            `collect-<step>` and answers right. Every hunt ends with 3 stars; then the grand hunt and `finish` -> `end`. It also reads a
 *            locked chapter's article (reading is free), checks the article page (citations, links, related), uses the arrow keys on the
 *            timeline and on the map, opens an event and a place, and counts the codex (empty at the start, every collectible at the end).
 *   wrong    every answer wrong. The clue stays pinned, the target article and `collect-<step>` are always still there (never a dead end),
 *            a missed step comes back as a retry, the codex stays empty, the review queue fills, the hunt ends with 0 stars (it is offered
 *            again), the next chapter and the grand hunt stay locked and `finish` never appears (--rounds N plays each open hunt N times).
 *   random   a seeded learner (--accuracy) plays the hunts until every unit is mastered (2+ stars), then the grand hunt until it earns a
 *            star, within maxSteps.
 *
 * A reading course (EGS-35: `encyclopedia.reader: true`, the glossary) starts in the READER: the bot checks the contents, taps a glossed word
 * (popover, close), switches a word out of the deck (kept when the chapter is opened again), reads each chapter to its last paragraph,
 * moves with the buttons, the contents and the arrow keys, and practises the questions on a chapter (the passage panel is open there).
 *
 * The shell's read-only helpers (`EduEngine.debug.shell`): hunts(), finalHunt(), target(), searchTerm(id), links(id), articles(),
 * timeline(), places(), codex(), queue(), chapters(). The page publishes `getState().view` (found, read, counts, hunt, article ...).
 */

/** maxSteps = ceil(6 * (steps of all hunts + the grand hunt) * factor) + 20 (a hunt asks every step once and a missed one at most twice more). */
export function maxSteps({ pack, factor }) {
  const hunts = pack.shells?.config?.encyclopedia?.hunts ?? []
  const steps = hunts.length > 0 ? hunts.reduce((n, h) => n + h.steps.length, 0) : pack.units.length * 6
  return Math.ceil(6 * (steps + 2 * pack.units.length) * factor) + 20
}

export async function play(bot) {
  const { page, opts, pack, tid, fail, state, exists, press, tabTo, focusedId, waitScreen, waitChange, shot, overflowCheck, answerWhileItem, openQuestion, shellDebug, rng, focusInMain, summary } = bot
  const stats = { hunts: 0, steps: 0, search: 0, searchEnter: 0, index: 0, crossLinks: 0, related: 0, articlesChecked: 0, events: 0, places: 0, collectibles: 0, locked: 0, reader: null }
  summary.encyclopedia = stats
  const checked = new Set()

  // ---------------------------------------------------------------- small helpers

  /** Waits for a page expression over the published state `s` (a string) to hold. */
  async function waitFor(expr, what) {
    try {
      await page.waitForFunction(`(() => { const s = window.EduEngine.getState(); return ${expr} })()`, undefined, { timeout: 8000 })
    } catch {
      const s = await state()
      throw new Error(`stuck: ${what} (screen "${s.screen}", article ${s.view?.article ?? '-'})`)
    }
    if (opts.keyboard) await focusInMain(what)
  }
  const waitArticle = (id, what) => waitFor(`s.screen === 'article' && s.view && s.view.article === ${JSON.stringify(id)}`, what)
  const screenName = async () => (await state()).screen
  const count = (testid) => page.locator(tid(testid)).count()
  const text = async (testid) => ((await page.locator(tid(testid)).first().textContent()) ?? '').trim()

  /** Goes to a tab of the book (index, timeline, map, codex, hunts) unless already there. */
  async function toTab(name, screen) {
    if ((await screenName()) === screen) return
    if (!(await exists(`nav-${name}`))) throw new Error(`there is no nav-${name} on screen "${await screenName()}"`)
    await press(`nav-${name}`)
    await waitScreen(screen, `nav-${name}`)
    if (opts.keyboard) await focusInMain(`nav-${name}`)
  }

  /** What the article page must show (checked once per article): title, body, links, related, citations. */
  async function checkArticle(id) {
    if (checked.has(id)) return
    checked.add(id)
    stats.articlesChecked++
    if (!(await exists('article-title'))) fail(`article ${id}: no article-title`)
    else if ((await text('article-title')).length === 0) fail(`article ${id}: the title is empty`)
    if (!(await exists('article-body'))) fail(`article ${id}: no article-body`)
    if (!(await exists('back'))) fail(`article ${id}: no back button`)
    const real = pack.encyclopedia.articles.find((a) => a.id === id)
    if (real) {
      for (const f of real.citations) if (pack.factbase.some((x) => x.id === f) && !(await exists(`citation-${f}`))) fail(`article ${id}: no citation-${f}`)
      for (const r of real.related) if (pack.encyclopedia.articles.some((a) => a.id === r) && !(await exists(`related-${r}`))) fail(`article ${id}: no related-${r}`)
      const asset = real.asset ? pack.assets.find((a) => a.id === real.asset) : undefined
      if (asset?.kind === 'image' && !(await exists('article-figure'))) fail(`article ${id}: no figure for ${asset.id}`)
      if (asset?.kind === 'audio' && !(await exists('article-audio'))) fail(`article ${id}: no audio slot for ${asset.id}`)
      if (asset?.kind !== 'audio' && (await exists('article-audio'))) fail(`article ${id}: an audio slot although the article has no audio`)
    }
    const l = await shellDebug('links', id)
    for (const to of l.links) if (!(await exists(`link-${to}`))) fail(`article ${id}: the body mentions ${to} but there is no link-${to}`)
    for (const a of await page.locator('a[data-testid^="citation-link-"]').all()) {
      if ((await a.getAttribute('target')) !== '_blank' || !/noopener/.test((await a.getAttribute('rel')) ?? '')) fail(`article ${id}: a citation link does not open in a new tab with noopener`)
    }
  }

  async function setSearch(term) {
    if (opts.keyboard) {
      await tabTo('search')
      await page.keyboard.press('Control+A')
      if (term) await page.keyboard.type(term)
      else await page.keyboard.press('Backspace')
    } else await page.locator(tid('search')).fill(term)
  }

  /** Opens an article: by the 'search' box (and a click on the result), 'enter' (search + Enter), the 'index', or a 'link' (cross-link / see also). */
  async function openArticle(id, how) {
    if (how === 'link') {
      const target = await shellDebug('target')
      const via = target && target.article === id ? target.via : null
      if (!via) how = 'index'
      else {
        await toTab('index', 'explore')
        await press(`article-${via.from}`)
        await waitArticle(via.from, `opening ${via.from} to reach ${id}`)
        await checkArticle(via.from)
        await shot('article')
        await press(via.testid)
        await waitArticle(id, `following ${via.testid}`)
        if (via.testid.startsWith('link-')) stats.crossLinks++
        else stats.related++
        await checkArticle(id)
        return
      }
    }
    await toTab('index', 'explore')
    if (how === 'search' || how === 'enter') {
      const t = await shellDebug('searchTerm', id)
      if (!t) throw new Error(`no search term for ${id}`)
      await setSearch(t)
      if (!(await exists(`result-${id}`))) fail(`searching "${t}" does not list the article ${id}`)
      const first = await page.locator('[data-testid^="result-"]').first().getAttribute('data-testid')
      if (how === 'enter' && first === `result-${id}`) {
        stats.searchEnter++
        if (!opts.keyboard) await page.locator(tid('search')).focus()
        await page.keyboard.press('Enter')
      } else {
        stats.search++
        await press(`result-${id}`)
      }
    } else {
      stats.index++
      await press(`article-${id}`)
    }
    await waitArticle(id, `opening ${id} by ${how}`)
    await checkArticle(id)
  }

  // ---------------------------------------------------------------- the parts of the book

  /** The search box: a nonsense query lists nothing and says so, and the box is cleared again. */
  async function searchNothing() {
    await toTab('index', 'explore')
    await setSearch('zzqxj')
    if ((await count('search-results')) === 0) fail('the explore screen has no search-results list')
    if ((await page.locator('[data-testid^="result-"]').count()) !== 0) fail('a nonsense search lists results')
    if ((await text('search-status')).length === 0) fail('a search with no result says nothing (search-status is empty)')
    await setSearch('')
  }

  async function visitTimeline() {
    const events = await shellDebug('timeline')
    if (events.length === 0) {
      if (await exists('nav-timeline')) fail('nav-timeline is offered although there are no events')
      return
    }
    if (!(await exists('nav-timeline'))) return fail('there are events but no nav-timeline')
    await toTab('timeline', 'timeline')
    await shot('timeline')
    await overflowCheck('timeline')
    const sorted = [...events].sort((a, b) => a.year - b.year || a.id.localeCompare(b.id))
    for (const e of sorted) if (!(await exists(`event-${e.id}`))) fail(`the timeline has no event-${e.id}`)
    const shown = (await page.locator('[data-testid^="event-"]').count()) - 1 // -1: event-detail
    if (shown !== sorted.length) fail(`the timeline shows ${shown} events, the course has ${sorted.length}`)
    // arrow keys move between the events
    if (sorted.length >= 2) {
      if (opts.keyboard) await tabTo(`event-${sorted[0].id}`)
      else await page.locator(tid(`event-${sorted[0].id}`)).focus()
      await page.keyboard.press('ArrowRight')
      if ((await focusedId()) !== `event-${sorted[1].id}`) fail(`timeline: ArrowRight from ${sorted[0].id} did not reach ${sorted[1].id} (focus: ${await focusedId()})`)
      await page.keyboard.press('End')
      if ((await focusedId()) !== `event-${sorted[sorted.length - 1].id}`) fail('timeline: End did not reach the last event')
      await page.keyboard.press('Home')
      if ((await focusedId()) !== `event-${sorted[0].id}`) fail('timeline: Home did not reach the first event')
      if ((await page.locator(tid('event-detail')).getAttribute('data-event')) !== sorted[0].id) fail('timeline: the detail line does not follow the focus')
    }
    const open = sorted.find((e) => e.article)
    if (open) {
      await press(`event-${open.id}`)
      await waitArticle(open.article, `event ${open.id}`)
      stats.events++
      await checkArticle(open.article)
      await press('back')
      await waitScreen('timeline', 'back to the timeline')
      if (opts.keyboard) await focusInMain('back to the timeline')
    }
  }

  async function visitMap() {
    const places = await shellDebug('places')
    if (!(await exists('nav-map'))) {
      if (places.length > 0) fail('there are places but no nav-map')
      return
    }
    await toTab('map', 'map')
    await shot('map')
    await overflowCheck('map')
    if (places.length === 0) return
    for (const p of places) {
      if (!(await exists(`place-${p.id}`))) fail(`the map has no pin place-${p.id}`)
      if (!(await exists(`place-link-${p.id}`))) fail(`the list under the map has no place-link-${p.id}`)
    }
    if (places.length >= 2) {
      if (opts.keyboard) await tabTo(`place-${places[0].id}`)
      else await page.locator(tid(`place-${places[0].id}`)).focus()
      await page.keyboard.press('ArrowRight')
      const f = await focusedId()
      if (!f || !f.startsWith('place-') || f === `place-${places[0].id}`) fail(`map: ArrowRight from the first pin did not move to another pin (focus: ${f})`)
    }
    const p = places[stats.places % places.length]
    await press(`place-${p.id}`)
    await waitArticle(p.article, `pin ${p.id}`)
    stats.places++
    await checkArticle(p.article)
    await press('back')
    await waitScreen('map', 'back to the map')
    // the list is an alternative to the pins
    const q = places[(stats.places + 1) % places.length]
    await press(`place-link-${q.id}`)
    await waitArticle(q.article, `place-link-${q.id}`)
    await press('back')
    await waitScreen('map', 'back to the map from the list')
  }

  /** The codex: counts agree with the debug helper; a found collectible links to its article. Returns { found, total }. */
  async function visitCodex(label) {
    await toTab('codex', 'codex')
    await shot('codex')
    await overflowCheck('codex')
    const cx = await shellDebug('codex')
    const found = cx.filter((c) => c.found).length
    const c = await page.locator(tid('codex-count')).evaluate((el) => ({ f: Number(el.dataset.found), t: Number(el.dataset.total) }))
    if (c.f !== found || c.t !== cx.length) fail(`codex (${label}): the page says ${c.f}/${c.t}, the debug helper ${found}/${cx.length}`)
    for (const e of cx) {
      const el = page.locator(tid(`codex-${e.id}`))
      if ((await el.count()) === 0) fail(`codex (${label}): no codex-${e.id}`)
      else if ((await el.getAttribute('data-found')) !== String(e.found)) fail(`codex (${label}): codex-${e.id} should be ${e.found ? 'found' : 'a "?" slot'}`)
    }
    if (found === 0 && !(await exists('codex-empty'))) fail(`codex (${label}): an empty codex has no codex-empty note`)
    const first = cx.find((e) => e.found)
    if (first) {
      await shot('codex-found')
      await press(`codex-link-${first.id}`)
      await waitFor(`s.screen === 'article'`, `codex-link-${first.id}`)
      await press('back')
      await waitScreen('codex', 'back to the codex')
    }
    return { found, total: cx.length }
  }

  // ---------------------------------------------------------------- the reader (EGS-35)

  const progressOf = () => page.locator(tid('reader-progress')).evaluate((el) => ({ chapter: el.dataset.chapter, index: Number(el.dataset.index), total: Number(el.dataset.total), read: el.dataset.read === 'true' }))
  const waitChapter = async (index, what) => {
    try {
      await page.waitForFunction(`document.querySelector('[data-testid="reader-progress"]')?.dataset.index === '${index}'`, undefined, { timeout: 8000 })
    } catch {
      throw new Error(`stuck: ${what} (the reader shows chapter ${(await progressOf()).index}, expected ${index})`)
    }
    if (opts.keyboard) await focusInMain(what)
  }
  const setDeck = async (gid, on) => {
    if (opts.keyboard) {
      await tabTo(`gloss-deck-${gid}`)
      await page.keyboard.press('Space')
    } else await page.locator(tid(`gloss-deck-${gid}`)).setChecked(on)
  }

  /** The whole reader: contents, tap-to-gloss, the deck switch, reading to the end, the ways between chapters, practice. */
  async function readerWalk() {
    const rs = (stats.reader = { chapters: 0, taps: 0, read: 0, deck: 0, arrows: 0, toc: 0, practice: 0, practiceAnswers: 0 })
    const chapters = await shellDebug('chapters')
    if (chapters.length === 0) throw new Error('the reader is the first screen but the course has no chapters')
    for (const id of ['reader', 'reader-toc', 'reader-progress', 'reader-title', 'reader-body', 'reader-prev', 'reader-next', 'reader-end', 'glossary-panel']) if (!(await exists(id))) fail(`reader: there is no ${id}`)
    if ((await page.locator('h1').count()) !== 1) fail(`the reader has ${await page.locator('h1').count()} h1 elements`)
    if (!(await page.locator(tid('reader-prev')).isDisabled())) fail('reader: prev is enabled on the first chapter')
    for (const c of chapters) if (!(await exists(`reader-chapter-${c.id}`))) fail(`reader: the contents have no reader-chapter-${c.id}`)
    await shot('reader')
    await overflowCheck('reader')

    for (let i = 0; i < chapters.length; i++) {
      const c = chapters[i]
      const p = await progressOf()
      if (p.chapter !== c.id || p.index !== i + 1 || p.total !== chapters.length) fail(`reader: the progress says ${JSON.stringify(p)}, expected chapter ${c.id} (${i + 1} of ${chapters.length})`)
      rs.chapters++
      for (const g of c.glosses) {
        if ((await page.locator(tid(`gloss-${g}`)).count()) !== 1) fail(`reader ${c.id}: the gloss ${g} is not exactly once in the text`)
        if (!(await exists(`gloss-deck-${g}`)) || !(await exists(`glossary-entry-${g}`))) fail(`reader ${c.id}: the glossary has no entry or deck switch for ${g}`)
      }
      if ((await page.locator(tid('glossary-panel')).locator('li').count()) !== c.glosses.length) fail(`reader ${c.id}: the glossary lists a different number of words than the course has`)

      // tap-to-gloss: the popover opens under the word, says what it means, closes again
      if (c.glosses.length > 0) {
        const g = c.glosses[i % c.glosses.length]
        await press(`gloss-${g}`)
        const pop = page.locator(tid('gloss-popover'))
        if (!(await pop.isVisible())) fail(`reader ${c.id}: tapping gloss-${g} opens no popover`)
        else {
          if ((await text('gloss-text')).length === 0) fail(`reader ${c.id}: the popover of ${g} has no gloss`)
          if ((await page.locator(tid(`gloss-${g}`)).getAttribute('aria-expanded')) !== 'true') fail(`reader ${c.id}: gloss-${g} is not aria-expanded while its popover is open`)
          if (!(await page.locator(tid(`gloss-${g}`)).getAttribute('aria-describedby'))) fail(`reader ${c.id}: gloss-${g} has no aria-describedby`)
          await shot('reader-popover')
          await press('gloss-close')
          if (await pop.isVisible()) fail(`reader ${c.id}: gloss-close leaves the popover open`)
        }
        rs.taps++
      }

      // the deck switch of the first word of the first chapter (kept when the chapter is opened again, below)
      if (i === 0 && c.glosses.length > 0) {
        await setDeck(c.glosses[0], false)
        if (await page.locator(tid(`gloss-deck-${c.glosses[0]}`)).isChecked()) fail('reader: the deck switch stays on after it was turned off')
        rs.deck++
      }

      // reading to the last paragraph marks the chapter read
      await page.locator(tid('reader-end')).scrollIntoViewIfNeeded()
      try {
        await page.waitForFunction("document.querySelector('[data-testid=\"reader-progress\"]')?.dataset.read === 'true'", undefined, { timeout: 8000 })
        rs.read++
      } catch {
        fail(`reader ${c.id}: the last paragraph is on screen but the chapter is not marked read`)
      }
      if (!(await page.locator(tid('reader-done')).isVisible())) fail(`reader ${c.id}: a chapter read to the end shows no reader-done note`)

      if (i < chapters.length - 1) {
        await press('reader-next')
        await waitChapter(i + 2, 'reader-next')
      }
    }
    if (!(await page.locator(tid('reader-next')).isDisabled())) fail('reader: next is enabled on the last chapter')

    // the contents jump back to the first chapter; the deck switch was kept; every chapter shows as read
    await press(`reader-chapter-${chapters[0].id}`)
    await waitChapter(1, 'the contents')
    rs.toc++
    if (chapters[0].glosses.length > 0) {
      const g = chapters[0].glosses[0]
      if (await page.locator(tid(`gloss-deck-${g}`)).isChecked()) fail('reader: the deck switch was not kept when the chapter was opened again')
      if (!/\bis-off\b/.test((await page.locator(tid(`gloss-${g}`)).getAttribute('class')) ?? '')) fail(`reader: gloss-${g} is not marked as out of the deck`)
      await setDeck(g, true)
      if (!(await page.locator(tid(`gloss-deck-${g}`)).isChecked())) fail('reader: the deck switch cannot be turned on again')
    }
    for (const c of chapters) if ((await page.locator(tid(`reader-chapter-${c.id}`)).getAttribute('data-read')) !== 'true') fail(`reader: the contents do not show ${c.id} as read`)

    // the arrow keys change chapter
    if (chapters.length >= 2) {
      await page.locator(tid('reader-title')).focus()
      await page.keyboard.press('ArrowRight')
      await waitChapter(2, 'ArrowRight')
      await page.keyboard.press('ArrowLeft')
      await waitChapter(1, 'ArrowLeft')
      rs.arrows += 2
    }

    // practise the questions on each text: the text is open above them
    for (let i = 0; i < chapters.length; i++) {
      const c = chapters[i]
      if (c.items.length === 0) continue
      if (i > 0) {
        await press(`reader-chapter-${c.id}`)
        await waitChapter(i + 1, 'the contents')
      }
      if (!(await exists('reader-practice'))) {
        fail(`reader ${c.id}: it has ${c.items.length} question(s) but no reader-practice`)
        continue
      }
      const prev = await state()
      await press('reader-practice')
      await waitChange(prev, 'reader-practice')
      const q = await state()
      if (q.screen !== 'item' || q.context !== 'reader') throw new Error(`reader-practice did not open a question (screen "${q.screen}", context "${q.context}")`)
      if (!c.items.includes(q.itemId)) fail(`reader-practice on ${c.id} asked ${q.itemId}, which does not belong to the text`)
      const after = await answerWhileItem(`the practice on ${c.id}`)
      if (after.screen !== 'reader') throw new Error(`the practice on ${c.id} ended on "${after.screen}", expected the reader`)
      rs.practice++
      rs.practiceAnswers += (await state()).steps - q.steps
    }
    await shot('reader-end')
  }

  // ---------------------------------------------------------------- hunts

  /** Plays the hunt that has just been started (the explore screen with the clue pinned) until the run is over. Returns the answers given. */
  async function playRun(label, mode) {
    const ways = ['search', 'index', 'enter', 'link']
    let k = Math.floor(rng() * 4)
    const answers = []
    for (let guard = 0; guard < 80; guard++) {
      const st = await state()
      if (st.screen === 'hunts') break
      const t = await shellDebug('target')
      if (!t) throw new Error(`${label}: no pinned clue on screen "${st.screen}"`)
      if (st.screen === 'explore') await shot('explore-hunt')
      await openArticle(t.article, t.retry ? 'index' : ways[k++ % ways.length])
      await shot('article-hunt')
      // the clue is on the page, the collect button too
      if (!(await exists('clue-bar'))) fail(`${label}: no clue bar on the article ${t.article}`)
      else if ((await text('clue')) !== t.clue) fail(`${label}: the pinned clue reads "${await text('clue')}", expected "${t.clue}"`)
      if (t.retry && !(await exists('clue-retry'))) fail(`${label}: the retry of ${t.step} is not marked`)
      if (!(await exists(`collect-${t.step}`))) {
        fail(`${label}: the target article ${t.article} has no collect-${t.step} (a dead end)`)
        throw new Error(`no collect-${t.step} on ${t.article}`)
      }
      if (opts.keyboard && (await focusedId()) !== `collect-${t.step}`) fail(`keyboard: the focus did not start on collect-${t.step} (it is on ${await focusedId()})`)
      const s = await openQuestion(`collect-${t.step}`, `collect-${t.step}`)
      if (s.context !== 'hunt') fail(`${label}: the question of ${t.step} has the context "${s.context}", expected "hunt"`)
      if (s.itemId !== t.item) fail(`${label}: collecting ${t.step} asked ${s.itemId}, expected ${t.item}`)
      stats.steps++
      const after = await answerWhileItem(`${label} ${t.step}`)
      answers.push({ step: t.step, screen: after.screen })
      if (mode === 'wrong') {
        if (after.view?.counts?.found !== 0) fail(`${label}: a collectible was found although every answer was wrong`)
        if (after.screen === 'article' && !(await exists('clue-bar'))) fail(`${label}: after a wrong answer the clue is gone`)
      }
    }
    return answers
  }

  async function hunt(h, final = false) {
    await toTab('hunts', 'hunts')
    const testid = final ? 'hunt-final' : `hunt-${h.id}`
    const label = final ? 'the grand hunt' : `hunt ${h.id}`
    const button = page.locator(tid(testid))
    if ((await button.isDisabled()) || (await button.getAttribute('data-locked')) === 'true') throw new Error(`${label} is locked`)
    await shot(final ? 'hunts-final' : 'hunts')
    await overflowCheck('hunts')
    await press(testid)
    await waitScreen('explore', testid)
    if (opts.keyboard) await focusInMain(testid)
    const st = await state()
    if (!st.view?.hunt || st.view.hunt.final !== final) fail(`${label}: the published hunt is ${JSON.stringify(st.view?.hunt)}`)
    if (!(await exists('clue-bar'))) fail(`${label}: no clue bar on the explore screen`)
    stats.hunts++
    const answers = await playRun(label, opts.mode === 'wrong' ? 'wrong' : 'any')
    await waitScreen('hunts', `the end of ${label}`)
    await overflowCheck('hunts (result)')
    if (!(await exists('hunt-result'))) fail(`${label}: no hunt-result after the run`)
    else {
      await shot('hunt-result')
      const r = await page.locator(tid('hunt-result')).evaluate((el) => ({ stars: Number(el.dataset.stars), total: Number(el.dataset.total), got: Number(el.dataset.collected), final: el.dataset.final === 'true' }))
      if (!final) {
        const unitStars = (await state()).mastery[h.unit] ?? 0
        // the best run counts: a weaker replay never takes a star away
        if (unitStars < r.stars) fail(`${label}: the result says ${r.stars} star(s), the unit has only ${unitStars}`)
      }
      if (opts.mode === 'perfect' && (r.stars !== 3 || r.got !== r.total)) fail(`${label}: a perfect hunt earned ${r.stars} star(s) and ${r.got}/${r.total} collectibles`)
      if (opts.mode === 'wrong' && (r.stars !== 0 || r.got !== 0)) fail(`${label}: an all-wrong hunt earned ${r.stars} star(s) and ${r.got} collectible(s)`)
      if (r.final !== final) fail(`${label}: the result says final=${r.final}`)
    }
    return answers
  }

  // ---------------------------------------------------------------- the run

  // Mouse runs of wrong and random wait for each page turn (Playwright clicks only a settled element), so they run with
  // prefers-reduced-motion: reduce: it also proves that the book plays without any motion. Perfect and keyboard runs keep the page turn.
  const reduced = !opts.keyboard && opts.mode !== 'perfect'
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' })
  stats.reducedMotion = reduced
  const readerFirst = pack.shells?.config?.encyclopedia?.reader === true
  await bot.pressAndWait('start', 'start', readerFirst ? 'reader' : 'explore')
  if (readerFirst) {
    if (opts.keyboard) await focusInMain('start')
    await readerWalk()
    await press('nav-index')
    await waitScreen('explore', 'nav-index')
  }
  {
    const anim = await page.evaluate(() => {
      const el = document.querySelector('.enc-page > :not(.enc-tabs):not(.enc-clue)')
      return el ? getComputedStyle(el).animationName : null
    })
    if (reduced && anim !== 'none') fail(`prefers-reduced-motion: the page still animates (${anim})`)
    if (!reduced && anim !== 'edu-enter-page') fail(`the page does not turn: the content animates "${anim}", expected edu-enter-page`)
  }
  await shot('explore')
  await overflowCheck('explore')
  if (opts.keyboard) await focusInMain('start')
  for (const id of ['search', 'nav-index', 'nav-hunts', 'nav-codex', 'status', 'menu']) if (!(await exists(id))) fail(`the explore screen has no ${id}`)
  if ((await page.locator('h1').count()) !== 1) fail(`the explore screen has ${await page.locator('h1').count()} h1 elements`)

  const allArticles = await shellDebug('articles')
  for (const id of allArticles) if (!(await exists(`article-${id}`))) fail(`the index has no article-${id}`)
  await searchNothing()

  // reading is free: the article of a locked chapter opens although the chapter's hunt is locked
  {
    const hs = await shellDebug('hunts')
    const lockedHunt = hs.find((x) => !x.open && x.steps.length > 0)
    if (lockedHunt) {
      const art = pack.encyclopedia.articles.find((a) => a.unit === lockedHunt.unit)?.id ?? lockedHunt.steps[0].article
      await openArticle(art, 'index')
      stats.locked++
      await press('back')
      await waitScreen('explore', 'back to the index')
    }
  }

  await visitTimeline()
  await visitMap()
  {
    const c0 = await visitCodex('start')
    if (c0.found !== 0) fail(`the codex starts with ${c0.found} collectible(s)`)
  }

  if (opts.mode === 'wrong') {
    for (let r = 0; r < opts.rounds; r++) {
      for (const h of await shellDebug('hunts')) {
        const fresh = (await shellDebug('hunts')).find((x) => x.id === h.id)
        if (!fresh.open || fresh.steps.length === 0) continue
        const answers = await hunt(fresh)
        // a missed clue comes back: more answers than steps
        if (answers.length <= fresh.steps.length) fail(`hunt ${h.id}: ${answers.length} answers for ${fresh.steps.length} steps, a missed clue did not come back`)
        if (!(await exists(`hunt-${h.id}`)) || (await page.locator(tid(`hunt-${h.id}`)).isDisabled())) fail(`hunt ${h.id}: it cannot be played again after a failed run (a dead end)`)
      }
    }
    const st = await state()
    if (st.reviewQueue.length === 0) fail('the review queue is empty after answering everything wrong')
    const hs = await shellDebug('hunts')
    for (const x of hs) if (x.stars !== 0) fail(`hunt ${x.id}: ${x.stars} star(s) after answering everything wrong`)
    const locked = hs.filter((x) => !x.open)
    for (const x of locked) {
      const el = page.locator(tid(`hunt-${x.id}`))
      if (!(await el.isDisabled()) || (await el.getAttribute('data-locked')) !== 'true') fail(`hunt ${x.id} is not locked although its chapter is not open`)
    }
    if (locked.length === 0 && hs.length > 1) fail('every chapter is open although none was mastered')
    await toTab('hunts', 'hunts')
    if (await exists('finish')) fail('finish is offered although no hunt was won')
    if ((await shellDebug('finalHunt')).open) fail('the grand hunt is open although no unit was mastered')
    if (await exists('hunt-final')) {
      if (!(await page.locator(tid('hunt-final')).isDisabled())) fail('the grand hunt can be started although no unit was mastered')
      await shot('hunts-final')
    }
    const c1 = await visitCodex('wrong')
    if (c1.found !== 0) fail(`the codex holds ${c1.found} collectible(s) after answering everything wrong`)
    return
  }

  // perfect and random: every unit, in prerequisite order, then the grand hunt
  const goal = opts.mode === 'perfect' ? 3 : 2
  let tries = 0
  for (let guard = 0; guard < 120; guard++) {
    const hs = await shellDebug('hunts')
    const next = hs.find((x) => x.open && x.steps.length > 0 && x.stars < goal)
    if (!next) {
      const stuck = hs.find((x) => x.steps.length > 0 && x.stars < goal)
      if (stuck) throw new Error(`deadlock: the hunt ${stuck.id} has ${stuck.stars} star(s) and no open hunt is left to play`)
      break
    }
    if (++tries > 40) throw new Error('the hunts were not mastered in 40 tries')
    await hunt(next)
    if (opts.mode === 'perfect') {
      const now = (await shellDebug('hunts')).find((x) => x.id === next.id)
      if (now.stars !== 3) fail(`hunt ${next.id}: ${now.stars} star(s) after perfect play`)
    }
  }
  const mid = await visitCodex('after the unit hunts')
  if (opts.mode === 'perfect') {
    const total = (await shellDebug('codex')).length
    if (mid.found !== total) fail(`the codex holds ${mid.found} of ${total} collectibles after perfect play`)
  }
  stats.collectibles = mid.found

  // the grand hunt
  const fin = await shellDebug('finalHunt')
  if (fin.steps.length > 0) {
    if (!fin.open) throw new Error('every unit is mastered but the grand hunt is not open')
    for (let t = 0; t < 30; t++) {
      await hunt({ id: 'final', unit: '' }, true)
      if (await exists('finish')) break
      if (opts.mode === 'perfect') fail('a perfect grand hunt did not offer finish')
    }
  } else {
    await toTab('hunts', 'hunts')
  }
  if (!(await exists('finish'))) throw new Error('the hunts are done but finish is not offered')
  await shot('hunts-done')
  const prev = await state()
  await press('finish')
  await waitChange(prev, 'finish')
  await waitScreen('end', 'finish')
  await shot('end')
  await overflowCheck('end')
  for (const id of ['end-title', 'end-collected', 'play-again', 'to-title']) if (!(await exists(id))) fail(`the end screen has no ${id}`)
  const st = await state()
  if (!st.finished) fail('the end screen is shown but the game is not marked finished')
  if (opts.mode === 'perfect') {
    for (const u of pack.units) if (st.mastery[u.id] !== 3) fail(`unit ${u.id} has ${st.mastery[u.id]} stars at the end`)
    if (st.reviewQueue.length > 0) fail(`the review queue is not empty at the end: ${st.reviewQueue.join(', ')}`)
  }
}
