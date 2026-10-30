import { h, svg } from '../../dom'
import type { MazeCharacter } from '../../../shared/shells/mindmaze'
import { MAP_NODE, type RoomMap } from './layout'

/**
 * The castle's pictures, drawn as inline SVG with the `svg()` helper (no image files, no innerHTML). Every shape carries a class
 * (`d-wood`, `t-flame` ...) and `mindmaze.css` paints it from the castle theme's `--edu-*` and `--castle-*` variables, so nothing here has a colour of its own.
 */

type Attrs = Record<string, string | number | undefined>
const el = (tag: string, attrs: Attrs = {}, ...kids: (Node | null)[]): SVGElement => svg(tag as keyof SVGElementTagNameMap, attrs, ...kids.filter((k): k is Node => k !== null))
const path = (cls: string, d: string, extra: Attrs = {}): SVGElement => el('path', { class: cls, d, ...extra })
const rect = (cls: string, x: number, y: number, w: number, hh: number, extra: Attrs = {}): SVGElement => el('rect', { class: cls, x, y, width: w, height: hh, ...extra })
const circle = (cls: string, cx: number, cy: number, r: number): SVGElement => el('circle', { class: cls, cx, cy, r })
const text = (cls: string, x: number, y: number, s: string): SVGElement => {
  const t = el('text', { class: cls, x, y, 'text-anchor': 'middle' })
  t.appendChild(document.createTextNode(s))
  return t
}
const root = (cls: string, viewBox: string, ...kids: (Node | null)[]): SVGSVGElement => svg('svg', { class: cls, viewBox, 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMidYMid meet' }, ...kids.filter((k): k is Node => k !== null))

// ---- the arched door ----

const ARCH = 'M20 168V68C20 42 38 22 60 22S100 42 100 68V168Z'

/**
 * A carved stone arch with a plank door. `open` swings the leaf away on its left hinges (CSS, on `data-open`) and shows the warm light
 * behind it; the padlock is only there while the door is shut.
 */
export function doorSvg(open: boolean): SVGSVGElement {
  const s = root(
    'mm-door-svg',
    '0 0 120 170',
    path('d-arch', 'M6 170V66C6 30 32 6 60 6S114 30 114 66V170Z'),
    path('d-joint', 'M60 6V22M33 13L39 28M87 13L81 28M13 40L28 47M107 40L92 47M8 90H20M100 90H112M8 130H20M100 130H112'),
    path('d-keystone', 'M52 6H68L66 22H54Z'),
    path('d-opening', ARCH),
    path('d-light', ARCH),
    el(
      'g',
      { class: 'd-leaf' },
      path('d-wood', ARCH),
      path('d-plank', 'M40 25V168M60 22V168M80 25V168'),
      rect('d-iron', 20, 62, 80, 8),
      rect('d-iron', 20, 114, 80, 8),
      circle('d-stud', 28, 66, 2.4),
      circle('d-stud', 52, 66, 2.4),
      circle('d-stud', 68, 66, 2.4),
      circle('d-stud', 92, 66, 2.4),
      circle('d-stud', 28, 118, 2.4),
      circle('d-stud', 92, 118, 2.4),
      circle('d-ring', 84, 92, 7),
      el('g', { class: 'd-lock' }, path('d-shackle', 'M52 84V78A8 8 0 0 1 68 78V84', { fill: 'none' }), rect('d-lockbody', 48, 84, 24, 18, { rx: 2 }), circle('d-keyhole', 60, 92, 3))
    )
  )
  s.setAttribute('data-open', String(open))
  return s
}

/** Opens or shuts a door drawn by `doorSvg` (the leaf swings by CSS). */
export const setDoorOpen = (s: Element, open: boolean): void => s.setAttribute('data-open', String(open))

// ---- torches ----

export function torchSvg(): SVGSVGElement {
  return root(
    'mm-torch-svg',
    '0 0 28 58',
    circle('t-glow', 14, 14, 20),
    path('t-bracket', 'M14 58V34M6 32H22', { fill: 'none' }),
    path('t-cup', 'M7 24H21L18 36H10Z'),
    path('t-flame', 'M14 2C19 9 23 14 21 19C20 23 17 25 14 25C11 25 8 23 7 19C6 15 9 11 11 8C12 11 13 12 14 2Z'),
    path('t-core', 'M14 12C17 16 18 18 17 21C16 23 15 24 14 24C13 24 11 23 11 21C11 19 12 18 14 12Z'),
    path('t-ember', 'M10 24H18', { fill: 'none' })
  )
}

/** The torches you carry: one per torch, lit or out. A real label for the screen reader; the flames are decoration. */
export function torchesEl(n: number, max: number, label: string): HTMLElement {
  return h(
    'span',
    { class: 'mm-torches', testid: 'torches', role: 'img', 'aria-label': label, 'data-torches': String(n), 'data-max': String(max) },
    Array.from({ length: max }, (_v, i) => h('span', { class: `mm-torch ${i < n ? 'is-lit' : 'is-out'}`, 'aria-hidden': 'true' }, torchSvg()))
  )
}

// ---- the gatehouse of the title screen ----

const merlons = (x0: number, x1: number, y: number, step: number): string => {
  let d = ''
  for (let x = x0; x + step * 0.6 <= x1; x += step) d += `M${x} ${y}h${step * 0.55}v-9h-${step * 0.55}z`
  return d
}

export function gatehouseSvg(): SVGSVGElement {
  const star = (x: number, y: number, r = 1.4): SVGElement => circle('g-star', x, y, r)
  const slit = (x: number, y: number): SVGElement => rect('g-window', x, y, 5, 16, { rx: 2.5 })
  const flameTorch = (x: number): SVGElement =>
    el('g', { class: 'g-torch', transform: `translate(${x} 104) scale(1.15)` }, circle('t-glow', 14, 14, 22), path('t-bracket', 'M14 58V34M6 32H22', { fill: 'none' }), path('t-cup', 'M7 24H21L18 36H10Z'), path('t-flame', 'M14 2C19 9 23 14 21 19C20 23 17 25 14 25C11 25 8 23 7 19C6 15 9 11 11 8C12 11 13 12 14 2Z'), path('t-core', 'M14 12C17 16 18 18 17 21C16 23 15 24 14 24C13 24 11 23 11 21C11 19 12 18 14 12Z'))
  return root(
    'mm-gatehouse',
    '0 0 400 230',
    rect('g-sky', 0, 0, 400, 230),
    circle('g-moon', 330, 40, 17),
    circle('g-moon-cut', 338, 35, 15),
    star(40, 30),
    star(88, 58, 1.1),
    star(150, 24),
    star(212, 46, 1.2),
    star(268, 18, 1.1),
    star(372, 84, 1.3),
    // the curtain wall behind
    rect('g-wall', 0, 150, 400, 80),
    path('g-merlon', merlons(0, 400, 150, 22)),
    // left tower and right tower
    rect('g-tower', 36, 62, 84, 168),
    path('g-merlon', merlons(30, 126, 62, 18).replace(/v-9h/g, 'v-12h')),
    rect('g-tower-band', 36, 100, 84, 5),
    slit(72, 78),
    slit(98, 78),
    slit(72, 124),
    rect('g-tower', 280, 62, 84, 168),
    path('g-merlon', merlons(274, 370, 62, 18).replace(/v-9h/g, 'v-12h')),
    rect('g-tower-band', 280, 100, 84, 5),
    slit(302, 78),
    slit(328, 78),
    slit(328, 124),
    // the keep behind the gate with a banner
    rect('g-keep', 132, 40, 136, 190),
    path('g-merlon', merlons(128, 272, 40, 20).replace(/v-9h/g, 'v-12h')),
    path('g-pole', 'M200 40V8', { fill: 'none' }),
    path('g-banner', 'M200 10H236L226 20L236 30H200Z'),
    // the gate: stone arch, portcullis, light behind
    path('g-arch', 'M150 230V128C150 100 172 84 200 84S250 100 250 128V230Z'),
    path('g-gate', 'M162 230V130C162 110 178 96 200 96S238 110 238 130V230Z'),
    path('g-grate', 'M176 100V230M188 96V230M200 96V230M212 96V230M224 100V230M162 130H238M162 156H238M162 182H238M162 208H238', { fill: 'none' }),
    flameTorch(120),
    flameTorch(254),
    rect('g-ground', 0, 214, 400, 16),
    path('g-path', 'M164 230L184 214H216L236 230Z')
  )
}

// ---- characters ----

/** A drawn portrait (a bust) for a character without a picture: six looks (a hooded scholar, a guard, a crowned one ...). */
export function portraitSvg(look: number): SVGSVGElement {
  const l = ((look % 6) + 6) % 6
  const body = path(`p-robe p-c${l}`, 'M8 120C8 96 26 84 50 84S92 96 92 120Z')
  const neck = rect('p-skin', 44, 70, 12, 18, { rx: 4 })
  const head = el('ellipse', { class: 'p-skin', cx: 50, cy: 54, rx: 19, ry: 22 })
  const eyes = [circle('p-eye', 43, 54, 2.2), circle('p-eye', 57, 54, 2.2), path('p-mouth', 'M44 66Q50 70 56 66', { fill: 'none' })]
  const gear: Node[] = []
  switch (l) {
    case 0: // a hooded scholar
      gear.push(path('p-hood', 'M24 66C20 30 34 12 50 12S80 30 76 66C70 54 66 40 50 40S30 54 24 66Z'), path('p-beard', 'M36 62C40 80 60 80 64 62C60 70 40 70 36 62Z'))
      break
    case 1: // a guard in a helmet with a nose guard
      gear.push(path('p-helm', 'M28 54C26 26 38 14 50 14S74 26 72 54H62V44H38V54Z'), rect('p-nose', 47, 40, 6, 20, { rx: 2 }), path('p-crest', 'M50 14C46 4 54 4 50 14', { fill: 'none' }))
      break
    case 2: // a crowned head
      gear.push(path('p-hair', 'M30 56C28 30 38 24 50 24S72 30 70 56C66 44 60 38 50 38S34 44 30 56Z'), path('p-crown', 'M32 34L36 18L44 28L50 14L56 28L64 18L68 34Z'))
      break
    case 3: // a pointed wizard's hat and a long beard
      gear.push(path('p-hat', 'M26 40C34 38 66 38 74 40L56 2C54 -2 46 -2 44 2Z'), rect('p-hatband', 26, 36, 48, 6, { rx: 3 }), path('p-beard', 'M32 60C34 92 66 92 68 60C62 72 38 72 32 60Z'))
      break
    case 4: // long hair
      gear.push(path('p-hair', 'M28 60C22 30 34 16 50 16S78 30 72 60C72 76 78 92 78 96C66 90 64 70 66 52C62 42 56 36 50 36S38 42 34 52C36 70 34 90 22 96C22 92 28 76 28 60Z'))
      break
    default: // the castle ghost: a sheet with two dark eyes
      gear.push(path('p-sheet', 'M24 120V56C24 30 36 14 50 14S76 30 76 56V120L68 110L60 120L50 110L40 120L32 110Z'))
      return root('mm-portrait-svg', '0 0 100 120', circle('p-back', 50, 60, 54), gear[0] as Node, circle('p-eye p-ghost-eye', 41, 52, 4.5), circle('p-eye p-ghost-eye', 59, 52, 4.5), path('p-mouth', 'M44 70Q50 75 56 70', { fill: 'none' }))
  }
  return root('mm-portrait-svg', '0 0 100 120', circle('p-back', 50, 60, 54), body, neck, head, ...eyes, ...gear)
}

/** The portrait frame of a character: a gilded frame around the drawn bust, or around the course's own picture when it has one. */
export function portraitFrame(c: Pick<MazeCharacter, 'look' | 'portrait'>, img: { url: string; alt: string } | null): HTMLElement {
  return h('div', { class: 'mm-portrait', 'data-look': String(c.look % 6) }, img ? h('img', { src: img.url, alt: img.alt, class: 'mm-portrait-img', loading: 'lazy' }) : portraitSvg(c.look))
}

// ---- the throne, the key, the crown ----

export function throneSvg(crowned: boolean): SVGSVGElement {
  return root(
    'mm-throne-svg',
    '0 -34 200 224',
    path('th-floor', 'M10 186H190L178 168H22Z'),
    path('th-step', 'M30 168H170L162 150H38Z'),
    path('th-back', 'M62 150V50C62 24 80 10 100 10S138 24 138 50V150Z'),
    path('th-back-in', 'M72 146V54C72 34 85 22 100 22S128 34 128 54V146Z'),
    path('th-finial', 'M56 52L62 28L68 52ZM132 52L138 28L144 52Z'),
    rect('th-seat', 56, 118, 88, 30, { rx: 4 }),
    rect('th-cushion', 64, 106, 72, 16, { rx: 8 }),
    rect('th-arm', 50, 98, 16, 52, { rx: 4 }),
    rect('th-arm', 134, 98, 16, 52, { rx: 4 }),
    path('th-gem', 'M100 34L108 44L100 54L92 44Z'),
    circle('th-gem', 100, 80, 5),
    el('g', { class: `th-crown${crowned ? ' is-won' : ''}` }, circle('th-halo', 100, 0, 22), path('th-crown-shape', 'M78 0L82 -18L92 -8L100 -22L108 -8L118 -18L122 0Z'), rect('th-crown-band', 78, 0, 44, 6, { rx: 2 }))
  )
}

export function keySvg(): SVGSVGElement {
  return root('mm-key-svg', '0 0 64 64', circle('k-ring', 18, 18, 12), circle('k-hole', 18, 18, 5), path('k-shaft', 'M26 26L56 56M44 44L52 36M50 50L58 42', { fill: 'none' }))
}

// ---- the maps ----

export interface MiniMapState {
  here: string
  /** Door keys (`from>to`) opened in this walk. */
  open: ReadonlySet<string>
  keys: ReadonlySet<string>
  entry: string
}

/** The parchment mini-map of a wing: rooms as numbered stones, doors as lines (dashed while locked), the key room gilded, a flame where you stand. */
export function miniMapSvg(map: RoomMap, s: MiniMapState, label: string): SVGSVGElement {
  const at = new Map(map.nodes.map((n) => [n.id, n]))
  const half = MAP_NODE / 2
  const edges = map.edges.map((e) => {
    const a = at.get(e.from)
    const b = at.get(e.to)
    if (!a || !b) return null
    const open = s.open.has(`${e.from}>${e.to}`)
    const cls = `m-door ${open ? 'is-open' : 'is-locked'}`
    // lines leave a node on the side facing the other one; a door that leads back curves over the top
    const dx = Math.sign(b.x - a.x)
    const x1 = a.x + (dx === 0 ? 0 : dx * half)
    const x2 = b.x - (dx === 0 ? 0 : dx * half)
    if (e.back || dx === 0) {
      const top = Math.min(a.y, b.y) - half - 14
      return path(`${cls} is-back`, `M${a.x} ${a.y - half}C${a.x} ${top} ${b.x} ${top} ${b.x} ${b.y - half}`, { fill: 'none' })
    }
    const my = (a.y + b.y) / 2
    const mx = (x1 + x2) / 2
    return el('g', { class: cls }, path('m-line', `M${x1} ${a.y}C${mx} ${a.y} ${mx} ${b.y} ${x2} ${b.y}`, { fill: 'none' }), path('m-arrow', `M${x2} ${b.y}l-9 -5v10z`), open ? null : circle('m-lock', mx, my, 4.5))
  })
  const nodes = map.nodes.map((n) => {
    const here = n.id === s.here
    const cls = `m-room${here ? ' is-here' : ''}${s.keys.has(n.id) ? ' is-key' : ''}${n.id === s.entry ? ' is-entry' : ''}`
    return el(
      'g',
      { class: cls, 'data-room': n.id },
      rect('m-stone', n.x - half, n.y - half, MAP_NODE, MAP_NODE, { rx: 5 }),
      text('m-num', n.x, n.y + 6, String(n.n)),
      s.keys.has(n.id) ? path('m-key', `M${n.x + half - 6} ${n.y - half - 3}l5 -5l5 5l-5 5z`) : null,
      here ? path('m-here', `M${n.x} ${n.y - half - 4}l-6 -10l6 -4l6 4z`) : null
    )
  })
  const kids = [...edges, ...nodes].filter((k): k is SVGElement => k !== null)
  const svgEl = svg('svg', { class: 'mm-minimap-svg', viewBox: `0 0 ${map.width} ${map.height}`, role: 'img', 'aria-label': label, preserveAspectRatio: 'xMidYMid meet', testid: 'minimap' }, ...kids)
  return svgEl
}

export interface TowerState {
  state: 'sealed' | 'open' | 'won'
}

/** The skyline of the castle: a tower per wing (a lit window when it is open, a golden key banner when it is won) around the keep of the throne room. */
export function skylineSvg(towers: readonly TowerState[], throne: 'sealed' | 'open' | 'won', label: string): SVGSVGElement {
  const step = 76
  const keepW = 100
  const left = Math.ceil(towers.length / 2)
  const slots: (TowerState | 'keep')[] = [...towers.slice(0, left), 'keep', ...towers.slice(left)]
  const width = towers.length * step + keepW + 40
  const kids: (Node | null)[] = [rect('s-sky', 0, 0, width, 180), rect('s-ground', 0, 164, width, 16)]
  let x = 20
  slots.forEach((t, i) => {
    if (t === 'keep') {
      kids.push(
        el(
          'g',
          { class: `s-keep is-${throne}`, transform: `translate(${x} 0)` },
          rect('s-wall', 0, 40, keepW, 126),
          path('s-merlon', merlons(-4, keepW + 4, 40, 18).replace(/v-9h/g, 'v-12h')),
          path('s-roof', `M-6 40L${keepW / 2} 6L${keepW + 6} 40Z`),
          path('s-flag', `M${keepW / 2} 6V-8M${keepW / 2} -6H${keepW / 2 + 22}L${keepW / 2 + 16} 0L${keepW / 2 + 22} 6H${keepW / 2}`, { fill: 'none' }),
          path('s-gate', `M${keepW / 2 - 16} 166V138C${keepW / 2 - 16} 124 ${keepW / 2 + 16} 124 ${keepW / 2 + 16} 138V166Z`),
          rect('s-window', keepW / 2 - 24, 62, 8, 20, { rx: 4 }),
          rect('s-window', keepW / 2 + 16, 62, 8, 20, { rx: 4 })
        )
      )
      x += keepW + 14
      return
    }
    const th = 86 + ((i * 37) % 4) * 14
    const top = 166 - th
    kids.push(
      el(
        'g',
        { class: `s-tower is-${t.state}`, transform: `translate(${x} 0)` },
        rect('s-wall', 0, top, 60, th),
        path('s-merlon', merlons(-3, 63, top, 15).replace(/v-9h/g, 'v-11h')),
        rect('s-window', 26, top + 22, 8, 18, { rx: 4 }),
        rect('s-window', 26, top + 54, 8, 18, { rx: 4 }),
        t.state === 'won' ? el('g', { class: 's-won' }, path('s-pole', `M30 ${top - 14}V${top - 34}`, { fill: 'none' }), path('s-key-flag', `M30 ${top - 34}H52L46 ${top - 27}L52 ${top - 20}H30Z`)) : null
      )
    )
    x += step
  })
  return svg('svg', { class: 'mm-skyline-svg', viewBox: `-4 -12 ${width} 194`, role: 'img', 'aria-label': label, preserveAspectRatio: 'xMidYMax meet', testid: 'castle-map' }, ...kids.filter((k): k is Node => k !== null))
}
