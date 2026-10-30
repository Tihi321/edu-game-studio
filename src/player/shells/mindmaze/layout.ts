import type { CourseUnit } from '../../../shared/course'
import type { MazeWing } from '../../../shared/shells/mindmaze'

/** Pure layouts (no DOM) for the two maps of the castle: the rooms of a wing (the parchment mini-map) and the rows of wings of the castle. */

export const MAP_NODE = 40
export const MAP_GAP_X = 80
export const MAP_GAP_Y = 60
export const MAP_PAD = 26

export interface MapNode {
  id: string
  /** Distance from the entrance in doors (the column). */
  col: number
  row: number
  /** Centre in map units. */
  x: number
  y: number
  /** 1-based number shown on the map and in the legend: left to right, top to bottom. */
  n: number
}

export interface MapEdge {
  from: string
  to: string
  /** The door leads back to a room nearer the entrance (drawn as a curve). */
  back: boolean
}

export interface RoomMap {
  nodes: MapNode[]
  edges: MapEdge[]
  width: number
  height: number
}

/**
 * Lays the rooms of a wing out in columns by their distance from the entrance (breadth-first through the doors), spread over rows.
 * Rooms the entrance cannot reach (a lint error) go in a last column so the map still shows them.
 */
export function layoutRooms(wing: Pick<MazeWing, 'rooms' | 'entry'>): RoomMap {
  const ids = wing.rooms.map((r) => r.id)
  const depth = new Map<string, number>()
  if (ids.includes(wing.entry)) {
    depth.set(wing.entry, 0)
    const queue = [wing.entry]
    while (queue.length > 0) {
      const cur = queue.shift() as string
      for (const d of wing.rooms.find((r) => r.id === cur)?.doors ?? []) {
        if (ids.includes(d.to) && !depth.has(d.to)) {
          depth.set(d.to, (depth.get(cur) as number) + 1)
          queue.push(d.to)
        }
      }
    }
  }
  const lost = ids.filter((id) => !depth.has(id))
  const last = Math.max(-1, ...depth.values()) + 1
  for (const id of lost) depth.set(id, last)
  const cols = Math.max(0, ...depth.values()) + 1
  const byCol: string[][] = Array.from({ length: cols }, () => [])
  for (const id of ids) byCol[depth.get(id) as number]?.push(id)
  const rows = Math.max(1, ...byCol.map((c) => c.length))
  const nodes: MapNode[] = []
  byCol.forEach((col, ci) => {
    col.forEach((id, ri) => {
      // a column with fewer rooms than the tallest is centred on the middle row
      const y = MAP_PAD + MAP_NODE / 2 + (ri + (rows - col.length) / 2) * MAP_GAP_Y
      nodes.push({ id, col: ci, row: ri, x: MAP_PAD + MAP_NODE / 2 + ci * MAP_GAP_X, y, n: 0 })
    })
  })
  const ordered = [...nodes].sort((a, b) => a.col - b.col || a.y - b.y)
  ordered.forEach((n, i) => (n.n = i + 1))
  const edges: MapEdge[] = []
  for (const r of wing.rooms) for (const d of r.doors) if (ids.includes(d.to) && d.to !== r.id) edges.push({ from: r.id, to: d.to, back: (depth.get(d.to) as number) <= (depth.get(r.id) as number) })
  return {
    nodes,
    edges,
    width: MAP_PAD * 2 + MAP_NODE + (cols - 1) * MAP_GAP_X,
    height: MAP_PAD * 2 + MAP_NODE + (rows - 1) * MAP_GAP_Y
  }
}

/** The wings of the castle in rows: row 0 are the wings whose unit needs nothing, each next row needs a wing of the row before. */
export function wingRows(wings: readonly Pick<MazeWing, 'id' | 'unit'>[], units: readonly Pick<CourseUnit, 'id' | 'requires'>[]): string[][] {
  const level = new Map<string, number>()
  const visit = (id: string, trail: string[]): number => {
    const known = level.get(id)
    if (known !== undefined) return known
    if (trail.includes(id)) return 0
    const u = units.find((x) => x.id === id)
    const lv = !u || u.requires.length === 0 ? 0 : 1 + Math.max(...u.requires.map((r) => visit(r, [...trail, id])))
    level.set(id, lv)
    return lv
  }
  for (const u of units) visit(u.id, [])
  const rows: string[][] = []
  for (const w of wings) {
    const lv = level.get(w.unit) ?? 0
    while (rows.length <= lv) rows.push([])
    rows[lv]?.push(w.id)
  }
  return rows.filter((r) => r.length > 0)
}
