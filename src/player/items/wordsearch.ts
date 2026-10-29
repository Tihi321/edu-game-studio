import type { WordSearchItem } from '../../shared/course'
import { wordSearchFor, wordsFound, type Selection } from '../../shared/edu'
import { h } from '../dom'
import type { ItemRenderer } from '../types'
import { submitButton, visuallyHidden } from './common'

/**
 * Word search: pick the first letter of a word and then its last letter (a straight line, any direction the puzzle uses). A line that
 * spells a word stays marked and the word is ticked off in the list; any other line is dropped. When every word is found the answer is
 * sent on its own; `Done` sends what was found so far. The grid is one tab stop: arrow keys move, Enter or Space picks.
 * Test ids: `cell-<row>-<col>` (0-based), `ws-word-<wordId>`, `ws-count`, `submit`.
 */

export const wordSearchRenderer: ItemRenderer = {
  kind: 'word-search',
  render(ctx) {
    const item = ctx.item as unknown as WordSearchItem
    const { grid, words } = wordSearchFor(ctx.item as unknown as WordSearchItem, ctx.check)
    const selections: Selection[] = []
    const foundIds = new Set<string>()
    const cells: HTMLButtonElement[][] = []
    let first: [number, number] | null = null
    let cursor: [number, number] = [0, 0]
    let locked = false

    const cellAt = (r: number, c: number): HTMLButtonElement | undefined => cells[r]?.[c]
    const line = (sel: Selection): [number, number][] => {
      const [r0, c0] = sel.start
      const [r1, c1] = sel.end
      const dr = Math.sign(r1 - r0)
      const dc = Math.sign(c1 - c0)
      const n = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0)) + 1
      return Array.from({ length: n }, (_, i) => [r0 + dr * i, c0 + dc * i])
    }
    const setCursor = (r: number, c: number, focus: boolean): void => {
      const next = cellAt(r, c)
      if (!next) return
      cellAt(...cursor)?.setAttribute('tabindex', '-1')
      cursor = [r, c]
      next.setAttribute('tabindex', '0')
      if (focus) next.focus()
    }
    const renderMarks = (): void => {
      for (const row of cells) for (const b of row) b.classList.remove('is-first')
      if (first) cellAt(...first)?.classList.add('is-first')
      for (const row of cells) for (const b of row) b.setAttribute('aria-pressed', 'false')
      if (first) cellAt(...first)?.setAttribute('aria-pressed', 'true')
    }
    const finish = (): void => {
      if (locked) return
      locked = true
      ctx.submit([...selections])
    }
    const pick = (r: number, c: number): void => {
      if (locked) return
      if (!first) {
        first = [r, c]
        renderMarks()
        return
      }
      if (first[0] === r && first[1] === c) {
        first = null
        renderMarks()
        return
      }
      const sel: Selection = { start: first, end: [r, c] }
      first = null
      const ids = wordsFound(grid, words, [sel]).filter((id) => !foundIds.has(id))
      renderMarks()
      if (ids.length === 0) {
        for (const [rr, cc] of line(sel)) cellAt(rr, cc)?.classList.add('is-miss')
        window.setTimeout(() => {
          for (const row of cells) for (const b of row) b.classList.remove('is-miss')
        }, 450)
        return
      }
      selections.push(sel)
      const n = foundIds.size
      ids.forEach((id) => foundIds.add(id))
      line(sel).forEach(([rr, cc]) => {
        const b = cellAt(rr, cc)
        if (!b) return
        b.classList.add('is-found', `found-c${(n % 6) + 1}`)
      })
      for (const id of ids) {
        const li = list.get(id)
        if (li) {
          li.classList.add('is-found')
          li.appendChild(h('span', { class: 'mark', 'aria-hidden': 'true' }, '✓'))
          li.appendChild(visuallyHidden(ctx.ui('verdict.correct')))
        }
      }
      count.textContent = ctx.ui('ws.found', { n: foundIds.size, total: item.words.length })
      if (foundIds.size === item.words.length) finish()
    }

    const gridEl = h('div', { class: 'ws-grid', role: 'group', 'aria-label': ctx.text.t(item.prompt), style: `--cols:${grid.size}` })
    for (let r = 0; r < grid.size; r++) {
      const row: HTMLButtonElement[] = []
      const rowEl = h('div', { class: 'ws-row' })
      for (let c = 0; c < grid.size; c++) {
        const b = h(
          'button',
          {
            type: 'button',
            class: 'ws-cell',
            testid: `cell-${r}-${c}`,
            tabindex: r === 0 && c === 0 ? '0' : '-1',
            'aria-pressed': 'false',
            'aria-label': `${grid.cells[r]?.[c] ?? ''}, ${ctx.ui('cross.cell', { r: r + 1, c: c + 1 })}`
          },
          grid.cells[r]?.[c] ?? ''
        )
        b.addEventListener('click', () => {
          setCursor(r, c, false)
          pick(r, c)
        })
        b.addEventListener('keydown', (e) => {
          const d: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }
          const delta = d[e.key]
          if (!delta) return
          e.preventDefault()
          setCursor(Math.min(grid.size - 1, Math.max(0, r + delta[0])), Math.min(grid.size - 1, Math.max(0, c + delta[1])), true)
        })
        row.push(b)
        rowEl.appendChild(b)
      }
      cells.push(row)
      gridEl.appendChild(rowEl)
    }

    const list = new Map<string, HTMLElement>()
    const wordList = h(
      'ul',
      { class: 'ws-words' },
      item.words.map((w) => {
        const li = h('li', { class: 'ws-word', testid: `ws-word-${w.id}` }, ctx.text.canonical(w.answer) ?? w.id)
        list.set(w.id, li)
        return li
      })
    )
    const count = h('p', { class: 'ws-count', role: 'status', testid: 'ws-count' }, ctx.ui('ws.found', { n: 0, total: item.words.length }))
    const submit = submitButton(ctx, finish)
    submit.textContent = ctx.ui('ws.done')
    const el = h('div', { class: 'wordsearch' }, h('p', { class: 'hint-line' }, ctx.ui('ws.pick')), h('div', { class: 'ws-board' }, h('div', { class: 'ws-scroll' }, gridEl), h('div', { class: 'ws-side' }, count, wordList)), h('div', { class: 'actions' }, submit))
    return {
      el,
      focus: () => cellAt(...cursor)?.focus(),
      reveal: () => {
        locked = true
        submit.disabled = true
        for (const row of cells) for (const b of row) b.disabled = true
        for (const p of grid.placements) {
          if (foundIds.has(p.id)) continue
          const n = p.answer.length
          for (let i = 0; i < n; i++) cellAt(p.row + p.dr * i, p.col + p.dc * i)?.classList.add('is-missed')
        }
        for (const w of item.words) if (!foundIds.has(w.id)) list.get(w.id)?.classList.add('is-missed')
      }
    }
  }
}
