import { findUnitCycle, unitOrder, type CourseUnit } from '../../shared/course'

/** A layered layout of the prerequisite graph of units (`units[].requires`): prerequisites on the left, what they unlock on the right. Pure, so it is tested. */

export interface GraphNode {
  id: string
  /** 0 = no prerequisites; a unit is one layer to the right of its deepest prerequisite. */
  layer: number
  row: number
  x: number
  y: number
}

export interface GraphEdge {
  /** The prerequisite. */
  from: string
  /** The unit that requires it. */
  to: string
  /** An SVG path from the right edge of `from` to the left edge of `to`. */
  path: string
}

export interface GraphLayout {
  nodes: GraphNode[]
  edges: GraphEdge[]
  width: number
  height: number
  /** The first cycle (a course the lint refuses), or null. */
  cycle: string[] | null
  /** Prerequisite ids that are not units. */
  unknown: string[]
}

export interface GraphOptions {
  nodeW?: number
  nodeH?: number
  gapX?: number
  gapY?: number
  pad?: number
}

export function layoutUnits(units: readonly Pick<CourseUnit, 'id' | 'requires'>[], o: GraphOptions = {}): GraphLayout {
  const nodeW = o.nodeW ?? 176
  const nodeH = o.nodeH ?? 72
  const gapX = o.gapX ?? 72
  const gapY = o.gapY ?? 20
  const pad = o.pad ?? 12
  const ids = new Set(units.map((u) => u.id))
  const unknown = [...new Set(units.flatMap((u) => u.requires.filter((r) => !ids.has(r))))]
  const cycle = findUnitCycle(units)
  const order = unitOrder(units)
  const layer = new Map<string, number>()
  for (const id of order) {
    const u = units.find((x) => x.id === id)
    const deps = (u?.requires ?? []).filter((r) => ids.has(r))
    layer.set(id, deps.length === 0 ? 0 : Math.max(...deps.map((d) => (layer.get(d) ?? 0) + 1)))
  }
  // units in a cycle have no order: put them one layer after everything else so the picture still shows them
  const last = Math.max(-1, ...layer.values())
  for (const u of units) if (!layer.has(u.id)) layer.set(u.id, last + 1)

  const rows = new Map<number, number>()
  const nodes: GraphNode[] = units.map((u) => {
    const l = layer.get(u.id) ?? 0
    const row = rows.get(l) ?? 0
    rows.set(l, row + 1)
    return { id: u.id, layer: l, row, x: pad + l * (nodeW + gapX), y: pad + row * (nodeH + gapY) }
  })
  const at = new Map(nodes.map((n) => [n.id, n]))
  const edges: GraphEdge[] = []
  for (const u of units) {
    for (const r of u.requires) {
      const a = at.get(r)
      const b = at.get(u.id)
      if (!a || !b) continue
      const x1 = a.x + nodeW
      const y1 = a.y + nodeH / 2
      const x2 = b.x
      const y2 = b.y + nodeH / 2
      const mid = Math.max(24, (x2 - x1) / 2)
      edges.push({ from: r, to: u.id, path: `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}` })
    }
  }
  const layers = Math.max(0, ...nodes.map((n) => n.layer)) + 1
  const maxRows = Math.max(1, ...rows.values())
  return { nodes, edges, width: pad * 2 + layers * nodeW + (layers - 1) * gapX, height: pad * 2 + maxRows * nodeH + (maxRows - 1) * gapY, cycle, unknown }
}
