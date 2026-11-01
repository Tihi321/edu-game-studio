import { z } from 'zod'
import { shortenForSpeech, derivedListeningId, voiceClipId, DERIVED_MARK, NARRATION_MAX_CHARS } from '../../shared/voice'
import type { DerivedListening, VoiceClipPlan, VoiceLangPlan, VoicePlanFile } from '../../shared/voice'
import { VOICE_KIND } from '../../shared/media'
import type { AssetManifest, CourseMedia } from '../../shared/media'
import { replaceEntry, getEntry } from '../assets/manifest'
import { baseEntry } from '../voice/run'
import { dropNulls } from './authoring'
import type { Problem } from './authoring'

/**
 * The voice-director's work as code (EGS-17): what the role is shown (`VoiceSource`, read from the pack and the catalogs of a course after the
 * assemble step, so it speaks the final text), the output contract of its answer (`voicePlanSchema` and `checkVoicePlan`, with one repair round in
 * `askRole`), the deterministic fallback used when the model gives no usable answer, and the step that turns the answer into the plan file: the clips
 * (listening items' transcripts, derived listening items, narration), the listening items derived from taught phrases, and how each language is spoken.
 */

// ---- the source ----

/** A text the narrator may read (a unit's summary, an article's body). */
export interface NarrationCandidate {
  /** The catalog key (`unit.u1.summary`, `art.a-u1-1.body`): the clip speaks its text. */
  key: string
  kind: 'unit' | 'article'
  /** The unit or article id. */
  ref: string
  unit?: string
  title: string
  text: string
}

/** A taught phrase an item of the course already has, which a listening item can be made from. */
export interface ListenCandidate {
  /** The source item (a `typed` or `mcq` item). */
  item: string
  unit: string
  /** `type`: hear it and type it (a typed item); `choose`: hear it and pick it (a multiple-choice item). */
  mode: 'type' | 'choose'
  /** What is spoken: the taught phrase in the target language. */
  phrase: string
  /** The pack item it comes from (its keys, objective, facts): not shown to the model. */
  raw: Json
}

/** A `listening` item the course has already. */
export interface ListeningRow {
  item: string
  unit?: string
  /** The transcript key and its text (what the clip speaks). */
  key: string
  lang: string
  text: string
  /** The item has a real recording of its own (a hand-made one): no clip is made for it. */
  ownAudio: boolean
}

export interface VoiceSource {
  title: string
  subject: string
  audience: string
  age?: string
  kids: boolean
  /** The name of the source language (the narration and the alt texts are in it). */
  language: string
  sourceLang: string
  targetLang?: string
  targetLanguage?: string
  units: { id: string; title: string }[]
  narration: NarrationCandidate[]
  /** Items whose taught phrase can become a listening item (a language course only), in course order. */
  candidates: ListenCandidate[]
  listening: ListeningRow[]
  /** The catalogs, for the text of a key. */
  catalogs: Record<string, { strings?: Record<string, string>; accepted?: Record<string, string[]> }>
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The text of a key: the catalog string, else the first accepted answer. Undefined when there is none. */
export function textOfKey(catalogs: VoiceSource['catalogs'], lang: string, key: string): string | undefined {
  const c = catalogs[lang]
  return c?.strings?.[key] ?? c?.accepted?.[key]?.[0]
}

/** The language whose catalog has the key (the target language first: taught answers live there), else undefined. */
export function langOfKey(catalogs: VoiceSource['catalogs'], key: string, order: readonly string[]): string | undefined {
  return order.find((l) => textOfKey(catalogs, l, key) !== undefined)
}

/**
 * Reads a course for the voice-director: the units, the texts a narrator may read, the listening items it has and the taught phrases a listening item
 * can be made from. Pure: it works on the pack and the catalogs as plain objects.
 */
export function buildVoiceSource(pack: Json, catalogs: VoiceSource['catalogs'], o: { title: string; languageName: (code: string) => string; targetLanguageName?: string; kids?: boolean; real?: (assetId: string) => boolean }): VoiceSource {
  const sourceLang = String(pack.sourceLang)
  const targetLang = typeof pack.targetLang === 'string' && pack.targetLang !== sourceLang ? pack.targetLang : undefined
  const order = targetLang ? [targetLang, sourceLang] : [sourceLang]
  const t = (key: unknown, lang = sourceLang): string => (typeof key === 'string' ? (textOfKey(catalogs, lang, key) ?? (targetLang ? textOfKey(catalogs, targetLang, key) : undefined) ?? key) : '')
  const units = ((pack.units as Json[] | undefined) ?? []).map((u) => ({ id: String(u.id), title: t(u.title) }))
  const unitOfObjective = new Map(((pack.objectives as Json[] | undefined) ?? []).map((ob) => [String(ob.id), String(ob.unit)]))
  const items = (pack.items as Json[] | undefined) ?? []
  const articles = ((pack.encyclopedia as Json | undefined)?.articles as Json[] | undefined) ?? []

  const narration: NarrationCandidate[] = []
  for (const u of (pack.units as Json[] | undefined) ?? []) {
    const key = asStr(u.summary)
    const text = key ? textOfKey(catalogs, sourceLang, key) : undefined
    if (key && text) narration.push({ key, kind: 'unit', ref: String(u.id), unit: String(u.id), title: t(u.title), text })
  }
  for (const a of articles) {
    const key = asStr(a.body)
    const text = key ? textOfKey(catalogs, sourceLang, key) : undefined
    if (key && text) narration.push({ key, kind: 'article', ref: String(a.id), ...(typeof a.unit === 'string' ? { unit: a.unit } : {}), title: t(a.title), text })
  }

  const listening: ListeningRow[] = []
  const have = new Set<string>()
  for (const it of items) {
    if (it.kind !== 'listening' || isDerived(it)) continue // a derived item is made again from its source by every plan (its clip is the one of its phrase)
    const key = asStr(it.transcript)
    const lang = langOfKey(catalogs, key, order)
    if (!key || !lang) continue
    const text = textOfKey(catalogs, lang, key)!
    have.add(text.trim().toLowerCase())
    const asset = asStr(it.asset)
    listening.push({ item: String(it.id), ...(unitOfObjective.get(String(it.objective)) ? { unit: unitOfObjective.get(String(it.objective)) } : {}), key, lang, text, ownAudio: !!asset && (o.real?.(asset) ?? false) })
  }

  const candidates: ListenCandidate[] = []
  if (targetLang) {
    for (const it of items) {
      const id = String(it.id)
      if (isDerived(it)) continue
      const unit = unitOfObjective.get(String(it.objective))
      if (!unit) continue
      if (it.kind === 'typed') {
        const phrase = textOfKey(catalogs, targetLang, asStr(it.answer))
        if (phrase && usable(phrase) && !have.has(phrase.trim().toLowerCase())) candidates.push({ item: id, unit, mode: 'type', phrase: phrase.trim(), raw: it })
      } else if (it.kind === 'mcq' && Array.isArray(it.options)) {
        const options = it.options as Json[]
        const texts = options.map((x) => catalogs[targetLang]?.strings?.[asStr(x.text)])
        const right = options.findIndex((x) => x.id === it.answer)
        if (right >= 0 && texts.every((x) => !!x && usable(x)) && !have.has(texts[right]!.trim().toLowerCase())) candidates.push({ item: id, unit, mode: 'choose', phrase: texts[right]!.trim(), raw: it })
      }
    }
  }
  return {
    title: o.title,
    subject: String(pack.subject),
    audience: String(pack.audience),
    kids: o.kids ?? false,
    language: o.languageName(sourceLang),
    sourceLang,
    ...(targetLang ? { targetLang, targetLanguage: o.targetLanguageName ?? o.languageName(targetLang) } : {}),
    units,
    narration,
    candidates,
    listening,
    catalogs
  }
}

/** A phrase worth speaking: a few words, not a gap or a pattern. */
const usable = (s: string): boolean => s.trim().length >= 2 && s.trim().length <= 160 && !s.includes('{{')

const isDerived = (item: unknown): boolean => {
  const mark = (item as { extensions?: Json } | null)?.extensions?.[DERIVED_MARK]
  return isObj(mark) && typeof mark.derivedFrom === 'string'
}

// ---- the output contract ----

const text = (what: string) => z.string({ error: `${what} must be a string` }).trim().min(1, `${what} must not be empty`)
const lenient = <S extends z.ZodType>(s: S) => z.preprocess(dropNulls, s) as unknown as S

export const voicePlanSchema = lenient(
  z.object({
    /** Language code -> how it is spoken: the delivery style, and (optional) the Gemini voice. */
    voices: z
      .record(
        z.string(),
        z.object({
          style: z.string().optional(),
          gemini: z.string().optional()
        })
      )
      .default({}),
    narration: z.array(z.object({ key: text('the key'), alt: z.string().optional() }), { error: 'narration must be a list of {key, alt}' }).default([]),
    derive: z.array(z.object({ item: text('the item id'), prompt: z.string().optional() }), { error: 'derive must be a list of {item, prompt}' }).default([]),
    notes: z.string().default('')
  })
)
export type VoicePlanOutput = z.output<typeof voicePlanSchema>
export type VoiceLine = VoicePlanOutput

/** The limits an answer must keep (from the course settings). */
export interface VoiceLimits {
  narration: boolean
  listening: boolean
  /** The most narration clips. */
  maxNarration: number
  /** The most derived listening items per unit. */
  perUnit: number
}

/** The default most narration clips: a few per course (each is one Gemini request or one local call). */
export const MAX_NARRATION = 12

/** Narration is on unless the course says otherwise; a language course (it has a `targetLang`) defaults to off (EGS-33). */
export const narrationOn = (media: Pick<CourseMedia, 'voice'>, languageCourse: boolean): boolean => media.voice.narration ?? !languageCourse

export function limitsOf(media: Pick<CourseMedia, 'voice'>, languageCourse = false): VoiceLimits {
  return { narration: narrationOn(media, languageCourse), listening: media.voice.listening, maxNarration: MAX_NARRATION, perUnit: media.voice.listeningPerUnit }
}

const problem = (ref: string, issue: string, fix?: string): Problem => ({ ref, issue, ...(fix ? { fix } : {}), severity: 'major' })

/** What an answer must keep to: narration keys and items that are candidates, within the limits, no repeats, voices of languages the course has. */
export function checkVoicePlan(plan: VoicePlanOutput, src: VoiceSource, limits: VoiceLimits): Problem[] {
  const out: Problem[] = []
  const keys = new Set(src.narration.map((n) => n.key))
  const seen = new Set<string>()
  for (const n of plan.narration) {
    const k = n.key.trim()
    if (!keys.has(k)) out.push(problem(k, 'this is not a text that can be narrated', `the keys: ${[...keys].slice(0, 12).join(', ')}${keys.size > 12 ? ' ...' : ''}`))
    if (seen.has(k)) out.push(problem(k, 'this text is narrated twice'))
    seen.add(k)
  }
  if (plan.narration.length > limits.maxNarration) out.push(problem('', `${plan.narration.length} texts to narrate, at most ${limits.maxNarration}`, 'pick the ones that help a learner most'))
  const byItem = new Map(src.candidates.map((c) => [c.item, c]))
  const perUnit = new Map<string, number>()
  const derived = new Set<string>()
  for (const d of plan.derive) {
    const id = d.item.trim()
    const c = byItem.get(id)
    if (!c) out.push(problem(id, 'no listening item can be made from this item', `the items: ${[...byItem.keys()].slice(0, 12).join(', ')}${byItem.size > 12 ? ' ...' : ''}`))
    else perUnit.set(c.unit, (perUnit.get(c.unit) ?? 0) + 1)
    if (derived.has(id)) out.push(problem(id, 'this item is listed twice'))
    derived.add(id)
  }
  for (const [unit, n] of perUnit) if (n > limits.perUnit) out.push(problem(unit, `${n} listening items from this unit, at most ${limits.perUnit}`))
  const langs = new Set([src.sourceLang, ...(src.targetLang ? [src.targetLang] : [])])
  for (const lang of Object.keys(plan.voices)) if (!langs.has(lang)) out.push(problem(lang, 'this language is not spoken in the course', `the languages: ${[...langs].join(', ')}`))
  for (const [lang, v] of Object.entries(plan.voices)) if (v.gemini && !/^gemini:[A-Za-z]+$/.test(v.gemini.trim())) out.push(problem(lang, `"${v.gemini}" is not a Gemini voice id`, 'use gemini:<Name>, for example gemini:Kore'))
  return out
}

// ---- the deterministic fallback ----

/** The delivery style when no model chose: warm and slow for children and for the taught language, clear and even otherwise. */
export function fallbackStyle(src: Pick<VoiceSource, 'kids'>, lang: string, taught: boolean): string {
  if (taught && lang === 'de') return 'clear standard German (Hochdeutsch, no dialect), natural and a little slow, with careful pronunciation, as a language teacher would say it'
  if (taught) return 'clear, natural and a little slow, with careful pronunciation, as a language teacher would say it'
  return src.kids ? 'a warm, friendly teacher speaking clearly and a little slowly' : `a calm, clear narrator at an even pace (${lang})`
}

/** The most unit summaries and article bodies the fallback narrates. */
const FALLBACK_ARTICLES_PER_UNIT = 1

/** The answer made from the course text alone: the unit summaries and one article per unit, the first taught phrases of each unit, a style per language. */
export function fallbackVoiceLines(src: VoiceSource, limits: VoiceLimits): VoiceLine {
  const narration: VoiceLine['narration'] = []
  if (limits.narration) {
    for (const n of src.narration.filter((x) => x.kind === 'unit')) narration.push({ key: n.key })
    for (const u of src.units) for (const a of src.narration.filter((x) => x.kind === 'article' && x.unit === u.id).slice(0, FALLBACK_ARTICLES_PER_UNIT)) narration.push({ key: a.key })
  }
  const derive: VoiceLine['derive'] = []
  if (limits.listening) {
    for (const u of src.units) {
      const mine = src.candidates.filter((c) => c.unit === u.id)
      // alternate the two modes so a unit gets both a typing and a choosing exercise when it has them
      const typed = mine.filter((c) => c.mode === 'type')
      const choose = mine.filter((c) => c.mode === 'choose')
      const order: ListenCandidate[] = []
      for (let i = 0; order.length < mine.length; i++) {
        if (typed[i]) order.push(typed[i]!)
        if (choose[i]) order.push(choose[i]!)
      }
      for (const c of order.slice(0, limits.perUnit)) derive.push({ item: c.item })
    }
  }
  const voices: VoiceLine['voices'] = {}
  voices[src.sourceLang] = { style: fallbackStyle(src, src.sourceLang, false) }
  if (src.targetLang) voices[src.targetLang] = { style: fallbackStyle(src, src.targetLang, true) }
  return { voices, narration: narration.slice(0, limits.maxNarration), derive, notes: '' }
}

// ---- the words the derived items use (the source language of the learner) ----

const LISTEN_WORDS: Record<string, { type: string; choose: string; alt: string; audio: string }> = {
  en: { type: 'Listen to the recording and type what you hear.', choose: 'Listen to the recording and choose what you hear.', alt: 'A recording of a phrase to listen to', audio: 'Audio' },
  hr: { type: 'Poslušajte snimku i upišite što čujete.', choose: 'Poslušajte snimku i odaberite što čujete.', alt: 'Snimka fraze za slušanje', audio: 'Audio' },
  de: { type: 'Höre dir die Aufnahme an und tippe, was du hörst.', choose: 'Höre dir die Aufnahme an und wähle, was du hörst.', alt: 'Eine Aufnahme eines Satzes zum Anhören', audio: 'Audio' },
  es: { type: 'Escucha la grabación y escribe lo que oyes.', choose: 'Escucha la grabación y elige lo que oyes.', alt: 'Una grabación de una frase para escuchar', audio: 'Audio' },
  fr: { type: "Écoute l'enregistrement et écris ce que tu entends.", choose: "Écoute l'enregistrement et choisis ce que tu entends.", alt: 'Un enregistrement d’une phrase à écouter', audio: 'Audio' },
  it: { type: 'Ascolta la registrazione e scrivi ciò che senti.', choose: 'Ascolta la registrazione e scegli ciò che senti.', alt: 'Una registrazione di una frase da ascoltare', audio: 'Audio' },
  pt: { type: 'Ouça a gravação e escreva o que ouve.', choose: 'Ouça a gravação e escolha o que ouve.', alt: 'Uma gravação de uma frase para ouvir', audio: 'Audio' }
}
const wordsFor = (lang: string) => LISTEN_WORDS[lang] ?? LISTEN_WORDS.en!

// ---- from the answer to the plan file ----

export const narrationAlt = (lang: string, title: string): string => `${wordsFor(lang).audio}: ${title}`

/**
 * The plan file of an answer: the clips (the transcript of every listening item the course has, of every derived item, and the narration), the
 * derived listening items, and how each language is spoken. A line the course cannot place is dropped. Ids are stable (`voice-<lang>-<key>`,
 * `<item>-listen`), so a second plan keeps the clips already made.
 */
export function buildVoicePlan(lines: VoiceLine, src: VoiceSource, o: { media: Pick<CourseMedia, 'voice'>; by: 'model' | 'fallback'; note?: string; maxChars?: number; at?: string }): VoicePlanFile {
  const limits = limitsOf(o.media, !!src.targetLang)
  const warnings: string[] = []
  const clips = new Map<string, VoiceClipPlan>()
  const addClip = (c: VoiceClipPlan): void => {
    const old = clips.get(c.id)
    if (old) clips.set(c.id, { ...old, items: [...new Set([...(old.items ?? []), ...(c.items ?? [])])] })
    else clips.set(c.id, c)
  }
  const words = wordsFor(src.sourceLang)

  // the listening items the course has (hand-made ones too): the clip of the transcript
  if (limits.listening) {
    for (const l of src.listening) {
      if (l.ownAudio) continue
      addClip({ id: voiceClipId(l.lang, l.key), lang: l.lang, key: l.key, role: 'listening', text: l.text, alt: words.alt, items: [l.item] })
    }
  }

  // the items derived from taught phrases
  const derived: DerivedListening[] = []
  if (limits.listening && src.targetLang) {
    const byItem = new Map(src.candidates.map((c) => [c.item, c]))
    const perUnit = new Map<string, number>()
    for (const d of lines.derive) {
      const c = byItem.get(d.item.trim())
      if (!c || (perUnit.get(c.unit) ?? 0) >= limits.perUnit) continue
      perUnit.set(c.unit, (perUnit.get(c.unit) ?? 0) + 1)
      const built = deriveListening(c.raw, c, src, d.prompt?.trim() || (c.mode === 'type' ? words.type : words.choose))
      if (!built) continue
      derived.push(built)
      addClip({ id: built.clip, lang: src.targetLang, key: String(built.item.transcript), role: 'listening', text: c.phrase, alt: words.alt, items: [built.id] })
    }
  }

  // the narration, in the source language
  if (limits.narration) {
    const byKey = new Map(src.narration.map((n) => [n.key, n]))
    let n = 0
    for (const line of lines.narration) {
      const c = byKey.get(line.key.trim())
      if (!c || n >= limits.maxNarration) continue
      n++
      addClip({ id: voiceClipId(src.sourceLang, c.key), lang: src.sourceLang, key: c.key, role: 'narration', text: shortenForSpeech(c.text, o.maxChars ?? NARRATION_MAX_CHARS), alt: line.alt?.trim() || narrationAlt(src.sourceLang, c.title) })
    }
  }

  const voices: Record<string, VoiceLangPlan> = {}
  const langs = new Set([...clips.values()].map((c) => c.lang))
  for (const lang of langs) {
    const v = lines.voices[lang]
    const style = v?.style?.trim() || fallbackStyle(src, lang, lang === src.targetLang)
    voices[lang] = { style, ...(v?.gemini?.trim() ? { gemini: v.gemini.trim() } : {}) }
  }
  return {
    version: 1,
    source: o.by,
    ...(o.note ? { note: o.note } : {}),
    at: o.at ?? new Date().toISOString(),
    sourceLang: src.sourceLang,
    ...(src.targetLang ? { targetLang: src.targetLang } : {}),
    voices,
    clips: [...clips.values()],
    derived,
    ...(warnings.length ? { warnings } : {})
  }
}

/**
 * The listening item for a taught phrase: same objective and facts as its source item (which passed the fact-check), with the source's accepted answers
 * (`type`) or options (`choose`), so the learner meets the same phrase by ear. Its text keys are the source's where they exist, new ones where they do not.
 */
export function deriveListening(source: Json, c: ListenCandidate, src: Pick<VoiceSource, 'targetLang' | 'sourceLang'>, promptText: string): DerivedListening | null {
  if (!src.targetLang) return null
  const id = derivedListeningId(String(source.id))
  const promptKey = `item.${id}.prompt`
  const facts = ((source.extensions as Json | undefined)?.facts as unknown[] | undefined)?.filter((f): f is string => typeof f === 'string') ?? []
  const base: Json = {
    id,
    objective: source.objective,
    kind: 'listening',
    prompt: promptKey,
    explanation: source.explanation,
    ...(source.hint ? { hint: source.hint } : {}),
    difficulty: Math.min(5, (typeof source.difficulty === 'number' ? source.difficulty : 3) + 1),
    tags: [...new Set([...(Array.isArray(source.tags) ? (source.tags as string[]) : []), 'listening'])],
    mode: c.mode,
    shuffle: true,
    extensions: { facts, [DERIVED_MARK]: { derivedFrom: String(source.id) } }
  }
  const strings: DerivedListening['strings'] = { [src.sourceLang]: { [promptKey]: promptText } }
  if (c.mode === 'type') {
    const transcript = `item.${id}.transcript`
    strings[src.targetLang] = { [transcript]: c.phrase }
    return { id, source: String(source.id), unit: c.unit, mode: 'type', item: { ...base, transcript, answer: source.answer, ...(typeof source.strictDiacritics === 'boolean' ? { strictDiacritics: source.strictDiacritics } : {}) }, strings, clip: voiceClipId(src.targetLang, transcript) }
  }
  const options = (source.options as Json[] | undefined) ?? []
  const right = options.find((x) => x.id === source.answer)
  if (!right) return null
  const transcript = String(right.text)
  return { id, source: String(source.id), unit: c.unit, mode: 'choose', item: { ...base, transcript, options, answer: source.answer }, strings, clip: voiceClipId(src.targetLang, transcript) }
}

// ---- the manifest ----

/** The manifest after a plan: an entry for every clip (a new one is empty; an existing one keeps its versions, hash, selection and lock). A clip the plan no longer names stays (nothing is deleted). */
export function mergeVoicePlan(manifest: AssetManifest, plan: Pick<VoicePlanFile, 'clips'>): AssetManifest {
  let m = manifest
  for (const c of plan.clips) {
    const old = getEntry(m, c.id)
    if (!old) {
      m = replaceEntry(m, baseEntry(c))
      continue
    }
    m = replaceEntry(m, { ...old, kind: VOICE_KIND, alt: c.alt, voice: { ...(old.voice ?? { hash: '' }), lang: c.lang, key: c.key, role: c.role, text: old.voice?.text ?? c.text, hash: old.voice?.hash ?? '' } })
  }
  return m
}

// ---- what the prompt shows ----

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 3).replace(/\s+\S*$/, '')}...` : s)

/** The variables of `prompts/voice-director/plan.md`. */
export function voicePromptVars(src: VoiceSource, media: Pick<CourseMedia, 'voice'>): Record<string, string | number> {
  const limits = limitsOf(media, !!src.targetLang)
  const byUnit = (id: string): string => src.units.find((u) => u.id === id)?.title ?? id
  return {
    title: src.title,
    subject: src.subject,
    audience: src.audience,
    age: src.age ?? 'not given',
    language: src.language,
    source_lang: src.sourceLang,
    target_lang: src.targetLang ?? 'none (not a language course)',
    target_language: src.targetLanguage ?? 'none',
    units: src.units.map((u) => `- ${u.id}: ${u.title}`).join('\n') || '(none)',
    narration: limits.narration ? src.narration.map((n) => `- ${n.key} (${n.kind} ${n.ref}${n.unit ? `, unit ${n.unit}` : ''}): ${clip(n.text.replace(/\s+/g, ' '), 140)}`).join('\n') || '(none)' : '(narration is switched off: leave `narration` empty)',
    candidates: limits.listening && src.targetLang ? src.candidates.map((c) => `- ${c.item} (${c.mode === 'type' ? 'typed' : 'multiple choice'}, unit ${c.unit} "${byUnit(c.unit)}"): ${c.phrase}`).join('\n') || '(none)' : '(listening is switched off or this is not a language course: leave `derive` empty)',
    listening: src.listening.map((l) => `- ${l.item}: ${clip(l.text, 80)}${l.ownAudio ? ' (has its own recording)' : ''}`).join('\n') || '(none)',
    max_narration: limits.maxNarration,
    per_unit: limits.perUnit
  }
}

