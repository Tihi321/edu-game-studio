import type { ClozeItem } from '../../shared/course'
import { button, h } from '../dom'
import type { ItemContext, ItemRenderer, ItemView } from '../types'
import { letterRow, mark, orderedOptions, submitButton, visuallyHidden } from './common'

/**
 * Typed answers. `typed`: one text input. `cloze`: the sentence with a gap where each `{{id}}` marker is; a gap with a word bank is a slot
 * you fill from the bank (click a word; click the slot to empty it), a gap without one is a text input. Test ids: `answer-input`, `gap-<gapId>`,
 * `bank-<gapId>-<wordKey>` (the key is the catalog key of the word), `letter-<char>`, `submit`.
 * Every answer is matched by the shared matcher (case, accents and one-letter typos per the course policy); this file only collects it.
 */

const inputAttrs = (ctx: ItemContext): Record<string, string> => ({
  type: 'text',
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false',
  lang: ctx.data.pack.targetLang ?? ctx.lang
})

export interface TypedBox {
  el: HTMLElement
  input: HTMLInputElement
}

/** A labelled text input with letter buttons and a Check button; calls `onSubmit(text)` on Enter or Check. Used by typed and listening-type. */
export function typedBox(ctx: ItemContext, onSubmit: (text: string) => void): TypedBox & { submit: HTMLButtonElement } {
  const input = h('input', { ...inputAttrs(ctx), class: 'text-input', testid: 'answer-input', 'aria-label': ctx.ui('answer.type'), placeholder: ctx.ui('answer.type') })
  const submit = submitButton(ctx, () => go(), true)
  const go = (): void => {
    const v = input.value.trim()
    if (v === '' || input.disabled) return
    onSubmit(v)
  }
  input.addEventListener('input', () => {
    submit.disabled = input.value.trim() === '' || input.disabled
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      go()
    }
  })
  const letters = letterRow(ctx, () => input)
  const el = h('div', { class: 'typed' }, h('div', { class: 'typed-row' }, input, submit), letters)
  return { el, input, submit }
}

export const typedRenderer: ItemRenderer = {
  kind: 'typed',
  render(ctx) {
    const box = typedBox(ctx, (text) => {
      ctx.submit(text)
    })
    return {
      el: box.el,
      focus: () => box.input.focus(),
      reveal: (result) => {
        box.input.disabled = true
        box.submit.disabled = true
        mark(box.el.querySelector('.typed-row') as HTMLElement, result.correct, ctx)
      }
    }
  }
}

interface GapEl {
  id: string
  /** the typed input or the bank slot */
  el: HTMLInputElement | HTMLButtonElement
  banked: boolean
  value: () => string
  wrap: HTMLElement
}

export const clozeRenderer: ItemRenderer = {
  kind: 'cloze',
  render(ctx) {
    const item = ctx.item as unknown as ClozeItem
    const gaps = new Map<string, GapEl>()
    const values = new Map<string, string>()
    const chips = new Map<string, HTMLButtonElement[]>()
    let locked = false
    let lastInput: HTMLInputElement | null = null

    const allFilled = (): boolean => item.gaps.every((g) => (values.get(g.id) ?? '').trim() !== '')
    const sync = (): void => {
      submit.disabled = locked || !allFilled()
    }
    const go = (): void => {
      if (locked || !allFilled()) return
      locked = true
      ctx.submit(Object.fromEntries(item.gaps.map((g) => [g.id, values.get(g.id) ?? ''])))
    }

    const makeGap = (g: ClozeItem['gaps'][number], n: number): GapEl => {
      const label = ctx.ui('gap.n', { n: n + 1 })
      if (g.bank) {
        const slot = button(`gap-${g.id}`, '', () => setBank(g.id, ''), { class: 'gap gap-slot', 'aria-label': label })
        slot.appendChild(h('span', { class: 'gap-text' }, ' '))
        return { id: g.id, el: slot, banked: true, value: () => values.get(g.id) ?? '', wrap: slot }
      }
      const canon = ctx.text.canonical(g.answer) ?? ''
      const input = h('input', { ...inputAttrs(ctx), class: 'gap gap-input', testid: `gap-${g.id}`, 'aria-label': label, size: Math.max(5, Math.min(22, canon.length + 2)) })
      input.addEventListener('input', () => {
        values.set(g.id, input.value)
        sync()
      })
      input.addEventListener('focus', () => (lastInput = input))
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        const next = item.gaps.slice(n + 1).map((x) => gaps.get(x.id)).find((x) => x && !x.banked && !(values.get(x.id) ?? '').trim())
        if (next) next.el.focus()
        else go()
      })
      return { id: g.id, el: input, banked: false, value: () => input.value, wrap: input }
    }
    const setBank = (gapId: string, word: string, chip?: HTMLButtonElement): void => {
      if (locked) return
      const gap = gaps.get(gapId)
      if (!gap) return
      values.set(gapId, word)
      const slotText = gap.el.querySelector('.gap-text')
      if (slotText) slotText.textContent = word === '' ? ' ' : word
      gap.el.classList.toggle('is-filled', word !== '')
      // the accessible name keeps the visible word in it (WCAG 2.5.3: label in name)
      const label = ctx.ui('gap.n', { n: item.gaps.findIndex((g) => g.id === gapId) + 1 })
      gap.el.setAttribute('aria-label', word === '' ? label : `${label}: ${word}`)
      for (const c of chips.get(gapId) ?? []) c.setAttribute('aria-pressed', String(c === chip))
      sync()
    }

    item.gaps.forEach((g, n) => gaps.set(g.id, makeGap(g, n)))

    // the sentence, split at the {{id}} markers
    const sentence = h('p', { class: 'cloze-text' })
    const raw = ctx.text.t(item.text)
    const parts = raw.split(/(\{\{[^}]+\}\})/)
    for (const part of parts) {
      const m = /^\{\{([^}]+)\}\}$/.exec(part)
      const gap = m ? gaps.get(m[1] as string) : undefined
      if (gap) sentence.appendChild(gap.wrap)
      else if (part) sentence.appendChild(document.createTextNode(part))
    }

    // one word bank per banked gap
    const banks = item.gaps.filter((g) => g.bank).length
    const bankRows = item.gaps.flatMap((g, n) => {
      if (!g.bank) return []
      const words = orderedOptions(ctx, g.bank, true)
      const row = words.map((key) => {
        const word = ctx.text.canonical(key) ?? ctx.text.t(key)
        const chip = button(`bank-${g.id}-${key}`, word, () => setBank(g.id, word, chip), { class: 'chip', 'aria-pressed': 'false' })
        return chip
      })
      chips.set(g.id, row)
      return [h('div', { class: 'bank', role: 'group', 'aria-label': ctx.ui('gap.n', { n: n + 1 }), testid: `bank-${g.id}` }, banks > 1 ? h('span', { class: 'bank-label' }, ctx.ui('gap.n', { n: n + 1 })) : null, row)]
    })

    const submit = submitButton(ctx, go, true)
    const hasTyped = item.gaps.some((g) => !g.bank)
    const letters = hasTyped ? letterRow(ctx, () => lastInput ?? (item.gaps.map((g) => gaps.get(g.id)).find((x) => x && !x.banked)?.el as HTMLInputElement | undefined) ?? null) : null
    const el = h('div', { class: 'cloze' }, sentence, bankRows, letters, h('div', { class: 'actions' }, submit))
    sync()

    const view: ItemView = {
      el,
      focus: () => {
        const first = item.gaps.map((g) => gaps.get(g.id)).find((x) => x && !x.banked)
        ;(first?.el ?? chips.get(item.gaps[0]?.id ?? '')?.[0])?.focus()
      },
      reveal: (result) => {
        locked = true
        submit.disabled = true
        const expected = (result.expected && typeof result.expected === 'object' ? result.expected : {}) as Record<string, string | null>
        for (const g of item.gaps) {
          const gap = gaps.get(g.id)
          if (!gap) continue
          const ok = result.detail?.[g.id] === true
          if (gap.banked) (gap.el as HTMLButtonElement).disabled = true
          else (gap.el as HTMLInputElement).disabled = true
          gap.el.classList.add(ok ? 'is-correct' : 'is-wrong')
          if (!ok) {
            const answer = expected[g.id]
            if (answer) gap.el.insertAdjacentElement('afterend', h('span', { class: 'gap-answer', testid: `gap-answer-${g.id}` }, answer))
          }
          gap.el.insertAdjacentElement('afterend', visuallyHidden(ok ? ctx.ui('verdict.correct') : ctx.ui('verdict.wrong')))
        }
        for (const list of chips.values()) for (const c of list) c.disabled = true
      }
    }
    return view
  }
}
