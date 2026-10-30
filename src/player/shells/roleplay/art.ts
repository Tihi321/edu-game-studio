import { button, h, svg } from '../../dom'
import type { Stage } from './garden'

/**
 * The drawing of the role-play shell (EGS-13): the postage stamp with the CEFR level, the speaker portraits, speech bubbles and the
 * potted plants of the garden (inline SVG, one drawing per growth stage). DOM only; colours come from the postcard theme's variables
 * through the classes in `roleplay.css`, never from here.
 */

/** A postage stamp: the CEFR level big, the language under it. Decorative duplicates (`label` is its accessible name). */
export function stamp(level: string, language: string, label: string): HTMLElement {
  return h('div', { class: 'pc-stamp', role: 'img', 'aria-label': label, testid: 'cefr-badge', 'data-level': level }, h('span', { class: 'pc-stamp-level', 'aria-hidden': 'true' }, level), h('span', { class: 'pc-stamp-lang', 'aria-hidden': 'true' }, language))
}

/** A small stamp-like chip for a scene card. */
export function levelChip(level: string): HTMLElement {
  return h('span', { class: 'pc-level', 'data-level': level }, level)
}

export interface PortraitInput {
  name: string
  /** The image url of the speaker's portrait asset, when the course has one. */
  url?: string
  /** The speaker's number: picks the colour of the initial disc. */
  index: number
}

/** The portrait slot: the course's image, else the speaker's initial on a coloured disc. Decorative: the name is next to it. */
export function portrait(p: PortraitInput): HTMLElement {
  if (p.url) return h('span', { class: 'pc-avatar has-image', 'aria-hidden': 'true' }, h('img', { src: p.url, alt: '' }))
  return h('span', { class: `pc-avatar pc-av-${(p.index % 6) + 1}`, 'aria-hidden': 'true' }, [...p.name][0] ?? '?')
}

export interface BubbleInput {
  /** Test id of the bubble element. */
  testid: string
  kind: 'say' | 'you' | 'help' | 'hud'
  speaker: PortraitInput
  /** The words, or null for a line that is only a sound (listen). */
  text: string | null
  /** The language of the words (the target language), for screen readers and hyphenation. */
  lang?: string
  /** A note under the words (the hint after a miss, "You could say"). */
  note?: string | null
  /** Said again, slowly. */
  slow?: boolean
  /** Extra controls (translate, play) drawn under the words. */
  actions?: (HTMLElement | null)[]
  /** What stands where the words are when the line is a sound only. */
  hidden?: string
  /** The line before the name ("Ana says it again, slowly:"). */
  lead?: string | null
  /** data-outcome of the learner's bubble. */
  outcome?: string
  extra?: HTMLElement | null
}

/** One speech bubble with its portrait. */
export function bubble(b: BubbleInput): HTMLElement {
  const body = h(
    'div',
    { class: 'pc-bubble' },
    h('p', { class: 'pc-name' }, b.speaker.name),
    b.lead ? h('p', { class: 'pc-lead' }, b.lead) : null,
    b.text !== null ? h('p', { class: 'pc-text', ...(b.lang ? { lang: b.lang } : {}) }, b.text) : h('p', { class: 'pc-text pc-hidden-text' }, b.hidden ?? '...'),
    b.note ? h('p', { class: 'pc-note' }, b.note) : null,
    b.extra ?? null,
    b.actions && b.actions.some(Boolean) ? h('div', { class: 'pc-actions' }, b.actions) : null
  )
  return h(
    'li',
    { class: `pc-line is-${b.kind}${b.slow ? ' is-slow' : ''}`, testid: b.testid, ...(b.outcome ? { 'data-outcome': b.outcome } : {}) },
    portrait(b.speaker),
    body
  )
}

/** A text button with the postcard's small-button look. */
export const smallButton = (testid: string, label: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement => button(testid, label, onClick, { class: 'btn btn-small btn-ghost', ...attrs })

// ---- the plants ----

const s = (tag: 'path' | 'ellipse' | 'circle' | 'g', attrs: Record<string, string | number>, ...kids: SVGElement[]): SVGElement => svg(tag, attrs, ...kids)

/** The pot every plant stands in: terracotta, with a rim and the soil. */
function pot(): SVGElement[] {
  return [
    s('path', { class: 'pc-pot', d: 'M34 110 L86 110 L79 136 Q78 138 76 138 L44 138 Q42 138 41 136 Z' }),
    s('path', { class: 'pc-pot-shade', d: 'M70 110 L86 110 L79 136 Q78 138 76 138 L62 138 Z' }),
    s('path', { class: 'pc-rim', d: 'M28 100 Q28 96 32 96 L88 96 Q92 96 92 100 L92 108 Q92 110 90 110 L30 110 Q28 110 28 108 Z' }),
    s('ellipse', { class: 'pc-soil', cx: 60, cy: 96, rx: 28, ry: 4.5 })
  ]
}

const leaf = (cls: string, d: string): SVGElement => s('path', { class: `pc-leaf ${cls}`, d })

/** One drawing per stage: a seed on the soil, a sprout, a bud, a bloom, a wilted plant that hangs its head. */
function plantParts(stage: Stage): SVGElement[] {
  switch (stage) {
    case 'seed':
      return [s('ellipse', { class: 'pc-seed', cx: 60, cy: 93, rx: 5, ry: 3.2, transform: 'rotate(-18 60 93)' }), s('circle', { class: 'pc-seed-dot', cx: 50, cy: 94, r: 1.4 }), s('circle', { class: 'pc-seed-dot', cx: 72, cy: 93.5, r: 1.2 })]
    case 'sprout':
      return [
        s('path', { class: 'pc-stem', d: 'M60 96 Q60 86 60 78' }),
        leaf('pc-l1', 'M60 80 Q47 80 43 69 Q56 66 60 80 Z'),
        leaf('pc-l2', 'M60 82 Q73 82 77 71 Q64 68 60 82 Z')
      ]
    case 'bud':
      return [
        s('path', { class: 'pc-stem', d: 'M60 96 Q58 76 60 52' }),
        leaf('pc-l1', 'M59 86 Q42 88 36 73 Q52 68 59 86 Z'),
        leaf('pc-l2', 'M60 74 Q77 74 83 59 Q67 55 60 74 Z'),
        s('ellipse', { class: 'pc-bud', cx: 60, cy: 46, rx: 8, ry: 11 }),
        s('path', { class: 'pc-sepal', d: 'M51 50 Q60 60 69 50 Q60 55 51 50 Z' })
      ]
    case 'bloom':
      return [
        s('path', { class: 'pc-stem', d: 'M60 96 Q58 74 60 46' }),
        leaf('pc-l1', 'M59 86 Q40 90 33 73 Q51 67 59 86 Z'),
        leaf('pc-l2', 'M60 72 Q80 72 87 55 Q69 51 60 72 Z'),
        s(
          'g',
          { class: 'pc-flower' },
          ...[0, 60, 120, 180, 240, 300].map((deg) => s('ellipse', { class: 'pc-petal', cx: 60, cy: 24, rx: 7.5, ry: 12, transform: `rotate(${deg} 60 38)` })),
          s('circle', { class: 'pc-centre', cx: 60, cy: 38, r: 7 })
        )
      ]
    case 'wilted':
      return [
        s('path', { class: 'pc-stem pc-stem-wilt', d: 'M60 96 Q60 74 62 64 Q66 54 80 60' }),
        leaf('pc-l1 pc-leaf-wilt', 'M60 88 Q44 94 34 90 Q42 80 60 88 Z'),
        leaf('pc-l2 pc-leaf-wilt', 'M61 76 Q78 84 86 94 Q70 96 61 76 Z'),
        s('ellipse', { class: 'pc-bud pc-bud-wilt', cx: 84, cy: 66, rx: 6, ry: 9, transform: 'rotate(-35 84 66)' })
      ]
  }
}

/** The potted plant of a growth stage, 120 x 140, decorative (`aria-hidden`: the stage is written next to it). */
export function plantSvg(stage: Stage): SVGElement {
  return svg('svg', { class: `pc-plant stage-${stage}`, viewBox: '0 0 120 142', 'aria-hidden': 'true', focusable: 'false' }, ...pot(), s('g', { class: 'pc-grow' }, ...plantParts(stage)))
}
