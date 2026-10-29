import sharp from 'sharp'
import type { Rgb } from './palettes'

interface WebpOpts {
  quality?: number
  lossless?: boolean
}

/** Cover-crop resize to exactly `w` x `h`, as webp. */
export async function fitBackground(buf: Buffer, w: number, h: number, opts: WebpOpts = {}): Promise<Buffer> {
  return sharp(buf)
    .resize(w, h, { fit: 'cover', position: 'centre' })
    .webp(opts.lossless ? { lossless: true } : { quality: opts.quality ?? 90 })
    .toBuffer()
}

/** Re-encodes an image as webp (keeps alpha). */
export async function toWebp(buf: Buffer, opts: WebpOpts = {}): Promise<Buffer> {
  return sharp(buf)
    .webp(opts.lossless ? { lossless: true } : { quality: opts.quality ?? 90 })
    .toBuffer()
}

/** The share (0 to 1) of an image's pixels that are clearly transparent (alpha under 250). An image with no alpha channel has none. */
export async function transparentShare(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.channels < 4) return 0
  let clear = 0
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 250) clear++
  return clear / (data.length / 4)
}

interface Raw {
  data: Buffer
  width: number
  height: number
}

async function toRawRgba(buf: Buffer): Promise<Raw> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

function fromRawRgba(raw: Raw): ReturnType<typeof sharp> {
  return sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
}

/** Trims transparent borders and scales to `targetHeight`, as webp with alpha. */
export async function prepareSprite(buf: Buffer, opts: { targetHeight: number; alphaThreshold?: number; quality?: number }): Promise<Buffer> {
  const raw = await toRawRgba(buf)
  const threshold = opts.alphaThreshold ?? 8
  let minX = raw.width
  let minY = raw.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < raw.height; y++) {
    for (let x = 0; x < raw.width; x++) {
      if ((raw.data[(y * raw.width + x) * 4 + 3] ?? 0) > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw new Error('sprite is fully transparent after background removal')
  return fromRawRgba(raw)
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .resize({ height: opts.targetHeight, fit: 'inside' })
    .webp({ quality: opts.quality ?? 92, alphaQuality: 100 })
    .toBuffer()
}

/**
 * Keeps the main figure of a cut-out: the largest connected area of visible pixels, plus the small pieces that sit next to it
 * (a hat, a hand, a tail tip: at least `minFraction` (1%) of its area and inside its bounding box grown by `margin`). Everything
 * else (stray islands, a second figure, label fragments) becomes transparent. Returns a PNG.
 */
export async function keepMainSubject(buf: Buffer, opts: { alphaThreshold?: number; minFraction?: number; margin?: number } = {}): Promise<Buffer> {
  const raw = await toRawRgba(buf)
  const { data, width, height } = raw
  const threshold = opts.alphaThreshold ?? 8
  const minFraction = opts.minFraction ?? 0.01
  const margin = opts.margin ?? 0.1
  const label = new Int32Array(width * height) // 0: transparent, else component id (1-based)
  const comps: { area: number; minX: number; minY: number; maxX: number; maxY: number }[] = []
  const stack: number[] = []
  for (let start = 0; start < width * height; start++) {
    if (label[start] !== 0 || (data[start * 4 + 3] ?? 0) <= threshold) continue
    const id = comps.length + 1
    const c = { area: 0, minX: width, minY: height, maxX: 0, maxY: 0 }
    comps.push(c)
    label[start] = id
    stack.push(start)
    while (stack.length) {
      const i = stack.pop()!
      const x = i % width
      const y = (i - x) / width
      c.area++
      if (x < c.minX) c.minX = x
      if (x > c.maxX) c.maxX = x
      if (y < c.minY) c.minY = y
      if (y > c.maxY) c.maxY = y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = ny * width + nx
          if (label[j] === 0 && (data[j * 4 + 3] ?? 0) > threshold) {
            label[j] = id
            stack.push(j)
          }
        }
      }
    }
  }
  if (comps.length <= 1) return fromRawRgba(raw).png().toBuffer()
  let main = 0
  comps.forEach((c, i) => {
    if (c.area > comps[main]!.area) main = i
  })
  const m = comps[main]!
  const mx = (m.maxX - m.minX) * margin
  const my = (m.maxY - m.minY) * margin
  const keep = comps.map((c, i) => i === main || (c.area >= m.area * minFraction && c.minX >= m.minX - mx && c.maxX <= m.maxX + mx && c.minY >= m.minY - my && c.maxY <= m.maxY + my))
  for (let i = 0; i < width * height; i++) {
    const id = label[i]!
    if (id !== 0 && !keep[id - 1]) data[i * 4 + 3] = 0
  }
  return fromRawRgba(raw).png().toBuffer()
}

/**
 * Fallback background removal for a flat-coloured background: flood fill from every edge pixel that is within
 * `tolerance` (max channel difference) of the background colour, and make the filled area transparent. Returns a PNG.
 * The background colour is the average of the four corners unless `background` is given.
 */
export async function keyOutFlatBackground(buf: Buffer, opts: { tolerance?: number; background?: Rgb; feather?: boolean } = {}): Promise<Buffer> {
  const raw = await toRawRgba(buf)
  const { data, width, height } = raw
  const tolerance = opts.tolerance ?? 40
  const px = (x: number, y: number) => (y * width + x) * 4
  let bg = opts.background
  if (!bg) {
    const corners = [px(0, 0), px(width - 1, 0), px(0, height - 1), px(width - 1, height - 1)]
    bg = [0, 1, 2].map((c) => Math.round(corners.reduce((s, i) => s + (data[i + c] ?? 0), 0) / 4)) as Rgb
  }
  const near = (i: number) =>
    Math.abs((data[i] ?? 0) - bg[0]) <= tolerance &&
    Math.abs((data[i + 1] ?? 0) - bg[1]) <= tolerance &&
    Math.abs((data[i + 2] ?? 0) - bg[2]) <= tolerance
  const visited = new Uint8Array(width * height)
  const stack: number[] = []
  const push = (x: number, y: number) => {
    const k = y * width + x
    if (visited[k] || !near(k * 4)) return
    visited[k] = 1
    stack.push(k)
  }
  for (let x = 0; x < width; x++) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    push(0, y)
    push(width - 1, y)
  }
  while (stack.length > 0) {
    const k = stack.pop()!
    const x = k % width
    const y = (k - x) / width
    if (x > 0) push(x - 1, y)
    if (x < width - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < height - 1) push(x, y + 1)
  }
  for (let k = 0; k < visited.length; k++) if (visited[k]) data[k * 4 + 3] = 0
  // Soften the one-pixel rim next to the removed area so light halos blend instead of showing as a hard edge.
  if (opts.feather !== false) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const k = y * width + x
        if (visited[k]) continue
        const touches = (x > 0 && visited[k - 1]) || (x < width - 1 && visited[k + 1]) || (y > 0 && visited[k - width]) || (y < height - 1 && visited[k + width])
        if (touches) data[k * 4 + 3] = Math.min(data[k * 4 + 3] ?? 255, 160)
      }
    }
  }
  return fromRawRgba(raw).png().toBuffer()
}

function nearestColour(palette: Rgb[], r: number, g: number, b: number): Rgb {
  let best = palette[0]!
  let bestD = Infinity
  for (const c of palette) {
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2
    if (d < bestD) {
      bestD = d
      best = c
      if (d === 0) break
    }
  }
  return best
}

/**
 * Pixel-art post-process: area-average downscale by `scale`, quantise to `palette` (nearest colour in RGB; alpha
 * becomes 0 or 255 at `alphaThreshold`), then nearest-neighbour upscale back to the original size. Returns a PNG.
 */
export async function pixelate(buf: Buffer, opts: { scale: number; palette?: Rgb[]; alphaThreshold?: number; exactScale?: boolean }): Promise<Buffer> {
  const { scale } = opts
  if (!(scale >= 1)) throw new Error('pixelate: scale must be >= 1')
  const alphaThreshold = opts.alphaThreshold ?? 128
  const raw = await toRawRgba(buf)
  const sw = Math.max(1, Math.round(raw.width / scale))
  const sh = Math.max(1, Math.round(raw.height / scale))
  const small = Buffer.alloc(sw * sh * 4)
  const cache = new Map<number, Rgb>()
  for (let by = 0; by < sh; by++) {
    const y0 = Math.floor((by * raw.height) / sh)
    const y1 = Math.max(y0 + 1, Math.floor(((by + 1) * raw.height) / sh))
    for (let bx = 0; bx < sw; bx++) {
      const x0 = Math.floor((bx * raw.width) / sw)
      const x1 = Math.max(x0 + 1, Math.floor(((bx + 1) * raw.width) / sw))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * raw.width + x) * 4
          const al = raw.data[i + 3] ?? 0
          r += (raw.data[i] ?? 0) * al
          g += (raw.data[i + 1] ?? 0) * al
          b += (raw.data[i + 2] ?? 0) * al
          a += al
          n++
        }
      }
      if (a === 0) continue
      const o = (by * sw + bx) * 4
      let cr = Math.round(r / a)
      let cg = Math.round(g / a)
      let cb = Math.round(b / a)
      if (opts.palette && opts.palette.length > 0) {
        const key = (cr << 16) | (cg << 8) | cb
        let hit = cache.get(key)
        if (!hit) {
          hit = nearestColour(opts.palette, cr, cg, cb)
          cache.set(key, hit)
        }
        cr = hit[0]
        cg = hit[1]
        cb = hit[2]
      }
      small[o] = cr
      small[o + 1] = cg
      small[o + 2] = cb
      small[o + 3] = a / n >= alphaThreshold ? 255 : 0
    }
  }
  return sharp(small, { raw: { width: sw, height: sh, channels: 4 } })
    // exactScale: the result is the small image times a whole-number scale, so every pixel is the same size
    .resize(opts.exactScale ? sw * Math.round(scale) : raw.width, opts.exactScale ? sh * Math.round(scale) : raw.height, { kernel: 'nearest' })
    .png()
    .toBuffer()
}
