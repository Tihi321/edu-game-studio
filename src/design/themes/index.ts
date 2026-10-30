/**
 * The theme registry (EGS-05): every look a game shell (or a studio preview) can pick, by id. A theme is a CSS file next to this one
 * (`<id>.css`) that fills the colour and font slots of `src/design/tokens.css` under `[data-edu-theme="<id>"]`, plus the fonts it
 * bundles from `src/design/fonts/`. A shell names its default theme here (`shell`), so a later shell (castle, encyclopedia, RPG) picks
 * its look with `themeForShell(id)` and imports `<id>.css`; it never defines colours of its own.
 *
 * Pure data, no DOM: the studio renderer, the player and the tests all import it.
 */

export type ThemeId =
  | 'chalkboard'
  | 'castle'
  | 'parchment'
  | 'pixel'

export interface ThemeInfo {
  id: ThemeId
  /** Shown in the studio (Game tab, Library covers). */
  label: string
  /** One sentence: what it looks like. */
  description: string
  /** The shell this theme is made for (its default look); any shell may still use any theme. */
  shell: string
  /** Light or dark ground, for `color-scheme` and for the studio's preview frame. */
  scheme: 'light' | 'dark'
  /** The font families it loads (folder names under src/design/fonts/). */
  fonts: string[]
  /** A few colours that summarise it (bg, surface, text, accent, accent-2), for swatches and Library covers without its CSS. */
  swatch: { bg: string; surface: string; text: string; accent: string; accent2: string }
  /** CSS font-family values of its display and body type, for covers drawn with the swatch. */
  display: string
  body: string
  /** Pixel art: images are scaled with `image-rendering: pixelated` and motion uses steps(). */
  pixel?: boolean
}

export const THEMES: readonly ThemeInfo[] = [
  {
    id: 'chalkboard',
    label: 'Chalkboard',
    description: 'A green school board in a wooden frame, hand-lettered chalk headings and coloured chalk for the answers.',
    shell: 'quiz-arena',
    scheme: 'dark',
    fonts: ['kalam', 'atkinson-hyperlegible-next'],
    swatch: { bg: '#1d3a2e', surface: '#264a3a', text: '#f5f2e8', accent: '#f7d95a', accent2: '#8fd3f7' },
    display: "'Kalam', 'Segoe Print', cursive",
    body: "'Atkinson Hyperlegible Next', 'Segoe UI', sans-serif"
  },
  {
    id: 'castle',
    label: 'Castle stone',
    description: 'Cold dressed stone lit by torches: amber light, ember red and carved capitals for the doors of MindMaze.',
    shell: 'mindmaze',
    scheme: 'dark',
    fonts: ['cinzel', 'alegreya'],
    swatch: { bg: '#1e2026', surface: '#2f333b', text: '#efe6d2', accent: '#f4a53c', accent2: '#f08357' },
    display: "'Cinzel', 'Trajan Pro', Georgia, serif",
    body: "'Alegreya', Georgia, serif"
  },
  {
    id: 'parchment',
    label: 'Parchment and brass',
    description: 'An old encyclopedia: warm vellum, sepia ink, brass fittings and oxblood rubrics, with pages that turn.',
    shell: 'encyclopedia',
    scheme: 'light',
    fonts: ['eb-garamond'],
    swatch: { bg: '#e6d7b8', surface: '#f4ead3', text: '#2f2012', accent: '#6b4d10', accent2: '#7a2230' },
    display: "'EB Garamond', Garamond, Georgia, serif",
    body: "'EB Garamond', Garamond, Georgia, serif"
  },
  {
    id: 'pixel',
    label: 'Pixel quest',
    description: 'A 16-bit adventure: night-blue panels with stepped borders, gold coins, grass green and a pixel typeface.',
    shell: 'rpg',
    scheme: 'dark',
    fonts: ['pixelify-sans', 'atkinson-hyperlegible-next'],
    swatch: { bg: '#1b1b2f', surface: '#2c2c54', text: '#f4f4f4', accent: '#ffcd3c', accent2: '#5fd35a' },
    display: "'Pixelify Sans', 'Courier New', monospace",
    body: "'Pixelify Sans', 'Atkinson Hyperlegible Next', sans-serif",
    pixel: true
  }
]

export const DEFAULT_THEME: ThemeId = 'chalkboard'

export function getTheme(id: string | undefined): ThemeInfo {
  return THEMES.find((t) => t.id === id) ?? (THEMES.find((t) => t.id === DEFAULT_THEME) as ThemeInfo)
}

/** The theme a shell uses unless the course picks another (`shells.config[shell].theme`). */
export function themeForShell(shell: string, configured?: string): ThemeInfo {
  if (configured && THEMES.some((t) => t.id === configured)) return getTheme(configured)
  return THEMES.find((t) => t.shell === shell) ?? getTheme(DEFAULT_THEME)
}
