import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** The length of the crossfade that closes a loop, in seconds (EGS-70). */
export const LOOP_CROSSFADE_SEC = 3

export interface SeamlessLoop {
  /** The file written (same format as the input). */
  file: string
  loopStartSec: 0
  /** The length of the new file: it loops over the whole of it. */
  loopEndSec: number
  durationSec: number
}

const ffmpegBin = (): string => process.env.EDU_FFMPEG || 'ffmpeg'
const ffprobeBin = (): string => process.env.EDU_FFPROBE || (process.env.EDU_FFMPEG ? path.join(path.dirname(process.env.EDU_FFMPEG), 'ffprobe') : 'ffprobe')

/** The encoder args per output extension (the loop file keeps the format ComfyUI gave). */
const CODEC: Record<string, string[]> = {
  '.wav': ['-c:a', 'pcm_s16le'],
  '.flac': ['-c:a', 'flac'],
  '.mp3': ['-c:a', 'libmp3lame', '-q:a', '2'],
  '.ogg': ['-c:a', 'libvorbis', '-q:a', '6']
}

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run(ffprobeBin(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { windowsHide: true })
  const d = Number.parseFloat(stdout.trim())
  if (!Number.isFinite(d) || d <= 0) throw new Error(`cannot read the length of ${file}`)
  return d
}

/**
 * Makes a track loop without a click: an equal-power crossfade of its last `xfade` seconds into its start. The new file is `D - xfade` long;
 * its first `xfade` seconds are the old tail fading out under the old head fading in, so the end of the new file (the old sample just before the
 * tail) runs straight into its start (the old tail's first sample). The player then loops it whole: `loopStartSec` 0, `loopEndSec` its length.
 * Needs ffmpeg and ffprobe on PATH (or `EDU_FFMPEG`). Throws when ffmpeg is missing or the file is too short to crossfade.
 */
export async function makeSeamlessLoop(input: string, output: string, o: { xfadeSec?: number } = {}): Promise<SeamlessLoop> {
  const ext = path.extname(output).toLowerCase()
  const codec = CODEC[ext]
  if (!codec) throw new Error(`cannot make a seamless loop in a ${ext || 'file without extension'} file`)
  const total = await probeDuration(input)
  // a quarter of the track at most, so the middle (the music itself) is never eaten by the fade
  const x = Math.min(o.xfadeSec ?? LOOP_CROSSFADE_SEC, total / 4)
  if (x < 0.02) throw new Error('the track is too short for a crossfade')
  const keep = total - x
  const f = (n: number): string => n.toFixed(6)
  const filter = [
    `[0:a]atrim=0:${f(x)},asetpts=PTS-STARTPTS,afade=t=in:d=${f(x)}:curve=qsin[h]`,
    `[0:a]atrim=${f(keep)}:${f(total)},asetpts=PTS-STARTPTS,afade=t=out:d=${f(x)}:curve=qsin[t]`,
    `[h][t]amix=inputs=2:duration=longest:normalize=0[x]`,
    `[0:a]atrim=${f(x)}:${f(keep)},asetpts=PTS-STARTPTS[m]`,
    `[x][m]concat=n=2:v=0:a=1[out]`
  ].join(';')
  const tmp = path.join(path.dirname(output), `.loop-${process.pid}-${Date.now().toString(36)}${ext}`)
  try {
    await run(ffmpegBin(), ['-v', 'error', '-y', '-i', input, '-filter_complex', filter, '-map', '[out]', ...codec, tmp], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
    const durationSec = await probeDuration(tmp)
    await fs.rename(tmp, output)
    return { file: output, loopStartSec: 0, loopEndSec: Math.round(durationSec * 1000) / 1000, durationSec }
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw e
  }
}
