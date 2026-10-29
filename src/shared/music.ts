import type { Chip } from './media'

/**
 * The music plan of a course (EGS-16): what the composer asked for, as data (`courses/<slug>/pipeline/music.json`), and the rules that turn
 * "where does this sound play" into a stable asset id and a cue. Pure (no DOM, no node), so the engine, the tools, the player and the tests share it.
 *
 * Music plays by AREA. The areas of a course: `menu` (title and map), `unit-<id>` (a round of that unit), `boss`, `end`, and one or more per shell
 * the course has (`castle` for the MindMaze shell, `rpg-overworld` and `rpg-battle` for the RPG shell). Sound effects play on EVENTS.
 *
 *   asset ids   mus-<area>   (mus-menu, mus-unit-u1, mus-boss, mus-end, mus-castle ...)     sfx-<event>   (sfx-correct, sfx-level-up ...)
 *   cues        music: {on: 'music:<area>', loop: true, volume}    sfx: {on: '<event>', loop: false, volume}
 *   a track made for several areas (the composer merges units) has the id of its first area and one cue per area
 */

/** The events a shell plays a sound effect on. The quiz arena plays `correct`, `wrong`, `combo`, `level-up` (a unit round ends) and `boss` (the boss round ends). */
export const SFX_EVENTS = ['correct', 'wrong', 'combo', 'level-up', 'boss', 'unit-complete'] as const
/** The events every course gets a sound for. */
export const REQUIRED_SFX_EVENTS: readonly string[] = ['correct', 'wrong', 'combo', 'level-up']
/** Old name of `level-up`: a course that has a `unit-complete` cue (a hand-made one) keeps working; the player plays both. */
export const SFX_ALIASES: Record<string, string[]> = { 'level-up': ['level-up', 'unit-complete'] }

const idPart = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')

/** The cue `on` of a music area. */
export const musicCueOn = (area: string): string => `music:${area}`
export const musicAssetId = (area: string): string => `mus-${idPart(area)}`
export const sfxAssetId = (event: string): string => `sfx-${idPart(event)}`
export const musicCueId = (area: string): string => `cue-music-${idPart(area)}`
export const sfxCueId = (event: string): string => `cue-sfx-${idPart(event)}`
export const unitArea = (unitId: string): string => `unit-${idPart(unitId)}`

export type MusicTrackProvider = 'chiptune' | 'comfy' | 'flow'

/** The default volume of a music cue and of a sound effect cue (0..1). Music sits under the questions; effects are louder. */
export const DEFAULT_MUSIC_VOLUME = 0.45
export const DEFAULT_SFX_VOLUME = 0.8
/** The lengths a track may have, in seconds. */
export const MIN_TRACK_SECONDS = 30
export const MAX_TRACK_SECONDS = 180
export const DEFAULT_TRACK_SECONDS = 90

/** The areas Chiptune Studio makes by default: the castle and the RPG (a pixel look). */
export const isChipArea = (area: string): boolean => area === 'castle' || area.startsWith('rpg-')

export interface MusicArea {
  area: string
  /** What the music of this area is for, in words for the composer and the fallback. */
  describe: string
  /** The plan must cover it (every area of this table is required). */
  required: boolean
}

export interface MusicSlotContext {
  units: { id: string; title: string }[]
  /** The shells of the course (the brief's, the designer's and the pack's). */
  shells: readonly string[]
}

/** The areas of the music of a course: a table in code. Any shell id is accepted; a shell this table does not know has no area of its own (it uses the menu music). */
export function musicAreas(ctx: MusicSlotContext): MusicArea[] {
  const out: MusicArea[] = [
    { area: 'menu', describe: 'the title screen and the unit map: welcoming, calm, inviting', required: true },
    ...ctx.units.map((u) => ({ area: unitArea(u.id), describe: `a round of the unit "${u.title}": steady background music that helps to concentrate, fits the topic`, required: true })),
    { area: 'boss', describe: 'the boss round that mixes every unit: more tense and driving, still without a sudden loud part', required: true },
    { area: 'end', describe: 'the end screen: warm, rewarding, a feeling of having finished', required: true }
  ]
  const has = new Set(ctx.shells)
  if (has.has('mindmaze')) out.push({ area: 'castle', describe: 'the MindMaze castle: mysterious, echoing halls, a slow quest', required: true })
  if (has.has('rpg')) {
    out.push({ area: 'rpg-overworld', describe: 'the RPG overworld: a light travelling theme for walking between villages', required: true })
    out.push({ area: 'rpg-battle', describe: 'the RPG battle when a question is asked: urgent but friendly', required: true })
  }
  return out
}

/** What each event sounds like, for the composer and the fallback. */
export const SFX_DESCRIBE: Record<string, string> = {
  correct: 'a short bright reward for a right answer',
  wrong: 'a short soft low sound for a wrong answer (gentle, never harsh)',
  combo: 'a rising sparkle when the learner gets several right in a row',
  'level-up': 'a happy fanfare when a unit round is finished',
  boss: 'a dramatic sting when the boss round is finished',
  'unit-complete': 'a happy fanfare when a unit is complete (the old name of level-up)'
}

// ---- the plan file ----

/** One music track of the plan: made once, played in every area it names. */
export interface MusicTrackEntry {
  /** The asset id: `mus-<first area>`. */
  id: string
  /** The areas it plays in (at least one; a merged group of units has several). */
  areas: string[]
  mood: string
  /** What it sounds like: the prompt of ACE-Step and Flow Music (a short line). */
  prompt: string
  /** The description of the sound, in the language of the course (the catalog key `asset.<id>.alt`). */
  alt: string
  seconds: number
  loop: boolean
  volume: number
  /** Who makes it: ComfyUI (ACE-Step), Chiptune Studio, or Flow Music (only with the explicit opt-in). */
  provider: MusicTrackProvider
  /** The Chiptune Studio plan: the arguments of `compose_track` that are not the seed (always set, used when `provider` is `chiptune`). */
  chip: Chip
  bpm: number
  key: string
  bars: number
  by: 'model' | 'fallback'
}

/** One sound effect of the plan. */
export interface SfxEntry {
  /** The asset id: `sfx-<event>`. */
  id: string
  event: string
  /** The Chiptune Studio `compose_sfx` sound (see `chip-sound.ts`). */
  sound: string
  /** What it sounds like (the prompt of a ComfyUI engine, the words `pickChipSound` falls back on). */
  prompt: string
  alt: string
  volume: number
  /** Who makes it: `chiptune`, a ComfyUI audio engine, `custom:<workflow>`, or `none` (made by hand). */
  engine: string
  by: 'model' | 'fallback'
}

export interface MusicPlanFile {
  version: 1
  source: 'model' | 'fallback'
  note?: string
  at: string
  tracks: MusicTrackEntry[]
  sfx: SfxEntry[]
  /** Things the plan changed on its own (Flow Music asked for without the opt-in ...). */
  warnings?: string[]
}

/** A cue as the pack holds it. */
export interface PackCue {
  id: string
  on: string
  asset: string
  loop: boolean
  volume: number
}

/** The cues of a plan, for the assets that have a file (`has(assetId)`). One music cue per area of a track, one cue per sound effect. */
export function cuesOfPlan(plan: Pick<MusicPlanFile, 'tracks' | 'sfx'>, has: (assetId: string) => boolean): PackCue[] {
  const out: PackCue[] = []
  for (const t of plan.tracks) {
    if (!has(t.id)) continue
    for (const area of t.areas) out.push({ id: musicCueId(area), on: musicCueOn(area), asset: t.id, loop: t.loop, volume: t.volume })
  }
  for (const s of plan.sfx) {
    if (!has(s.id)) continue
    out.push({ id: sfxCueId(s.event), on: s.event, asset: s.id, loop: false, volume: s.volume })
  }
  return out
}
