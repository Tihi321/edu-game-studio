import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { parseCourseMedia } from '../src/shared/media'
import type { AssetEntry, CourseMedia } from '../src/shared/media'
import { artSizes, composePrompt } from '../src/shared/art'
import type { ArtKind } from '../src/shared/art'
import type { GenerateContext } from '../src/engine/assets/generate'
import { FakeComfy } from './edu-helpers'
import { FakeFlow } from './flow-fakes'
import { FakePixel } from './studio-fakes'

sharp.cache(false)

export const SEED_PALETTES = path.resolve(__dirname, '..', 'seed', 'palettes')

/** The media settings of a course, from a partial `media` block (a missing block gives the defaults). */
export const media = (over: Record<string, unknown> = {}): CourseMedia => parseCourseMedia(over)

/** A manifest entry as the art plan makes it: no version yet. */
export function entryOf(id: string, kind: ArtKind | 'sheet' | 'music', over: Partial<AssetEntry> = {}): AssetEntry {
  const sizes = kind === 'music' || kind === 'sheet' ? undefined : artSizes(kind)
  return {
    id,
    kind,
    prompt: kind === 'music' || kind === 'sheet' ? '' : composePrompt(kind, `a subject for ${id}`, kind === 'sprite' || kind === 'tileset' ? 'pixel' : 'illustrated'),
    engine: 'qwen-image-2.1',
    seed: null,
    size: sizes?.size ?? null,
    ...(sizes ? { fit: sizes.fit } : {}),
    alt: `Alt of ${id}`,
    versions: [],
    selected: null,
    source: 'generated',
    locked: false,
    ...over
  }
}

export interface GenKit {
  dir: string
  comfy: FakeComfy
  pixel: FakePixel
  flow: FakeFlow
  ctx: (over?: Partial<GenerateContext> & { media?: Record<string, unknown> }) => GenerateContext
  done: () => Promise<void>
}

/** A scratch course folder (`<tmp>/course`) with the fakes of ComfyUI, Pixel Studio and Flow, and a generation context over them. */
export async function genKit(): Promise<GenKit> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'edu-gen-'))
  const dir = path.join(root, 'course')
  await mkdir(dir, { recursive: true })
  const comfy = new FakeComfy()
  const pixel = new FakePixel()
  const flow = new FakeFlow()
  return {
    dir,
    comfy,
    pixel,
    flow,
    ctx: (over = {}) => {
      const { media: m, ...rest } = over
      return { slug: 'demo', settings: media(m ?? {}), projectDir: dir, comfy, palettesDir: SEED_PALETTES, now: () => new Date('2026-02-03T04:05:06.000Z'), ...rest }
    },
    done: () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

/** A light grey picture with a blue figure in the middle. */
export async function figurePng(w = 400, h = 700): Promise<Buffer> {
  const fig = await sharp({ create: { width: Math.round(w / 4), height: Math.round(h / 2), channels: 3, background: { r: 32, g: 96, b: 192 } } }).png().toBuffer()
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 200, b: 200 } } }).composite([{ input: fig, left: Math.round((w * 3) / 8), top: Math.round(h / 4) }]).png().toBuffer()
}

/** The distinct colours of an image (`rrggbb` strings), alpha ignored; only pixels that are visible count. */
export async function coloursOf(buf: Buffer): Promise<Set<string>> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const out = new Set<string>()
  for (let i = 0; i < data.length; i += info.channels) if ((data[i + 3] ?? 255) > 0) out.add([data[i]!, data[i + 1]!, data[i + 2]!].map((v) => v.toString(16).padStart(2, '0')).join(''))
  return out
}
