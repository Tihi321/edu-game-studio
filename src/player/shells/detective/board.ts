import { allCells, cellItems } from '../../../shared/puzzles'
import { markOf, type Marks, type Puzzle } from '../../../shared/shells/detective-case'
import { h, svg } from '../../dom'

/**
 * The cork board of a case: every entity of the puzzle is a card pinned in the column of its category, and every "yes" in the grid is a
 * red string between its two cards. Cards are plain HTML (real text, 13 px and up on a phone); the strings are an SVG laid under them and
 * measured from the cards' own boxes, so they follow the layout at any width. Decoration only: the grid is the control.
 */

export interface Cork {
  el: HTMLElement
  /** Draws the strings for the marks. */
  update(marks: Marks): void
  /** Stops watching the size (call when the screen is replaced). */
  dispose(): void
}

export function corkBoard(p: Puzzle, nameOf: (id: string) => string, labelOf: (category: string) => string, marks: Marks): Cork {
  const lines = svg('svg', { class: 'det-strings', 'aria-hidden': 'true', focusable: 'false' })
  const cards = new Map<string, HTMLElement>()
  const columns = p.categories.map((c) =>
    h(
      'div',
      { class: 'det-cork-col', 'data-category': c.key },
      h('h3', { class: 'det-cork-label' }, labelOf(c.key)),
      h(
        'ul',
        { class: 'det-cork-list' },
        c.items.map((id) => {
          const li = h('li', { class: 'det-pinned', 'data-entity': id, testid: `board-entity-${id}` }, h('span', { class: 'det-pin', 'aria-hidden': 'true' }), nameOf(id))
          cards.set(id, li)
          return li
        })
      )
    )
  )
  const el = h('div', { class: 'det-cork', testid: 'board' }, lines, h('div', { class: 'det-cork-cols' }, columns))
  let last = marks

  const draw = (): void => {
    while (lines.firstChild) lines.removeChild(lines.firstChild)
    const box = el.getBoundingClientRect()
    if (box.width === 0) return
    lines.setAttribute('viewBox', `0 0 ${Math.round(box.width)} ${Math.round(box.height)}`)
    for (const cell of allCells(p)) {
      if (markOf(last, cell) !== 'yes') continue
      const [a, b] = cellItems(cell)
      const ea = cards.get(a)
      const eb = cards.get(b)
      if (!ea || !eb) continue
      const ra = ea.getBoundingClientRect()
      const rb = eb.getBoundingClientRect()
      // from the right edge of the card in the left column to the left edge of the other (columns run in the order of the categories)
      const left = ra.left <= rb.left ? ra : rb
      const right = left === ra ? rb : ra
      const x1 = left.right - box.left
      const y1 = left.top + left.height / 2 - box.top
      const x2 = right.left - box.left
      const y2 = right.top + right.height / 2 - box.top
      const sag = Math.min(26, Math.abs(x2 - x1) * 0.12 + 6)
      const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${((x1 + x2) / 2).toFixed(1)} ${(((y1 + y2) / 2) + sag).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
      lines.appendChild(svg('path', { class: 'det-string', d, testid: `string-${a}-${b}` }))
    }
    for (const [id, card] of cards) {
      card.toggleAttribute('data-linked', allCells(p).some((c) => markOf(last, c) === 'yes' && cellItems(c).includes(id)))
    }
  }

  let frame = 0
  const schedule = (): void => {
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = 0
      draw()
    })
  }
  const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
  watcher?.observe(el)
  schedule()
  return {
    el,
    update(m) {
      last = m
      schedule()
    },
    dispose() {
      watcher?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }
}
