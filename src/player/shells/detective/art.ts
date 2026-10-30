import { svg } from '../../dom'

/**
 * The detective shell's little pictures, inline SVG with classes (no colour here: `detective.css` paints them from the noir theme's
 * variables, so the whole look is in one place). All of them are decoration (`aria-hidden`); the words next to them carry the meaning.
 */

const S = (tag: string, attrs: Record<string, string | number> = {}, ...kids: SVGElement[]): SVGElement => svg(tag as 'g', attrs, ...kids)

/** The title picture: a manila folder with a sheet sticking out of it, a magnifying glass and a pushpin. */
export function folderSvg(): SVGElement {
  return S(
    'svg',
    { class: 'det-art-svg', viewBox: '0 0 240 150', 'aria-hidden': 'true', focusable: 'false' },
    S('rect', { class: 'fo-shadow', x: 18, y: 124, width: 204, height: 10, rx: 5 }),
    S('path', { class: 'fo-back', d: 'M16 38 h64 l10 -14 h134 v100 a6 6 0 0 1 -6 6 H22 a6 6 0 0 1 -6 -6 Z' }),
    S('rect', { class: 'fo-sheet', x: 40, y: 16, width: 128, height: 96, rx: 2 }),
    S('path', { class: 'fo-line', d: 'M54 40 h72 M54 54 h96 M54 68 h84 M54 82 h60' }),
    S('path', { class: 'fo-front', d: 'M16 56 h208 v68 a6 6 0 0 1 -6 6 H22 a6 6 0 0 1 -6 -6 Z' }),
    S('rect', { class: 'fo-label', x: 30, y: 72, width: 92, height: 26, rx: 1 }),
    S('path', { class: 'fo-label-line', d: 'M38 82 h52 M38 90 h34' }),
    S('circle', { class: 'fo-lens', cx: 176, cy: 88, r: 22 }),
    S('circle', { class: 'fo-lens-glass', cx: 176, cy: 88, r: 17 }),
    S('path', { class: 'fo-handle', d: 'M192 104 L214 128' }),
    S('circle', { class: 'fo-pin', cx: 150, cy: 22, r: 6 })
  )
}

/** A door of the case board: a locked one (padlock), an open one (light spilling out) or a solved one. */
export function doorSvg(state: 'locked' | 'open' | 'solved'): SVGElement {
  const lock =
    state === 'locked'
      ? [S('path', { class: 'dr-shackle', d: 'M24 38 v-7 a8 8 0 0 1 16 0 v7' }), S('rect', { class: 'dr-lock', x: 20, y: 38, width: 24, height: 18, rx: 3 }), S('circle', { class: 'dr-keyhole', cx: 32, cy: 46, r: 2.5 })]
      : []
  return S(
    'svg',
    { class: `det-door-svg is-${state}`, viewBox: '0 0 64 80', 'aria-hidden': 'true', focusable: 'false' },
    S('rect', { class: 'dr-frame', x: 6, y: 4, width: 52, height: 72, rx: 2 }),
    S('rect', { class: 'dr-opening', x: 11, y: 9, width: 42, height: 67 }),
    state === 'locked' ? S('rect', { class: 'dr-panel', x: 11, y: 9, width: 42, height: 67 }) : S('path', { class: 'dr-panel dr-ajar', d: 'M11 9 L30 14 V76 H11 Z' }),
    state === 'locked' ? S('path', { class: 'dr-plank', d: 'M11 30 H53 M11 52 H53' }) : S('path', { class: 'dr-plank', d: 'M11 30 L30 32 M11 52 L30 52' }),
    state === 'locked' ? S('circle', { class: 'dr-knob', cx: 47, cy: 44, r: 2.6 }) : S('circle', { class: 'dr-knob', cx: 26, cy: 44, r: 2.4 }),
    state === 'solved' ? S('path', { class: 'dr-tick', d: 'M34 36 l6 7 l12 -14' }) : S('g', {}),
    ...lock
  )
}

/** A face-down clue card: a magnifier on the back of the card. */
export function magnifierSvg(): SVGElement {
  return S(
    'svg',
    { class: 'det-mag-svg', viewBox: '0 0 40 40', 'aria-hidden': 'true', focusable: 'false' },
    S('circle', { class: 'mg-ring', cx: 17, cy: 17, r: 10 }),
    S('path', { class: 'mg-handle', d: 'M25 25 L35 35' })
  )
}
