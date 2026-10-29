import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileUrlToPath, parseRange, themesRoot } from '../src/main/files'
import { loadTheme, themeFontFaces } from '../src/engine/themes/load'

const data = path.resolve('some-data')
const themes = path.resolve('some-themes')
const url = (rel: string) => `edustudio-file://data/${rel}`

describe('fileUrlToPath', () => {
  it('serves images, audio and voice from the course folders', () => {
    expect(fileUrlToPath(data, url('courses/b/assets/music_01/v1.mp3'), themes)).toMatchObject({ type: 'audio/mpeg', root: data })
    expect(fileUrlToPath(data, url('courses/b/assets/voice_narrator/custom.wav'), themes)?.type).toBe('audio/wav')
    expect(fileUrlToPath(data, url('courses/b/voice/en/ch01.s01.b001.ogg'), themes)?.type).toBe('audio/ogg')
    expect(fileUrlToPath(data, url('courses/b/assets/a/v1.webp?v=2'), themes)?.type).toBe('image/webp')
  })
  it('serves theme fonts from the themes folder only', () => {
    const hit = fileUrlToPath(data, url('themes/storybook/fonts/Quicksand-Bold.ttf'), themes)
    expect(hit).toMatchObject({ type: 'font/ttf', root: themes })
    expect(hit!.file).toBe(path.join(themes, 'storybook', 'fonts', 'Quicksand-Bold.ttf'))
    expect(fileUrlToPath(data, url('themes/storybook/theme.yaml'), themes)).toBeNull()
    expect(fileUrlToPath(data, url('themes/storybook/fonts/OFL.txt'), themes)).toBeNull()
    expect(fileUrlToPath(data, url('themes/..%2F..%2Fsecret/fonts/a.ttf'), themes)).toBeNull()
  })
  it('refuses everything else', () => {
    expect(fileUrlToPath(data, url('courses/b/game/script.js'), themes)).toBeNull()
    expect(fileUrlToPath(data, url('courses/b/assets/../../x.png'), themes)).toBeNull()
    expect(fileUrlToPath(data, url('courses/b/assets/a/notes.txt'), themes)).toBeNull()
    expect(fileUrlToPath(data, 'https://example.com/courses/b/assets/a.png', themes)).toBeNull()
    expect(fileUrlToPath(data, 'nonsense', themes)).toBeNull()
  })
  it('finds the themes folder like the engine does', () => {
    expect(themesRoot({ EDU_THEMES: 'x' }, 'C:/cwd')).toBe(path.resolve('x'))
    expect(themesRoot({}, path.resolve('cwd'))).toBe(path.resolve('cwd', 'themes'))
  })
})

describe('parseRange', () => {
  it('reads a single byte range', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
  })
  it('flags a range outside the file', () => {
    expect(parseRange('bytes=100-', 100)).toBe('invalid')
    expect(parseRange('bytes=9-2', 100)).toBe('invalid')
    expect(parseRange('bytes=-', 100)).toBe('invalid')
    expect(parseRange('bytes=0-1', 0)).toBe('invalid')
  })
})

describe('themeFontFaces', () => {
  it('names the families the preview CSS uses and points at the font protocol', () => {
    const t = loadTheme(path.resolve('themes', 'storybook'))
    const css = themeFontFaces(t.theme, 'storybook')
    expect(css).toContain('font-family: "edu-storybook"')
    expect(css).toContain('font-family: "edu-storybook-name"')
    expect(css).toContain('url("edustudio-file://data/themes/storybook/fonts/Quicksand-Medium.ttf")')
  })
  it('skips the system fonts', () => {
    const t = loadTheme(path.resolve('themes', 'classic-dark'))
    expect(themeFontFaces(t.theme, 'classic-dark')).not.toContain('DejaVu')
  })
})
