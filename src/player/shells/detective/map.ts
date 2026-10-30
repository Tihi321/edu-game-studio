import { h, svg } from '../../dom'

/**
 * The map of the chase: the course's picture (an SVG or a PNG) with a pin for every place, a dotted travel line over the trail so far, and
 * the names of the places that matter now (visited, here, the choices). The pins are HTML placed by percentage over a picture that keeps its
 * aspect ratio, so the labels stay a readable size at any width; the line is a stretched SVG with a constant stroke. Decoration: the
 * `travel-<placeId>` buttons next to it are the controls.
 */

export interface MapPlace {
  id: string
  name: string
  x: number
  y: number
}

export type PinState = 'here' | 'visited' | 'option' | 'other'

export interface MapOptions {
  src: string | undefined
  alt: string
  width: number
  height: number
  places: MapPlace[]
  trail: string[]
  options: string[]
  here: string
}

export function chaseMap(o: MapOptions): HTMLElement {
  const byId = new Map(o.places.map((p) => [p.id, p]))
  const pct = (v: number, of: number): string => `${((v / of) * 100).toFixed(2)}%`
  const stateOf = (id: string): PinState => (id === o.here ? 'here' : o.trail.includes(id) ? 'visited' : o.options.includes(id) ? 'option' : 'other')
  const points = o.trail.flatMap((id) => {
    const p = byId.get(id)
    return p ? [`${p.x},${p.y}`] : []
  })
  const line = svg(
    'svg',
    { class: 'det-map-line', viewBox: `0 0 ${o.width} ${o.height}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' },
    ...(points.length > 1 ? [svg('polyline', { class: 'det-map-route', points: points.join(' '), fill: 'none', testid: 'route-line' })] : [])
  )
  const pins = o.places.map((p) => {
    const st = stateOf(p.id)
    return h(
      'div',
      { class: `det-map-pin is-${st}`, style: `left:${pct(p.x, o.width)};top:${pct(p.y, o.height)}`, 'data-state': st, testid: `pin-${p.id}` },
      h('span', { class: 'det-map-dot', 'aria-hidden': 'true' }),
      st === 'other' ? null : h('span', { class: 'det-map-name' }, p.name)
    )
  })
  return h(
    'div',
    { class: 'det-map', testid: 'map', style: `aspect-ratio:${o.width} / ${o.height}` },
    o.src ? h('img', { class: 'det-map-img', src: o.src, alt: o.alt, draggable: 'false' }) : h('div', { class: 'det-map-img', role: 'img', 'aria-label': o.alt }),
    line,
    pins
  )
}
