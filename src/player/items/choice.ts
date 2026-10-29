import type { ChoiceOption, McqItem, MultiSelectItem, TrueFalseItem } from '../../shared/course'
import { button, digitIndex, h } from '../dom'
import type { ItemContext, ItemRenderer, ItemView } from '../types'
import { mark, orderedOptions, submitButton } from './common'

/**
 * Choice items. A single-choice item answers on the click or tap (or the number key 1-9); a multi-select toggles options (aria-pressed)
 * and answers on `Check`. Right and wrong options get a symbol and a colour. Test ids: `option-<optionId>` (true-false: `option-true`,
 * `option-false`), `submit`.
 */

interface Opt {
  id: string
  text: string
}

export interface ChoiceHandle extends ItemView {
  buttons: Map<string, HTMLButtonElement>
}

/** One-click choice list; used by mcq, true-false and listening-choose. `correct` is the id of the right option. */
export function singleChoice(ctx: ItemContext, options: Opt[], correct: string, toAnswer: (id: string) => unknown = (id) => id): ChoiceHandle {
  const buttons = new Map<string, HTMLButtonElement>()
  let locked = false
  const pick = (id: string): void => {
    if (locked) return
    locked = true
    ctx.submit(toAnswer(id))
  }
  options.forEach((o, n) => {
    buttons.set(
      o.id,
      button(
        `option-${o.id}`,
        [h('span', { class: 'choice-key', 'aria-hidden': 'true' }, n < 9 ? String(n + 1) : ''), h('span', { class: 'choice-text' }, o.text)],
        () => pick(o.id),
        { class: 'choice', 'data-option': o.id }
      )
    )
  })
  const el = h('div', { class: 'choices', role: 'group', 'aria-label': ctx.text.t(ctx.item.prompt) }, [...buttons.values()])
  return {
    el,
    buttons,
    focus: () => [...buttons.values()][0]?.focus(),
    key: (e) => {
      const i = digitIndex(e)
      const o = options[i]
      if (i < 0 || !o) return false
      e.preventDefault()
      pick(o.id)
      return true
    },
    reveal: (_result, answer) => {
      locked = true
      for (const [id, b] of buttons) {
        b.disabled = true
        if (id === correct) mark(b, true, ctx)
        else if (id === String(answer)) mark(b, false, ctx)
      }
    }
  }
}

export const mcqRenderer: ItemRenderer = {
  kind: 'mcq',
  render(ctx) {
    const item = ctx.item as unknown as McqItem
    const opts = orderedOptions<ChoiceOption>(ctx, item.options, item.shuffle).map((o) => ({ id: o.id, text: ctx.text.t(o.text) }))
    return singleChoice(ctx, opts, item.answer)
  }
}

export const trueFalseRenderer: ItemRenderer = {
  kind: 'true-false',
  render(ctx) {
    const item = ctx.item as unknown as TrueFalseItem
    return singleChoice(
      ctx,
      [
        { id: 'true', text: ctx.ui('fb.true') },
        { id: 'false', text: ctx.ui('fb.false') }
      ],
      String(item.answer),
      (id) => id === 'true'
    )
  }
}

export const multiSelectRenderer: ItemRenderer = {
  kind: 'multi-select',
  render(ctx) {
    const item = ctx.item as unknown as MultiSelectItem
    const opts = orderedOptions<ChoiceOption>(ctx, item.options, item.shuffle)
    const picked = new Set<string>()
    const buttons = new Map<string, HTMLButtonElement>()
    let locked = false
    const sync = (): void => {
      for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(picked.has(id)))
      submit.disabled = picked.size === 0 || locked
    }
    const toggle = (id: string): void => {
      if (locked) return
      if (picked.has(id)) picked.delete(id)
      else picked.add(id)
      sync()
    }
    opts.forEach((o, n) => {
      buttons.set(
        o.id,
        button(
          `option-${o.id}`,
          [h('span', { class: 'choice-key', 'aria-hidden': 'true' }, n < 9 ? String(n + 1) : ''), h('span', { class: 'choice-box', 'aria-hidden': 'true' }), h('span', { class: 'choice-text' }, ctx.text.t(o.text))],
          () => toggle(o.id),
          { class: 'choice choice-multi', 'aria-pressed': 'false' }
        )
      )
    })
    const submit = submitButton(ctx, () => {
      if (locked || picked.size === 0) return
      locked = true
      ctx.submit([...picked])
    }, true)
    const el = h(
      'div',
      { class: 'multi' },
      h('p', { class: 'hint-line' }, ctx.ui('multi.hint')),
      h('div', { class: 'choices', role: 'group', 'aria-label': ctx.text.t(item.prompt) }, [...buttons.values()]),
      h('div', { class: 'actions' }, submit)
    )
    sync()
    return {
      el,
      focus: () => [...buttons.values()][0]?.focus(),
      key: (e) => {
        const i = digitIndex(e)
        const o = opts[i]
        if (i < 0 || !o) return false
        e.preventDefault()
        toggle(o.id)
        return true
      },
      reveal: (result) => {
        locked = true
        submit.disabled = true
        const right = new Set(Array.isArray(result.expected) ? (result.expected as string[]) : item.answers)
        for (const [id, b] of buttons) {
          b.disabled = true
          const isRight = right.has(id)
          if (picked.has(id)) mark(b, isRight, ctx)
          else if (isRight) {
            b.classList.add('is-missed')
            b.appendChild(h('span', { class: 'mark', 'aria-hidden': 'true' }, '!'))
          }
        }
      }
    }
  }
}
