import { SeededRandom } from '../edu/prng'

/**
 * Pure tile-map logic of the RPG shell (EGS-12): parsing the map rows of the course section, walking rules, breadth-first search
 * (reachability for the lint, shortest paths for the `goto-` buttons) and the seeded map generator of the automatic layout.
 * No DOM, no clock: the lint, the player and the tests share it.
 *
 * Map characters: `#` wall, `.` floor (grass), `,` path, `T` tree, `~` water, `@` the hero's start, `N` an NPC spot, `B` the boss's
 * spot, `G` the gate. Walls, trees and water block; the gate blocks while it is shut.
 */

export type Pos = readonly [number, number]
export type Dir = 'up' | 'down' | 'left' | 'right'

export const MAP_CHARS = '#.,T~@NBG'
export const BLOCKING = '#T~'
export const DIRS: Readonly<Record<Dir, Pos>> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
/** The order the search expands neighbours in: the same map always gives the same shortest path. */
const ORDER: readonly Dir[] = ['up', 'down', 'left', 'right']

export const posKey = (p: Pos): string => `${p[0]},${p[1]}`
export const samePos = (a: Pos, b: Pos): boolean => a[0] === b[0] && a[1] === b[1]
export const manhattan = (a: Pos, b: Pos): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])
export const isAdjacent = (a: Pos, b: Pos): boolean => manhattan(a, b) === 1

export const tileAt = (rows: readonly string[], p: Pos): string | undefined => (p[1] >= 0 ? rows[p[1]]?.[p[0]] : undefined)

/** Whether the hero may stand on a tile character (the gate only when it is open). */
export const isWalkable = (ch: string | undefined, gateOpen = false): boolean => ch !== undefined && (ch === 'G' ? gateOpen : !BLOCKING.includes(ch))

export interface ParsedMap {
  w: number
  h: number
  /** The rows as given. */
  rows: string[]
  /** The rows have different widths. */
  ragged: boolean
  /** The first `@`. */
  start: Pos | null
  /** The first `G`. */
  gate: Pos | null
  /** Characters outside `MAP_CHARS`. */
  unknown: string[]
}

export function parseMap(rows: readonly string[]): ParsedMap {
  const w = Math.max(0, ...rows.map((r) => r.length))
  let start: Pos | null = null
  let gate: Pos | null = null
  const unknown = new Set<string>()
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x] as string
      if (!MAP_CHARS.includes(ch)) unknown.add(ch)
      if (ch === '@' && !start) start = [x, y]
      if (ch === 'G' && !gate) gate = [x, y]
    }
  })
  return { w, h: rows.length, rows: [...rows], ragged: rows.some((r) => r.length !== (rows[0]?.length ?? 0)), start, gate, unknown: [...unknown] }
}

export interface WalkOptions {
  /** Tiles that are occupied (people standing there), as `posKey`s. */
  blocked?: ReadonlySet<string>
  gateOpen?: boolean
}

const step = (p: Pos, d: Dir): Pos => [p[0] + DIRS[d][0], p[1] + DIRS[d][1]]

/** Every tile reachable from `from` by 4-neighbour steps over walkable, unoccupied tiles (`from` included). */
export function reachableFrom(rows: readonly string[], from: Pos, opts: WalkOptions = {}): Set<string> {
  const seen = new Set<string>([posKey(from)])
  const queue: Pos[] = [from]
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i] as Pos
    for (const d of ORDER) {
      const n = step(cur, d)
      const k = posKey(n)
      if (seen.has(k) || !isWalkable(tileAt(rows, n), opts.gateOpen) || opts.blocked?.has(k)) continue
      seen.add(k)
      queue.push(n)
    }
  }
  return seen
}

/**
 * The shortest path from `from` to the nearest tile for which `goal` is true (not including `from`; an empty list when `from` already
 * is a goal), or null when none can be reached. The goal tile itself must be walkable and unoccupied.
 */
export function findPath(rows: readonly string[], from: Pos, goal: (p: Pos) => boolean, opts: WalkOptions = {}): Pos[] | null {
  if (goal(from)) return []
  const prev = new Map<string, Pos | null>([[posKey(from), null]])
  const queue: Pos[] = [from]
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i] as Pos
    for (const d of ORDER) {
      const n = step(cur, d)
      const k = posKey(n)
      if (prev.has(k) || !isWalkable(tileAt(rows, n), opts.gateOpen) || opts.blocked?.has(k)) continue
      prev.set(k, cur)
      if (goal(n)) {
        const path: Pos[] = [n]
        for (let p = cur; !samePos(p, from); p = prev.get(posKey(p)) as Pos) path.unshift(p)
        return path
      }
      queue.push(n)
    }
  }
  return null
}

/** The shortest path to a tile next to `target` (the target's own tile is occupied by whoever stands there). */
export function pathNextTo(rows: readonly string[], from: Pos, target: Pos, opts: WalkOptions = {}): Pos[] | null {
  return findPath(rows, from, (p) => isAdjacent(p, target), opts)
}

/**
 * Whether someone standing at `target` can be reached from `start`: the target's tile, or a neighbour of it, is reachable over walkable
 * tiles, with every other person in `others` standing in the way.
 */
export function canReachSpot(rows: readonly string[], start: Pos, target: Pos, others: readonly Pos[], gateOpen = false): boolean {
  const blocked = new Set(others.filter((o) => !samePos(o, target)).map(posKey))
  const seen = reachableFrom(rows, start, { blocked, gateOpen })
  if (seen.has(posKey(target))) return true
  return ORDER.some((d) => seen.has(posKey(step(target, d))))
}

// ---- the generator of the automatic layout ----

export const GEN_W = 16
export const GEN_H = 11

export interface GeneratedMap {
  rows: string[]
  start: Pos
  /** The quest giver's spot (marked `N`). */
  npc: Pos
  foes: Pos[]
  /** The boss's spot (marked `B`). */
  boss: Pos
  gate: Pos
}

const neighbours = (p: Pos): Pos[] => ORDER.map((d) => step(p, d))

/**
 * A seeded walled field with a path from the hero's start (left) to the gate (right wall), a pond and trees, the quest giver near the
 * start, `foeCount` foes spread along the path and the boss by the gate. Always connected: everyone stands BESIDE the path, never on
 * it, and the result is checked with the same search the lint uses (and repaired by clearing the scenery when it ever fails).
 */
export function generateMap(seed: string, foeCount: number): GeneratedMap {
  const foes = Math.max(0, Math.min(4, Math.floor(foeCount)))
  for (let attempt = 0; attempt < 6; attempt++) {
    const m = tryGenerate(`${seed}#${attempt}`, foes, attempt >= 3)
    if (m) return m
  }
  return plainMap(foes)
}

function tryGenerate(seed: string, foeCount: number, bare: boolean): GeneratedMap | null {
  const rng = new SeededRandom(`rpg-map:${seed}`)
  const W = GEN_W
  const H = GEN_H
  const g: string[][] = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1 ? '#' : '.')))
  const set = (p: Pos, ch: string): void => {
    const row = g[p[1]]
    if (row) row[p[0]] = ch
  }
  const get = (p: Pos): string => g[p[1]]?.[p[0]] ?? '#'
  const inside = (p: Pos): boolean => p[0] >= 1 && p[1] >= 1 && p[0] <= W - 2 && p[1] <= H - 2

  if (!bare) {
    // a pond
    const pcx = rng.randint(5, W - 6)
    const pcy = rng.randint(2, H - 3)
    const pr = rng.randint(1, 2)
    for (let y = 1; y <= H - 2; y++) for (let x = 1; x <= W - 2; x++) if ((x - pcx) ** 2 + (y - pcy) ** 2 * 1.5 <= pr * pr + rng.random() * 1.6) set([x, y], '~')
    // trees: a few anywhere, a thicker edge
    for (let y = 1; y <= H - 2; y++)
      for (let x = 1; x <= W - 2; x++) {
        const edge = x <= 1 || x >= W - 2 || y <= 1 || y >= H - 2
        if (get([x, y]) === '.' && rng.random() < (edge ? 0.34 : 0.1)) set([x, y], 'T')
      }
  }

  const start: Pos = [1, rng.randint(2, H - 3)]
  const gy = rng.randint(2, H - 3)
  const gate: Pos = [W - 1, gy]
  const gateIn: Pos = [W - 2, gy]
  set(gate, 'G')

  // the path: start -> two or three waypoints -> the tile before the gate, in L-shaped legs
  const way: Pos[] = [start]
  const legs = 2 + rng.randint(0, 1)
  for (let i = 1; i <= legs; i++) way.push([Math.max(2, Math.min(W - 3, Math.round(1 + ((W - 3) * i) / (legs + 1)) + rng.randint(-1, 1))), rng.randint(2, H - 3)])
  way.push(gateIn)
  const path = new Set<string>()
  const carve = (p: Pos): void => {
    if (inside(p)) {
      set(p, ',')
      path.add(posKey(p))
    }
  }
  for (let i = 0; i + 1 < way.length; i++) {
    const a = way[i] as Pos
    const b = way[i + 1] as Pos
    const horizontalFirst = rng.random() < 0.5
    const corner: Pos = horizontalFirst ? [b[0], a[1]] : [a[0], b[1]]
    for (const [from, to] of [[a, corner], [corner, b]] as [Pos, Pos][]) {
      const sx = Math.sign(to[0] - from[0])
      const sy = Math.sign(to[1] - from[1])
      for (let p: Pos = from; ; p = [p[0] + sx, p[1] + sy]) {
        carve(p)
        if (samePos(p, to)) break
      }
    }
  }

  // people stand beside the path
  const beside = (): Pos[] => {
    const out = new Map<string, Pos>()
    for (const k of path) {
      const [x, y] = k.split(',').map(Number) as [number, number]
      for (const n of neighbours([x, y])) if (inside(n) && !path.has(posKey(n)) && !samePos(n, start)) out.set(posKey(n), n)
    }
    return [...out.values()].filter((p) => manhattan(p, start) >= 2 && manhattan(p, gateIn) >= 2)
  }
  const spots = beside()
  const taken: Pos[] = []
  const pick = (ok: (p: Pos) => boolean, spacing: number): Pos | null => {
    const fits = spots.filter((p) => ok(p) && taken.every((t) => manhattan(p, t) >= spacing))
    if (fits.length === 0) return null
    return rng.choice(fits)
  }
  const place = (ok: (p: Pos) => boolean): Pos | null => pick(ok, 3) ?? pick(ok, 2) ?? pick(() => true, 2) ?? pick(() => true, 1)
  const npc = place((p) => p[0] <= 5)
  const boss = place((p) => p[0] >= W - 5)
  if (!npc || !boss) return null
  taken.push(npc, boss)
  const foePos: Pos[] = []
  for (let i = 0; i < foeCount; i++) {
    const lo = 5 + Math.floor(((W - 10) * i) / Math.max(1, foeCount))
    const hi = 5 + Math.ceil(((W - 10) * (i + 1)) / Math.max(1, foeCount))
    const f = place((p) => p[0] >= lo && p[0] <= hi)
    if (!f) return null
    taken.push(f)
    foePos.push(f)
  }
  for (const p of [npc, boss, ...foePos]) if (get(p) !== '.') set(p, '.')
  set(npc, 'N')
  set(boss, 'B')
  set(start, '@')

  const rows = g.map((r) => r.join(''))
  const people = [npc, boss, ...foePos]
  const ok = people.every((p) => canReachSpot(rows, start, p, people)) && canReachSpot(rows, start, gate, people, true)
  return ok ? { rows, start, npc, foes: foePos, boss, gate } : null
}

/** The last resort: an empty walled field (never reached in practice; keeps the function total). */
function plainMap(foeCount: number): GeneratedMap {
  const W = GEN_W
  const H = GEN_H
  const g: string[][] = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1 ? '#' : '.')))
  const start: Pos = [1, 5]
  const gate: Pos = [W - 1, 5]
  const npc: Pos = [3, 3]
  const boss: Pos = [W - 4, 3]
  const foes: Pos[] = Array.from({ length: foeCount }, (_, i) => [4 + i * 2, 7] as Pos)
  g[5]![W - 1] = 'G'
  g[3]![3] = 'N'
  g[3]![W - 4] = 'B'
  g[5]![1] = '@'
  return { rows: g.map((r) => r.join('')), start, npc, foes, boss, gate }
}
