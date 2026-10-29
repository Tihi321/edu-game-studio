import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { listPalettes, loadPalette, parseHexPalette, type Rgb } from '../src/engine/assets/palettes'
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

describe('palettes', () => {
  it('parses hex files and loads the seeded palettes', async () => {
    expect(parseHexPalette('#FF0000\n00ff00\r\n\nnot-a-colour\n')).toEqual([[255, 0, 0], [0, 255, 0]])
    const names = await listPalettes(SEED_PALETTES)
    expect(names).toEqual(expect.arrayContaining(['pico-8', 'db32', 'gameboy', 'nes']))
    expect(await loadPalette(SEED_PALETTES, 'gameboy')).toHaveLength(4)
    expect(await loadPalette(SEED_PALETTES, 'pico-8')).toHaveLength(16)
    await expect(loadPalette(SEED_PALETTES, 'nope')).rejects.toThrow(/not found/)
    await expect(loadPalette(SEED_PALETTES, '../x')).rejects.toThrow(/invalid palette name/)
  })
})

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

  it('does not remove a white area that does not touch the edge', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100%" height="100%" fill="#fff"/><circle cx="50" cy="50" r="40" fill="#222"/><circle cx="50" cy="50" r="10" fill="#fff"/></svg>`
    const out = await keyOutFlatBackground(await sharp(Buffer.from(svg)).png().toBuffer())
    const img = await rgba(out)
    expect(img.at(1, 1)[3]).toBe(0)
    expect(img.at(50, 50)[3]).toBe(255) // the inner white disc is enclosed, so it stays
  })

  it('works with a non-white flat colour', async () => {
    const img = await rgba(await keyOutFlatBackground(await circleImage(100, 100, '#dde8ff')))
    expect(img.at(1, 1)[3]).toBe(0)
    expect(img.at(50, 50)[3]).toBe(255)
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

  it('throws on a fully transparent image', async () => {
    const empty = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    await expect(prepareSprite(empty, { targetHeight: 10 })).rejects.toThrow(/transparent/)
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

  it('thresholds alpha to 0 or 255 and leaves transparent areas empty', async () => {
    const keyed = await keyOutFlatBackground(await circleImage(64, 64))
    const out = await pixelate(keyed, { scale: 4, palette: await loadPalette(SEED_PALETTES, 'gameboy') })
    const img = await rgba(out)
    for (let i = 3; i < img.data.length; i += 4) expect([0, 255]).toContain(img.data[i])
    expect(img.at(0, 0)[3]).toBe(0)
    expect(img.at(32, 32)[3]).toBe(255)
  })

  it('without a palette only pixelates', async () => {
    const out = await pixelate(await circleImage(40, 40), { scale: 10 })
    expect((await sharp(out).metadata()).width).toBe(40)
    await expect(pixelate(await circleImage(40, 40), { scale: 0 })).rejects.toThrow(/scale/)
  })
})
