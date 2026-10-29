import type { CrosswordItem } from '../../shared/course'
import { clueNumbers, crosswordFor, foldDiacritics, type CrosswordEntry } from '../../shared/edu'
import { h } from '../dom'
import type { ItemRenderer } from '../types'
import { mark, submitButton } from './common'

/**
 * Crossword: the grid is generated from the item's words and seed (`crosswordFor`, the same code the lint checks). Type letters into
 * the cells (arrow keys move, Backspace goes back), or type a whole word into its own input in the clue list, which is the easy way on a
 * phone. `submit` (Check) answers `{ wordId: letters }`; letters are compared folded and upper case, so no special letters are needed.
 * Test ids: `cell-<row>-<col>` (0-based), `word-<wordId>` (the input of a clue), `clue-<wordId>`, `submit`.
 */

const BLANK = '_'
const key = (r: number, c: number): string => `${r},${c}`
const clean = (s: string): string => foldDiacritics(s).toUpperCase().replace(/[^A-Z0-9]/g, '')

export const crosswordRenderer: ItemRenderer = {
  kind: 'crossword',
  render(ctx) {
    const item = ctx.item as unknown as CrosswordItem
    const { grid } = crosswordFor(item, ctx.check)
    const clueOf = new Map(item.words.map((w) => [w.id, ctx.text.t(w.clue)]))
    const letters = new Map<string, string>()
    const inputs = new Map<string, HTMLInputElement>()
    const entriesAt = new Map<string, CrosswordEntry[]>()
    const cellsOf = (e: CrosswordEntry): [number, number][] => Array.from({ length: e.length }, (_, i) => [e.row + (e.dir === 'down' ? i : 0), e.col + (e.dir === 'across' ? i : 0)])
    for (const e of grid.entries) for (const [r, c] of cellsOf(e)) entriesAt.set(key(r, c), [...(entriesAt.get(key(r, c)) ?? []), e])
    let active: CrosswordEntry | undefined = grid.entries[0]
    let locked = false
    const wordInputs = new Map<string, HTMLInputElement>()

    const style = (): void => {
      const mine = new Set(active ? cellsOf(active).map(([r, c]) => key(r, c)) : [])
      for (const [k, input] of inputs) input.parentElement?.classList.toggle('is-active', mine.has(k))
      for (const [id, li] of clueItems) li.classList.toggle('is-active', id === active?.id)
    }
    const syncWords = (skip?: HTMLInputElement): void => {
      for (const e of grid.entries) {
        const input = wordInputs.get(e.id)
        if (!input || input === skip) continue
        input.value = cellsOf(e).map(([r, c]) => letters.get(key(r, c)) || BLANK).join('')
        if (input.value === BLANK.repeat(e.length)) input.value = ''
      }
      submit.disabled = locked || letters.size === 0
    }
    const setCell = (r: number, c: number, ch: string): void => {
      if (ch) letters.set(key(r, c), ch)
      else letters.delete(key(r, c))
      const input = inputs.get(key(r, c))
      if (input) input.value = ch
    }
    const focusCell = (r: number, c: number): boolean => {
      const input = inputs.get(key(r, c))
      if (!input) return false
      input.focus()
      input.select()
      return true
    }
    const choose = (r: number, c: number, toggle: boolean): void => {
      const here = entriesAt.get(key(r, c)) ?? []
      if (here.length === 0) return
      if (active && here.includes(active)) {
        if (toggle && here.length > 1) active = here.find((e) => e !== active) ?? active
      } else active = here[0]
      style()
    }
    const step = (r: number, c: number, delta: number): void => {
      const dir = active?.dir ?? 'across'
      focusCell(r + (dir === 'down' ? delta : 0), c + (dir === 'across' ? delta : 0))
    }

    // ---- the grid ----
    const gridEl = h('div', { class: 'cw-grid', role: 'group', 'aria-label': ctx.text.t(item.prompt), style: `--cols:${grid.width}` })
    for (let r = 0; r < grid.height; r++) {
      for (let c = 0; c < grid.width; c++) {
        const solution = grid.cells[r]?.[c]
        if (!solution) {
          gridEl.appendChild(h('span', { class: 'cw-black', 'aria-hidden': 'true' }))
          continue
        }
        const here = entriesAt.get(key(r, c)) ?? []
        const starts = grid.entries.filter((e) => e.row === r && e.col === c)
        const names = here.map((e) => `${e.number} ${ctx.ui(e.dir === 'across' ? 'cross.across' : 'cross.down')}`).join(', ')
        const input = h('input', {
          type: 'text',
          class: 'cw-input',
          maxlength: 2,
          autocomplete: 'off',
          autocapitalize: 'characters',
          autocorrect: 'off',
          spellcheck: 'false',
          testid: `cell-${r}-${c}`,
          'aria-label': `${ctx.ui('cross.cell', { r: r + 1, c: c + 1 })}, ${names}`
        })
        input.addEventListener('focus', () => choose(r, c, false))
        input.addEventListener('click', () => {
          if (document.activeElement === input) choose(r, c, true)
        })
        input.addEventListener('input', () => {
          if (locked) return
          // the newest character counts (a second keystroke replaces the first)
          const typed = clean(input.value.slice(-1) || input.value)
          setCell(r, c, typed.slice(-1))
          syncWords()
          if (typed) step(r, c, 1)
        })
        input.addEventListener('keydown', (e) => {
          const dir = active?.dir ?? 'across'
          const go = (dr: number, dc: number): void => {
            e.preventDefault()
            // skip black cells
            let rr = r + dr
            let cc = c + dc
            while (rr >= 0 && cc >= 0 && rr < grid.height && cc < grid.width && !grid.cells[rr]?.[cc]) {
              rr += dr
              cc += dc
            }
            focusCell(rr, cc)
          }
          if (e.key === 'ArrowRight') go(0, 1)
          else if (e.key === 'ArrowLeft') go(0, -1)
          else if (e.key === 'ArrowDown') go(1, 0)
          else if (e.key === 'ArrowUp') go(-1, 0)
          else if (e.key === 'Backspace' && !input.value && !locked) {
            e.preventDefault()
            step(r, c, -1)
            const prev = dir === 'down' ? [r - 1, c] : [r, c - 1]
            setCell(prev[0] as number, prev[1] as number, '')
            syncWords()
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (!submit.disabled) submit.click()
          }
        })
        inputs.set(key(r, c), input)
        gridEl.appendChild(h('span', { class: 'cw-cell' }, starts[0] ? h('span', { class: 'cw-num', 'aria-hidden': 'true' }, String(starts[0].number)) : null, input))
      }
    }

    // ---- the clues ----
    const clueItems = new Map<string, HTMLElement>()
    const { across, down } = clueNumbers(grid)
    const clueList = (entries: CrosswordEntry[], title: string): HTMLElement =>
      h(
        'section',
        { class: 'cw-clues' },
        h('h3', {}, title),
        h(
          'ol',
          {},
          entries.map((e) => {
            const input = h('input', {
              type: 'text',
              class: 'word-input',
              maxlength: e.length,
              autocomplete: 'off',
              autocapitalize: 'characters',
              autocorrect: 'off',
              spellcheck: 'false',
              testid: `word-${e.id}`,
              'aria-label': `${e.number} ${ctx.ui(e.dir === 'across' ? 'cross.across' : 'cross.down')}: ${clueOf.get(e.id) ?? ''} (${e.length})`
            })
            wordInputs.set(e.id, input)
            input.addEventListener('focus', () => {
              active = e
              style()
            })
            input.addEventListener('input', () => {
              if (locked) return
              const typed = Array.from(input.value.toUpperCase().slice(0, e.length))
              cellsOf(e).forEach(([r, c], i) => {
                const ch = typed[i] ? (typed[i] === BLANK || typed[i] === ' ' ? '' : clean(typed[i] as string).slice(0, 1)) : undefined
                if (ch !== undefined && (ch !== '' || !entriesAt.get(key(r, c))?.some((o) => o !== e))) setCell(r, c, ch)
              })
              syncWords(input)
            })
            input.addEventListener('keydown', (ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault()
                if (!submit.disabled) submit.click()
              }
            })
            const li = h(
              'li',
              { class: 'cw-clue', testid: `clue-${e.id}`, value: e.number },
              h('span', { class: 'cw-clue-text' }, h('b', {}, `${e.number}. `), clueOf.get(e.id) ?? '', ` (${e.length})`),
              input
            )
            clueItems.set(e.id, li)
            return li
          })
        )
      )

    const submit = submitButton(ctx, () => {
      if (locked) return
      locked = true
      ctx.submit(Object.fromEntries(grid.entries.map((e) => [e.id, cellsOf(e).map(([r, c]) => letters.get(key(r, c)) ?? '').join('')])))
    }, true)
    const el = h('div', { class: 'crossword' }, h('div', { class: 'cw-board' }, h('div', { class: 'cw-scroll' }, gridEl), h('div', { class: 'cw-side' }, clueList(across, ctx.ui('cross.across')), clueList(down, ctx.ui('cross.down')))), h('div', { class: 'actions' }, submit))
    style()
    return {
      el,
      focus: () => {
        // a phone keyboard that pops up by itself would hide the grid
        if (window.matchMedia('(pointer: coarse)').matches) return
        const e = grid.entries[0]
        if (e) focusCell(e.row, e.col)
      },
      reveal: (result) => {
        locked = true
        submit.disabled = true
        for (const [k, input] of inputs) {
          const [r, c] = k.split(',').map(Number) as [number, number]
          const solution = grid.cells[r]?.[c] ?? ''
          const had = letters.get(k)
          input.value = solution
          input.disabled = true
          const wrap = input.parentElement as HTMLElement
          wrap.classList.remove('is-active')
          wrap.classList.add(had === solution ? 'is-correct' : 'is-wrong')
        }
        for (const e of grid.entries) {
          const li = clueItems.get(e.id)
          const input = wordInputs.get(e.id)
          if (input) {
            input.disabled = true
            input.value = cellsOf(e).map(([r, c]) => grid.cells[r]?.[c] ?? '').join('')
          }
          if (li) mark(li, result.detail?.[e.id] === true, ctx)
        }
      }
    }
  }
}
