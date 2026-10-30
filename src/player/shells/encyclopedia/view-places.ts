import { button, h, svg } from '../../dom'
import type { EncApp } from './app'
import { minMapWidth, pinPercent, stepPin } from './places'
import { formatYear, layoutTimeline } from './timeline'

const CARD = 150
/** Height of the timeline's track and the distance of a card from the ruler (px). */
const TRACK_H = 440
const LANE_GAP = 54

/** The timeline: events on a ruler true to scale, cards above and below with leader lines, arrow keys between events. */
export function timelineBody(app: EncApp): HTMLElement {
  const s = app.s
  const events = app.model.timeline
  const L = layoutTimeline(events.map((e) => ({ id: e.id, year: e.year })), { card: CARD })
  const byId = new Map(events.map((e) => [e.id, e]))
  const bc = s.s('enc.bc')
  const mid = TRACK_H / 2
  if (!app.eventId || !byId.has(app.eventId)) app.eventId = L.events[0]?.id ?? null

  const detail = h('div', { class: 'enc-tl-detail', role: 'status', testid: 'event-detail' })
  const when = (id: string): string => {
    const e = byId.get(id)
    if (!e) return ''
    return e.whenKey && s.text.hasText(e.whenKey) ? s.t(e.whenKey) : formatYear(e.year, bc)
  }
  const showDetail = (id: string): void => {
    const e = byId.get(id)
    if (!e) return
    app.eventId = id
    detail.replaceChildren(h('b', { class: 'enc-tl-detail-year' }, when(id)), ' ', h('span', { class: 'enc-tl-detail-label' }, s.t(e.label)), ...(e.text ? [' ', h('span', { class: 'enc-tl-detail-text' }, s.t(e.text))] : []))
    detail.setAttribute('data-event', id)
  }

  const lines = svg(
    'svg',
    { class: 'enc-tl-lines', width: L.width, height: TRACK_H, viewBox: `0 0 ${L.width} ${TRACK_H}`, 'aria-hidden': 'true', focusable: 'false' },
    ...L.events.map((p) => svg('path', { d: `M ${p.tick} ${mid} L ${p.x} ${mid + (p.lane === 0 ? -LANE_GAP : LANE_GAP)}` }))
  )

  const ruler = h(
    'div',
    { class: 'enc-tl-ruler', 'aria-hidden': 'true', style: `top:${mid - 21}px` },
    L.ticks.map((t) => h('span', { class: `enc-tl-tick${t.major ? ' is-major' : ''}`, style: `left:${t.x}px` }, t.major ? h('span', { class: 'enc-tl-tick-label' }, formatYear(t.year, bc)) : null)),
    L.events.map((p) => h('span', { class: 'enc-tl-mark', style: `left:${p.tick}px` }))
  )

  const cards = L.events.map((p) => {
    const e = byId.get(p.id)
    if (!e) return null
    const open = !!e.article && app.arts.has(e.article)
    return button(
      `event-${e.id}`,
      [h('span', { class: 'enc-tl-card-year' }, when(e.id)), h('span', { class: 'enc-tl-card-label' }, s.t(e.label)), open ? h('span', { class: 'enc-tl-card-more' }, `${s.s('enc.tl.read')} ›`) : null],
      () => {
        showDetail(e.id)
        if (open) app.article(e.article as string, () => app.timeline())
      },
      {
        class: `enc-tl-card${open ? ' has-article' : ''}`,
        'data-lane': String(p.lane),
        'data-year': String(e.year),
        'data-article': open ? e.article : null,
        style: `left:${Math.round(p.x - CARD / 2)}px;width:${CARD}px;${p.lane === 0 ? `bottom:${mid + LANE_GAP}px` : `top:${mid + LANE_GAP}px`}`,
        onfocus: () => showDetail(e.id),
        onmouseenter: () => showDetail(e.id)
      }
    )
  })

  const scroll = h(
    'div',
    {
      class: 'enc-tl-scroll',
      testid: 'timeline',
      role: 'group',
      'aria-label': s.s('enc.tl.box'),
      onkeydown: (ev: Event) => {
        const k = ev as KeyboardEvent
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
        if (!keys.includes(k.key) || k.altKey || k.ctrlKey || k.metaKey) return
        const els = [...scroll.querySelectorAll<HTMLElement>('.enc-tl-card')]
        const at = els.indexOf(document.activeElement as HTMLElement)
        if (at < 0) return
        const next = k.key === 'Home' ? 0 : k.key === 'End' ? els.length - 1 : Math.min(els.length - 1, Math.max(0, at + (k.key === 'ArrowRight' ? 1 : -1)))
        k.preventDefault()
        els[next]?.focus()
      }
    },
    h('div', { class: 'enc-tl-track', style: `width:${L.width}px;height:${TRACK_H}px` }, lines, ruler, cards)
  )
  if (app.eventId) showDetail(app.eventId)

  return h(
    'div',
    { class: 'enc-timeline' },
    h('h1', { class: 'screen-title enc-part-title', tabindex: '-1', testid: 'timeline-title' }, s.s('enc.tl.title')),
    h('p', { class: 'enc-part-intro' }, events.length > 0 ? s.s('enc.tl.intro') : s.s('enc.tl.empty')),
    scroll,
    detail
  )
}

/** The map: the image with brass pins (percent positions, so it scales), and the same places as a list below it. */
export function mapBody(app: EncApp): HTMLElement {
  const s = app.s
  const m = app.model.map
  const asset = m ? s.pack.assets.find((a) => a.id === m.asset) : undefined
  const url = m ? s.data.assets[m.asset] : undefined
  if (!m || !asset || !url) return h('div', { class: 'enc-map-view' }, h('h1', { class: 'screen-title enc-part-title', tabindex: '-1' }, s.s('enc.map.title')), h('p', {}, s.s('enc.map.none')))
  const places = m.places.filter((p) => app.arts.has(p.article))
  const sized = m.width > 0 && m.height > 0
  const open = (article: string): void => app.article(article, () => app.map())
  const minW = sized ? minMapWidth(places, m.width) : 0

  const pins = sized
    ? places.map((p) => {
        const pos = pinPercent(p, m.width, m.height)
        return button(`place-${p.id}`, [h('span', { class: 'enc-pin-head', 'aria-hidden': 'true' }), h('span', { class: 'enc-pin-name', 'aria-hidden': 'true' }, s.t(p.label))], () => open(p.article), {
          class: 'enc-pin',
          'aria-label': s.t(p.label),
          'data-article': p.article,
          style: `left:${pos.left};top:${pos.top}`
        })
      })
    : []

  const stage = h(
    'div',
    {
      class: 'enc-map-stage',
      testid: 'map',
      style: sized ? `aspect-ratio:${m.width} / ${m.height};min-width:${minW}px` : '',
      onkeydown: (ev: Event) => {
        const k = ev as KeyboardEvent
        const dir = k.key === 'ArrowLeft' ? 'left' : k.key === 'ArrowRight' ? 'right' : k.key === 'ArrowUp' ? 'up' : k.key === 'ArrowDown' ? 'down' : null
        if (!dir || k.altKey || k.ctrlKey || k.metaKey) return
        const cur = (document.activeElement as HTMLElement | null)?.getAttribute('data-testid')
        if (!cur?.startsWith('place-')) return
        const to = stepPin(places, cur.slice('place-'.length), dir)
        if (!to) return
        k.preventDefault()
        stage.querySelector<HTMLElement>(`[data-testid="place-${to.id}"]`)?.focus()
      }
    },
    h('img', { class: 'enc-map-img', src: url, alt: s.t(asset.alt) }),
    pins
  )

  return h(
    'div',
    { class: 'enc-map-view' },
    h('h1', { class: 'screen-title enc-part-title', tabindex: '-1', testid: 'map-title' }, s.s('enc.map.title')),
    h('p', { class: 'enc-part-intro' }, places.length > 0 ? s.s('enc.map.intro') : s.s('enc.map.none')),
    h('figure', { class: 'enc-map-figure' }, h('div', { class: 'enc-map-scroll', role: 'group', 'aria-label': s.s('enc.map.box') }, stage), h('figcaption', {}, s.t(asset.alt))),
    places.length > 0
      ? h('section', { class: 'enc-places', testid: 'places' }, h('h2', {}, s.s('enc.map.places')), h('ul', {}, places.map((p) => h('li', {}, button(`place-link-${p.id}`, [h('span', { class: 'enc-place-dot', 'aria-hidden': 'true' }), s.t(p.label)], () => open(p.article), { class: 'enc-place-btn' })))))
      : null
  )
}
