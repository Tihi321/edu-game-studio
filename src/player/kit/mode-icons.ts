import { svg } from '../dom'

/**
 * One pictogram per game mode (EGS-25), drawn in a 32x32 box with `currentColor` strokes so the card colours them. They identify the
 * mode on its card; the page itself is not re-themed. Unknown ids get a plain star.
 */
type P = Record<string, string | number>
const path = (d: string, extra: P = {}): SVGElement => svg('path', { d, ...extra })
const circle = (cx: number, cy: number, r: number, extra: P = {}): SVGElement => svg('circle', { cx, cy, r, ...extra })

const DRAW: Record<string, () => SVGElement[]> = {
  // a clock face over a question mark: timed questions
  'quiz-arena': () => [circle(16, 17, 11), path('M16 10v7l4 3'), path('M13 3h6')],
  // an open book
  encyclopedia: () => [path('M16 8c-3-2-7-2.5-11-2v18c4-.5 8 0 11 2 3-2 7-2.5 11-2V6c-4-.5-8 0-11 2z'), path('M16 8v18')],
  // a castle gate with battlements
  mindmaze: () => [path('M5 27V9h4v3h4V9h6v3h4V9h4v18z'), path('M13 27v-7a3 3 0 0 1 6 0v7')],
  // a sword
  rpg: () => [path('M7 25 22 10l3-6 3 3-6 3L7 25'), path('M5 27l3-3M9 21l3 3')],
  // two speech bubbles
  roleplay: () => [path('M4 6h15a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H11l-4 4v-4H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z'), path('M24 12h2a2 2 0 0 1 2 2v7a1 1 0 0 1-1 1h-3v3l-4-3h-5')],
  // a magnifying glass
  detective: () => [circle(13, 13, 8), path('M19 19l9 9')]
}

/** The mode pictogram as an inline SVG (decorative: the card's text names the mode). */
export function modeIcon(id: string): SVGElement {
  const root = svg('svg', { viewBox: '0 0 32 32', width: 32, height: 32, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'mode-icon' })
  const parts = DRAW[id]?.() ?? [path('M16 4l3.7 7.8 8.3 1-6.1 5.8 1.6 8.4L16 22.8 8.5 27l1.6-8.4L4 12.8l8.3-1z')]
  for (const p of parts) root.appendChild(p)
  return root
}

export const MODE_IDS = Object.keys(DRAW)
