import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type { Dither } from '../../shared/media'
import type { Rgb } from '../assets/palettes'
import type { PixelClient } from './pixel'

export interface StudioPixelateOptions {
  /** A folder for the files the studio reads and writes (absolute: the studio is another process). Removed afterwards. */
  tmpRoot: string
  /** The size of the pixel grid. */
  grid: { w: number; h: number }
  /** The size of the result: the grid scaled up with nearest-neighbour. Default: the size of the input. */
  out?: { w: number; h: number }
  palette?: Rgb[]
  dither?: Dither
  outline?: boolean
  name?: string
  signal?: AbortSignal
}

export interface StudioPixelated {
  /** The result at `out` size, a PNG with alpha. */
  png: Buffer
  /** The result at the native grid size, a PNG: what you edit in Pixel Studio. */
  native: Buffer
}

const hex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** An exact-size nearest-neighbour resize (the studio's output is trusted, but the build needs the exact size). */
async function exactSize(png: Buffer, w: number, h: number): Promise<Buffer> {
  const meta = await sharp(png).metadata()
  if (meta.width === w && meta.height === h) return png
  return sharp(png).resize(w, h, { kernel: 'nearest', fit: 'fill' }).png().toBuffer()
}

/**
 * Turns an image into pixel art with Pixel Studio: `import_image` (downscale, palette, dither, cleanup, outline) into a document, then
 * `export_many` writes it at the grid size and scaled up to `out`. Throws a `StudioError` when the studio fails (the caller falls back).
 */
export async function pixelateWithStudio(client: PixelClient, image: Buffer, o: StudioPixelateOptions): Promise<StudioPixelated> {
  const meta = await sharp(image).metadata()
  const out = o.out ?? { w: meta.width ?? o.grid.w, h: meta.height ?? o.grid.h }
  const dir = path.resolve(o.tmpRoot, `ps-${randomBytes(4).toString('hex')}`)
  await fs.mkdir(dir, { recursive: true })
  try {
    const input = path.join(dir, 'in.png')
    const big = path.join(dir, 'out.png')
    const small = path.join(dir, 'native.png')
    await fs.writeFile(input, await sharp(image).ensureAlpha().png().toBuffer())
    const doc = await client.importImage(
      {
        path: input,
        name: o.name,
        width: o.grid.w,
        height: o.grid.h,
        ...(o.palette?.length ? { palette: o.palette.map(hex) } : {}),
        dither: o.dither ?? 'none',
        ...(o.outline ? { outline: true } : {}),
        cleanup: true
      },
      o.signal
    )
    await client.exportMany(
      [
        { document: doc.documentId, path: big, width: out.w, height: out.h },
        { document: doc.documentId, path: small, scale: 1 }
      ],
      o.signal
    )
    return { png: await exactSize(await fs.readFile(big), out.w, out.h), native: await fs.readFile(small) }
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}
