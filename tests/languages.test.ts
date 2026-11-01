import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UI_STRINGS } from '../src/shared/ui-strings'
import { assertKnownLang, BUILTIN_LANGUAGES, isKnownLang, languageInfo, languages, registerLanguages, resetLanguages } from '../src/shared/languages'
import { LANGS, langSchema, courseSettingsSchema } from '../src/shared/media'
import { loadLanguageConfig } from '../src/engine/edu/languages-config'

afterEach(() => resetLanguages())

describe('the language table', () => {
  it('has the 37 built-in languages', () => {
    expect(BUILTIN_LANGUAGES).toHaveLength(37)
    expect(LANGS).toHaveLength(37)
    for (const code of ['en', 'hr', 'ko', 'ja', 'ar', 'bg', 'de', 'fr', 'hi', 'zh']) expect(isKnownLang(code)).toBe(true)
    for (const code of ['sr', 'bs', 'no', 'he', 'fa', 'zh']) expect(isKnownLang(code)).toBe(true)
    expect(languages().filter((l) => l.rtl).map((l) => l.code)).toEqual(['ar', 'he', 'fa'])
    // TTS coverage is the engine registry's, not a language flag
    expect(languages().some((l) => 'supertonic' in l)).toBe(false)
  })
  it('has unique codes and native names', () => {
    const codes = BUILTIN_LANGUAGES.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(languageInfo('hr')).toMatchObject({ name: 'Croatian', native: 'Hrvatski', script: 'latin' })
  })
  it('knows what it knows', () => {
    expect(assertKnownLang('de')).toBe('de')
    expect(() => assertKnownLang('xx')).toThrow(/unknown language "xx".*config\/languages\.md/)
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
  it('only Croatian and German have a table, and English never has one', () => {
    expect(Object.keys(UI_STRINGS)).toEqual(['hr', 'de'])
    expect(languageInfo('hr')?.ui).toBeTruthy()
    expect(languageInfo('en')?.ui).toBeUndefined()
    expect(languageInfo('fr')?.ui).toBeUndefined()
  })
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
  it('a language entry from the config file keeps the built-in table', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-lang-'))
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'config', 'languages.md'), '---\nkind: languages\nlanguages:\n  - code: hr\n    name: Croatian\n    ui:\n      Quit: Zatvori\n---\nbody\n')
    await loadLanguageConfig(dir)
    expect(languageInfo('hr')?.ui?.Quit).toBe('Zatvori')
    expect(languageInfo('hr')?.ui?.Start).toBe('Započni')
  })
})

describe('language codes in the course files', () => {
  it('accepts a code of any known or custom language, not junk', () => {
    expect(langSchema.safeParse('pt-br').success).toBe(true)
    expect(langSchema.safeParse('Croatian').success).toBe(false)
    expect(langSchema.safeParse('e').success).toBe(false)
  })
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

describe('config/languages.md', () => {
  const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'edu-lang-'))
  const write = (dir: string, text: string): void => {
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'config', 'languages.md'), text)
  }

  it('adds a language with a UI table', async () => {
    const dir = tmp()
    write(dir, '---\nkind: languages\nlanguages:\n  - code: pt-br\n    name: Brazilian Portuguese\n    ui:\n      Start: Iniciar\n---\nbody\n')
    await loadLanguageConfig(dir)
    expect(languageInfo('pt-br')?.ui).toEqual({ Start: 'Iniciar' })
  })
  it('accepts and ignores a legacy supertonic flag in an entry', async () => {
    const dir = tmp()
    write(dir, '---\nkind: languages\nlanguages:\n  - code: pt-br\n    name: Brazilian Portuguese\n    supertonic: true\n---\nbody\n')
    const log: string[] = []
    await loadLanguageConfig(dir, (m) => log.push(m))
    expect(log).toEqual([])
    expect(languageInfo('pt-br')).toMatchObject({ name: 'Brazilian Portuguese' })
    expect(languageInfo('pt-br')).not.toHaveProperty('supertonic')
  })
  it('ignores a bad file and says so', async () => {
    const dir = tmp()
    write(dir, '---\nkind: languages\nlanguages:\n  - code: X\n    name: ""\n---\n')
    const log: string[] = []
    await loadLanguageConfig(dir, (m) => log.push(m))
    expect(languages()).toHaveLength(37)
    expect(log[0]).toMatch(/not valid/)
  })
  it('is fine without the file', async () => {
    await loadLanguageConfig(tmp())
    expect(languages()).toHaveLength(37)
  })
  it('the seed file is valid and adds nothing', async () => {
    const dir = tmp()
    fs.mkdirSync(path.join(dir, 'config'))
    fs.copyFileSync(path.resolve('seed/config/languages.md'), path.join(dir, 'config', 'languages.md'))
    const log: string[] = []
    await loadLanguageConfig(dir, (m) => log.push(m))
    expect(log).toEqual([])
    expect(languages()).toHaveLength(37)
  })
})
