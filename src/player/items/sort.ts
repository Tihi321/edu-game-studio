import type { SortGroupsItem } from '../../shared/course'
import { shuffledCopy } from '../../shared/edu'
import { button, h } from '../dom'
import type { ItemRenderer } from '../types'
import { mark, submitButton } from './common'

/**
 * Sort into groups: each card has one button per group; press it to put the card there (press again to take it back). `submit` answers
 * once every card is placed. After the answer a wrongly placed card shows the group it belongs to.
 * Test ids: `group-<groupId>-<itemId>` (aria-pressed), `sort-card-<itemId>`, `submit`.
 */
export const sortGroupsRenderer: ItemRenderer = {
  kind: 'sort-groups',
  render(ctx) {
    const item = ctx.item as unknown as SortGroupsItem
    const cards = shuffledCopy(item.items.map((i) => i.id), ctx.rng)
    const byId = new Map(item.items.map((i) => [i.id, i]))
    const placed = new Map<string, string>()
    const buttons = new Map<string, HTMLButtonElement>()
    let locked = false
    const groupIndex = (gid: string): number => item.groups.findIndex((g) => g.id === gid) + 1

    const paint = (): void => {
      for (const [key, b] of buttons) {
        const [gid, iid] = key.split('\u0000') as [string, string]
        b.setAttribute('aria-pressed', String(placed.get(iid) === gid))
      }
      for (const id of cards) rows.get(id)?.setAttribute('data-group', String(placed.has(id) ? groupIndex(placed.get(id) as string) : 0))
      submit.disabled = locked || placed.size !== item.items.length
    }
    const rows = new Map<string, HTMLElement>()
    for (const id of cards) {
      const x = byId.get(id)
      if (!x) continue
      const text = ctx.text.t(x.text)
      const pills = item.groups.map((g) => {
        const b = button(`group-${g.id}-${id}`, ctx.text.t(g.title), () => {
          if (locked) return
          if (placed.get(id) === g.id) placed.delete(id)
          else placed.set(id, g.id)
          paint()
        }, { class: `pill pill-g${groupIndex(g.id)}`, 'aria-pressed': 'false', 'aria-label': ctx.ui('sort.assign', { item: text, group: ctx.text.t(g.title) }) })
        buttons.set(`${g.id}\u0000${id}`, b)
        return b
      })
      rows.set(id, h('li', { class: 'sort-card', testid: `sort-card-${id}`, 'data-group': '0' }, h('span', { class: 'sort-text' }, text), h('span', { class: 'sort-pills', role: 'group', 'aria-label': text }, pills)))
    }
    const submit = submitButton(ctx, () => {
      if (locked || placed.size !== item.items.length) return
      locked = true
      ctx.submit(Object.fromEntries(placed))
    }, true)
    const el = h('div', { class: 'sort' }, h('ul', { class: 'sort-list' }, [...rows.values()]), h('div', { class: 'actions' }, submit))
    paint()
    return {
      el,
      focus: () => [...buttons.values()][0]?.focus(),
      reveal: (result) => {
        locked = true
        submit.disabled = true
        for (const b of buttons.values()) b.disabled = true
        for (const x of item.items) {
          const row = rows.get(x.id)
          if (!row) continue
          const ok = result.detail?.[x.id] === true
          mark(row, ok, ctx)
          if (!ok) {
            const g = item.groups.find((gr) => gr.id === x.group)
            row.appendChild(h('span', { class: 'sort-should' }, `→ ${ctx.text.t(g?.title ?? x.group)}`))
          }
        }
      }
    }
  }
}
