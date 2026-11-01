import { afterEach, describe, expect, it } from 'vitest'
import { UI_STRINGS } from '../src/shared/ui-strings'
import { BUILTIN_LANGUAGES, isKnownLang, languageInfo, registerLanguages, resetLanguages } from '../src/shared/languages'
import { courseSettingsSchema } from '../src/shared/media'

afterEach(() => resetLanguages())

describe('the language table', () => {
  it('has unique codes and native names', () => {
    const codes = BUILTIN_LANGUAGES.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(languageInfo('hr')).toMatchObject({ name: 'Croatian', native: 'Hrvatski', script: 'latin' })
  })
  it('registers new languages and overrides built-in ones', () => {
    registerLanguages([
      { code: 'pt-br', name: 'Brazilian Portuguese' },
      { code: 'de', name: 'German', native: 'Deutsch (DE)' }
    ])
    expect(languageInfo('pt-br')).toMatchObject({ native: 'Brazilian Portuguese', script: 'other' })
    expect(languageInfo('de')?.native).toBe('Deutsch (DE)')
    resetLanguages()
    expect(isKnownLang('pt-br')).toBe(false)
  })
})

describe('UI strings of the built-in languages', () => {
  it('keeps the placeholders of the English text and has no empty translation', () => {
    for (const [src, dst] of Object.entries(UI_STRINGS.hr!)) {
      expect(dst.trim(), src).not.toBe('')
      expect(dst.includes('{}'), src).toBe(src.includes('{}'))
    }
  })
  it('config/languages.md merges into a built-in language: ui key by key, other fields replace', () => {
    registerLanguages([{ code: 'hr', name: 'Croatian', native: 'Hrvatski (HR)', ui: { Start: 'Kreni' } }])
    const hr = languageInfo('hr')!
    expect(hr.native).toBe('Hrvatski (HR)')
    expect(hr.script).toBe('latin')
    expect(hr.ui!.Start).toBe('Kreni')
    expect(hr.ui!.Next).toBe('Dalje')
  })
})

describe('language codes in the course files', () => {
  it('keeps the legacy Flow voice ids (gemini/windows) and drops the old Kokoro/Supertonic ones', () => {
    const s = courseSettingsSchema.parse({
      slug: 'a',
      primaryLang: 'hr',
      voice: { voices: { mara: 'supertonic:F1', ivo: 'af_heart', lena: 'gemini:Charon', ana: 'windows:Zira' } }
    })
    expect(s.voice.voices.mara).toBeUndefined()
    expect(s.voice.voices.ivo).toBeUndefined()
    expect(s.voice.voices.lena).toEqual({ en: 'gemini:Charon' })
    expect(s.voice.voices.ana).toEqual({ en: 'windows:Zira' })
  })
})
