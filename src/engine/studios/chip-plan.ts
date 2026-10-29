import { z } from 'zod'
import { CHIPS } from '../../shared/media'
import type { Chip } from '../../shared/media'

/** Ported from VN Studio (EGS-16). The calm moods Chiptune Studio composes for a learning game (`compose_track`, see contracts.md). */
export const CALM_MOODS = ['ambient', 'lullaby', 'peaceful', 'mysterious-calm', 'calm', 'chill', 'underwater', 'sad'] as const

/** The synth moods (`compose_track`, calmest first) and the tempo range Chiptune Studio gives each. Only books that look 80s / neon / retro-futuristic get them. */
export const SYNTH_MOODS = ['dreamwave', 'synthwave', 'darkwave', 'outrun'] as const
export const MUSIC_MOODS = [...CALM_MOODS, ...SYNTH_MOODS] as const
const SYNTH_BPM: Record<string, [number, number]> = { dreamwave: [80, 100], synthwave: [96, 118], darkwave: [88, 112], outrun: [108, 118] }

/** What the composer plans for one chiptune track: the arguments of `compose_track` that are not the seed. */
export interface ChipTrackPlan {
  mood: string
  chip: Chip
  bpm: number
  /** A key name such as `C`, `F#`, `Eb`. */
  key: string
  bars: number
}

/** The composer's answer for a track (every field optional: what is missing comes from the deterministic plan). */
export const chipTrackPlanSchema = z.object({
  mood: z.string().optional(),
  chip: z.string().optional(),
  bpm: z.number().optional(),
  key: z.string().optional(),
  bars: z.number().optional()
})
export type ChipTrackPlanDraft = z.infer<typeof chipTrackPlanSchema>

export const MIN_BPM = 50
export const MAX_BPM = 100
/** The cap for a synth mood (Chiptune's own: synthwave 96-118, outrun 108-118). */
export const MAX_SYNTH_BPM = 118
export const MIN_BARS = 8
export const MAX_BARS = 48

const KEYS = ['C', 'F', 'G', 'D', 'A', 'Eb']
const BPMS = [72, 66, 78, 70, 84, 64]
const KEY_RE = /^[A-G][#b]?$/

const SYNTH_GENRE = /synthwave|retrowave|outrun|vaporwave|neon|\b80s\b|1980s|retro-?futur/i
const PS1_GENRE = /ps1|playstation|psx|y2k|\b90s\b|1990s/i

const GENRE_MOOD: Array<[RegExp, string]> = [
  [SYNTH_GENRE, 'dreamwave'],
  [/kids|children|bedtime|lullaby/i, 'lullaby'],
  [/myster|detective|noir|crime|horror|gothic|ghost/i, 'mysterious-calm'],
  [/sci-?fi|space|cyber/i, 'ambient']
]

/** The number in a music asset id (`music_03` is 3). */
export const trackNumber = (id: string): number => Number(id.replace(/^music_/, '')) || 1

/** The chip a book looks like: the chip chosen for the project, else its palette (Game Boy or NES colours), else its genre (synth: Dreamcast, late 90s: PS1), else SNES (the softest). */
export function chipFor(opts: { chip?: Chip; palette?: string; genreText?: string }): Chip {
  if (opts.chip) return opts.chip
  if (opts.palette && /gameboy|gb/i.test(opts.palette)) return 'gb'
  if (opts.palette && /nes/i.test(opts.palette)) return 'nes'
  if (SYNTH_GENRE.test(opts.genreText ?? '')) return 'dreamcast'
  if (PS1_GENRE.test(opts.genreText ?? '')) return 'ps1'
  return 'snes'
}

/** Bars for a length in seconds at a tempo (4/4), in whole groups of four so a phrase ends cleanly. */
export function barsFor(seconds: number, bpm: number): number {
  const bars = Math.round(((seconds * bpm) / 240 / 4)) * 4
  return Math.min(MAX_BARS, Math.max(MIN_BARS, bars))
}

/** The deterministic plan of a track: a calm mood from the genre (a synth book gets the synth moods; rotating over the tracks), a slow tempo, a key and a length. */
export function fallbackChipPlan(id: string, opts: { genreText?: string; chip?: Chip; palette?: string; seconds?: number }): ChipTrackPlan {
  const n = trackNumber(id)
  const base = GENRE_MOOD.find(([re]) => re.test(opts.genreText ?? ''))?.[1] ?? 'peaceful'
  const synth = SYNTH_GENRE.test(opts.genreText ?? '')
  const moods = synth ? ['dreamwave', 'synthwave', 'darkwave', 'dreamwave', 'ambient'] : [...new Set([base, 'peaceful', 'ambient', 'calm', 'lullaby'])]
  const mood = moods[(n - 1) % moods.length]!
  const range = SYNTH_BPM[mood]
  const slow = BPMS[(n - 1) % BPMS.length]!
  const bpm = range ? Math.min(range[1], Math.max(range[0], slow)) : slow
  return { mood, chip: chipFor(opts), bpm, key: KEYS[(n - 1) % KEYS.length]!, bars: barsFor(opts.seconds ?? 100, bpm) }
}

/** The composer's draft over the deterministic plan: unknown moods and chips, wild tempos and lengths fall back. */
export function mergeChipPlan(draft: ChipTrackPlanDraft | undefined, base: ChipTrackPlan, forceChip?: Chip): ChipTrackPlan {
  if (!draft) return forceChip ? { ...base, chip: forceChip } : base
  const mood = draft.mood && (MUSIC_MOODS as readonly string[]).includes(draft.mood) ? draft.mood : base.mood
  const chip = forceChip ?? ((CHIPS as readonly string[]).includes(draft.chip ?? '') ? (draft.chip as Chip) : base.chip)
  const bpm = draft.bpm && Number.isFinite(draft.bpm) ? Math.min((SYNTH_MOODS as readonly string[]).includes(mood) ? MAX_SYNTH_BPM : MAX_BPM, Math.max(MIN_BPM, Math.round(draft.bpm))) : base.bpm
  const key = draft.key && KEY_RE.test(draft.key.trim()) ? draft.key.trim() : base.key
  const bars = draft.bars && Number.isFinite(draft.bars) ? Math.min(MAX_BARS, Math.max(MIN_BARS, Math.round(draft.bars))) : base.bars
  return { mood, chip, bpm, key, bars }
}

/** A one-line description of the plan, kept as the asset's prompt so the gallery shows what the track is. */
export const planSummary = (p: ChipTrackPlan): string => `chiptune: ${p.mood}, ${p.chip}, ${p.bpm} bpm, key ${p.key}, ${p.bars} bars`
