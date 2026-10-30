import type { RpgArea } from '../../../shared/shells/rpg-layout'
import type { Dir, Pos } from '../../../shared/shells/rpg-map'
import { BOSS, ALL_SPRITES, FOES, HERO, MARK_QUEST, SAGE, APPRENTICE, SPRITE_COLOURS, type Sprite } from './sprites'

/**
 * The canvas drawing of the RPG shell (EGS-12): procedural 16 x 16 tiles (seeded, so the same map always looks the same), the sprites,
 * the world canvas with its two-frame water shimmer, the battle scene, the mini maps of the area cards and the title banner.
 * Colours are read from the CSS variables `--pixel-*` (rpg.css, built from the theme's `--edu-*` slots) at runtime.
 *
 * The canvas is drawn at integer multiples of the logical size (`ctx.scale`, smoothing off) and shown at the width of its container with
 * `image-rendering: pixelated`, so it stays crisp at every scale. Phase 6 (Pixel Studio) can replace the tiles and the sprites with images
 * (`Skin`), named by the course section.
 */

export const TILE = 16

export type Palette = Readonly<Record<string, string>>

const PALETTE_NAMES = [
  'ink', 'white', 'gold', 'gold-dark', 'skin', 'skin-shade', 'hair', 'tunic', 'tunic-dark', 'cape', 'cape-dark', 'red', 'red-dark', 'green', 'green-dark', 'purple', 'purple-dark',
  'orange', 'cyan', 'brown', 'stone', 'stone-dark', 'grass-1', 'grass-2', 'grass-3', 'flower-1', 'flower-2', 'path-1', 'path-2', 'path-3', 'water-1', 'water-2', 'water-3',
  'leaf-1', 'leaf-2', 'leaf-3', 'trunk', 'wall-1', 'wall-2', 'wall-3', 'sky-1', 'sky-2', 'sky-3', 'sky-4', 'sky-5', 'moon', 'hill-1', 'hill-2', 'gate', 'gate-dark', 'glow'
] as const

/** Reads every `--pixel-*` colour of the stage as a colour the canvas accepts (the browser resolves `color-mix` and `var()` for us). */
export function readPalette(root: HTMLElement): Palette {
  const probe = document.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0'
  root.appendChild(probe)
  const out: Record<string, string> = {}
  for (const n of PALETTE_NAMES) {
    probe.style.color = ''
    probe.style.color = `var(--pixel-${n})`
    out[n] = getComputedStyle(probe).color || 'rgb(255 0 255)'
  }
  probe.remove()
  return out
}

/** Optional images from the course (phase 6): a tile sheet and sprites. */
export interface Skin {
  /** 8 tiles of 16 x 16 in a row: grass, path, water, water 2, tree, wall, gate shut, gate open. */
  tiles?: HTMLImageElement
  sprites: Partial<Record<'hero' | 'npc' | 'foe' | 'boss', HTMLImageElement>>
}

export const emptySkin = (): Skin => ({ sprites: {} })

/** Loads an image; resolves null when it cannot be loaded (the procedural art stays). */
export function loadImage(url: string | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** A repeatable number in [0, 1) for a tile, a spot in it and a seed. */
export function hash(x: number, y: number, seed: number, k = 0): number {
  let h = (Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263) + Math.imul(seed + 1, 2246822519) + Math.imul(k + 1, 3266489917)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

type Ctx = CanvasRenderingContext2D

const rect = (ctx: Ctx, x: number, y: number, w: number, h: number, colour: string): void => {
  ctx.fillStyle = colour
  ctx.fillRect(x, y, w, h)
}

/** Draws a sprite at logical (x, y); `scale` makes each pixel a block. */
export function drawSprite(ctx: Ctx, sprite: Sprite, pal: Palette, x: number, y: number, scale = 1, flip = false): void {
  for (let py = 0; py < sprite.length; py++) {
    const row = sprite[py] as string
    for (let px = 0; px < row.length; px++) {
      const ch = row[flip ? row.length - 1 - px : px] as string
      if (ch === '.') continue
      const name = SPRITE_COLOURS[ch]
      if (!name) continue
      ctx.fillStyle = pal[name] as string
      ctx.fillRect(x + px * scale, y + py * scale, scale, scale)
    }
  }
}

// ---- tiles ----

const TREE: Sprite = [
  '................',
  '.....kkkkkk.....',
  '...kkbbbbbbkk...',
  '..kbbbcbbbbbbk..',
  '..kbbcbbbbabbk..',
  '.kbbbbbbbbbbabk.',
  '.kbcbbbbabbbbbk.',
  '.kbbbbbbbbbbbak.',
  '.kbbbabbbbbcbak.',
  '..kbbbbbbbbbbk..',
  '..kkaabbbbaakk..',
  '....kkaaaakk....',
  '......kttk......',
  '......kttk......',
  '.....kkttkk.....',
  '................'
]
const TREE_COLOURS: Record<string, string> = { k: 'ink', a: 'leaf-1', b: 'leaf-2', c: 'leaf-3', t: 'trunk' }

type TileSeed = { seed: number; frame: number }

const neighbour = (rows: readonly string[], x: number, y: number, dx: number, dy: number): string => rows[y + dy]?.[x + dx] ?? '#'
const isPathLike = (ch: string): boolean => ch === ',' || ch === '@' || ch === 'N' || ch === 'B'
const isWaterCh = (ch: string): boolean => ch === '~'

function drawGrass(ctx: Ctx, pal: Palette, ox: number, oy: number, tx: number, ty: number, s: TileSeed): void {
  rect(ctx, ox, oy, TILE, TILE, pal['grass-1'] as string)
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(hash(tx, ty, s.seed, i) * 14) + 1
    const y = Math.floor(hash(tx, ty, s.seed, i + 20) * 13) + 2
    rect(ctx, ox + x, oy + y, 1, 2, pal['grass-2'] as string)
    rect(ctx, ox + x + 1, oy + y - 1, 1, 1, pal['grass-3'] as string)
  }
  for (let i = 0; i < 3; i++) rect(ctx, ox + Math.floor(hash(tx, ty, s.seed, i + 40) * 15), oy + Math.floor(hash(tx, ty, s.seed, i + 50) * 15), 1, 1, pal['grass-3'] as string)
  if (hash(tx, ty, s.seed, 60) < 0.1) {
    const x = Math.floor(hash(tx, ty, s.seed, 61) * 11) + 2
    const y = Math.floor(hash(tx, ty, s.seed, 62) * 11) + 2
    rect(ctx, ox + x, oy + y, 1, 1, pal['flower-2'] as string)
    rect(ctx, ox + x - 1, oy + y, 1, 1, pal['flower-1'] as string)
    rect(ctx, ox + x + 1, oy + y, 1, 1, pal['flower-1'] as string)
    rect(ctx, ox + x, oy + y - 1, 1, 1, pal['flower-1'] as string)
    rect(ctx, ox + x, oy + y + 1, 1, 1, pal['flower-1'] as string)
  }
}

function drawPath(ctx: Ctx, pal: Palette, rows: readonly string[], ox: number, oy: number, tx: number, ty: number, s: TileSeed): void {
  rect(ctx, ox, oy, TILE, TILE, pal['path-1'] as string)
  for (let i = 0; i < 9; i++) rect(ctx, ox + Math.floor(hash(tx, ty, s.seed, i + 70) * 15), oy + Math.floor(hash(tx, ty, s.seed, i + 80) * 15), 1, 1, pal['path-2'] as string)
  for (let i = 0; i < 4; i++) rect(ctx, ox + Math.floor(hash(tx, ty, s.seed, i + 90) * 14), oy + Math.floor(hash(tx, ty, s.seed, i + 100) * 14), 2, 1, pal['path-3'] as string)
  // a ragged grass rim where the path meets the field
  const rim = (dx: number, dy: number, horizontal: boolean, far: boolean): void => {
    const n = neighbour(rows, tx, ty, dx, dy)
    if (isPathLike(n) || n === '#' || n === 'G') return
    for (let i = 0; i < TILE; i++) {
      const depth = 1 + Math.floor(hash(tx, ty, s.seed, 110 + i + (dx + 2) * 16 + (dy + 2) * 64) * 3)
      for (let d = 0; d < depth; d++) {
        const along = i
        const across = far ? TILE - 1 - d : d
        rect(ctx, ox + (horizontal ? along : across), oy + (horizontal ? across : along), 1, 1, d === depth - 1 ? (pal['grass-2'] as string) : (pal['grass-1'] as string))
      }
    }
  }
  rim(0, -1, true, false)
  rim(0, 1, true, true)
  rim(-1, 0, false, false)
  rim(1, 0, false, true)
}

function drawWater(ctx: Ctx, pal: Palette, rows: readonly string[], ox: number, oy: number, tx: number, ty: number, s: TileSeed): void {
  rect(ctx, ox, oy, TILE, TILE, pal['water-1'] as string)
  const shift = s.frame * 2
  for (let i = 0; i < 3; i++) {
    const y = 2 + i * 5 + Math.floor(hash(tx, ty, s.seed, i + 120) * 2)
    const x = (Math.floor(hash(tx, ty, s.seed, i + 130) * 8) + shift) % 11
    rect(ctx, ox + x, oy + y, 4, 1, pal['water-2'] as string)
    rect(ctx, ox + x + 6 - shift, oy + y + 2, 2, 1, pal['water-2'] as string)
  }
  if (s.frame === 1 && hash(tx, ty, s.seed, 140) < 0.7) rect(ctx, ox + Math.floor(hash(tx, ty, s.seed, 141) * 13) + 1, oy + Math.floor(hash(tx, ty, s.seed, 142) * 13) + 1, 1, 1, pal['water-3'] as string)
  if (s.frame === 0 && hash(tx, ty, s.seed, 143) < 0.5) rect(ctx, ox + Math.floor(hash(tx, ty, s.seed, 144) * 13) + 1, oy + Math.floor(hash(tx, ty, s.seed, 145) * 13) + 1, 1, 1, pal['water-3'] as string)
  // a lighter shore where the water ends
  const shore = (dx: number, dy: number, horizontal: boolean, far: boolean): void => {
    if (isWaterCh(neighbour(rows, tx, ty, dx, dy))) return
    for (let i = 0; i < TILE; i++) if (hash(tx, ty, s.seed, 150 + i + (dx + 2) * 16 + (dy + 2) * 64) < 0.8) rect(ctx, ox + (horizontal ? i : far ? TILE - 1 : 0), oy + (horizontal ? (far ? TILE - 1 : 0) : i), 1, 1, pal['water-3'] as string)
  }
  shore(0, -1, true, false)
  shore(0, 1, true, true)
  shore(-1, 0, false, false)
  shore(1, 0, false, true)
}

function drawTree(ctx: Ctx, pal: Palette, ox: number, oy: number, tx: number, ty: number, s: TileSeed): void {
  drawGrass(ctx, pal, ox, oy, tx, ty, s)
  rect(ctx, ox + 3, oy + 13, 10, 2, pal['grass-2'] as string) // the shadow on the grass
  for (let y = 0; y < TREE.length; y++) {
    const row = TREE[y] as string
    for (let x = 0; x < row.length; x++) {
      const ch = row[x] as string
      if (ch !== '.') rect(ctx, ox + x, oy + y, 1, 1, pal[TREE_COLOURS[ch] as string] as string)
    }
  }
}

function drawWall(ctx: Ctx, pal: Palette, ox: number, oy: number, tx: number, ty: number, s: TileSeed): void {
  rect(ctx, ox, oy, TILE, TILE, pal['wall-1'] as string)
  for (let r = 0; r < 4; r++) {
    const y = r * 4
    rect(ctx, ox, oy + y + 3, TILE, 1, pal['wall-2'] as string) // the mortar below the course
    const off = r % 2 === 0 ? 0 : 4
    for (let x = off; x < TILE; x += 8) rect(ctx, ox + x, oy + y, 1, 3, pal['wall-2'] as string)
    for (let x = off + 1; x < TILE; x += 8) rect(ctx, ox + x, oy + y, 6, 1, pal['wall-3'] as string) // the lit top of each stone
    if (hash(tx, ty, s.seed, 160 + r) < 0.4) rect(ctx, ox + Math.floor(hash(tx, ty, s.seed, 170 + r) * 12) + 2, oy + y + 1, 2, 1, pal['wall-2'] as string)
  }
}

function drawGate(ctx: Ctx, pal: Palette, ox: number, oy: number, tx: number, ty: number, s: TileSeed, open: boolean): void {
  drawWall(ctx, pal, ox, oy, tx, ty, s)
  rect(ctx, ox + 2, oy + 2, 12, 14, pal.ink as string)
  if (open) {
    rect(ctx, ox + 3, oy + 3, 10, 13, pal['sky-3'] as string)
    rect(ctx, ox + 4, oy + 5, 8, 11, pal['sky-4'] as string)
    rect(ctx, ox + 5, oy + 8, 6, 8, pal.glow as string)
    rect(ctx, ox + 6, oy + 11, 4, 5, pal.moon as string)
    if (s.frame === 1) rect(ctx, ox + 7, oy + 6, 1, 1, pal.gold as string)
    else rect(ctx, ox + 9, oy + 7, 1, 1, pal.gold as string)
  } else {
    rect(ctx, ox + 3, oy + 3, 10, 13, pal.gate as string)
    for (let x = 5; x < 13; x += 3) rect(ctx, ox + x, oy + 3, 1, 13, pal['gate-dark'] as string)
    rect(ctx, ox + 3, oy + 6, 10, 1, pal.ink as string)
    rect(ctx, ox + 3, oy + 12, 10, 1, pal.ink as string)
    rect(ctx, ox + 7, oy + 9, 2, 2, pal.gold as string)
    rect(ctx, ox + 3, oy + 2, 1, 1, pal['wall-1'] as string)
    rect(ctx, ox + 12, oy + 2, 1, 1, pal['wall-1'] as string)
  }
}

function drawSpot(ctx: Ctx, pal: Palette, rows: readonly string[], ox: number, oy: number, tx: number, ty: number, s: TileSeed, ch: string): void {
  if (ch === 'B') {
    rect(ctx, ox, oy, TILE, TILE, pal['wall-2'] as string)
    rect(ctx, ox + 1, oy + 1, 14, 14, pal['wall-1'] as string)
    rect(ctx, ox + 2, oy + 2, 12, 1, pal['wall-3'] as string)
    for (const [x, y] of [[7, 3], [8, 3], [5, 5], [6, 5], [9, 5], [10, 5], [4, 7], [11, 7], [5, 9], [10, 9], [6, 11], [9, 11], [7, 12], [8, 12]] as const) rect(ctx, ox + x, oy + y, 1, 1, pal['red-dark'] as string)
    return
  }
  drawPath(ctx, pal, rows, ox, oy, tx, ty, s)
  for (const [x, y] of [[7, 4], [8, 4], [5, 5], [6, 5], [9, 5], [10, 5], [4, 7], [11, 7], [5, 9], [6, 10], [9, 10], [10, 9], [7, 11], [8, 11]] as const) rect(ctx, ox + x, oy + y, 1, 1, pal['gold-dark'] as string)
}

/** Draws one tile at its place in the area. */
export function drawTile(ctx: Ctx, pal: Palette, rows: readonly string[], tx: number, ty: number, s: TileSeed, gateOpen: boolean, skin?: Skin): void {
  const ch = rows[ty]?.[tx] ?? '#'
  const ox = tx * TILE
  const oy = ty * TILE
  if (skin?.tiles) {
    const idx = ch === '.' || ch === '@' ? 0 : ch === ',' || ch === 'N' || ch === 'B' ? 1 : ch === '~' ? 2 + s.frame : ch === 'T' ? 4 : ch === '#' ? 5 : gateOpen ? 7 : 6
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(skin.tiles, idx * TILE, 0, TILE, TILE, ox, oy, TILE, TILE)
    return
  }
  switch (ch) {
    case '#':
      return drawWall(ctx, pal, ox, oy, tx, ty, s)
    case 'T':
      return drawTree(ctx, pal, ox, oy, tx, ty, s)
    case '~':
      return drawWater(ctx, pal, rows, ox, oy, tx, ty, s)
    case ',':
    case '@':
      return drawPath(ctx, pal, rows, ox, oy, tx, ty, s)
    case 'N':
    case 'B':
      return drawSpot(ctx, pal, rows, ox, oy, tx, ty, s, ch)
    case 'G':
      return drawGate(ctx, pal, ox, oy, tx, ty, s, gateOpen)
    default:
      return drawGrass(ctx, pal, ox, oy, tx, ty, s)
  }
}

const logicalSize = (rows: readonly string[]): { w: number; h: number } => ({ w: Math.max(1, ...rows.map((r) => r.length)) * TILE, h: Math.max(1, rows.length) * TILE })

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** The still picture of the whole map for one water frame (the world draws it, then the people on top). */
export function buildLayer(rows: readonly string[], pal: Palette, seed: number, frame: number, gateOpen: boolean, skin?: Skin): HTMLCanvasElement {
  const { w, h } = logicalSize(rows)
  const c = newCanvas(w, h)
  const ctx = c.getContext('2d') as Ctx
  ctx.imageSmoothingEnabled = false
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < (rows[y]?.length ?? 0); x++) drawTile(ctx, pal, rows, x, y, { seed, frame }, gateOpen, skin)
  return c
}

// ---- the world canvas ----

/** What stands on the map (the world UI gives it to the canvas on every draw). */
export interface SceneEntity {
  at: Pos
  kind: 'giver' | 'npc' | 'foe' | 'boss'
  /** 1-based number of a foe (picks its look), or the index of an npc. */
  n: number
  /** The quest mark over the giver. */
  mark?: boolean
}

export interface Scene {
  hero: Pos
  face: Dir
  /** 0 or 1: the hero's walking frame. */
  step: number
  entities: SceneEntity[]
  gateOpen: boolean
}

export interface WorldCanvasOptions {
  area: RpgArea
  pal: Palette
  /** Seeds the tile variation (the same map always looks the same). */
  seed: number
  reduced: boolean
  skin?: Skin
}

const spriteOfEntity = (e: SceneEntity): Sprite => (e.kind === 'boss' ? BOSS : e.kind === 'foe' ? (FOES[(e.n - 1) % FOES.length] as Sprite) : e.kind === 'giver' ? SAGE : APPRENTICE)

export class WorldCanvas {
  readonly canvas: HTMLCanvasElement
  private readonly ctx: Ctx
  private readonly logical: { w: number; h: number }
  private layers: HTMLCanvasElement[] = []
  private layerGate: boolean | null = null
  private frame = 0
  private scale = 0
  private timer = 0
  private observer: ResizeObserver | null = null
  private scene: Scene | null = null
  private ticks = 0

  constructor(private readonly o: WorldCanvasOptions) {
    this.logical = logicalSize(o.area.rows)
    this.canvas = newCanvas(this.logical.w, this.logical.h)
    this.canvas.className = 'rpg-canvas'
    this.ctx = this.canvas.getContext('2d') as Ctx
    this.resize(2)
    if (!o.reduced) this.timer = window.setInterval(() => this.tick(), 650)
  }

  /** Watches the element the canvas lives in and keeps the buffer at a whole multiple of the map's size (crisp at every width). */
  fit(host: HTMLElement): void {
    const apply = (): void => {
      const w = host.clientWidth || this.canvas.clientWidth
      if (w > 0) this.resize(Math.max(1, Math.min(6, Math.round(w / this.logical.w))))
    }
    apply()
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(apply)
      this.observer.observe(host)
    }
  }

  private resize(scale: number): void {
    if (scale === this.scale) return
    this.scale = scale
    this.canvas.width = this.logical.w * scale
    this.canvas.height = this.logical.h * scale
    this.draw()
  }

  setScene(scene: Scene): void {
    this.scene = scene
    this.draw()
  }

  /** The water shimmers between two frames (never under reduced motion: the timer is not started). */
  private tick(): void {
    this.frame = this.frame === 0 ? 1 : 0
    this.ticks++
    this.draw()
  }

  private layer(gateOpen: boolean): HTMLCanvasElement {
    if (this.layerGate !== gateOpen || this.layers.length === 0) {
      this.layers = [0, 1].map((f) => buildLayer(this.o.area.rows, this.o.pal, this.o.seed, f, gateOpen, this.o.skin))
      this.layerGate = gateOpen
    }
    return this.layers[this.o.reduced ? 0 : this.frame] as HTMLCanvasElement
  }

  /** The cheap per-step redraw: the still map is one blit, then the people. */
  draw(): void {
    const sc = this.scene
    const ctx = this.ctx
    const s = this.scale
    ctx.setTransform(s, 0, 0, s, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(this.layer(sc?.gateOpen ?? false), 0, 0)
    if (!sc) return
    const pal = this.o.pal
    const skin = this.o.skin
    const items: { y: number; paint: () => void }[] = []
    for (const e of sc.entities) {
      const bob = e.kind === 'foe' || e.kind === 'boss' ? (this.frame === 1 && !this.o.reduced ? -1 : 0) : 0
      items.push({
        y: e.at[1],
        paint: () => {
          const x = e.at[0] * TILE
          const y = e.at[1] * TILE
          ctx.globalAlpha = 0.35
          rect(ctx, x + 3, y + 13, 10, 2, pal.ink as string)
          ctx.globalAlpha = 1
          const img = e.kind === 'boss' ? skin?.sprites.boss : e.kind === 'foe' ? skin?.sprites.foe : e.kind === 'giver' || e.kind === 'npc' ? skin?.sprites.npc : undefined
          if (img) ctx.drawImage(img, x, y + bob, TILE, TILE)
          else drawSprite(ctx, spriteOfEntity(e), pal, x, y + bob)
          if (e.mark) drawSprite(ctx, MARK_QUEST, pal, x, y - 11 + (this.frame === 1 && !this.o.reduced ? -1 : 0))
        }
      })
    }
    items.push({
      y: sc.hero[1],
      paint: () => {
        const x = sc.hero[0] * TILE
        const y = sc.hero[1] * TILE
        ctx.globalAlpha = 0.35
        rect(ctx, x + 3, y + 13, 10, 2, pal.ink as string)
        ctx.globalAlpha = 1
        const img = skin?.sprites.hero
        if (img) ctx.drawImage(img, x, y - sc.step, TILE, TILE)
        else drawSprite(ctx, HERO, pal, x, y - sc.step, 1, sc.face === 'left')
      }
    })
    items.sort((a, b) => a.y - b.y)
    for (const it of items) it.paint()
  }

  destroy(): void {
    if (this.timer) window.clearInterval(this.timer)
    this.timer = 0
    this.observer?.disconnect()
    this.observer = null
  }

  /** The water frames drawn so far (the shimmer test reads it). */
  get shimmerTicks(): number {
    return this.ticks
  }
}

// ---- the battle scene ----

export const SCENE_W = 160
export const SCENE_H = 64

function skyAndGround(ctx: Ctx, pal: Palette, seed: number): void {
  const bands = ['sky-1', 'sky-2', 'sky-3', 'sky-4', 'sky-5']
  bands.forEach((b, i) => rect(ctx, 0, i * 8, SCENE_W, 8, pal[b] as string))
  for (let i = 0; i < 26; i++) rect(ctx, Math.floor(hash(i, 1, seed, 3) * SCENE_W), Math.floor(hash(i, 2, seed, 3) * 26), 1, 1, pal['white'] as string)
  rect(ctx, 128, 6, 8, 8, pal.moon as string)
  rect(ctx, 130, 5, 4, 10, pal.moon as string)
  rect(ctx, 126, 8, 12, 4, pal.moon as string)
  // two rows of hills
  for (let x = 0; x < SCENE_W; x++) {
    const h1 = 36 - Math.round(5 + 4 * Math.sin((x + seed) / 14) + 3 * Math.sin((x + seed) / 5))
    rect(ctx, x, h1, 1, 48 - h1, pal['hill-2'] as string)
    const h2 = 40 - Math.round(3 + 3 * Math.sin((x + seed * 2) / 9 + 1))
    rect(ctx, x, h2, 1, 48 - h2, pal['hill-1'] as string)
  }
  // the field: grass stripes with a worn path
  for (let y = 40; y < SCENE_H; y++) {
    const stripe = Math.floor((y - 40) / 4) % 2 === 0
    rect(ctx, 0, y, SCENE_W, 1, pal[stripe ? 'grass-1' : 'grass-2'] as string)
  }
  for (let x = 0; x < SCENE_W; x += 5) rect(ctx, x + Math.floor(hash(x, 5, seed, 9) * 3), 42 + Math.floor(hash(x, 6, seed, 9) * 20), 1, 1, pal['grass-3'] as string)
  rect(ctx, 0, 58, SCENE_W, 2, pal['path-1'] as string)
  rect(ctx, 0, 58, SCENE_W, 1, pal['path-3'] as string)
}

export interface BattleDraw {
  foe: Sprite
  /** The foe is a boss: drawn with a gold glow. */
  boss: boolean
  /** The foe has fallen: drawn lying low and faded. */
  down: boolean
  /** The hero has fainted. */
  heroDown: boolean
}

/** The JRPG scene: the hero on the left, the foe on the right, drawn at 3x on a 160 x 64 canvas. */
export function drawBattleScene(canvas: HTMLCanvasElement, pal: Palette, b: BattleDraw, seed: number, skin?: Skin): void {
  const ctx = canvas.getContext('2d') as Ctx
  const s = Math.max(1, Math.round(canvas.width / SCENE_W))
  ctx.setTransform(s, 0, 0, s, 0, 0)
  ctx.imageSmoothingEnabled = false
  skyAndGround(ctx, pal, seed)
  const shadow = (x: number, w: number): void => {
    ctx.globalAlpha = 0.4
    rect(ctx, x, 57, w, 3, pal.ink as string)
    ctx.globalAlpha = 1
  }
  shadow(20, 50)
  shadow(92, 54)
  if (b.boss && !b.down) {
    ctx.globalAlpha = 0.16
    rect(ctx, 96, 10, 46, 50, pal.gold as string)
    ctx.globalAlpha = 1
  }
  const heroImg = skin?.sprites.hero
  if (b.heroDown) {
    ctx.globalAlpha = 0.6
    ctx.save()
    ctx.translate(22 + 48, 22 + 8)
    ctx.rotate(Math.PI / 2)
    if (heroImg) ctx.drawImage(heroImg, 0, 0, 48, 48)
    else drawSprite(ctx, HERO, pal, 0, 0, 3)
    ctx.restore()
    ctx.globalAlpha = 1
  } else if (heroImg) ctx.drawImage(heroImg, 22, 12, 48, 48)
  else drawSprite(ctx, HERO, pal, 22, 12, 3)
  const foeImg = b.boss ? skin?.sprites.boss : skin?.sprites.foe
  if (b.down) {
    ctx.globalAlpha = 0.5
    if (foeImg) ctx.drawImage(foeImg, 94, 30, 48, 30)
    else drawSprite(ctx, b.foe, pal, 94, 28, 3)
    ctx.globalAlpha = 1
  } else if (foeImg) ctx.drawImage(foeImg, 94, 10, 48, 48)
  else drawSprite(ctx, b.foe, pal, 94, 10, 3)
}

// ---- the title banner and the mini maps ----

export const BANNER_W = 128
export const BANNER_H = 40

/** A small pixel landscape for the title: a night sky, hills, a castle on the hill, trees and the hero. */
export function drawBanner(canvas: HTMLCanvasElement, pal: Palette, seed: number): void {
  const ctx = canvas.getContext('2d') as Ctx
  const s = Math.max(1, Math.round(canvas.width / BANNER_W))
  ctx.setTransform(s, 0, 0, s, 0, 0)
  ctx.imageSmoothingEnabled = false
  ;['sky-1', 'sky-2', 'sky-3', 'sky-4', 'sky-5'].forEach((b, i) => rect(ctx, 0, i * 6, BANNER_W, 6, pal[b] as string))
  for (let i = 0; i < 30; i++) rect(ctx, Math.floor(hash(i, 1, seed, 5) * BANNER_W), Math.floor(hash(i, 2, seed, 5) * 22), 1, 1, pal.white as string)
  rect(ctx, 100, 5, 7, 7, pal.moon as string)
  rect(ctx, 101, 4, 5, 9, pal.moon as string)
  rect(ctx, 99, 6, 9, 5, pal.moon as string)
  for (let x = 0; x < BANNER_W; x++) {
    const h1 = 28 - Math.round(5 + 4 * Math.sin((x + seed) / 11) + 2 * Math.sin(x / 4))
    rect(ctx, x, h1, 1, BANNER_H - h1, pal['hill-2'] as string)
  }
  // the castle
  const cx = 74
  const cy = 12
  rect(ctx, cx, cy + 6, 26, 14, pal['wall-1'] as string)
  rect(ctx, cx - 3, cy, 8, 20, pal['wall-3'] as string)
  rect(ctx, cx + 21, cy, 8, 20, pal['wall-3'] as string)
  for (const x of [cx - 3, cx - 1, cx + 1, cx + 3, cx + 21, cx + 23, cx + 25, cx + 27]) rect(ctx, x, cy - 2, 2, 2, pal['wall-3'] as string)
  for (const x of [cx + 6, cx + 10, cx + 14, cx + 18]) rect(ctx, x, cy + 5, 2, 2, pal['wall-3'] as string)
  rect(ctx, cx + 10, cy + 12, 6, 8, pal.ink as string)
  rect(ctx, cx + 11, cy + 13, 4, 7, pal.glow as string)
  for (const [x, y] of [[cx - 1, cy + 6], [cx + 23, cy + 6], [cx + 5, cy + 9], [cx + 19, cy + 9]] as const) rect(ctx, x, y, 2, 3, pal.gold as string)
  // the near hill with the path
  for (let x = 0; x < BANNER_W; x++) {
    const h = 33 - Math.round(2 + 2 * Math.sin((x + seed * 3) / 7))
    rect(ctx, x, h, 1, BANNER_H - h, pal['grass-2'] as string)
    rect(ctx, x, h, 1, 1, pal['grass-3'] as string)
  }
  rect(ctx, 0, 36, BANNER_W, 4, pal['grass-1'] as string)
  for (let x = 40; x < 90; x++) rect(ctx, x, 34 + Math.round(1.5 * Math.sin(x / 6)), 1, 2, pal['path-1'] as string)
  const tree = (x: number, y: number): void => {
    for (let ty = 0; ty < TREE.length; ty++) {
      const row = TREE[ty] as string
      for (let tx = 0; tx < row.length; tx++) {
        const ch = row[tx] as string
        if (ch !== '.') rect(ctx, x + tx, y + ty, 1, 1, pal[TREE_COLOURS[ch] as string] as string)
      }
    }
  }
  tree(6, 21)
  tree(100, 22)
  tree(116, 20)
  drawSprite(ctx, HERO, pal, 40, 21)
  drawSprite(ctx, ALL_SPRITES.SLIME as Sprite, pal, 58, 22)
}

/** One pixel block per tile: the area card's picture. */
export function drawMini(canvas: HTMLCanvasElement, pal: Palette, rows: readonly string[], spots: { at: Pos; kind: 'giver' | 'foe' | 'boss' }[]): void {
  const ctx = canvas.getContext('2d') as Ctx
  const px = Math.max(1, Math.round(canvas.width / Math.max(1, ...rows.map((r) => r.length))))
  ctx.imageSmoothingEnabled = false
  const colour = (ch: string): string => (ch === '#' ? pal['wall-1'] : ch === 'T' ? pal['leaf-2'] : ch === '~' ? pal['water-1'] : ch === ',' || ch === '@' || ch === 'N' ? pal['path-1'] : ch === 'B' ? pal['wall-3'] : ch === 'G' ? pal.gold : pal['grass-1']) as string
  rows.forEach((row, y) => [...row].forEach((ch, x) => rect(ctx, x * px, y * px, px, px, colour(ch))))
  for (const sp of spots) rect(ctx, sp.at[0] * px, sp.at[1] * px, px, px, (sp.kind === 'giver' ? pal.gold : sp.kind === 'boss' ? pal.purple : pal.red) as string)
}
