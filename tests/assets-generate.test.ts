import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hotspotSizes } from '../src/shared/art'
import { finishImage, generateAll, generateAsset, QWEN_REMOVE_BG_PROMPT } from '../src/engine/assets/generate'
import { assetDir, getEntry, loadManifest, resolveFile, saveManifest, setCustom } from '../src/engine/assets/manifest'
import { dropPlaceholder, placeholderSvg, regionsSvg, writePlaceholder, PLACEHOLDER_FILE } from '../src/engine/assets/placeholder'
import { parseHexPalette } from '../src/engine/assets/palettes'
import { coloursOf, entryOf, figurePng, genKit, SEED_PALETTES } from './assets-fixtures'
import type { GenKit } from './assets-fixtures'
import type { AssetEntry } from '../src/shared/media'

/**
 * Ported from VN Studio's `assets-generate` test and adapted to a course: the kinds are background, illustration, sprite and tile set (no book,
 * no character sheets), the sizes are the art plan's, and a picture that cannot be made gets a placeholder (`onFailure`).
 */

let kit: GenKit
beforeEach(async () => {
  kit = await genKit()
})
afterEach(async () => {
  await kit.done()
})

const must = async (p: ReturnType<typeof generateAsset>) => {
  const r = await p
  if (!r.ok || r.skipped) throw new Error(`expected a version: ${JSON.stringify(r)}`)
  return r
}
const fileOf = async (dir: string, e: AssetEntry) => readFile(resolveFile(dir, e)!)

describe('generateAsset: pictures', () => {
  it('a background: made at 1664x928, cover-cropped to 1280x720 webp, recorded and selected', async () => {
    const r = await must(generateAsset(kit.ctx(), entryOf('img-quiz-arena-bg-u1', 'background'), { seed: 11 }))
    expect(r.version).toMatchObject({ n: 1, file: 'v1.webp', seed: 11, engine: 'qwen-image-2.1', createdAt: '2026-02-03T04:05:06.000Z' })
    expect(r.entry).toMatchObject({ selected: 1, source: 'generated' })
    const file = resolveFile(kit.dir, r.entry)!
    expect(file).toBe(path.join(assetDir(kit.dir, 'img-quiz-arena-bg-u1'), 'v1.webp'))
    expect(await sharp(await readFile(file)).metadata()).toMatchObject({ format: 'webp', width: 1280, height: 720 })
    expect(kit.comfy.requests[0]).toMatchObject({ engine: 'qwen-image-2.1', width: 1664, height: 928, seed: 11 })
    expect(kit.comfy.requests[0]!.negative).toMatch(/watermark/)
    expect(kit.comfy.requests[0]!.negative).toMatch(/letters/) // a picture never has text in it
  })

  it('an article picture (an illustration) is 4:3: made at 1152x864, fitted to 960x720', async () => {
    const r = await must(generateAsset(kit.ctx(), entryOf('img-article-a-u1-1', 'illustration')))
    expect(kit.comfy.requests[0]).toMatchObject({ width: 1152, height: 864 })
    expect(await sharp(await fileOf(kit.dir, r.entry)).metadata()).toMatchObject({ width: 960, height: 720 })
  })

  it('uses the entry prompt, numbers new versions, and adds the critic\'s words to one run only', async () => {
    const e = { ...entryOf('img-article-a-u1-1', 'illustration'), prompt: 'a dusty attic' }
    const first = await must(generateAsset(kit.ctx(), e))
    const second = await must(generateAsset(kit.ctx(), first.entry, { force: true, prompt: 'a tidy attic', extraPrompt: 'Correct this: show the whole room.' }))
    expect(kit.comfy.requests.map((r) => r.prompt)).toEqual(['a dusty attic', 'a tidy attic. Correct this: show the whole room.'])
    expect(second.entry.versions.map((v) => v.n)).toEqual([1, 2])
    expect(second.entry).toMatchObject({ selected: 2, prompt: 'a tidy attic' }) // the note is on the version, not on the entry
    expect(second.version.prompt).toContain('Correct this')
  })

  it('a prompt that is empty is made from the alt text and the style', async () => {
    await must(generateAsset(kit.ctx(), entryOf('img-article-a-u1-1', 'illustration', { prompt: '', alt: 'A Roman road' })))
    expect(kit.comfy.requests[0]!.prompt).toMatch(/A Roman road/)
  })

  it('returns an error result instead of throwing when ComfyUI fails, and leaves the entry unchanged', async () => {
    kit.comfy.fail.add('boom')
    const e = entryOf('img-article-a-u1-1', 'illustration', { prompt: 'boom' })
    const r = await generateAsset(kit.ctx(), e)
    expect(r).toEqual({ ok: false, entry: e, error: 'ComfyUI exploded' })
  })

  it('skips locked and custom assets unless forced, and what is not a picture', async () => {
    const locked = entryOf('a', 'illustration', { locked: true })
    expect(await generateAsset(kit.ctx(), locked)).toMatchObject({ ok: true, skipped: true, reason: 'locked' })
    const custom = entryOf('b', 'illustration', { source: 'custom', customFile: 'custom.png' })
    expect(await generateAsset(kit.ctx(), custom)).toMatchObject({ ok: true, skipped: true, reason: 'custom file' })
    expect(kit.comfy.requests).toHaveLength(0)
    expect(await generateAsset(kit.ctx(), locked, { force: true })).toMatchObject({ ok: true, skipped: false })
    expect(await generateAsset(kit.ctx(), entryOf('voice-x', 'voiceRef'))).toMatchObject({ ok: true, skipped: true, reason: expect.stringMatching(/EGS-17/) }) // voice is the next ticket
    expect(await generateAsset(kit.ctx(), entryOf('sheet-x', 'sheet'))).toMatchObject({ ok: true, skipped: true })
  })

  it('hand-made art (provider: hand) never calls ComfyUI: the asset fails with the reason', async () => {
    const r = await generateAsset(kit.ctx({ media: { art: { provider: 'hand' } } }), entryOf('a', 'illustration'))
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/made by hand/) })
    expect(kit.comfy.requests).toHaveLength(0)
  })

  it('draws the regions of a hotspot item faintly over its picture, at the size of the item', async () => {
    const regions = [{ shape: { type: 'rect' as const, x: 100, y: 100, w: 200, h: 150 } }, { shape: { type: 'circle' as const, cx: 600, cy: 300, r: 80 } }]
    const sizes = hotspotSizes(800, 500)
    const e = entryOf('map', 'illustration', { size: sizes.size, fit: sizes.fit })
    const plain = await must(generateAsset(kit.ctx(), { ...e, id: 'map-plain' }, { seed: 3 })) // another asset folder: both would write v1.webp
    const drawn = await must(generateAsset(kit.ctx({ hotspotOf: (id) => (id === 'map' ? { width: 800, height: 500, regions } : null) }), e, { seed: 3 }))
    const pixel = async (buf: Buffer) => (await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }))
    const a = await pixel(await fileOf(kit.dir, plain.entry))
    const b = await pixel(await fileOf(kit.dir, drawn.entry))
    expect(a.info).toMatchObject({ width: 800, height: 500 })
    expect(b.info).toMatchObject({ width: 800, height: 500 })
    const at = (img: typeof a, x: number, y: number) => img.data[(y * img.info.width + x) * 4]! // the red channel
    const row = (img: typeof a, y: number) => Array.from({ length: 180 }, (_, i) => at(img, 110 + i, y)).reduce((s, v) => s + v, 0) / 180
    expect(row(b, 100)).toBeGreaterThan(row(a, 100) + 15) // along the top edge of the rectangle (a dashed outline): lighter
    expect(row(b, 175)).toBeLessThan(row(a, 175) + 20) // inside it only a very light fill
    // no text: the overlay is outlines only
    expect(regionsSvg(800, 500, regions)).not.toMatch(/<text/)
  })
})

describe('generateAsset: sprites and pixel art', () => {
  const sprite = () => entryOf('img-rpg-hero', 'sprite')

  it('a sprite: the figure is cut out with the flat-colour key when ComfyUI has no removal model, trimmed, and warned about', async () => {
    const r = await must(generateAsset(kit.ctx(), sprite()))
    expect(kit.comfy.removalCalls).toBe(1)
    expect(r.warnings?.some((w) => /no BiRefNet/.test(w))).toBe(true)
    const buf = await fileOf(kit.dir, r.entry)
    const meta = await sharp(buf).metadata()
    expect(meta).toMatchObject({ format: 'webp', hasAlpha: true })
    expect(meta.height! % 6).toBe(0) // pixel art: whole art pixels of 6 screen pixels
    const raw = await sharp(buf).ensureAlpha().raw().toBuffer()
    expect(raw[3]).toBe(0) // the corner is transparent
    // Pixel Studio is the default provider of RPG art, but none was given: the built-in pixelate ran, with a warning
    expect(r.warnings?.some((w) => /Pixel Studio is not configured/.test(w))).toBe(true)
  })

  it('with Pixel Studio: import_image and export_many make the pixel art, and the native copy is kept for "Open in Pixel Studio"', async () => {
    const r = await must(generateAsset(kit.ctx({ pixel: kit.pixel }), sprite()))
    expect(kit.pixel.calls.map((c) => c.tool)).toEqual(['import_image', 'export_many'])
    expect(r.version.nativeFile).toBe('v1.px.png')
    const native = await sharp(await readFile(path.join(assetDir(kit.dir, 'img-rpg-hero'), 'v1.px.png'))).metadata()
    const final = await sharp(await fileOf(kit.dir, r.entry)).metadata()
    expect(final.height).toBe(native.height! * 6) // the final picture is the native one scaled up by a whole factor
    expect(final.width).toBe(native.width! * 6)
    expect(r.warnings?.some((w) => /Pixel Studio/.test(w))).toBeFalsy()
  })

  it('a tile set is a square 512x512 picture in the palette (the course palette, else db32), through the built-in pixelate when the course says so', async () => {
    const r = await must(generateAsset(kit.ctx({ media: { art: { pixelProvider: 'builtin', palette: 'pico-8' } }, pixel: kit.pixel }), entryOf('img-rpg-tiles', 'tileset')))
    expect(kit.pixel.calls).toHaveLength(0) // builtin: Pixel Studio is not asked
    const buf = await fileOf(kit.dir, r.entry)
    expect(await sharp(buf).metadata()).toMatchObject({ width: 512, height: 512 })
    const palette = new Set(parseHexPalette(await readFile(path.join(SEED_PALETTES, 'pico-8.hex'), 'utf8')).map((c) => c.map((v) => v.toString(16).padStart(2, '0')).join('')))
    const used = await coloursOf(buf)
    expect(used.size).toBeGreaterThan(0)
    for (const c of used) expect(palette.has(c), c).toBe(true)
  })

  it('the default palette of pixel art is db32; a palette that does not exist is a warning, not a failure', async () => {
    const ok = await must(generateAsset(kit.ctx({ media: { art: { pixelProvider: 'builtin' } } }), entryOf('img-rpg-tiles', 'tileset')))
    const db32 = new Set(parseHexPalette(await readFile(path.join(SEED_PALETTES, 'db32.hex'), 'utf8')).map((c) => c.map((v) => v.toString(16).padStart(2, '0')).join('')))
    for (const c of await coloursOf(await fileOf(kit.dir, ok.entry))) expect(db32.has(c), c).toBe(true)
    const bad = await must(generateAsset(kit.ctx({ media: { art: { pixelProvider: 'builtin', palette: 'no-such-palette' } } }), entryOf('img-rpg-tiles2', 'tileset')))
    expect(bad.warnings?.some((w) => /no-such-palette/.test(w))).toBe(true)
  })

  it('Pixel Studio down: the built-in pixelate makes the image and a warning stays on the version (the asset is not failed)', async () => {
    kit.pixel.down = true
    const r = await must(generateAsset(kit.ctx({ pixel: kit.pixel }), entryOf('img-rpg-tiles', 'tileset')))
    expect(r.version.warnings?.some((w) => /Pixel Studio could not convert the image/.test(w) && /used the built-in pixelate/.test(w))).toBe(true)
    expect(r.version.nativeFile).toBeUndefined()
    expect(await sharp(await fileOf(kit.dir, r.entry)).metadata()).toMatchObject({ width: 512, height: 512 })
  })

  it('an illustrated course keeps its pictures as they are (no pixel art); only an RPG tile set or sprite is pixel art', async () => {
    const r = await must(generateAsset(kit.ctx({ pixel: kit.pixel }), entryOf('img-article-a-u1-1', 'illustration')))
    expect(kit.pixel.calls).toHaveLength(0)
    expect(r.version.nativeFile).toBeUndefined()
    const pix = await must(generateAsset(kit.ctx({ media: { art: { style: 'pixel', pixelProvider: 'builtin' } } }), entryOf('img-article-a-u1-2', 'illustration')))
    expect((await coloursOf(await fileOf(kit.dir, pix.entry))).size).toBeLessThanOrEqual(32)
  })

  describe('art.bgRemoval', () => {
    it('birefnet (default): the removal result is used', async () => {
      kit.comfy.removal = 'ok'
      const r = await must(generateAsset(kit.ctx(), sprite()))
      expect(kit.comfy.removalCalls).toBe(1)
      expect(r.warnings?.some((w) => /BiRefNet/.test(w))).toBeFalsy()
    })
    it('birefnet that throws falls back to the flat-colour key and reports a warning', async () => {
      kit.comfy.removal = 'throws'
      const r = await must(generateAsset(kit.ctx(), sprite()))
      expect(r.warnings?.some((w) => /BiRefNet background removal failed \(rmbg failed\); used the flat-colour key/.test(w))).toBe(true)
    })
    it('key never asks ComfyUI to remove anything', async () => {
      const r = await must(generateAsset(kit.ctx({ media: { art: { bgRemoval: 'key' } } }), sprite()))
      expect(kit.comfy.removalCalls).toBe(0)
      expect(r.version.warnings?.some((w) => /BiRefNet/.test(w))).toBeFalsy()
    })
    it('qwen-edit uses the edit output directly when it has real alpha, and falls back to BiRefNet when the edit fails', async () => {
      const cut = await sharp({ create: { width: 232, height: 416, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: await sharp({ create: { width: 80, height: 200, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), left: 70, top: 100 }])
        .png()
        .toBuffer()
      const generate = kit.comfy.generate.bind(kit.comfy)
      kit.comfy.generate = async (req) => {
        if (req.prompt !== QWEN_REMOVE_BG_PROMPT) return generate(req)
        kit.comfy.requests.push(req)
        return { bytes: cut, ext: 'png', kind: 'image', seed: 1, engine: req.engine, lane: 'l', promptId: 'p' }
      }
      const r = await must(generateAsset(kit.ctx({ media: { art: { bgRemoval: 'qwen-edit' } } }), sprite()))
      expect(kit.comfy.requests.some((q) => q.prompt === QWEN_REMOVE_BG_PROMPT && q.engine === 'qwen-image-2.1-edit')).toBe(true)
      expect(kit.comfy.removalCalls).toBe(0)
      expect(r.version.file).toBe('v1.webp')
      kit.comfy.generate = async (req) => {
        if (req.prompt === QWEN_REMOVE_BG_PROMPT) throw new Error('qwen exploded')
        return generate(req)
      }
      kit.comfy.removal = 'ok'
      const r2 = await must(generateAsset(kit.ctx({ media: { art: { bgRemoval: 'qwen-edit' } } }), entryOf('img-rpg-npc-1', 'sprite')))
      expect(r2.warnings?.some((w) => /Qwen background-removal edit failed \(qwen exploded\)/.test(w))).toBe(true)
      expect(kit.comfy.removalCalls).toBe(1)
    })
  })
})

describe('finishImage', () => {
  it('fits any picture to its final size, and keeps a sheet as it is', async () => {
    const f = await finishImage(kit.ctx(), entryOf('a', 'background'), await figurePng(800, 400))
    expect(await sharp(f.bytes).metadata()).toMatchObject({ format: 'webp', width: 1280, height: 720 })
    const s = await finishImage(kit.ctx(), entryOf('b', 'sheet'), await figurePng())
    expect(s.ext).toBe('png')
  })
  it('a final size of the entry (a hotspot picture) wins over the size of its kind', async () => {
    const f = await finishImage(kit.ctx(), entryOf('a', 'illustration', { fit: { w: 640, h: 480 } }), await figurePng(800, 400))
    expect(await sharp(f.bytes).metadata()).toMatchObject({ width: 640, height: 480 })
  })
})

describe('placeholders', () => {
  it('a placeholder is a real file named placeholder.svg; a version removes it', async () => {
    const e = entryOf('img-article-a-u1-1', 'illustration', { alt: 'A Roman road at dawn' })
    const withPh = await writePlaceholder(kit.dir, e, 'ComfyUI is down')
    expect(withPh.placeholder).toEqual({ file: PLACEHOLDER_FILE, reason: 'ComfyUI is down' })
    const file = path.join(assetDir(kit.dir, e.id), PLACEHOLDER_FILE)
    const svg = await readFile(file, 'utf8')
    expect(svg).toMatch(/^<svg /)
    expect(svg).toContain('A Roman road at dawn')
    expect(svg).toContain('960')
    expect(resolveFile(kit.dir, withPh)).toBeNull() // no real file
    const made = await must(generateAsset(kit.ctx(), withPh))
    expect(made.entry.placeholder).toBeUndefined()
    expect(existsSync(file)).toBe(false)
    expect(resolveFile(kit.dir, made.entry)).not.toBeNull()
  })
  it('dropPlaceholder is a no-op without one, and the card escapes the text it shows', async () => {
    const e = entryOf('a', 'illustration', { alt: 'Tom & <Jerry> "ran"' })
    expect(await dropPlaceholder(kit.dir, e)).toBe(e)
    const svg = placeholderSvg(e)
    expect(svg).toContain('Tom &amp; &lt;Jerry&gt; &quot;ran&quot;')
    expect(svg).not.toContain('<Jerry>')
  })
})

describe('generateAll', () => {
  const manifestOf = (...entries: AssetEntry[]) => ({ assets: entries })

  it('makes backgrounds before pictures before sprites, continues after a failure (a placeholder stands in), saves after each asset and resumes', async () => {
    kit.comfy.fail.add('broken')
    const m = manifestOf(entryOf('spr', 'sprite'), entryOf('ill', 'illustration', { prompt: 'broken' }), entryOf('bg', 'background'), entryOf('mus', 'music'))
    await saveManifest(kit.dir, m)
    const saves: number[] = []
    const r = await generateAll(kit.ctx(), m, {
      onFailure: (entry, error) => writePlaceholder(kit.dir, entry, error),
      commit: async (entry) => {
        const cur = await loadManifest(kit.dir)
        const next = { assets: cur.assets.map((e) => (e.id === entry.id ? entry : e)) }
        await saveManifest(kit.dir, next)
        saves.push(next.assets.filter((e) => e.versions.length || e.placeholder).length)
        return next
      }
    })
    expect(r.generated).toEqual(['bg', 'spr']) // order: background, (illustration failed), sprite; the music entry is not a picture
    expect(r.failed).toEqual([{ id: 'ill', error: 'ComfyUI exploded' }])
    expect(saves).toEqual([1, 2, 3]) // saved after each one, the placeholder included
    const stored = await loadManifest(kit.dir)
    expect(getEntry(stored, 'ill')!.placeholder).toMatchObject({ reason: 'ComfyUI exploded' })
    expect(getEntry(stored, 'bg')!.selected).toBe(1)
    // resume: what has a file is not made again; the failed one is tried again
    kit.comfy.fail.clear()
    const again = await generateAll(kit.ctx(), stored, {})
    expect(again.skipped.sort()).toEqual(['bg', 'spr'])
    expect(again.generated).toEqual(['ill'])
    expect(getEntry(again.manifest, 'ill')!.placeholder).toBeUndefined()
    expect(kit.comfy.requests.filter((q) => (q.prompt ?? '').includes('subject for bg'))).toHaveLength(1)
  })

  it('honours ids, exclude, force and the critic\'s notes', async () => {
    const m = manifestOf(entryOf('a', 'illustration'), entryOf('b', 'illustration'), entryOf('c', 'illustration'))
    await saveManifest(kit.dir, m)
    const r1 = await generateAll(kit.ctx(), m, { ids: ['a', 'b'], exclude: ['b'] })
    expect(r1.generated).toEqual(['a'])
    const r2 = await generateAll(kit.ctx(), r1.manifest, { ids: ['a'] })
    expect(r2.skipped).toEqual(['a']) // it has a version
    const r3 = await generateAll(kit.ctx(), r2.manifest, { ids: ['a'], force: true, extraPrompts: { a: 'Correct this: bigger.' } })
    expect(r3.generated).toEqual(['a'])
    expect(getEntry(r3.manifest, 'a')!.versions.map((v) => v.n)).toEqual([1, 2])
    expect(getEntry(r3.manifest, 'a')!.versions[1]!.prompt).toMatch(/Correct this: bigger\.$/)
    // force does not touch a locked or hand-made picture
    await writeFile(path.join(kit.dir, 'mine.png'), await figurePng())
    const custom = await setCustom(kit.dir, entryOf('d', 'illustration', { locked: true }), path.join(kit.dir, 'mine.png'))
    const r4 = await generateAll(kit.ctx(), { assets: [custom] }, { force: true })
    expect(r4.generated).toEqual([])
    expect(r4.skipped).toEqual(['d'])
  })
})
