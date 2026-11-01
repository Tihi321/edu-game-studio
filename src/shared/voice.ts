/**
 * The voice plan of a course (EGS-17): what the voice-director chose to speak, as data (`courses/<slug>/pipeline/voice.json`), the stable ids of the
 * clips, the listening items derived from taught phrases, and what the merge into the pack needs. Pure (no DOM, no filesystem), so the engine, the
 * tools and the tests share it.
 *
 *   clip ids       voice-<lang>-<text key sanitized>     (voice-hr-t-dobar-dan, voice-en-unit-u1-summary)
 *   listening      every `listening` item (hand-made too) gets the clip of its transcript; `item.asset` points at it
 *   derived items  `<sourceItemId>-listen`: a listening item made from a taught phrase of an item that passed the fact-check
 *   narration      `pack.extensions.narration = {<text key>: <clip id>}` (the encyclopedia shell reads it; the quiz arena needs no narration UI)
 */

/** The suffix of a derived listening item's id: `u1-q3` -> `u1-q3-listen`. */
export const LISTEN_SUFFIX = '-listen'
export const derivedListeningId = (sourceItemId: string): string => `${sourceItemId}${LISTEN_SUFFIX}`

const MAX_ID = 72

/** A short stable hash (FNV-1a, 8 hex digits) for the cut-down ids: not for security. */
function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

/** The id of the clip that speaks the text of `key` in `lang`. A long key is cut and given a short hash, so two long keys never collide. */
export function voiceClipId(lang: string, key: string): string {
  const part = key.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'clip'
  const id = `voice-${lang.toLowerCase()}-${part}`
  if (id.length <= MAX_ID) return id
  return `${id.slice(0, MAX_ID - 9).replace(/-+$/, '')}-${shortHash(key)}`
}

/** What a narration clip speaks at most: a long article is cut at a sentence ("short narration with text beside it", design rule 8). */
export const NARRATION_MAX_CHARS = 600

/** `text` cut to at most `max` characters, at the end of a sentence when there is one (else at a word, with an ellipsis). */
export function shortenForSpeech(text: string, max = NARRATION_MAX_CHARS): string {
  const t = text.replace(/\s+/g, ' ').replace(/\s*\[f?\d+\]/g, '').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  if (end >= max * 0.4) return cut.slice(0, end + 1).trim()
  return `${cut.replace(/\s+\S*$/, '').trim()}...`
}

/** What a passage clip speaks at most (EGS-38): a paragraph longer than this is split at a sentence, so each clip stays short. */
export const PASSAGE_MAX_CHARS = 450

/** The asset id of a passage clip: paragraph `n` (1-based) of an article; the 2nd, 3rd ... piece of a long paragraph has a `-<k>` suffix. */
export const passageClipId = (article: string, paragraph: number, part = 1): string => `art-${article}-p${paragraph}${part > 1 ? `-${part}` : ''}`

/** One spoken piece of a reading: the paragraph it belongs to (1-based), its piece number inside a split paragraph (1-based) and its text. */
export interface PassageChunk {
  paragraph: number
  part: number
  text: string
}

/** The paragraphs of an article body (blank lines dropped, as the reader shows them), each cut at sentence ends into pieces of at most `max` characters. Deterministic. */
export function passageChunks(body: string, max = PASSAGE_MAX_CHARS): PassageChunk[] {
  const out: PassageChunk[] = []
  const paragraphs = body
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, ' ').replace(/\s*\[f?\d+\]/g, '').trim())
    .filter(Boolean)
  paragraphs.forEach((p, i) => {
    const sentences = p.match(/[^.!?]+[.!?]+["»“”)]*\s*|[^.!?]+$/g) ?? [p]
    const pieces: string[] = []
    let cur = ''
    for (const s of sentences) {
      if (cur && (cur + s).length > max) {
        pieces.push(cur.trim())
        cur = ''
      }
      cur += s
    }
    if (cur.trim()) pieces.push(cur.trim())
    pieces.forEach((text, k) => out.push({ paragraph: i + 1, part: k + 1, text }))
  })
  return out
}

/** The text a clip speaks, from the current catalog text of its key: narration is cut at a sentence, a passage clip is its paragraph piece, the rest as it is. */
export function spokenText(clip: { role: VoiceClipRole; paragraph?: number; part?: number }, text: string, narrationMax = NARRATION_MAX_CHARS): string {
  if (clip.role === 'narration') return shortenForSpeech(text, narrationMax)
  if (clip.role === 'passage') return passageChunks(text).find((c) => c.paragraph === clip.paragraph && c.part === (clip.part ?? 1))?.text ?? ''
  return text
}

export type VoiceClipRole = 'listening' | 'narration' | 'passage'

/** One clip of the plan. */
export interface VoiceClipPlan {
  /** `voice-<lang>-<key>`. */
  id: string
  lang: string
  /** The catalog key whose text is spoken. */
  key: string
  role: VoiceClipRole
  /** A passage clip (EGS-38): the paragraph of the article body (1-based) and the piece of it when the paragraph was split. */
  paragraph?: number
  part?: number
  /** The text at planning time; generation reads the catalog again (a text changed since is spoken as it is now). */
  text: string
  /** The sentence a learner who cannot hear it reads (the catalog key `asset.<id>.alt`), in the source language. */
  alt: string
  /** The listening items that use this clip. */
  items?: string[]
}

/** A listening item derived from a taught phrase: the pack item, the catalog strings it needs and its clip. */
export interface DerivedListening {
  /** `<source>-listen`. */
  id: string
  source: string
  /** The unit of the source item (for the per-unit cap and the report). */
  unit?: string
  mode: 'choose' | 'type'
  /** The pack item (kind `listening`) without its `asset`: the merge sets it from the clip. */
  item: Record<string, unknown>
  /** Catalog strings the item adds, by language (the prompt in the source language; the transcript in the target language when it is a new key). */
  strings: Record<string, Record<string, string>>
  /** The clip that speaks its transcript. */
  clip: string
}

/** How one language is spoken (`pipeline/voice.json` `voices`): the delivery style and, per provider, the voice. */
export interface VoiceLangPlan {
  /** The delivery note: `a calm, clear teacher speaking slowly`. Part of the clip hash. */
  style?: string
  /** The Gemini voice (`gemini:Kore`). */
  gemini?: string
  /** The VibeTTS voice (`supertonic:F1`, `am_michael`). */
  vibetts?: string
}

export type VoiceProviderUsed = 'gemini' | 'vibetts' | 'comfy'

/** What the allocation decided for one language in a run (recorded in the plan and shown by `edu_voice_status`). */
export interface VoiceAllocationEntry {
  lang: string
  /** Clips that needed speaking (the hash index had no up-to-date clip). */
  need: number
  /** The provider the language went to first, or `none` when nothing needed speaking or nothing can speak it. */
  provider: VoiceProviderUsed | 'none'
  /** The order the providers were tried in (the first is `provider`; the rest took over when it went down). */
  chain: VoiceProviderUsed[]
  reason: string
  /** Filled in after the run: how many clips each provider made. */
  made?: Partial<Record<VoiceProviderUsed, number>>
  /** Filled in after the run: clips left as silent placeholders. */
  placeholders?: number
}

export interface VoicePlanFile {
  version: 1
  source: 'model' | 'fallback'
  note?: string
  at: string
  sourceLang: string
  targetLang?: string
  /** Per language: the delivery style and the voices. */
  voices: Record<string, VoiceLangPlan>
  clips: VoiceClipPlan[]
  derived: DerivedListening[]
  /** The allocation of the last generation, per language. */
  allocation?: Record<string, VoiceAllocationEntry>
  warnings?: string[]
}

/** What the media merge needs from the voice plan, for the clips that have a file (see `media-link.ts`). */
export interface VoiceMerge {
  /** Derived listening items, put after their source item (an item of an earlier merge that is no longer here is removed). */
  items: Record<string, unknown>[]
  /** Catalog strings the derived items need, by language. */
  strings: Record<string, Record<string, string>>
  /** Listening item id -> clip asset id (`item.asset`). */
  listening: Record<string, string>
  /** Narration text key -> clip asset id (`pack.extensions.narration`). */
  narration: Record<string, string>
}

/** The marker a derived item carries in `extensions.voice`, so a merge can tell it from a hand-made item. */
export const DERIVED_MARK = 'voice'
export const isDerivedItem = (item: unknown): boolean => {
  const ext = (item as { extensions?: Record<string, unknown> } | null)?.extensions
  const mark = ext?.[DERIVED_MARK] as { derivedFrom?: unknown } | undefined
  return !!mark && typeof mark.derivedFrom === 'string'
}
