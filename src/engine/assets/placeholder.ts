import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { RegionShape } from '../../shared/course'
import { AUDIO_KINDS } from '../../shared/media'
import type { AssetEntry } from '../../shared/media'
import { artSizes } from '../../shared/art'
import type { ArtKind } from '../../shared/art'
import { atomicWrite, renameRetry } from '../store/atomic'
import { assetDir } from './manifest'
import { silentWav } from './wav'

/**
 * What stands in for an image that could not be made (a provider is down, or the art is made by hand): a real file, `assets/<id>/placeholder.svg`,
 * so the pack links it, the build carries it and the lint warns `PLACEHOLDER_ASSET` (its file name says it). It is replaced as soon as the asset
 * has a version (generated or imported), and the file is removed then.
 */

export const PLACEHOLDER_FILE = 'placeholder.svg'
/** The placeholder of a sound: a second of silence, named `placeholder` so the lint warns like it does for a picture (EGS-16). */
export const PLACEHOLDER_AUDIO_FILE = 'placeholder.wav'

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A short line of text cut to a length, on a word. */
function cut(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}...`
}

/** The size of a placeholder card: the asset's final size, or the usual size of its kind. */
export function placeholderSize(entry: Pick<AssetEntry, 'kind' | 'fit'>): { w: number; h: number } {
  if (entry.fit) return entry.fit
  const k = entry.kind
  return artSizes((k === 'background' || k === 'illustration' || k === 'sprite' || k === 'tileset' ? k : 'illustration') as ArtKind).fit
}

/** The card: a plain picture with a frame, a cross and the words "picture to come" and what it should show. */
export function placeholderSvg(entry: Pick<AssetEntry, 'id' | 'kind' | 'alt' | 'fit'>, size = placeholderSize(entry)): string {
  const { w, h } = size
  const fs1 = Math.max(14, Math.round(Math.min(w, h) / 14))
  const fs2 = Math.max(10, Math.round(fs1 * 0.62))
  const what = cut(entry.alt ?? entry.id, Math.max(24, Math.round(w / (fs2 * 0.55))))
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">`,
    `<rect width="${w}" height="${h}" fill="#e6ebf2"/>`,
    `<rect x="${Math.round(w * 0.03)}" y="${Math.round(h * 0.03)}" width="${Math.round(w * 0.94)}" height="${Math.round(h * 0.94)}" fill="none" stroke="#9aa7ba" stroke-width="${Math.max(2, Math.round(w / 200))}" stroke-dasharray="${Math.round(w / 40)} ${Math.round(w / 80)}"/>`,
    `<path d="M${Math.round(w * 0.03)} ${Math.round(h * 0.03)} L${Math.round(w * 0.97)} ${Math.round(h * 0.97)} M${Math.round(w * 0.97)} ${Math.round(h * 0.03)} L${Math.round(w * 0.03)} ${Math.round(h * 0.97)}" stroke="#c4cdda" stroke-width="${Math.max(1, Math.round(w / 300))}"/>`,
    `<text x="${w / 2}" y="${h / 2 - fs2 * 0.2}" text-anchor="middle" font-family="sans-serif" font-size="${fs1}" fill="#566176">picture to come</text>`,
    `<text x="${w / 2}" y="${h / 2 + fs2 * 1.4}" text-anchor="middle" font-family="sans-serif" font-size="${fs2}" fill="#6b7689">${esc(what)}</text>`,
    '</svg>',
    ''
  ].join('\n')
}

/** Writes the placeholder of an asset (a card for a picture, a short silent WAV for a sound) and returns the entry that records it (no version, nothing selected). */
export async function writePlaceholder(projectDir: string, entry: AssetEntry, reason: string): Promise<AssetEntry> {
  const dir = assetDir(projectDir, entry.id)
  if (AUDIO_KINDS.has(entry.kind)) {
    const file = path.join(dir, PLACEHOLDER_AUDIO_FILE)
    await fs.mkdir(dir, { recursive: true })
    const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`
    await fs.writeFile(tmp, silentWav(1))
    await renameRetry(tmp, file)
    return { ...entry, placeholder: { file: PLACEHOLDER_AUDIO_FILE, reason } }
  }
  await atomicWrite(path.join(dir, PLACEHOLDER_FILE), placeholderSvg(entry))
  return { ...entry, placeholder: { file: PLACEHOLDER_FILE, reason } }
}

/** Removes the placeholder file of an asset (a real version replaced it) and returns the entry without the record. */
export async function dropPlaceholder(projectDir: string, entry: AssetEntry): Promise<AssetEntry> {
  if (!entry.placeholder) return entry
  await fs.rm(path.join(assetDir(projectDir, entry.id), entry.placeholder.file), { force: true })
  const { placeholder: _gone, ...rest } = entry
  return rest
}

// ---- the regions of a hotspot, drawn faintly over its picture ----

const shapeSvg = (s: RegionShape): string =>
  s.type === 'circle' ? `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}"/>` : s.type === 'rect' ? `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="4"/>` : `<polygon points="${s.points.map(([x, y]) => `${x},${y}`).join(' ')}"/>`

/**
 * The SVG layer with the outlines of the regions of a hotspot item, in the item's own coordinates (width x height), faint (a thin light line and a
 * very light fill). No text: the region's label is the question's answer, so it is never printed on the picture.
 */
export function regionsSvg(width: number, height: number, regions: readonly { shape: RegionShape }[]): string {
  const stroke = Math.max(1.5, Math.round(Math.max(width, height) / 400))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.55" stroke-width="${stroke}" stroke-dasharray="${stroke * 4} ${stroke * 2}">${regions.map((r) => shapeSvg(r.shape)).join('')}</g></svg>`
}
