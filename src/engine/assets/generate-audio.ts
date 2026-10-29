import { promises as fs } from 'node:fs'
import path from 'node:path'
import { CHIPTUNE_ENGINE, FLOW_MUSIC_ENGINE, SFX_IMPORT_ONLY, flowMusicAllowed, parseCourseMedia } from '../../shared/media'
import type { AssetEntry, AssetVersion } from '../../shared/media'
import { randomSeed } from '../comfy/graphs'
import type { ComfyProgress, ComfyResult } from '../comfy/client'
import { renameRetry } from '../store/atomic'
import { makeFlowTrack } from '../studios/flow-music'
import { fallbackChipPlan } from '../studios/chip-plan'
import type { ChipTrackPlan } from '../studios/music'
import { pickChipSound } from '../studios/chip-sound'
import { makeChiptuneSound, makeChiptuneTrack } from '../studios/music'
import type { ChiptuneTrack } from '../studios/music'
import { DEFAULT_FLOW_OPTIONS } from './flow-image'
import { addVersion, assetDir, nextVersionN } from './manifest'
import { dropPlaceholder } from './placeholder'
import type { GenerateContext, GenerateOptions, GenerateProgress, GenerateResult } from './generate'

/**
 * Makes the music and the sound effects of a course (ported from the audio branches of VN Studio's `generate.ts`, EGS-16). Called by
 * `generateAsset` for the audio kinds. Music: Chiptune Studio (`compose_track` with the composer's plan, ogg, loop points), a ComfyUI audio
 * engine (ACE-Step), or Flow Music (only when the course opted in to spend credits, and at most `flowMusicMaxSongs` songs). Sound effects:
 * Chiptune Studio's `compose_sfx`, or a ComfyUI audio engine; `sound.sfxEngine: none` keeps them import-only.
 */

/** What the composer's plan says about one audio asset (looked up by asset id). */
export interface AudioGenInfo {
  /** Music for Chiptune Studio: what `compose_track` is given. */
  chip?: ChipTrackPlan
  /** Music for ACE-Step and Flow Music: the prompt; a sound effect for a ComfyUI engine: what it sounds like. */
  prompt?: string
  /** The length of a track, in seconds. */
  seconds?: number
  /** A sound effect: the `compose_sfx` sound (see `chip-sound.ts`). */
  sound?: string
}

async function writeFileAtomic(file: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`
  await fs.writeFile(tmp, bytes)
  await renameRetry(tmp, file)
}

/** The engine an audio asset is made by when its entry names none: by kind, from the course settings. */
export function defaultAudioEngine(kind: string, settings: GenerateContext['settings']): string {
  const media = parseCourseMedia({ music: settings.music, sound: settings.sound, art: settings.art })
  if (kind === 'sfx') return media.sound.sfxEngine?.trim() || CHIPTUNE_ENGINE
  if (kind === 'ambience') return media.sound.ambienceEngine
  return media.music.engine
}

export async function generateAudioAsset(ctx: GenerateContext, entry: AssetEntry, opts: GenerateOptions = {}): Promise<GenerateResult> {
  const progress = (stage: GenerateProgress['stage'], message: string) => ctx.onProgress?.({ id: entry.id, stage, message })
  if (!opts.force && (entry.locked || entry.source === 'custom')) return { ok: true, skipped: true, entry, reason: entry.locked ? 'locked' : 'custom file' }
  const media = parseCourseMedia({ art: ctx.settings.art, music: ctx.settings.music, sound: ctx.settings.sound })
  const info = ctx.audioOf?.(entry.id)
  const edited: AssetEntry = {
    ...entry,
    ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
    ...(opts.engine !== undefined ? { engine: opts.engine } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {})
  }
  if (!edited.engine) edited.engine = defaultAudioEngine(edited.kind, ctx.settings)
  if (edited.engine === SFX_IMPORT_ONLY) {
    return { ok: false, entry, error: `the sound effects of this course are made by hand (media.sound.sfxEngine: ${SFX_IMPORT_ONLY}): set the file with edu_asset_replace` }
  }
  try {
    progress('start', `${entry.kind} with ${edited.engine}`)
    const warnings: string[] = []
    const warn = (m: string): void => {
      warnings.push(m)
      progress('post', `warning: ${m}`)
    }
    const seed = edited.seed ?? randomSeed()
    const dir = assetDir(ctx.projectDir, edited.id)
    const n = nextVersionN(edited)
    const name = `${ctx.slug} ${edited.id}`
    const onProgress = (p: ComfyProgress): void => progress('comfy', `${p.stage}: ${p.message}`)
    const prompt = edited.prompt.trim() || info?.prompt?.trim() || `${edited.kind} for ${edited.id}`
    /** The words a model is given (ACE-Step, Flow Music): a prompt left over from Chiptune Studio (`chiptune: calm, snes ...`) is not words for a model. */
    const words = /^chiptune:/i.test(prompt) ? (info?.prompt?.trim() || prompt) : prompt
    let made: ChiptuneTrack | undefined
    let bytes: Buffer | undefined
    let ext = ''
    let remote: AssetVersion['remote']

    /** A sound effect or an ambience from Chiptune Studio's `compose_sfx`: the sound is the plan's, else picked from the id and the words. */
    const chipSound = async (kind: 'sfx' | 'ambience', seconds: number | undefined): Promise<ChiptuneTrack> => {
      if (!ctx.chiptune) throw new Error('Chiptune Studio is not configured')
      const pick = info?.sound ? { sound: info.sound, guessed: false } : pickChipSound(kind, edited.id.replace(/^[a-z]+-/, ''), `${info?.prompt ?? ''} ${edited.alt ?? ''} ${edited.prompt}`)
      progress('comfy', `compose ${pick.sound} with Chiptune Studio`)
      const track = await makeChiptuneSound(ctx.chiptune, { dir, n, kind, sound: pick.sound, chip: media.music.chip, seconds, seed: edited.seed ?? undefined, name, signal: ctx.signal })
      if (pick.guessed) warn(`no Chiptune Studio sound matches "${edited.id}": used ${pick.sound}. Import a file (edu_asset_replace) for the real sound`)
      for (const w of track.warnings) warn(w)
      return track
    }

    switch (edited.kind) {
      case 'music': {
        if (edited.engine === FLOW_MUSIC_ENGINE) {
          if (!flowMusicAllowed(media)) throw new Error('Flow Music spends credits: it is used only when the course sets media.music.provider: flow AND media.music.flowCredits: true')
          if (!ctx.flow) throw new Error('Google Flow (flow-music-mcp) is not configured')
          const options = ctx.flowOptions ?? DEFAULT_FLOW_OPTIONS
          progress('comfy', 'song from Flow Music (spends credits)')
          const track = await makeFlowTrack(ctx.flow, { dir, n, prompt: words, title: name, songsMade: ctx.flowSongs?.made ?? 0, maxSongs: options.maxSongs, timeoutMs: options.musicTimeoutMs, signal: ctx.signal })
          if (ctx.flowSongs) ctx.flowSongs.made++
          for (const w of track.warnings) warn(w)
          made = track
          remote = track.remote
          break
        }
        if (edited.engine === CHIPTUNE_ENGINE) {
          if (!ctx.chiptune) throw new Error('Chiptune Studio is not configured')
          progress('comfy', 'compose with Chiptune Studio')
          const plan = info?.chip ?? fallbackChipPlan(edited.id, { chip: media.music.chip, seconds: info?.seconds })
          made = await makeChiptuneTrack(ctx.chiptune, { dir, n, plan, seed: edited.seed ?? undefined, name, signal: ctx.signal })
          for (const w of made.warnings) warn(w)
          break
        }
        const r: ComfyResult = await ctx.comfy.generate({ engine: edited.engine, prompt: words, seed, seconds: info?.seconds ?? 90, onProgress, signal: ctx.signal })
        bytes = r.bytes
        ext = r.ext
        break
      }
      case 'ambience': {
        if (edited.engine === CHIPTUNE_ENGINE) {
          made = await chipSound('ambience', 60)
          break
        }
        const r: ComfyResult = await ctx.comfy.generate({ engine: edited.engine, prompt: words, seed, seconds: 60, onProgress, signal: ctx.signal })
        bytes = r.bytes
        ext = r.ext
        break
      }
      case 'sfx': {
        if (edited.engine === CHIPTUNE_ENGINE) {
          made = await chipSound('sfx', undefined)
          break
        }
        const r: ComfyResult = await ctx.comfy.generate({ engine: edited.engine, prompt: words, seed, seconds: 5, onProgress, signal: ctx.signal })
        bytes = r.bytes
        ext = r.ext
        break
      }
      default:
        throw new Error(`cannot generate ${edited.kind} assets`)
    }

    const file = made ? made.file : `v${n}.${ext}`
    if (!made) await writeFileAtomic(path.join(dir, file), bytes!)
    const version: AssetVersion = {
      n,
      file,
      createdAt: (ctx.now?.() ?? new Date()).toISOString(),
      seed: remote ? null : made ? made.seed : seed,
      ...(remote ? { remote } : {}),
      engine: edited.engine,
      prompt,
      ...(made ? { loopStartSec: made.loopStartSec, loopEndSec: made.loopEndSec, ...(made.songFile ? { songFile: made.songFile } : {}) } : {}),
      ...(warnings.length ? { warnings } : {})
    }
    const updated = await dropPlaceholder(ctx.projectDir, addVersion({ ...edited, seed: edited.seed }, version))
    progress('done', file)
    return { ok: true, skipped: false, entry: updated, version, ...(warnings.length ? { warnings } : {}) }
  } catch (e) {
    return { ok: false, entry, error: (e as Error).message }
  }
}
