import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LOOP_CROSSFADE_SEC, makeSeamlessLoop, probeDuration } from '../src/engine/assets/loop'
import { wavOf } from '../src/engine/assets/wav'

/**
 * EGS-70 (HUB-33): ComfyUI music (ACE-Step) is not made to loop, so the track gets an equal-power crossfade of its last 3 s into its start and the
 * player loops it whole. The check is on a synthetic file: noise whose level rises from 0.1 to 0.8, so the raw end and start are far apart.
 */

const hasFfmpeg = ((): boolean => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const RATE = 44100
const WINDOW = Math.round(RATE * 0.05)

function rampNoise(seconds: number): Int16Array {
  const n = Math.round(seconds * RATE)
  const s = new Int16Array(n)
  let r = 12345
  for (let i = 0; i < n; i++) {
    r = (Math.imul(r, 1103515245) + 12345) >>> 0
    const white = (r / 0xffffffff) * 2 - 1
    s[i] = Math.round(white * (0.1 + 0.7 * (i / n)) * 32767)
  }
  return s
}

/** The samples of the `data` chunk of a 16-bit mono PCM wav (ffmpeg writes an INFO chunk before it). */
function samplesOf(wav: Buffer): Int16Array {
  let at = 12
  while (at + 8 <= wav.length) {
    const size = wav.readUInt32LE(at + 4)
    if (wav.toString('ascii', at, at + 4) === 'data') return new Int16Array(wav.buffer.slice(wav.byteOffset + at + 8, wav.byteOffset + at + 8 + Math.min(size, wav.length - at - 8)))
    at += 8 + size + (size % 2)
  }
  throw new Error('no data chunk')
}
const rms = (x: Int16Array, from: number, to: number): number => Math.sqrt(x.slice(from, to).reduce((a, v) => a + (v / 32768) ** 2, 0) / (to - from))

/** The RMS jump across the loop seam (the 50 ms before the end against the 50 ms after the start), and the biggest jump between two neighbouring 50 ms windows anywhere else. */
function jumps(x: Int16Array): { seam: number; other: number } {
  const seam = Math.abs(rms(x, x.length - WINDOW, x.length) - rms(x, 0, WINDOW))
  let other = 0
  for (let at = 0; at + 2 * WINDOW <= x.length - WINDOW; at += WINDOW) other = Math.max(other, Math.abs(rms(x, at, at + WINDOW) - rms(x, at + WINDOW, at + 2 * WINDOW)))
  return { seam, other }
}

describe.skipIf(!hasFfmpeg)('a seamless loop from an ACE-Step track', () => {
  let dir = ''
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('the RMS across the seam is no bigger than between any two other 50 ms windows, the raw file jumps, and loopEndSec is the new length', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'edu-loop-'))
    const file = path.join(dir, 'v1.wav')
    await writeFile(file, wavOf(rampNoise(12), RATE))
    const raw = jumps(samplesOf(await readFile(file)))
    expect(raw.seam).toBeGreaterThan(raw.other * 5) // the raw end (loud) meets the raw start (quiet)

    const loop = await makeSeamlessLoop(file, file)
    expect(loop).toMatchObject({ file, loopStartSec: 0 })
    expect(loop.loopEndSec).toBeCloseTo(12 - LOOP_CROSSFADE_SEC, 2) // the crossfade eats its own length
    expect(await probeDuration(file)).toBeCloseTo(loop.loopEndSec, 2)
    const made = jumps(samplesOf(await readFile(file)))
    expect(made.seam).toBeLessThanOrEqual(made.other)
  })
})
