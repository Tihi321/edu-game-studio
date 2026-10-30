/**
 * The MindMaze castle's driver for the autoplay bot (scripts/play.mjs): title -> castle -> wings (rooms, doors that ask) -> throne -> end.
 *
 * It walks the castle through its test ids and the read-only helpers of the shell (`EduEngine.debug.shell`):
 *   route()  the next door on the cheapest way to the key room, open doors first: { room, found, path, locked, door, state, takeKey }
 *   view()   the room being walked (the same as `getState().view` on the room screen): room, torches, doors with their state, ghost ...
 *   maze()   the shape of the castle (wings, rooms, key rooms, doors on the shortest route)
 * A shut door is pressed, answered with the shared `answerCurrent` (same item widgets and feedback checks as every shell) and walks you
 * through when right; an open door is only walked through.
 *
 *   perfect  every wing in prerequisite order to 3 stars (checks: a wing whose unit needs another starts sealed, the throne starts sealed,
 *            the torches never drop, an opened door can be walked back and forth without a question), then the throne gauntlet, `finish`,
 *            the end screen.
 *   wrong    every door in the first wing answered wrong: the torches go out one by one, the last one sends the castle ghost to lead you back
 *            to the entrance hall (screen, `view.room`, `view.ghost`, the notice, the torches relit), the door still asks (--rounds N more
 *            ghost scenes), the review queue fills, no key is won, the other wings and the throne stay sealed. It cannot finish.
 *   random   a seeded learner (--accuracy) wins every wing to mastery (2 stars; a wing that crumbles is walked again), then the throne
 *            (a gauntlet that gives no star is faced again), within maxSteps.
 * --keyboard: Tab / Enter reach every control; the number keys 1-9 also walk through the doors of a room (used on every other door).
 */

/** maxSteps = ceil((30 per unit + 4 per throne question) * factor) + 20: a wing is 4-8 doors, a crumbled wing is walked again a few times. */
export function maxSteps({ pack, factor }) {
  const throne = pack.shells?.config?.mindmaze?.throne?.size ?? 8
  return Math.ceil((pack.units.length * 30 + throne * 4) * factor) + 20
}

export async function play(bot) {
  const { page, opts, pack, tid, fail, state, exists, press, waitChange, waitScreen, shot, overflowCheck, answerCurrent, answerWhileItem, shellDebug, focusInMain } = bot
  const screens = bot.screens
  const mz = { wings: {}, doors: 0, questions: 0, ghosts: 0, keys: 0, backs: 0, digitDoors: 0 }
  bot.summary.maze = mz

  const view = async () => (await state()).view ?? {}

  /** Waits until the room (or the screen) of the walk differs from `prev` (walking through an open door changes nothing waitChange sees). */
  async function waitRoom(prevRoom, what) {
    try {
      await page.waitForFunction(
        (r) => {
          const s = window.EduEngine.getState()
          return s.screen !== 'room' || s.view?.room !== r
        },
        prevRoom,
        { timeout: 8000 }
      )
    } catch {
      throw new Error(`stuck: still in the room "${prevRoom}" after ${what}`)
    }
    if (opts.keyboard) await focusInMain(what)
  }

  /** The castle screen: the snapshot, the wing buttons and the throne agree; a wing is open exactly when its requirements are mastered. */
  async function castleChecks(label) {
    const st = await state()
    if (st.screen !== 'castle') throw new Error(`expected the castle, got "${st.screen}"`)
    const v = st.view
    for (const id of ['castle-title', 'castle-keys', 'wing-map', 'throne']) if (!(await exists(id))) fail(`the castle screen (${label}) has no ${id}`)
    for (const w of v.wings) {
      if (!(await exists(`wing-${w.id}`))) {
        fail(`the castle has no wing-${w.id} button`)
        continue
      }
      const locked = (await page.locator(tid(`wing-${w.id}`)).getAttribute('data-locked')) === 'true'
      if (locked !== w.locked) fail(`wing ${w.id}: the button says locked=${locked}, the view says ${w.locked}`)
      const stars = Number(await page.locator(tid(`wing-${w.id}`)).getAttribute('data-stars'))
      if (stars !== w.stars) fail(`wing ${w.id}: the button shows ${stars} star(s), the view ${w.stars}`)
      const unit = pack.units.find((u) => u.id === w.unit)
      const open = (unit?.requires ?? []).every((r) => (st.mastery[r] ?? 0) >= 2)
      if (open === w.locked) fail(`wing ${w.id}: locked=${w.locked} but its requirements are ${open ? 'mastered' : 'not mastered'}`)
    }
    const throneLocked = (await page.locator(tid('throne')).getAttribute('data-locked')) === 'true'
    if (throneLocked !== !v.throneOpen) fail(`the throne button says locked=${throneLocked}, the view says throneOpen=${v.throneOpen}`)
    if (v.throneOpen !== v.wings.every((w) => w.key)) fail('the throne is open although a wing has no key (or the other way round)')
    return st
  }

  /** What the room screen must have. */
  async function roomChecks(label) {
    for (const id of ['room-name', 'doors', 'minimap-list', 'to-castle']) if (!(await exists(id))) fail(`the room (${label}) has no ${id}`)
    if ((await page.locator('.mm-map svg').count()) === 0) fail(`the room (${label}) has no mini-map drawing`)
    if ((await page.locator('.mm-torches').count()) === 0) fail(`the room (${label}) shows no torches`)
    const h1 = await page.locator('h1').count()
    if (h1 !== 1) fail(`the room (${label}) has ${h1} h1`)
    const v = await view()
    for (const d of v.doors) {
      if (!(await exists(`door-${d.to}`))) fail(`the room ${v.room} has no door-${d.to}`)
      else if ((await page.locator(tid(`door-${d.to}`)).getAttribute('data-state')) !== d.state) fail(`door-${d.to}: data-state does not match the view (${d.state})`)
    }
  }

  /** The character of the room: talk and hint show their words. */
  async function characterChecks(label) {
    if (!(await exists('talk'))) return
    if (!(await exists('character-name'))) fail(`the character of ${label} has no name`)
    await press('talk')
    await page.waitForFunction(() => !document.querySelector('[data-testid="character-line"]')?.hidden)
    if ((await page.locator(tid('character-line')).innerText()).trim().length === 0) fail(`the character of ${label} says nothing when you talk to them`)
    if (await exists('hint')) {
      await press('hint')
      await page.waitForFunction(() => !document.querySelector('[data-testid="character-hint"]')?.hidden)
      if ((await page.locator(tid('character-hint')).innerText()).trim().length === 0) fail(`the character of ${label} gives an empty hint`)
    }
  }

  /** Walks through an open door: with the keyboard the number key of the door (1-9) when `digit`, else Tab and Enter (or a click). */
  async function walkDoor(doorId, doors, digit) {
    const index = doors.findIndex((d) => `door-${d.to}` === doorId)
    if (opts.keyboard && digit && index >= 0 && index < 9) {
      await page.keyboard.press(String(index + 1))
      mz.digitDoors++
    } else await press(doorId)
  }

  /** Presses a shut door and answers its question. Returns the state after the feedback was left. */
  async function askDoor(doorId, before) {
    await press(doorId)
    await waitChange(before, `pressing ${doorId}`)
    const s = await state()
    if (s.screen !== 'item') throw new Error(`${doorId} did not ask a question (screen "${s.screen}")`)
    screens.add('item')
    if (s.context !== 'door') fail(`${doorId}: the question has the context "${s.context}", expected "door"`)
    if (s.unitId !== before.unitId) fail(`${doorId}: the question is for the unit "${s.unitId}", expected "${before.unitId}"`)
    await answerCurrent(s)
    mz.questions++
    return state()
  }

  /** Walks the wing on screen (the room screen) to the key room and takes the key; returns when the wing-done screen is shown. */
  async function walkWing(wingId) {
    let st = await state()
    if (st.screen !== 'room') throw new Error(`expected a room, got "${st.screen}"`)
    await shot('room')
    await overflowCheck(`room of ${wingId}`)
    await roomChecks(wingId)
    await characterChecks(wingId)
    const maxT = st.view.maxTorches
    let checkedBack = false
    for (let guard = 0; guard < 400; guard++) {
      st = await state()
      if (st.screen !== 'room') throw new Error(`expected a room in ${wingId}, got "${st.screen}"`)
      const r = await shellDebug('route')
      if (!r || !r.found) throw new Error(`the wing ${wingId} has no route to the key from "${st.view.room}"`)
      if (r.room !== st.view.room) fail(`route() says the room is "${r.room}", the view "${st.view.room}"`)
      if (opts.mode === 'perfect' && st.view.torches !== maxT) fail(`a torch went out in perfect play (${st.view.torches} of ${maxT})`)
      if (r.takeKey) {
        if (!(await exists('take-key'))) fail('the key room has no take-key button')
        await shot('room-key')
        await press('take-key')
        await waitScreen('wing-done', 'take-key')
        mz.keys++
        return
      }
      if (!r.door || !(await exists(r.door))) throw new Error(`route() names the door "${r.door}", which the room does not show`)
      // once per wing: step back through a door you opened and forward again (free, no question)
      if (!checkedBack && st.view.trail.length > 0 && (await exists('back')) && r.state === 'locked') {
        checkedBack = true
        const from = st.view.room
        await press('back')
        await waitRoom(from, 'back')
        mz.backs++
        const there = await state()
        if (there.view.room !== st.view.trail.at(-1)) fail(`back went to "${there.view.room}", not to "${st.view.trail.at(-1)}"`)
        const door = there.view.doors.find((d) => d.to === from)
        if (!door || door.state !== 'open') fail(`the door back to "${from}" is not open after walking through it`)
        else {
          await walkDoor(`door-${from}`, there.view.doors, true)
          await waitRoom(there.view.room, 'walking forward again')
          mz.doors++
        }
        continue
      }
      if (r.state === 'open') {
        await walkDoor(r.door, st.view.doors, bot.answered % 2 === 0)
        await waitRoom(st.view.room, `walking through ${r.door}`)
        mz.doors++
        const after = await state()
        if (after.screen !== 'room') throw new Error(`an open door (${r.door}) asked a question (screen "${after.screen}")`)
        if (after.view.room !== r.path[1]) fail(`${r.door} led to "${after.view.room}", the route said "${r.path[1]}"`)
        continue
      }
      const after = await askDoor(r.door, st)
      if (after.screen !== 'room') throw new Error(`after the question at ${r.door} the screen is "${after.screen}", not a room`)
      if (opts.mode === 'perfect') {
        if (after.view.ghost) fail('the ghost came in perfect play')
        if (after.view.room !== r.path[1]) fail(`a right answer at ${r.door} did not walk through (room "${after.view.room}", expected "${r.path[1]}")`)
      } else if (after.view.ghost) {
        mz.ghosts++
        if (after.view.room !== after.view.entry) fail(`the ghost left you in "${after.view.room}", not in the entrance hall "${after.view.entry}"`)
        if (after.view.torches !== maxT) fail(`the ghost did not relight the torches (${after.view.torches} of ${maxT})`)
        if (!(await exists('notice'))) fail('the ghost scene has no notice on the room screen')
        await shot('room-ghost')
      }
    }
    throw new Error(`the wing ${wingId} was not finished in 400 steps`)
  }

  /** The wing-done screen: checks. Returns the stars. */
  async function wingDone(wingId) {
    const st = await state()
    const v = st.view
    if (v.wing !== wingId) fail(`wing-done is for "${v.wing}", expected "${wingId}"`)
    for (const id of ['wing-title', 'wing-stars', 'wing-accuracy', 'to-castle']) if (!(await exists(id))) fail(`wing-done (${wingId}) has no ${id}`)
    if (v.key !== v.stars >= 2) fail(`wing-done: key=${v.key} with ${v.stars} star(s)`)
    if (v.key ? !(await exists('wing-key')) : !(await exists('wing-crumble'))) fail(`wing-done (${wingId}): the ${v.key ? 'key' : 'crumbling'} message is missing`)
    if (v.stars < 3 && !(await exists('retry-wing'))) fail('wing-done offers no retry below 3 stars')
    if (v.stars < 3 && v.misses.length > 0 && !(await exists('wing-misses'))) fail('wing-done lists no misses')
    await shot('wing-done')
    await overflowCheck(`wing-done ${wingId}`)
    mz.wings[wingId] = Math.max(mz.wings[wingId] ?? 0, v.stars)
    return v.stars
  }

  async function toCastle() {
    const prev = await state()
    await press('to-castle')
    await waitChange(prev, 'to-castle')
    await waitScreen('castle', 'to-castle')
  }

  async function openWing(id) {
    const prev = await state()
    await press(`wing-${id}`)
    await waitChange(prev, `wing-${id}`)
    await waitScreen('room', `wing-${id}`)
  }

  // ---------------------------------------------------------------- title -> castle

  {
    const prev = await state()
    await press('start')
    await waitChange(prev, 'start')
    await waitScreen('castle', 'start')
  }
  let st = await castleChecks('first visit')
  await shot('castle')
  await overflowCheck('castle')
  const wingList = st.view.wings
  if (wingList.length !== pack.units.length) fail(`the castle has ${wingList.length} wings for ${pack.units.length} units`)
  if (st.view.throneOpen) fail('the throne room is open at the start')
  if (wingList.length > 1 && pack.units.some((u) => u.requires.length > 0) && !wingList.some((w) => w.locked)) fail('every wing is open at the start although units require each other')
  const summary = await shellDebug('maze')
  if (summary.wings.some((w) => !w.solvable)) fail('a wing of the maze has no route to its key room')
  bot.summary.maze.shape = summary.wings.map((w) => ({ id: w.id, auto: w.auto, rooms: w.rooms.length, doors: w.doors }))

  // ---------------------------------------------------------------- wrong: the first wing, every door wrong

  if (opts.mode === 'wrong') {
    const first = wingList.find((w) => !w.locked)
    if (!first) throw new Error('every wing is sealed at the start: the castle has no way in')
    await openWing(first.id)
    await shot('room')
    await roomChecks(first.id)
    await characterChecks(first.id)
    const v0 = await view()
    const maxT = v0.maxTorches
    const entry = v0.entry
    const wanted = 1 + opts.rounds
    for (let guard = 0; guard < 80 && mz.ghosts < wanted; guard++) {
      const s = await state()
      if (s.screen !== 'room') throw new Error(`expected a room, got "${s.screen}"`)
      const r = await shellDebug('route')
      if (!r?.door) throw new Error('the entrance hall has no door to press')
      if (s.view.room !== entry) fail(`wrong play left the entrance hall (room "${s.view.room}")`)
      if (r.state !== 'locked') fail(`the door ${r.door} is open although every answer was wrong`)
      const torchesBefore = s.view.torches
      const after = await askDoor(r.door, s)
      if (after.screen !== 'room') throw new Error(`after a wrong answer the screen is "${after.screen}", not the room`)
      if (after.view.room !== entry) fail(`a wrong answer moved you to "${after.view.room}"`)
      if (after.view.doors.some((d) => d.state === 'open')) fail('a door opened after a wrong answer')
      if (torchesBefore > 1) {
        if (after.view.torches !== torchesBefore - 1) fail(`a wrong answer left ${after.view.torches} torches, expected ${torchesBefore - 1}`)
        if (after.view.ghost) fail('the ghost came before the last torch went out')
      } else {
        mz.ghosts++
        if (!after.view.ghost) fail('the last torch went out and no ghost led you back')
        if (after.view.torches !== maxT) fail(`the ghost left ${after.view.torches} torches, expected ${maxT}`)
        if (!(await exists('notice'))) fail('the ghost scene has no notice')
        await shot('room-ghost')
        await overflowCheck('room after the ghost')
      }
    }
    if (mz.ghosts < wanted) fail(`only ${mz.ghosts} ghost scene(s) of ${wanted} wanted`)
    st = await state()
    if (st.reviewQueue.length === 0) fail('the review queue is empty after wrong answers at the doors')
    await toCastle()
    st = await castleChecks('after wrong play')
    if (st.view.keys !== 0) fail(`a key was won by wrong answers (${st.view.keys})`)
    if (st.view.throneOpen) fail('the throne opened without a key')
    await shot('castle-after')
    return
  }

  // ---------------------------------------------------------------- perfect / random: wings in order, the throne, the end

  const target = opts.mode === 'perfect' ? 3 : 2
  for (let guard = 0; guard < 120; guard++) {
    st = await state()
    if (st.screen !== 'castle') throw new Error(`expected the castle, got "${st.screen}"`)
    const next = st.view.wings.find((w) => !w.locked && w.stars < target)
    if (!next) break
    await openWing(next.id)
    await walkWing(next.id)
    const stars = await wingDone(next.id)
    if (opts.mode === 'perfect' && stars < 3) fail(`wing ${next.id}: ${stars} star(s) after perfect play`)
    await toCastle()
    await castleChecks(`after ${next.id}`)
  }
  st = await castleChecks('every wing walked')
  const stuck = st.view.wings.find((w) => w.stars < target)
  if (stuck) throw new Error(`deadlock: wing ${stuck.id} has ${stuck.stars} star(s) and no open wing is left to walk`)
  if (!st.view.throneOpen) fail('every wing is won but the throne room is sealed')
  await shot('castle-keys')
  await overflowCheck('castle with every key')

  // the throne: a gauntlet of mixed questions; one star or more wins the crown
  for (let tries = 1; ; tries++) {
    if (tries > 30) throw new Error('the throne gauntlet was not won in 30 tries')
    const prev = await state()
    await press('throne')
    await waitChange(prev, 'throne')
    await waitScreen('throne', 'throne')
    for (const id of ['throne-begin', 'throne-title']) if (!(await exists(id))) fail(`the throne intro has no ${id}`)
    await shot('throne-intro')
    await overflowCheck('throne intro')
    const intro = await state()
    await press('throne-begin')
    await waitChange(intro, 'throne-begin')
    const q = await state()
    if (q.screen !== 'item') throw new Error(`the throne asked no question (screen "${q.screen}")`)
    if (q.context !== 'throne' || q.roundKind !== 'boss') fail(`the throne question is ${q.roundKind}/${q.context}, expected boss/throne`)
    const done = await answerWhileItem('the throne gauntlet')
    if (done.screen !== 'throne' || done.view.phase !== 'result') throw new Error(`the gauntlet ended on "${done.screen}" (${done.view?.phase})`)
    await shot('throne-result')
    await overflowCheck('throne result')
    if (done.view.stars >= 1) {
      if (opts.mode === 'perfect' && done.view.stars !== 3) fail(`the gauntlet earned ${done.view.stars} star(s) after perfect play`)
      if (!(await exists('finish'))) fail('a won gauntlet offers no finish button')
      const p = await state()
      await press('finish')
      await waitChange(p, 'finish')
      break
    }
    if (opts.mode === 'perfect') fail('a perfect gauntlet earned no star')
    for (const id of ['retry-throne', 'to-castle']) if (!(await exists(id))) fail(`a lost gauntlet offers no ${id}`)
    await toCastle()
  }
  st = await state()
  if (st.screen !== 'end' || !st.finished) throw new Error(`the end screen was not reached (screen "${st.screen}")`)
  screens.add('end')
  await shot('end')
  await overflowCheck('end')
  for (const id of ['end-title', 'play-again', 'to-title', 'end-keys']) if (!(await exists(id))) fail(`the end screen has no ${id}`)
  if (st.view.keys !== st.view.total) fail(`the end screen counts ${st.view.keys} of ${st.view.total} keys`)
  if (opts.mode === 'perfect') {
    for (const u of pack.units) if (st.mastery[u.id] !== 3) fail(`unit ${u.id} has ${st.mastery[u.id]} stars at the end`)
    if (st.reviewQueue.length > 0) fail(`the review queue is not empty at the end: ${st.reviewQueue.join(', ')}`)
  }
}
