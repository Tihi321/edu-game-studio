import { button, h, isTyping } from '../../dom'
import { glossify, glossParagraph, glossPopover, type GlossWord } from '../../gloss'
import type { UiKey } from '../../i18n'
import type { EncApp } from './app'

/**
 * The reader (EGS-35): the articles of a reading course as chapters, in unit order, in a reading-width column on the parchment page.
 * Glossed words are buttons (`gloss-<id>`) that open a popover; the glossary of the text is listed under it with an "in my deck" switch;
 * the position (chapter and how far down) is kept; a chapter counts as read when its last paragraph has been on screen. The left and right
 * arrow keys change chapter. Testids: `reader`, `reader-chapter-<articleId>`, `reader-prev`, `reader-next`, `reader-progress`.
 */

const scroller = (): HTMLElement => (document.scrollingElement ?? document.documentElement) as HTMLElement

function scrollFraction(): number {
  const el = scroller()
  const max = el.scrollHeight - el.clientHeight
  return max > 0 ? el.scrollTop / max : 0
}

/** The glossary list of a text: each word with its lemma, class, gloss and note, and the switch that keeps it in the vocabulary deck. */
function glossaryPanel(app: EncApp, chapter: string, words: readonly GlossWord[]): HTMLElement | null {
  if (words.length === 0) return null
  const ui = app.s.ui
  const off = app.glossOff()
  return h(
    'section',
    { class: 'enc-glossary', testid: 'glossary-panel', 'aria-labelledby': 'enc-glossary-h' },
    h('h2', { id: 'enc-glossary-h' }, ui('gloss.panel')),
    h(
      'ul',
      {},
      words.map((w) => {
        const key = `${chapter}/${w.id}`
        const box = h('input', {
          type: 'checkbox',
          testid: `gloss-deck-${w.id}`,
          'aria-label': ui('gloss.deck.for', { term: w.lemma ?? w.term }),
          checked: !off.has(key),
          onchange: () => app.setGlossDeck(chapter, w.id, box.checked)
        })
        return h(
          'li',
          { testid: `glossary-entry-${w.id}` },
          h(
            'span',
            { class: 'enc-gloss-main' },
            h('strong', { class: 'enc-gloss-lemma' }, w.lemma ?? w.term),
            w.pos ? h('span', { class: 'gloss-pos' }, ui(`gloss.pos.${w.pos}` as UiKey)) : null,
            h('span', { class: 'enc-gloss-text' }, w.gloss),
            w.note ? h('span', { class: 'enc-gloss-note' }, w.note) : null
          ),
          h('label', { class: 'enc-gloss-deck' }, box, h('span', {}, ui('gloss.deck')))
        )
      })
    )
  )
}

/** One chapter: the contents, the text with tap-to-gloss, the way on and the glossary. */
export function readerBody(app: EncApp, id: string): HTMLElement {
  const s = app.s
  const ui = s.ui
  const chapters = app.chapters()
  const index = Math.max(0, chapters.findIndex((c) => c.id === id))
  const chapter = chapters[index]
  if (!chapter) return h('div', {})
  const words = app.glossWords(id)
  const pop = glossPopover(ui)
  const off = app.glossOff()
  const offIds = new Set(words.filter((w) => off.has(`${id}/${w.id}`)).map((w) => w.id))
  const segs = glossify(
    chapter.paragraphs.map((p) => [{ text: p }]),
    words
  )
  const read = app.chapterRead(id)
  const prev = chapters[index - 1]
  const next = chapters[index + 1]
  const unit = chapter.unit ? s.unitTitle(chapter.unit) : ''
  const items = app.chapterItems(id)

  const toc = h(
    'nav',
    { class: 'enc-reader-toc', 'aria-label': ui('reader.toc'), testid: 'reader-toc' },
    h('h2', {}, ui('reader.toc')),
    h(
      'ol',
      {},
      chapters.map((c, i) =>
        h(
          'li',
          {},
          button(
            `reader-chapter-${c.id}`,
            [h('span', { class: 'enc-reader-num' }, String(i + 1)), h('span', { class: 'enc-reader-toc-title' }, c.title), app.chapterRead(c.id) ? [h('span', { class: 'mark', 'aria-hidden': 'true' }, '✓'), h('span', { class: 'sr-only' }, ` (${ui('reader.chapterRead')})`)] : null],
            () => app.reader(c.id),
            { class: 'enc-reader-toc-btn', 'data-read': String(app.chapterRead(c.id)), ...(c.id === id ? { 'aria-current': 'true' } : {}) }
          )
        )
      )
    )
  )

  const end = h('div', { class: 'enc-reader-end', testid: 'reader-end', 'aria-hidden': 'true' })
  const progress = h(
    'p',
    { class: 'enc-reader-progress', testid: 'reader-progress', 'data-chapter': id, 'data-index': String(index + 1), 'data-total': String(chapters.length), 'data-read': String(read), 'aria-live': 'polite' },
    ui('reader.progress', { n: index + 1, total: chapters.length })
  )
  const go = (to: string | undefined): void => {
    // moving on from a chapter means it was read
    app.markChapterRead(id)
    if (to) app.reader(to)
  }
  const nav = h(
    'div',
    { class: 'enc-reader-nav' },
    button('reader-prev', `‹ ${ui('reader.prev')}`, () => (prev ? app.reader(prev.id) : undefined), { class: 'btn', ...(prev ? {} : { disabled: true }) }),
    progress,
    button('reader-next', `${ui('reader.next')} ›`, () => go(next?.id), { class: 'btn btn-primary', ...(next ? {} : { disabled: true }) })
  )

  const body = h(
    'div',
    { class: 'enc-reader-body enc-body gloss-scope', testid: 'reader-body', lang: s.pack.targetLang ?? undefined },
    segs.map((sg) => glossParagraph(sg, pop, undefined, offIds)),
    pop.el
  )
  const practice =
    items.length > 0
      ? button('reader-practice', ui('reader.practice'), () => app.practice(id), { class: 'btn btn-small' })
      : null

  const root = h(
    'div',
    { class: 'enc-reader', testid: 'reader', 'data-chapter': id },
    toc,
    h(
      'article',
      { class: 'enc-reader-main' },
      h('p', { class: 'enc-runhead' }, h('span', {}, unit || ui('reader.title')), h('span', { class: 'enc-runhead-sep', 'aria-hidden': 'true' }, '❦'), h('span', {}, ui('reader.chapter', { n: index + 1 }))),
      h('h1', { class: 'screen-title enc-reader-title', tabindex: '-1', testid: 'reader-title', 'data-autofocus': '' }, chapter.title),
      h('p', { class: 'enc-rule', 'aria-hidden': 'true' }),
      words.length > 0 ? h('p', { class: 'enc-reader-hint' }, ui('reader.hint')) : null,
      body,
      end,
      h('p', { class: 'enc-reader-done', testid: 'reader-done', hidden: !read }, next ? ui('reader.read') : `${ui('reader.read')} ${ui('reader.last')}`),
      nav,
      practice,
      glossaryPanel(app, id, words)
    )
  )

  // arrow keys change chapter (not while typing, not with a modifier)
  root.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || isTyping(e.target)) return
    if (e.key === 'ArrowLeft' && prev) {
      e.preventDefault()
      app.reader(prev.id)
    } else if (e.key === 'ArrowRight' && next) {
      e.preventDefault()
      go(next.id)
    }
  })

  // where the learner stands: the position is kept; the last paragraph on screen marks the chapter read
  const saved = app.data.reader
  const onScroll = (): void => {
    if (root.isConnected && timer === undefined) timer = window.setTimeout(flush, 400)
  }
  let timer: number | undefined
  function flush(): void {
    timer = undefined
    if (root.isConnected) app.rememberReader(id, scrollFraction())
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  let observer: IntersectionObserver | undefined
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      if (root.isConnected && entries.some((x) => x.isIntersecting)) app.markChapterRead(id)
    })
    observer.observe(end)
  }
  app.pendingCleanup.push(() => {
    window.removeEventListener('scroll', onScroll)
    observer?.disconnect()
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
    }
  })
  window.requestAnimationFrame(() => {
    const el = scroller()
    const max = el.scrollHeight - el.clientHeight
    el.scrollTop = saved?.chapter === id && max > 0 ? Math.round(saved.scroll * max) : 0
  })
  return root
}
