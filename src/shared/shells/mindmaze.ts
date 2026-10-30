import { z } from 'zod'
import { idSchema, itemsOf, keySchema, objectivesOf, unitOrder, type CoursePack } from '../course'
import type { Problem, TextRef } from '../edu/registry'
import type { ShellDef, ShellLintProblem } from './types'

/**
 * The course side of the MindMaze castle (EGS-11): the section `pack.shells.config.mindmaze`, its checks and the maze itself.
 *
 * The castle has one WING per unit. A wing is a graph of ROOMS joined by one-way DOORS; every door is a question (a pool of items), the
 * wing's entrance hall is where you start and a KEY ROOM is where the wing's key lies. Reaching the key room wins the wing (stars from the
 * first-try accuracy of the doors' questions); every wing's key opens the throne room, a final gauntlet over all units.
 *
 * Without a section (or for a unit no wing covers) the shell builds the wing by itself from the course (`autoWing`): an entrance hall, a
 * room per objective (named after its text), a key room, doors in a chain and one side chamber that gives a second route.
 *
 * Pure (no DOM, no node): the validator, the lint, the player and the bot's helpers all import this file.
 */

const character = z.strictObject({
  /** Catalog keys. */
  name: keySchema,
  /** What they say when you talk to them. */
  line: keySchema,
  /** A hint for the doors of the room (missing: the hints of the doors' items). */
  hint: keySchema.optional(),
  /** What they say after a right answer (a streak) and after a miss (missing: the shell's own lines). */
  right: keySchema.optional(),
  wrong: keySchema.optional(),
  /** A portrait picture (a pack asset); missing: a drawn portrait. */
  portrait: idSchema.optional()
})

const door = z.strictObject({
  /** The room it leads to. */
  to: idSchema,
  /** The question pool of this door (item ids); missing: the items of the objective of the room beyond. */
  items: z.array(idSchema).default([])
})

const room = z.strictObject({
  id: idSchema,
  name: keySchema,
  description: keySchema.optional(),
  character: character.optional(),
  doors: z.array(door).default([]),
  /** The wing's key lies here. */
  key: z.boolean().default(false),
  /** The objective this room stands for (it supplies the pool of a door that lists no items). */
  objective: idSchema.optional(),
  /** A picture of the room (a pack asset). */
  asset: idSchema.optional()
})

const wing = z.strictObject({
  id: idSchema,
  unit: idSchema,
  name: keySchema,
  description: keySchema.optional(),
  entry: idSchema,
  rooms: z.array(room).min(1)
})

const throne = z.strictObject({
  name: keySchema.optional(),
  description: keySchema.optional(),
  /** Questions of the gauntlet (fresh ones; misses come back on top). */
  size: z.number().int().min(3).max(20).default(8)
})

export const mindmazeSectionSchema = z.strictObject({
  /** Torches you carry into a wing; a wrong answer puts one out. */
  torches: z.number().int().min(0).max(9).default(3),
  /** Missing or empty: every unit gets an automatic wing. */
  wings: z.array(wing).default([]),
  throne: throne.optional()
})
export type MindmazeSection = z.infer<typeof mindmazeSectionSchema>
export type MazeWingDef = z.infer<typeof wing>
export type MazeRoomDef = z.infer<typeof room>

export const MAZE_CODES = [
  'MAZE_WING_UNIT_MISSING',
  'MAZE_ENTRY_MISSING',
  'MAZE_DOOR_TARGET_MISSING',
  'MAZE_DOOR_ITEM_MISSING',
  'MAZE_OBJECTIVE_MISSING',
  'MAZE_DUPLICATE',
  'MAZE_UNIT_NO_WING',
  'MAZE_DOOR_NO_ITEMS',
  'MAZE_ROOM_UNREACHABLE',
  'MAZE_NO_KEY_ROOM',
  'MAZE_KEY_UNREACHABLE',
  'MAZE_KEY_AT_ENTRY',
  'MAZE_DEAD_END',
  'MAZE_DOOR_ITEM_OTHER_UNIT',
  'MAZE_TOO_FEW_TORCHES'
] as const
export const MAZE_WARNINGS = ['MAZE_DOOR_ITEM_OTHER_UNIT', 'MAZE_TOO_FEW_TORCHES'] as const

// ---- the resolved maze ----

/** A text of the maze: a catalog key (authored, or an objective's own text) or one of the shell's own words (`ui`, automatic layout). */
export interface MazeLabel {
  key?: string
  ui?: string
}

export interface MazeCharacter {
  name: MazeLabel
  line: MazeLabel
  hint?: MazeLabel
  right?: MazeLabel
  wrong?: MazeLabel
  portrait?: string
  /** Which drawn portrait (0..5) when there is no picture. */
  look: number
}

export interface MazeDoor {
  to: string
  /** The question pool: existing item ids. */
  items: string[]
}

export interface MazeRoom {
  id: string
  name: MazeLabel
  description?: MazeLabel
  character?: MazeCharacter
  doors: MazeDoor[]
  key: boolean
  asset?: string
}

export interface MazeWing {
  id: string
  unit: string
  name: MazeLabel
  description?: MazeLabel
  entry: string
  rooms: MazeRoom[]
  /** Built by the shell, not authored. */
  auto: boolean
}

export interface Maze {
  torches: number
  wings: MazeWing[]
  throne: { name?: MazeLabel; description?: MazeLabel; size: number }
}

export const DEFAULT_TORCHES = 3
export const DEFAULT_THRONE_SIZE = 8
/** An automatic wing has at least this many doors on its shortest route, so a wing's stars rest on enough answers. */
export const AUTO_MIN_DOORS = 4

const ui = (k: string): MazeLabel => ({ ui: k })
const key = (k: string | undefined): MazeLabel | undefined => (k ? { key: k } : undefined)

const mazeChar = (c: z.infer<typeof character> | undefined, look: number): MazeCharacter | undefined =>
  c
    ? {
        name: { key: c.name },
        line: { key: c.line },
        ...(c.hint ? { hint: { key: c.hint } } : {}),
        ...(c.right ? { right: { key: c.right } } : {}),
        ...(c.wrong ? { wrong: { key: c.wrong } } : {}),
        ...(c.portrait ? { portrait: c.portrait } : {}),
        look: look % 6
      }
    : undefined

/** The four characters of the automatic layout (their words are the shell's own: `maze.auto.<who>.name|line|right|wrong`). */
type AutoChar = 'gate' | 'scholar' | 'archivist' | 'keeper'
const autoChar = (who: AutoChar, look: number): MazeCharacter => ({
  name: ui(`maze.auto.${who}.name`),
  line: ui(`maze.auto.${who}.line`),
  right: ui(`maze.auto.${who}.right`),
  wrong: ui(`maze.auto.${who}.wrong`),
  look: look % 6
})

const GALLERY_NAMES = ['maze.auto.gallery', 'maze.auto.gallery2', 'maze.auto.gallery3'] as const

/** The automatic wing of a unit: a hall, a room per objective that has items, a gallery when the route would be short, a key room, a side chamber. */
export function autoWing(pack: CoursePack, unitId: string, wingId: string = unitId): MazeWing {
  const unit = pack.units.find((u) => u.id === unitId)
  const objs = objectivesOf(pack, unitId)
    .map((o) => ({ o, items: itemsOf(pack, o.id).map((i) => i.id) }))
    .filter((x) => x.items.length > 0)
  const all = [...new Set(objs.flatMap((x) => x.items))]
  type Step = { id: string; name: MazeLabel; pool: string[]; who: AutoChar; key: boolean; description?: MazeLabel }
  const chain: Step[] = [{ id: 'hall', name: ui('maze.auto.hall'), pool: [], who: 'gate', key: false, description: ui('maze.auto.hall.desc') }]
  objs.forEach((x, i) => chain.push({ id: `r-${x.o.id}`, name: { key: x.o.text }, pool: x.items, who: i % 2 === 0 ? 'scholar' : 'archivist', key: false }))
  for (let g = 0; chain.length < AUTO_MIN_DOORS; g++) chain.push({ id: `gallery-${g + 1}`, name: ui(GALLERY_NAMES[g % GALLERY_NAMES.length] as string), pool: all, who: 'scholar', key: false })
  chain.push({ id: 'key', name: ui('maze.auto.keyroom'), pool: all, who: 'keeper', key: true, description: ui('maze.auto.keyroom.desc') })
  const rooms: MazeRoom[] = chain.map((s, i) => {
    const next = chain[i + 1]
    return {
      id: s.id,
      name: s.name,
      ...(s.description ? { description: s.description } : {}),
      character: autoChar(s.who, i),
      doors: next ? [{ to: next.id, items: next.pool.length > 0 ? next.pool : all }] : [],
      key: s.key
    }
  })
  // one side chamber gives a second route between two chain rooms (two doors instead of one, asking the same pool)
  const p = Math.floor((chain.length - 1) / 2)
  const from = rooms[p]
  const beyond = chain[p + 1]
  if (from && beyond) {
    const pool = from.doors[0]?.items ?? all
    rooms.push({ id: 'side', name: ui('maze.auto.side'), description: ui('maze.auto.side.desc'), character: autoChar('archivist', 3), doors: [{ to: beyond.id, items: pool }], key: false })
    from.doors.push({ to: 'side', items: pool })
  }
  return { id: wingId, unit: unitId, name: key(unit?.title) ?? ui('maze.auto.wing'), entry: 'hall', rooms, auto: true }
}

const resolveWing = (pack: CoursePack, w: MazeWingDef, wi: number): MazeWing => {
  const itemIds = new Set(pack.items.map((i) => i.id))
  const byId = new Map(w.rooms.map((r) => [r.id, r]))
  const pool = (d: z.infer<typeof door>): string[] => {
    const listed = d.items.length > 0 ? d.items : (byId.get(d.to)?.objective ? itemsOf(pack, byId.get(d.to)?.objective as string).map((i) => i.id) : [])
    return [...new Set(listed)].filter((id) => itemIds.has(id))
  }
  return {
    id: w.id,
    unit: w.unit,
    name: { key: w.name },
    ...(w.description ? { description: { key: w.description } } : {}),
    entry: w.entry,
    auto: false,
    rooms: w.rooms.map((r, ri) => {
      const c = mazeChar(r.character, wi * 3 + ri)
      return {
        id: r.id,
        name: { key: r.name },
        ...(r.description ? { description: { key: r.description } } : {}),
        ...(c ? { character: c } : {}),
        doors: r.doors.map((d) => ({ to: d.to, items: pool(d) })),
        key: r.key,
        ...(r.asset ? { asset: r.asset } : {})
      }
    })
  }
}

/**
 * The maze to play: the section's wings, plus an automatic wing for every unit no wing covers, in the order of the units' prerequisites
 * (so a wing never comes before the wing it needs). Without a section every unit gets an automatic wing.
 */
export function resolveMaze(pack: CoursePack, section: MindmazeSection | undefined): Maze {
  const authored = (section?.wings ?? []).map((w, i) => resolveWing(pack, w, i))
  const covered = new Set(authored.map((w) => w.unit))
  const taken = new Set(authored.map((w) => w.id))
  const added = pack.units
    .filter((u) => !covered.has(u.id))
    .map((u) => autoWing(pack, u.id, taken.has(u.id) ? `${u.id}-auto` : u.id))
  const order = unitOrder(pack.units)
  const rank = (w: MazeWing): number => {
    const i = order.indexOf(w.unit)
    return i < 0 ? order.length : i
  }
  const wings = [...authored, ...added].map((w, i) => ({ w, i })).sort((a, b) => rank(a.w) - rank(b.w) || a.i - b.i).map((x) => x.w)
  const t = section?.throne
  return {
    torches: section?.torches ?? DEFAULT_TORCHES,
    wings,
    throne: {
      ...(t?.name ? { name: { key: t.name } } : {}),
      ...(t?.description ? { description: { key: t.description } } : {}),
      size: t?.size ?? DEFAULT_THRONE_SIZE
    }
  }
}

// ---- the graph (the lint, the player and the bot's route share it) ----

export const doorKey = (from: string, to: string): string => `${from}>${to}`

export const roomOf = (wing: Pick<MazeWing, 'rooms'>, id: string): MazeRoom | undefined => wing.rooms.find((r) => r.id === id)

export const keyRooms = (wing: Pick<MazeWing, 'rooms'>): string[] => wing.rooms.filter((r) => r.key).map((r) => r.id)

/** The rooms reachable from `from` through doors (the start included). */
export function reachable(wing: Pick<MazeWing, 'rooms'>, from: string): Set<string> {
  const ids = new Set(wing.rooms.map((r) => r.id))
  const seen = new Set<string>()
  if (!ids.has(from)) return seen
  const queue = [from]
  seen.add(from)
  while (queue.length > 0) {
    const cur = queue.shift() as string
    for (const d of roomOf(wing, cur)?.doors ?? []) {
      if (ids.has(d.to) && !seen.has(d.to)) {
        seen.add(d.to)
        queue.push(d.to)
      }
    }
  }
  return seen
}

/** Whether a key room can be reached from `from`. */
export const canReachKey = (wing: Pick<MazeWing, 'rooms'>, from: string): boolean => {
  const keys = new Set(keyRooms(wing))
  for (const id of reachable(wing, from)) if (keys.has(id)) return true
  return false
}

export interface MazeRoute {
  /** The room the route starts in. */
  from: string
  /** A key room is reached (or the start is one). */
  found: boolean
  /** The rooms of the cheapest route, the start first, the key room last. */
  path: string[]
  /** The room whose door to press next (`door-<next>`), or null at the key room or when no route exists. */
  next: string | null
  /** How many of the doors on the route are still shut. */
  locked: number
}

/**
 * The cheapest route to a key room: a shut door costs 1, an open door (`open` holds `doorKey(from, to)`) costs almost nothing, so the
 * route goes through open doors first; ties keep the author's order of doors. Pure; used by the bot's `route()` helper.
 */
export function routeToKey(wing: Pick<MazeWing, 'rooms'>, from: string, open: ReadonlySet<string> = new Set()): MazeRoute {
  const ids = wing.rooms.map((r) => r.id)
  if (!ids.includes(from)) return { from, found: false, path: [from], next: null, locked: 0 }
  const keys = new Set(keyRooms(wing))
  const cost = new Map<string, number>([[from, 0]])
  const prev = new Map<string, string>()
  const done = new Set<string>()
  for (;;) {
    let cur: string | undefined
    for (const id of ids) if (cost.has(id) && !done.has(id) && (cur === undefined || (cost.get(id) as number) < (cost.get(cur) as number))) cur = id
    if (cur === undefined) break
    done.add(cur)
    for (const d of roomOf(wing, cur)?.doors ?? []) {
      if (!ids.includes(d.to)) continue
      const c = (cost.get(cur) as number) + (open.has(doorKey(cur, d.to)) ? 0.001 : 1)
      if (c < (cost.get(d.to) ?? Infinity) - 1e-9) {
        cost.set(d.to, c)
        prev.set(d.to, cur)
      }
    }
  }
  let target: string | undefined
  for (const id of ids) if (keys.has(id) && cost.has(id) && (target === undefined || (cost.get(id) as number) < (cost.get(target) as number))) target = id
  if (target === undefined) return { from, found: false, path: [from], next: null, locked: 0 }
  const path = [target]
  while (path[0] !== from) path.unshift(prev.get(path[0] as string) as string)
  let locked = 0
  for (let i = 0; i + 1 < path.length; i++) if (!open.has(doorKey(path[i] as string, path[i + 1] as string))) locked++
  return { from, found: true, path, next: path[1] ?? null, locked }
}

// ---- the checks ----

const textRefsOf = (c: z.infer<typeof character> | undefined, path: string): TextRef[] =>
  c
    ? [
        { path: `${path}.name`, key: c.name, role: 'string' },
        { path: `${path}.line`, key: c.line, role: 'string' },
        ...(c.hint ? [{ path: `${path}.hint`, key: c.hint, role: 'string' as const }] : []),
        ...(c.right ? [{ path: `${path}.right`, key: c.right, role: 'string' as const }] : []),
        ...(c.wrong ? [{ path: `${path}.wrong`, key: c.wrong, role: 'string' as const }] : [])
      ]
    : []

function textRefs(s: MindmazeSection): TextRef[] {
  const out: TextRef[] = []
  s.wings.forEach((w, wi) => {
    out.push({ path: `wings[${wi}].name`, key: w.name, role: 'string' })
    if (w.description) out.push({ path: `wings[${wi}].description`, key: w.description, role: 'string' })
    w.rooms.forEach((r, ri) => {
      const at = `wings[${wi}].rooms[${ri}]`
      out.push({ path: `${at}.name`, key: r.name, role: 'string' })
      if (r.description) out.push({ path: `${at}.description`, key: r.description, role: 'string' })
      out.push(...textRefsOf(r.character, `${at}.character`))
    })
  })
  if (s.throne?.name) out.push({ path: 'throne.name', key: s.throne.name, role: 'string' })
  if (s.throne?.description) out.push({ path: 'throne.description', key: s.throne.description, role: 'string' })
  return out
}

function assetRefs(s: MindmazeSection): { path: string; id: string }[] {
  const out: { path: string; id: string }[] = []
  s.wings.forEach((w, wi) =>
    w.rooms.forEach((r, ri) => {
      if (r.asset) out.push({ path: `wings[${wi}].rooms[${ri}].asset`, id: r.asset })
      if (r.character?.portrait) out.push({ path: `wings[${wi}].rooms[${ri}].character.portrait`, id: r.character.portrait })
    })
  )
  return out
}

/** References and duplicates: what the build cannot go on without. */
function validate(s: MindmazeSection, pack: CoursePack): Problem[] {
  const out: Problem[] = []
  const units = new Set(pack.units.map((u) => u.id))
  const items = new Set(pack.items.map((i) => i.id))
  const objectives = new Set(pack.objectives.map((o) => o.id))
  const wingIds = new Set<string>()
  s.wings.forEach((w, wi) => {
    const wat = `wings[${wi}]`
    if (wingIds.has(w.id)) out.push({ code: 'MAZE_DUPLICATE', path: `${wat}.id`, message: `two wings are called "${w.id}"` })
    wingIds.add(w.id)
    if (!units.has(w.unit)) out.push({ code: 'MAZE_WING_UNIT_MISSING', path: `${wat}.unit`, message: `the wing "${w.id}" belongs to the unit "${w.unit}", which the course does not have` })
    const rooms = new Set<string>()
    for (const [ri, r] of w.rooms.entries()) {
      if (rooms.has(r.id)) out.push({ code: 'MAZE_DUPLICATE', path: `${wat}.rooms[${ri}].id`, message: `two rooms of the wing "${w.id}" are called "${r.id}"` })
      rooms.add(r.id)
    }
    if (!rooms.has(w.entry)) out.push({ code: 'MAZE_ENTRY_MISSING', path: `${wat}.entry`, message: `the entrance "${w.entry}" is not a room of the wing "${w.id}"` })
    w.rooms.forEach((r, ri) => {
      const rat = `${wat}.rooms[${ri}]`
      if (r.objective && !objectives.has(r.objective)) out.push({ code: 'MAZE_OBJECTIVE_MISSING', path: `${rat}.objective`, message: `unknown objective "${r.objective}"` })
      const targets = new Set<string>()
      r.doors.forEach((d, di) => {
        const dat = `${rat}.doors[${di}]`
        if (!rooms.has(d.to)) out.push({ code: 'MAZE_DOOR_TARGET_MISSING', path: `${dat}.to`, message: `the door of "${r.id}" leads to "${d.to}", which is not a room of the wing "${w.id}"` })
        if (targets.has(d.to)) out.push({ code: 'MAZE_DUPLICATE', path: `${dat}.to`, message: `"${r.id}" has two doors to "${d.to}"` })
        targets.add(d.to)
        d.items.forEach((id, ii) => {
          if (!items.has(id)) out.push({ code: 'MAZE_DOOR_ITEM_MISSING', path: `${dat}.items[${ii}]`, message: `the door to "${d.to}" asks the unknown item "${id}"` })
        })
      })
    })
  })
  return out
}

const wingProblems = (wing: MazeWing, at: string, out: ShellLintProblem[], pack: CoursePack): void => {
  const rooms = new Set(wing.rooms.map((r) => r.id))
  if (!rooms.has(wing.entry)) return // MAZE_ENTRY_MISSING from the validator
  const keys = keyRooms(wing)
  const seen = reachable(wing, wing.entry)
  wing.rooms.forEach((r, ri) => {
    const rat = `${at}.rooms[${ri}]`
    if (!seen.has(r.id)) out.push({ code: 'MAZE_ROOM_UNREACHABLE', path: rat, message: `the room "${r.id}" of the wing "${wing.id}" cannot be reached from the entrance "${wing.entry}"` })
    r.doors.forEach((d, di) => {
      if (rooms.has(d.to) && d.items.length === 0) out.push({ code: 'MAZE_DOOR_NO_ITEMS', path: `${rat}.doors[${di}]`, message: `the door from "${r.id}" to "${d.to}" has no question to ask (list items, or give the room beyond an objective)` })
      for (const id of d.items) {
        const objective = pack.items.find((i) => i.id === id)?.objective
        const unit = pack.objectives.find((o) => o.id === objective)?.unit
        if (unit && unit !== wing.unit) out.push({ code: 'MAZE_DOOR_ITEM_OTHER_UNIT', severity: 'warning', path: `${rat}.doors[${di}]`, message: `the door to "${d.to}" asks "${id}", which belongs to the unit "${unit}", not to the wing's unit "${wing.unit}"` })
      }
    })
  })
  if (keys.length === 0) {
    out.push({ code: 'MAZE_NO_KEY_ROOM', path: at, message: `the wing "${wing.id}" has no key room (a room with key: true), so it can never be won` })
    return
  }
  if (keys.includes(wing.entry)) out.push({ code: 'MAZE_KEY_AT_ENTRY', path: at, message: `the key of the wing "${wing.id}" lies in the entrance hall: no door would ask a question` })
  if (!keys.some((k) => seen.has(k))) {
    out.push({ code: 'MAZE_KEY_UNREACHABLE', path: at, message: `no key room of the wing "${wing.id}" can be reached from the entrance` })
    return
  }
  wing.rooms.forEach((r, ri) => {
    if (seen.has(r.id) && !canReachKey(wing, r.id)) out.push({ code: 'MAZE_DEAD_END', path: `${at}.rooms[${ri}]`, message: `from the room "${r.id}" no door leads on to a key room: a learner who walks in is stuck` })
  })
}

function lint(section: MindmazeSection | undefined, ctx: { pack: CoursePack }): ShellLintProblem[] {
  const out: ShellLintProblem[] = []
  const { pack } = ctx
  if ((section?.torches ?? DEFAULT_TORCHES) < 1) out.push({ code: 'MAZE_TOO_FEW_TORCHES', severity: 'warning', path: 'torches', message: 'with fewer than 1 torch the first wrong answer already sends the learner back to the entrance' })
  const authored = section?.wings ?? []
  const maze = resolveMaze(pack, section)
  for (const u of pack.units) {
    if (authored.length > 0 && !authored.some((w) => w.unit === u.id)) out.push({ code: 'MAZE_UNIT_NO_WING', path: 'wings', message: `no wing of the section covers the unit "${u.id}": the castle builds an automatic wing for it, but a unit no authored wing covers is easy to forget` })
  }
  maze.wings.forEach((w) => {
    const index = w.auto ? -1 : authored.findIndex((a) => a.id === w.id)
    wingProblems(w, index < 0 ? `auto[${w.id}]` : `wings[${index}]`, out, pack)
  })
  return out
}

export const mindmazeShell: ShellDef<MindmazeSection> = {
  id: 'mindmaze',
  theme: 'castle',
  requiresSection: false,
  schema: mindmazeSectionSchema,
  textRefs,
  assetRefs,
  validate,
  lint,
  codes: MAZE_CODES,
  warnings: MAZE_WARNINGS
}
