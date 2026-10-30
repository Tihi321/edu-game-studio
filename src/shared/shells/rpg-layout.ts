import { z } from 'zod'
import { idSchema, keySchema, objectivesOf, unitOrder, type CoursePack } from '../course'
import { generateMap, isWalkable, parseMap, tileAt, type Pos } from './rpg-map'

/**
 * The course section of the RPG shell (`pack.shells.config.rpg`) and the LAYOUT the player plays: the authored areas of the section, plus
 * an automatic area (a seeded procedural map, a sage, a foe per objective, a boss) for every unit the section does not cover, or for
 * every unit when the course has no section. Pure: the lint, the player and the tests share it.
 *
 * Every visible string of the section is a catalog key (`rpg.*`), so Book Translator translates it with the rest. A person or area
 * WITHOUT a key (an automatic one) is named by the player from the shell's own words.
 */

export const DEFAULT_FOE_HP = 200
export const DEFAULT_BOSS_HP = 400
export const DEFAULT_FINAL_HP = 800
export const DEFAULT_FINAL_SIZE = 10

const posSchema = z.tuple([z.number().int().min(0).max(99), z.number().int().min(0).max(99)])
const hpSchema = (fallback: number) => z.number().int().min(10).max(5000).default(fallback)

export const rpgNpcSchema = z.strictObject({
  id: idSchema,
  name: keySchema,
  at: posSchema,
  /** The lines the person says, in order (catalog keys). */
  lines: z.array(keySchema).default([]),
  /** The quest giver of the area (the one who offers the quest). */
  quest: z.boolean().default(false),
  /** An image asset used as the portrait (phase 6; a procedural portrait without it). */
  portrait: idSchema.optional()
})

export const rpgFoeSchema = z.strictObject({
  id: idSchema,
  name: keySchema,
  at: posSchema,
  hp: hpSchema(DEFAULT_FOE_HP),
  /** The items asked in this foe's battle: its moves are the answers. */
  items: z.array(idSchema).default([]),
  /** An image asset used as the sprite (phase 6). */
  sprite: idSchema.optional()
})

export const rpgBossSchema = z.strictObject({
  id: idSchema,
  name: keySchema,
  at: posSchema,
  hp: hpSchema(DEFAULT_BOSS_HP),
  sprite: idSchema.optional()
})

export const rpgAreaSchema = z.strictObject({
  id: idSchema,
  /** The unit this area belongs to: its quest teaches that unit. */
  unit: idSchema,
  name: keySchema,
  /** The tile map, one string per row: `#` wall, `.` floor, `,` path, `T` tree, `~` water, `@` start, `N` NPC spot, `B` boss spot, `G` gate. */
  map: z.array(z.string().min(1).regex(/^[#.,T~@NBG]+$/, 'map characters are # . , T ~ @ N B G')).min(3).max(40),
  npcs: z.array(rpgNpcSchema).default([]),
  foes: z.array(rpgFoeSchema).default([]),
  boss: rpgBossSchema
})

export const rpgSectionSchema = z.strictObject({
  hero: z.strictObject({ name: keySchema }).optional(),
  story: z.strictObject({ intro: z.array(keySchema).default([]), outro: z.array(keySchema).default([]) }).default({ intro: [], outro: [] }),
  /** An image asset: a sheet of 16 x 16 tiles (grass, path, water, water 2, tree, wall, gate shut, gate open) used instead of the procedural tiles (phase 6). */
  tileset: idSchema.optional(),
  /** Image assets used instead of the procedural sprites (phase 6). */
  sprites: z.strictObject({ hero: idSchema.optional(), npc: idSchema.optional(), foe: idSchema.optional(), boss: idSchema.optional() }).optional(),
  areas: z.array(rpgAreaSchema).default([]),
  /** The last battle: every unit mixed. */
  finalBoss: z.strictObject({ name: keySchema.optional(), hp: hpSchema(DEFAULT_FINAL_HP), size: z.number().int().min(4).max(20).default(DEFAULT_FINAL_SIZE) }).optional()
})

export type RpgSection = z.infer<typeof rpgSectionSchema>
export type RpgAreaSection = z.infer<typeof rpgAreaSchema>

// ---- the layout ----

export interface RpgNpc {
  id: string
  /** A catalog key; undefined for an automatic person (the player names it). */
  nameKey?: string
  at: Pos
  /** Catalog keys of the lines; empty for the automatic sage (the player uses the shell's words). */
  lines: string[]
  quest: boolean
  portrait?: string
}

export interface RpgFoe {
  id: string
  nameKey?: string
  at: Pos
  hp: number
  items: string[]
  /** 1-based number of the foe in the area (names the automatic ones). */
  n: number
  sprite?: string
}

export interface RpgBoss {
  id: string
  nameKey?: string
  at: Pos
  hp: number
  sprite?: string
}

export interface RpgArea {
  id: string
  unitId: string
  nameKey?: string
  rows: string[]
  start: Pos
  /** The gate tile, or null when the map has none (the quest then opens the way on). */
  gate: Pos | null
  npcs: RpgNpc[]
  foes: RpgFoe[]
  boss: RpgBoss
  /** Made by the player (no authored section for this unit). */
  auto: boolean
}

export interface RpgLayout {
  areas: RpgArea[]
  heroNameKey?: string
  intro: string[]
  outro: string[]
  finalBoss: { nameKey?: string; hp: number; size: number }
  tileset?: string
  sprites: { hero?: string; npc?: string; foe?: string; boss?: string }
  /** The course has an authored section. */
  authored: boolean
}

/** The first walkable tile (a start for a map that lacks `@`, so the player still plays what the lint flags). */
function firstWalkable(rows: readonly string[]): Pos {
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < (rows[y]?.length ?? 0); x++) if (isWalkable(tileAt(rows, [x, y]))) return [x, y]
  return [0, 0]
}

/** An authored area as the layout shape (no checks: the lint and the validator do those). */
export function authoredArea(a: RpgAreaSection): RpgArea {
  const m = parseMap(a.map)
  return {
    id: a.id,
    unitId: a.unit,
    nameKey: a.name,
    rows: [...a.map],
    start: m.start ?? firstWalkable(a.map),
    gate: m.gate,
    npcs: a.npcs.map((n) => ({ id: n.id, nameKey: n.name, at: n.at, lines: [...n.lines], quest: n.quest, ...(n.portrait ? { portrait: n.portrait } : {}) })),
    foes: a.foes.map((f, i) => ({ id: f.id, nameKey: f.name, at: f.at, hp: f.hp, items: [...f.items], n: i + 1, ...(f.sprite ? { sprite: f.sprite } : {}) })),
    boss: { id: a.boss.id, nameKey: a.boss.name, at: a.boss.at, hp: a.boss.hp, ...(a.boss.sprite ? { sprite: a.boss.sprite } : {}) },
    auto: false
  }
}

/** The ids of the items asked for a unit (through its objectives), in pack order. */
export function unitItemIds(pack: Pick<CoursePack, 'items' | 'objectives'>, unitId: string): string[] {
  const objs = new Set(objectivesOf(pack, unitId).map((o) => o.id))
  return pack.items.filter((i) => objs.has(i.objective)).map((i) => i.id)
}

/** How many foes an automatic area has: one per objective, at most four (more objectives share a foe). */
export const MAX_AUTO_FOES = 4

/** The automatic area of a unit: a seeded map (the same course always gets the same map), a sage, a foe per objective and a boss. */
export function autoArea(pack: Pick<CoursePack, 'id' | 'items' | 'objectives'>, unitId: string): RpgArea {
  const objs = objectivesOf(pack, unitId)
  const foeCount = Math.max(1, Math.min(MAX_AUTO_FOES, objs.length))
  const groups: string[][] = Array.from({ length: foeCount }, () => [])
  objs.forEach((o, i) => {
    const bucket = groups[i % foeCount] as string[]
    for (const it of pack.items) if (it.objective === o.id) bucket.push(it.id)
  })
  const map = generateMap(`${pack.id}:${unitId}`, foeCount)
  return {
    id: unitId,
    unitId,
    rows: map.rows,
    start: map.start,
    gate: map.gate,
    npcs: [{ id: `n-${unitId}`, at: map.npc, lines: [], quest: true }],
    foes: map.foes.map((at, i) => ({ id: `f-${unitId}-${i + 1}`, at, hp: DEFAULT_FOE_HP, items: groups[i] ?? [], n: i + 1 })),
    boss: { id: `b-${unitId}`, at: map.boss, hp: DEFAULT_BOSS_HP },
    auto: true
  }
}

/**
 * The layout the player plays: the section's areas (those whose unit exists), then an automatic area for every unit that has none, in
 * prerequisite order. `section` undefined: every unit gets an automatic area.
 */
export function buildLayout(pack: Pick<CoursePack, 'id' | 'units' | 'items' | 'objectives'>, section: RpgSection | undefined): RpgLayout {
  const unitIds = new Set(pack.units.map((u) => u.id))
  const authored = (section?.areas ?? []).filter((a) => unitIds.has(a.unit)).map(authoredArea)
  const covered = new Set(authored.map((a) => a.unitId))
  const order = unitOrder(pack.units)
  // authored areas in the order of the course's units where they cover one, the rest in their own order; automatic areas fill the gaps
  const byUnit = new Map<string, RpgArea[]>()
  for (const a of authored) byUnit.set(a.unitId, [...(byUnit.get(a.unitId) ?? []), a])
  const areas: RpgArea[] = []
  for (const u of order) {
    if (byUnit.has(u)) areas.push(...(byUnit.get(u) as RpgArea[]))
    else if (!covered.has(u)) areas.push(autoArea(pack, u))
  }
  return {
    areas,
    ...(section?.hero ? { heroNameKey: section.hero.name } : {}),
    intro: section?.story.intro ?? [],
    outro: section?.story.outro ?? [],
    finalBoss: { ...(section?.finalBoss?.name ? { nameKey: section.finalBoss.name } : {}), hp: section?.finalBoss?.hp ?? DEFAULT_FINAL_HP, size: section?.finalBoss?.size ?? DEFAULT_FINAL_SIZE },
    ...(section?.tileset ? { tileset: section.tileset } : {}),
    sprites: section?.sprites ?? {},
    authored: section !== undefined
  }
}
