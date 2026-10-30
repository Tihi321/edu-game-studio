import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { VOICE_KIND } from '../../shared/media'
import type { AssetEntry, AssetManifest, CourseMedia } from '../../shared/media'
import type { VoiceAllocationEntry, VoiceClipPlan, VoiceLangPlan, VoicePlanFile, VoiceProviderUsed } from '../../shared/voice'
import { addVersion, assetDir, getEntry, nextVersionN, replaceEntry, resolveFile } from '../assets/manifest'
import { dropPlaceholder, writePlaceholder } from '../assets/placeholder'
import type { ComfyClient } from '../comfy/client'
import type { FlowClient } from '../studios/flow'
import type { VibeTtsClient, VibeVoices } from '../studios/vibetts'
import { allocateVoice } from './allocate'
import type { VoiceAvailability } from './allocate'
import type { VoiceConfig } from './config'
import type { GeminiQuota } from './quota'
import { DEFAULT_GEMINI_VOICE, comfySpeaker, geminiSpeaker, resolveTts, vibettsSpeaker } from './speak'
import type { ClipJob, ResolvedTts, SpeakIO, Speaker, Spoken } from './speak'

/**
 * Speaks the clips of a voice plan (EGS-17): the hash index (a clip whose hash did not change is not spoken again, whatever provider made it; a changed
 * text makes a new version), the hub's allocation rule (`allocate.ts`), the providers (`speak.ts`) in the order the allocation gave, placeholders for what
 * nothing could speak. The manifest (`course/assets.json`) is the index: each clip is an asset `voice-<lang>-<key>` whose `voice` block holds the hash.
 * Everything here is resumable: the manifest is saved after every clip.
 */

export interface VoiceRunInput {
  slug: string
  /** `courses/<slug>/course`: the manifest and `assets/<id>/` live here. */
  courseDir: string
  /** A folder for the files the providers write; created here. */
  tmpDir: string
  workflowDirs: string[]
  media: CourseMedia
  config: VoiceConfig
  plan: VoicePlanFile
  /** The text of a clip now (the catalog may have changed since the plan). */
  textOf: (clip: VoiceClipPlan) => string
  loadManifest: () => Promise<AssetManifest>
  mutate: (fn: (m: AssetManifest) => AssetManifest | Promise<AssetManifest>) => Promise<AssetManifest>
  flow: FlowClient
  vibetts: VibeTtsClient
  comfy: ComfyClient
  quota: GeminiQuota
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Pause between two Gemini requests and retries of a rate limit (`config/studios.md`). */
  flowPauseMs: number
  flowRetries: number
  isDown: (message: string) => boolean
  /** Only this language / these clips. */
  lang?: string
  ids?: string[]
  /** Speak the clips again even when their hash did not change (locked and imported clips stay). */
  force?: boolean
  signal?: AbortSignal
  log: (message: string) => void
}

export interface VoiceRunReport {
  allocation: Record<string, VoiceAllocationEntry>
  made: string[]
  /** Clips whose hash did not change: nothing was spoken. */
  kept: string[]
  /** Clips made by hand (`edu_voice_import`): kept; `stale` of them were imported for a text that changed since. */
  keptImported: { id: string; stale: boolean }[]
  failed: { id: string; error: string }[]
  /** Clips that got a silent placeholder (nothing could speak them): the lint warns PLACEHOLDER_ASSET. */
  placeholders: string[]
  warnings: string[]
}

export const clipHash = (parts: { text: string; lang: string; gemini: string; vibetts: string; style: string; speed: number; format: string }): string =>
  createHash('sha1').update([parts.text, parts.lang, parts.gemini, parts.vibetts, parts.style, String(parts.speed), parts.format].join('\u0000')).digest('hex')

/** How a language is spoken: the course's own settings win over the voice-director's plan (the Gemini voice `voice.voices.narrator.<lang>`, the VibeTTS voice `voice.localVoices.<lang>`, the style `voice.styles.<lang>` or `.narrator`). */
export function effectiveVoice(media: Pick<CourseMedia, 'voice'>, plan: Pick<VoicePlanFile, 'voices'>, lang: string): Required<Pick<VoiceLangPlan, 'style'>> & { gemini: string; vibetts: string } {
  const p = plan.voices[lang] ?? {}
  const v = media.voice
  return {
    gemini: v.voices.narrator?.[lang] ?? p.gemini ?? DEFAULT_GEMINI_VOICE,
    vibetts: v.localVoices[lang] ?? p.vibetts ?? '',
    style: (v.styles[lang] ?? v.styles.narrator ?? p.style ?? '').trim()
  }
}

/** The VibeTTS voice for a language: the configured one when it reads the language, else VibeTTS's own for it, else the first voice that reads it. */
export function vibeVoiceFor(v: VibeVoices, lang: string, configured: string): string | undefined {
  const reads = v.voices.filter((x) => x.languages.includes(lang))
  if (reads.length === 0) return undefined
  if (configured && reads.some((x) => x.id === configured)) return configured
  const own = v.languageVoices[lang]
  if (own && reads.some((x) => x.id === own)) return own
  return reads[0]!.id
}

/** What each provider can speak right now (probed once per run). */
async function probe(inp: VoiceRunInput, langs: string[]): Promise<{ avail: VoiceAvailability; vibe: VibeVoices | null; engines: Map<string, ResolvedTts>; notes: string[] }> {
  const notes: string[] = []
  const provider = inp.media.voice.provider
  let gemini: VoiceAvailability['gemini'] = { up: false, reason: 'the course does not use Gemini' }
  if (provider === 'auto' || provider === 'gemini') {
    try {
      const st = await inp.flow.status(inp.signal)
      if (!st.up) gemini = { up: false, reason: st.hint ?? 'flow-music-mcp is not running' }
      else if (st.signedIn === false) gemini = { up: false, reason: st.hint ?? 'Google Flow is not signed in' }
      else {
        const voices = await inp.flow.voices(inp.signal)
        gemini = voices.geminiReady ? { up: true } : { up: false, reason: 'no Google AI Studio key is set up in flow-music-mcp (the Gemini voices cannot speak)' }
      }
    } catch (e) {
      gemini = { up: false, reason: (e as Error).message.split('\n')[0]!.slice(0, 160) }
    }
    if (!gemini.up) notes.push(`Gemini: ${gemini.reason}`)
  }
  let vibe: VibeVoices | null = null
  let vibeWhy = ''
  try {
    vibe = await inp.vibetts.listVoices(inp.signal)
  } catch (e) {
    vibeWhy = (e as Error).message.split('\n')[0]!.slice(0, 160)
    notes.push(`VibeTTS: ${vibeWhy}`)
  }
  const engines = new Map<string, ResolvedTts>()
  const comfyWhy: string[] = []
  for (const lang of langs) {
    const r = await resolveTts(inp.workflowDirs, inp.media, lang)
    if ('engine' in r) engines.set(lang, r.engine)
    else comfyWhy.push(r.reason)
  }
  const avail: VoiceAvailability = {
    gemini,
    vibetts: { up: !!vibe, reads: (l) => !!vibe && vibe.voices.some((v) => v.languages.includes(l)), ...(vibe ? {} : { reason: vibeWhy }) },
    comfy: { up: true, reads: (l) => engines.has(l), ...(comfyWhy.length ? { reason: comfyWhy[0] } : {}) }
  }
  return { avail, vibe, engines, notes }
}

/** The clip's file name in its asset folder: `v<n>.<ext>`. */
const versionFile = (n: number, ext: string): string => `v${n}.${ext}`

export async function runVoice(inp: VoiceRunInput): Promise<VoiceRunReport> {
  const report: VoiceRunReport = { allocation: {}, made: [], kept: [], keptImported: [], failed: [], placeholders: [], warnings: [] }
  const manifest = await inp.loadManifest()
  const { format, speed, chunkChars } = inp.config
  const jobs: ClipJob[] = []
  for (const clip of inp.plan.clips) {
    if (inp.lang && clip.lang !== inp.lang) continue
    if (inp.ids && !inp.ids.includes(clip.id)) continue
    const text = inp.textOf(clip).trim()
    if (!text) {
      report.warnings.push(`${clip.id}: the text of "${clip.key}" is empty or gone: nothing to speak`)
      continue
    }
    const eff = effectiveVoice(inp.media, inp.plan, clip.lang)
    const hash = clipHash({ text, lang: clip.lang, gemini: eff.gemini, vibetts: eff.vibetts, style: eff.style, speed, format })
    const entry = getEntry(manifest, clip.id)
    const file = entry ? resolveFile(inp.courseDir, entry) : null
    if (entry?.voice?.imported && file) {
      report.keptImported.push({ id: clip.id, stale: entry.voice.text !== text })
      continue
    }
    if (entry?.locked && file) {
      report.kept.push(clip.id)
      continue
    }
    if (!inp.force && entry?.voice?.hash === hash && file) {
      report.kept.push(clip.id)
      continue
    }
    jobs.push({ id: clip.id, lang: clip.lang, key: clip.key, role: clip.role, text, alt: clip.alt, style: eff.style, hash, ...(clip.items ? { items: clip.items } : {}) })
  }
  const need: Record<string, number> = {}
  for (const j of jobs) need[j.lang] = (need[j.lang] ?? 0) + 1
  if (jobs.length === 0) return report

  await fs.mkdir(inp.tmpDir, { recursive: true })
  const { avail, vibe, engines, notes } = await probe(inp, Object.keys(need))
  const q = await inp.quota.read()
  report.allocation = allocateVoice({ need, provider: inp.media.voice.provider, quota: { limit: q.limit, used: q.used }, avail })
  for (const a of Object.values(report.allocation)) inp.log(`voice ${a.lang}: ${a.need} clip(s) -> ${a.provider} (${a.reason})`)

  const speakers: Record<VoiceProviderUsed, Speaker> = {
    gemini: geminiSpeaker({ flow: inp.flow, quota: inp.quota, voiceOf: (l) => effectiveVoice(inp.media, inp.plan, l).gemini, pauseMs: inp.flowPauseMs, retries: inp.flowRetries, sleep: inp.sleep }),
    vibetts: vibettsSpeaker({ client: inp.vibetts, voiceOf: (l) => (vibe ? vibeVoiceFor(vibe, l, effectiveVoice(inp.media, inp.plan, l).vibetts) : undefined) }),
    comfy: comfySpeaker({ comfy: inp.comfy, engineOf: (l) => engines.get(l), slug: inp.slug, isDown: inp.isDown })
  }

  const spoken = new Set<string>()
  const lastError = new Map<string, string>()
  const madeBy = new Map<string, Partial<Record<VoiceProviderUsed, number>>>()
  const io = (lang: string): SpeakIO => ({
    tmp: inp.tmpDir,
    format,
    speed,
    chunkChars,
    signal: inp.signal,
    log: inp.log,
    onSpoken: async (job: ClipJob, s: Spoken) => {
      await storeClip(inp, job, s)
      spoken.add(job.id)
      report.made.push(job.id)
      const m = madeBy.get(lang) ?? {}
      m[s.provider] = (m[s.provider] ?? 0) + 1
      madeBy.set(lang, m)
      inp.log(`voice ${lang}: ${report.made.length}/${jobs.length} clips (${s.provider})`)
    }
  })

  for (const alloc of Object.values(report.allocation)) {
    let pending = jobs.filter((j) => j.lang === alloc.lang)
    for (const p of alloc.chain) {
      if (pending.length === 0) break
      inp.signal?.throwIfAborted()
      const out = await speakers[p].speak(pending, io(alloc.lang))
      for (const f of out.failed) lastError.set(f.job.id, `${p}: ${f.error}`)
      pending = pending.filter((j) => !spoken.has(j.id))
      if (out.stop && pending.length > 0) {
        const next = alloc.chain[alloc.chain.indexOf(p) + 1]
        const w = `${p} stopped for ${alloc.lang} (${out.stop.message})${next ? `: the ${pending.length} clip(s) left go to ${next}` : `: ${pending.length} clip(s) left`}`
        report.warnings.push(w)
        inp.log(`voice ${alloc.lang}: ${w}`)
      }
    }
    alloc.made = madeBy.get(alloc.lang) ?? {}
    // what nothing could speak: a silent placeholder (the lint warns) and a note, never a failed run
    const why = alloc.chain.length === 0 ? alloc.reason : notes.join('; ')
    for (const j of pending) {
      const reason = lastError.get(j.id) ?? (why || 'no provider could speak it')
      report.failed.push({ id: j.id, error: reason })
      await inp.mutate(async (m) => {
        const e = getEntry(m, j.id) ?? baseEntry(j)
        if (resolveFile(inp.courseDir, e)) return replaceEntry(m, e) // an update that failed: the version it has stays
        return replaceEntry(m, await writePlaceholder(inp.courseDir, e, reason))
      })
      report.placeholders.push(j.id)
    }
    alloc.placeholders = pending.length
  }
  await fs.rm(inp.tmpDir, { recursive: true, force: true }).catch(() => undefined)
  return report
}

/** A manifest entry for a clip that has none yet. */
export function baseEntry(j: Pick<ClipJob, 'id' | 'lang' | 'key' | 'role' | 'text' | 'alt'>): AssetEntry {
  return {
    id: j.id,
    kind: VOICE_KIND,
    prompt: j.text,
    engine: '',
    seed: null,
    size: null,
    versions: [],
    selected: null,
    source: 'generated',
    locked: false,
    alt: j.alt,
    voice: { lang: j.lang, key: j.key, role: j.role, text: j.text, hash: '' }
  }
}

/** Writes the clip as a new version of its asset (the file, the manifest, the hash). */
async function storeClip(inp: VoiceRunInput, job: ClipJob, s: Spoken): Promise<void> {
  await inp.mutate(async (m) => {
    const e0 = getEntry(m, job.id) ?? baseEntry(job)
    const n = nextVersionN(e0)
    const file = versionFile(n, s.ext)
    const dir = assetDir(inp.courseDir, job.id)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, file), s.bytes)
    const engine = `${s.provider}${s.voice ? `:${s.voice}` : ''}`
    const version = { n, file, createdAt: new Date().toISOString(), seed: s.seed ?? null, engine, prompt: job.text }
    const e1: AssetEntry = {
      ...addVersion(e0, version),
      prompt: job.text,
      engine,
      alt: e0.alt ?? job.alt,
      voice: { lang: job.lang, key: job.key, role: job.role, text: job.text, hash: job.hash, provider: s.provider }
    }
    return replaceEntry(m, await dropPlaceholder(inp.courseDir, e1))
  })
}
