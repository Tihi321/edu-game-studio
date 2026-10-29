import { z } from 'zod'
import { BUILTIN_LANGUAGES } from './languages'

/**
 * The media settings and the asset manifest: what the generators (ComfyUI, Pixel Studio, Chiptune Studio, Flow, local and cloud TTS) need to
 * know about a course. Schemas first, types inferred from them. EGS-02 adds the course contract itself (`course.ts`) on top.
 */

export const LANGS: readonly string[] = BUILTIN_LANGUAGES.map((l) => l.code)
/** The format of a language code only: whether it is known is checked where a language enters a project (`assertKnownLang`). */
export const langSchema = z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/, 'a language code such as en, hr, de or pt-br')
export type Lang = z.infer<typeof langSchema>

// ---- project settings (course.md frontmatter) ----

export const ART_PROVIDERS = ['comfy', 'pixel-studio-draw', 'hand', 'flow'] as const
export const PIXEL_PROVIDERS = ['builtin', 'pixel-studio'] as const
export const MUSIC_PROVIDERS = ['comfy', 'chiptune', 'flow'] as const
/** The chips of Chiptune Studio (`ps1` and `dreamcast` are its later, lusher chips; EGS-16 ported them with the composer). */
export const CHIPS = ['nes', 'gb', 'genesis', 'snes', 'pce', 'ps1', 'dreamcast'] as const
export const DITHERS = ['none', 'ordered', 'floyd'] as const
export type Chip = (typeof CHIPS)[number]
export type Dither = (typeof DITHERS)[number]

/** The pixel grid of a background (the game image is this grid scaled up with nearest-neighbour) and how the conversion looks. */
export const pixelSchema = z.object({
  width: z.number().int().min(16).max(512).optional(),
  height: z.number().int().min(16).max(512).optional(),
  dither: z.enum(DITHERS).optional(),
  /** A 1px outline round the opaque pixels (Pixel Studio import). */
  outline: z.boolean().optional()
})

/** The pixel settings a project that has none uses: 320x180 backgrounds (a 6x scale to 1920x1080). */
export const PIXEL_DEFAULTS = { width: 320, height: 180, dither: 'none' as Dither, outline: false }

/**
 * Projects from before per-language voices stored one voice id per speaker. Only the Google Flow ids (`gemini:`, `windows:`) still mean
 * something: the old Kokoro/Supertonic ids are dropped (a local TTS engine makes the clip from the speaker's uploaded reference instead).
 */
function legacyVoices(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const flowVoice = (id: unknown): boolean => typeof id === 'string' && (id.startsWith('gemini:') || id.startsWith('windows:'))
  const out: Record<string, unknown> = {}
  for (const [speaker, v] of Object.entries(raw)) {
    if (typeof v === 'string') {
      if (flowVoice(v)) out[speaker] = { en: v }
      continue
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const langs = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, id]) => flowVoice(id)))
    if (Object.keys(langs).length > 0) out[speaker] = langs
  }
  return out
}

/**
 * Brings a `voice` block from before the local engines in line with the schema: the old Flow delivery notes (`flowStyles`) become
 * `styles`, and `englishEngine` (Kokoro or Supertonic) is dropped together with a `vibetts` provider.
 */
function upgradeVoice(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
  const styles: Record<string, unknown> = out.styles && typeof out.styles === 'object' && !Array.isArray(out.styles) ? { ...(out.styles as Record<string, unknown>) } : {}
  const flowStyles = out.flowStyles
  if (flowStyles && typeof flowStyles === 'object' && !Array.isArray(flowStyles)) {
    for (const [speaker, style] of Object.entries(flowStyles as Record<string, unknown>)) {
      const kept = typeof styles[speaker] === 'string' ? (styles[speaker] as string).trim() : ''
      if (typeof style === 'string' && style.trim() && !kept) styles[speaker] = style
    }
  }
  out.styles = styles
  delete out.flowStyles
  delete out.englishEngine
  if (out.provider === 'vibetts') out.provider = 'comfy'
  return out
}

/** The default local TTS engine: OmniVoice reads every language, Croatian included. */
export const DEFAULT_VOICE_ENGINE = 'omnivoice'
/** The engine id of MOSS-SoundEffect v2: a selectable sound-effect engine (see `resolveSfxEngine` for the default). */
export const MOSS_SFX_ENGINE = 'moss-soundeffect-v2'
/** What an engine makes: music (the default), speech (TTS) or a sound effect. */
export type EngineTask = 'music' | 'tts' | 'sfx'

export const courseSettingsSchema = z.object({
  slug: z.string(),
  primaryLang: langSchema,
  /** The languages that have an edition (the primary one included). */
  editions: z.array(langSchema).default([]),
  /** The game theme, or null to pick one from the course. */
  theme: z.string().nullable().default(null),
  /** Models this course uses, per role (`art-director: client/claude-code`): they go before the agent's model and the role's list in config/roles.md, which stay as the fallback. */
  models: z.record(z.string(), z.string()).default({}),
  art: z
    .object({
      /** The art step runs (default). false: no image is planned or made (the course has no pictures, and no placeholder). */
      enabled: z.boolean().default(true),
      style: z.enum(['illustrated', 'pixel']).default('illustrated'),
      /** ComfyUI generator engine id. */
      generator: z.string().default('qwen-image-2.1'),
      /** ComfyUI edit engine id (sprites from the character sheet). */
      editor: z.string().default('qwen-image-2.1-edit'),
      /** A pixel palette name, for pixel mode. */
      palette: z.string().optional(),
      /** The art-critic reviews every generated image (needs a vision model; without one the check is skipped, with the reason). */
      review: z.boolean().default(true),
      /** The style words every image prompt starts with. Empty: derived from the format, genre and art mode (never from the bible's Style section, which is a writing note). */
      stylePrompt: z.string().optional(),
      /** How sprites get a transparent background: ComfyUI BiRefNet, a Qwen-Image edit pass then BiRefNet, or keying out a flat background. */
      bgRemoval: z.enum(['birefnet', 'qwen-edit', 'key']).default('birefnet'),
      /** Who makes the sprites: ComfyUI (the default), or `pixel-studio-draw`: an agent draws small pixel sprites in Pixel Studio, or `hand`: every image is made outside Edu Studio and set with edu_asset_replace (ComfyUI is never called for an image). Missing: `comfy`. */
      provider: z.enum(ART_PROVIDERS).optional(),
      /** `flow` only: the image model as Flow's menu shows it (`Nano Banana Pro`). Missing: Flow's newest Nano Banana. */
      flowModel: z.string().optional(),
      /** `flow` only: the Flow project the images are made in. Missing: `edu-<slug>`. */
      flowProject: z.string().optional(),
      /** Who turns an image into pixel art (pixel style only): the built-in sharp quantiser (`builtin`) or Pixel Studio. Missing: `builtin`. */
      pixelProvider: z.enum(PIXEL_PROVIDERS).optional(),
      /** Pixel art size and look. Missing fields take `PIXEL_DEFAULTS`. */
      pixel: pixelSchema.optional()
    })
    .default({ enabled: true, style: 'illustrated', generator: 'qwen-image-2.1', editor: 'qwen-image-2.1-edit', review: true, bgRemoval: 'birefnet' }),
  music: z
    .object({
      /** The music step runs (default). false: no music and no sound effect is planned or made (the course is silent, and has no placeholder). */
      enabled: z.boolean().default(true),
      engine: z.string().default('ace-step-v1-instrumental'),
      tracks: z.number().int().nonnegative().default(3),
      /** Who makes the music: ComfyUI (ACE-Step), Chiptune Studio or Flow Music. Missing: chiptune for pixel courses (and for the RPG and castle music of any course), else comfy. `flow` spends credits: it needs `flowCredits: true` as well. */
      provider: z.enum(MUSIC_PROVIDERS).optional(),
      /** The explicit opt-in to spend Flow Music credits. Flow Music is used only with `provider: flow` AND `flowCredits: true` (and at most `flowMusicMaxSongs` songs, `config/studios.md`). Default false. */
      flowCredits: z.boolean().default(false),
      /** The chip of Chiptune Studio. Missing: the composer picks one per track. */
      chip: z.enum(CHIPS).optional()
    })
    .default({ enabled: true, engine: 'ace-step-v1-instrumental', tracks: 3, flowCredits: false }),
  voice: z
    .preprocess(
      upgradeVoice,
      z.object({
        enabled: z.boolean().default(false),
        langs: z.array(langSchema).default([]),
        /** Where the clips come from: the local ComfyUI TTS Audio Suite (`comfy`, the default) or Google Flow (`flow`, cloud). */
        provider: z.enum(['comfy', 'flow']).default('comfy'),
        /** The local TTS engine of every language without an `engines` entry. */
        engine: z.string().default(DEFAULT_VOICE_ENGINE),
        /** Language -> a built-in TTS engine id (`omnivoice`, `f5-tts` ...) or `custom:<workflow>`. */
        engines: z.record(z.string(), z.string()).default({}),
        /** Speaker key (a character key or `narrator`) -> delivery style: the OmniVoice/Qwen3 instruct, Higgs inline tags, or the Flow style note. */
        styles: z.record(z.string(), z.string()).default({}),
        /** Speaker key -> the transcript of the speaker's `voice_<key>` reference clip (needed for cloning on F5, optional elsewhere). */
        refTexts: z.record(z.string(), z.string()).default({}),
        /** Speaker -> language -> Flow voice id (`gemini:<Name>` or `windows:<Voice Name>`); Flow only. */
        voices: z.preprocess(legacyVoices, z.record(z.string(), z.record(langSchema, z.string()))).default({})
      })
    )
    .default({ enabled: false, langs: [], provider: 'comfy', engine: DEFAULT_VOICE_ENGINE, engines: {}, styles: {}, refTexts: {}, voices: {} }),
  /**
   * Sound effects and ambiences. `ambienceEngine` is a ComfyUI music engine (the default) or `chiptune` (Chiptune Studio's `compose_sfx` ambience loops).
   * `sfxEngine` names the engine of a sound effect: an audio engine (MOSS-SoundEffect v2 included), `chiptune` (Chiptune Studio's `compose_sfx`) or a
   * `custom:<workflow>`. Missing: the music provider's engine (Chiptune Studio for a pixel course) or else `ambienceEngine`; MOSS-SoundEffect v2 is
   * offered as an explicit choice (its suite loader conflicts with some ComfyUI custom nodes, so it is not forced as the default).
   * `"none"` keeps sound effects import-only (`edu_asset_import`).
   */
  sound: z
    .object({
      ambienceEngine: z.string().default('ace-step-v1-instrumental'),
      sfxEngine: z.string().optional()
    })
    .default({ ambienceEngine: 'ace-step-v1-instrumental' })
})
export type CourseSettings = z.infer<typeof courseSettingsSchema>

/**
 * The media settings of a course, as `course.md` keeps them under `media` (frontmatter): `art`, `music`, `voice` and `sound` with the
 * shapes above, every field optional (a course with no `media` block gets the defaults: art `comfy`, the art-critic on, Flow off).
 */
export const courseMediaSchema = z.object({
  art: courseSettingsSchema.shape.art,
  music: courseSettingsSchema.shape.music,
  voice: courseSettingsSchema.shape.voice,
  sound: courseSettingsSchema.shape.sound
})
export type CourseMedia = z.infer<typeof courseMediaSchema>

/** `media` as a person or a brief gives it (any subset of the blocks); the settings of a course with none are `parseCourseMedia(undefined)`. */
export function parseCourseMedia(raw: unknown): CourseMedia {
  const r = courseMediaSchema.safeParse(raw === undefined || raw === null ? {} : raw)
  if (!r.success) throw new Error(`the media settings are not valid: ${r.error.issues.map((i) => `media.${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
  return r.data
}

// The newer settings are optional, so a project.md from before them still parses (and is saved unchanged). These give their values.

export function resolvePixel(art: Pick<CourseSettings['art'], 'pixel'>): { width: number; height: number; dither: Dither; outline: boolean } {
  const p = art.pixel ?? {}
  return { width: p.width ?? PIXEL_DEFAULTS.width, height: p.height ?? PIXEL_DEFAULTS.height, dither: p.dither ?? PIXEL_DEFAULTS.dither, outline: p.outline ?? PIXEL_DEFAULTS.outline }
}

export const resolvePixelProvider = (art: Pick<CourseSettings['art'], 'pixelProvider'>): (typeof PIXEL_PROVIDERS)[number] => art.pixelProvider ?? 'builtin'
/** Who turns the images of a pixel-art asset (an RPG tile set, a sprite) into pixel art: Pixel Studio unless the course says `builtin` (the built-in quantiser also runs, with a warning, when Pixel Studio is down). */
export const resolveRpgPixelProvider = (art: Pick<CourseSettings['art'], 'pixelProvider'>): (typeof PIXEL_PROVIDERS)[number] => art.pixelProvider ?? 'pixel-studio'
/** Who makes the images: ComfyUI unless the course says otherwise. Flow is only used when `art.provider` is `flow`. */
export const resolveArtProvider = (art: Pick<CourseSettings['art'], 'provider'>): (typeof ART_PROVIDERS)[number] => art.provider ?? 'comfy'
/** The asset kinds that are images. `illustration` is a picture of a fact (an article or an item), `tileset` a pixel-art tile sheet. */
export const IMAGE_KINDS: ReadonlySet<string> = new Set(['background', 'sheet', 'sprite', 'cover', 'cg', 'illustration', 'tileset'])
/** The image kinds that are pixel art whatever the art style of the course is (the RPG shell's art). */
export const PIXEL_KINDS: ReadonlySet<string> = new Set(['sprite', 'tileset'])
/** The asset kinds that are audio, made by a model or imported (a voice reference is audio too, but only ever uploaded). */
export const AUDIO_KINDS: ReadonlySet<string> = new Set(['music', 'sfx', 'ambience'])
/** Hand-made art: Edu Studio never generates an image (any art style). */
export const isHandArt = (art: Pick<CourseSettings['art'], 'provider'>): boolean => art.provider === 'hand'

/** The music provider: the chosen one, else Chiptune Studio for pixel-style courses and ComfyUI for the rest. */
export function resolveMusicProvider(settings: Pick<CourseSettings, 'art' | 'music'>): (typeof MUSIC_PROVIDERS)[number] {
  return settings.music.provider ?? (settings.art.style === 'pixel' ? 'chiptune' : 'comfy')
}

/**
 * Flow Music spends credits, so it is never a default: only a course that says `music.provider: flow` AND `music.flowCredits: true` may use it
 * (and then at most `flowMusicMaxSongs` songs, see `config/studios.md`).
 */
export const flowMusicAllowed = (settings: Pick<CourseSettings, 'music'>): boolean => settings.music.provider === 'flow' && settings.music.flowCredits === true

/** The TTS engine of one language: its `voice.engines` entry, else the course default `voice.engine`. */
export function resolveVoiceEngine(settings: Pick<CourseSettings, 'voice'>, lang: Lang | string): string {
  return settings.voice.engines[lang] ?? settings.voice.engine
}

/** The pseudo engine id of a music asset made by Chiptune Studio. */
export const CHIPTUNE_ENGINE = 'chiptune'
/** The pseudo engine id of an image made by Google Flow (through flow-music-mcp). */
export const FLOW_ENGINE = 'flow'
/** The pseudo engine id of a track made by Flow Music (spends Flow Music credits). */
export const FLOW_MUSIC_ENGINE = 'flow-music'
/** `sound.sfxEngine` set to this: sound effects are imported by hand, never generated. */
export const SFX_IMPORT_ONLY = 'none'

/**
 * The engine that makes a sound effect: `sound.sfxEngine` when set (`chiptune`, an audio engine or `custom:<workflow>`;
 * `"none"` keeps effects import-only). Else the music provider's engine: Chiptune Studio for a chiptune project, the ambience engine
 * (ACE-Step by default) for a ComfyUI one. MOSS-SoundEffect v2 is chosen explicitly when the installation can load it.
 */
export function resolveSfxEngine(settings: Pick<CourseSettings, 'art' | 'music' | 'sound'>): string {
  const chosen = settings.sound.sfxEngine?.trim()
  if (chosen === SFX_IMPORT_ONLY) return SFX_IMPORT_ONLY
  if (chosen) return chosen
  const provider = resolveMusicProvider(settings)
  if (provider === 'chiptune') return CHIPTUNE_ENGINE
  return settings.sound.ambienceEngine
}

// ---- assets (assets.json) ----

export const ASSET_KINDS = ['background', 'sheet', 'sprite', 'cover', 'cg', 'illustration', 'tileset', 'music', 'sfx', 'ambience', 'voiceRef'] as const
export const assetKindSchema = z.enum(ASSET_KINDS)
export type AssetKind = z.infer<typeof assetKindSchema>

export const assetVersionSchema = z.object({
  n: z.number().int().positive(),
  /** File name inside `assets/<id>/`. */
  file: z.string(),
  createdAt: z.string(),
  seed: z.number().nullable(),
  engine: z.string(),
  prompt: z.string(),
  /** Music from Chiptune Studio: where the loop starts and ends, in seconds. the player loops between them. */
  loopStartSec: z.number().nullable().optional(),
  loopEndSec: z.number().nullable().optional(),
  /** Made by Google Flow / Flow Music: the Flow media id (images) or song id, so a later image can use it as a reference. */
  remote: z.object({ provider: z.enum(['flow', 'flow-music']), id: z.string(), project: z.string().optional() }).optional(),
  /** Chiptune Studio's native song file of this version (next to the audio), for "Open in Chiptune Studio". */
  songFile: z.string().optional(),
  /** Pixel Studio art: the PNG at the native pixel size (before the nearest-neighbour scale up), for "Open in Pixel Studio". */
  nativeFile: z.string().optional(),
  /** Non-fatal problems of making this version (Pixel Studio was down, so the built-in pixelate ran ...). */
  warnings: z.array(z.string()).optional(),
  /** Made by hand in a studio (the round trip): the pipeline never regenerates it. */
  custom: z.boolean().optional()
})
export type AssetVersion = z.infer<typeof assetVersionSchema>

export const assetEntrySchema = z.object({
  id: z.string(),
  kind: assetKindSchema,
  prompt: z.string(),
  negative: z.string().optional(),
  engine: z.string(),
  seed: z.number().nullable(),
  size: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }).nullable(),
  /** Asset ids used as references (a sprite uses its character sheet). */
  refs: z.array(z.string()).optional(),
  versions: z.array(assetVersionSchema),
  /** The selected version number, or null when none is chosen yet. */
  selected: z.number().int().positive().nullable(),
  source: z.enum(['generated', 'custom']),
  /** The uploaded file, when `source` is `custom`. */
  customFile: z.string().optional(),
  /** Locked assets are never regenerated. */
  locked: z.boolean(),
  /** The prompt was set with `edu_asset_set`: the art-director and composer keep it. */
  promptByHand: z.boolean().optional(),
  /** What the asset shows, in a sentence (the alt text of the image; the catalog key `asset.<id>.alt` holds it). */
  alt: z.string().optional(),
  /** `illustrated` or `pixel`: how the asset looks (an RPG tile set and sprite are always pixel). */
  style: z.enum(['illustrated', 'pixel']).optional(),
  /** Who makes this asset's image, over the course's `art.provider` (set with `edu_asset_set`). */
  provider: z.enum(['comfy', 'flow']).optional(),
  /** The size the picture is fitted to when it is finished (a hotspot image is fitted to its item's width and height). Missing: by kind. */
  fit: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }).optional(),
  /** No image could be made yet: the placeholder card in `assets/<id>/<file>` stands in (lint warns `PLACEHOLDER_ASSET`) until a version exists. */
  placeholder: z.object({ file: z.string(), reason: z.string() }).optional(),
  review: z
    .object({
      status: z.enum(['pending', 'approved', 'rejected']),
      note: z.string().optional(),
      /** The version the art-critic looked at. */
      version: z.number().int().positive().optional(),
      /** The art-critic rounds spent on this asset. */
      rounds: z.number().int().nonnegative().optional()
    })
    .optional()
})
export type AssetEntry = z.infer<typeof assetEntrySchema>

export const assetManifestSchema = z.object({ assets: z.array(assetEntrySchema) })
export type AssetManifest = z.infer<typeof assetManifestSchema>
