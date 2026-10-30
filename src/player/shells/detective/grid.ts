import { allCells, cellItems } from '../../../shared/puzzles'
import { gridTables, markOf, type Marks, type MarkValue, type Puzzle } from '../../../shared/shells/detective-case'
import { h } from '../../dom'

/**
 * The deduction grid of a case: a table per pair of categories (Murdle's and logic grids' own layout), every cell a real button
 * `cell-<a>-<b>` that cycles unknown, no, yes (and back). The table only draws what it is given; `update` repaints the marks in place, so
 * the focus stays on the cell that was pressed.
 */

export interface GridWords {
  /** The word for a mark ("unknown", "no", "yes"). */
  mark(m: MarkValue): string
  /** The accessible name of a cell: "Galileo and the telescope: no". */
  cell(a: string, b: string, state: string): string
  /** The caption of a table ("Suspect and Weapon"). */
  caption(rows: string, cols: string): string
}

export interface GridView {
  el: HTMLElement
  /** Repaints every cell from the marks, and marks the cell a hint is about. */
  update(marks: Marks, hinted?: string): void
}

const GLYPH: Record<MarkValue, string> = { '': '', no: '✕', yes: '✓' }

export function gridView(p: Puzzle, marks: Marks, nameOf: (id: string) => string, labelOf: (category: string) => string, words: GridWords, onPress: (cell: string) => void): GridView {
  const cells = new Map<string, HTMLButtonElement>()
  const paint = (key: string, m: Marks, hinted: string): void => {
    const btn = cells.get(key)
    if (!btn) return
    const [a, b] = cellItems(key)
    const v = markOf(m, key)
    btn.setAttribute('data-mark', v === '' ? 'blank' : v)
    btn.setAttribute('aria-label', words.cell(nameOf(a), nameOf(b), words.mark(v)))
    btn.toggleAttribute('data-hinted', key === hinted)
    const glyph = btn.querySelector('.det-glyph')
    if (glyph) glyph.textContent = GLYPH[v]
  }

  const tables = gridTables(p).map((t) =>
    h(
      'figure',
      { class: 'det-table-wrap' },
      h('figcaption', { class: 'det-table-cap' }, words.caption(labelOf(t.rows.key), labelOf(t.cols.key))),
      h(
        'table',
        { class: 'det-table', testid: `grid-${t.key}` },
        h('thead', {}, h('tr', {}, h('td', { class: 'det-corner' }), t.cols.items.map((c) => h('th', { scope: 'col', class: 'det-col' }, nameOf(c))))),
        h(
          'tbody',
          {},
          t.rows.items.map((r) =>
            h(
              'tr',
              {},
              h('th', { scope: 'row', class: 'det-row' }, nameOf(r)),
              t.cols.items.map((c) => {
                const key = `${r}|${c}`
                const btn = h('button', { type: 'button', class: 'det-cell', testid: `cell-${r}-${c}`, 'data-cell': key, onclick: () => onPress(key) }, h('span', { class: 'det-glyph', 'aria-hidden': 'true' }))
                cells.set(key, btn)
                return h('td', { class: 'det-td' }, btn)
              })
            )
          )
        )
      )
    )
  )
  const el = h('div', { class: 'det-grid', testid: 'grid' }, tables)
  const update = (m: Marks, hinted = ''): void => {
    for (const key of allCells(p)) paint(key, m, hinted)
  }
  update(marks)
  return { el, update }
}
