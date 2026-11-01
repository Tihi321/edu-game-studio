import { describe, expect, it } from 'vitest'
import type { CoursePack } from '../src/shared/course'
import {
  AUTO_MIN_DOORS,
  autoWing,
  canReachKey,
  doorKey,
  keyRooms,
  MAZE_CODES,
  mindmazeSectionSchema,
  mindmazeShell,
  reachable,
  resolveMaze,
  routeToKey,
  type MazeWing,
  type MindmazeSection
} from '../src/shared/shells/mindmaze'
import { sectionOf, validateShellSections } from '../src/shared/shells'
import type { ShellLintContext } from '../src/shared/shells/types'
import { FIXTURE_NAMES, loadFixture } from './edu-fixtures'

/**
 * The MindMaze castle's pure logic (EGS-11): the section schema, the automatic layout, the graph helpers and the route the bot follows,
 * the validator and every lint code on a broken variant of the golden fixtures.
 */

type Fixture = Awaited<ReturnType<typeof loadFixture>>
const ctxOf = (f: Fixture): ShellLintContext => ({ pack: f.pack, catalogs: f.catalogs, editions: f.pack.languages, resolvers: {} })
const sectionFor = (f: Fixture): MindmazeSection => structuredClone(sectionOf<MindmazeSection>(f.pack, 'mindmaze') as MindmazeSection)
const lintCodes = (s: MindmazeSection | undefined, f: Fixture): string[] => mindmazeShell.lint(s, ctxOf(f)).map((p) => p.code)
const validateCodes = (s: MindmazeSection, f: Fixture): string[] => (mindmazeShell.validate?.(s, f.pack) ?? []).map((p) => p.code)
const uniq = (xs: string[]): string[] => [...new Set(xs)].sort()

const FIXTURES_WITH_SECTION = ['solar-system', 'european-capitals'] as const

describe('the golden fixtures', () => {
  for (const name of FIXTURES_WITH_SECTION) {
    it(`${name}: the authored castle validates and lints clean`, async () => {
      const f = await loadFixture(name)
      expect(f.pack.shells.enabled).toContain('mindmaze')
      const s = sectionFor(f)
      expect(validateCodes(s, f)).toEqual([])
      expect(mindmazeShell.lint(s, ctxOf(f))).toEqual([])
      expect(validateShellSections(f.pack).problems.filter((p) => p.code.startsWith('MAZE_'))).toEqual([])
    })

    it(`${name}: one wing per unit, every item of a unit asked at a door, two routes to the key, 4 or more doors`, async () => {
      const f = await loadFixture(name)
      const maze = resolveMaze(f.pack, sectionFor(f))
      expect(maze.wings.map((w) => w.unit)).toEqual(f.pack.units.map((u) => u.id))
      for (const w of maze.wings) {
        expect(w.auto).toBe(false)
        const asked = new Set(w.rooms.flatMap((r) => r.doors.flatMap((d) => d.items)))
        const unitItems = f.pack.items.filter((i) => f.pack.objectives.find((o) => o.id === i.objective)?.unit === w.unit).map((i) => i.id)
        expect([...asked].sort()).toEqual(unitItems.sort())
        expect(routeToKey(w, w.entry).path.length - 1).toBeGreaterThanOrEqual(4)
        // a second route: some room has two doors
        expect(w.rooms.some((r) => r.doors.length >= 2)).toBe(true)
        expect(w.rooms.every((r) => r.character !== undefined)).toBe(true)
        expect(reachable(w, w.entry).size).toBe(w.rooms.length)
      }
    })

  }
})

describe('the automatic layout (no section)', () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: a lint-clean wing per unit from the objectives, with a key room and two routes`, async () => {
      const f = await loadFixture(name)
      expect(mindmazeShell.lint(undefined, ctxOf(f))).toEqual([])
      const maze = resolveMaze(f.pack, undefined)
      expect(maze.torches).toBe(3)
      expect(maze.wings.map((w) => w.unit)).toEqual(f.pack.units.map((u) => u.id))
      for (const w of maze.wings) {
        expect(w.auto).toBe(true)
        expect(keyRooms(w)).toEqual(['key'])
        expect(canReachKey(w, w.entry)).toBe(true)
        expect(reachable(w, w.entry).size).toBe(w.rooms.length)
        const route = routeToKey(w, w.entry)
        expect(route.found).toBe(true)
        expect(route.path.length - 1).toBeGreaterThanOrEqual(AUTO_MIN_DOORS)
        expect(w.rooms.some((r) => r.doors.length === 2)).toBe(true)
        // a room per objective that has items, named after the objective's text
        const objs = f.pack.objectives.filter((o) => o.unit === w.unit && f.pack.items.some((i) => i.objective === o.id))
        for (const o of objs) expect(w.rooms.find((r) => r.id === `r-${o.id}`)?.name.key).toBe(o.text)
        // every door asks something that exists, and the doors draw on every item of the unit
        const ids = new Set(f.pack.items.map((i) => i.id))
        for (const r of w.rooms) for (const d of r.doors) expect(d.items.length > 0 && d.items.every((id) => ids.has(id))).toBe(true)
        const asked = new Set(w.rooms.flatMap((r) => r.doors.flatMap((d) => d.items)))
        for (const o of objs) for (const i of f.pack.items.filter((x) => x.objective === o.id)) expect(asked.has(i.id)).toBe(true)
      }
    })
  }

  it('a unit with a single objective still gets a route of the minimum length (galleries fill it)', async () => {
    const f = await loadFixture('solar-system')
    const first = f.pack.units[0]!.id
    const pack: CoursePack = { ...f.pack, objectives: f.pack.objectives.filter((o) => o.unit !== first || o.id === 'obj-sun') }
    const w = autoWing(pack, first)
    expect(routeToKey(w, w.entry).path.length - 1).toBeGreaterThanOrEqual(AUTO_MIN_DOORS)
    expect(w.rooms.filter((r) => r.id.startsWith('gallery-')).length).toBeGreaterThan(0)
    expect(lintCodes(undefined, { ...f, pack })).toEqual([])
  })

})

describe('the graph helpers and the route', () => {
  const wing = (rooms: Record<string, string[]>, key: string[], entry = 'a'): Pick<MazeWing, 'rooms' | 'entry'> => ({
    entry,
    rooms: Object.entries(rooms).map(([id, to]) => ({ id, name: { ui: id }, doors: to.map((t) => ({ to: t, items: ['x'] })), key: key.includes(id) }))
  })

  it('reachable follows one-way doors and ignores doors to rooms that do not exist', () => {
    const w = wing({ a: ['b', 'ghost'], b: [], c: ['a'] }, [])
    expect([...reachable(w, 'a')].sort()).toEqual(['a', 'b'])
    expect([...reachable(w, 'c')].sort()).toEqual(['a', 'b', 'c'])
    expect(reachable(w, 'nowhere').size).toBe(0)
  })

  it('routeToKey takes the shortest way, ties keep the author order of doors', () => {
    const w = wing({ a: ['long1', 'short'], long1: ['long2'], long2: ['k'], short: ['k'], k: [] }, ['k'])
    const r = routeToKey(w, 'a')
    expect(r.path).toEqual(['a', 'short', 'k'])
    expect(r.next).toBe('short')
    expect(r.locked).toBe(2)
    const tie = routeToKey(wing({ a: ['x', 'y'], x: ['k'], y: ['k'], k: [] }, ['k']), 'a')
    expect(tie.path).toEqual(['a', 'x', 'k'])
  })

  it('routeToKey goes through open doors first, even when they are longer', () => {
    const w = wing({ a: ['long1', 'short'], long1: ['long2'], long2: ['k'], short: ['k'], k: [] }, ['k'])
    const open = new Set([doorKey('a', 'long1'), doorKey('long1', 'long2')])
    const r = routeToKey(w, 'a', open)
    expect(r.path).toEqual(['a', 'long1', 'long2', 'k'])
    expect(r.next).toBe('long1')
    expect(r.locked).toBe(1)
    // everything open: no locked door left on the route
    const all = new Set([doorKey('a', 'long1'), doorKey('long1', 'long2'), doorKey('long2', 'k')])
    expect(routeToKey(w, 'a', all).locked).toBe(0)
  })

  it('routeToKey in the key room has nothing to press, and with no way it says so', () => {
    const w = wing({ a: ['k'], k: [], island: [] }, ['k'])
    expect(routeToKey(w, 'k')).toMatchObject({ found: true, next: null, path: ['k'], locked: 0 })
    expect(routeToKey(w, 'island')).toMatchObject({ found: false, next: null })
    expect(routeToKey(w, 'nope')).toMatchObject({ found: false })
  })

})

describe('every lint code fires on a broken variant of solar-system', () => {
  const fired = new Set<string>()
  const check = async (code: string, mutate: (s: MindmazeSection) => void, via: 'lint' | 'validate' = 'lint'): Promise<void> => {
    const f = await loadFixture('solar-system')
    const s = sectionFor(f)
    mutate(s)
    const codes = via === 'validate' ? validateCodes(s, f) : lintCodes(s, f)
    expect(codes, code).toContain(code)
    fired.add(code)
  }
  const wing = (s: MindmazeSection, i = 0) => s.wings[i]!

  it('MAZE_WING_UNIT_MISSING', () => check('MAZE_WING_UNIT_MISSING', (s) => (wing(s).unit = 'u-nope'), 'validate'))
  it('MAZE_ENTRY_MISSING', () => check('MAZE_ENTRY_MISSING', (s) => (wing(s).entry = 'nowhere'), 'validate'))
  it('MAZE_DOOR_TARGET_MISSING', () => check('MAZE_DOOR_TARGET_MISSING', (s) => (wing(s).rooms[0]!.doors[0]!.to = 'nowhere'), 'validate'))
  it('MAZE_DOOR_ITEM_MISSING', () => check('MAZE_DOOR_ITEM_MISSING', (s) => wing(s).rooms[0]!.doors[0]!.items.push('q-nope'), 'validate'))
  it('MAZE_OBJECTIVE_MISSING', () => check('MAZE_OBJECTIVE_MISSING', (s) => (wing(s).rooms[1]!.objective = 'obj-nope'), 'validate'))
  it('MAZE_DUPLICATE (a room, a wing, a door)', async () => {
    await check('MAZE_DUPLICATE', (s) => wing(s).rooms.push({ ...structuredClone(wing(s).rooms[1]!) }), 'validate')
    await check('MAZE_DUPLICATE', (s) => s.wings.push(structuredClone(wing(s))), 'validate')
    await check('MAZE_DUPLICATE', (s) => wing(s).rooms[1]!.doors.push(structuredClone(wing(s).rooms[1]!.doors[0]!)), 'validate')
  })
  it('MAZE_UNIT_NO_WING', () => check('MAZE_UNIT_NO_WING', (s) => s.wings.pop()))
  it('MAZE_DOOR_NO_ITEMS', () => check('MAZE_DOOR_NO_ITEMS', (s) => (wing(s).rooms[0]!.doors[0]!.items = [])))
  it('MAZE_ROOM_UNREACHABLE', () => check('MAZE_ROOM_UNREACHABLE', (s) => (wing(s).rooms[0]!.doors = [])))
  it('MAZE_NO_KEY_ROOM', () => check('MAZE_NO_KEY_ROOM', (s) => wing(s).rooms.forEach((r) => (r.key = false))))
  it('MAZE_KEY_UNREACHABLE', () => check('MAZE_KEY_UNREACHABLE', (s) => wing(s).rooms.forEach((r) => (r.doors = r.doors.filter((d) => d.to !== 'sun-key')))))
  it('MAZE_KEY_AT_ENTRY', () => check('MAZE_KEY_AT_ENTRY', (s) => (wing(s).rooms[0]!.key = true)))
  it('MAZE_DEAD_END', () =>
    check('MAZE_DEAD_END', (s) => {
      wing(s).rooms.push({ id: 'trap', name: 'maze.r.sun-hall', doors: [], key: false })
      wing(s).rooms[0]!.doors.push({ to: 'trap', items: ['q-order-mcq'] })
    }))
  it('MAZE_DOOR_ITEM_OTHER_UNIT (a warning)', async () => {
    const f = await loadFixture('solar-system')
    const s = sectionFor(f)
    wing(s).rooms[0]!.doors[0]!.items.push('q-moons-mcq')
    const ps = mindmazeShell.lint(s, ctxOf(f))
    expect(ps.map((p) => [p.code, p.severity])).toEqual([['MAZE_DOOR_ITEM_OTHER_UNIT', 'warning']])
    fired.add('MAZE_DOOR_ITEM_OTHER_UNIT')
  })
  it('MAZE_TOO_FEW_TORCHES (a warning, also on the automatic castle)', async () => {
    const f = await loadFixture('solar-system')
    const s = sectionFor(f)
    s.torches = 0
    expect(mindmazeShell.lint(s, ctxOf(f)).map((p) => [p.code, p.severity])).toEqual([['MAZE_TOO_FEW_TORCHES', 'warning']])
    expect(lintCodes(mindmazeSectionSchema.parse({ torches: 0 }), f)).toEqual(['MAZE_TOO_FEW_TORCHES'])
    fired.add('MAZE_TOO_FEW_TORCHES')
  })

  it('every code of the shell was exercised, and the warnings are declared', () => {
    expect(uniq([...fired])).toEqual(uniq([...MAZE_CODES]))
    expect(mindmazeShell.warnings).toEqual(['MAZE_DOOR_ITEM_OTHER_UNIT', 'MAZE_TOO_FEW_TORCHES'])
    for (const w of mindmazeShell.warnings ?? []) expect(mindmazeShell.codes).toContain(w)
  })
})
