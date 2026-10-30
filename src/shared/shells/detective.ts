import { z } from 'zod'
import type { CoursePack } from '../course'
import type { Problem, TextRef } from '../edu/registry'
import { normalizeText } from '../edu/match'
import { buildCase, CASE_BANDS, CASE_KINDS, CASE_SIZES, entityIds, type BuiltCase, type CaseParams } from './detective-case'
import type { ShellDef, ShellLintContext, ShellLintProblem } from './types'

/**
 * The course section of the detective shell (`pack.shells.config['detective']`, EGS-14): escape rooms (one per unit, each a locked door
 * with a case on it, plus a final room) and optionally a Carmen-Sandiego chase across places on a map. A case is a generated, PROVED
 * puzzle (VN Studio's generator, `src/shared/puzzles`) whose entities are course things named by catalog keys; its clue cards are turned
 * by answering course items. See `docs/player.md`, "Detective".
 *
 * Lint codes (prefix `DET_`): DET_UNIT_NO_ROOM, DET_ROOM_UNIT_MISSING, DET_FINAL_MISSING, DET_PUZZLE_INVALID, DET_PUZZLE_NOT_UNIQUE,
 * DET_PUZZLE_UNSOLVABLE, DET_NAME_MISSING, DET_CLUE_ITEM_MISSING, DET_TOO_FEW_CLUE_ITEMS, DET_CHASE_PLACE_MISSING, DET_CHASE_ROUTE_BROKEN,
 * DET_CHASE_ITEM_MISSING, DET_CHASE_FEW_DECOYS and the warning DET_ALIAS_NOT_FACT.
 */

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'an id of letters, digits, dots, dashes and underscores')
const key = z.string().min(1)

export const caseSchema = z.strictObject({
  /** The puzzle kinds the shell plays: grids (Murdle, logic grid). */
  kind: z.enum(CASE_KINDS).default('murdle'),
  /** Items per category (3 or 4). */
  size: z.number().int().min(CASE_SIZES[0]).max(CASE_SIZES[CASE_SIZES.length - 1] as number).default(3),
  /** The generator's seed; the next seeds are tried when it cannot make (or prove) the puzzle. */
  seed: z.number().int().min(0).default(1),
  band: z.enum(CASE_BANDS).default('easy'),
  /** Entity id of the generated puzzle (`s1` `w2` `p3`; logic: `d1` `c1` `k1` `t1`) -> catalog key of its name. */
  names: z.record(z.string(), key),
  /** Entity id -> catalog key of a fact-coded alias ("the planet with the fastest winds"): the clue sentences use it instead of the name. */
  aliases: z.record(z.string(), key).default({}),
  /** Category key (`suspect`, `weapon`, `place`; logic `day` ...) -> catalog key of its label. */
  labels: z.record(z.string(), key).default({}),
  /** The course items that turn the clue cards (at least as many as the case has clues). */
  items: z.array(id).min(1)
})
export type CaseSection = z.infer<typeof caseSchema>

export const roomSchema = z.strictObject({
  id,
  /** The unit this room is the escape room of; a room without a unit is the final room (the boss: its items come from every unit). */
  unit: id.optional(),
  title: key,
  /** The story that sets the scene. */
  story: key,
  case: caseSchema
})
export type RoomSection = z.infer<typeof roomSchema>

export const placeSchema = z.strictObject({
  id,
  /** Catalog key of the place's name. */
  name: key,
  /** The pin on the map, in the map's own coordinates (the asset's 800 x 600 for the capitals fixture). */
  x: z.number(),
  y: z.number()
})

export const legSchema = z.strictObject({
  from: id,
  to: id,
  /** The clue item: answered to hear the witness. */
  item: id,
  /** Places she did NOT go to (1 or more; shown beside the right one as the choice of where to travel). */
  decoys: z.array(id).max(5),
  /** Catalog key of the witness's words (a course fact about the next place); default: the item's did-you-know, else its explanation. */
  clue: key.optional()
})

export const chaseSchema = z.strictObject({
  /** The unit the chase is the challenge of (its stars count towards it). Without it, `final: true` makes it the final challenge. */
  unit: id.optional(),
  final: z.boolean().default(false),
  /** Catalog key: who is being chased. */
  suspect: key,
  title: key.optional(),
  story: key.optional(),
  start: id,
  places: z.array(placeSchema).min(2),
  route: z.array(legSchema).min(1),
  /** The asset id of the map picture. */
  map: id,
  /** The size of the map picture in the units of the pin coordinates (default 800 x 600, the capitals fixture's map). */
  width: z.number().positive().default(800),
  height: z.number().positive().default(600)
})
export type ChaseSection = z.infer<typeof chaseSchema>

export const detectiveSectionSchema = z.strictObject({
  rooms: z.array(roomSchema).min(1),
  /** The id of the final room (the case that mixes every unit). Optional when the chase is the final challenge (`chase.final`). */
  final: id.optional(),
  chase: chaseSchema.optional()
})
export type DetectiveSection = z.infer<typeof detectiveSectionSchema>

export const DET_CODES = [
  'DET_UNIT_NO_ROOM',
  'DET_ROOM_UNIT_MISSING',
  'DET_FINAL_MISSING',
  'DET_PUZZLE_INVALID',
  'DET_PUZZLE_NOT_UNIQUE',
  'DET_PUZZLE_UNSOLVABLE',
  'DET_NAME_MISSING',
  'DET_CLUE_ITEM_MISSING',
  'DET_TOO_FEW_CLUE_ITEMS',
  'DET_CHASE_PLACE_MISSING',
  'DET_CHASE_ROUTE_BROKEN',
  'DET_CHASE_ITEM_MISSING',
  'DET_CHASE_FEW_DECOYS',
  'DET_ALIAS_NOT_FACT'
] as const

/** The place the route ends at (the suspect is caught there). */
export const chaseEnd = (c: Pick<ChaseSection, 'route'>): string => (c.route[c.route.length - 1] as { to: string }).to

/** The final room: the one `final` names. */
export const finalRoom = (s: DetectiveSection): RoomSection | undefined => s.rooms.find((r) => r.id === s.final)

/** The case parameters of a room (what `buildCase` takes). */
export const caseParams = (c: CaseSection): CaseParams => ({ kind: c.kind, size: c.size, seed: c.seed, band: c.band })

// ---- the validator's part (blocks the build) ----

function textRefs(s: DetectiveSection): TextRef[] {
  const out: TextRef[] = []
  const add = (path: string, k: string | undefined): void => {
    if (k) out.push({ path, key: k, role: 'string' })
  }
  s.rooms.forEach((r, i) => {
    add(`rooms[${i}].title`, r.title)
    add(`rooms[${i}].story`, r.story)
    for (const [e, k] of Object.entries(r.case.names)) add(`rooms[${i}].case.names.${e}`, k)
    for (const [e, k] of Object.entries(r.case.aliases)) add(`rooms[${i}].case.aliases.${e}`, k)
    for (const [c, k] of Object.entries(r.case.labels)) add(`rooms[${i}].case.labels.${c}`, k)
  })
  if (s.chase) {
    add('chase.suspect', s.chase.suspect)
    add('chase.title', s.chase.title)
    add('chase.story', s.chase.story)
    s.chase.places.forEach((p, i) => add(`chase.places[${i}].name`, p.name))
    s.chase.route.forEach((l, i) => add(`chase.route[${i}].clue`, l.clue))
  }
  return out
}

function validate(s: DetectiveSection, pack: CoursePack): Problem[] {
  const out: Problem[] = []
  const items = new Set(pack.items.map((i) => i.id))
  const units = new Set(pack.units.map((u) => u.id))
  const seen = new Set<string>()
  s.rooms.forEach((r, i) => {
    if (seen.has(r.id)) out.push({ code: 'DUPLICATE_ID', path: `rooms[${i}].id`, message: `the room id "${r.id}" is used twice` })
    seen.add(r.id)
    if (r.unit !== undefined && !units.has(r.unit)) out.push({ code: 'UNKNOWN_UNIT', path: `rooms[${i}].unit`, message: `unknown unit "${r.unit}"` })
    r.case.items.forEach((it, j) => {
      if (!items.has(it)) out.push({ code: 'UNKNOWN_ITEM', path: `rooms[${i}].case.items[${j}]`, message: `unknown item "${it}"` })
    })
  })
  if (s.final !== undefined && !seen.has(s.final)) out.push({ code: 'UNKNOWN_ROOM', path: 'final', message: `unknown room "${s.final}"` })
  if (s.chase) {
    if (s.chase.unit !== undefined && !units.has(s.chase.unit)) out.push({ code: 'UNKNOWN_UNIT', path: 'chase.unit', message: `unknown unit "${s.chase.unit}"` })
    s.chase.route.forEach((l, i) => {
      if (!items.has(l.item)) out.push({ code: 'UNKNOWN_ITEM', path: `chase.route[${i}].item`, message: `unknown item "${l.item}"` })
    })
  }
  return out
}

const assetRefs = (s: DetectiveSection): { path: string; id: string }[] => (s.chase ? [{ path: 'chase.map', id: s.chase.map }] : [])

// ---- the lint (playability and proofs) ----

export interface LintDeps {
  /** The case builder (tests inject one that fails, to prove the DET_PUZZLE_* codes fire). */
  build?: (p: CaseParams) => BuiltCase
}

/** Every string value of an item that is a text key, resolved to its text in an edition. */
function itemTexts(item: unknown, resolve: (key: string) => string | undefined): string[] {
  const out: string[] = []
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      const t = resolve(v)
      if (t) out.push(t)
    } else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(item)
  return out
}

export function lintDetective(section: DetectiveSection | undefined, ctx: ShellLintContext, deps: LintDeps = {}): ShellLintProblem[] {
  if (!section) return []
  const out: ShellLintProblem[] = []
  const add = (code: string, path: string, message: string, extra: Partial<ShellLintProblem> = {}): void => void out.push({ code, path, message, ...extra })
  const pack = ctx.pack
  const units = new Set(pack.units.map((u) => u.id))
  const itemsById = new Map(pack.items.map((i) => [i.id, i]))
  const build = deps.build ?? ((p: CaseParams) => buildCase(p))

  // ---- rooms and units ----
  if (section.final === undefined) {
    if (!section.chase?.final) add('DET_FINAL_MISSING', 'final', 'the section has no final room (`final`) and the chase is not the final challenge (`chase.final`)')
  } else if (!section.rooms.some((r) => r.id === section.final)) add('DET_FINAL_MISSING', 'final', `the final room "${section.final}" does not exist`)
  const unitsWithRoom = new Set<string>()
  section.rooms.forEach((r, i) => {
    if (r.unit !== undefined) {
      if (!units.has(r.unit)) add('DET_ROOM_UNIT_MISSING', `rooms[${i}].unit`, `the room "${r.id}" belongs to the unit "${r.unit}", which the course does not have`)
      else unitsWithRoom.add(r.unit)
    } else if (r.id !== section.final) add('DET_ROOM_UNIT_MISSING', `rooms[${i}]`, `the room "${r.id}" has no unit and is not the final room`)
  })
  for (const u of pack.units) if (!unitsWithRoom.has(u.id)) add('DET_UNIT_NO_ROOM', 'rooms', `the unit "${u.id}" has no escape room`)

  // ---- cases: proved, named, with enough clue items ----
  section.rooms.forEach((r, i) => {
    const at = `rooms[${i}].case`
    const c = r.case
    let built: BuiltCase | null = null
    try {
      built = build(caseParams(c))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/exactly one solution/i.test(msg)) add('DET_PUZZLE_NOT_UNIQUE', at, `the puzzle of room "${r.id}" does not have exactly one solution (${msg})`)
      else if (/deduction/i.test(msg)) add('DET_PUZZLE_UNSOLVABLE', at, `the puzzle of room "${r.id}" cannot be solved by deduction alone (${msg})`)
      else add('DET_PUZZLE_INVALID', at, `no ${c.kind} puzzle of size ${c.size}, band ${c.band} could be made from seed ${c.seed} (${msg})`)
    }
    if (built) {
      for (const e of entityIds(built.puzzle)) if (!c.names[e]) add('DET_NAME_MISSING', `${at}.names`, `the entity "${e}" of the puzzle of room "${r.id}" has no name`)
    }
    const askable = new Set<string>()
    c.items.forEach((it, j) => {
      if (!itemsById.has(it)) add('DET_CLUE_ITEM_MISSING', `${at}.items[${j}]`, `the clue item "${it}" does not exist`)
      else askable.add(it)
    })
    if (built && askable.size < built.puzzle.clues.length) add('DET_TOO_FEW_CLUE_ITEMS', `${at}.items`, `room "${r.id}" has ${built.puzzle.clues.length} clue cards but only ${askable.size} clue items`)
    // an alias must be a course fact: its entity is something an item of the room asks about (its name appears in an item's texts)
    for (const [e, aliasKey] of Object.entries(c.aliases)) {
      const nameKey = c.names[e]
      if (!nameKey) continue
      for (const lang of ctx.editions) {
        const res = ctx.resolvers[lang]
        const name = res?.text(nameKey)
        if (!res || !name) continue
        const needle = normalizeText(name, { fold: true })
        const asked = [...askable].some((it) => itemTexts(itemsById.get(it), (k) => res.text(k)).some((t) => normalizeText(t, { fold: true }).includes(needle)))
        if (!asked) add('DET_ALIAS_NOT_FACT', `${at}.aliases.${e}`, `the alias "${res.text(aliasKey) ?? aliasKey}" stands for "${name}", but no item of room "${r.id}" asks about it (${lang})`, { severity: 'warning', lang })
      }
    }
  })

  // ---- the chase ----
  const ch = section.chase
  if (ch) {
    const places = new Set(ch.places.map((p) => p.id))
    if (!places.has(ch.start)) add('DET_CHASE_PLACE_MISSING', 'chase.start', `the start "${ch.start}" is not one of the places`)
    ch.route.forEach((l, i) => {
      const at = `chase.route[${i}]`
      if (!places.has(l.from)) add('DET_CHASE_PLACE_MISSING', `${at}.from`, `the place "${l.from}" does not exist`)
      if (!places.has(l.to)) add('DET_CHASE_PLACE_MISSING', `${at}.to`, `the place "${l.to}" does not exist`)
      l.decoys.forEach((d, j) => {
        if (!places.has(d)) add('DET_CHASE_PLACE_MISSING', `${at}.decoys[${j}]`, `the decoy "${d}" is not one of the places`)
      })
      if (!itemsById.has(l.item)) add('DET_CHASE_ITEM_MISSING', `${at}.item`, `the clue item "${l.item}" does not exist`)
      if (new Set(l.decoys.filter((d) => d !== l.to)).size < 1) add('DET_CHASE_FEW_DECOYS', `${at}.decoys`, `the leg ${l.from} -> ${l.to} needs at least 1 decoy place (other than ${l.to})`)
    })
    // the route leads from the start to the end, leg by leg, never visiting a place twice
    const visited = new Set<string>([ch.start])
    let here = ch.start
    ch.route.forEach((l, i) => {
      if (l.from !== here) add('DET_CHASE_ROUTE_BROKEN', `chase.route[${i}].from`, `the leg ${i + 1} starts at "${l.from}" but the trail is at "${here}"`)
      if (visited.has(l.to)) add('DET_CHASE_ROUTE_BROKEN', `chase.route[${i}].to`, `the trail goes back to "${l.to}", a place it has already visited`)
      visited.add(l.to)
      here = l.to
    })
    if (ch.unit !== undefined && !units.has(ch.unit)) add('DET_ROOM_UNIT_MISSING', 'chase.unit', `the chase belongs to the unit "${ch.unit}", which the course does not have`)
    if (ch.unit === undefined && !ch.final) add('DET_FINAL_MISSING', 'chase', 'the chase is neither the challenge of a unit (`unit`) nor the final challenge (`final`)')
  }
  return out
}

export const detectiveShell: ShellDef<DetectiveSection> = {
  id: 'detective',
  theme: 'noir',
  requiresSection: true,
  schema: detectiveSectionSchema,
  textRefs: (s) => textRefs(s),
  assetRefs,
  validate,
  lint: (s, ctx) => lintDetective(s, ctx),
  codes: DET_CODES,
  warnings: ['DET_ALIAS_NOT_FACT']
}
