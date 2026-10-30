/**
 * The driver of the detective shell (EGS-14): the case board (`office`), the case file (`case`: clue cards turned by answering course
 * items, the deduction grid, a hint, the accusation), `case-solved`, the chase (`chase`: the witness's clue item, `travel-<placeId>`),
 * `caught`, and `end`. It reads the shell's debug helpers `solution()` (the open case's answer: the accusation buttons and the grid cells
 * that are "yes") and `route()` (the next place of the chase); everything else goes through test ids and `getState().view`.
 *
 *   perfect  every room of the board in order (a room opens only when its unit is mastered): the accusation is first tried too early
 *            (clue cards still face-down: refused, the case stays open), every clue card is turned with a right answer (`clue-<n>`, context
 *            `clue`: the card shows its sentence and the fact from the answer), one hint is asked, the grid is marked from `solution()`, a wrong
 *            accusation is refused with a message (never a dead end), then the right one: `case-solved`, 3 stars, the door opens. Then the
 *            final room, then the chase (when the course has one): the first leg tries a decoy first (a cold trail: an hour on the clock
 *            and back at the last place), every witness question is answered right, the suspect is `caught`; then `finish` and `end`.
 *   wrong    every clue answer wrong: the cards stay face-down (a missed card comes back), the review queue fills, an accusation is refused
 *            (the evidence is incomplete) and the case stays open; the learner leaves the case, the next door is still locked. The chase and
 *            the final room are behind mastery, so wrong mode never reaches them and never finishes the course.
 *   random   a seeded learner who answers right with probability --accuracy: a case solved with fewer than 2 stars is played again (the
 *            next doors stay locked until 2 stars), the chase is followed with a decoy first now and then; must reach `end` within maxSteps.
 */

const sectionOf = (pack) => pack.shells?.config?.detective ?? { rooms: [] }

export function maxSteps({ pack, factor }) {
  const sec = sectionOf(pack)
  const clues = sec.rooms.reduce((n, r) => n + (r.case?.items?.length ?? 0), 0) + (sec.chase?.route?.length ?? 0)
  return Math.ceil(8 * clues * factor) + 60
}

export async function play(bot) {
  const { opts, fail, state, exists, press, pressAndWait, openQuestion, answerCurrent, shellDebug, shot, overflowCheck, screens, summary, page, tid, rng } = bot
  const sec = sectionOf(bot.pack)
  const info = { rooms: [], cards: 0, cardsRight: 0, hints: 0, wrongAccusations: 0, refusedEarly: 0, cold: 0, legs: 0, caught: false, replays: 0 }
  summary.detective = info

  const view = async () => (await state()).view ?? {}
  const expectScreen = async (screen, what) => {
    const s = await state()
    screens.add(s.screen)
    if (s.screen !== screen) throw new Error(`${what}: expected the screen "${screen}", got "${s.screen}"`)
    return s
  }
  const text = async (id) => (await page.locator(tid(id)).first().innerText()).trim()
  const attr = (id, name) => page.locator(tid(id)).first().getAttribute(name)

  // ------------------------------------------------------------ the case board

  async function officeChecks() {
    await expectScreen('office', 'the case board')
    const v = await view()
    if (!Array.isArray(v.rooms) || v.rooms.length === 0) fail('the case board lists no room')
    for (const r of v.rooms) {
      if (!(await exists(`room-${r.id}`))) fail(`the case board has no room-${r.id}`)
      else if (r.locked && (await attr(`room-${r.id}`, 'disabled')) === null) fail(`room-${r.id} is locked but not disabled`)
    }
    await shot('office')
    await overflowCheck('office')
    return v
  }

  // ------------------------------------------------------------ one case

  /** Presses the accusation too early: the case must stay open and say why. */
  async function accuseTooEarly(room) {
    await press('accuse-submit')
    const v = await view()
    await expectScreen('case', `${room}: accusing before every card is turned`)
    if (!(await exists('accuse-message'))) fail(`${room}: the early accusation gave no message`)
    else if (!(await page.locator(tid('accuse-message')).isVisible())) fail(`${room}: the early accusation's message is hidden`)
    else if ((await text('accuse-message')).length < 5) fail(`${room}: the early accusation's message is empty`)
    if (v.solved) fail(`${room}: the case was solved with face-down cards`)
    info.refusedEarly++
  }

  /** Turns the face-down cards one after the other by answering the clue questions; `limit` stops after that many questions. */
  async function turnCards(room, limit) {
    let asked = 0
    for (let guard = 0; guard < 200; guard++) {
      const v = await view()
      const down = (v.clues ?? []).filter((c) => c.state === 'down')
      if (down.length === 0) return asked
      if (limit !== undefined && asked >= limit) return asked
      const n = down[0].n
      if (!(await exists(`clue-${n}`)) || (await attr(`clue-${n}`, 'data-state')) === 'up') fail(`${room}: clue card ${n} is face-down in the state but has no turn button`)
      const s = await openQuestion(`clue-${n}`, `clue card ${n} of ${room}`)
      screens.add(s.screen)
      if (s.context !== 'clue') fail(`${room}: the question of clue card ${n} has the context "${s.context}", expected "clue"`)
      const right0 = summary.correct
      await answerCurrent(s)
      asked++
      info.cards++
      const after = await state()
      screens.add(after.screen)
      if (after.screen !== 'case') throw new Error(`${room}: after the clue question the game shows "${after.screen}", expected "case"`)
      const turned = summary.correct > right0
      const card = after.view.clues[n - 1]
      if (turned) {
        info.cardsRight++
        if (card.state !== 'up') fail(`${room}: clue card ${n} did not turn face-up after a right answer`)
        else if ((await attr(`clue-${n}`, 'data-state')) !== 'up') fail(`${room}: clue-${n} is not drawn face-up`)
        else if ((await page.locator(`${tid(`clue-${n}`)} .det-clue-text`).innerText()).trim().length < 5) fail(`${room}: clue card ${n} shows no clue sentence`)
        if (opts.keyboard && (await bot.focusedId()) !== `clue-${n}`) fail(`${room}: keyboard: the focus is not on the turned card clue-${n}`)
      } else if (card.state !== 'down') fail(`${room}: clue card ${n} turned although the answer was wrong`)
      else if ((await attr(`clue-${n}`, 'data-state')) === 'up') fail(`${room}: clue-${n} is drawn face-up after a wrong answer`)
    }
    throw new Error(`${room}: the clue cards were not all turned within the guard`)
  }

  /** Marks every "yes" cell of the solution (two presses: unknown -> no -> yes). */
  async function markGrid(room, sol) {
    for (const cell of sol.cells) {
      await press(cell)
      await press(cell)
      if ((await attr(cell, 'data-mark')) !== 'yes') fail(`${room}: ${cell} is not "yes" after two presses`)
    }
    const v = await view()
    if (v.yes !== sol.yes.length) fail(`${room}: the grid has ${v.yes} yes marks, the solution has ${sol.yes.length}`)
    // the red strings of the cork board (drawn after the next frame)
    try {
      await page.waitForFunction((n) => document.querySelectorAll('[data-testid^="string-"]').length === n, sol.yes.length, { timeout: 4000 })
    } catch {
      fail(`${room}: the cork board does not show ${sol.yes.length} red strings`)
    }
  }

  /** Murdle: picks the accusation. `wrongFirst` swaps the first category's pick for another entity. */
  async function pickAccusation(sol, wrongFirst) {
    for (let i = 0; i < sol.accuse.length; i++) {
      let id = sol.accuse[i]
      if (wrongFirst && i === 0) {
        const cat = id.split('-')[1]
        const all = await page.$$eval(`[data-testid^="accuse-${cat}-"]`, (els) => els.map((e) => e.getAttribute('data-testid')))
        id = all.find((x) => x !== id) ?? id
      }
      await press(id)
    }
  }

  async function solveRoom(roomView) {
    const id = roomView.id
    const room = `room ${id}`
    await pressAndWait(`room-${id}`, `opening ${room}`, 'case')
    screens.add('case')
    let v = await view()
    const total = v.total
    if (!(await exists('case-title')) || !(await exists('case-story'))) fail(`${room}: the case file has no title or story`)
    if (v.turned !== 0) fail(`${room}: a new case opens with ${v.turned} cards turned`)
    const sol = await shellDebug('solution')
    if (!sol || sol.room !== id) throw new Error(`${room}: solution() did not describe the open case`)
    if (v.kind === 'murdle' && !(await exists('case-crime'))) fail(`${room}: a murdle case shows no crime line`)
    await shot(`case-down-${v.kind}`, `case-facedown-${v.kind}`)
    await overflowCheck(`${room} (case)`)

    // refused while the evidence is incomplete (perfect and wrong: the first case; wrong: the rest of the run stays here)
    if (opts.mode !== 'random' || info.rooms.length === 0) await accuseTooEarly(room)

    if (opts.mode === 'wrong') {
      const asked = await turnCards(room, Math.min(total, 4))
      v = await view()
      if (v.turned !== 0) fail(`${room}: ${v.turned} cards turned although every answer was wrong`)
      const st = await state()
      if (st.reviewQueue.length === 0) fail(`${room}: the review queue is empty after ${asked} wrong clue answers`)
      await shot('case-stuck', 'case-facedown-after-wrong')
      await accuseTooEarly(room)
      info.rooms.push({ id, asked, turned: v.turned })
      await pressAndWait('to-office', `leaving ${room}`, 'office')
      return
    }

    await turnCards(room, undefined)
    v = await view()
    if (v.turned !== total) fail(`${room}: ${v.turned} of ${total} cards turned at the end`)
    await shot(`case-turned-${v.kind}`, `case-cards-turned-${v.kind}`)

    if (opts.mode === 'perfect' || info.hints === 0) {
      await press('hint')
      info.hints++
      if (!(await page.locator(tid('hint-text')).isVisible()) || (await text('hint-text')).length < 8) fail(`${room}: the hint shows no text`)
      if ((await view()).hints < 1) fail(`${room}: the hint was not counted`)
    }
    await markGrid(room, sol)
    await shot(`case-marked-${v.kind}`, `case-grid-marked-${v.kind}`)

    // a wrong accusation never closes the case
    const wrongBefore = (await view()).wrongAccusations
    if (v.kind === 'murdle') {
      await pickAccusation(sol, true)
      await press('accuse-submit')
      await expectScreen('case', `${room}: a wrong accusation`)
      if ((await view()).wrongAccusations !== wrongBefore + 1) fail(`${room}: the wrong accusation was not counted`)
      if (!(await page.locator(tid('accuse-message')).isVisible())) fail(`${room}: the wrong accusation gave no message`)
      info.wrongAccusations++
      await shot('case-refused', 'case-wrong-accusation')
      // the right one for the first category (the others stay picked)
      await press(sol.accuse[0])
    } else {
      // a logic grid: take one yes mark back and check, then put it back
      const cell = sol.cells[0]
      await press(cell)
      await press('accuse-submit')
      await expectScreen('case', `${room}: an incomplete grid`)
      if ((await view()).wrongAccusations !== wrongBefore + 1) fail(`${room}: the wrong grid was not counted`)
      info.wrongAccusations++
      await press(cell)
      await press(cell)
      if ((await attr(cell, 'data-mark')) !== 'yes') fail(`${room}: ${cell} is not "yes" again`)
    }
    await pressAndWait('accuse-submit', `the right accusation of ${room}`, 'case-solved')
    await caseSolvedChecks(room, roomView)
    await pressAndWait('to-office', `leaving ${room}`, 'office')
  }

  async function caseSolvedChecks(room, roomView) {
    const v = await view()
    for (const t of ['solved-title', 'case-stars', 'case-accuracy', 'door-open', 'solved-facts', 'to-office']) if (!(await exists(t))) fail(`${room}: the solved screen has no ${t}`)
    const stars = Number(await attr('case-stars', 'data-stars'))
    if (opts.mode === 'perfect' && stars !== 3) fail(`${room}: perfect play earned ${stars} stars, expected 3`)
    if (v.stars !== stars) fail(`${room}: the view says ${v.stars} stars, the screen ${stars}`)
    await shot('case-solved')
    await overflowCheck(`${room} (solved)`)
    info.rooms.push({ id: roomView.id, stars, hints: v.hints, wrong: v.wrongAccusations })
  }

  // ------------------------------------------------------------ the chase

  async function chase() {
    await pressAndWait('chase-start', 'starting the chase', 'chase')
    screens.add('chase')
    const ch = sec.chase
    let legs = 0
    for (let guard = 0; guard < 40; guard++) {
      const s = await state()
      screens.add(s.screen)
      if (s.screen === 'caught') break
      if (s.screen !== 'chase') throw new Error(`the chase shows "${s.screen}"`)
      let v = s.view
      if (v.phase === 'witness') {
        for (const t of ['map', 'clock', 'ask-witness', 'chase-here']) if (!(await exists(t))) fail(`the chase has no ${t}`)
        await shot(legs === 0 ? 'chase' : 'chase-next')
        await overflowCheck('chase')
        const q = await openQuestion('ask-witness', 'the witness')
        screens.add(q.screen)
        if (q.context !== 'clue') fail(`the witness question has the context "${q.context}", expected "clue"`)
        await answerCurrent(q)
        await expectScreen('chase', 'after the witness question')
        v = await view()
        if (v.phase !== 'travel') fail(`the witness did not speak (phase "${v.phase}")`)
        if (!(await exists('witness-line')) || (await text('witness-line')).length < 8) fail('the witness line is missing')
      }
      const route = await shellDebug('route')
      if (!route || !route.travel) throw new Error('route() names no next place')
      if (route.phase !== 'travel') fail(`route() says the phase is "${route.phase}", the screen shows the travel choices`)
      const options = (await view()).options
      if (!options.includes(route.next)) fail(`the travel choices ${options.join(', ')} do not include ${route.next}`)
      if (options.length < 2 || options.length > 4) fail(`the chase offers ${options.length} places, expected 2 to 4`)
      await shot('chase-travel')
      // a decoy first: a cold trail costs an hour and leaves her where she was (perfect: the first leg; random: now and then)
      if ((opts.mode === 'perfect' && legs === 0) || (opts.mode === 'random' && rng() < 0.3)) {
        const decoy = route.decoys[0]
        const before = await view()
        await press(`travel-${decoy}`)
        if (opts.keyboard) await bot.focusInMain('a cold trail')
        const after = await view()
        if (after.at !== before.at) fail(`a cold trail moved the learner from ${before.at} to ${after.at}`)
        if (after.hours !== before.hours + 1) fail(`a cold trail cost ${after.hours - before.hours} hours, expected 1`)
        if (!(await exists('chase-notice')) || (await attr('chase-notice', 'data-kind')) !== 'cold') fail('a cold trail showed no cold notice')
        if ((await attr(`travel-${decoy}`, 'disabled')) === null) fail(`the decoy ${decoy} can still be chosen after a cold trail`)
        await shot('chase-cold', 'chase-cold-trail')
        info.cold++
      }
      const hours = (await view()).hours
      await press(route.travel)
      const next = await state()
      screens.add(next.screen)
      if (next.screen === 'chase') {
        if (next.view.at !== route.next) fail(`travelling to ${route.next} left her trail at ${next.view.at}`)
        if (next.view.hours !== hours + 2) fail(`a warm trail cost ${next.view.hours - hours} hours, expected 2`)
      }
      legs++
      info.legs = legs
      if (legs > (ch?.route?.length ?? 40) + 2) throw new Error('the chase did not end within the number of legs of the route')
    }
    await expectScreen('caught', 'the end of the chase')
    for (const t of ['caught-title', 'caught-text', 'chase-stars', 'caught-trail', 'to-office']) if (!(await exists(t))) fail(`the caught screen has no ${t}`)
    const cv = await view()
    if (!Array.isArray(cv.trail) || cv.trail.length !== (ch?.route?.length ?? 0) + 1) fail(`the trail has ${cv.trail?.length} places, expected ${(ch?.route?.length ?? 0) + 1}`)
    await shot('caught')
    await overflowCheck('caught')
    info.caught = true
    info.chaseStars = cv.stars
    await pressAndWait('to-office', 'leaving the chase', 'office')
  }

  // ------------------------------------------------------------ the whole file

  await pressAndWait('start', 'start', 'office')
  let office = await officeChecks()

  if (opts.mode === 'wrong') {
    const first = office.rooms.find((r) => !r.locked)
    if (!first) throw new Error('no room is open at the start')
    await solveRoom(first)
    office = await view()
    const locked = office.rooms.filter((r) => r.locked).length
    if (locked === 0 && office.rooms.length > 1) fail('every door is open after a case that was never solved')
    if (office.done) fail('the file can be closed although nothing was solved')
    if (!(await exists('finish-hint'))) fail('the case board does not say how to close the file')
    return
  }

  let chased = false
  for (let guard = 0; guard < 60; guard++) {
    const v = await view()
    await expectScreen('office', 'the case board')
    const pending = v.rooms.find((r) => !r.locked && !(r.solved && (r.final ? r.stars >= 1 : r.stars >= 2)) && (opts.mode === 'random' || !r.solved))
    if (pending) {
      if (pending.solved) info.replays++
      await solveRoom(pending)
      continue
    }
    if (v.chase && v.chase.open && (!chased || (!v.done && !v.rooms.some((r) => !r.locked && !r.solved)))) {
      await chase()
      chased = true
      continue
    }
    if (v.done && (!v.chase || chased || !v.chase.open)) break
    if (opts.mode === 'perfect') throw new Error('the case board has nothing left to play but the file cannot be closed yet')
  }

  const v = await view()
  if (!v.done) throw new Error('the case board never offered to close the file')
  if (!(await exists('finish'))) fail('the file is done but there is no finish button')
  await shot('office-done', 'office-all-open')
  await pressAndWait('finish', 'closing the file', 'end')
  await expectScreen('end', 'the end')
  for (const t of ['end-title', 'end-rooms', 'play-again', 'to-title']) if (!(await exists(t))) fail(`the end screen has no ${t}`)
  await shot('end')
  await overflowCheck('end')
  if (sec.chase && opts.mode === 'perfect' && !info.caught) fail('the chase was never followed')
}
