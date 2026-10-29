import type { HotspotItem, RegionShape } from '../../shared/course'
import { h, svg } from '../dom'
import type { ItemRenderer } from '../types'

/**
 * Hotspot: the picture with its regions on top, in one SVG (so the picture and the regions always scale together). Click a region, or
 * Tab to it and press Enter or Space. A click that lands on no region is an answer too (a wrong one: the checker reads the point).
 * The regions are named for screen readers (aria-label) but not labelled on screen, so the question is not given away.
 * Test ids: `region-<regionId>`, `hotspot`.
 */

function shapeEl(shape: RegionShape): SVGElement {
  if (shape.type === 'circle') return svg('circle', { cx: shape.cx, cy: shape.cy, r: shape.r })
  if (shape.type === 'rect') return svg('rect', { x: shape.x, y: shape.y, width: shape.w, height: shape.h, rx: 4 })
  return svg('polygon', { points: shape.points.map(([x, y]) => `${x},${y}`).join(' ') })
}

export const hotspotRenderer: ItemRenderer = {
  kind: 'hotspot',
  render(ctx) {
    const item = ctx.item as unknown as HotspotItem
    const url = ctx.assetUrl(item.asset)
    let locked = false
    const root = svg('svg', {
      class: 'hotspot-svg',
      viewBox: `0 0 ${item.width} ${item.height}`,
      role: 'group',
      'aria-label': ctx.assetAlt(item.asset) || ctx.ui('picture'),
      testid: 'hotspot'
    })
    if (url) root.appendChild(svg('image', { href: url, x: 0, y: 0, width: item.width, height: item.height, preserveAspectRatio: 'xMidYMid meet' }))
    const regions = new Map<string, SVGElement>()
    for (const r of item.regions) {
      const el = shapeEl(r.shape)
      el.classList.add('region')
      el.setAttribute('data-region', r.id)
      el.setAttribute('data-testid', `region-${r.id}`)
      el.setAttribute('role', 'button')
      el.setAttribute('tabindex', '0')
      el.setAttribute('aria-label', ctx.text.t(r.label))
      el.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
          e.preventDefault()
          choose(r.id)
        }
      })
      regions.set(r.id, el)
      root.appendChild(el)
    }
    const choose = (answer: string | { x: number; y: number }): void => {
      if (locked) return
      locked = true
      ctx.submit(answer)
    }
    root.addEventListener('click', (e) => {
      if (locked) return
      const hit = (e.target as Element).closest('[data-region]')
      if (hit) return choose(hit.getAttribute('data-region') as string)
      const m = root.getScreenCTM()
      if (!m) return
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
      lastPoint = { x: p.x, y: p.y }
      choose({ x: p.x, y: p.y })
    })
    let lastPoint: { x: number; y: number } | null = null
    const el = h('div', { class: 'hotspot' }, h('p', { class: 'hint-line' }, ctx.ui('hotspot.pick')), h('div', { class: 'hotspot-frame' }, root))
    return {
      el,
      focus: () => (regions.values().next().value as SVGElement | undefined)?.focus(),
      reveal: (_result, answer) => {
        locked = true
        const chosen = typeof answer === 'string' ? answer : undefined
        for (const [id, r] of regions) {
          r.setAttribute('tabindex', '-1')
          if (id === item.answer) r.classList.add('is-correct')
          else if (id === chosen) r.classList.add('is-wrong')
        }
        if (typeof answer === 'object' && answer && lastPoint) root.appendChild(svg('circle', { cx: lastPoint.x, cy: lastPoint.y, r: Math.max(6, item.width / 80), class: 'miss-dot' }))
      }
    }
  }
}
