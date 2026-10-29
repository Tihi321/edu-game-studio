import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateAsset } from '../src/engine/assets/generate'
import { assetDir, resolveFile } from '../src/engine/assets/manifest'
import { loadPalette } from '../src/engine/assets/palettes'
import { pixelateWithStudio } from '../src/engine/studios/pixelate'
import { entryOf, figurePng, genKit, SEED_PALETTES } from './assets-fixtures'
import type { GenKit } from './assets-fixtures'
import { FakePixel } from './studio-fakes'

/**
 * Ported from VN Studio's `studios-generate` test: the Pixel Studio part (the music part comes with EGS-16). Pixel Studio makes the pixel art of
 * the RPG tiles and sprites; when it is down the built-in pixelate runs, with a warning on the asset.
 */

describe('pixel art with Pixel Studio', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'edu-px-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('converts an image with import_image and export_many: the exact size asked for, a native copy at the grid size, the palette as hex', async () => {
    const px = new FakePixel()
    const palette = await loadPalette(SEED_PALETTES, 'db16')
    const r = await pixelateWithStudio(px, await figurePng(1024, 1024), { tmpRoot: tmp, grid: { w: 128, h: 128 }, out: { w: 512, h: 512 }, palette, dither: 'none', name: 'tiles' })
    expect(await sharp(r.png).metadata()).toMatchObject({ width: 512, height: 512 })
    expect(await sharp(r.native).metadata()).toMatchObject({ width: 128, height: 128 })
    const imp = px.calls.find((c) => c.tool === 'import_image')!.args as { width: number; height: number; palette: string[]; dither: string; cleanup: boolean; name: string }
    expect(imp).toMatchObject({ width: 128, height: 128, dither: 'none', cleanup: true, name: 'tiles' })
    expect(imp.palette).toHaveLength(16)
    expect(imp.palette[0]).toMatch(/^#[0-9a-f]{6}$/)
    const exp = px.calls.find((c) => c.tool === 'export_many')!.args as { width?: number; scale?: number }[]
    expect(exp[0]).toMatchObject({ width: 512, height: 512 })
    expect(exp[1]).toMatchObject({ scale: 1 })
  })

  it('a studio that is down throws a studio error (the caller falls back to the built-in pixelate)', async () => {
    const px = new FakePixel()
    px.down = true
    await expect(pixelateWithStudio(px, await figurePng(64, 64), { tmpRoot: tmp, grid: { w: 16, h: 16 } })).rejects.toThrow(/not running/)
  })
})

describe('RPG art through Pixel Studio', () => {
  let kit: GenKit
  beforeEach(async () => {
    kit = await genKit()
  })
  afterEach(async () => {
    await kit.done()
  })

  it('a tile set and a sprite go through Pixel Studio by default; the built-in pixelate runs for them when it is down, with a warning on the asset', async () => {
    const tiles = await generateAsset(kit.ctx({ pixel: kit.pixel }), entryOf('img-rpg-tiles', 'tileset'))
    const hero = await generateAsset(kit.ctx({ pixel: kit.pixel }), entryOf('img-rpg-hero', 'sprite'))
    expect(tiles.ok && hero.ok).toBe(true)
    expect(kit.pixel.calls.filter((c) => c.tool === 'import_image')).toHaveLength(2)
    kit.pixel.down = true
    const down = await generateAsset(kit.ctx({ pixel: kit.pixel }), entryOf('img-rpg-npc-1', 'sprite'))
    if (!down.ok || down.skipped) throw new Error('expected a version')
    expect(down.version.warnings?.some((w) => /Pixel Studio could not convert the image/.test(w))).toBe(true)
    expect(down.version.nativeFile).toBeUndefined()
    expect((await sharp(await readFile(resolveFile(kit.dir, down.entry)!)).metadata()).height! % 6).toBe(0)
  })

  it('the course can say builtin: Pixel Studio is not asked at all', async () => {
    await generateAsset(kit.ctx({ media: { art: { pixelProvider: 'builtin' } }, pixel: kit.pixel }), entryOf('img-rpg-tiles', 'tileset'))
    expect(kit.pixel.calls).toHaveLength(0)
  })

  it('the pixel art is exported at the native grid times the factor; nothing is left in the temporary folder', async () => {
    const r = await generateAsset(kit.ctx({ pixel: kit.pixel }), entryOf('img-rpg-tiles', 'tileset'))
    if (!r.ok || r.skipped) throw new Error('expected a version')
    const native = await sharp(await readFile(path.join(assetDir(kit.dir, 'img-rpg-tiles'), r.version.nativeFile!))).metadata()
    expect(native).toMatchObject({ width: 128, height: 128 })
    const { existsSync, readdirSync } = await import('node:fs')
    const tmpRoot = path.join(kit.dir, '..', '.tmp')
    expect(!existsSync(tmpRoot) || readdirSync(tmpRoot).length === 0).toBe(true)
  })
})
