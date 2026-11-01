import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateAll, generateAsset } from '../src/engine/assets/generate'
import { assetDir, getEntry, loadManifest, resolveFile, saveManifest } from '../src/engine/assets/manifest'
import { writePlaceholder, PLACEHOLDER_FILE } from '../src/engine/assets/placeholder'
import { entryOf, genKit } from './assets-fixtures'
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

  it('uses the entry prompt, numbers new versions, and adds the critic\'s words to one run only', async () => {
    const e = { ...entryOf('img-article-a-u1-1', 'illustration'), prompt: 'a dusty attic' }
    const first = await must(generateAsset(kit.ctx(), e))
    const second = await must(generateAsset(kit.ctx(), first.entry, { force: true, prompt: 'a tidy attic', extraPrompt: 'Correct this: show the whole room.' }))
    expect(kit.comfy.requests.map((r) => r.prompt)).toEqual(['a dusty attic', 'a tidy attic. Correct this: show the whole room.'])
    expect(second.entry.versions.map((v) => v.n)).toEqual([1, 2])
    expect(second.entry).toMatchObject({ selected: 2, prompt: 'a tidy attic' }) // the note is on the version, not on the entry
    expect(second.version.prompt).toContain('Correct this')
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

  it('Pixel Studio down: the built-in pixelate makes the image and a warning stays on the version (the asset is not failed)', async () => {
    kit.pixel.down = true
    const r = await must(generateAsset(kit.ctx({ pixel: kit.pixel }), entryOf('img-rpg-tiles', 'tileset')))
    expect(r.version.warnings?.some((w) => /Pixel Studio could not convert the image/.test(w) && /used the built-in pixelate/.test(w))).toBe(true)
    expect(r.version.nativeFile).toBeUndefined()
    expect(await sharp(await fileOf(kit.dir, r.entry)).metadata()).toMatchObject({ width: 512, height: 512 })
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
})
