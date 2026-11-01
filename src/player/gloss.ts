import { button, h, type Child } from './dom'
import type { Ui, UiKey } from './i18n'

/**
 * Tap-to-gloss (EGS-35, B2 readings): the words of a text that have a gloss become buttons that open a small popover (the dictionary form,
 * the gloss in the edition, a note). Shared by the encyclopedia's reader and article pages and by the passage panel of any item, so it
 * lives outside the shell. The segmentation is pure (no DOM); the rest builds elements.
 */

/** A glossary entry in the edition being read (every key resolved to text). */
export interface GlossWord {
  id: string
  /** The exact surface form in the text. */
  term: string
  lemma?: string
  gloss: string
  pos?: string
  note?: string
}

/** A run of text, a link to another article (the article page) or a glossed word. */
export interface GlossSeg {
  text: string
  link?: string
  gloss?: GlossWord
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The first place `term` stands in `text` as a whole word, else anywhere (an inflected stem), else null. */
function findTerm(text: string, term: string): { start: number; end: number } | null {
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${esc(term)}(?![\\p{L}\\p{N}])`, 'u').exec(text)
  if (m) return { start: m.index, end: m.index + m[0].length }
  const i = text.indexOf(term)
  return i < 0 ? null : { start: i, end: i + term.length }
}

/**
 * Cuts the paragraphs (runs of text, some of them links) at the glossed words. A word is marked at its first mention in the whole text;
 * the longest term goes first, so a term inside a longer one is not marked twice; a stretch that is already a link or a gloss is not cut.
 */
export function glossify(paragraphs: readonly (readonly { text: string; link?: string }[])[], words: readonly GlossWord[]): GlossSeg[][] {
  const out: GlossSeg[][] = paragraphs.map((p) => p.map((s) => ({ ...s })))
  const cands = words.filter((w) => w.term.trim() !== '').sort((a, b) => b.term.length - a.term.length)
  for (const w of cands) {
    let done = false
    for (const segs of out) {
      if (done) break
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i] as GlossSeg
        if (seg.link || seg.gloss) continue
        const hit = findTerm(seg.text, w.term)
        if (!hit) continue
        const parts: GlossSeg[] = []
        if (hit.start > 0) parts.push({ text: seg.text.slice(0, hit.start) })
        parts.push({ text: seg.text.slice(hit.start, hit.end), gloss: w })
        if (hit.end < seg.text.length) parts.push({ text: seg.text.slice(hit.end) })
        segs.splice(i, 1, ...parts)
        done = true
        break
      }
    }
  }
  return out
}

export interface GlossPopover {
  el: HTMLElement
  show(anchor: HTMLElement, word: GlossWord): void
  hide(): void
}

let counter = 0

/** The word class shown in the popover (`gloss.pos.<pos>` in the player's strings). */
const posLabel = (ui: Ui, pos: string | undefined): string => (pos ? ui(`gloss.pos.${pos}` as UiKey) : '')

/**
 * One popover for a stretch of text. Put `el` inside an element with `position: relative` that holds the glossed words: it opens under the
 * tapped word. Tapping the same word again, the close button or Escape closes it.
 */
export function glossPopover(ui: Ui): GlossPopover {
  const id = `gloss-pop-${++counter}`
  const lemma = h('strong', { class: 'gloss-lemma', testid: 'gloss-lemma' })
  const pos = h('span', { class: 'gloss-pos', testid: 'gloss-pos' })
  const text = h('p', { class: 'gloss-text', testid: 'gloss-text' })
  const note = h('p', { class: 'gloss-note', testid: 'gloss-note' })
  let anchor: HTMLElement | null = null
  const el = h(
    'div',
    { class: 'gloss-pop', id, role: 'status', testid: 'gloss-popover', hidden: true },
    h('div', { class: 'gloss-head' }, lemma, pos),
    text,
    note,
    button('gloss-close', '×', () => api.hide(), { class: 'gloss-close', 'aria-label': ui('gloss.close') })
  )
  const api: GlossPopover = {
    el,
    show(a, w) {
      if (anchor === a && !el.hidden) return api.hide()
      api.hide()
      anchor = a
      lemma.textContent = w.lemma ?? w.term
      pos.textContent = posLabel(ui, w.pos)
      pos.hidden = !w.pos
      text.textContent = w.gloss
      note.textContent = w.note ?? ''
      note.hidden = !w.note
      el.hidden = false
      a.setAttribute('aria-expanded', 'true')
      const scope = el.parentElement
      if (scope) {
        const r = a.getBoundingClientRect()
        const s = scope.getBoundingClientRect()
        const width = Math.min(el.offsetWidth || 280, s.width)
        el.style.top = `${Math.round(r.bottom - s.top + 6)}px`
        el.style.left = `${Math.round(Math.max(0, Math.min(r.left - s.left, s.width - width)))}px`
      }
    },
    hide() {
      if (anchor) anchor.setAttribute('aria-expanded', 'false')
      anchor = null
      el.hidden = true
    }
  }
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const a = anchor
      api.hide()
      a?.focus()
    }
  })
  return api
}

/**
 * The word as a button (`gloss-<id>`) that opens the popover, followed by a hidden description so a screen reader hears the gloss
 * (`aria-describedby`). Escape on the word closes the popover.
 */
export function glossButton(w: GlossWord, pop: GlossPopover, extra: { off?: boolean } = {}): Child[] {
  const descId = `gloss-d-${++counter}`
  const btn = button(`gloss-${w.id}`, w.term, () => pop.show(btn, w), {
    class: `gloss${extra.off ? ' is-off' : ''}`,
    'aria-expanded': 'false',
    'aria-controls': pop.el.id,
    'aria-describedby': descId
  })
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') pop.hide()
  })
  return [btn, h('span', { class: 'sr-only', id: descId }, `: ${w.gloss}`)]
}

/** A paragraph of runs: plain text, links (through `link`) and glossed words. */
export function glossParagraph(segs: readonly GlossSeg[], pop: GlossPopover, link?: (id: string, text: string) => Child, off?: ReadonlySet<string>): HTMLElement {
  return h(
    'p',
    {},
    segs.map((s): Child => (s.gloss ? glossButton(s.gloss, pop, { off: off?.has(s.gloss.id) === true }) : s.link && link ? link(s.link, s.text) : s.text))
  )
}
