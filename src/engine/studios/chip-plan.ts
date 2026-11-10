import { z } from 'zod'
import { CHIPS } from '../../shared/media'
import type { Chip } from '../../shared/media'

/** Ported from VN Studio (EGS-16). The calm moods Chiptune Studio composes for a learning game (`compose_track`, see contracts.md). */
export const CALM_MOODS = ['ambient', 'lullaby', 'peaceful', 'mysterious-calm', 'calm', 'chill', 'underwater', 'sad'] as const

/** The moods for kids and learning that Chiptune Studio added with the `gm` chip (EGS-70): lighter and livelier than the calm ones. `focus` is steady study music, `adventure-light` a travelling theme. */
export const LIVELY_MOODS = ['playful', 'curious', 'focus', 'wonder', 'cafe', 'adventure-light', 'storybook'] as const

/** The textures of `compose_track` (the shape of the accompaniment) and the forms (A/B sections). */
export const TEXTURES = ['pad-lead', 'broken-chord', 'ostinato', 'chorale', 'march', 'bossa', 'lullaby-rock', 'pizzicato-walk'] as const
export const FORMS = ['A', 'AB', 'ABA', 'AABA'] as const

/** The synth moods (`compose_track`, calmest first) and the tempo range Chiptune Studio gives each. Only books that look 80s / neon / retro-futuristic get them. */
export const SYNTH_MOODS = ['dreamwave', 'synthwave', 'darkwave', 'outrun'] as const
export const MUSIC_MOODS = [...CALM_MOODS, ...LIVELY_MOODS, ...SYNTH_MOODS] as const
const SYNTH_BPM: Record<string, [number, number]> = { dreamwave: [80, 100], synthwave: [96, 118], darkwave: [88, 112], outrun: [108, 118] }

/** What the composer plans for one chiptune track: the arguments of `compose_track` that are not the seed. */
export interface ChipTrackPlan {
  mood: string
  chip: Chip
  bpm: number
  /** A key name such as `C`, `F#`, `Eb`. */
  key: string
  bars: number
  /** One of `TEXTURES` and `FORMS`: only when the plan or the composer asked for one (else Chiptune Studio picks). */
  texture?: string
  form?: string
  /** Channel -> preset id, for the `gm` chip. */
  instruments?: Record<string, string>
}

/** The composer's answer for a track (every field optional: what is missing comes from the deterministic plan). */
export const chipTrackPlanSchema = z.object({
  mood: z.string().optional(),
  chip: z.string().optional(),
  bpm: z.number().optional(),
  key: z.string().optional(),
  bars: z.number().optional(),
  texture: z.string().optional(),
  form: z.string().optional(),
  instruments: z.record(z.string(), z.string()).optional()
})
export type ChipTrackPlanDraft = z.infer<typeof chipTrackPlanSchema>

export const MIN_BPM = 50
export const MAX_BPM = 100
/** The cap for a synth mood (Chiptune's own: synthwave 96-118, outrun 108-118). */
export const MAX_SYNTH_BPM = 118
/** The cap for the `gm` chip (EGS-70: its livelier moods run to 128). */
export const MAX_GM_BPM = 128
/** The cap of the lively moods on any chip (Chiptune Studio's own ranges: playful 100-126, adventure-light 104-128). */
const MOOD_MAX_BPM: Record<string, number> = { playful: 126, 'adventure-light': 128, curious: 112, wonder: 110, cafe: 110 }

/** The highest tempo Chiptune Studio gives a mood on a chip. */
export function maxBpmFor(chip: string, mood: string): number {
  if ((SYNTH_MOODS as readonly string[]).includes(mood)) return MAX_SYNTH_BPM
  if (chip === 'gm') return MAX_GM_BPM
  return Math.max(MAX_BPM, MOOD_MAX_BPM[mood] ?? 0)
}
export const MIN_BARS = 8
export const MAX_BARS = 48

const KEYS = ['C', 'F', 'G', 'D', 'A', 'Eb', 'Bb', 'E']
const BPMS = [72, 66, 78, 70, 84, 64, 92, 76]
const KEY_RE = /^[A-G][#b]?$/

export const SYNTH_GENRE = /synthwave|retrowave|outrun|vaporwave|neon|\b80s\b|1980s|retro-?futur/i
export const PS1_GENRE = /ps1|playstation|psx|y2k|\b90s\b|1990s/i
/** A pixel / retro look: the course keeps a chip (SNES) instead of the SoundFont chip. */
export const PIXEL_GENRE = /pixel|retro|8-?bit|16-?bit|chiptune/i

const GENRE_MOOD: Array<[RegExp, string]> = [
  [SYNTH_GENRE, 'dreamwave'],
  [/kids|children|bedtime|lullaby/i, 'lullaby'],
  [/myster|detective|noir|crime|horror|gothic|ghost/i, 'mysterious-calm'],
  [/sci-?fi|space|cyber/i, 'ambient']
]

/** The number in a music asset id (`music_03` is 3). */
export const trackNumber = (id: string): number => Number(id.replace(/^music_/, '')) || 1

/** The chip a course looks like: the chip chosen for the project, else its palette (Game Boy or NES colours), else its genre (synth: Dreamcast, late 90s: PS1), else SNES for a pixel / retro look, else `gm` (the SoundFont chip, real instruments; EGS-70). */
export function chipFor(opts: { chip?: Chip; palette?: string; genreText?: string }): Chip {
  if (opts.chip) return opts.chip
  if (opts.palette && /gameboy|gb/i.test(opts.palette)) return 'gb'
  if (opts.palette && /nes/i.test(opts.palette)) return 'nes'
  if (SYNTH_GENRE.test(opts.genreText ?? '')) return 'dreamcast'
  if (PS1_GENRE.test(opts.genreText ?? '')) return 'ps1'
  return PIXEL_GENRE.test(opts.genreText ?? '') ? 'snes' : 'gm'
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
  const bpm = draft.bpm && Number.isFinite(draft.bpm) ? Math.min(maxBpmFor(chip, mood), Math.max(MIN_BPM, Math.round(draft.bpm))) : base.bpm
  const key = draft.key && KEY_RE.test(draft.key.trim()) ? draft.key.trim() : base.key
  const bars = draft.bars && Number.isFinite(draft.bars) ? Math.min(MAX_BARS, Math.max(MIN_BARS, Math.round(draft.bars))) : base.bars
  const texture = draft.texture && (TEXTURES as readonly string[]).includes(draft.texture) ? draft.texture : undefined
  const form = draft.form && (FORMS as readonly string[]).includes(draft.form) ? draft.form : undefined
  const instruments = draft.instruments && Object.keys(draft.instruments).length ? draft.instruments : undefined
  return { mood, chip, bpm, key, bars, ...(texture ? { texture } : {}), ...(form ? { form } : {}), ...(instruments ? { instruments } : {}) }
}

/** A one-line description of the plan, kept as the asset's prompt so the gallery shows what the track is. */
export const planSummary = (p: ChipTrackPlan): string => `chiptune: ${p.mood}, ${p.chip}, ${p.bpm} bpm, key ${p.key}, ${p.bars} bars${p.texture ? `, ${p.texture}` : ''}${p.form ? ` ${p.form}` : ''}`
