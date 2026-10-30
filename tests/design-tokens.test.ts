import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, getTheme, THEMES, themeForShell } from '../src/design/themes'

/**
 * The design system (EGS-05): every theme fills every colour and font slot of `src/design/tokens.css`, keeps WCAG AA contrast for the
 * pairs the UI actually draws, the registry swatches match the CSS, motion obeys the rules, and the player stylesheets stay scoped under
 * `.edu-stage` (so the studio can embed them).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DESIGN = path.join(ROOT, 'src', 'design')
const read = (...p: string[]): string => readFileSync(path.join(ROOT, ...p), 'utf8')
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The custom properties declared in the first rule whose selector contains `selector`. */
function declarations(css: string, selector: string): Map<string, string> {
  const clean = stripComments(css)
  const at = clean.indexOf(selector)
  if (at < 0) throw new Error(`selector ${selector} not found`)
  const open = clean.indexOf('{', at)
  let depth = 1
  let i = open + 1
  for (; i < clean.length && depth > 0; i++) {
    if (clean[i] === '{') depth++
    else if (clean[i] === '}') depth--
  }
  const body = clean.slice(open + 1, i - 1)
  const out = new Map<string, string>()
  // a value may contain ; inside url("data:...;...") so split on ; that is followed by a new custom property or the end
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([\s\S]*?);\s*(?=--[a-z0-9-]+\s*:|$)/g)) out.set(m[1] as string, (m[2] as string).trim())
  return out
}

/** The colour and font slot names of tokens.css: the `--edu-*` declared between the colour slots and the type scale. */
function slotNames(): { colours: string[]; fonts: string[]; series: string[] } {
  const css = read('src', 'design', 'tokens.css')
  const from = css.indexOf('/* ---- colour slots')
  const fontAt = css.indexOf('/* ---- font slots')
  const scaleAt = css.indexOf('/* ---- type scale')
  expect(from).toBeGreaterThan(0)
  const names = (s: string): string[] => [...s.matchAll(/(--edu-[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string)
  const colours = names(css.slice(from, fontAt))
  return { colours, fonts: names(css.slice(fontAt, scaleAt)), series: colours.filter((n) => /^--edu-series-\d$/.test(n)) }
}

// ---- WCAG contrast ----
function lum(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`)
  const n = parseInt(m[1] as string, 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (ch[0] as number) + 0.7152 * (ch[1] as number) + 0.0722 * (ch[2] as number)
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const themeCss = (id: string): string => read('src', 'design', 'themes', `${id}.css`)
const slots = slotNames()
const themeVars = (id: string): Map<string, string> => declarations(themeCss(id), `[data-edu-theme='${id}']`)

describe('tokens.css', () => {
  it('declares the colour slots, the font slots and a 13px type floor', () => {
    expect(slots.colours.length).toBeGreaterThanOrEqual(26)
    expect(slots.fonts).toEqual(['--edu-font-display', '--edu-font-body', '--edu-font-mono'])
    expect(slots.series).toHaveLength(6)
    const css = read('src', 'design', 'tokens.css')
    expect(css).toMatch(/--edu-text-xs:\s*0\.8125rem/)
    expect(css).toMatch(/--edu-text-m:\s*1rem/)
  })

  it('zeroes every motion duration under prefers-reduced-motion', () => {
    const css = stripComments(read('src', 'design', 'tokens.css'))
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    for (const d of ['fast', 'med', 'slow']) expect(block).toMatch(new RegExp(`--edu-dur-${d}:\\s*0ms`))
  })
})

describe('the theme registry', () => {
  it('lists the themes with a CSS file each', () => {
    expect(THEMES.map((t) => t.id)).toEqual([
      'chalkboard',
      'castle',
      'parchment',
      'pixel',
      'postcard',
      'noir'
    ])
    for (const t of THEMES) expect(existsSync(path.join(DESIGN, 'themes', `${t.id}.css`)), t.id).toBe(true)
  })

  it('finds a theme by id and by shell, with chalkboard as the fallback', () => {
    expect(getTheme('castle').id).toBe('castle')
    expect(getTheme('nope').id).toBe(DEFAULT_THEME)
    expect(getTheme(undefined).id).toBe('chalkboard')
    expect(themeForShell('quiz-arena').id).toBe('chalkboard')
    expect(themeForShell('mindmaze').id).toBe('castle')
    expect(themeForShell('encyclopedia').id).toBe('parchment')
    expect(themeForShell('rpg').id).toBe('pixel')
    expect(themeForShell('rpg', 'parchment').id).toBe('parchment')
    expect(themeForShell('unknown-shell').id).toBe('chalkboard')
  })

  it('bundles the fonts it names (font.css and an OFL licence each) and imports them in its CSS', () => {
    for (const t of THEMES) {
      const css = themeCss(t.id)
      for (const f of t.fonts) {
        expect(existsSync(path.join(DESIGN, 'fonts', f, 'font.css')), `${t.id}: ${f}/font.css`).toBe(true)
        expect(existsSync(path.join(DESIGN, 'fonts', f, 'OFL.txt')), `${t.id}: ${f}/OFL.txt`).toBe(true)
        expect(css, `${t.id} imports ${f}`).toContain(`@import '../fonts/${f}/font.css'`)
      }
    }
  })

  it('never loads a font from the network', () => {
    // (the xmlns of an inline SVG data URI is not a request)
    const remote = /url\(\s*['"]?https?:|@import\s+(url\(\s*)?['"]?https?:/
    for (const f of ['tokens.css', 'motion.css', ...THEMES.map((t) => `themes/${t.id}.css`)]) expect(read('src', 'design', f), f).not.toMatch(remote)
    for (const t of THEMES) for (const fam of t.fonts) expect(read('src', 'design', 'fonts', fam, 'font.css'), fam).not.toMatch(/url\(\s*['"]?https?:/)
  })
})

describe.each(THEMES.map((t) => [t.id] as const))('theme %s', (id) => {
  const vars = themeVars(id)
  const v = (name: string): string => vars.get(name) as string
  const info = getTheme(id)

  it('fills every colour and font slot', () => {
    for (const name of [...slots.colours, ...slots.fonts]) expect(vars.has(name), `${id} misses ${name}`).toBe(true)
  })

  it('keeps the motion duration tokens untouched and picks an entrance that exists', () => {
    for (const d of ['fast', 'med', 'slow']) expect(vars.has(`--edu-dur-${d}`), `${id} overrides --edu-dur-${d}`).toBe(false)
    const enter = v('--edu-enter-name')
    expect(enter).toMatch(/^edu-enter-/)
    expect(read('src', 'design', 'motion.css')).toContain(`@keyframes ${enter}`)
  })

  it('matches the colour scheme of the registry', () => {
    expect(v('--edu-bg') && lum(v('--edu-bg')) < 0.18 ? 'dark' : 'light').toBe(info.scheme)
    expect(themeCss(id)).toContain(`color-scheme: ${info.scheme};`)
  })

  it('has registry swatches and font families equal to its CSS', () => {
    expect(info.swatch).toEqual({ bg: v('--edu-bg'), surface: v('--edu-surface'), text: v('--edu-text'), accent: v('--edu-accent'), accent2: v('--edu-accent-2') })
    const first = (s: string): string => (s.split(',')[0] as string).trim().replace(/['"]/g, '')
    expect(first(info.display)).toBe(first(v('--edu-font-display')))
    expect(first(info.body)).toBe(first(v('--edu-font-body')))
  })

  // text >= 4.5:1 (WCAG 1.4.3), non-text parts >= 3:1 (1.4.11)
  const text: [string, string][] = [
    ['--edu-text', '--edu-bg'],
    ['--edu-text', '--edu-surface'],
    ['--edu-text', '--edu-bg-2'],
    ['--edu-text-dim', '--edu-bg'],
    ['--edu-text-dim', '--edu-surface'],
    ['--edu-text-dim', '--edu-bg-2'],
    ['--edu-accent-ink', '--edu-accent'],
    ['--edu-good-ink', '--edu-good'],
    ['--edu-bad-ink', '--edu-bad'],
    ['--edu-mark-ink', '--edu-mark'],
    ['--edu-warn', '--edu-warn-bg'],
    // coloured text drawn straight on the board and on the feedback panel
    ['--edu-accent', '--edu-bg'],
    ['--edu-accent', '--edu-bg-2'],
    ['--edu-accent-2', '--edu-bg'],
    ['--edu-accent-2', '--edu-bg-2'],
    ['--edu-good', '--edu-bg'],
    ['--edu-good', '--edu-bg-2'],
    ['--edu-bad', '--edu-bg'],
    ['--edu-bad', '--edu-bg-2'],
    ['--edu-warn', '--edu-bg-2'],
    // the page colour is the ink on a filled accent-2 chip and on the crossword paper
    ['--edu-bg', '--edu-accent-2']
  ]
  it.each(text)('text contrast %s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(v(fg), v(bg)), `${id}: ${fg} ${v(fg)} on ${bg} ${v(bg)}`).toBeGreaterThanOrEqual(4.5)
  })

  it.each(slots.series.map((s) => [s] as const))('series ink on %s is at least 4.5:1', (s) => {
    expect(contrast(v('--edu-series-ink'), v(s)), `${id}: ${s}`).toBeGreaterThanOrEqual(4.5)
  })

  const ui: [string, string][] = [
    ['--edu-focus', '--edu-bg'],
    ['--edu-focus', '--edu-surface'],
    ['--edu-line-strong', '--edu-surface'],
    ['--edu-line-strong', '--edu-bg'],
    ['--edu-accent', '--edu-bg']
  ]
  it.each(ui)('non-text contrast %s on %s is at least 3:1', (fg, bg) => {
    expect(contrast(v(fg), v(bg)), `${id}: ${fg} ${v(fg)} on ${bg} ${v(bg)}`).toBeGreaterThanOrEqual(3)
  })
})

describe('motion.css', () => {
  const css = stripComments(read('src', 'design', 'motion.css'))

  it('defines the keyframes the design needs', () => {
    for (const k of ['edu-enter-wipe', 'edu-enter-door', 'edu-enter-page', 'edu-enter-steps', 'edu-burst', 'edu-dust', 'edu-torch', 'edu-pixel-step', 'edu-eraser']) expect(css, k).toContain(`@keyframes ${k}`)
  })

  it('switches animation itself off under prefers-reduced-motion', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(block).toMatch(/\.edu-stage[\s\S]*animation:\s*none\s*!important/)
    expect(block).toMatch(/\[data-edu-theme\]/)
  })

  it('the castle torch only changes opacity', () => {
    const torch = /@keyframes edu-torch\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(torch).toMatch(/opacity/)
    expect(torch).not.toMatch(/transform|top|left|width|height/)
  })
})

/** Splits a selector list at the commas outside parentheses (`:is(a, b)` stays whole). */
function topLevelCommas(sel: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of sel) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  return [...out, cur]
}

describe('player stylesheets', () => {
  /** The selectors of every style rule, with the @media wrappers looked through. */
  function selectors(file: string): string[] {
    const css = stripComments(read('src', 'player', 'style', file))
    return [...css.matchAll(/([^{}@;]+)\{/g)].map((m) => (m[1] as string).trim()).filter((x) => x && !x.startsWith('media'))
  }

  it.each(['items.css', 'arena.css'])('%s has no global rule: every selector starts with .edu-stage', (file) => {
    for (const sel of selectors(file)) {
      for (const part of topLevelCommas(sel)) expect(part.trim(), `${file}: ${part.trim()}`).toMatch(/^(:where\(\.edu-stage\)|\.edu-stage)(?=[\s.:[,]|$)/)
    }
  })

  it('base.css is the only file with page-level rules, and embed.css pulls in tokens, chalkboard and items only', () => {
    expect(selectors('base.css')).toEqual(['html', 'body', '#edu-root'])
    const embed = read('src', 'player', 'style', 'embed.css')
    expect(embed).toContain("@import '../../design/tokens.css'")
    expect(embed).toContain("@import '../../design/themes/chalkboard.css'")
    expect(embed).toContain("@import './items.css'")
    expect(embed).not.toContain('base.css')
    expect(embed).not.toContain('arena.css')
  })

  it('uses the design tokens, not hard-coded colours, outside the theme files', () => {
    for (const f of ['items.css', 'arena.css']) {
      const css = stripComments(read('src', 'player', 'style', f))
      expect(css, `${f} has a hex colour`).not.toMatch(/#[0-9a-f]{3,8}\b(?![^()]*\))/i)
      expect(css, `${f} uses --chalk-*`).not.toMatch(/var\(--chalk-/)
    }
  })

  it('has no all-caps labels and no text under 13px', () => {
    for (const f of ['items.css', 'arena.css']) {
      const css = stripComments(read('src', 'player', 'style', f))
      // upper case is only the typing aid of the crossword inputs, never a label
      for (const m of css.matchAll(/([^{}]+){[^}]*text-transform:s*uppercase/g)) expect(m[1], `${f}: uppercase label`).toMatch(/cw-input|word-input/)
      for (const m of css.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) {
        const px = Number(m[1]) * (m[2] === 'rem' ? 16 : 1)
        // 11px: the clue numbers in the corner of a crossword cell (dense grids, aria-hidden, the clue list repeats them)
        expect(px, `${f}: font-size ${m[0]}`).toBeGreaterThanOrEqual(m[0].includes('0.6875rem') ? 11 : 13)
      }
    }
  })
})

describe('shell stylesheets (EGS-10+: src/player/kit and src/player/shells/<id>/)', () => {
  const walk = (dir: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.css') ? [path.join(dir, e.name)] : []))
      : []
  const files = [...walk(path.join(ROOT, 'src', 'player', 'kit')), ...walk(path.join(ROOT, 'src', 'player', 'shells'))]
  const rel = (f: string): string => path.relative(ROOT, f).split(path.sep).join('/')

  it('exist (the kit at least)', () => {
    expect(files.map(rel)).toContain('src/player/kit/kit.css')
  })

  it.each(files.map(rel))('%s: every selector starts with .edu-stage, colours come from tokens, no text under 13px', (file) => {
    const css = stripComments(read(...file.split('/')))
    const sels = [...css.matchAll(/([^{}@;]+)\{/g)].map((m) => (m[1] as string).trim()).filter((x) => x && !/^(media|keyframes|supports|from|to|\d)/.test(x) && !/^\d+%/.test(x))
    // selectors inside @keyframes (from, to, 40%) are skipped above
    for (const sel of sels) for (const part of topLevelCommas(sel)) expect(part.trim(), `${file}: ${part.trim()}`).toMatch(/^(:where\(\.edu-stage\)|\.edu-stage)(?=[\s.:[,]|$)/)
    expect(css, `${file} has a hex colour (colours belong in src/design/themes/<id>.css)`).not.toMatch(/#[0-9a-f]{3,8}\b(?![^()]*\))/i)
    for (const m of css.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) {
      const px = Number(m[1]) * (m[2] === 'rem' ? 16 : 1)
      expect(px, `${file}: font-size ${m[0]}`).toBeGreaterThanOrEqual(13)
    }
  })
})
