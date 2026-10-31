import type { CoursePack } from '../course'
import type { Problem, TextRef } from '../edu/registry'
import { authoredArea, buildLayout, rpgSectionSchema, unitItemIds, type RpgArea, type RpgSection } from './rpg-layout'
import { canReachSpot, isWalkable, parseMap, samePos, tileAt, type Pos } from './rpg-map'
import type { ShellDef, ShellLintContext, ShellLintProblem } from './types'

/**
 * The course section of the RPG shell (`pack.shells.config.rpg`, EGS-12): the schema and the layout are in `rpg-layout.ts`, the tile
 * logic in `rpg-map.ts`. This file is the definition the registry reads: text keys, assets, structural checks (they block the build) and
 * the playability lint (codes `RPG_*`: every person reachable on the map, every battle winnable, every dialogue has lines).
 */

export { rpgSectionSchema, type RpgSection } from './rpg-layout'

export const RPG_ERROR_CODES = [
  'RPG_AREA_UNIT_MISSING',
  'RPG_UNIT_NO_AREA',
  'RPG_MAP_RAGGED',
  'RPG_MAP_NO_START',
  'RPG_MAP_UNREACHABLE',
  'RPG_SPOT_BLOCKED',
  'RPG_NO_QUEST_GIVER',
  'RPG_FOE_ITEM_MISSING',
  'RPG_FOE_NO_ITEMS',
  'RPG_DIALOGUE_EMPTY',
  'RPG_QUEST_UNWINNABLE'
] as const
export const RPG_WARNING_CODES = ['RPG_FOE_ITEM_OTHER_UNIT', 'RPG_NO_STORY'] as const

function textRefs(s: RpgSection): TextRef[] {
  const out: TextRef[] = []
  const add = (path: string, key: string | undefined): void => {
    if (key) out.push({ path, key, role: 'string' })
  }
  add('hero.name', s.hero?.name)
  s.story.intro.forEach((k, i) => add(`story.intro[${i}]`, k))
  s.story.outro.forEach((k, i) => add(`story.outro[${i}]`, k))
  add('finalBoss.name', s.finalBoss?.name)
  s.areas.forEach((a, i) => {
    add(`areas[${i}].name`, a.name)
    a.npcs.forEach((n, j) => {
      add(`areas[${i}].npcs[${j}].name`, n.name)
      n.lines.forEach((k, l) => add(`areas[${i}].npcs[${j}].lines[${l}]`, k))
    })
    a.foes.forEach((f, j) => add(`areas[${i}].foes[${j}].name`, f.name))
    add(`areas[${i}].boss.name`, a.boss.name)
  })
  return out
}

function assetRefs(s: RpgSection): { path: string; id: string }[] {
  const out: { path: string; id: string }[] = []
  if (s.tileset) out.push({ path: 'tileset', id: s.tileset })
  for (const k of ['hero', 'npc', 'foe', 'boss'] as const) if (s.sprites?.[k]) out.push({ path: `sprites.${k}`, id: s.sprites[k] as string })
  s.areas.forEach((a, i) => {
    a.npcs.forEach((n, j) => n.portrait && out.push({ path: `areas[${i}].npcs[${j}].portrait`, id: n.portrait }))
    a.foes.forEach((f, j) => f.sprite && out.push({ path: `areas[${i}].foes[${j}].sprite`, id: f.sprite }))
    if (a.boss.sprite) out.push({ path: `areas[${i}].boss.sprite`, id: a.boss.sprite })
  })
  return out
}

/** Broken references block the build (the lint repeats them as RPG_* codes with the playability consequences). */
function validate(s: RpgSection, pack: CoursePack): Problem[] {
  const out: Problem[] = []
  const units = new Set(pack.units.map((u) => u.id))
  const items = new Set(pack.items.map((i) => i.id))
  s.areas.forEach((a, i) => {
    if (!units.has(a.unit)) out.push({ code: 'UNKNOWN_UNIT', path: `areas[${i}].unit`, message: `the area "${a.id}" names the unit "${a.unit}", which does not exist` })
    a.foes.forEach((f, j) => f.items.forEach((it, k) => !items.has(it) && out.push({ code: 'UNKNOWN_ITEM', path: `areas[${i}].foes[${j}].items[${k}]`, message: `the foe "${f.id}" asks the item "${it}", which does not exist` })))
  })
  return out
}

type Push = (code: string, path: string, message: string, severity?: 'error' | 'warning') => void

/** The checks of one area (authored or automatic): the map, the people on it, the quest giver, the battles. */
function lintArea(a: RpgArea, path: string, ctx: ShellLintContext, push: Push): void {
  const pack = ctx.pack
  const unitKnown = pack.units.some((u) => u.id === a.unitId)
  const unitItems = new Set(unitKnown ? unitItemIds(pack, a.unitId) : [])
  const m = parseMap(a.rows)
  if (m.ragged) push('RPG_MAP_RAGGED', `${path}.map`, `the rows of the map of "${a.id}" have different widths (${[...new Set(a.rows.map((r) => r.length))].join(', ')})`)
  if (!m.start) push('RPG_MAP_NO_START', `${path}.map`, `the map of "${a.id}" has no start tile "@"`)

  // everyone's spot: on the map, on ground someone can stand on, and alone on it
  const people: { at: Pos; path: string; label: string }[] = [
    ...a.npcs.map((n, j) => ({ at: n.at, path: `${path}.npcs[${j}].at`, label: `the person "${n.id}"` })),
    ...a.foes.map((f, j) => ({ at: f.at, path: `${path}.foes[${j}].at`, label: `the foe "${f.id}"` })),
    { at: a.boss.at, path: `${path}.boss.at`, label: `the boss "${a.boss.id}"` }
  ]
  const blockedSpot = new Set<number>()
  people.forEach((p, i) => {
    const ch = tileAt(a.rows, p.at)
    if (ch === undefined) {
      push('RPG_SPOT_BLOCKED', p.path, `${p.label} stands at ${p.at[0]},${p.at[1]}, outside the map`)
      blockedSpot.add(i)
    } else if (!isWalkable(ch, true) || ch === 'G') {
      push('RPG_SPOT_BLOCKED', p.path, `${p.label} stands on ${ch === '#' ? 'a wall' : ch === 'T' ? 'a tree' : ch === '~' ? 'water' : 'the gate'} at ${p.at[0]},${p.at[1]}`)
      blockedSpot.add(i)
    } else if (m.start && samePos(p.at, m.start)) {
      push('RPG_SPOT_BLOCKED', p.path, `${p.label} stands on the hero's start tile`)
      blockedSpot.add(i)
    } else if (people.some((q, k) => k < i && samePos(q.at, p.at))) {
      push('RPG_SPOT_BLOCKED', p.path, `${p.label} shares the tile ${p.at[0]},${p.at[1]} with someone else`)
      blockedSpot.add(i)
    }
  })

  // reachable from the start over walkable tiles, with the other people standing in the way
  if (m.start) {
    const all = people.map((p) => p.at)
    people.forEach((p, i) => {
      if (blockedSpot.has(i)) return
      if (!canReachSpot(a.rows, m.start as Pos, p.at, all)) push('RPG_MAP_UNREACHABLE', p.path, `${p.label} cannot be reached from the start tile on walkable tiles`)
    })
    if (m.gate && !canReachSpot(a.rows, m.start, m.gate, all, true)) push('RPG_MAP_UNREACHABLE', `${path}.map`, `the gate of "${a.id}" cannot be reached from the start tile on walkable tiles`)
  }

  // the quest giver and the dialogue
  if (!a.npcs.some((n) => n.quest)) push('RPG_NO_QUEST_GIVER', `${path}.npcs`, `the area "${a.id}" has no person with "quest": true, so nobody offers the quest`)
  a.npcs.forEach((n, j) => {
    if (!a.auto && n.lines.length === 0) push('RPG_DIALOGUE_EMPTY', `${path}.npcs[${j}].lines`, `"${n.id}" has nothing to say (no lines)`)
  })

  // the battles
  a.foes.forEach((f, j) => {
    const p = `${path}.foes[${j}]`
    if (f.items.length === 0) push('RPG_FOE_NO_ITEMS', `${p}.items`, `the foe "${f.id}" has no items: its battle has no questions`)
    const known = f.items.filter((id) => pack.items.some((i) => i.id === id))
    f.items.forEach((id, k) => {
      if (!pack.items.some((i) => i.id === id)) push('RPG_FOE_ITEM_MISSING', `${p}.items[${k}]`, `the foe "${f.id}" asks the item "${id}", which does not exist`)
      else if (unitKnown && !unitItems.has(id)) push('RPG_FOE_ITEM_OTHER_UNIT', `${p}.items[${k}]`, `the item "${id}" of the foe "${f.id}" belongs to another unit than "${a.unitId}"`, 'warning')
    })
    if (known.length === 0) push('RPG_QUEST_UNWINNABLE', p, `the foe "${f.id}" cannot be beaten: none of its items can be asked`)
  })
  if (unitKnown && unitItems.size === 0) push('RPG_QUEST_UNWINNABLE', `${path}.boss`, `the boss "${a.boss.id}" cannot be beaten: the unit "${a.unitId}" has no items to ask`)
}

function lint(section: RpgSection | undefined, ctx: ShellLintContext): ShellLintProblem[] {
  const out: ShellLintProblem[] = []
  const push: Push = (code, path, message, severity) => out.push({ code, path, message, ...(severity ? { severity } : {}) })
  const pack = ctx.pack

  if (section === undefined || section.areas.length === 0) {
    // the automatic layout: the same checks on what the player will build
    const layout = buildLayout(pack, section)
    layout.areas.forEach((a, i) => lintArea(a, `areas[${i}]`, ctx, push))
  } else {
    section.areas.forEach((raw, i) => lintArea(authoredArea(raw), `areas[${i}]`, ctx, push))
    const covered = new Set(section.areas.map((a) => a.unit))
    section.areas.forEach((a, i) => {
      if (!pack.units.some((u) => u.id === a.unit)) push('RPG_AREA_UNIT_MISSING', `areas[${i}].unit`, `the area "${a.id}" names the unit "${a.unit}", which does not exist`)
    })
    for (const u of pack.units) if (!covered.has(u.id)) push('RPG_UNIT_NO_AREA', 'areas', `the unit "${u.id}" has no area, so its quest is made automatically`)
  }
  // a section that only skins the automatic quest (the pictures of EGS-15: `tileset`, `sprites`) leaves the story to the shell's own sage: nothing is missing
  const skinOnly = section !== undefined && (section.tileset !== undefined || section.sprites !== undefined) && section.areas.length === 0 && !section.hero && !section.finalBoss
  if (section !== undefined && !skinOnly && section.story.intro.length === 0) push('RPG_NO_STORY', 'story.intro', 'the section has no frame story (no intro lines)', 'warning')
  if (pack.items.length === 0) push('RPG_QUEST_UNWINNABLE', 'finalBoss', 'the final boss cannot be beaten: the course has no items to ask')
  return out
}

export const rpgShell: ShellDef<RpgSection> = {
  id: 'rpg',
  theme: 'pixel',
  requiresSection: false,
  schema: rpgSectionSchema,
  textRefs,
  assetRefs,
  validate,
  lint,
  codes: [...RPG_ERROR_CODES, ...RPG_WARNING_CODES],
  warnings: RPG_WARNING_CODES
}
