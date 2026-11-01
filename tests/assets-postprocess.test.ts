import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { loadPalette, type Rgb } from '../src/engine/assets/palettes'
import { fitBackground, keyOutFlatBackground, pixelate, prepareSprite } from '../src/engine/assets/postprocess'

const SEED_PALETTES = path.resolve(__dirname, '..', 'seed', 'palettes')

/** White background with a red filled circle. */
async function circleImage(w = 200, h = 300, bg = '#ffffff'): Promise<Buffer> {
  const r = Math.min(w, h) / 4
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/><circle cx="${w / 2}" cy="${h / 2}" r="${r}" fill="#e02020"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function rgba(buf: Buffer) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, at: (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)) }
}

describe('fitBackground', () => {
  it('cover-crops to the exact size as webp', async () => {
    const out = await fitBackground(await circleImage(400, 200), 320, 180)
    const meta = await sharp(out).metadata()
    expect(meta).toMatchObject({ format: 'webp', width: 320, height: 180 })
  })
})

describe('keyOutFlatBackground', () => {
  it('makes the flat white background transparent and keeps the subject opaque', async () => {
    const out = await keyOutFlatBackground(await circleImage())
    const img = await rgba(out)
    expect(img.at(2, 2)[3]).toBe(0)
    expect(img.at(197, 297)[3]).toBe(0)
    expect(img.at(100, 150)).toEqual([224, 32, 32, 255])
  })
})

describe('prepareSprite', () => {
  it('trims transparent bounds and scales to the target height with alpha kept', async () => {
    const keyed = await keyOutFlatBackground(await circleImage(200, 300))
    const out = await prepareSprite(keyed, { targetHeight: 100 })
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.hasAlpha).toBe(true)
    expect(meta.height).toBe(100)
    expect(meta.width).toBeGreaterThanOrEqual(98)
    expect(meta.width).toBeLessThanOrEqual(102) // a circle is about as wide as tall
    const img = await rgba(out)
    expect(img.at(Math.floor(img.width / 2), 50)[3]).toBe(255)
    expect(img.at(0, 0)[3]).toBe(0) // the corner outside the circle
  })
})

describe('pixelate', () => {
  it('keeps the size, makes blocks and uses only palette colours', async () => {
    const palette = await loadPalette(SEED_PALETTES, 'pico-8')
    // a smooth gradient
    const w = 64
    const h = 64
    const raw = Buffer.alloc(w * h * 3)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([x * 4, y * 4, 128], (y * w + x) * 3)
    const src = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
    const out = await pixelate(src, { scale: 8, palette })
    const img = await rgba(out)
    expect(img.width).toBe(w)
    expect(img.height).toBe(h)
    const allowed = new Set(palette.map((c: Rgb) => c.join(',')))
    const seen = new Set<string>()
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i + 3]).toBe(255)
      seen.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`)
    }
    for (const c of seen) expect(allowed.has(c)).toBe(true)
    // 8x8 blocks are flat
    for (let by = 0; by < 8; by++) for (let bx = 0; bx < 8; bx++) {
      const first = img.at(bx * 8, by * 8)
      expect(img.at(bx * 8 + 7, by * 8 + 7)).toEqual(first)
      expect(img.at(bx * 8 + 3, by * 8 + 5)).toEqual(first)
    }
  })
})
