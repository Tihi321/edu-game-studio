import { z } from 'zod'
import { CEFR_LEVELS, idSchema, keySchema, unitOfItem, type CourseItem, type CoursePack } from '../course'
import type { Problem, TextRef } from '../edu/registry'
import type { ShellDef, ShellLintContext, ShellLintProblem } from './types'

/**
 * The course section of the language role-play shell (`pack.shells.config['roleplay']`, EGS-13): dialogue scenes in the target language
 * the learner answers by choosing or typing, and the vocabulary garden (one plant per word, grown by spaced repetition).
 *
 *  - a scene is a chain of lines from `start`: a `say` line (a speaker says `text`, with an optional `translation` of the edition, an
 *    audio clip and `listen`: the text is hidden until the learner has answered) or a `reply` line (the learner's turn: a course item,
 *    asked through the shared question screen; `help` is the hint the other speaker gives after a miss, `youSay` the text of the
 *    learner's bubble when the item's own answer is not the right words);
 *  - `next` is the id of the next line, `null` ends the scene (explicit, so a forgotten `next` is a lint error, not a silent end);
 *  - every visible string is a catalog key: `text` keys (and the garden words) live in the TARGET-language catalog of a language course,
 *    `translation`, `gloss`, `help`, titles and settings in the editions;
 *  - the garden words name the item that is asked to grow the plant; the finale is a scene that mixes the units (no `unit`: the boss).
 *
 * Pure (no DOM): the validator, the lint and the browser player share the walking helpers below.
 */

const speakerSchema = z.strictObject({
  id: idSchema,
  /** Catalog key of the display name. */
  name: keySchema,
  /** The learner's own speaker: names the bubbles of the replies. */
  learner: z.boolean().default(false),
  /** An image asset: the portrait. Without one the speaker gets an initial on a coloured disc. */
  portrait: idSchema.optional()
})

const sayLineSchema = z.strictObject({
  id: idSchema,
  say: idSchema,
  /** Target-language catalog key. */
  text: keySchema,
  translation: keySchema.optional(),
  /** An audio asset: the line gets a play button. Without a clip the button is not drawn (a text-to-speech slot). */
  audio: idSchema.optional(),
  /** The text stays hidden until the learner has answered the next turn (needs a clip). */
  listen: z.boolean().default(false),
  next: idSchema.nullable()
})

const replyLineSchema = z.strictObject({
  id: idSchema,
  /** The item the learner answers (typed, cloze, mcq, listening ...). */
  reply: idSchema,
  /** The other speaker's hint after a miss (a note in the edition, shown with the line said again, slowly). */
  help: keySchema.optional(),
  /** The words of the learner's bubble (a target-language key) when the item's own answer is not the sentence. */
  youSay: keySchema.optional(),
  next: idSchema.nullable()
})

export const lineSchema = z.union([sayLineSchema, replyLineSchema])

const sceneSchema = z.strictObject({
  id: idSchema,
  /** The course unit it practises; none for the finale. */
  unit: idSchema.optional(),
  title: keySchema,
  setting: keySchema.optional(),
  cefr: z.enum(CEFR_LEVELS).optional(),
  start: idSchema,
  lines: z.array(lineSchema).min(1)
})

const wordSchema = z.strictObject({
  id: idSchema,
  /** Target-language catalog key of the word or phrase. */
  text: keySchema,
  /** The meaning in the edition. */
  gloss: keySchema,
  /** The item asked to water the plant. */
  item: idSchema
})

export const roleplaySectionSchema = z.strictObject({
  speakers: z.array(speakerSchema).default([]),
  scenes: z.array(sceneSchema).default([]),
  garden: z.array(wordSchema).default([]),
  /** The id of the scene that mixes every unit (the boss). */
  finale: idSchema.optional(),
  /** Overrides the theme (default `postcard`). */
  theme: z.string().optional()
})

export type RoleplaySection = z.infer<typeof roleplaySectionSchema>
export type RpSpeaker = z.infer<typeof speakerSchema>
export type RpSayLine = z.infer<typeof sayLineSchema>
export type RpReplyLine = z.infer<typeof replyLineSchema>
export type RpLine = RpSayLine | RpReplyLine
export type RpScene = z.infer<typeof sceneSchema>
export type RpWord = z.infer<typeof wordSchema>

// ---- walking a scene (pure, shared by the lint and the player) ----

export const isReply = (l: RpLine): l is RpReplyLine => 'reply' in l
export const isSay = (l: RpLine): l is RpSayLine => 'say' in l

export const lineById = (scene: Pick<RpScene, 'lines'>, id: string | null | undefined): RpLine | undefined => (id == null ? undefined : scene.lines.find((l) => l.id === id))

export interface SceneWalk {
  /** The line ids from `start` in order (each at most once). */
  path: string[]
  /** The walk ended on a line whose `next` is null. */
  ends: boolean
  /** The id of a `next` (or the start) that names no line. */
  dangling?: string
  /** The line whose `next` leads back to a line already walked: a cycle with no exit. */
  loopAt?: string
}

/** Follows `next` from `start`. A line has one `next`, so the walk is a chain: it ends, dangles or loops. */
export function walkScene(scene: Pick<RpScene, 'start' | 'lines'>): SceneWalk {
  const path: string[] = []
  const seen = new Set<string>()
  let cur: string | null = scene.start
  while (cur !== null) {
    const line = lineById(scene, cur)
    if (!line) return { path, ends: false, dangling: cur }
    if (seen.has(line.id)) return { path, ends: false, loopAt: path[path.length - 1] ?? line.id }
    seen.add(line.id)
    path.push(line.id)
    cur = line.next
  }
  return { path, ends: true }
}

/** The lines of a scene on its path, in order (what the learner meets). */
export function sceneLines(scene: RpScene): RpLine[] {
  return walkScene(scene).path.map((id) => lineById(scene, id) as RpLine)
}

/** The learner's turns of a scene on its path, in order. */
export const sceneTurns = (scene: RpScene): RpReplyLine[] => sceneLines(scene).filter(isReply)

/** The scenes of a unit (the finale and any scene without a unit excluded), in section order. */
export const scenesOfUnit = (section: Pick<RoleplaySection, 'scenes' | 'finale'>, unitId: string): RpScene[] => section.scenes.filter((s) => s.unit === unitId && s.id !== section.finale)

/** Whether answering the item means producing the words (typing), not recognising them. */
export function isProduction(item: CourseItem | undefined): boolean {
  if (!item) return false
  const it = item as unknown as { kind: string; mode?: string; gaps?: { bank?: unknown }[] }
  switch (it.kind) {
    case 'typed':
    case 'crossword':
      return true
    case 'listening':
      return it.mode === 'type'
    case 'cloze':
      return (it.gaps ?? []).some((g) => !g.bank)
    default:
      return false
  }
}

const CEFR_RANK = new Map(CEFR_LEVELS.map((l, i) => [l as string, i]))

// ---- the shell definition ----

export const ROLEPLAY_CODES = [
  'RP_UNIT_NO_SCENE',
  'RP_SCENE_UNIT_MISSING',
  'RP_START_MISSING',
  'RP_NEXT_MISSING',
  'RP_NO_END',
  'RP_LINE_UNREACHABLE',
  'RP_SPEAKER_MISSING',
  'RP_REPLY_ITEM_MISSING',
  'RP_SCENE_NO_REPLY',
  'RP_GARDEN_ITEM_MISSING',
  'RP_FINALE_MISSING',
  'RP_TEXT_NOT_TARGET',
  'RP_REPLY_NOT_PRODUCTION',
  'RP_CEFR_ABOVE_COURSE'
] as const

const ROLEPLAY_WARNINGS = ['RP_TEXT_NOT_TARGET', 'RP_REPLY_NOT_PRODUCTION', 'RP_CEFR_ABOVE_COURSE'] as const

function textRefs(s: RoleplaySection): TextRef[] {
  const out: TextRef[] = []
  const add = (path: string, key: string | undefined): void => {
    if (key) out.push({ path, key, role: 'string' })
  }
  s.speakers.forEach((sp, i) => add(`speakers[${i}].name`, sp.name))
  s.scenes.forEach((sc, i) => {
    add(`scenes[${i}].title`, sc.title)
    add(`scenes[${i}].setting`, sc.setting)
    sc.lines.forEach((l, j) => {
      const at = `scenes[${i}].lines[${j}]`
      if (isSay(l)) {
        add(`${at}.text`, l.text)
        add(`${at}.translation`, l.translation)
      } else {
        add(`${at}.help`, l.help)
        add(`${at}.youSay`, l.youSay)
      }
    })
  })
  s.garden.forEach((w, i) => {
    add(`garden[${i}].text`, w.text)
    add(`garden[${i}].gloss`, w.gloss)
  })
  return out
}

function assetRefs(s: RoleplaySection): { path: string; id: string }[] {
  const out: { path: string; id: string }[] = []
  s.speakers.forEach((sp, i) => sp.portrait && out.push({ path: `speakers[${i}].portrait`, id: sp.portrait }))
  s.scenes.forEach((sc, i) =>
    sc.lines.forEach((l, j) => {
      if (isSay(l) && l.audio) out.push({ path: `scenes[${i}].lines[${j}].audio`, id: l.audio })
    })
  )
  return out
}

/** Structural checks that block the build: ids that appear twice (the player addresses scenes, lines, speakers and words by id). */
function validate(s: RoleplaySection): Problem[] {
  const out: Problem[] = []
  const dup = (ids: string[], path: (i: number) => string, what: string): void => {
    const seen = new Set<string>()
    ids.forEach((id, i) => {
      if (seen.has(id)) out.push({ code: 'DUPLICATE_ID', path: path(i), message: `the ${what} id "${id}" is used twice` })
      seen.add(id)
    })
  }
  dup(s.speakers.map((x) => x.id), (i) => `speakers[${i}].id`, 'speaker')
  dup(s.scenes.map((x) => x.id), (i) => `scenes[${i}].id`, 'scene')
  s.scenes.forEach((sc, i) =>
    dup(sc.lines.map((x) => x.id), (j) => `scenes[${i}].lines[${j}].id`, `line of scene "${sc.id}"`)
  )
  dup(s.garden.map((x) => x.id), (i) => `garden[${i}].id`, 'garden word')
  return out
}

function lint(section: RoleplaySection | undefined, ctx: ShellLintContext): ShellLintProblem[] {
  if (!section) return []
  const { pack } = ctx
  const out: ShellLintProblem[] = []
  const err = (code: string, path: string, message: string): void => void out.push({ code, path, message })
  const warn = (code: string, path: string, message: string): void => void out.push({ code, severity: 'warning', path, message })
  const items = new Map(pack.items.map((i) => [i.id, i]))
  const units = new Set(pack.units.map((u) => u.id))
  const speakers = new Set(section.speakers.map((sp) => sp.id))
  const target = pack.targetLang ? ctx.catalogs[pack.targetLang] : undefined
  const courseRank = pack.cefr ? (CEFR_RANK.get(pack.cefr) as number) : undefined

  // ---- the finale ----
  const finale = section.finale
  if (!finale) err('RP_FINALE_MISSING', 'finale', 'the section names no finale scene: nothing mixes the units at the end (the boss)')
  else if (!section.scenes.some((sc) => sc.id === finale)) err('RP_FINALE_MISSING', 'finale', `the finale "${finale}" is not a scene of the section`)

  // ---- units and scenes ----
  for (const [ui, u] of pack.units.entries()) {
    if (scenesOfUnit(section, u.id).length === 0) err('RP_UNIT_NO_SCENE', `scenes`, `the unit "${u.id}" (units[${ui}]) has no scene: the learner cannot practise it in a conversation`)
  }
  section.scenes.forEach((sc, i) => {
    const at = `scenes[${i}]`
    if (sc.id !== finale && (!sc.unit || !units.has(sc.unit))) err('RP_SCENE_UNIT_MISSING', `${at}.unit`, sc.unit ? `the scene "${sc.id}" belongs to the unknown unit "${sc.unit}"` : `the scene "${sc.id}" belongs to no unit (only the finale may)`)
    if (sc.unit && sc.id === finale && !units.has(sc.unit)) err('RP_SCENE_UNIT_MISSING', `${at}.unit`, `the finale "${sc.id}" belongs to the unknown unit "${sc.unit}"`)
    if (sc.cefr && courseRank !== undefined && (CEFR_RANK.get(sc.cefr) as number) > courseRank) warn('RP_CEFR_ABOVE_COURSE', `${at}.cefr`, `the scene "${sc.id}" is ${sc.cefr}, above the course level ${pack.cefr}`)

    // ---- the chain of lines ----
    const hasStart = sc.lines.some((l) => l.id === sc.start)
    if (!hasStart) err('RP_START_MISSING', `${at}.start`, `the start "${sc.start}" is not a line of the scene "${sc.id}"`)
    sc.lines.forEach((l, j) => {
      if (l.next !== null && !sc.lines.some((x) => x.id === l.next)) err('RP_NEXT_MISSING', `${at}.lines[${j}].next`, `the line "${l.id}" goes on to "${l.next}", which is no line of the scene "${sc.id}"`)
      if (isSay(l) && !speakers.has(l.say)) err('RP_SPEAKER_MISSING', `${at}.lines[${j}].say`, `the line "${l.id}" is said by "${l.say}", who is not in speakers`)
      if (isReply(l) && !items.has(l.reply)) err('RP_REPLY_ITEM_MISSING', `${at}.lines[${j}].reply`, `the line "${l.id}" asks the item "${l.reply}", which does not exist`)
      if (isSay(l) && target && !target.strings[l.text]) warn('RP_TEXT_NOT_TARGET', `${at}.lines[${j}].text`, `the line "${l.id}" says "${l.text}", which is not in the ${pack.targetLang} catalog: a spoken line belongs to the target language`)
    })
    if (hasStart) {
      const walk = walkScene(sc)
      if (walk.loopAt !== undefined) err('RP_NO_END', `${at}.lines`, `from the start of "${sc.id}" the lines lead round in a circle at "${walk.loopAt}" and never reach a line whose next is null`)
      const onPath = new Set(walk.path)
      sc.lines.forEach((l, j) => {
        if (!onPath.has(l.id)) err('RP_LINE_UNREACHABLE', `${at}.lines[${j}]`, `the line "${l.id}" can never be reached from the start of "${sc.id}"`)
      })
      const turns = walk.path.map((id) => lineById(sc, id) as RpLine).filter(isReply)
      if (turns.length === 0) err('RP_SCENE_NO_REPLY', `${at}.lines`, `the scene "${sc.id}" has no turn for the learner: nothing is asked, so nothing is retrieved`)
    } else if (!sc.lines.some(isReply)) err('RP_SCENE_NO_REPLY', `${at}.lines`, `the scene "${sc.id}" has no turn for the learner: nothing is asked, so nothing is retrieved`)
  })

  // ---- production: a unit whose replies are all choices never makes the learner type ----
  for (const u of pack.units) {
    const replies = scenesOfUnit(section, u.id).flatMap((sc) => sc.lines.filter(isReply))
    const known = replies.map((r) => items.get(r.reply)).filter((i): i is CourseItem => !!i)
    if (known.length > 0 && !known.some(isProduction)) warn('RP_REPLY_NOT_PRODUCTION', 'scenes', `every reply of the scenes of the unit "${u.id}" is a choice: the learner never types the language`)
  }

  // ---- the garden ----
  section.garden.forEach((w, i) => {
    if (!items.has(w.item)) err('RP_GARDEN_ITEM_MISSING', `garden[${i}].item`, `the word "${w.id}" is watered with the item "${w.item}", which does not exist`)
    if (target && !target.strings[w.text]) warn('RP_TEXT_NOT_TARGET', `garden[${i}].text`, `the word "${w.id}" is "${w.text}", which is not in the ${pack.targetLang} catalog`)
  })
  return out
}

export const roleplayShell: ShellDef<RoleplaySection> = {
  id: 'roleplay',
  theme: 'postcard',
  requiresSection: true,
  schema: roleplaySectionSchema,
  textRefs,
  assetRefs,
  validate,
  lint,
  codes: ROLEPLAY_CODES,
  warnings: ROLEPLAY_WARNINGS
}

/** The unit of a garden word (through its item and objective), if the references are valid. */
export const unitOfWord = (pack: Pick<CoursePack, 'items' | 'objectives'>, word: Pick<RpWord, 'item'>): string | undefined => {
  const item = pack.items.find((i) => i.id === word.item)
  return item ? unitOfItem(pack, item) : undefined
}
