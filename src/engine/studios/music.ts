import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { Chip } from '../../shared/media'
import type { ChiptuneClient } from './chiptune'

/** What a track needs of Chiptune Studio: the arguments of `compose_track` that are not the seed. */
export interface ChipTrackPlan {
  mood: string
  chip: Chip
  bpm: number
  /** A key name such as `C`, `F#`, `Eb`. */
  key: string
  bars: number
}

export interface ChiptuneTrack {
  /** The audio file name inside the asset folder (`v2.ogg`). */
  file: string
  /** The native song file name (`v2.song`), when it could be saved. */
  songFile?: string
  loopStartSec: number | null
  loopEndSec: number | null
  durationSec: number
  seed: number
  warnings: string[]
}

/**
 * Makes one track with Chiptune Studio: `compose_track` (a calm loop from the plan), `render_audio` (ogg, ending exactly at the loop end),
 * `save_song` (the native song next to it, so "Open in Chiptune Studio" can edit it later). Files are written by the studio at absolute
 * paths in `dir`. Throws a `StudioError` when the studio is down.
 */
export async function makeChiptuneTrack(
  client: ChiptuneClient,
  o: { dir: string; n: number; plan: ChipTrackPlan; seed?: number; name?: string; signal?: AbortSignal }
): Promise<ChiptuneTrack> {
  const dir = path.resolve(o.dir)
  await fs.mkdir(dir, { recursive: true })
  const warnings: string[] = []
  const composed = await client.composeTrack({ mood: o.plan.mood, chip: o.plan.chip, bpm: o.plan.bpm, key: o.plan.key, bars: o.plan.bars, loop: true, seed: o.seed, name: o.name }, o.signal)
  const wanted = path.join(dir, `v${o.n}.ogg`)
  const rendered = await client.renderAudio({ song: composed.songId, path: wanted, format: 'ogg', loops: 1 }, o.signal)
  return keepRendered(client, { dir, n: o.n, wanted, songId: composed.songId, seed: composed.seed, signal: o.signal }, rendered, warnings)
}

/**
 * Makes one sound of the book with Chiptune Studio: `compose_sfx` with `path` (a one-shot effect or a seamless ambience loop, composed and
 * rendered in one call), then the native song is saved next to it like a track. Never overwrites a file: the version number is new.
 * Throws a `StudioError` when the studio is down.
 */
export async function makeChiptuneSound(
  client: ChiptuneClient,
  o: { dir: string; n: number; kind: 'sfx' | 'ambience'; sound: string; chip?: Chip; seconds?: number; seed?: number; name?: string; signal?: AbortSignal }
): Promise<ChiptuneTrack> {
  const dir = path.resolve(o.dir)
  await fs.mkdir(dir, { recursive: true })
  const warnings: string[] = []
  const wanted = path.join(dir, `v${o.n}.ogg`)
  const seconds = o.kind === 'ambience' && o.seconds !== undefined ? Math.min(120, Math.max(4, Math.round(o.seconds))) : undefined
  const r = await client.composeSfx({ kind: o.kind, sound: o.sound, ...(o.chip ? { chip: o.chip } : {}), ...(seconds ? { seconds } : {}), ...(o.seed !== undefined ? { seed: o.seed } : {}), ...(o.name ? { songName: o.name } : {}), path: wanted, format: 'ogg' }, o.signal)
  // an effect is one shot: no loop points. An ambience loops over the whole file.
  const loop = o.kind === 'ambience' ? { loopStartSec: r.loopStartSec ?? 0, loopEndSec: r.loopEndSec ?? r.durationSec } : { loopStartSec: null, loopEndSec: null }
  if (r.warning) warnings.push(`Chiptune Studio: ${r.warning}`)
  return keepRendered(client, { dir, n: o.n, wanted, songId: r.songId, seed: r.seed, signal: o.signal }, { path: r.path, durationSec: r.durationSec, ...loop }, warnings, true)
}

interface Rendered {
  path?: string
  durationSec: number
  loopStartSec?: number | null
  loopEndSec?: number | null
  warning?: string
}

/** The file the studio wrote: found (or copied into the asset folder), the native song saved next to it, the studio's copy dropped. */
async function keepRendered(
  client: ChiptuneClient,
  o: { dir: string; n: number; wanted: string; songId: string; seed: number; signal?: AbortSignal },
  rendered: Rendered,
  warnings: string[],
  warned = false
): Promise<ChiptuneTrack> {
  const { dir } = o
  if (rendered.warning && !warned) warnings.push(`Chiptune Studio: ${rendered.warning}`)
  const actual = path.resolve(rendered.path || o.wanted)
  if (!existsSync(actual)) throw new Error(`Chiptune Studio says it wrote ${actual}, but the file is not there`)
  if (path.dirname(actual) !== dir) {
    // the studio wrote somewhere else (a relative path resolved by the studio): bring it into the asset folder
    const moved = path.join(dir, `v${o.n}${path.extname(actual)}`)
    await fs.copyFile(actual, moved)
    warnings.push(`Chiptune Studio wrote ${actual}: copied into the project`)
    return finish(moved)
  }
  return finish(actual)

  async function finish(audio: string): Promise<ChiptuneTrack> {
    let songFile: string | undefined
    const songPath = path.join(dir, `v${o.n}.song`)
    try {
      const saved = await client.saveSong({ song: o.songId, path: songPath }, o.signal)
      if (existsSync(path.resolve(saved.path))) songFile = path.basename(path.resolve(saved.path))
    } catch (e) {
      if (o.signal?.aborted) throw e
      warnings.push(`the song file could not be saved (${(e as Error).message}): "Open in Chiptune Studio" will not be available for this version`)
    }
    // the headless session keeps every song it composed: drop this one (best effort, the files stay)
    await client.deleteSong(o.songId, o.signal).catch(() => undefined)
    return {
      file: path.basename(audio),
      ...(songFile ? { songFile } : {}),
      loopStartSec: rendered.loopStartSec ?? null,
      loopEndSec: rendered.loopEndSec ?? null,
      durationSec: rendered.durationSec,
      seed: o.seed,
      warnings
    }
  }
}
