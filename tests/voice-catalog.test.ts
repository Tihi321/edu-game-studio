import { describe, expect, it } from 'vitest'
import { parseGender, pickVoices } from '../src/engine/voice/catalog'
import type { Gender, VoiceEntry } from '../src/engine/voice/catalog'
import { courseSettingsSchema } from '../src/shared/media'

const ALL_LANGS = ['en', 'hr', 'de']
const voice = (id: string, languages: string[], gender?: Gender, engine = 'gemini', label = id): VoiceEntry => ({ id, label, engine, languages, ...(gender ? { gender } : {}) })
const GEMINI: Array<[string, Gender]> = [['af_heart', 'female'], ['af_bella', 'female'], ['bf_emma', 'female'], ['am_adam', 'male'], ['bm_george', 'male']]
const WINDOWS: Array<[string, Gender]> = [['F1', 'female'], ['F2', 'female'], ['F3', 'female'], ['F4', 'female'], ['F5', 'female'], ['M1', 'male'], ['M2', 'male'], ['M3', 'male'], ['M4', 'male'], ['M5', 'male']]
const VOICES: VoiceEntry[] = [
  ...GEMINI.map(([id, gender]) => voice(`gemini:${id}`, ['en'], gender, 'gemini', id)),
  ...WINDOWS.map(([id, gender]) => voice(`windows:${id}`, ALL_LANGS, gender, 'windows', id))
]

describe('voice entries and the language filter', () => {
  it('reads the gender a list gives, and the one the director writes', () => {
    expect(VOICES[0]!.gender).toBe('female')
    expect(VOICES.find((v) => v.id === 'gemini:am_adam')!.gender).toBe('male')
    expect(VOICES.find((v) => v.id === 'windows:M5')!.gender).toBe('male')
    expect(parseGender(' Female ')).toBe('female')
    expect(parseGender('man')).toBe('male')
    expect(parseGender('robot')).toBeNull()
    expect(voice('omnivoice', ['*']).gender).toBeUndefined()
  })
})

describe('pickVoices', () => {
  const women = VOICES.filter((v) => v.engine === 'gemini')
  const mixed = VOICES.filter((v) => v.engine === 'windows')
  it('is deterministic, matches the gender and spreads the cast', () => {
    const cast = [
      { key: 'mara', gender: 'female' as const },
      { key: 'tomas', gender: 'male' as const },
      { key: 'ivo', gender: 'male' as const },
      { key: 'narrator', gender: 'female' as const }
    ]
    const a = pickVoices(cast, mixed)
    expect(pickVoices(cast, mixed)).toEqual(a)
    expect(mixed.find((v) => v.id === a.mara)!.gender).toBe('female')
    expect(mixed.find((v) => v.id === a.tomas)!.gender).toBe('male')
    expect(a.tomas).not.toBe(a.ivo)
    expect(a.narrator).not.toBe(a.mara) // a free female voice exists
    expect(new Set(Object.values(a)).size).toBe(4)
    for (const v of Object.values(pickVoices(cast, women))) expect(women.map((k) => k.id)).toContain(v)
  })
  it('reuses voices round-robin when a gender runs out', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ key: `f${i}`, gender: 'female' as const }))
    const a = pickVoices(many, mixed)
    const counts = new Map<string, number>()
    for (const v of Object.values(a)) counts.set(v, (counts.get(v) ?? 0) + 1)
    expect([...counts.keys()].every((id) => mixed.find((v) => v.id === id)!.gender === 'female')).toBe(true)
    expect(counts.size).toBe(5)
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3)
  })
})

describe('course voice settings', () => {
  it('loads an old settings block: provider vibetts stays vibetts, flow becomes gemini, flowStyles becomes styles, only Flow voice ids survive', () => {
    const base = { slug: 's', primaryLang: 'en' }
    const old = courseSettingsSchema.parse({
      ...base,
      voice: {
        enabled: true,
        provider: 'vibetts',
        englishEngine: 'kokoro',
        flowStyles: { narrator: 'calm', mara: 'bright' },
        voices: { narrator: 'omni:petra', mara: 'supertonic:F2', lena: 'gemini:Charon', ana: 'windows:Zira', ivo: { en: 'af_heart', hr: 'supertonic:M1', de: 'gemini:Vega' } }
      }
    })
    expect(old.voice.provider).toBe('vibetts')
    expect(old.voice.engine).toBe('omnivoice')
    expect(old.voice.styles).toEqual({ narrator: 'calm', mara: 'bright' })
    expect(old.voice.voices).toEqual({ lena: { en: 'gemini:Charon' }, ana: { en: 'windows:Zira' }, ivo: { de: 'gemini:Vega' } })
    expect(old.voice).not.toHaveProperty('flowStyles')
    expect(old.voice).not.toHaveProperty('englishEngine')
    expect(old.voice.engines).toEqual({})
    expect(old.voice.refTexts).toEqual({})
    expect(courseSettingsSchema.parse(base).voice.voices).toEqual({}) // no voice block
    expect(courseSettingsSchema.parse({ ...base, voice: { provider: 'flow' } }).voice.provider).toBe('gemini') // the old Flow provider is Gemini now
  })
})
