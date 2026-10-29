import type { Lang, CourseSettings } from '../../shared/media'
import { sha1 } from './vocab'

/**
 * The voice lists the planners work from: Google Flow's free narration engines and, for the local TTS engines, the engine
 * catalogue. `pickVoices` and `describeVoices` spread the Flow voices over a cast without any model; the local engines need no
 * voice ids (each speaker's identity comes from the uploaded reference clip and its delivery style).
 */

export type Gender = 'female' | 'male'

export const NARRATOR = 'narrator'

/**
 * One voice of a list: a Flow voice (`gemini:<Name>`, `windows:<Voice Name>`) or, when the list describes local engines, an
 * engine id (`omnivoice`). `languages` holds the codes it reads; `engine` says where it comes from.
 */
export interface VoiceEntry {
  id: string
  label: string
  /** `gemini`, `windows`, or a local TTS engine id (`omnivoice`). */
  engine?: string
  /** The language codes it reads. */
  languages: string[]
  /** Known from the list (Google Flow's voices carry one). */
  gender?: Gender
}

/** A list of voices as a planner (and `pickVoices`) takes it. */
export interface VoiceList {
  voices: VoiceEntry[]
}

/** `female` / `male` from a model's word (case and a few near-misses tolerated), else null. */
export function parseGender(raw: unknown): Gender | null {
  const w = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (['female', 'woman', 'f', 'girl', 'feminine'].includes(w)) return 'female'
  if (['male', 'man', 'm', 'boy', 'masculine'].includes(w)) return 'male'
  return null
}

/** What the bible says about a speaker. */
export interface VoiceHints {
  key: string
  name: string
  looks: string
  voiceHint: string
}

const WORDS = (s: string, ...res: RegExp[]): boolean => res.some((r) => r.test(s))

/**
 * The gender from the bible text alone (used when the voice-director does not answer, or leaves it out). The narrator is female unless the
 * text says otherwise; a character the text says nothing about gets a stable gender from its key, so the cast is not all one gender.
 */
export function guessGender(h: VoiceHints): Gender {
  const text = `${h.looks} ${h.voiceHint}`.toLowerCase()
  if (WORDS(text, /\b(she|her|hers|girl|woman|female|mother|lady|daughter|sister|queen|princess|witch|djevojk\w*|žen\w*|majk\w*|kći|sestr\w*)\b/)) return 'female'
  if (WORDS(text, /\b(he|his|him|boy|man|male|father|gentleman|son|brother|king|prince|wizard|dječak\w*|muškar\w*|otac|brat\w*|sin)\b/)) return 'male'
  if (h.key === NARRATOR) return 'female'
  return parseInt(sha1(h.key).slice(0, 2), 16) % 2 === 0 ? 'female' : 'male'
}

/** The gender a list gives a voice, else null. */
const genderOf = (v: Pick<VoiceEntry, 'gender'>): Gender | null => v.gender ?? null

/** One speaker to give a voice. `preferred` is the voice-director's pick: used when it is a candidate of the speaker's gender and not taken. */
export interface VoiceWish {
  key: string
  gender: Gender
  preferred?: string
}

/**
 * A voice for each speaker from `candidates`, deterministic: the same input gives the same voices.
 * Speakers of one gender spread over that gender's voices, so they differ while there are enough voices; then voices are reused round-robin.
 * The narrator goes last and takes a voice the cast does not use where it can. `taken` voices (already given to other speakers of this
 * language) count as used. A gender with no candidates draws from all of them.
 */
export function pickVoices(speakers: readonly VoiceWish[], candidates: readonly VoiceEntry[], taken: readonly string[] = []): Record<string, string> {
  const out: Record<string, string> = {}
  if (!candidates.length) return out
  const uses = new Map<string, number>(candidates.map((v) => [v.id, 0]))
  for (const id of taken) if (uses.has(id)) uses.set(id, uses.get(id)! + 1)
  const ids = new Set(candidates.map((v) => v.id))
  const ordered = [...speakers.filter((s) => s.key !== NARRATOR), ...speakers.filter((s) => s.key === NARRATOR)]
  for (const s of ordered) {
    const same = candidates.filter((v) => genderOf(v) === s.gender)
    const pool = same.length ? same : candidates
    let id: string | undefined
    if (s.preferred && ids.has(s.preferred) && uses.get(s.preferred) === 0) {
      const preferred = candidates.find((v) => v.id === s.preferred)
      if (preferred && (genderOf(preferred) === s.gender || genderOf(preferred) === null)) id = s.preferred
    }
    if (!id) {
      const start = parseInt(sha1(s.key).slice(0, 8), 16) % pool.length
      const least = Math.min(...pool.map((v) => uses.get(v.id)!))
      for (let i = 0; i < pool.length && !id; i++) {
        const v = pool[(start + i) % pool.length]!
        if (uses.get(v.id) === least) id = v.id
      }
    }
    out[s.key] = id!
    uses.set(id!, uses.get(id!)! + 1)
  }
  return out
}

/**
 * The languages a project speaks: `voice.langs`, else its primary language, plus every edition language (voices are per
 * language by design: adding an edition does not need `voice.langs` to be edited first). The primary language is kept.
 */
export const voiceLangsOf = (settings: Pick<CourseSettings, 'primaryLang' | 'voice'> & { editions?: readonly Lang[] }): Lang[] => {
  const langs: Lang[] = settings.voice.langs.length ? [...settings.voice.langs] : [settings.primaryLang]
  for (const lang of [settings.primaryLang, ...(settings.editions ?? [])]) if (!langs.includes(lang)) langs.push(lang)
  return langs
}

/** The voice list as the Flow planner's prompt shows it: per language, the voices that can read it with their gender. */
export function describeVoices(voices: readonly VoiceEntry[], langs: readonly Lang[] | readonly string[]): string {
  return langs
    .map((lang) => {
      const list = voices.filter((v) => v.languages.includes(lang))
      return `${lang}: ${list.length ? list.map((v) => `${v.id} (${genderOf(v) ?? 'any'}, ${v.label})`).join('; ') : '(no voice reads this language)'}`
    })
    .join('\n')
}

/** One local TTS engine as the planner's prompt shows it. */
export interface TtsEngineInfo {
  id: string
  label: string
  /** The codes it reads, `'*'` for any language. */
  languages: readonly string[] | '*'
}

/**
 * The local engine list the voice-director sees: per project language, the TTS engines that read it (id and label), so it can pick
 * one engine per language. Empty groups say so, which is how the planner learns a language needs the default engine.
 */
export function describeTtsEngines(engines: readonly TtsEngineInfo[], langs: readonly Lang[] | readonly string[]): string {
  return langs
    .map((lang) => {
      const list = engines.filter((e) => e.languages === '*' || e.languages.includes(lang))
      return `${lang}: ${list.length ? list.map((e) => `${e.id} (${e.label})`).join('; ') : '(no engine reads this language)'}`
    })
    .join('\n')
}
