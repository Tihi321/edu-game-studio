import { describe, expect, it } from 'vitest'
import { describeVoices, guessGender, parseGender, pickVoices, voiceLangsOf } from '../src/engine/voice/catalog'
import type { Gender, VoiceEntry } from '../src/engine/voice/catalog'
import { slugVoiceName } from '../src/engine/voice/vocab'
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
  it('lists the voices per language for the prompt', () => {
    const text = describeVoices([VOICES[0]!, VOICES.find((v) => v.id === 'windows:F1')!], ['en', 'hr'])
    expect(text).toContain('en: gemini:af_heart (female, af_heart); windows:F1 (female, F1)')
    expect(text).toContain('hr: windows:F1 (female, F1)')
    expect(describeVoices([VOICES[0]!], ['hr'])).toContain('(no voice reads this language)')
    expect(describeVoices([{ ...VOICES[0]!, gender: undefined }], ['en'])).toContain('gemini:af_heart (any, af_heart)')
  })
})

describe('guessGender', () => {
  const h = (looks: string, voiceHint = '', key = 'x') => ({ key, name: key, looks, voiceHint })
  it('reads the bible, and gives the narrator a female voice and others a stable one', () => {
    expect(guessGender(h('Seventeen, the keeper’s daughter'))).toBe('female')
    expect(guessGender(h('An old fisherman, he is 70 years old'))).toBe('male')
    expect(guessGender(h('', '', 'narrator'))).toBe('female')
    expect(guessGender(h('a shape in the fog', '', 'ghost'))).toBe(guessGender(h('a shape in the fog', '', 'ghost')))
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
  it('honours a preferred voice that is a free candidate, and avoids taken ones', () => {
    const a = pickVoices([{ key: 'mara', gender: 'female', preferred: 'windows:F4' }], mixed)
    expect(a.mara).toBe('windows:F4')
    const b = pickVoices([{ key: 'mara', gender: 'female', preferred: 'windows:F4' }], mixed, ['windows:F4'])
    expect(b.mara).not.toBe('windows:F4')
    const c = pickVoices([{ key: 'mara', gender: 'female', preferred: 'gemini:af_heart' }], mixed) // not a candidate
    expect(c.mara).toMatch(/^windows:F/)
    expect(pickVoices([{ key: 'tomas', gender: 'male', preferred: 'windows:F4' }], mixed).tomas).toMatch(/^windows:M/) // wrong gender
    expect(pickVoices([{ key: 'mara', gender: 'female' }], [])).toEqual({})
  })
  it('a voice without a gender in the list is usable for either', () => {
    const unknown = [voice('gemini:Any', ['en'])]
    expect(pickVoices([{ key: 'mara', gender: 'female' }], unknown)).toEqual({ mara: 'gemini:Any' })
    expect(pickVoices([{ key: 'narrator', gender: 'male' }], unknown)).toEqual({ narrator: 'gemini:Any' })
  })
})

describe('course voice settings', () => {
  it('loads an old settings block: provider vibetts is comfy, flowStyles becomes styles, only Flow voice ids survive', () => {
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
    expect(old.voice.provider).toBe('comfy')
    expect(old.voice.engine).toBe('omnivoice')
    expect(old.voice.styles).toEqual({ narrator: 'calm', mara: 'bright' })
    expect(old.voice.voices).toEqual({ lena: { en: 'gemini:Charon' }, ana: { en: 'windows:Zira' }, ivo: { de: 'gemini:Vega' } })
    expect(old.voice).not.toHaveProperty('flowStyles')
    expect(old.voice).not.toHaveProperty('englishEngine')
    expect(old.voice.engines).toEqual({})
    expect(old.voice.refTexts).toEqual({})
    expect(courseSettingsSchema.parse(base).voice.voices).toEqual({}) // no voice block
  })

  it('keeps a styles entry written today over an old flowStyles note of the same speaker', () => {
    const s = courseSettingsSchema.parse({ slug: 's', primaryLang: 'en', voice: { flowStyles: { narrator: 'old' }, styles: { narrator: 'new', mara: 'her own' } } })
    expect(s.voice.styles).toEqual({ narrator: 'new', mara: 'her own' })
  })

  it('knows the voice languages of a course', () => {
    expect(voiceLangsOf({ primaryLang: 'hr', voice: { langs: [] } } as never)).toEqual(['hr'])
    expect(voiceLangsOf({ primaryLang: 'hr', voice: { langs: ['en', 'hr'] } } as never)).toEqual(['en', 'hr'])
    expect(slugVoiceName('Mara Čuvar!')).toBe('mara-cuvar')
  })
})
