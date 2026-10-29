/**
 * Small PCM WAV files made in code (EGS-16): the silent placeholder that stands in for a sound that could not be made, and the test tones the
 * fakes of the audio providers write (so the bot's media check and Chromium can decode them).
 */

const RATE = 8000

/** A 16-bit mono PCM WAV of `samples` (signed 16-bit values) at 8 kHz. */
export function wavOf(samples: Int16Array, rate = RATE): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((v, i) => data.writeInt16LE(v, i * 2))
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20) // PCM
  head.writeUInt16LE(1, 22) // mono
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

/** `seconds` of silence. */
export const silentWav = (seconds: number): Buffer => wavOf(new Int16Array(Math.max(1, Math.round(RATE * seconds))))

/** A sine tone of `freq` Hz, `seconds` long, with a 5 ms fade at each end. */
export function toneWav(seconds: number, freq = 440): Buffer {
  const n = Math.max(1, Math.round(RATE * seconds))
  const fade = Math.round(RATE * 0.005)
  const s = new Int16Array(n)
  for (let i = 0; i < n; i++) s[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / RATE) * 0.4 * Math.min(1, i / fade, (n - 1 - i) / fade) * 32767)
  return wavOf(s)
}
