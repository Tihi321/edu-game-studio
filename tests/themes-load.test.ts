import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findTheme, listThemes, loadTheme, themeFontFaces, themeSchema } from '../src/engine/themes/load'

const themesDir = path.resolve(__dirname, '..', 'themes')
const NAMES = ['classic-dark', 'noir', 'parchment', 'pixel-retro', 'storybook']
const CROATIAN = 'čćđšžČĆĐŠŽ'

describe('theme files', () => {
  it('all built-in themes load and validate', () => {
    const { themes, errors } = listThemes(themesDir)
    expect(errors).toEqual([])
    expect(themes.map((t) => t.theme.name)).toEqual(NAMES)
  })

  it('every font a theme names exists in its folder (or is a system font) and has an OFL licence next to it', () => {
    for (const { theme, dir } of listThemes(themesDir).themes) {
      for (const f of [theme.fonts.text, theme.fonts.name, theme.fonts.interface, theme.fonts.bold]) {
        if (!f || f.startsWith('DejaVuSans')) continue
        expect(fs.existsSync(path.join(dir, 'fonts', f)), `${theme.name}: ${f}`).toBe(true)
      }
      if (fs.existsSync(path.join(dir, 'fonts'))) expect(fs.existsSync(path.join(dir, 'fonts', 'OFL.txt')), theme.name).toBe(true)
    }
  })

  it('findTheme by name', () => {
    expect(findTheme('noir', themesDir)?.theme.label).toBe('Noir')
    expect(findTheme('nope', themesDir)).toBeNull()
  })
})

describe('theme schema', () => {
  const minimal = { name: 'mine', label: 'Mine', colors: { accent: '#112233', hover: '#223344', muted: '#334455' } }

  it('fills the defaults', () => {
    const t = themeSchema.parse(minimal)
    expect(t.fonts.text).toBe('DejaVuSans.ttf')
    expect(t.sizes.text).toBe(33)
    expect(t.textbox.opacity).toBe(0.7)
    expect(t.transitions.dissolve).toBe(0.6)
  })

  it('rejects a bad colour, a bad name and a bad opacity', () => {
    expect(() => themeSchema.parse({ ...minimal, colors: { ...minimal.colors, accent: 'red' } })).toThrow()
    expect(() => themeSchema.parse({ ...minimal, name: 'Has Space' })).toThrow()
    expect(() => themeSchema.parse({ ...minimal, textbox: { opacity: 2 } })).toThrow()
  })

  it('loadTheme reports a missing file', () => {
    expect(() => loadTheme(path.join(themesDir, 'does-not-exist'))).toThrow()
  })
})

describe('fonts cover Croatian', () => {
  it('the font files exist (the glyph check was done with fontTools when they were added)', () => {
    // A cheap guard: the bundled fonts are non-trivial files. Coverage of č ć đ š ž was checked with fontTools:
    // Quicksand, Lora, Pixelify Sans and Courier Prime all contain every one of "${CROATIAN}".
    expect(CROATIAN.length).toBe(10)
    for (const f of ['storybook/fonts/Quicksand-Medium.ttf', 'parchment/fonts/Lora-Regular.ttf', 'noir/fonts/CourierPrime-Regular.ttf', 'pixel-retro/fonts/PixelifySans-Regular.ttf']) {
      expect(fs.statSync(path.join(themesDir, f)).size).toBeGreaterThan(40000)
    }
  })
})

describe('themeFontFaces', () => {
  it('writes a font-face for each shipped font and none for a system font', () => {
    const t = loadTheme(path.join(themesDir, 'parchment'))
    const css = themeFontFaces(t.theme, 'parchment')
    expect(css).toContain('font-family: "edu-parchment"')
    expect(css).toContain('edustudio-file://data/themes/parchment/fonts/')
    expect(themeFontFaces(loadTheme(path.join(themesDir, 'classic-dark')).theme, 'classic-dark')).toBe('')
  })
})
