/** PCM to a 16 kHz mono 16-bit WAV (what whisper.cpp reads). Pure: no browser API. */

export const WAV_RATE = 16000

/** Mixes channels down to mono (average). */
export function toMono(channels: Float32Array[]): Float32Array {
  const first = channels[0]
  if (!first) return new Float32Array(0)
  if (channels.length === 1) return first
  const out = new Float32Array(first.length)
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) + (ch[i] ?? 0)
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / channels.length
  return out
}

/** Resamples by linear interpolation (speech at 16 kHz does not need more). */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input
  const n = Math.max(1, Math.round((input.length * to) / from))
  const out = new Float32Array(n)
  const ratio = from / to
  for (let i = 0; i < n; i++) {
    const pos = i * ratio
    const i0 = Math.min(Math.floor(pos), input.length - 1)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const f = pos - i0
    out[i] = (input[i0] as number) * (1 - f) + (input[i1] as number) * f
  }
  return out
}

/** Encodes float samples (-1..1) at `rate` Hz as a 16 kHz mono 16-bit PCM WAV file. */
export function encodeWav(channels: Float32Array[], rate: number): Uint8Array {
  const pcm = resample(toMono(channels), rate, WAV_RATE)
  const bytes = pcm.length * 2
  const buf = new ArrayBuffer(44 + bytes)
  const v = new DataView(buf)
  const str = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + bytes, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, WAV_RATE, true)
  v.setUint32(28, WAV_RATE * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, bytes, true)
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i] as number))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(buf)
}
