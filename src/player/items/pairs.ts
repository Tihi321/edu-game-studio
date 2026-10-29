import type { MatchPairsItem } from '../../shared/course'
import { shuffledCopy } from '../../shared/edu'
import { button, h } from '../dom'
import type { ItemRenderer } from '../types'
import { mark, submitButton, visuallyHidden } from './common'

/**
 * Match pairs: two columns of buttons. Pick one on the left and one on the right to pair them; pick a paired one again to undo. A pair
 * gets a number and a colour on both ends. Fully keyboard playable (Tab, Enter or Space). `submit` answers once every pair is made.
 * Test ids: `pair-left-<pairId>`, `pair-right-<pairId>` (the id of the pair the right text belongs to), `submit`.
 */
export const matchPairsRenderer: ItemRenderer = {
  kind: 'match-pairs',
  render(ctx) {
    const item = ctx.item as unknown as MatchPairsItem
    const rights = shuffledCopy(item.pairs.map((p) => p.id), ctx.rng)
    /** leftId -> rightId */
    const made = new Map<string, string>()
    /** pair numbers in the order made, so numbers stay stable while others change */
    const numbers = new Map<string, number>()
    let selLeft: string | null = null
    let selRight: string | null = null
    let locked = false
    const left = new Map<string, HTMLButtonElement>()
    const right = new Map<string, HTMLButtonElement>()

    const free = (): number => {
      const used = new Set(numbers.values())
      for (let n = 1; n <= item.pairs.length; n++) if (!used.has(n)) return n
      return item.pairs.length + 1
    }
    const rightOwner = (rightId: string): string | undefined => [...made].find(([, r]) => r === rightId)?.[0]

    const paint = (): void => {
      for (const [id, b] of left) paintOne(b, id, made.get(id) !== undefined, selLeft === id)
      for (const [id, b] of right) paintOne(b, id, rightOwner(id) !== undefined, selRight === id)
      submit.disabled = locked || made.size !== item.pairs.length
    }
    const paintOne = (b: HTMLButtonElement, id: string, paired: boolean, selected: boolean): void => {
      const isLeft = left.get(id) === b
      const owner = isLeft ? id : rightOwner(id)
      const n = owner ? numbers.get(owner) : undefined
      b.setAttribute('aria-pressed', String(selected))
      b.classList.toggle('is-paired', paired)
      for (const c of Array.from(b.classList)) if (c.startsWith('pair-c')) b.classList.remove(c)
      if (paired && n) b.classList.add(`pair-c${((n - 1) % 8) + 1}`)
      const badge = b.querySelector('.pair-n')
      if (badge) badge.textContent = paired && n ? String(n) : ''
      const sr = b.querySelector('.sr-only')
      if (sr) sr.textContent = paired && n ? ` (${n})` : ''
    }
    const unpairLeft = (l: string): void => {
      made.delete(l)
      numbers.delete(l)
    }
    const tryPair = (): void => {
      if (selLeft && selRight) {
        const prev = rightOwner(selRight)
        if (prev) unpairLeft(prev)
        unpairLeft(selLeft)
        made.set(selLeft, selRight)
        numbers.set(selLeft, free())
        selLeft = null
        selRight = null
      }
    }
    const clickLeft = (id: string): void => {
      if (locked) return
      if (made.has(id)) unpairLeft(id)
      else selLeft = selLeft === id ? null : id
      tryPair()
      paint()
    }
    const clickRight = (id: string): void => {
      if (locked) return
      const owner = rightOwner(id)
      if (owner) unpairLeft(owner)
      else selRight = selRight === id ? null : id
      tryPair()
      paint()
    }
    const cell = (testid: string, text: string, onClick: () => void): HTMLButtonElement =>
      button(testid, [h('span', { class: 'pair-n', 'aria-hidden': 'true' }), h('span', { class: 'pair-text' }, text), visuallyHidden('')], onClick, { class: 'pair-btn', 'aria-pressed': 'false' })

    for (const p of item.pairs) left.set(p.id, cell(`pair-left-${p.id}`, ctx.text.t(p.left), () => clickLeft(p.id)))
    for (const id of rights) {
      const p = item.pairs.find((x) => x.id === id)
      if (p) right.set(id, cell(`pair-right-${id}`, ctx.text.t(p.right), () => clickRight(id)))
    }
    const submit = submitButton(ctx, () => {
      if (locked || made.size !== item.pairs.length) return
      locked = true
      ctx.submit(Object.fromEntries(made))
    }, true)

    const el = h(
      'div',
      { class: 'pairs' },
      h('p', { class: 'hint-line' }, ctx.ui('pairs.pick')),
      h('div', { class: 'pairs-cols' }, h('div', { class: 'pairs-col', role: 'group' }, [...left.values()]), h('div', { class: 'pairs-col', role: 'group' }, [...right.values()])),
      h('div', { class: 'actions' }, submit)
    )
    paint()
    return {
      el,
      focus: () => [...left.values()][0]?.focus(),
      reveal: (result) => {
        locked = true
        submit.disabled = true
        for (const p of item.pairs) {
          const ok = result.detail?.[p.id] === true
          const l = left.get(p.id)
          const r = made.get(p.id) ? right.get(made.get(p.id) as string) : undefined
          for (const b of [l, r]) {
            if (!b) continue
            b.disabled = true
            mark(b, ok, ctx)
          }
        }
      }
    }
  }
}
