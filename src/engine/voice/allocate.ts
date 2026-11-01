import type { VoiceProvider } from '../../shared/media'
import type { VoiceAllocationEntry, VoiceProviderUsed } from '../../shared/voice'

/**
 * The hub's voice allocation rule (EGS-17), pure so it can be unit-tested without a provider:
 *
 *   - Google's free Gemini TTS allows 10 requests a day. `remaining = limit - used` (the counter is `quota.ts`).
 *   - Languages are allocated WHOLE (a language never mixes providers in one run), Croatian first, then English, then the rest by code:
 *       a language whose clips (the ones that need speaking) fit in what is left goes to Gemini and uses it up; else it goes local.
 *     So hr and en together over the quota: Croatian on Gemini, English local; both fit: both Gemini; neither fits: both local.
 *   - Local means VibeTTS when it reads the language (Kokoro: English and a few others, never Croatian or German; Supertonic or Higgs: Croatian, German; `reads` is a probe of the `list_voices` language codes, not a list in code), else ComfyUI TTS; when the first local provider is
 *     down the other one takes over; when nothing can speak, the clips become placeholders and warnings (never a failed run).
 *   - Gemini down (flow-music-mcp not running, signed out, no key) or a quota error in the middle of a run: the rest of that language falls back to
 *     local (the chain below says in which order; `run.ts` follows it); clips already made stay.
 *   - A course may force a provider (`media.voice.provider`): `vibetts` and `comfy` never use Gemini and try that provider first; `gemini` allocates
 *     like `auto` (the quota still applies, a language that does not fit goes local).
 */

/** Language codes a VibeTTS engine never reads, whatever a listing claims (Kokoro has no German or Croatian voice). */
const NEVER_READS: Record<string, readonly string[]> = { kokoro: ['de', 'hr'] }

/** True when a VibeTTS voice (from `list_voices`) reads `lang`: the one place that decides it. */
export const voiceReads = (v: { engine?: string; languages: readonly string[] }, lang: string): boolean =>
  v.languages.includes(lang) && !(NEVER_READS[(v.engine ?? '').toLowerCase()] ?? []).includes(lang)

/** What can speak what, as the run probed it. */
export interface VoiceAvailability {
  /** flow-music-mcp is up, Google Flow is signed in and the Gemini voices are ready. */
  gemini: { up: boolean; reason?: string }
  /** VibeTTS answers and lists a voice for the language. */
  vibetts: { up: boolean; reads: (lang: string) => boolean; reason?: string }
  /** ComfyUI's TTS engine for the language exists (ComfyUI itself is assumed up: a call that finds it down moves the clips on). */
  comfy: { up: boolean; reads: (lang: string) => boolean; reason?: string }
}

export interface AllocationInput {
  /** The clips that need speaking, per language (the clips the hash index already has are not counted). */
  need: Record<string, number>
  provider: VoiceProvider
  /** The Gemini counter: `limit - used` requests are left today. */
  quota: { limit: number; used: number }
  avail: VoiceAvailability
}

/** Croatian first (the hub prefers the free Gemini voices for it), then English, then the others by code. */
export function orderLanguages(langs: readonly string[]): string[] {
  const rank = (l: string): number => (l === 'hr' ? 0 : l === 'en' ? 1 : 2)
  return [...new Set(langs)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** The local providers that can speak `lang`, in the order they are tried (the forced `comfy` provider tries ComfyUI first). */
export function localChain(lang: string, provider: VoiceProvider, avail: VoiceAvailability): VoiceProviderUsed[] {
  const order: ('vibetts' | 'comfy')[] = provider === 'comfy' ? ['comfy', 'vibetts'] : ['vibetts', 'comfy']
  return order.filter((p) => avail[p].up && avail[p].reads(lang))
}

const whyNoLocal = (lang: string, avail: VoiceAvailability): string => {
  const one = (name: string, a: { up: boolean; reads: (l: string) => boolean; reason?: string }): string => (!a.up ? `${name} is not available${a.reason ? ` (${a.reason})` : ''}` : !a.reads(lang) ? `${name} does not read ${lang}` : '')
  return [one('VibeTTS', avail.vibetts), one('ComfyUI TTS', avail.comfy)].filter(Boolean).join('; ')
}

/** Allocates every language with clips to speak. The result has one entry per language of `need`, in allocation order. */
export function allocateVoice(input: AllocationInput): Record<string, VoiceAllocationEntry> {
  const out: Record<string, VoiceAllocationEntry> = {}
  let left = Math.max(0, input.quota.limit - input.quota.used)
  const useGemini = input.provider === 'auto' || input.provider === 'gemini'
  for (const lang of orderLanguages(Object.keys(input.need))) {
    const need = input.need[lang] ?? 0
    const local = localChain(lang, input.provider, input.avail)
    if (need <= 0) {
      out[lang] = { lang, need: 0, provider: 'none', chain: [], reason: 'nothing to speak: every clip is up to date' }
      continue
    }
    let why = ''
    if (useGemini) {
      if (!input.avail.gemini.up) why = `Gemini is not available${input.avail.gemini.reason ? ` (${input.avail.gemini.reason})` : ''}`
      else if (need > left) why = `${need} clip(s) do not fit in the ${left} Gemini request(s) left today`
      else {
        left -= need
        out[lang] = { lang, need, provider: 'gemini', chain: ['gemini', ...local], reason: `${need} clip(s) fit in the Gemini quota (${left} request(s) left after them)` }
        continue
      }
    }
    if (local.length === 0) {
      out[lang] = { lang, need, provider: 'none', chain: [], reason: `nothing can speak ${lang}: ${whyNoLocal(lang, input.avail) || 'no provider'}; the clips become placeholders` }
      continue
    }
    const forced = input.provider === 'vibetts' || input.provider === 'comfy'
    out[lang] = { lang, need, provider: local[0]!, chain: local, reason: `${forced ? `the course asks for ${input.provider}` : why ? `${why}: local voice` : 'local voice'} (${local[0] === 'vibetts' ? 'VibeTTS' : 'ComfyUI TTS'})` }
  }
  return out
}
