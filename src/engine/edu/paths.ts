import { createHash } from 'node:crypto'
import path from 'node:path'
import { transliterate } from '../../shared/translit'
import { loadComfyConfig } from '../comfy/client'
import type { ComfyConfig } from '../comfy/client'
import { workflowDirs } from '../comfy/custom-workflow'

/** Strips diacritics (č ć đ š ž included). */
export function stripDiacritics(s: string): string {
  return s
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * An ASCII slug from any text: letters are transliterated, diacritics stripped, every run of other characters turned into `sep`.
 * When letters had no Latin form (Han, Thai ...) a short hash of the text is added (`red-1a2b3c`), so two different titles never share a
 * slug. `fallback` is the slug when nothing is left. `max` cuts the readable part.
 */
export function asciiSlug(text: string, o: { sep: '-' | '_'; fallback: string; max?: number }): string {
  const { latin, dropped } = transliterate(text.normalize('NFKC'))
  const trim = new RegExp(`^${o.sep}+|${o.sep}+$`, 'g')
  let base = stripDiacritics(latin)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, o.sep)
    .replace(trim, '')
  const cut = o.max ? (dropped ? o.max - 7 : o.max) : 0 // room for the hash
  if (cut) base = base.slice(0, cut).replace(trim, '')
  if (dropped === 0) return base || o.fallback
  const hash = createHash('sha1').update(text).digest('hex').slice(0, 6)
  return `${base || o.fallback}${o.sep}${hash}`
}

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/

/** A folder-safe course slug from any text: `Rimsko carstvo` -> `rimsko-carstvo`, a title with no Latin letters -> `course-1a2b3c`. */
export function courseSlug(text: string): string {
  return asciiSlug(text, { sep: '-', fallback: 'course', max: 60 })
}

export function assertSlug(slug: string): string {
  if (!SLUG_RE.test(slug) || slug.includes('..')) throw new Error(`invalid course slug "${slug}"`)
  return slug
}

/** `<data>/courses`, one folder per course. */
export const coursesDir = (dataDir: string): string => path.join(dataDir, 'courses')

export function loadComfyConfigFor(dataDir: string): Promise<ComfyConfig> {
  return loadComfyConfig(path.join(dataDir, 'config', 'comfy.md'))
}

/** Where the custom workflows and palettes are (both seeded into the data folder from `seed/`), and the fonts you drop in for the languages the theme font lacks. */
export function dataFolders(dataDir: string): { workflows: string[]; palettes: string; voices: string; fonts: string } {
  return { workflows: workflowDirs(dataDir), palettes: path.join(dataDir, 'palettes'), voices: path.join(dataDir, 'voices'), fonts: path.join(dataDir, 'fonts') }
}
