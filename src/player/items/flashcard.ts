import type { FlashcardItem } from '../../shared/course'
import { GRADES, type Grade } from '../../shared/edu'
import { button, digitIndex, h } from '../dom'
import type { ItemRenderer } from '../types'

/**
 * Flashcard: the prompt is the front. Flip it (click, Enter, Space), then grade yourself Again, Hard, Good or Easy (keys 1 to 4); the
 * grade is the answer and feeds the spaced-repetition card of the item.
 * Test ids: `flip`, `grade-again`, `grade-hard`, `grade-good`, `grade-easy`, `flash-front`, `flash-back`.
 */
export const flashcardRenderer: ItemRenderer = {
  kind: 'flashcard',
  ownsPrompt: true,
  render(ctx) {
    const item = ctx.item as unknown as FlashcardItem
    let flipped = false
    let locked = false
    const frontImg = ctx.item.asset && ctx.assetUrl(ctx.item.asset) ? h('img', { class: 'flash-img', src: ctx.assetUrl(ctx.item.asset) as string, alt: ctx.assetAlt(ctx.item.asset) }) : null
    const backImg = item.backAsset && ctx.assetUrl(item.backAsset) ? h('img', { class: 'flash-img', src: ctx.assetUrl(item.backAsset) as string, alt: ctx.assetAlt(item.backAsset) }) : null
    const front = h('span', { class: 'flash-face flash-front', testid: 'flash-front' }, h('span', { class: 'flash-text' }, ctx.text.t(item.prompt)), frontImg)
    const back = h('span', { class: 'flash-face flash-back', testid: 'flash-back', 'aria-hidden': 'true' }, h('span', { class: 'flash-text' }, ctx.text.t(item.back)), backImg)
    // the name of the card is its visible text (the face that is not hidden) plus the instruction; no aria-label that differs from what is seen
    const flipHint = h('span', { class: 'sr-only' }, ` — ${ctx.ui('flip')}`)
    const card = button('flip', [h('span', { class: 'flash-inner' }, front, back), flipHint], () => flip(), { class: 'flash-card' })
    const grades = new Map<Grade, HTMLButtonElement>()
    for (const g of GRADES) {
      grades.set(g, button(`grade-${g}`, [h('span', { class: 'grade-key', 'aria-hidden': 'true' }, String(GRADES.indexOf(g) + 1)), ctx.ui(`grade.${g}` as 'grade.again')], () => grade(g), { class: `btn grade grade-${g}` }))
    }
    const gradeRow = h('div', { class: 'grades', hidden: true, role: 'group', 'aria-label': ctx.ui('grade.ask') }, [...grades.values()])
    const hint = h('p', { class: 'hint-line' }, ctx.ui('flip'))

    function flip(): void {
      if (locked || flipped) return
      flipped = true
      card.classList.add('is-flipped')
      front.setAttribute('aria-hidden', 'true')
      back.removeAttribute('aria-hidden')
      flipHint.textContent = ''
      gradeRow.hidden = false
      hint.textContent = ctx.ui('grade.ask')
      grades.get('good')?.focus()
    }
    function grade(g: Grade): void {
      if (locked || !flipped) return
      locked = true
      ctx.submit(g)
    }
    return {
      el: h('div', { class: 'flashcard' }, card, hint, gradeRow),
      focus: () => card.focus(),
      key: (e) => {
        const i = digitIndex(e)
        const g = GRADES[i]
        if (!flipped || i < 0 || !g) return false
        e.preventDefault()
        grade(g)
        return true
      },
      reveal: (_r, answer) => {
        locked = true
        if (!flipped) {
          card.classList.add('is-flipped')
          front.setAttribute('aria-hidden', 'true')
          back.removeAttribute('aria-hidden')
          gradeRow.hidden = false
        }
        card.disabled = true
        for (const [g, b] of grades) {
          b.disabled = true
          b.setAttribute('aria-pressed', String(g === answer))
          if (g === answer) b.classList.add('is-chosen')
        }
      }
    }
  }
}
