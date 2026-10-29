import type { OrderItem } from '../../shared/course'
import { presentedOrder } from '../../shared/edu'
import { button, h } from '../dom'
import type { ItemRenderer } from '../types'
import { mark, submitButton } from './common'

/**
 * Order / timeline: rows with Move up and Move down buttons (and drag and drop where the pointer allows it). `submit` answers with the
 * ids in the learner's order. The first order shown is a seeded shuffle that is never the right one. After the answer the rows show
 * their right and wrong places, and a timeline shows each item's date or label.
 * Test ids: `order-row-<id>`, `order-up-<id>`, `order-down-<id>`, `submit`.
 */
export const orderRenderer: ItemRenderer = {
  kind: 'order',
  render(ctx) {
    const item = ctx.item as unknown as OrderItem
    const byId = new Map(item.items.map((x) => [x.id, x]))
    let order = presentedOrder(item, ctx.seed)
    let locked = false
    let dragFrom = -1
    const list = h('ol', { class: 'order-list', 'aria-label': ctx.text.t(item.prompt), testid: 'order-list' })

    const move = (from: number, to: number, focusId?: string, focusDir?: 'up' | 'down'): void => {
      if (locked || to < 0 || to >= order.length || from === to) return
      const next = [...order]
      const [x] = next.splice(from, 1)
      next.splice(to, 0, x as string)
      order = next
      draw()
      if (focusId) {
        const b = list.querySelector<HTMLButtonElement>(`[data-testid="order-${focusDir}-${focusId}"]`)
        ;(b && !b.disabled ? b : list.querySelector<HTMLButtonElement>(`[data-testid="order-${focusDir === 'up' ? 'down' : 'up'}-${focusId}"]`))?.focus()
      }
    }

    const draw = (): void => {
      list.replaceChildren(
        ...order.map((id, i) => {
          const x = byId.get(id)
          const text = ctx.text.t(x?.text ?? id)
          const row = h(
            'li',
            { class: 'order-row', testid: `order-row-${id}`, draggable: locked ? 'false' : 'true' },
            h('span', { class: 'order-n', 'aria-hidden': 'true' }, String(i + 1)),
            h('span', { class: 'order-text' }, text),
            h(
              'span',
              { class: 'order-btns' },
              button(`order-up-${id}`, '▲', () => move(i, i - 1, id, 'up'), { class: 'icon-btn', 'aria-label': ctx.ui('order.up', { item: text }), ...(locked || i === 0 ? { disabled: true } : {}) }),
              button(`order-down-${id}`, '▼', () => move(i, i + 1, id, 'down'), { class: 'icon-btn', 'aria-label': ctx.ui('order.down', { item: text }), ...(locked || i === order.length - 1 ? { disabled: true } : {}) })
            )
          )
          row.addEventListener('dragstart', (e) => {
            dragFrom = i
            row.classList.add('is-dragging')
            e.dataTransfer?.setData('text/plain', id)
          })
          row.addEventListener('dragend', () => row.classList.remove('is-dragging'))
          row.addEventListener('dragover', (e) => {
            if (!locked && dragFrom >= 0) e.preventDefault()
          })
          row.addEventListener('drop', (e) => {
            e.preventDefault()
            const from = dragFrom
            dragFrom = -1
            move(from, i)
          })
          return row
        })
      )
    }
    draw()

    const submit = submitButton(ctx, () => {
      if (locked) return
      locked = true
      ctx.submit([...order])
    })
    const ends = item.timeline
    const el = h(
      'div',
      { class: 'order' },
      ends ? h('p', { class: 'order-end' }, `▲ ${ctx.ui('order.first')}`) : null,
      list,
      ends ? h('p', { class: 'order-end' }, `▼ ${ctx.ui('order.last')}`) : null,
      h('div', { class: 'actions' }, submit)
    )
    return {
      el,
      focus: () => list.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus(),
      reveal: (result) => {
        locked = true
        submit.disabled = true
        draw()
        const rows = list.querySelectorAll<HTMLElement>('.order-row')
        rows.forEach((row, i) => {
          const id = order[i] as string
          row.setAttribute('draggable', 'false')
          const ok = result.detail?.[id] === true
          mark(row, ok, ctx)
          const when = byId.get(id)?.when
          if (when) row.appendChild(h('span', { class: 'order-when' }, ctx.text.t(when)))
          row.appendChild(h('span', { class: 'order-should' }, ok ? '' : `→ ${item.items.findIndex((x) => x.id === id) + 1}`))
        })
      }
    }
  }
}
