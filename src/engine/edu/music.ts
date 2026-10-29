import { z } from 'zod'
import { CHIPS, CHIPTUNE_ENGINE, SFX_IMPORT_ONLY, flowMusicAllowed } from '../../shared/media'
import type { Chip, CourseMedia } from '../../shared/media'
import {
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SFX_VOLUME,
  DEFAULT_TRACK_SECONDS,
  MAX_TRACK_SECONDS,
  MIN_TRACK_SECONDS,
  REQUIRED_SFX_EVENTS,
  SFX_DESCRIBE,
  SFX_EVENTS,
  isChipArea,
  musicAreas,
  musicAssetId,
  sfxAssetId,
  unitArea
} from '../../shared/music'
import type { MusicArea, MusicPlanFile, MusicTrackEntry, MusicTrackProvider, SfxEntry } from '../../shared/music'
import { CHIP_SOUNDS, pickChipSound } from '../studios/chip-sound'
import { MUSIC_MOODS, MAX_BARS, MIN_BARS, fallbackChipPlan, mergeChipPlan, planSummary } from '../studios/chip-plan'
import type { ChipTrackPlanDraft } from '../studios/chip-plan'
import { dropNulls } from './authoring'
import type { Problem } from './authoring'
import type { AssetEntry, AssetManifest } from '../../shared/media'
import { getEntry, replaceEntry } from '../assets/manifest'

/**
 * The composer's work as code (EGS-16): what the role is shown (`MusicSource`: the units and the shells of a course), the output contract of its
 * answer (`musicPlanSchema` and `checkMusicPlan`, with one repair round in `askRole`), the deterministic fallback plan used when the model gives no
 * usable answer, and the step that turns the answer into track and sound-effect entries with stable asset ids, providers and Chiptune Studio plans.
 */

export interface MusicSource {
  title: string
  subject: string
  audience: string
  age?: string
  /** The name of the language the alt texts are written in. */
  language: string
  units: { id: string; title: string; summary?: string }[]
  /** The shells of the course: the brief's, the game designer's and the pack's. */
  shells: string[]
  /** Free text that says what the course looks like (audience, subject, art style): the fallback picks a chip and a mood from it. */
  genreText: string
}

// ---- the output contract ----

const text = (what: string) => z.string({ error: `${what} must be a string` }).trim().min(1, `${what} must not be empty`)
const ident = z.string({ error: 'an id must be a string' }).trim().min(1)
const lenient = <S extends z.ZodType>(s: S) => z.preprocess(dropNulls, s) as unknown as S

export const musicPlanSchema = lenient(
  z.object({
    music: z
      .array(
        z.object({
          /** `menu`, `unit-<id>`, `boss`, `end`, or a shell area (`castle`, `rpg-overworld`, `rpg-battle`). */
          area: text('the area'),
          /** More units this track also plays in (only on a `unit-<id>` line): the composer merges units of one mood. */
          units: z.array(ident, { error: 'units must be a list of unit ids' }).optional(),
          mood: text('the mood'),
          prompt: text('the prompt'),
          alt: text('the alt text'),
          seconds: z.number().optional(),
          volume: z.number().optional(),
          chip: z.string().optional(),
          bpm: z.number().optional(),
          key: z.string().optional(),
          bars: z.number().optional()
        }),
        { error: 'music must be a list of {area, mood, prompt, alt, ...}' }
      )
      .min(1, 'give at least one music track'),
    sfx: z
      .array(
        z.object({
          event: text('the event'),
          sound: z.string().optional(),
          prompt: z.string().optional(),
          alt: text('the alt text')
        }),
        { error: 'sfx must be a list of {event, sound, alt}' }
      )
      .default([]),
    notes: z.string().default('')
  })
)
export type MusicPlanOutput = z.output<typeof musicPlanSchema>
export type MusicLine = MusicPlanOutput['music'][number]
export type SfxLine = MusicPlanOutput['sfx'][number]

const problem = (ref: string, issue: string, fix?: string): Problem => ({ ref, issue, ...(fix ? { fix } : {}), severity: 'major' })

/** The areas of a course (the table in code) for its units and shells. */
export const areasOf = (src: Pick<MusicSource, 'units' | 'shells'>): MusicArea[] => musicAreas({ units: src.units, shells: src.shells })

/** The areas a line covers: its own and the units it merges in. */
function lineAreas(l: Pick<MusicLine, 'area' | 'units'>): string[] {
  return [l.area.trim(), ...(l.units ?? []).map((u) => unitArea(u))]
}

/** What an answer must cover: music for every area (a unit may be merged into another unit's line) and a sound for every required event. */
export function checkMusicPlan(plan: MusicPlanOutput, src: MusicSource): Problem[] {
  const out: Problem[] = []
  const areas = new Map(areasOf(src).map((a) => [a.area, a]))
  const covered = new Map<string, number>()
  plan.music.forEach((l, n) => {
    const where = `music ${n + 1}`
    const first = l.area.trim()
    if (!areas.has(first)) return void out.push(problem(first || where, 'no such area', `the areas: ${[...areas.keys()].join(', ')}`))
    if (l.units?.length && !first.startsWith('unit-')) out.push(problem(first, 'only a unit-<id> line can merge more units (units: [...])'))
    for (const a of lineAreas(l)) {
      if (!areas.has(a)) out.push(problem(a, 'no such area', `the areas: ${[...areas.keys()].join(', ')}`))
      else covered.set(a, (covered.get(a) ?? 0) + 1)
    }
    if (l.prompt.length < 12) out.push(problem(first, 'the prompt is too short to compose from', 'say what the music sounds like'))
  })
  for (const [a, n] of covered) if (n > 1) out.push(problem(a, `the area is covered ${n} times`, 'one track for each area'))
  const missing = [...areas.values()].filter((a) => a.required && !covered.has(a.area)).map((a) => a.area)
  if (missing.length) out.push(problem('', `missing music for: ${missing.join(', ')}`, 'add a track for each (a unit may be merged into another unit line with units: [...])'))
  const seen = new Set<string>()
  for (const s of plan.sfx) {
    const e = s.event.trim()
    if (!(SFX_EVENTS as readonly string[]).includes(e)) out.push(problem(e, 'no such event', `the events: ${SFX_EVENTS.join(', ')}`))
    if (seen.has(e)) out.push(problem(e, 'this sound effect is planned twice'))
    seen.add(e)
  }
  const lacking = REQUIRED_SFX_EVENTS.filter((e) => !seen.has(e))
  if (lacking.length) out.push(problem('', `missing sound effects for: ${lacking.join(', ')}`, 'add a line for each event'))
  return out
}

// ---- the deterministic fallback ----

/** The sound of each event when no model chose: Chiptune Studio's own names. */
const FALLBACK_SOUND: Record<string, string> = { correct: 'coin', wrong: 'cancel', combo: 'magic', 'level-up': 'powerup', boss: 'alert', 'unit-complete': 'powerup' }

/** The fixed mood of the areas that are not a unit or the menu (a unit and the menu rotate over the calm moods). */
const AREA_MOOD: Record<string, { mood: string; bpm: number; key: string; words: string }> = {
  boss: { mood: 'mysterious-calm', bpm: 96, key: 'D', words: 'tense, driving, steady pulse, low strings and a soft drum' },
  end: { mood: 'peaceful', bpm: 66, key: 'F', words: 'warm, rewarding, bells and soft piano' },
  castle: { mood: 'mysterious-calm', bpm: 64, key: 'A', words: 'mysterious, echoing, harp and low flute' },
  'rpg-overworld': { mood: 'peaceful', bpm: 84, key: 'G', words: 'light, travelling, plucked strings and flute' },
  'rpg-battle': { mood: 'mysterious-calm', bpm: 100, key: 'E', words: 'urgent but friendly, bouncing bass and bright lead' }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/** The plan made from the course text alone: music for every area, a sound for every event. */
export function fallbackMusicLines(src: MusicSource): { music: MusicLine[]; sfx: SfxLine[] } {
  const music: MusicLine[] = []
  let n = 0
  for (const a of areasOf(src)) {
    n++
    const fixed = AREA_MOOD[a.area]
    const base = fallbackChipPlan(`music_${String(n).padStart(2, '0')}`, { genreText: src.genreText, seconds: DEFAULT_TRACK_SECONDS })
    const mood = fixed?.mood ?? base.mood
    const words = fixed?.words ?? (a.area === 'menu' ? 'welcoming, warm, soft piano and strings' : 'steady, calm, light piano and soft pads')
    music.push({
      area: a.area,
      mood,
      prompt: `calm instrumental background music, ${words}, slow tempo, loops well, no vocals, for a learning game about ${src.subject}`,
      alt: `${a.area === 'menu' ? 'The menu music' : a.area === 'boss' ? 'The boss music' : a.area === 'end' ? 'The end music' : `The music of ${a.area}`} of the game about ${src.subject}`,
      seconds: DEFAULT_TRACK_SECONDS,
      bpm: fixed?.bpm ?? base.bpm,
      key: fixed?.key ?? base.key,
      bars: base.bars
    })
  }
  const sfx: SfxLine[] = (['correct', 'wrong', 'combo', 'level-up', 'boss'] as const).map((event) => ({
    event,
    sound: FALLBACK_SOUND[event]!,
    prompt: SFX_DESCRIBE[event]!,
    alt: `The sound for ${event === 'level-up' ? 'finishing a unit' : event === 'boss' ? 'finishing the boss round' : event === 'combo' ? 'a combo' : `a ${event} answer`}`
  }))
  return { music, sfx }
}

// ---- from lines to entries ----

export interface ResolveMusicOptions {
  media: Pick<CourseMedia, 'art' | 'music' | 'sound'>
  by: 'model' | 'fallback'
}

/**
 * Who makes the music of the areas a track plays in. An explicit `music.provider` wins (Flow Music only with the credits opt-in: `flowMusicAllowed`);
 * else Chiptune Studio for the RPG and castle areas and for a pixel-style course, ComfyUI (ACE-Step) for the rest.
 */
export function trackProvider(media: Pick<CourseMedia, 'art' | 'music'>, areas: readonly string[], warnings: string[] = []): MusicTrackProvider {
  const explicit = media.music.provider
  if (explicit === 'flow') {
    if (flowMusicAllowed(media)) return 'flow'
    const note = 'media.music.provider is flow, but Flow Music spends credits and media.music.flowCredits is not true: the tracks are made by the default provider instead'
    if (!warnings.includes(note)) warnings.push(note)
  } else if (explicit) return explicit
  if (areas.some(isChipArea)) return 'chiptune'
  return media.art.style === 'pixel' ? 'chiptune' : 'comfy'
}

/** The engine of the sound effects: `sound.sfxEngine` when set (`none` keeps them import-only), else Chiptune Studio. */
export function sfxEngineOf(media: Pick<CourseMedia, 'sound'>): string {
  const chosen = media.sound.sfxEngine?.trim()
  return chosen ? chosen : CHIPTUNE_ENGINE
}

/** The engine id a track entry has in the manifest. */
export const engineOfProvider = (provider: MusicTrackProvider, media: Pick<CourseMedia, 'music'>): string => (provider === 'chiptune' ? CHIPTUNE_ENGINE : provider === 'flow' ? 'flow-music' : media.music.engine)

/** The prompt of a manifest entry for a track: Chiptune Studio's own words (the plan, in one line), or the line's prompt for ACE-Step and Flow Music. */
export const trackPromptOf = (t: Pick<MusicTrackEntry, 'provider' | 'prompt' | 'mood' | 'chip' | 'bpm' | 'key' | 'bars'>): string => (t.provider === 'chiptune' ? planSummary(t) : t.prompt)

/**
 * The entries of a plan: a track per line (ids `mus-<first area>`; the lines of the answer are repaired by the fallback where an area has no
 * track, so a hand-edited plan never leaves a unit silent), a sound per event. Lines the course cannot place are dropped.
 */
export function resolveMusicEntries(lines: { music: readonly MusicLine[]; sfx: readonly SfxLine[] }, src: MusicSource, o: ResolveMusicOptions): { tracks: MusicTrackEntry[]; sfx: SfxEntry[]; warnings: string[] } {
  const table = areasOf(src)
  const byArea = new Map(table.map((a) => [a.area, a]))
  const warnings: string[] = []
  const tracks = new Map<string, MusicTrackEntry>()
  const covered = new Set<string>()
  const add = (l: MusicLine, by: 'model' | 'fallback'): void => {
    const areas = [...new Set(lineAreas(l))].filter((a) => byArea.has(a) && !covered.has(a))
    if (areas.length === 0) return
    const id = musicAssetId(areas[0]!)
    if (tracks.has(id)) return
    const provider = trackProvider(o.media, areas, warnings)
    const seconds = clamp(Math.round(l.seconds ?? DEFAULT_TRACK_SECONDS), MIN_TRACK_SECONDS, MAX_TRACK_SECONDS)
    const draft: ChipTrackPlanDraft = { mood: l.mood, chip: l.chip, bpm: l.bpm, key: l.key, bars: l.bars }
    const base = fallbackChipPlan(`music_${String(tracks.size + 1).padStart(2, '0')}`, { genreText: src.genreText, chip: o.media.music.chip, seconds })
    const chip = mergeChipPlan(draft, base, o.media.music.chip)
    const mood = (MUSIC_MOODS as readonly string[]).includes(l.mood) ? l.mood : chip.mood
    tracks.set(id, {
      id,
      areas,
      mood,
      prompt: l.prompt.trim(),
      alt: l.alt.trim(),
      seconds,
      loop: true,
      volume: clamp(l.volume ?? DEFAULT_MUSIC_VOLUME, 0.1, 0.9),
      provider,
      chip: chip.chip as Chip,
      bpm: chip.bpm,
      key: chip.key,
      bars: clamp(chip.bars, MIN_BARS, MAX_BARS),
      by
    })
    for (const a of areas) covered.add(a)
  }
  for (const l of lines.music) add(l, o.by)
  const fallback = fallbackMusicLines(src)
  for (const l of fallback.music) if (!covered.has(l.area)) add(l, 'fallback')

  const engine = sfxEngineOf(o.media)
  const sfx = new Map<string, SfxEntry>()
  const addSfx = (l: SfxLine, by: 'model' | 'fallback'): void => {
    const event = l.event.trim()
    if (!(SFX_EVENTS as readonly string[]).includes(event) || sfx.has(event)) return
    const description = (l.prompt?.trim() || SFX_DESCRIBE[event] || event).trim()
    const given = l.sound?.trim().toLowerCase()
    const picked = pickChipSound('sfx', event, description)
    const sound = given && CHIP_SOUNDS.sfx.includes(given) ? given : picked.guessed ? (FALLBACK_SOUND[event] ?? picked.sound) : picked.sound
    sfx.set(event, { id: sfxAssetId(event), event, sound, prompt: description, alt: l.alt.trim(), volume: DEFAULT_SFX_VOLUME, engine, by })
  }
  for (const l of lines.sfx) addSfx(l, o.by)
  for (const l of fallback.sfx) if (!sfx.has(l.event) && (REQUIRED_SFX_EVENTS.includes(l.event) || lines.sfx.length === 0)) addSfx(l, 'fallback')
  return { tracks: [...tracks.values()], sfx: [...sfx.values()], warnings }
}

// ---- what the prompt shows ----

const list = (xs: readonly string[]): string => xs.join(', ')

/** The variables of `prompts/composer/plan.md`. */
export function musicPromptVars(src: MusicSource, media: Pick<CourseMedia, 'art' | 'music' | 'sound'>): Record<string, string | number> {
  const areas = areasOf(src)
  const warn: string[] = []
  return {
    title: src.title,
    subject: src.subject,
    audience: src.audience,
    age: src.age ?? 'not given',
    language: src.language,
    style: media.art.style,
    units: src.units.map((u) => `- ${u.id}: ${u.title}`).join('\n') || '(none)',
    areas: areas.map((a) => `- ${a.area} (${trackProvider(media, [a.area], warn)}): ${a.describe}`).join('\n'),
    events: SFX_EVENTS.filter((e) => e !== 'unit-complete').map((e) => `- ${e}${REQUIRED_SFX_EVENTS.includes(e) ? ' (REQUIRED)' : ''}: ${SFX_DESCRIBE[e]}`).join('\n'),
    moods: list(MUSIC_MOODS),
    chips: list(CHIPS),
    chip: media.music.chip ?? 'none',
    sounds: list(CHIP_SOUNDS.sfx),
    min_seconds: MIN_TRACK_SECONDS,
    max_seconds: MAX_TRACK_SECONDS,
    shells: src.shells.join(', '),
    sfx_engine: sfxEngineOf(media) === SFX_IMPORT_ONLY ? 'none (made by hand)' : sfxEngineOf(media)
  }
}

// ---- into the manifest ----

/**
 * The manifest after a plan: a track or a sound the plan names keeps its versions, selection, lock and review; its alt text follows the plan, and its
 * prompt and engine too unless it was locked, is a hand-made file or its prompt was set by hand (then they stay). A new asset is added; one the plan no
 * longer names stays in the manifest (nothing is deleted), but the pack no longer links it.
 */
export function mergeMusicPlan(manifest: AssetManifest, plan: Pick<MusicPlanFile, 'tracks' | 'sfx'>, media: Pick<CourseMedia, 'music'>): AssetManifest {
  let m = manifest
  const put = (derived: AssetEntry): void => {
    const old = getEntry(m, derived.id)
    if (!old) {
      m = replaceEntry(m, derived)
      return
    }
    const frozen = old.locked || old.source === 'custom'
    m = replaceEntry(m, { ...old, alt: derived.alt, ...(frozen ? {} : { engine: derived.engine }), ...(frozen || old.promptByHand ? {} : { prompt: derived.prompt }) })
  }
  for (const t of plan.tracks) put({ id: t.id, kind: 'music', prompt: trackPromptOf(t), engine: engineOfProvider(t.provider, media), seed: null, size: null, alt: t.alt, versions: [], selected: null, source: 'generated', locked: false })
  for (const x of plan.sfx) put({ id: x.id, kind: 'sfx', prompt: x.prompt, engine: x.engine, seed: null, size: null, alt: x.alt, versions: [], selected: null, source: 'generated', locked: false })
  return m
}
