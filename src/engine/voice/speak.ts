import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { VoiceClipRole, VoiceProviderUsed } from '../../shared/voice'
import { resolveVoiceEngine } from '../../shared/media'
import type { CourseSettings } from '../../shared/media'
import type { ComfyClient } from '../comfy/client'
import { loadCustomWorkflow } from '../comfy/custom-workflow'
import type { CustomWorkflow } from '../comfy/custom-workflow'
import { ENGINES, randomSeed } from '../comfy/graphs'
import type { EngineDef } from '../comfy/graphs'
import { VOICE_ENGINE_IDS, engineLanguageValue, engineReadsLanguage } from '../comfy/tts-engines'
import { FlowError } from '../studios/flow'
import type { FlowClient } from '../studios/flow'
import { StudioError } from '../studios/chiptune'
import type { VibeTtsClient } from '../studios/vibetts'
import { parseFlowVoice } from './flow-catalog'
import type { GeminiQuota } from './quota'

/**
 * The three providers that speak a clip (EGS-17), each as a function over a list of clips: Gemini (Google's free voices through flow-music-mcp's
 * `flow_narrate`, one request per clip, counted against the day's quota, with the retry and the quota handling ported from VN Studio), VibeTTS
 * (`synthesize_batch`: one call for many clips) and ComfyUI TTS (the TTS Audio Suite, one request per clip). They never touch the manifest: each clip
 * that is made goes to `io.onSpoken` at once (the runner saves it), and what could not be made is returned. A provider that is down, or whose
 * quota is used up, STOPS (`stop`): the runner hands the clips that are left to the next provider of the language's chain.
 */

/** A clip to speak, as the runner prepared it. */
export interface ClipJob {
  id: string
  lang: string
  key: string
  role: VoiceClipRole
  text: string
  alt: string
  /** The delivery style (empty: none). */
  style: string
  /** The hash of what makes the sound (text, language, configured voices, style, speed, format). */
  hash: string
  items?: string[]
}

export interface Spoken {
  bytes: Buffer
  /** Lower-case, without the dot: sniffed from the bytes (a provider may write a wav when an mp3 was asked). */
  ext: string
  provider: VoiceProviderUsed
  /** The voice or the engine that spoke it. */
  voice?: string
  seed?: number
}

export interface SpeakIO {
  /** A folder the providers that write files (VibeTTS, Flow) put them in; it exists. */
  tmp: string
  format: 'mp3' | 'wav'
  speed: number
  chunkChars: number
  signal?: AbortSignal
  log: (message: string) => void
  /** A clip was made: the runner stores it. Awaited, so the manifest follows every clip. */
  onSpoken: (job: ClipJob, spoken: Spoken) => Promise<void>
}

export interface SpeakOutcome {
  /** Clips that failed on their own (the others of the batch went on). */
  failed: { job: ClipJob; error: string }[]
  /** The provider cannot go on: the clips not made are left for the next provider. */
  stop?: { kind: 'down' | 'quota' | 'unreadable'; message: string }
}

export interface Speaker {
  provider: VoiceProviderUsed
  speak(jobs: ClipJob[], io: SpeakIO): Promise<SpeakOutcome>
}

/** The container of an audio file, from its first bytes. `fallback` when it is none of the known ones. */
export function sniffAudioExt(bytes: Buffer, fallback = 'mp3'): string {
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WAVE') return 'wav'
  if (bytes.length >= 4 && bytes.toString('latin1', 0, 4) === 'OggS') return 'ogg'
  if (bytes.length >= 4 && bytes.toString('latin1', 0, 4) === 'fLaC') return 'flac'
  if (bytes.length >= 3 && bytes.toString('latin1', 0, 3) === 'ID3') return 'mp3'
  if (bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1]! & 0xe0) === 0xe0)) return 'mp3'
  if (bytes.length >= 8 && bytes.toString('latin1', 4, 8) === 'ftyp') return 'm4a'
  return fallback
}

const readAndRemove = async (file: string): Promise<Buffer> => {
  const bytes = await fs.readFile(file)
  await fs.rm(file, { force: true })
  return bytes
}

// ---- Gemini ----

/** The wait Google asks for in a 429 text: `Please retry in 21h21m47.5s`, `retry in 45s`, or a `retryDelay` of `"76907s"`. Undefined when the text has none. */
export function parseRetryDelayMs(message: string): number | undefined {
  const unit = { h: 3_600_000, m: 60_000, s: 1000 } as const
  const sum = (text: string): number => [...text.matchAll(/(\d+(?:\.\d+)?)\s*([hms])/gi)].reduce((t, m) => t + Number(m[1]) * unit[m[2]!.toLowerCase() as keyof typeof unit], 0)
  const retryIn = /retry in\s+((?:\d+(?:\.\d+)?\s*[hms]\s*)+)/i.exec(message)
  if (retryIn) return Math.round(sum(retryIn[1]!))
  const delay = /retryDelay\W+(\d+(?:\.\d+)?)\s*s/i.exec(message)
  return delay ? Math.round(Number(delay[1]) * 1000) : undefined
}

/** A retry time longer than this (and than the whole retry schedule) is a daily quota, not a burst: waiting it out in the job makes no sense. */
export const QUOTA_MIN_MS = 300_000
/** The text a `flow_narrate` call takes (gemini and windows). */
export const FLOW_TEXT_MAX = 4000
/** The Gemini voice a language gets when neither the course nor the voice-director named one. */
export const DEFAULT_GEMINI_VOICE = 'gemini:Kore'

export interface GeminiSpeakerOptions {
  flow: FlowClient
  quota: GeminiQuota
  /** The Gemini voice id of a language (`gemini:Kore`). */
  voiceOf: (lang: string) => string
  /** Pause between two requests (ms), so the free tier is not hit at once. */
  pauseMs: number
  /** How often a clip is retried on a rate limit (each retry counts against the quota). */
  retries: number
  backoffMs?: number[]
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
}

export function geminiSpeaker(o: GeminiSpeakerOptions): Speaker {
  const backoff = o.backoffMs ?? [10_000, 30_000, 90_000]
  return {
    provider: 'gemini',
    async speak(jobs, io) {
      const failed: SpeakOutcome['failed'] = []
      const schedule = Array.from({ length: o.retries }, (_, k) => backoff[Math.min(k, backoff.length - 1)] ?? 90_000).reduce((a, b) => a + b, 0)
      let first = true
      for (const job of jobs) {
        io.signal?.throwIfAborted()
        if (!first && o.pauseMs > 0) await o.sleep(o.pauseMs, io.signal)
        first = false
        const ref = parseFlowVoice(o.voiceOf(job.lang))
        if (!ref) {
          failed.push({ job, error: `"${o.voiceOf(job.lang)}" is not a Gemini voice (gemini:<Name>, for example gemini:Kore)` })
          continue
        }
        if (job.text.length > FLOW_TEXT_MAX) {
          failed.push({ job, error: `the text is ${job.text.length} characters, over the ${FLOW_TEXT_MAX} that the narration takes` })
          continue
        }
        for (let attempt = 0; ; attempt++) {
          const left = (await o.quota.read()).remaining
          if (left <= 0) return { failed, stop: { kind: 'quota', message: "today's Gemini TTS quota is used up" } }
          await o.quota.add() // every request that reaches Gemini counts, a retry too
          try {
            // the engine is always `gemini`: the paid Flow engine is never sent
            const r = await o.flow.narrate({ text: job.text, engine: 'gemini', voice: ref.voice, ...(job.style ? { style: job.style } : {}), out: io.tmp, name: job.id, format: io.format, signal: io.signal })
            const bytes = await readAndRemove(r.file)
            await io.onSpoken(job, { bytes, ext: sniffAudioExt(bytes, path.extname(r.file).slice(1) || io.format), provider: 'gemini', voice: `gemini:${ref.voice}` })
            break
          } catch (e) {
            if (io.signal?.aborted) throw e
            if (e instanceof FlowError && (e.kind === 'unreachable' || e.kind === 'signedOut')) return { failed, stop: { kind: 'down', message: e.message } }
            if (e instanceof FlowError && e.kind === 'rateLimit') {
              const retryMs = parseRetryDelayMs(e.message)
              if (retryMs !== undefined && retryMs > Math.max(schedule, QUOTA_MIN_MS)) {
                await o.quota.exhaust()
                return { failed, stop: { kind: 'quota', message: `Gemini's daily voice quota is used up (Google asks to retry in ${Math.round(retryMs / 60_000)} min)` } }
              }
              if (attempt < o.retries) {
                const wait = backoff[Math.min(attempt, backoff.length - 1)] ?? 90_000
                io.log(`voice ${job.lang}: ${job.id}: rate limited, waiting ${Math.round(wait / 1000)} s (retry ${attempt + 1} of ${o.retries})`)
                await o.sleep(wait, io.signal)
                continue
              }
            }
            failed.push({ job, error: (e as Error).message })
            break
          }
        }
      }
      return { failed }
    }
  }
}

// ---- VibeTTS ----

export interface VibeSpeakerOptions {
  client: VibeTtsClient
  /** The voice for a language: the configured one when it reads the language, else VibeTTS's own for it. Undefined: let VibeTTS choose. */
  voiceOf: (lang: string) => string | undefined
  /** Clips per `synthesize_batch` call (the runner saves after each call). */
  batch?: number
}

export function vibettsSpeaker(o: VibeSpeakerOptions): Speaker {
  const size = o.batch ?? 12
  return {
    provider: 'vibetts',
    async speak(jobs, io) {
      const failed: SpeakOutcome['failed'] = []
      for (let at = 0; at < jobs.length; at += size) {
        io.signal?.throwIfAborted()
        const part = jobs.slice(at, at + size)
        let results
        try {
          results = await o.client.synthesizeBatch(
            part.map((j) => ({ text: j.text, output: path.join(io.tmp, `${j.id}.${io.format}`), lang: j.lang, ...(o.voiceOf(j.lang) ? { voice: o.voiceOf(j.lang) } : {}), speed: io.speed })),
            { overwrite: true, signal: io.signal }
          )
        } catch (e) {
          if (io.signal?.aborted) throw e
          if (e instanceof StudioError && (e.kind === 'unreachable' || e.kind === 'timeout' || e.kind === 'protocol' || e.kind === 'http')) return { failed, stop: { kind: 'down', message: e.message } }
          for (const j of part) failed.push({ job: j, error: (e as Error).message })
          continue
        }
        for (const [i, j] of part.entries()) {
          const r = results[i]!
          if (!r.ok) {
            failed.push({ job: j, error: r.error ?? 'VibeTTS gave no reason' })
            continue
          }
          try {
            const bytes = await readAndRemove(r.output)
            await io.onSpoken(j, { bytes, ext: sniffAudioExt(bytes, path.extname(r.output).slice(1) || io.format), provider: 'vibetts', ...(o.voiceOf(j.lang) ? { voice: o.voiceOf(j.lang) } : {}) })
          } catch (e) {
            failed.push({ job: j, error: `the clip file of VibeTTS could not be read: ${(e as Error).message}` })
          }
        }
      }
      return { failed }
    }
  }
}

// ---- ComfyUI TTS Audio Suite ----

/** A ComfyUI voice engine resolved for one language. */
export interface ResolvedTts {
  /** The id the report names. */
  id: string
  /** What `comfy.generate` takes: the built-in id, or `custom:<name>`. */
  target: string
  def?: EngineDef
  workflow?: CustomWorkflow
}

/**
 * The engine that speaks `lang` for a course (`voice.engines[lang]`, else `voice.engine`): the built-in spec or a custom TTS workflow, or the reason it
 * cannot. A course has no reference clips, so an engine that REQUIRES one (cloning only) cannot speak a course.
 */
export async function resolveTts(workflowDirs: string[], settings: Pick<CourseSettings, 'voice'>, lang: string): Promise<{ engine: ResolvedTts } | { reason: string }> {
  const id = resolveVoiceEngine(settings, lang)
  if (id.startsWith('custom:')) {
    try {
      const workflow = await loadCustomWorkflow(workflowDirs, id.slice('custom:'.length))
      const supported = Object.keys(workflow.mapping.languages ?? {})
      const table = !!workflow.mapping.language && supported.length > 0
      if (table && !supported.includes(lang)) return { reason: `the workflow "${id}" does not read ${lang} (it reads: ${supported.join(', ')})` }
      if (workflow.mapping.voiceRef) return { reason: `the workflow "${id}" needs a voice reference clip, which a course has none of` }
      return { engine: { id, target: id, workflow } }
    } catch (e) {
      return { reason: (e as Error).message }
    }
  }
  const def = ENGINES[id]
  if (!def || def.task !== 'tts') return { reason: `"${id}" is not a voice engine (use one of ${VOICE_ENGINE_IDS.join(', ')} or custom:<workflow>)` }
  if (!engineReadsLanguage(def, lang)) return { reason: `the engine "${id}" does not read ${lang} (it reads: ${def.languages === '*' || !def.languages ? 'any language' : def.languages.join(', ')})` }
  if (def.clone === 'required') return { reason: `the engine "${id}" needs a voice reference clip, which a course has none of` }
  return { engine: { id, target: id, def } }
}

export interface ComfySpeakerOptions {
  comfy: ComfyClient
  engineOf: (lang: string) => ResolvedTts | undefined
  slug: string
  /** Whether a failure message says ComfyUI is not there (the provider stops instead of failing every clip). */
  isDown: (message: string) => boolean
}

export function comfySpeaker(o: ComfySpeakerOptions): Speaker {
  return {
    provider: 'comfy',
    async speak(jobs, io) {
      const failed: SpeakOutcome['failed'] = []
      for (const job of jobs) {
        io.signal?.throwIfAborted()
        const engine = o.engineOf(job.lang)
        if (!engine) {
          failed.push({ job, error: `no ComfyUI voice engine reads ${job.lang}` })
          continue
        }
        try {
          const r = await o.comfy.generate({
            engine: engine.target,
            text: job.text,
            language: job.lang,
            ...(engine.def?.language ? { languageName: engineLanguageValue(engine.def, job.lang) } : {}),
            ...(job.style ? { instruct: job.style } : {}),
            seed: randomSeed(),
            format: io.format,
            chunkChars: io.chunkChars,
            speed: io.speed,
            filenamePrefix: `edu_voice_${o.slug}`,
            signal: io.signal
          })
          await io.onSpoken(job, { bytes: r.bytes, ext: sniffAudioExt(r.bytes, r.ext || io.format), provider: 'comfy', voice: engine.id, seed: r.seed })
        } catch (e) {
          if (io.signal?.aborted) throw e
          const m = (e as Error).message
          if (o.isDown(m)) return { failed, stop: { kind: 'down', message: m } }
          failed.push({ job, error: m })
        }
      }
      return { failed }
    }
  }
}
