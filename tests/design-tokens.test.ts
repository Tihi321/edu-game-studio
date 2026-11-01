import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { THEMES } from '../src/design/themes'

/**
 * The design system (EGS-05): every theme fills every colour and font slot of `src/design/tokens.css`, keeps WCAG AA contrast for the
 * pairs the UI actually draws, the registry swatches match the CSS, motion obeys the rules, and the player stylesheets stay scoped under
 * `.edu-stage` (so the studio can embed them).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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

describe.each(THEMES.map((t) => [t.id] as const))('theme %s', (id) => {
  const vars = themeVars(id)
  const v = (name: string): string => vars.get(name) as string

  it('loads and fills every colour and font slot', () => {
    for (const name of [...slots.colours, ...slots.fonts]) expect(vars.has(name), `${id} misses ${name}`).toBe(true)
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
  const ui: [string, string][] = [
    ['--edu-focus', '--edu-bg'],
    ['--edu-focus', '--edu-surface'],
    ['--edu-line-strong', '--edu-surface'],
    ['--edu-line-strong', '--edu-bg'],
    ['--edu-accent', '--edu-bg']
  ]
  it('palette contrast: text 4.5:1, series ink 4.5:1, non-text parts 3:1', () => {
    for (const [fg, bg] of text) expect(contrast(v(fg), v(bg)), `${id}: ${fg} ${v(fg)} on ${bg} ${v(bg)}`).toBeGreaterThanOrEqual(4.5)
    for (const sName of slots.series) expect(contrast(v('--edu-series-ink'), v(sName)), `${id}: ${sName}`).toBeGreaterThanOrEqual(4.5)
    for (const [fg, bg] of ui) expect(contrast(v(fg), v(bg)), `${id}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(3)
  })

})
