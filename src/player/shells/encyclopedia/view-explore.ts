import { clear, h } from '../../dom'
import type { EncApp } from './app'

/** Roman numerals for the chapter rubrics. */
export function roman(n: number): string {
  const t: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let out = ''
  let v = Math.max(1, Math.floor(n))
  for (const [k, sym] of t) {
    while (v >= k) {
      out += sym
      v -= k
    }
  }
  return out
}

/** The home of the encyclopedia: masthead, search, the plate, and the index of articles grouped in chapters (units). */
export function exploreBody(app: EncApp): HTMLElement {
  const s = app.s
  const c = app.statusCounts()
  const stat = (label: string, value: string, testid: string): HTMLElement => h('span', { class: 'enc-stat', testid }, h('span', { class: 'enc-stat-label' }, label), h('b', { class: 'enc-stat-value' }, value))

  // ---- search ----
  const results = h('ul', { class: 'enc-results', testid: 'search-results' })
  const status = h('p', { class: 'enc-search-status', id: 'enc-search-status', role: 'status', testid: 'search-status' })
  const showResults = (q: string): { id: string; snippet: string }[] => {
    const hits = app.search(q)
    clear(results)
    for (const hit of hits) {
      results.appendChild(
        h(
          'li',
          {},
          h(
            'button',
            { type: 'button', class: 'enc-result', testid: `result-${hit.id}`, onclick: () => app.article(hit.id, () => app.explore()) },
            h('span', { class: 'enc-result-title' }, app.articleTitle(hit.id)),
            hit.snippet ? h('span', { class: 'enc-result-snippet' }, hit.snippet) : null
          )
        )
      )
    }
    const typed = q.trim()
    status.textContent = typed.replace(/\s/g, '').length < 2 ? '' : hits.length === 0 ? s.s('enc.search.none', { q: typed }) : s.s('enc.search.count', { n: hits.length })
    return hits
  }
  const input = h('input', {
    type: 'search',
    class: 'enc-search-input',
    id: 'enc-search',
    testid: 'search',
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    placeholder: s.s('enc.search.placeholder'),
    'aria-describedby': 'enc-search-status',
    value: app.query,
    oninput: (e: Event) => {
      app.query = (e.target as HTMLInputElement).value
      showResults(app.query)
    },
    onkeydown: (e: Event) => {
      const k = e as KeyboardEvent
      if (k.key !== 'Enter') return
      k.preventDefault()
      const first = showResults(app.query)[0]
      if (first) app.article(first.id, () => app.explore())
    }
  })
  const search = h(
    'form',
    { class: 'enc-search', role: 'search', onsubmit: (e: Event) => e.preventDefault() },
    h('label', { class: 'enc-search-label', for: 'enc-search' }, s.s('enc.search.label')),
    h('div', { class: 'enc-search-box' }, h('span', { class: 'enc-search-glass', 'aria-hidden': 'true' }), input),
    status,
    h('div', { class: 'enc-results-wrap', 'aria-label': s.s('enc.search.results'), role: 'group' }, results)
  )
  if (app.query) showResults(app.query)

  // ---- the plate (frontispiece) ----
  const image = s.pack.assets.find((a) => a.kind === 'image' && s.data.assets[a.id])
  const plate = image
    ? h(
        'figure',
        { class: 'enc-plate', testid: 'plate' },
        h('div', { class: 'enc-plate-frame' }, h('img', { src: s.data.assets[image.id] as string, alt: s.t(image.alt), loading: 'lazy' })),
        h('figcaption', {}, h('span', { class: 'enc-plate-no' }, s.s('enc.plate')), ' ', s.t(image.alt))
      )
    : null

  // ---- the index, in chapters ----
  const units = s.units()
  const listed = new Set<string>()
  const entry = (id: string): HTMLElement => {
    listed.add(id)
    const read = app.data.read.includes(id)
    return h(
      'li',
      {},
      h(
        'button',
        { type: 'button', class: 'enc-entry', testid: `article-${id}`, 'data-read': read ? 'true' : null, onclick: () => app.article(id, () => app.explore()) },
        h('span', { class: 'enc-entry-title' }, app.articleTitle(id)),
        h('span', { class: 'enc-entry-leader', 'aria-hidden': 'true' }),
        read ? h('span', { class: 'enc-entry-read' }, h('span', { 'aria-hidden': 'true' }, '✓'), h('span', { class: 'sr-only' }, ` ${s.s('enc.readMark')}`)) : null
      )
    )
  }
  const chapters = units.flatMap((u, i) => {
    const ids = app.articleList().filter((a) => a.unit === u.id).map((a) => a.id)
    if (ids.length === 0) return []
    const hunts = app.model.hunts.filter((x) => x.unit === u.id)
    const locked = hunts.length > 0 && !s.isUnlocked(u.id)
    const req = u.requires.find((r) => !s.isMastered(r))
    return [
      h(
        'section',
        { class: 'enc-chapter', testid: `chapter-${u.id}`, 'data-locked': locked ? 'true' : null },
        h('h2', { class: 'enc-chapter-title' }, h('span', { class: 'enc-numeral', 'aria-hidden': 'true' }, roman(i + 1)), h('span', { class: 'enc-chapter-name' }, s.unitTitle(u.id))),
        locked ? h('p', { class: 'enc-chapter-note', testid: `chapter-locked-${u.id}` }, h('span', { 'aria-hidden': 'true' }, '\u{1F512} '), s.s('enc.locked', { unit: req ? s.unitTitle(req) : s.unitTitle(u.id) })) : null,
        h('ul', { class: 'enc-entries' }, ids.map(entry))
      )
    ]
  })
  const rest = app.articleList().filter((a) => !listed.has(a.id) && !units.some((u) => u.id === a.unit) )
  const more = rest.length > 0 ? h('section', { class: 'enc-chapter', testid: 'chapter-other' }, h('h2', { class: 'enc-chapter-title' }, h('span', { class: 'enc-chapter-name' }, s.s('enc.other'))), h('ul', { class: 'enc-entries' }, rest.map((a) => entry(a.id)))) : null

  return h(
    'div',
    { class: 'enc-explore' },
    h(
      'header',
      { class: 'enc-masthead' },
      h('p', { class: 'enc-eyebrow' }, s.pack.subject.charAt(0).toLocaleUpperCase() + s.pack.subject.slice(1)),
      h('h1', { class: 'screen-title enc-title', tabindex: '-1', testid: 'explore-title' }, s.courseTitle()),
      h('p', { class: 'enc-orn', 'aria-hidden': 'true' }, '❦'),
      h('p', { class: 'enc-sub' }, s.s('enc.masthead.sub')),
      h('p', { class: 'enc-stats', testid: 'status' }, stat(s.s('enc.stat.found'), `${c.found} / ${c.total}`, 'status-found'), stat(s.s('enc.stat.stars'), `${c.stars} / ${c.maxStars}`, 'status-stars'), stat(s.s('enc.stat.read'), `${c.read} / ${c.articles}`, 'status-read'))
    ),
    h('div', { class: 'enc-columns' }, h('aside', { class: 'enc-side' }, search, plate), h('div', { class: 'enc-indexwrap' }, h('h2', { class: 'sr-only' }, s.s('enc.index')), h('div', { class: 'enc-index' }, chapters, more)))
  )
}
