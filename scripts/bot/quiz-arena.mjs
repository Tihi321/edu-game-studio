/**
 * The quiz arena's driver for the autoplay bot (scripts/play.mjs): title -> map -> rounds -> summary -> boss -> end.
 *
 *   perfect  every item right; every unit played in prerequisite order to 3 stars, then the boss, then the end screen; nothing is ever
 *            wrong and the review queue stays empty.
 *   wrong    every item wrong; one round per open unit (--rounds N), each summary lists the misses and earns no star, the review queue
 *            fills and the review screen lists it (the boss never opens, the game cannot finish).
 *   random   a seeded learner (--accuracy) plays units to mastery and beats the boss within maxSteps.
 */

/** maxSteps = ceil(6 * (units * roundLength + bossLength) * factor), from the pack's quiz-arena config (defaults 7 and 10). */
export function maxSteps({ pack, factor }) {
  const arena = pack.shells?.config?.['quiz-arena'] ?? {}
  const roundLength = arena.roundLength ?? 7
  const bossLength = arena.bossLength ?? 10
  return Math.ceil(6 * (pack.units.length * roundLength + bossLength) * factor)
}

export async function play(bot) {
  const { page, opts, pack, tid, fail, state, exists, press, activate, waitChange, waitScreen, shot, overflowCheck, answerWhileItem, openQuestion } = bot
  const screens = bot.screens

  /** Summary screen: screenshot and light checks, then back to the map. */
  async function leaveSummary(label, roundKind) {
    await shot(`summary-${roundKind}`, `summary-${roundKind}`)
    await overflowCheck(`summary of ${label}`)
    const prev = await state()
    await press('to-map')
    await waitChange(prev, `to-map after ${label}`)
    await waitScreen('map', 'to-map')
  }

  /** Plays the round on screen to its summary. */
  async function playRound(label) {
    const s = await answerWhileItem(`round ${label}`)
    if (s.screen !== 'summary') throw new Error(`unexpected screen "${s.screen}" in round ${label}`)
    return s
  }

  const startRound = (testid, label) => openQuestion(testid, label)
  const unitOpen = async (id) => !(await page.locator(tid(`unit-${id}`)).isDisabled()) && (await page.locator(tid(`unit-${id}`)).getAttribute('data-locked')) !== 'true'

  let st = await state()
  {
    const prev = st
    await press('start')
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
      await press('review')
      await waitChange(prev, 'review')
      await waitScreen('review', 'review')
      await shot('review')
      await overflowCheck('review')
      for (const id of st.reviewQueue) if (!(await exists(`review-item-${id}`))) fail(`the review screen does not list ${id}`)
      if (!(await exists('practice'))) fail('the review screen has no practice button')
      const p2 = await state()
      if (opts.keyboard) await activate('to-map')
      else await page.locator(tid('to-map')).last().click() // the review screen has a small back button and a big one
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
        await press('finish')
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
        await press('finish')
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
}
