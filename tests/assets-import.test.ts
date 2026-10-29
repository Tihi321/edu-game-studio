import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assetDir, resolveFile } from '../src/engine/assets/manifest'
import { writePlaceholder, PLACEHOLDER_FILE } from '../src/engine/assets/placeholder'
import { AUDIO_EXTENSIONS, checkImportFile, IMAGE_EXTENSIONS, importAssetFile } from '../src/engine/assets/import'
import { entryOf, figurePng, genKit } from './assets-fixtures'
import type { GenKit } from './assets-fixtures'

/** Ported from VN Studio's `assets-import` test, as far as it applies: a file you made becomes the asset (custom, locked) for `edu_asset_replace`. */

let kit: GenKit
beforeEach(async () => {
  kit = await genKit()
})
afterEach(async () => {
  await kit.done()
})

describe('importing a file as an asset', () => {
  it('a png becomes assets/<id>/custom.png, source custom and locked, as it is', async () => {
    const src = path.join(kit.dir, 'mine.png')
    await writeFile(src, await figurePng(300, 200))
    const e = await importAssetFile(kit.dir, entryOf('img-article-a-u1-1', 'illustration'), src)
    expect(e).toMatchObject({ source: 'custom', customFile: 'custom.png', locked: true, review: { status: 'approved' } })
    const file = resolveFile(kit.dir, e)!
    expect(file).toBe(path.join(assetDir(kit.dir, e.id), 'custom.png'))
    expect(await readFile(file)).toEqual(await readFile(src)) // not re-encoded: what you made is what the player shows
    expect(await sharp(file).metadata()).toMatchObject({ width: 300, height: 200 })
  })

  it('an svg is accepted, a file that only has an image extension is refused with a clear message', async () => {
    const svg = path.join(kit.dir, 'a.svg')
    await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
    await expect(checkImportFile(entryOf('a', 'illustration'), svg)).resolves.toBeUndefined()
    const fake = path.join(kit.dir, 'b.png')
    await writeFile(fake, 'this is not a picture')
    await expect(checkImportFile(entryOf('a', 'illustration'), fake)).rejects.toThrow()
    const fakeSvg = path.join(kit.dir, 'c.svg')
    await writeFile(fakeSvg, 'nope')
    await expect(checkImportFile(entryOf('a', 'illustration'), fakeSvg)).rejects.toThrow(/not an SVG/)
  })

  it('refuses the wrong kind of file and a missing file, naming what is accepted', async () => {
    const wav = path.join(kit.dir, 'a.wav')
    await writeFile(wav, 'RIFF')
    await expect(checkImportFile(entryOf('a', 'illustration'), wav)).rejects.toThrow(new RegExp(`use a ${IMAGE_EXTENSIONS.join(', ').replaceAll('.', '\\.')} file`))
    const png = path.join(kit.dir, 'a.png')
    await writeFile(png, await figurePng(10, 10))
    await expect(checkImportFile(entryOf('mus-menu', 'music'), png)).rejects.toThrow(new RegExp(`is audio: use a ${AUDIO_EXTENSIONS.join(', ').replaceAll('.', '\\.')} file`))
    await expect(checkImportFile(entryOf('a', 'illustration'), path.join(kit.dir, 'none.png'))).rejects.toThrow(/is not a file/)
    await expect(checkImportFile(entryOf('v', 'illustration', { kind: 'voiceRef' as never }), png)).rejects.toThrow(/voice references/)
  })

  it('audio is copied as it is', async () => {
    const wav = path.join(kit.dir, 'tone.wav')
    await writeFile(wav, 'RIFFxxxxWAVE')
    const e = await importAssetFile(kit.dir, entryOf('mus-menu', 'music'), wav)
    expect(e).toMatchObject({ source: 'custom', customFile: 'custom.wav', locked: true })
    expect(existsSync(path.join(assetDir(kit.dir, 'mus-menu'), 'custom.wav'))).toBe(true)
  })

  it('a placeholder the asset had is removed, and a second import replaces the first custom file', async () => {
    const ph = await writePlaceholder(kit.dir, entryOf('a', 'illustration'), 'down')
    const png = path.join(kit.dir, 'x.png')
    await writeFile(png, await figurePng(40, 40))
    const e1 = await importAssetFile(kit.dir, ph, png)
    expect(e1.placeholder).toBeUndefined()
    expect(existsSync(path.join(assetDir(kit.dir, 'a'), PLACEHOLDER_FILE))).toBe(false)
    const jpg = path.join(kit.dir, 'y.jpg')
    await writeFile(jpg, await sharp(await figurePng(40, 40)).jpeg().toBuffer())
    const e2 = await importAssetFile(kit.dir, e1, jpg)
    expect(e2.customFile).toBe('custom.jpg')
    expect(existsSync(path.join(assetDir(kit.dir, 'a'), 'custom.png'))).toBe(false)
  })
})
