import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { artSizes, composePrompt, ART_NEGATIVE } from '../../shared/art'
import type { ArtKind, ArtRatio } from '../../shared/art'
import type { RegionShape } from '../../shared/course'
import { FLOW_ENGINE, IMAGE_KINDS, PIXEL_KINDS, resolveArtProvider, resolvePixel, resolveRpgPixelProvider } from '../../shared/media'
import type { AssetEntry, AssetManifest, AssetVersion, CourseMedia } from '../../shared/media'
import type { ComfyClient, ComfyProgress } from '../comfy/client'
import { randomSeed } from '../comfy/graphs'
import { renameRetry } from '../store/atomic'
import { addVersion, assetDir, getEntry, nextVersionN, replaceEntry, resolveFile, saveManifest } from './manifest'
import { loadPalette, type Rgb } from './palettes'
import { fitBackground, keepMainSubject, keyOutFlatBackground, pixelate, prepareSprite, toWebp, transparentShare } from './postprocess'
import { dropPlaceholder, regionsSvg } from './placeholder'
import { pixelateWithStudio } from '../studios/pixelate'
import type { PixelClient } from '../studios/pixel'
import type { FlowClient } from '../studios/flow'
import { DEFAULT_FLOW_OPTIONS, makeFlowImage } from './flow-image'
import type { FlowOptions } from './flow-image'

/**
 * Makes the images of a course (ported from VN Studio's `generate.ts`, adapted to a course: no book, no character sheets). One asset at a time:
 * the generator (ComfyUI, or Google Flow when the course says so) makes the picture, then `finishImage` fits it (webp, sprite cut-out and trim,
 * pixel art with a palette, the regions of a hotspot drawn over it). The audio branches (music, sound effects) arrive with EGS-16.
 */

export interface GenerateOptions {
  /** Regenerate even when the asset is locked or custom. */
  force?: boolean
  /** Edits applied to the entry (and kept) before generating. */
  prompt?: string
  negative?: string
  engine?: string
  seed?: number
  /** Words added to the prompt for this run only (the art-critic's note on a picture that has to be made again). Recorded on the version, not on the entry. */
  extraPrompt?: string
}

/** The prompt of the Qwen-Image 2.1 background-removal edit (the user's `image_qwen_image_2_1_background_removal` workflow). */
export const QWEN_REMOVE_BG_PROMPT = 'Remove the background, and output a PNG image'

/** True when the image has a real alpha channel with transparent pixels (more than 1% of the area). */
export async function hasTransparency(png: Buffer): Promise<boolean> {
  return (await transparentShare(png)) > 0.01
}

export interface GenerateProgress {
  id: string
  stage: 'start' | 'comfy' | 'post' | 'done'
  message: string
}

/** What a hotspot item's picture needs: its size and the regions drawn over it. */
export interface HotspotOverlay {
  width: number
  height: number
  regions: { shape: RegionShape }[]
}

export interface GenerateContext {
  /** The course slug (the Flow project is du-<slug> unless the course names one). */
  slug: string
  settings: Pick<CourseMedia, 'art'>
  /** `courses/<slug>/course`: the manifest and `assets/<id>/` live here. */
  projectDir: string
  /** A folder for the files other processes write (Flow, Pixel Studio): absolute. Default: `<projectDir>/../.tmp`. */
  tmpRoot?: string
  comfy: ComfyClient
  /** Folder with `<name>.hex` palettes. */
  palettesDir?: string
  onProgress?: (e: GenerateProgress) => void
  signal?: AbortSignal
  now?: () => Date
  /** Pixel Studio, for pixel art. Without it (or down) the built-in pixelate runs, with a warning. */
  pixel?: PixelClient
  /** flow-music-mcp, for the images of a course whose `art.provider` is `flow`. */
  flow?: FlowClient
  /** Quality and timeouts of the Flow calls (`config/studios.md`). */
  flowOptions?: FlowOptions
  /** The overlay of a hotspot item's picture, by asset id. */
  hotspotOf?: (assetId: string) => HotspotOverlay | null
  /** The ratio the art plan asked for (an illustration: `4:3`, `16:9` or `1:1`). */
  ratioOf?: (assetId: string) => ArtRatio | undefined
}

export type GenerateResult =
  | { ok: true; skipped: false; entry: AssetEntry; version: AssetVersion; /** Non-fatal problems, for example a fallback to the flat-colour key. */ warnings?: string[] }
  | { ok: true; skipped: true; entry: AssetEntry; reason: string }
  | { ok: false; entry: AssetEntry; error: string }

async function writeFileAtomic(file: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`
  await fs.writeFile(tmp, bytes)
  await renameRetry(tmp, file)
}

/**
 * Cuts the figure out of an image. `birefnet`: the BiRefNet model in ComfyUI. `qwen-edit`: a Qwen-Image 2.1 edit pass first (its output is
 * used as is when it carries real alpha, else BiRefNet runs on it). `key`: flat-colour keying. Failures and a missing model fall back
 * (qwen-edit -> birefnet -> key) and are reported through `warn`.
 */
export async function removeBackground(
  ctx: Pick<GenerateContext, 'comfy' | 'settings' | 'signal'>,
  image: Buffer,
  method: 'birefnet' | 'qwen-edit' | 'key',
  o: { seed: number; size: { w: number; h: number }; onProgress?: (p: ComfyProgress) => void },
  warn: (message: string) => void
): Promise<Buffer> {
  if (method === 'key') return keyOutFlatBackground(image)
  let source = image
  if (method === 'qwen-edit') {
    try {
      const q = await ctx.comfy.generate({ engine: ctx.settings.art.editor, prompt: QWEN_REMOVE_BG_PROMPT, seed: o.seed, references: [image], width: o.size.w, height: o.size.h, onProgress: o.onProgress, signal: ctx.signal })
      if (await hasTransparency(q.bytes)) return q.bytes
      source = q.bytes // an isolated subject on a flat background: BiRefNet finishes the cut
    } catch (e) {
      if (ctx.signal?.aborted) throw e
      warn(`Qwen background-removal edit failed (${(e as Error).message}); using BiRefNet on the original`)
    }
  }
  try {
    const cut = await ctx.comfy.removeBackground(source, { onProgress: o.onProgress, signal: ctx.signal })
    if (cut) return cut
    warn('no BiRefNet background-removal model is installed in ComfyUI; used the flat-colour key')
  } catch (e) {
    if (ctx.signal?.aborted) throw e
    warn(`BiRefNet background removal failed (${(e as Error).message}); used the flat-colour key`)
  }
  return keyOutFlatBackground(image)
}

export type FinishContext = Pick<GenerateContext, 'settings' | 'projectDir' | 'tmpRoot' | 'comfy' | 'palettesDir' | 'pixel' | 'signal' | 'hotspotOf'>

export interface FinishOptions {
  seed?: number
  /** The size the image was made at (the Qwen background-removal edit asks for it). Default: the image's own size. */
  size?: { w: number; h: number }
  onProgress?: (p: ComfyProgress) => void
  progress?: (stage: GenerateProgress['stage'], message: string) => void
}

export interface FinishedImage {
  bytes: Buffer
  ext: string
  /** The pixel art at its native size (a PNG), when Pixel Studio made it: kept for "Open in Pixel Studio". */
  native?: Buffer
  /** Non-fatal problems, for example a fallback to the flat-colour key or to the built-in pixelate. */
  warnings: string[]
}

/** Pixel art is a whole number of screen pixels per art pixel: 6 for a sprite (64 px tall at 384), 4 for the rest. */
const pixelFactor = (kind: string): number => (kind === 'sprite' ? 6 : 4)

/** The kind of an entry as the art code knows it (`cg`, `cover` and `sheet` are pictures like an illustration; `sheet` is kept as made). */
const artKindOf = (kind: string): ArtKind => (kind === 'background' || kind === 'sprite' || kind === 'tileset' || kind === 'illustration' ? kind : 'illustration')

/**
 * The post-processing of an image asset:
 *  - background, illustration (cg, cover): fitted to its size (cover crop, webp);
 *  - tileset: fitted to its square;
 *  - sprite: background cut out, one figure kept, trimmed and scaled to the sprite height;
 *  - a pixel asset (an RPG tile set or sprite, or any picture of a course whose art style is pixel) then becomes pixel art with the palette,
 *    through Pixel Studio, or the built-in pixelate when Pixel Studio is down (with a warning);
 *  - a hotspot picture gets its regions drawn faintly over it.
 */
export async function finishImage(ctx: FinishContext, entry: AssetEntry, bytes: Buffer, o: FinishOptions = {}): Promise<FinishedImage> {
  const warnings: string[] = []
  const progress = o.progress ?? (() => undefined)
  const warn = (m: string) => {
    warnings.push(m)
    progress('post', `warning: ${m}`)
  }
  if (entry.kind === 'sheet') return { bytes, ext: 'png', warnings }
  const kind = artKindOf(entry.kind)
  const sizes = artSizes(kind)
  const fit = entry.fit ?? sizes.fit
  const art = ctx.settings.art
  const pixel = (entry.style ?? art.style) === 'pixel' || PIXEL_KINDS.has(entry.kind)
  const factor = pixelFactor(entry.kind)
  const tmpRoot = ctx.tmpRoot ?? path.join(ctx.projectDir, '..', '.tmp')
  let native: Buffer | undefined

  let palette: Rgb[] | undefined
  if (pixel) {
    const name = art.palette ?? (PIXEL_KINDS.has(entry.kind) ? 'db32' : undefined)
    if (name && ctx.palettesDir) {
      try {
        palette = await loadPalette(ctx.palettesDir, name)
      } catch (e) {
        warn(`the palette "${name}" could not be loaded (${(e as Error).message}); the colours are not limited`)
      }
    }
  }

  /** Pixel art from a PNG of the final size: Pixel Studio, else the built-in pixelate (a warning when Pixel Studio was meant and failed). */
  const finishPixel = async (png: Buffer): Promise<Buffer> => {
    const meta = await sharp(png).metadata()
    const out = { w: meta.width ?? fit.w, h: meta.height ?? fit.h }
    const px = resolvePixel(art)
    // the art pixels: the picture's size over the factor (1280x720 -> the 320x180 grid of `PIXEL_DEFAULTS`)
    const grid = { w: Math.max(8, Math.round(out.w / factor)), h: Math.max(8, Math.round(out.h / factor)) }
    const exact = { w: grid.w * factor, h: grid.h * factor }
    if (resolveRpgPixelProvider(art) === 'pixel-studio' && (PIXEL_KINDS.has(entry.kind) || art.pixelProvider === 'pixel-studio')) {
      if (ctx.pixel) {
        try {
          progress('post', 'pixel art with Pixel Studio')
          const r = await pixelateWithStudio(ctx.pixel, png, { tmpRoot, grid, out: exact, palette, dither: px.dither, outline: px.outline, name: entry.id, signal: ctx.signal })
          native = r.native
          return r.png
        } catch (e) {
          if (ctx.signal?.aborted) throw e
          warn(`Pixel Studio could not convert the image (${(e as Error).message}); used the built-in pixelate`)
        }
      } else warn('Pixel Studio is not configured; used the built-in pixelate')
    }
    return pixelate(png, { scale: factor, palette, exactScale: true })
  }

  let out: Buffer
  if (entry.kind === 'sprite') {
    progress('post', 'remove background')
    const meta = await sharp(bytes).metadata()
    const size = o.size ?? { w: meta.width ?? 1, h: meta.height ?? 1 }
    const method = art.bgRemoval ?? 'birefnet'
    let cut = await removeBackground(ctx, bytes, method, { seed: o.seed ?? randomSeed(), size, onProgress: o.onProgress }, warn)
    cut = await keepMainSubject(cut) // one figure: stray islands and a second figure are dropped before the trim
    const sprite = await prepareSprite(cut, { targetHeight: fit.h })
    if (pixel) {
      // the figure, scaled to whole art pixels: its height is a multiple of the factor
      const m = await sharp(sprite).metadata()
      const h = Math.max(factor * 8, Math.round((m.height ?? fit.h) / factor) * factor)
      const w = Math.max(factor * 4, Math.round(((m.width ?? h) * h) / (m.height ?? h) / factor) * factor)
      const png = await sharp(sprite).resize(w, h, { fit: 'fill' }).png().toBuffer()
      out = await toWebp(await finishPixel(png), { lossless: true })
    } else out = sprite
  } else {
    progress('post', `fit ${entry.kind}`)
    const fitted = await fitBackground(bytes, fit.w, fit.h, { lossless: pixel })
    if (pixel) out = await toWebp(await finishPixel(await sharp(fitted).png().toBuffer()), { lossless: true })
    else out = fitted
  }
  // the regions of a hotspot item, drawn faintly over its picture
  const overlay = ctx.hotspotOf?.(entry.id)
  if (overlay) {
    progress('post', 'draw the regions of the hotspot')
    const m = await sharp(out).metadata()
    const w = m.width ?? fit.w
    const h = m.height ?? fit.h
    const layer = Buffer.from(regionsSvg(overlay.width, overlay.height, overlay.regions))
    out = await sharp(out)
      .composite([{ input: await sharp(layer).resize(w, h, { fit: 'fill' }).png().toBuffer() }])
      .webp(pixel ? { lossless: true } : { quality: 90 })
      .toBuffer()
  }
  return { bytes: out, ext: 'webp', ...(native ? { native } : {}), warnings }
}

/**
 * Generates one asset and records the new version (selected) on the returned entry. Never throws for a failed asset: it returns
 * `{ ok: false, error }` with the entry unchanged. Locked and custom assets are skipped unless `force`. The manifest is not saved here (see
 * `generateAll`). A placeholder the asset had is removed when the version is made.
 */
export async function generateAsset(ctx: GenerateContext, entry: AssetEntry, opts: GenerateOptions = {}): Promise<GenerateResult> {
  const progress = (stage: GenerateProgress['stage'], message: string) => ctx.onProgress?.({ id: entry.id, stage, message })
  if (!opts.force && (entry.locked || entry.source === 'custom')) return { ok: true, skipped: true, entry, reason: entry.locked ? 'locked' : 'custom file' }
  if (!IMAGE_KINDS.has(entry.kind)) return { ok: true, skipped: true, entry, reason: `${entry.kind} assets are made by the music and voice steps (EGS-16, EGS-17)` }
  if (entry.kind === 'sheet') return { ok: true, skipped: true, entry, reason: 'a course has no character sheets' }
  const art = ctx.settings.art
  const provider = entry.provider ?? resolveArtProvider(art)
  if (provider === 'hand' && opts.engine === undefined) return { ok: false, entry, error: 'the art of this course is made by hand (media.art.provider: hand): set the picture with edu_asset_replace' }
  const edited: AssetEntry = {
    ...entry,
    ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
    ...(opts.negative !== undefined ? { negative: opts.negative } : {}),
    ...(opts.engine !== undefined ? { engine: opts.engine } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {})
  }
  // An image follows the provider (Flow, or the configured ComfyUI engine), whatever made its earlier versions. An engine given for this run keeps its own.
  if (opts.engine === undefined && !edited.locked) edited.engine = provider === 'flow' ? FLOW_ENGINE : edited.engine === FLOW_ENGINE || !edited.engine ? art.generator : edited.engine
  const viaFlow = edited.engine === FLOW_ENGINE
  try {
    progress('start', `${entry.kind} with ${edited.engine}`)
    const kind = artKindOf(edited.kind)
    const ratio = ctx.ratioOf?.(edited.id)
    const base = edited.prompt.trim() || composePrompt(kind, edited.alt ?? edited.id.replace(/^img-/, '').replace(/[-_]+/g, ' '), edited.style ?? art.style, art.stylePrompt)
    const prompt = opts.extraPrompt?.trim() ? `${base}. ${opts.extraPrompt.trim()}` : base
    const negative = edited.negative ?? ART_NEGATIVE
    const seed = edited.seed ?? randomSeed()
    const size = edited.size ?? artSizes(kind, ratio).size
    const onProgress = (p: ComfyProgress) => progress('comfy', `${p.stage}: ${p.message}`)
    const warnings: string[] = []
    if (provider === 'pixel-studio-draw') warnings.push('pixel-studio-draw is not used for courses yet: ComfyUI made the image')
    const finishOpts = { seed, size, onProgress, progress }

    let raw: Buffer
    let remote: AssetVersion['remote']
    if (viaFlow) {
      if (!ctx.flow) throw new Error('Google Flow (flow-music-mcp) is not configured')
      const run = await makeFlowImage(ctx.flow, {
        entry: edited,
        prompt,
        ratio,
        project: art.flowProject ?? `edu-${ctx.slug}`,
        tmpRoot: ctx.tmpRoot ?? path.join(ctx.projectDir, '..', '.tmp'),
        model: art.flowModel,
        options: ctx.flowOptions ?? DEFAULT_FLOW_OPTIONS,
        signal: ctx.signal,
        progress: (m) => progress('comfy', m)
      })
      raw = run.bytes
      remote = run.remote
      warnings.push(...run.warnings)
    } else {
      const r = await ctx.comfy.generate({ engine: edited.engine, prompt, negative, seed, width: size.w, height: size.h, onProgress, signal: ctx.signal })
      raw = r.bytes
    }
    const fin = await finishImage(ctx, edited, raw, finishOpts)
    warnings.push(...fin.warnings)
    const n = nextVersionN(edited)
    const file = `v${n}.${fin.ext}`
    await writeFileAtomic(path.join(assetDir(ctx.projectDir, edited.id), file), fin.bytes)
    let nativeFile: string | undefined
    if (fin.native) {
      nativeFile = `v${n}.px.png`
      await writeFileAtomic(path.join(assetDir(ctx.projectDir, edited.id), nativeFile), fin.native)
    }
    const version: AssetVersion = {
      n,
      file,
      createdAt: (ctx.now?.() ?? new Date()).toISOString(),
      seed: remote ? null : seed,
      ...(remote ? { remote } : {}),
      engine: edited.engine,
      prompt,
      ...(nativeFile ? { nativeFile } : {}),
      ...(warnings.length ? { warnings } : {})
    }
    const updated = await dropPlaceholder(ctx.projectDir, addVersion({ ...edited, seed: edited.seed }, version))
    progress('done', file)
    return { ok: true, skipped: false, entry: updated, version, ...(warnings.length ? { warnings } : {}) }
  } catch (e) {
    return { ok: false, entry, error: (e as Error).message }
  }
}

export interface GenerateAllOptions {
  /** Only these ids; default all entries. */
  ids?: string[]
  /** Regenerate assets that already have a selected version (and locked/custom ones). Default false: resumable. */
  force?: boolean
  /** Skip these (for example orphaned) ids. */
  exclude?: Iterable<string>
  /** Words added to the prompt of an asset for this run (the art-critic's notes), by id. */
  extraPrompts?: Record<string, string>
  /** Called when an asset failed, to decide what stands in (the caller writes a placeholder). Returns the entry to keep. */
  onFailure?: (entry: AssetEntry, error: string) => Promise<AssetEntry>
  /**
   * Stores an entry and returns the manifest as it is then. Default: the manifest of `generateAll` is saved to `assets.json` after each asset.
   * A caller that shares the manifest with other writers (the MCP tools) passes its own, which merges into a fresh copy.
   */
  commit?: (entry: AssetEntry) => Promise<AssetManifest>
}

export interface GenerateAllResult {
  manifest: AssetManifest
  generated: string[]
  skipped: string[]
  failed: Array<{ id: string; error: string }>
}

/** Generation order: backgrounds, then pictures, tile sheets and sprites. */
const KIND_ORDER: Record<string, number> = { background: 0, illustration: 1, cover: 2, cg: 3, tileset: 4, sprite: 5, sheet: 6 }

/**
 * Generates every image that has no usable file yet, saving `assets.json` after each one so a stopped run resumes where it left off. A failed
 * asset is reported (and left to `onFailure`) and the run continues.
 */
export async function generateAll(ctx: GenerateContext, manifest: AssetManifest, opts: GenerateAllOptions = {}): Promise<GenerateAllResult> {
  let current = manifest
  const excluded = new Set(opts.exclude ?? [])
  const wanted = opts.ids ? new Set(opts.ids) : null
  const todo = current.assets.filter((e) => IMAGE_KINDS.has(e.kind) && !excluded.has(e.id) && (!wanted || wanted.has(e.id))).sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9))
  const result: GenerateAllResult = { manifest: current, generated: [], skipped: [], failed: [] }
  const commit =
    opts.commit ??
    (async (e: AssetEntry): Promise<AssetManifest> => {
      current = replaceEntry(current, e)
      await saveManifest(ctx.projectDir, current)
      return current
    })
  for (const entry of todo) {
    if (ctx.signal?.aborted) break
    const live = getEntry(current, entry.id) ?? entry
    if (!opts.force && resolveFile(ctx.projectDir, live)) {
      result.skipped.push(live.id)
      continue
    }
    const r = await generateAsset(ctx, live, { force: opts.force && !live.locked ? true : false, ...(opts.extraPrompts?.[live.id] ? { extraPrompt: opts.extraPrompts[live.id] } : {}) })
    if (!r.ok) {
      result.failed.push({ id: live.id, error: r.error })
      if (opts.onFailure) current = await commit(await opts.onFailure(live, r.error))
    } else if (r.skipped) {
      result.skipped.push(live.id)
    } else {
      current = await commit(r.entry)
      result.generated.push(live.id)
    }
  }
  result.manifest = current
  return result
}
