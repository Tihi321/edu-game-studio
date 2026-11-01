import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findTheme, listThemes, loadTheme, themeSchema } from '../src/engine/themes/load'

const themesDir = path.resolve(__dirname, '..', 'themes')
const NAMES = ['classic-dark', 'noir', 'parchment', 'pixel-retro', 'storybook']

describe('theme files', () => {
  it('built-in themes load and validate; findTheme by name', () => {
  // all built-in themes load and validate
  {
    const { themes, errors } = listThemes(themesDir)
    expect(errors).toEqual([])
    expect(themes.map((t) => t.theme.name)).toEqual(NAMES)
  }

  // findTheme by name
  {
    expect(findTheme('noir', themesDir)?.theme.label).toBe('Noir')
    expect(findTheme('nope', themesDir)).toBeNull()
  }
  })
})

describe('theme schema', () => {
  const minimal = { name: 'mine', label: 'Mine', colors: { accent: '#112233', hover: '#223344', muted: '#334455' } }

  it('schema: defaults, rejected values, a missing file', () => {
  // fills the defaults
  {
    const t = themeSchema.parse(minimal)
    expect(t.fonts.text).toBe('DejaVuSans.ttf')
    expect(t.sizes.text).toBe(33)
    expect(t.textbox.opacity).toBe(0.7)
    expect(t.transitions.dissolve).toBe(0.6)
  }

  // rejects a bad colour, a bad name and a bad opacity
  {
    expect(() => themeSchema.parse({ ...minimal, colors: { ...minimal.colors, accent: 'red' } })).toThrow()
    expect(() => themeSchema.parse({ ...minimal, name: 'Has Space' })).toThrow()
    expect(() => themeSchema.parse({ ...minimal, textbox: { opacity: 2 } })).toThrow()
  }

  // loadTheme reports a missing file
  {
    expect(() => loadTheme(path.join(themesDir, 'does-not-exist'))).toThrow()
  }
  })
})

