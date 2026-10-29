// Generates the placeholder sounds of the golden fixtures (tests/fixtures/courses/*/course/assets/*.wav).
// They are plain sine-tone beeps, NOT speech: the Croatian listening items point to tone placeholders until
// text-to-speech (EGS-17) replaces them. Usage: node scripts/make-fixture-audio.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RATE = 8000
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'courses')

/** 16-bit mono PCM WAV of `beeps` sine beeps (`freq` Hz) with a 5 ms fade at each end, `toneMs` long, `gapMs` apart. */
function beeps({ beeps: n, freq, toneMs = 120, gapMs = 100 }) {
  const tone = Math.round((RATE * toneMs) / 1000)
  const gap = Math.round((RATE * gapMs) / 1000)
  const fade = Math.round(RATE * 0.005)
  const samples = []
  for (let b = 0; b < n; b++) {
    for (let i = 0; i < tone; i++) {
      const env = Math.min(1, i / fade, (tone - 1 - i) / fade)
      samples.push(Math.round(Math.sin((2 * Math.PI * freq * i) / RATE) * 0.5 * env * 32767))
    }
    for (let i = 0; i < gap; i++) samples.push(0)
  }
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((v, i) => data.writeInt16LE(v, i * 2))
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20) // PCM
  head.writeUInt16LE(1, 22) // mono
  head.writeUInt32LE(RATE, 24)
  head.writeUInt32LE(RATE * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

const files = [
  ['solar-system', 'eight-beeps.wav', { beeps: 8, freq: 660 }],
  ['hr-a1-greetings', 'placeholder-dobar-dan.wav', { beeps: 1, freq: 440, toneMs: 600 }],
  ['hr-a1-greetings', 'placeholder-zovem-se-ana.wav', { beeps: 3, freq: 330, toneMs: 200, gapMs: 150 }]
]
for (const [course, name, opts] of files) {
  const dir = path.join(root, course, 'course', 'assets')
  mkdirSync(dir, { recursive: true })
  const wav = beeps(opts)
  writeFileSync(path.join(dir, name), wav)
  console.log(`${course}/${name}: ${wav.length} bytes`)
}
