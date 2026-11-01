import type { CheckResult } from '../../shared/edu'
import { shuffledCopy } from '../../shared/edu'
import { encyclopediaSectionSchema, glossaryOf, paragraphsOf, passageOf } from '../../shared/shells/encyclopedia'
import { button, h } from '../dom'
import { glossify, readMarkup, glossParagraph, glossPopover, type GlossWord } from '../gloss'
import type { ItemContext, ItemRenderer } from '../types'

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

// ---- the text an item is about (EGS-35) ----

let passageCount = 0

/**
 * The "Read the text" panel of an item that names a text with `extensions.passage = { article, paragraphs? }`: a toggle (`passage-toggle`)
 * and the panel (`passage-panel`) with the article body or its paragraph range, glossed words tappable. Closed unless `open`. Null when the
 * item has no passage or the article does not exist.
 */
export function passagePanel(ctx: ItemContext, open: boolean): HTMLElement | null {
  const passage = passageOf(ctx.item)
  if (!passage) return null
  const pack = ctx.data.pack
  const article = pack.encyclopedia.articles.find((a) => a.id === passage.article)
  const body = article ? ctx.text.text(article.body) : undefined
  if (!article || body === undefined) return null
  const all = paragraphsOf([body])
  const [from, to] = passage.paragraphs ?? [1, all.length]
  const paragraphs = all.slice(from - 1, to)
  if (paragraphs.length === 0) return null

  const section = encyclopediaSectionSchema.safeParse(pack.shells?.config?.encyclopedia ?? {})
  const words: GlossWord[] = glossaryOf(section.success ? section.data : undefined, article.id).flatMap((e) => {
    const term = ctx.text.text(e.term)
    const gloss = ctx.text.text(e.gloss)
    if (term === undefined || gloss === undefined) return []
    const lemma = e.lemma ? ctx.text.text(e.lemma) : undefined
    const note = e.note ? ctx.text.text(e.note) : undefined
    return [{ id: e.id, term, gloss, ...(lemma ? { lemma } : {}), ...(e.pos ? { pos: e.pos } : {}), ...(note ? { note } : {}) }]
  })

  const id = `passage-${++passageCount}`
  const pop = glossPopover(ctx.ui)
  const marked = readMarkup(paragraphs.map((p) => [{ text: p }]))
  const segs = glossify(marked.map((m) => m.runs), words)
  const panel = h(
    'div',
    { class: 'passage-panel gloss-scope', id, role: 'region', 'aria-label': `${ctx.ui('passage.title')}: ${ctx.text.t(article.title)}`, testid: 'passage-panel', hidden: !open },
    h('p', { class: 'passage-title' }, ctx.text.t(article.title)),
    segs.map((s, i) => glossParagraph(s, pop, undefined, undefined, marked[i]?.heading)),
    pop.el
  )
  const toggle = button('passage-toggle', '', () => set(panel.hidden), { class: 'btn btn-small btn-ghost passage-toggle', 'aria-controls': id })
  function set(show: boolean): void {
    panel.hidden = !show
    toggle.textContent = `${show ? '▾' : '▸'} ${ctx.ui(show ? 'passage.hide' : 'passage.show')}`
    toggle.setAttribute('aria-expanded', String(show))
    if (!show) pop.hide()
  }
  set(open)
  return h('div', { class: 'passage', testid: 'passage', 'data-article': article.id }, toggle, panel)
}

/** The renderer of a kind with the passage panel above the item (when the item has a passage). Every shell gets it through `getItemRenderer`. */
export function withPassage(renderer: ItemRenderer): ItemRenderer {
  return {
    ...renderer,
    render(ctx) {
      const view = renderer.render(ctx)
      const panel = passagePanel(ctx, ctx.passageOpen === true)
      if (!panel) return view
      return {
        el: h('div', { class: 'with-passage' }, panel, view.el),
        focus: () => view.focus(),
        reveal: (result, answer) => view.reveal(result, answer),
        ...(view.key ? { key: (e: KeyboardEvent) => view.key?.(e) ?? false } : {}),
        destroy: () => view.destroy?.()
      }
    }
  }
}
