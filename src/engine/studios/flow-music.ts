import { promises as fs } from 'node:fs'
import path from 'node:path'
import { FLOW_MUSIC_ENGINE } from '../../shared/media'
import type { AssetEntry, AssetVersion } from '../../shared/media'
import { FlowError } from './flow'
import type { FlowClient } from './flow'
import type { ChiptuneTrack } from './music'

/** Music from Flow Music through flow-music-mcp. Every song spends Flow Music credits, so the number of songs per project is capped. */

/** A loop whose seam scores below this is not used: the whole song plays and repeats from its start. */
export const MIN_LOOP_SCORE = 0.5

/** How many Flow Music songs a project has made: the versions with the engine `flow-music`, over all its assets. */
export const countFlowSongs = (assets: readonly Pick<AssetEntry, 'versions'>[]): number => assets.reduce((n, a) => n + a.versions.filter((v) => v.engine === FLOW_MUSIC_ENGINE).length, 0)

export interface FlowTrack extends ChiptuneTrack {
  remote: NonNullable<AssetVersion['remote']>
  creditsSpent?: number
}

/**
 * Makes one track: refuses before any call when the project is at its song cap, asks Flow Music for an instrumental (`music_generate`,
 * loop-friendly wording, mp3), then `music_loop` finds a seamless loop and writes it as `v<n>.mp3` (it starts at the loop point and its end is
 * crossfaded into its start, so the player repeats it from 0). The whole song stays next to it as `v<n>.src.mp3`. When no usable loop is found
 * the whole song is `v<n>.mp3` without loop points and a warning says so.
 */
export async function makeFlowTrack(
  flow: FlowClient,
  o: { dir: string; n: number; prompt: string; title: string; songsMade: number; maxSongs: number; timeoutMs: number; signal?: AbortSignal }
): Promise<FlowTrack> {
  if (o.songsMade >= o.maxSongs) throw new FlowError(`Flow Music cap reached (${o.songsMade} song(s)); raise flowMusicMaxSongs in config/studios.md. Each song spends Flow Music credits.`, 'credits')
  const dir = path.resolve(o.dir)
  await fs.mkdir(dir, { recursive: true })
  const warnings: string[] = []
  const song = await flow.song({ sound: o.prompt, title: o.title, out: dir, name: `v${o.n}.src`, format: 'mp3', loopFriendly: true, timeoutMs: o.timeoutMs, signal: o.signal })
  if (song.creditsSpent !== undefined) warnings.push(`Flow Music: this song spent ${song.creditsSpent} credit(s)`)
  const whole = path.join(dir, `v${o.n}.src.mp3`)
  const made = path.resolve(song.file)
  if (made !== whole) await fs.copyFile(made, whole)
  const target = path.join(dir, `v${o.n}.mp3`)
  const remote = { provider: 'flow-music' as const, id: song.id }
  const whole1 = async (reason: string): Promise<FlowTrack> => {
    await fs.copyFile(whole, target)
    warnings.push(`${reason}: the whole song plays and repeats from its start (intro and fade-out included)`)
    return { file: path.basename(target), loopStartSec: null, loopEndSec: null, durationSec: 0, seed: 0, warnings, remote, ...(song.creditsSpent !== undefined ? { creditsSpent: song.creditsSpent } : {}) }
  }
  let loop
  try {
    loop = await flow.loop({ input: whole, out: dir, name: `v${o.n}`, signal: o.signal })
  } catch (e) {
    if (o.signal?.aborted) throw e
    return whole1(`no loop was made (${(e as Error).message.slice(0, 160)})`)
  }
  if (loop.score < MIN_LOOP_SCORE) return whole1(`no seamless loop was found (seam score ${loop.score.toFixed(2)})`)
  const file = path.resolve(loop.file)
  if (file !== target) await fs.copyFile(file, target)
  if (!loop.seamClean) warnings.push('the loop seam may click (music_loop reports it not clean)')
  return { file: path.basename(target), loopStartSec: 0, loopEndSec: loop.loopSeconds, durationSec: loop.loopSeconds, seed: 0, warnings, remote, ...(song.creditsSpent !== undefined ? { creditsSpent: song.creditsSpent } : {}) }
}
