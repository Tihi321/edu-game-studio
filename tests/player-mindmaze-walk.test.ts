import { describe, expect, it } from 'vitest'
import { checkItem, makeTextResolver, rngFor, solveItem, type CheckContext } from '../src/shared/edu'
import { doorKey, resolveMaze, routeToKey, type MazeWing } from '../src/shared/shells/mindmaze'
import { gradeOf, missedIds, pickNext, recordResult, roundAccuracy, startPool, type NextQuestion, type RoundState } from '../src/player/round'
import { layoutRooms, wingRows } from '../src/player/shells/mindmaze/layout'
import { goBack, ghostLeads, isOpen, loseTorch, newWalk, openDoor, pickForDoor, relight, walkThrough } from '../src/player/shells/mindmaze/walk'
import { loadFixture } from './edu-fixtures'

/** The MindMaze walk (EGS-11): torches, ghost, doors that stay open, the door's question, the maps. Pure: no DOM. */

type Fixture = Awaited<ReturnType<typeof loadFixture>>
const ctxOf = (f: Fixture): CheckContext => ({ text: makeTextResolver(f.catalogs, 'en', f.pack.targetLang), diacritics: f.pack.matching.diacritics, typos: f.pack.matching.typos })

const wingOf = async (): Promise<{ f: Fixture; wing: MazeWing }> => {
  const f = await loadFixture('solar-system')
  return { f, wing: resolveMaze(f.pack, undefined).wings[0] as MazeWing }
}
const poolOf = (wing: MazeWing): string[] => [...new Set(wing.rooms.flatMap((r) => r.doors.flatMap((d) => d.items)))]

describe('the walk', () => {
  it('starts in the entrance hall with full torches and no open door', async () => {
    const { f, wing } = await wingOf()
    const run = startPool(poolOf(wing), { kind: 'unit', unitId: wing.unit })
    const w = newWalk(wing, run, 3)
    expect(w).toMatchObject({ room: wing.entry, trail: [], open: [], torches: 3, maxTorches: 3, mood: 'none', ghosted: false })
    expect(f.pack.items.length).toBeGreaterThan(0)
  })

  it('an opened door stays open, walking through moves you and back retraces the trail for free', async () => {
    const { wing } = await wingOf()
    let w = newWalk(wing, startPool([]), 3)
    const next = wing.rooms[0]!.doors[0]!.to
    expect(isOpen(w, wing.entry, next)).toBe(false)
    w = openDoor(w, wing.entry, next)
    w = openDoor(w, wing.entry, next) // opening twice changes nothing
    expect(w.open).toEqual([doorKey(wing.entry, next)])
    w = walkThrough(w, next)
    expect(w).toMatchObject({ room: next, trail: [wing.entry] })
    w = goBack(w)
    expect(w).toMatchObject({ room: wing.entry, trail: [] })
    expect(isOpen(w, wing.entry, next)).toBe(true)
    expect(goBack(w)).toBe(w) // nothing to go back to
  })

  it('a wrong answer puts a torch out; the last one is dark; the ghost leads back to the entrance and relights, doors stay open', async () => {
    const { wing } = await wingOf()
    let w = newWalk(wing, startPool([]), 3)
    const [a, b] = [wing.rooms[0]!.doors[0]!.to, wing.rooms[1]!.doors[0]!.to]
    w = walkThrough(openDoor(w, wing.entry, a), a)
    w = openDoor(w, a, b)
    let r = loseTorch(w)
    expect(r).toMatchObject({ dark: false, walk: { torches: 2 } })
    r = loseTorch(loseTorch(r.walk).walk)
    expect(r.dark).toBe(true)
    expect(r.walk.torches).toBe(0)
    expect(loseTorch(r.walk).walk.torches).toBe(0) // never negative
    const led = ghostLeads(r.walk, wing.entry)
    expect(led).toMatchObject({ room: wing.entry, trail: [], torches: 3, ghosted: true, mood: 'groan' })
    expect(led.open).toEqual(w.open) // the doors you opened stay open
    expect(walkThrough(led, a).ghosted).toBe(false)
    expect(relight(r.walk).torches).toBe(3)
  })

  it('after the ghost the route to the key still exists and starts with the open doors', async () => {
    const { wing } = await wingOf()
    const route = routeToKey(wing, wing.entry)
    let w = newWalk(wing, startPool([]), 3)
    w = openDoor(w, route.path[0]!, route.path[1]!)
    const led = ghostLeads(loseTorch(loseTorch(loseTorch(w).walk).walk).walk, wing.entry)
    const again = routeToKey(wing, led.room, new Set(led.open))
    expect(again.found).toBe(true)
    expect(again.locked).toBe(route.locked - 1)
  })
})

describe('pickForDoor: the question of a door', () => {
  const answer = (f: Fixture, rs: RoundState, pick: NextQuestion, right: boolean): RoundState => {
    const ctx = ctxOf(f)
    const item = f.pack.items.find((i) => i.id === pick.id)!
    const a = right ? solveItem(item, ctx) : item.kind === 'flashcard' ? 'again' : '__wrong__'
    const result = checkItem(item, a, ctx)
    return recordResult(rs, pick, item, result, gradeOf(item, a, result))
  }

  it('asks an item of the door first, never one of another door while the door still has fresh ones', async () => {
    const { f, wing } = await wingOf()
    const rng = rngFor(7, 'door')
    const door = wing.rooms[1]!.doors[0]!
    let rs = startPool(poolOf(wing), { kind: 'unit', unitId: wing.unit })
    const asked: string[] = []
    for (let i = 0; i < door.items.length; i++) {
      const pick = pickForDoor(rs, door.items, (r) => pickNext(r, f.pack, rng, {}, 0), rng)!
      expect(door.items).toContain(pick.id)
      expect(pick.retry).toBe(false)
      asked.push(pick.id)
      rs = answer(f, rs, pick, true)
    }
    expect(new Set(asked).size).toBe(door.items.length)
    expect(roundAccuracy(rs)).toBe(1)
  })

  it('a missed question comes back, after others, in the same run', async () => {
    const { f, wing } = await wingOf()
    const rng = rngFor(3, 'miss')
    let rs = startPool(poolOf(wing), { kind: 'unit', unitId: wing.unit })
    const all = poolOf(wing)
    const first = pickForDoor(rs, all, (r) => pickNext(r, f.pack, rng, {}, 0), rng)!
    rs = answer(f, rs, first, false)
    expect(missedIds(rs)).toEqual([first.id])
    let again = -1
    for (let n = 1; n <= 8; n++) {
      const pick = pickForDoor(rs, all, (r) => pickNext(r, f.pack, rng, {}, 0), rng)
      if (!pick) break
      if (pick.id === first.id && pick.retry) {
        again = n
        break
      }
      rs = answer(f, rs, pick, true)
    }
    expect(again).toBeGreaterThanOrEqual(2)
    expect(again).toBeLessThanOrEqual(5)
  })

  it('never has nothing to ask: with the run used up the door gives a practice question from its own pool', async () => {
    const { f, wing } = await wingOf()
    const rng = rngFor(5, 'used')
    const pool = poolOf(wing)
    let rs = startPool(pool, { kind: 'unit', unitId: wing.unit })
    for (let n = 0; n < 100; n++) {
      const pick = pickNext(rs, f.pack, rng, {}, 0)
      if (!pick) break
      rs = answer(f, rs, pick, true)
    }
    expect(pickNext(rs, f.pack, rng, {}, 0)).toBeNull()
    const door = wing.rooms[0]!.doors[0]!
    const practice = pickForDoor(rs, door.items, (r) => pickNext(r, f.pack, rng, {}, 0), rng)
    expect(practice).not.toBeNull()
    expect(practice!.retry).toBe(true)
    expect(door.items).toContain(practice!.id)
    // a door with no items at all has nothing to ask (the shell lets such a door yield)
    expect(pickForDoor(rs, [], (r) => pickNext(r, f.pack, rng, {}, 0), rng)).toBeNull()
  })
})

describe('the maps', () => {
  it('layoutRooms: columns by distance from the entrance, every room a distinct number, every door an edge', async () => {
    const { wing } = await wingOf()
    const m = layoutRooms(wing)
    expect(m.nodes).toHaveLength(wing.rooms.length)
    expect(m.nodes.find((n) => n.id === wing.entry)).toMatchObject({ col: 0, n: 1 })
    expect(new Set(m.nodes.map((n) => n.n)).size).toBe(wing.rooms.length)
    expect(m.edges).toHaveLength(wing.rooms.reduce((s, r) => s + r.doors.length, 0))
    const key = m.nodes.find((n) => n.id === 'key')!
    expect(key.col).toBe(Math.max(...m.nodes.map((n) => n.col)))
    expect(m.width).toBeGreaterThan(0)
    expect(m.height).toBeGreaterThan(0)
    for (const n of m.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.x).toBeLessThanOrEqual(m.width)
      expect(n.y).toBeLessThanOrEqual(m.height)
    }
  })

  it('wingRows: wings in rows by how many units they need before them', async () => {
    const f = await loadFixture('european-capitals')
    const wings = resolveMaze(f.pack, undefined).wings
    expect(wingRows(wings, f.pack.units)).toEqual([['u-west'], ['u-central', 'u-south']])
    const solar = await loadFixture('solar-system')
    expect(wingRows(resolveMaze(solar.pack, undefined).wings, solar.pack.units)).toEqual([['u-sun-planets'], ['u-rocky-giant'], ['u-moons-beyond']])
  })
})
