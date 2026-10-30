/**
 * The RPG quest's driver for the autoplay bot (scripts/play.mjs, shell `rpg`): title -> intro -> areas -> world (walk, talk) -> dialogue ->
 * battle (every turn an `ask()`) -> quest-done -> gate -> ... -> the final boss -> outro -> end. It walks the world through the
 * `data-testid`s (`goto-*`, `talk`, `move-*`, the arrow keys) and the read-only helpers `EduEngine.debug.shell.nextGoal()` (who or what the
 * quest asks for next, with its `goto-` id and whether the hero already stands next to it) and `.pathTo(id)`; it answers every question
 * with the shared `answerCurrent`, so the item widgets and the explanatory feedback are checked exactly as in the quiz arena.
 *
 *   perfect  every area in order: a few steps by the arrow keys (--keyboard) or the on-screen pad, the first foe tried before the quest is
 *            taken (it must refuse), then the giver, the quest, every foe, the area boss, all with right answers (3 stars), the gate; the
 *            scrolls (the facts learned) are listed; then the final boss, the outro, `end`. Nothing is ever wrong, the review queue stays
 *            empty. With --keyboard the focus is checked after every screen change and no mouse is used.
 *   wrong    every answer wrong: the hero's HP falls with each answer and the streak stays at 0, the hero faints and wakes up at the inn
 *            (HP full again, back at the start, the quest still taken, the foe still there and at full strength: no dead end), --rounds N
 *            times; no star is earned, the review queue fills, the final boss stays shut and the scrolls stay empty.
 *   random   a seeded learner (--accuracy): plays every area until it is mastered (2 stars; a quest that fell short is replayed), skips the
 *            story, faints and recovers, beats the final boss within maxSteps.
 *
 * Axe runs on every distinct screen (title, intro, areas, world, dialogue, battle, the question, the feedback, scrolls, quest-done, the
 * final boss, the outro, end).
 */

/** maxSteps = ceil(10 * (items + 12 per unit + the final boss) * factor): about ten answers per area and a few retries are expected, the rest is room for a weak learner. */
export function maxSteps({ pack, factor }) {
  return Math.ceil(10 * (pack.items.length + pack.units.length * 12 + 12) * factor) + 40
}

export async function play(bot) {
  const { page, opts, fail, state, exists, press, answerCurrent, shot, overflowCheck, focusInMain, shellDebug, screens, summary } = bot
  const target = opts.mode === 'perfect' ? 3 : 2
  const stats = { areas: 0, battles: 0, foes: 0, bosses: 0, faints: 0, replays: 0, steps: 0, dialogues: 0, gateChecks: 0, scrolls: 0 }
  summary.rpg = stats

  /** Polls the published state until `pred` holds; a stuck screen is a failure with a message. */
  async function until(pred, what, ms = 15000) {
    const t0 = Date.now()
    for (;;) {
      const s = await state()
      screens.add(s.screen)
      if (pred(s)) return s
      if (Date.now() - t0 > ms) throw new Error(`stuck: ${what} (screen ${s.screen}, event ${s.view?.event ?? '-'}, walking ${s.view?.walking ?? '-'})`)
      await page.waitForTimeout(40)
    }
  }

  /** Presses a control and waits for the screen to be `screen`; with --keyboard the focus must be inside the game afterwards. */
  async function go(testid, screen, what = testid) {
    await press(testid)
    const s = await until((x) => x.screen === screen, `${what} did not lead to "${screen}"`)
    if (opts.keyboard) await focusInMain(what)
    return s
  }

  /** The world state; a step that bumped into the quest giver opened the dialogue: read it and leave, so the walk goes on. */
  async function worldState() {
    const s = await state()
    if (s.screen !== 'dialogue') return s
    await dialogue('dialogue-bye')
    return state()
  }

  /** The first steps: the arrow keys with --keyboard, the on-screen pad otherwise; the hero must move at least once. */
  async function firstSteps(areaId) {
    let moved = 0
    for (const dir of ['right', 'down', 'up', 'left']) {
      const before = (await worldState()).view.pos
      if (opts.keyboard) await page.keyboard.press(dir === 'right' ? 'ArrowRight' : dir === 'down' ? 'ArrowDown' : dir === 'up' ? 'ArrowUp' : 'ArrowLeft')
      else await press(`move-${dir}`)
      await page.waitForTimeout(60)
      const after = (await worldState()).view.pos
      if (after[0] !== before[0] || after[1] !== before[1]) {
        moved++
        stats.steps++
        if (moved >= 2) break
      }
    }
    if (moved === 0) fail(`area ${areaId}: the hero did not move by the ${opts.keyboard ? 'arrow keys' : 'pad'}`)
    // WASD walks too (keyboard play only: it is the same handler)
    if (opts.keyboard) {
      const before = (await worldState()).view.pos
      for (const k of ['d', 'a', 's', 'w']) {
        await page.keyboard.press(k)
        await page.waitForTimeout(40)
      }
      const after = (await worldState()).view.pos
      stats.steps += Math.abs(after[0] - before[0]) + Math.abs(after[1] - before[1])
    }
  }

  /** Walks to the goal with its `goto-` button and checks that the hero arrived next to it. */
  async function gotoGoal(goal) {
    if (goal.adjacent) return
    const found = await shellDebug('pathTo', goal.testid)
    if (!found.found) fail(`pathTo(${goal.testid}) finds no path`)
    await press(goal.testid)
    const s = await until((x) => x.screen !== 'world' || (x.view.walking === false && (x.view.event === 'arrived' || x.view.event === 'noway')), `walking to ${goal.testid}`)
    if (s.screen !== 'world') return s
    if (s.view.event === 'noway') fail(`the way to ${goal.testid} is not found by the game although pathTo says ${found.steps} steps`)
    stats.steps += found.steps
    if (goal.kind !== 'gate' && !s.view.nearby.includes(goal.id)) fail(`the hero walked to ${goal.testid} but ${goal.id} is not next to them (nearby: ${s.view.nearby.join(', ')})`)
    return s
  }

  // ---- the story ----

  async function story(kind, skip) {
    for (let guard = 0; guard < 20; guard++) {
      const s = await state()
      if (s.screen !== kind) return s
      await shot(kind)
      await overflowCheck(kind)
      const page0 = s.view.page
      const last = s.view.last
      const id = skip && !last && (await exists('story-skip')) ? 'story-skip' : 'story-next'
      await press(id)
      await until((x) => x.screen !== kind || x.view.page !== page0, `${id} on the ${kind}`)
      if (opts.keyboard) await focusInMain(id)
    }
    throw new Error(`the ${kind} did not end`)
  }

  // ---- talking ----

  /** Reads the dialogue to its end and takes what the last page offers. `want`: accept-quest | replay-quest | dialogue-bye. */
  async function dialogue(want) {
    stats.dialogues++
    await shot('dialogue')
    await overflowCheck('dialogue')
    for (let guard = 0; guard < 12; guard++) {
      const s = await state()
      if (s.screen !== 'dialogue') throw new Error(`expected the dialogue, got "${s.screen}"`)
      if (s.view.last) break
      await press('dialogue-next')
      await until((x) => x.screen !== 'dialogue' || x.view.line !== s.view.line, 'dialogue-next')
    }
    const s = await state()
    if (!s.view.last) throw new Error('the dialogue never reached its last line')
    const id = (await exists(want)) ? want : 'dialogue-bye'
    return go(id, 'world', id)
  }

  /** The giver: talk, read, accept; the quest is taken afterwards. */
  async function takeQuest(areaId) {
    let s = await state()
    if (s.view.accepted) return
    const goal = await shellDebug('nextGoal')
    if (goal.kind !== 'giver') fail(`area ${areaId}: before the quest the next goal is "${goal.kind}", not the giver`)
    await gotoGoal(goal)
    await press('talk')
    s = await until((x) => x.screen === 'dialogue', 'talk to the giver')
    if (opts.keyboard) await focusInMain('talk')
    if (s.view.giver !== true || s.view.offer !== true) fail(`area ${areaId}: the giver does not offer the quest`)
    await dialogue('accept-quest')
    s = await state()
    if (!s.view.accepted) fail(`area ${areaId}: the quest is not taken after accept-quest`)
  }

  /** The quest must refuse a fight before it is taken. */
  async function refusalCheck(areaId) {
    const s = await state()
    if (s.view.accepted) return
    const foe = s.view.foesLeft[0]
    if (!foe) return
    await press(`goto-${foe}`)
    await until((x) => x.screen !== 'world' || (x.view.walking === false && x.view.event === 'arrived'), `walking to ${foe}`)
    await press('talk')
    const after = await until((x) => x.screen !== 'world' || x.view.event === 'need-giver', 'the refusal')
    if (after.screen !== 'world') fail(`area ${areaId}: a foe fought before the quest was taken`)
    stats.gateChecks++
  }

  // ---- fighting ----

  /** Plays the battle on screen (intro -> turns -> the end) and checks the numbers the game shows. */
  async function fight(areaId, foeId) {
    stats.battles++
    let s = await state()
    if (s.screen !== 'battle' && s.screen !== 'boss') throw new Error(`expected a battle, got "${s.screen}"`)
    await shot(s.screen === 'boss' ? 'boss' : 'battle')
    await overflowCheck(s.screen)
    for (const id of ['battle-scene', 'foe-hp', 'hero-hp', 'streak', 'battle-start', 'battle-flee']) if (!(await exists(id))) fail(`${s.screen}: no ${id}`)
    const intro = s.view
    if (intro.hp !== intro.maxHp && opts.mode === 'perfect') fail(`the hero starts the fight of ${foeId} with ${intro.hp} of ${intro.maxHp} HP`)
    if (opts.keyboard) await focusInMain('battle')
    await go('battle-start', 'item', 'battle-start')
    let turns = 0
    for (let guard = 0; guard < bot.maxSteps; guard++) {
      s = await state()
      screens.add(s.screen)
      if (s.screen !== 'item') break
      if (s.context !== 'battle' && s.context !== 'boss') fail(`a battle question has the context "${s.context}"`)
      const before = s.view
      await answerCurrent(s)
      turns++
      const after = await state()
      if (after.screen === 'item' && opts.mode !== 'random') {
        const a = after.view
        if (opts.mode === 'perfect') {
          if (!(a.foeHp < before.foeHp)) fail(`${foeId}: a right answer left the foe at ${a.foeHp} HP (was ${before.foeHp})`)
          if (a.hp !== before.hp) fail(`${foeId}: a right answer cost the hero HP (${before.hp} -> ${a.hp})`)
          if (a.streak !== before.streak + 1) fail(`${foeId}: the streak is ${a.streak} after a right answer (was ${before.streak})`)
        } else {
          if (!(a.hp < before.hp)) fail(`${foeId}: a wrong answer cost no HP (${before.hp} -> ${a.hp})`)
          if (a.streak !== 0) fail(`${foeId}: the streak is ${a.streak} after a wrong answer`)
          if (a.foeHp > before.foeHp) fail(`${foeId}: the foe healed after a wrong answer`)
        }
      }
    }
    s = await state()
    if (s.screen === 'item') throw new Error(`the battle with ${foeId} did not end`)
    if (opts.keyboard) await focusInMain('the end of the battle')
    screens.add(s.screen)
    return { screen: s, turns }
  }

  /** The screen after a won boss: stars, gate, and the way on (replay when the quest fell short). */
  async function questDone(areaId) {
    let s = await state()
    if (s.screen !== 'quest-done') throw new Error(`expected quest-done, got "${s.screen}"`)
    await shot('quest-done')
    await overflowCheck('quest-done')
    for (const id of ['quest-title', 'quest-stars', 'quest-accuracy', 'quest-gate', 'to-world', 'to-areas']) if (!(await exists(id))) fail(`quest-done: no ${id}`)
    const stars = s.view.stars
    if (opts.mode === 'perfect' && stars !== 3) fail(`area ${areaId}: ${stars} star(s) after perfect play`)
    if (opts.mode === 'perfect' && (await exists('replay-quest'))) fail(`area ${areaId}: a replay is offered after 3 stars`)
    if (stars >= 2 && s.view.gateOpen !== true) fail(`area ${areaId}: ${stars} stars but the gate stays shut`)
    if (stars < 2 && s.view.gateOpen === true) fail(`area ${areaId}: ${stars} star(s) but the gate is open`)
    if (stars < target) {
      if (!(await exists('replay-quest'))) fail(`area ${areaId}: ${stars} star(s) and no way to replay the quest`)
      stats.replays++
      s = await go('replay-quest', 'world', 'replay-quest')
      if (s.view.accepted !== true || s.view.foesLeft.length === 0 || s.view.bossDown) fail(`area ${areaId}: the replay did not bring the foes back (${JSON.stringify(s.view.foesLeft)})`)
      return 'replay'
    }
    await go('to-world', 'world', 'to-world')
    return 'done'
  }

  /** Plays one area from the world screen to the gate (or the end of the attempt in wrong mode). */
  async function playArea(areaId, index) {
    stats.areas++
    let s = await state()
    if (s.screen !== 'world') throw new Error(`expected the world of ${areaId}, got "${s.screen}"`)
    await shot('world')
    await overflowCheck(`world ${areaId}`)
    for (const id of ['world-canvas', 'surroundings', 'hero-hp', 'quest-log', 'inventory', 'to-areas', 'talk', 'move-up', 'move-down', 'move-left', 'move-right', 'area-name']) if (!(await exists(id))) fail(`world ${areaId}: no ${id}`)
    if (index === 0) {
      const art = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="world-canvas"]')
        if (!c) return null
        const cs = getComputedStyle(c)
        return { rendering: cs.imageRendering, width: c.width, height: c.height, live: document.querySelector('[data-testid="surroundings"]')?.getAttribute('aria-live'), text: document.querySelector('[data-testid="surroundings"]')?.textContent ?? '' }
      })
      if (!art) fail('the world has no canvas')
      else {
        if (!['pixelated', 'crisp-edges'].includes(art.rendering)) fail(`the world canvas is not crisp (image-rendering: ${art.rendering})`)
        if (art.live !== 'polite') fail('the surroundings text is not an aria-live polite region')
        if (art.text.length < 10) fail('the surroundings text is empty')
        if (art.width < 100 || art.height < 60) fail(`the world canvas is tiny (${art.width}x${art.height})`)
      }
    }
    await firstSteps(areaId)
    if (index === 0) await refusalCheck(areaId)
    await takeQuest(areaId)

    for (let guard = 0; guard < 120; guard++) {
      s = await state()
      if (s.screen === 'areas') return
      if (s.screen !== 'world') throw new Error(`expected the world, got "${s.screen}"`)
      const goal = await shellDebug('nextGoal')
      if (goal.kind === 'leave') {
        await go('to-areas', 'areas', 'to-areas')
        return
      }
      if (goal.kind === 'gate') {
        if (!s.view.gateOpen) throw new Error(`area ${areaId}: the quest is over but the gate is shut`)
        await gotoGoal(goal)
        await until((x) => x.screen === 'areas', 'the gate did not lead to the areas')
        if (opts.keyboard) await focusInMain('the gate')
        return
      }
      const reached = await gotoGoal(goal)
      if (reached && reached.screen !== 'world') throw new Error(`walking to ${goal.testid} left the world (screen "${reached.screen}")`)
      await press('talk')
      const next = await until((x) => x.screen !== 'world', `talk to ${goal.id}`)
      if (opts.keyboard) await focusInMain('talk')
      if (next.screen === 'dialogue') {
        await dialogue(next.view.replay ? 'replay-quest' : 'dialogue-bye')
        continue
      }
      const kind = goal.kind
      const r = await fight(areaId, goal.id)
      if (kind === 'foe') stats.foes++
      else stats.bosses++
      if (r.screen.screen === 'quest-done') {
        await questDone(areaId)
        continue
      }
      if (r.screen.screen !== 'world') throw new Error(`a battle ended on "${r.screen.screen}"`)
      const w = r.screen.view
      if (w.event === 'inn') {
        stats.faints++
        if (w.hp !== w.maxHp) fail(`${goal.id}: after the faint the hero has ${w.hp} of ${w.maxHp} HP`)
        if (w.accepted !== true) fail(`${goal.id}: the quest is gone after the faint`)
        if (!w.foesLeft.includes(goal.id) && kind === 'foe') fail(`${goal.id}: the foe is gone after the hero fainted`)
        if (opts.mode === 'wrong') return 'fainted'
      } else if (opts.mode === 'perfect' && !(w.event === 'won')) fail(`${goal.id}: expected a won fight, the world says "${w.event}"`)
      else if (kind === 'foe' && w.event === 'won' && w.foesDown.includes(goal.id) === false) fail(`${goal.id}: won but not counted as down`)
    }
    throw new Error(`the quest of ${areaId} did not finish within the bound`)
  }

  // ---- the run ----

  let st
  {
    await press('start')
    st = await until((x) => x.screen !== 'title', 'start')
    if (opts.keyboard) await focusInMain('start')
  }
  if (st.screen === 'intro') st = await story('intro', opts.mode === 'random')
  if (st.screen !== 'areas') st = await until((x) => x.screen === 'areas', 'the story did not lead to the areas')
  screens.add('areas')
  await shot('areas')
  await overflowCheck('areas')
  for (const id of ['areas-title', 'area-list', 'final-boss', 'inventory']) if (!(await exists(id))) fail(`areas: no ${id}`)
  if ((await page.locator('[data-testid="final-boss"]').isEnabled()) === true) fail('the final boss is open before any area is mastered')

  if (opts.mode === 'wrong') {
    const first = st.view.areas.find((a) => !a.locked)
    if (!first) throw new Error('no open area to fight in')
    const entry = await go(`area-${first.id}`, 'world', `area-${first.id}`)
    const start = entry.view.pos
    stats.areas++
    await shot('world')
    await firstSteps(first.id)
    await refusalCheck(first.id)
    await takeQuest(first.id)
    for (let round = 0; round < opts.rounds; round++) {
      const goal = await shellDebug('nextGoal')
      if (goal.kind !== 'foe') fail(`after the faint the next goal is "${goal.kind}", not a foe`)
      await gotoGoal(goal)
      await press('talk')
      await until((x) => x.screen !== 'world', `talk to ${goal.id}`)
      const r = await fight(first.id, goal.id)
      stats.foes++
      const w = r.screen.view
      if (r.screen.screen !== 'world' || w.event !== 'inn') fail(`all-wrong battle with ${goal.id} ended on "${r.screen.screen}" (${w?.event}), not at the inn`)
      else {
        stats.faints++
        if (w.hp !== w.maxHp) fail(`at the inn the hero has ${w.hp} of ${w.maxHp} HP`)
        if (w.accepted !== true) fail('the quest is gone after the faint')
        if (!w.foesLeft.includes(goal.id)) fail('the foe is gone after the faint')
        if (w.pos[0] !== start[0] || w.pos[1] !== start[1]) fail(`the hero woke at ${w.pos.join(',')}, not at the start ${start.join(',')}`)
        if (w.foesDown.length > 0 || w.bossDown) fail('a foe fell although every answer was wrong')
      }
    }
    await shot('inn-world')
    st = await state()
    if (st.reviewQueue.length === 0) fail('the review queue is empty after answering everything wrong')
    for (const [id, stars] of Object.entries(st.mastery)) if (stars !== 0) fail(`unit ${id} has ${stars} star(s) after answering everything wrong`)
    // the scrolls stay empty, the final boss stays shut, the units that need a mastered one stay locked
    await go('inventory', 'inventory', 'inventory')
    await shot('inventory')
    if ((await state()).view.scrolls.length !== 0) fail('a scroll was found although every answer was wrong')
    await go('inventory-back', 'world', 'inventory-back')
    await go('to-areas', 'areas', 'to-areas')
    if (await page.locator('[data-testid="final-boss"]').isEnabled()) fail('the final boss is open although no area was mastered')
    return
  }

  // perfect and random: every area in order, then the final boss
  let allDone = false
  for (let guard = 0; guard < 80 && !allDone; guard++) {
    st = await state()
    if (st.screen !== 'areas') throw new Error(`expected the areas, got "${st.screen}"`)
    const next = st.view.areas.find((a) => !a.locked && a.stars < target)
    if (next) {
      await go(`area-${next.id}`, 'world', `area-${next.id}`)
      await playArea(next.id, st.view.areas.indexOf(next))
      continue
    }
    const stuck = st.view.areas.find((a) => a.stars < target)
    if (stuck) throw new Error(`deadlock: the area ${stuck.id} has ${stuck.stars} star(s) and no open area is left`)
    allDone = true
  }
  if (!allDone) throw new Error('the areas were not finished within the guard')

  // the scrolls: every fact learned is listed
  st = await state()
  {
    await go('inventory', 'inventory', 'inventory')
    await shot('inventory')
    await overflowCheck('inventory')
    const inv = (await state()).view.scrolls
    stats.scrolls = inv.length
    if (inv.length === 0) fail('no scroll after a whole quest of right answers')
    for (const id of inv.slice(0, 40)) if (!(await exists(`scroll-${id}`))) fail(`the inventory does not list scroll-${id}`)
    await go('inventory-back', 'areas', 'inventory-back')
  }
  if (opts.mode === 'perfect') for (const a of st.view.areas) if (a.stars !== 3) fail(`area ${a.id} has ${a.stars} stars after perfect play`)

  // the final boss
  for (let tries = 0; tries < 30; tries++) {
    st = await state()
    if (st.screen === 'outro' || st.screen === 'end') break
    if (st.screen !== 'areas') throw new Error(`expected the areas, got "${st.screen}"`)
    if (!(await page.locator('[data-testid="final-boss"]').isEnabled())) throw new Error('every area is mastered but the final boss is shut')
    await go('final-boss', 'boss', 'final-boss')
    const r = await fight('final', 'final-boss')
    if (r.screen.screen === 'outro') break
    if (opts.mode === 'perfect') throw new Error(`the final boss was not beaten by perfect play (screen "${r.screen.screen}")`)
    if (r.screen.screen !== 'areas') throw new Error(`the final boss ended on "${r.screen.screen}"`)
    stats.faints++
  }
  st = await state()
  if (st.screen === 'outro') await story('outro', false)
  st = await until((x) => x.screen === 'end', 'the outro did not lead to the end')
  await shot('end')
  await overflowCheck('end')
  for (const id of ['end-title', 'end-scrolls', 'play-again', 'to-title']) if (!(await exists(id))) fail(`the end screen has no ${id}`)
  if (opts.mode === 'perfect') {
    for (const [id, stars] of Object.entries(st.mastery)) if (stars !== 3) fail(`unit ${id} has ${stars} stars at the end`)
    if (st.reviewQueue.length > 0) fail(`the review queue is not empty at the end: ${st.reviewQueue.join(', ')}`)
  }
  if (!st.finished) fail('the end screen does not mark the game finished')
  // the area screens can be walked again after the end (play-again keeps the progress)
  await go('play-again', 'areas', 'play-again')
}
