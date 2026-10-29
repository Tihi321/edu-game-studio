import type { FlowVoices } from '../studios/flow'
import type { VoiceEntry, VoiceList } from './catalog'

/**
 * The voices of Google Flow's free narration engines, shaped as `VoiceEntry` so the planner (`pickVoices`, `describeVoices`) is the same
 * as for any other list. Ids: `gemini:<Name>` (Google AI Studio's text-to-speech; the language follows the text, so a Gemini voice reads
 * every language of the project) and `windows:<Voice Name>` (a voice installed on this PC, which reads the language of its culture only).
 * The paid engine `flow` is never offered.
 */

export type FlowVoiceRef = { engine: 'gemini' | 'windows'; voice: string }

/** `gemini:Charon` -> `{engine: 'gemini', voice: 'Charon'}`; null for anything else (including the paid engine). */
export function parseFlowVoice(id: string): FlowVoiceRef | null {
  const m = /^(gemini|windows):(.+)$/.exec(id)
  return m ? { engine: m[1] as 'gemini' | 'windows', voice: m[2]! } : null
}

const cultureLang = (culture: string): string => culture.split('-')[0]!.toLowerCase()

/**
 * The voices a plan may use for these project languages: the Gemini voices when the key is ready (they read every language), else the
 * Windows voices of the language's culture. `all` lists both, for checking a voice somebody set by hand.
 */
export function flowVoiceList(v: FlowVoices, langs: readonly string[], o: { all?: boolean } = {}): VoiceEntry[] {
  const gemini: VoiceEntry[] = v.gemini.map((g) => ({
    id: `gemini:${g.name}`,
    label: `${g.name} (${g.description || 'Gemini'}, ${v.geminiModel || 'Gemini TTS'})`,
    engine: 'gemini',
    languages: [...langs],
    ...(g.gender ? { gender: g.gender } : {})
  }))
  const windows: VoiceEntry[] = v.windows.map((w) => ({
    id: `windows:${w.name}`,
    label: `${w.name} (${w.culture}, Windows)`,
    engine: 'windows',
    languages: [cultureLang(w.culture)],
    ...(w.gender ? { gender: w.gender } : {})
  }))
  return o.all || !v.geminiReady ? [...(v.geminiReady || o.all ? gemini : []), ...windows] : gemini
}

/** For `planListVoices`: the Flow voices as the voice list a planner takes. */
export const flowAsVoiceList = (v: FlowVoices, langs: readonly string[]): VoiceList => ({ voices: flowVoiceList(v, langs) })

/** Why `id` cannot speak `lang` (null when it can). A Gemini voice needs the key; a Windows voice reads only its culture's language. */
export function flowVoiceProblem(v: FlowVoices, id: string, lang: string): string | null {
  const ref = parseFlowVoice(id)
  if (!ref) return `"${id}" is not a Flow voice: use gemini:<Name> (for example gemini:Charon) or windows:<Voice Name> (flow_voices lists them)`
  if (ref.engine === 'gemini') {
    if (!v.gemini.some((g) => g.name === ref.voice)) return `Gemini has no voice "${ref.voice}" (flow_voices lists ${v.gemini.map((g) => g.name).join(', ')})`
    if (!v.geminiReady) return 'no Google AI Studio key is set up in flow-music-mcp (flow_set_key, ~/.flow-music-mcp/gemini-key or GEMINI_API_KEY): the Gemini voices cannot speak'
    return null
  }
  const w = v.windows.find((x) => x.name === ref.voice)
  if (!w) return `this PC has no Windows voice "${ref.voice}" (installed: ${v.windows.map((x) => x.name).join(', ') || 'none'})`
  return cultureLang(w.culture) === lang ? null : `the Windows voice "${w.name}" reads ${w.culture}, not ${lang}`
}
