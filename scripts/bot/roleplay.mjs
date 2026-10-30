/**
 * The language role-play shell's driver for the autoplay bot (scripts/play.mjs): title -> scenes -> a conversation per unit (lines are
 * revealed with `scene-next`, one translation is opened per scene, the learner's turns are questions answered through the shared
 * `answerCurrent`) -> scene-done -> the garden (`water`) -> the finale -> end.
 *
 *   perfect  every unit's scene in order (each is 3 stars the first time), one translation opened per scene, every `line-play-*` button
 *            checked against the clips the section names; the garden is watered until nothing is due or wilted (every plant is
 *            then past the seed stage); the finale; the end screen. Nothing is ever wrong and the review queue stays empty.
 *   wrong    every reply wrong: the open scene plays (--rounds N times): after each miss the speaker's recovery line appears
 *            (`help-<line>-<n>`), the same turn is asked again (retry tag), after the third miss the right reply is shown and the scene
 *            still ends (no dead end) with 0 stars; the next scenes and the finale stay locked, the review queue fills, the garden
 *            plants of the missed items wilt, and a watering run of wrong answers works too.
 *   random   a seeded learner (--accuracy): every scene is replayed until its unit is mastered (2 stars), the garden is watered, the
 *            finale is replayed until it earns a star, then the end screen, within maxSteps.
 *
 * The driver adds `summary.roleplay` (scenes played, lines revealed, translations opened, clips played, recovery lines seen, watering
 * runs) to the bot's JSON.
 */

const sectionOf = (pack) => pack.shells?.config?.roleplay ?? { speakers: [], scenes: [], garden: [], finale: undefined }
const turnsOf = (scene) => scene.lines.filter((l) => 'reply' in l).length

/** maxSteps = ceil((9 * turns of every scene + 3 * items + 60) * factor): a scene may be answered three times per turn and replayed. */
export function maxSteps({ pack, factor }) {
  const rp = sectionOf(pack)
  const turns = rp.scenes.reduce((n, s) => n + turnsOf(s), 0)
  return Math.ceil((9 * turns + 3 * pack.items.length + 60) * factor)
}

export async function play(bot) {
  const { page, data, pack, opts, tid, fail, state, exists, press, focusInMain, waitScreen, shot, overflowCheck, answerCurrent, openQuestion, pressAndWait, shellDebug, screens, summary } = bot
  const rp = sectionOf(pack)
  const stats = { scenesPlayed: 0, lines: 0, translations: 0, clips: 0, recovery: 0, gardenRuns: 0, plantsGrown: 0 }
  summary.roleplay = stats
  const sceneById = new Map(rp.scenes.map((s) => [s.id, s]))
  const lineOf = (sceneId, lineId) => sceneById.get(sceneId)?.lines.find((l) => l.id === lineId)
  const unitIds = pack.units.map((u) => u.id)
  const visible = (id) => page.locator(tid(id)).first().isVisible()

  /** A press that keeps the screen (the next line): the published view must change. */
  async function pressView(id, what) {
    const prev = await state()
    await press(id)
    const after = await state()
    if (JSON.stringify(after.view) === JSON.stringify(prev.view) && after.screen === prev.screen && after.itemId === prev.itemId) fail(`${what}: pressing ${id} changed nothing`)
    if (opts.keyboard) await focusInMain(what)
  }

  /** Answers the questions of a watering run until the garden is back. */
  async function answerWatering() {
    for (let guard = 0; guard < 200; guard++) {
      const s = await state()
      screens.add(s.screen)
      if (s.screen !== 'item') return s
      if (s.context !== 'garden') fail(`a watering question has the context "${s.context}"`)
      if (!(await exists('hud-stage'))) fail('a watering question shows no plant in the hud')
      await answerCurrent(s)
    }
    throw new Error('the watering run did not end')
  }

  /** Plays the scene on screen to `scene-done`: reveals lines, opens one translation, answers every turn, checks the recovery lines. */
  async function playOpenScene(sceneId, label) {
    let translated = false
    let played = false
    const seenHelp = new Set()
    for (let guard = 0; guard < 600; guard++) {
      const s = await state()
      screens.add(s.screen)
      if (s.screen === 'scene-done') return s
      if (s.screen === 'item') {
        if (s.context !== 'line') fail(`${label}: the question context is "${s.context}", expected "line"`)
        if (s.view?.retry === true) {
          if (!(await exists('retry-tag'))) fail(`${label}: a retried turn shows no retry tag`)
          if (lineOf(sceneId, s.view.line)?.help && !(await exists('hud-help'))) fail(`${label}: the retried turn ${s.view.line} shows no recovery hint in the hud`)
        }
        if (!(await exists('hud-last')) && !(await exists('hud-setting'))) fail(`${label}: the question shows neither the last line said to you nor the setting`)
        if (s.view?.step !== 'turn') fail(`${label}: a question is open but the scene step is "${s.view?.step}"`)
        await shot('scene-question', 'scene-question')
        await answerCurrent(s)
        continue
      }
      if (s.screen !== 'scene') throw new Error(`${label}: unexpected screen "${s.screen}" while playing the scene`)
      const v = s.view ?? {}
      if (v.scene !== sceneId) fail(`${label}: the scene on screen is "${v.scene}"`)
      if (v.retry === true) {
        const key = `${v.line}-${v.tries}`
        if (!seenHelp.has(key)) {
          seenHelp.add(key)
          if (!(await exists(`help-${v.line}-${v.tries}`))) fail(`${label}: no recovery line help-${v.line}-${v.tries} after a miss`)
          else stats.recovery++
          await shot('scene-help', 'scene-help')
        }
      }
      if (v.step === 'say') {
        const next = v.line
        const line = lineOf(sceneId, next)
        if (!(await exists('scene-next'))) throw new Error(`${label}: no scene-next while the line ${next} waits`)
        await pressView('scene-next', `${label}: next line ${next}`)
        stats.lines++
        if (!(await exists(`line-${next}`))) fail(`${label}: the line ${next} is not in the log after scene-next`)
        // a play button exists exactly when the line names a clip that the game has
        const clip = !!(line?.audio && data.assets?.[line.audio])
        if ((await exists(`line-play-${next}`)) !== clip) fail(`${label}: line ${next} ${clip ? 'has a clip but no line-play button' : 'has no clip but draws a line-play button'}`)
        if (clip && !played) {
          await press(`line-play-${next}`)
          stats.clips++
          played = true
        }
        // listen lines keep their words hidden until the turn after them is answered
        if (line?.listen && clip && !(await state()).view?.hidden?.includes(next)) fail(`${label}: the listen line ${next} is not hidden`)
        if (!translated && line?.translation && !(line.listen && clip)) {
          if (!(await exists(`translate-${next}`))) fail(`${label}: line ${next} has a translation but no translate button`)
          else {
            if (await visible(`translation-${next}`)) fail(`${label}: the translation of ${next} is shown before it is asked for`)
            await press(`translate-${next}`)
            if (!(await visible(`translation-${next}`))) fail(`${label}: the translation of ${next} does not open`)
            else stats.translations++
            translated = true
            await shot('scene-translated', 'scene-translated')
          }
        }
      } else if (v.step === 'turn') {
        await shot('scene-before-turn', 'scene-before-turn')
        await openQuestion('scene-reply', `the turn ${v.line} of ${sceneId}`)
      } else if (v.step === 'done') {
        await press('scene-finish')
        await waitScreen('scene-done', 'scene-finish')
        if (opts.keyboard) await focusInMain('scene-finish')
      } else throw new Error(`${label}: unknown scene step "${v.step}"`)
    }
    throw new Error(`${label}: the scene did not end`)
  }

  /** Opens a scene from the scene list and plays it to scene-done. */
  async function runScene(sceneId, label) {
    await pressAndWait(`scene-${sceneId}`, `opening ${label}`, 'scene')
    await shot('scene-start', 'scene-start')
    await overflowCheck(`scene ${sceneId}`)
    const done = await playOpenScene(sceneId, label)
    stats.scenesPlayed++
    return done
  }

  /** From scene-done: plays the scene again. */
  async function replay(sceneId, label) {
    await press('replay-scene')
    await waitScreen('scene', 'replay-scene')
    const done = await playOpenScene(sceneId, `${label} again`)
    stats.scenesPlayed++
    return done
  }

  async function checkDone(done, scene, label) {
    const v = done.view ?? {}
    await shot('scene-done', 'scene-done')
    await overflowCheck(`scene-done of ${scene.id}`)
    for (const id of ['done-title', 'scene-stars', 'scene-accuracy', 'to-scenes', 'to-garden']) if (!(await exists(id))) fail(`${label}: the scene-done screen has no ${id}`)
    const turns = turnsOf(scene)
    if (opts.mode === 'perfect') {
      if (v.stars !== 3) fail(`${label}: a perfect scene earned ${v.stars} star(s)`)
      if (v.helped !== 0 || v.shown !== 0) fail(`${label}: a perfect scene needed help (${v.helped}) or showed the reply (${v.shown})`)
      if (!(await exists('scene-words'))) fail(`${label}: the scene-done screen lists no planted words`)
    }
    if (opts.mode === 'wrong') {
      if (v.stars !== 0) fail(`${label}: an all-wrong scene earned ${v.stars} star(s)`)
      if (v.shown !== turns) fail(`${label}: ${v.shown} of ${turns} turns showed the right reply after the misses`)
      if (v.helped !== turns * 3) fail(`${label}: ${v.helped} recovery lines for ${turns} missed turns, expected ${turns * 3}`)
      if (!(await exists('scene-need'))) fail(`${label}: no hint that the scene must be played again`)
    }
    return v
  }

  const toScenes = (label) => pressAndWait('to-scenes', `to-scenes after ${label}`, 'scenes')
  const lockedNow = async (id) => (await page.locator(tid(`scene-${id}`)).getAttribute('data-locked')) === 'true' && (await page.locator(tid(`scene-${id}`)).isDisabled())

  // ---- the scene list ----
  await pressAndWait('start', 'start', 'scenes')
  await shot('scenes')
  await overflowCheck('scenes')
  for (const id of ['scenes-title', 'scene-list', 'to-garden', 'menu']) if (!(await exists(id))) fail(`the scenes screen has no ${id}`)
  let board = await shellDebug('scenes')
  const unitScenes = board.filter((e) => !e.finale)
  const finale = board.find((e) => e.finale)
  if (unitScenes.length === 0) throw new Error('the course has no scene to play')
  if (!finale) throw new Error('the course has no finale')
  if (unitScenes.some((e) => !unitIds.includes(e.unit))) fail('a scene belongs to no unit')
  if (!(await lockedNow(finale.id))) fail('the finale is open before any unit is mastered')
  const first = unitScenes.find((e) => !e.locked)
  if (!first) throw new Error('no scene is open at the start')
  for (const e of unitScenes) {
    const needs = pack.units.find((u) => u.id === e.unit)?.requires ?? []
    if (needs.length > 0 && !e.locked) fail(`the scene ${e.id} is open although its unit requires ${needs.join(', ')}`)
    if (needs.length === 0 && e.locked) fail(`the scene ${e.id} is locked although its unit requires nothing`)
  }

  // ---- wrong: the open scene(s), the recovery lines, the locked rest, the wilting garden ----
  if (opts.mode === 'wrong') {
    for (const e of unitScenes.filter((x) => !x.locked)) {
      const scene = sceneById.get(e.id)
      let done = await runScene(e.id, `scene ${e.id}`)
      for (let r = 1; r <= opts.rounds; r++) {
        const v = await checkDone(done, scene, `scene ${e.id}`)
        if (done.mastery[e.unit] !== 0) fail(`scene ${e.id}: the unit ${e.unit} has ${done.mastery[e.unit]} star(s) after an all-wrong scene`)
        if (v.unlocked?.length) fail(`scene ${e.id}: an all-wrong scene unlocked ${v.unlocked.join(', ')}`)
        if (r < opts.rounds) done = await replay(e.id, `scene ${e.id}`)
      }
      await toScenes(`scene ${e.id}`)
    }
    const st = await state()
    if (st.reviewQueue.length === 0) fail('the review queue is empty after answering everything wrong')
    board = await shellDebug('scenes')
    for (const e of board.filter((x) => x.locked)) if (!(await lockedNow(e.id))) fail(`the scene ${e.id} is locked in the game but not drawn so`)
    if (!board.some((x) => x.locked)) fail('every scene is open after an all-wrong play')
    if (board.some((x) => x.finale && !x.locked)) fail('the finale opened although no unit was mastered')
    await shot('scenes-locked', 'scenes-locked')
    // the garden: the plants of the missed items wilt
    await pressAndWait('to-garden', 'to-garden', 'garden')
    await shot('garden-wilted', 'garden-wilted')
    await overflowCheck('garden')
    const g = await shellDebug('garden')
    if (g.counts.wilted === 0) fail('no plant wilted although every answer was wrong')
    for (const p of g.plants) if (st.reviewQueue.includes(p.item) && p.stage !== 'wilted') fail(`the plant ${p.id} of the missed item ${p.item} is "${p.stage}", expected wilted`)
    for (const p of g.plants.filter((x) => x.stage === 'wilted')) if ((await page.locator(tid(`plant-${p.id}`)).getAttribute('data-stage')) !== 'wilted') fail(`plant-${p.id} is not drawn wilted`)
    if (!(await exists('water'))) fail('the garden offers no watering although plants wilted')
    else {
      await openQuestion('water', 'watering')
      const s = await answerWatering()
      if (s.screen !== 'garden') fail(`watering ended on "${s.screen}", expected the garden`)
      if (!(await exists('water-result'))) fail('no watering result after the run')
      stats.gardenRuns++
    }
    if ((await state()).finished) fail('the course finished although every answer was wrong')
    return
  }

  // ---- perfect and random: every scene in order ----
  const target = opts.mode === 'perfect' ? 3 : 2
  for (const [i, e] of unitScenes.entries()) {
    board = await shellDebug('scenes')
    if (board.find((x) => x.id === e.id)?.locked) throw new Error(`the scene ${e.id} is still locked although the earlier units are mastered`)
    const scene = sceneById.get(e.id)
    let done = await runScene(e.id, `scene ${e.id}`)
    await checkDone(done, scene, `scene ${e.id}`)
    for (let tries = 0; opts.mode === 'random' && (done.mastery[e.unit] ?? 0) < target && tries < 14; tries++) {
      done = await replay(e.id, `scene ${e.id}`)
      await checkDone(done, scene, `scene ${e.id} again`)
    }
    if ((done.mastery[e.unit] ?? 0) < target) throw new Error(`the unit ${e.unit} has ${done.mastery[e.unit]} star(s) after its scene was played again and again`)
    if (opts.mode === 'perfect' && i === 0) {
      const g = await shellDebug('garden')
      if (g.plants.length === 0) fail('the first scene planted no word in the garden')
      if (g.plants.every((p) => p.stage === 'seed')) fail('no plant has grown after a perfect scene')
      if (g.counts.wilted !== 0) fail('a plant wilted after a perfect scene')
    }
    await toScenes(`scene ${e.id}`)
  }

  // ---- the garden ----
  await pressAndWait('to-garden', 'to-garden', 'garden')
  await shot('garden')
  await overflowCheck('garden')
  for (const id of ['garden-title', 'garden-stats', 'plant-list', 'to-scenes']) if (!(await exists(id))) fail(`the garden has no ${id}`)
  for (let runs = 0; runs < 8 && (await exists('water')); runs++) {
    await openQuestion('water', 'watering')
    const s = await answerWatering()
    if (s.screen !== 'garden') fail(`watering ended on "${s.screen}", expected the garden`)
    if (!(await exists('water-result'))) fail('no watering result after the run')
    stats.gardenRuns++
    await shot('garden-watered', 'garden-watered')
  }
  const g = await shellDebug('garden')
  stats.plantsGrown = g.plants.filter((p) => p.stage !== 'seed').length
  if (opts.mode === 'perfect') {
    if (await exists('water')) fail('the plants are still thirsty after watering until nothing was due')
    if (g.counts.wilted !== 0) fail(`${g.counts.wilted} plant(s) wilted in a perfect game`)
    if (g.counts.seed !== 0) fail(`${g.counts.seed} plant(s) are still seeds after watering`)
    if (g.pool !== 0) fail('the watering pool is not empty')
    if (stats.plantsGrown === 0) fail('no plant grew in a perfect game')
    if (!(await exists('water-empty'))) fail('the garden says nothing when all plants are happy (water-empty)')
  }
  await toScenes('the garden')

  // ---- the finale ----
  board = await shellDebug('scenes')
  const fin = board.find((x) => x.finale)
  if (fin.locked) throw new Error('every unit is mastered but the finale is locked')
  const finScene = sceneById.get(fin.id)
  let done = await runScene(fin.id, 'the finale')
  for (let tries = 1; ; tries++) {
    const v = await checkDone(done, finScene, 'the finale')
    if (v.finale !== true) fail('the finale scene is not marked as the finale')
    if (await exists('finish')) {
      if (opts.mode === 'perfect' && v.stars !== 3) fail(`the perfect finale earned ${v.stars} star(s)`)
      await press('finish')
      await waitScreen('end', 'finish')
      if (opts.keyboard) await focusInMain('finish')
      break
    }
    if (opts.mode === 'perfect') fail('a perfect finale did not offer the end screen')
    if (tries >= 20) throw new Error('the finale was not beaten in 20 tries')
    done = await replay(fin.id, 'the finale')
  }
  const end = await state()
  if (end.screen !== 'end' || !end.finished) throw new Error(`the end screen was not reached (screen "${end.screen}")`)
  screens.add('end')
  await shot('end')
  await overflowCheck('end')
  for (const id of ['end-title', 'play-again', 'to-title', 'end-words']) if (!(await exists(id))) fail(`the end screen has no ${id}`)
  if (opts.mode === 'perfect') {
    for (const u of pack.units) if (end.mastery[u.id] !== 3) fail(`unit ${u.id} has ${end.mastery[u.id]} stars at the end`)
    if (end.reviewQueue.length > 0) fail(`the review queue is not empty at the end: ${end.reviewQueue.join(', ')}`)
  }
}
