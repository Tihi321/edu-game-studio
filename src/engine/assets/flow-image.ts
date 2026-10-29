import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ArtRatio } from '../../shared/art'
import type { AssetEntry, AssetVersion } from '../../shared/media'
import type { FlowClient } from '../studios/flow'
import type { StudiosConfig } from '../studios/config'

/**
 * Google Flow as the image provider of a course (ported from VN Studio's `flow-image.ts`, without the character sheets: a course has no
 * recurring characters to keep alike). Flow is used ONLY when a course sets `media.art.provider: flow` (or one asset sets `provider: flow`
 * with `edu_asset_set`); nothing in Edu Studio calls it by default. Flow images are free; music from Flow Music spends credits (EGS-16).
 */

export type FlowQualityKind = 'background' | 'cover' | 'cg' | 'sheet' | 'sprite' | 'insert'

/** The settings of the Flow calls (from `config/studios.md`). */
export interface FlowOptions {
  quality: Record<FlowQualityKind, 'original' | 'upscaled'>
  jobTimeoutMs: number
  musicTimeoutMs: number
  /** The most Flow Music songs one course may make. */
  maxSongs: number
}

export const DEFAULT_FLOW_OPTIONS: FlowOptions = {
  quality: { background: 'upscaled', cover: 'upscaled', cg: 'upscaled', sheet: 'original', sprite: 'original', insert: 'original' },
  jobTimeoutMs: 900_000,
  musicTimeoutMs: 600_000,
  maxSongs: 4
}

/** The Flow options of `config/studios.md`. */
export function flowOptionsOf(c: Pick<StudiosConfig, 'flowImageQuality' | 'flowJobTimeoutS' | 'flowMusicTimeoutS' | 'flowMusicMaxSongs'>): FlowOptions {
  return { quality: c.flowImageQuality, jobTimeoutMs: c.flowJobTimeoutS * 1000, musicTimeoutMs: c.flowMusicTimeoutS * 1000, maxSongs: c.flowMusicMaxSongs }
}

/** Flow's aspect ratios: wide for backgrounds and pictures, tall for sprites, square for a tile sheet (or a square picture). */
export function flowAspect(kind: AssetEntry['kind'], ratio?: ArtRatio): '16:9' | '9:16' | '1:1' {
  if (kind === 'sprite' || kind === 'sheet') return '9:16'
  if (kind === 'tileset' || (kind === 'illustration' && ratio === '1:1')) return '1:1'
  return '16:9'
}

export function flowQualityKind(kind: AssetEntry['kind']): FlowQualityKind {
  if (kind === 'illustration') return 'cg'
  if (kind === 'tileset') return 'sheet'
  return kind as FlowQualityKind
}

/** The prompt of a sprite for Flow: a full-body pose on a plain flat background, so the cut-out works. */
export function flowSpritePrompt(base: string): string {
  const flat = /flat (?:light )?(?:grey|gray|colou?r|background)|plain (?:flat )?(?:light )?(?:grey|gray|background)/i.test(base)
  const tail = ['Full body, standing, facing the viewer, centred.', flat ? '' : 'Plain flat light grey background, nothing else in the picture.'].filter(Boolean).join(' ')
  return `${base.trim().replace(/\.?$/, '.')} ${tail}`
}

export interface FlowImageRun {
  bytes: Buffer
  ext: string
  remote: NonNullable<AssetVersion['remote']>
  warnings: string[]
}

/**
 * Makes one image with Flow: `flow_generate` for this asset alone (exact prompt), the file read from a temporary folder of the course, which is
 * removed. Needs `tmpRoot` (a folder the Flow server may write: absolute).
 */
export async function makeFlowImage(
  flow: FlowClient,
  o: {
    entry: AssetEntry
    prompt: string
    ratio?: ArtRatio
    project: string
    tmpRoot: string
    model?: string
    options: FlowOptions
    signal?: AbortSignal
    progress?: (message: string) => void
  }
): Promise<FlowImageRun> {
  const { entry } = o
  const dir = path.resolve(o.tmpRoot, 'flow', entry.id)
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
  const prompt = entry.kind === 'sprite' ? flowSpritePrompt(o.prompt) : o.prompt
  const args = {
    prompt,
    aspect: flowAspect(entry.kind, o.ratio),
    ...(o.model ? { model: o.model } : {}),
    quality: o.options.quality[flowQualityKind(entry.kind)],
    project: o.project,
    out: dir,
    name: entry.id,
    timeoutMs: o.options.jobTimeoutMs,
    signal: o.signal
  }
  try {
    o.progress?.(`Google Flow: ${args.aspect}, ${args.quality}`)
    const made = await flow.generateImage(args)
    const bytes = await fs.readFile(made.file)
    const ext = path.extname(made.file).slice(1).toLowerCase() || 'jpeg'
    return { bytes, ext, remote: { provider: 'flow', id: made.mediaId, ...(made.project ? { project: made.project } : {}) }, warnings: [] }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
