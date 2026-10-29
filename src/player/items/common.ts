import type { CheckResult } from '../../shared/edu'
import { shuffledCopy } from '../../shared/edu'
import { button, h } from '../dom'
import type { ItemContext } from '../types'

/** The options in the order shown: shuffled with the seeded generator when the item allows (`shuffle` is not false). */
export function orderedOptions<T>(ctx: ItemContext, options: readonly T[], shuffle: boolean | undefined): T[] {
  return shuffle === false ? [...options] : shuffledCopy(options, ctx.rng)
}

export const visuallyHidden = (text: string): HTMLSpanElement => h('span', { class: 'sr-only' }, text)

/** The `Check` button (data-testid `submit`). */
export function submitButton(ctx: ItemContext, onClick: () => void, disabled = false): HTMLButtonElement {
  return button('submit', ctx.ui('submit'), onClick, { class: 'btn btn-primary', ...(disabled ? { disabled: true } : {}) })
}

/** Marks an element right or wrong with a symbol as well as a colour (never colour alone). */
export function mark(el: HTMLElement, ok: boolean, ctx: ItemContext): void {
  el.classList.add(ok ? 'is-correct' : 'is-wrong')
  const old = el.querySelector('.mark')
  if (old) old.remove()
  el.appendChild(h('span', { class: 'mark', 'aria-hidden': 'true' }, ok ? '✓' : '✗'))
  el.appendChild(visuallyHidden(ok ? ctx.ui('verdict.correct') : ctx.ui('verdict.wrong')))
}

/** Special-letter buttons that type into the last focused text input (Croatian: č ć š ž đ). Null when the language has none. */
export function letterRow(ctx: ItemContext, getTarget: () => HTMLInputElement | null): HTMLElement | null {
  if (ctx.specialLetters.length === 0) return null
  return h(
    'div',
    { class: 'letters', role: 'group', 'aria-label': ctx.ui('letters'), testid: 'letters' },
    ctx.specialLetters.map((ch) =>
      h(
        'button',
        {
          type: 'button',
          class: 'letter',
          testid: `letter-${ch}`,
          // keep the focus where the learner was typing
          onmousedown: (e: Event) => e.preventDefault(),
          onclick: () => {
            const input = getTarget()
            if (!input) return
            const a = input.selectionStart ?? input.value.length
            const b = input.selectionEnd ?? a
            input.value = input.value.slice(0, a) + ch + input.value.slice(b)
            input.setSelectionRange(a + ch.length, a + ch.length)
            input.focus()
            input.dispatchEvent(new Event('input', { bubbles: true }))
          }
        },
        ch
      )
    )
  )
}

/** The picture of an item (an `asset` that is an image), or null. */
export function itemImage(ctx: ItemContext): HTMLElement | null {
  const id = ctx.item.asset
  if (!id) return null
  const asset = ctx.data.pack.assets.find((a) => a.id === id)
  const url = ctx.assetUrl(id)
  if (!asset || asset.kind !== 'image' || !url) return null
  return h('figure', { class: 'item-figure' }, h('img', { src: url, alt: ctx.assetAlt(id), testid: 'item-image', loading: 'eager' }))
}

export type Revealer = (result: CheckResult, answer: unknown) => void
