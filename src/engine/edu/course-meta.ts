import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { parseMd, serializeMd } from '../../shared/md'
import { parseCourseMedia } from '../../shared/media'
import type { CourseMedia } from '../../shared/media'
import { atomicWrite } from '../store/atomic'
import { assertSlug, coursesDir } from './paths'

/**
 * `courses/<slug>/course.md`: the course's own settings. Frontmatter `kind: course`, optional `models` (`<role>` or `"*"` -> `provider/model`,
 * first in that course's model lists), later `brief`, `run` and `stage` (EGS-08). The body is a free log. Fields this code does not know are
 * kept when it writes the file.
 */

/** The frontmatter fields this ticket reads. The file is loose: `brief`, `run`, `stage` and notes of your own stay. */
export const courseMetaSchema = z.looseObject({
  kind: z.literal('course').default('course'),
  /** Per role, or `*` for every role: the model the course's jobs use first (`provider/model`). */
  models: z.record(z.string(), z.string()).default({})
})
export type CourseMeta = z.output<typeof courseMetaSchema>

export const courseMdPath = (dataDir: string, slug: string): string => path.join(coursesDir(dataDir), assertSlug(slug), 'course.md')

export interface CourseMetaFile {
  data: CourseMeta
  body: string
}

/** The frontmatter as it is in the file (no defaults added) and the body. Null when there is no file. */
async function readRaw(dataDir: string, slug: string): Promise<{ raw: Record<string, unknown>; body: string } | null> {
  const file = courseMdPath(dataDir, slug)
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const doc = parseMd(text, file)
  return { raw: doc.data, body: doc.body }
}

const parseMeta = (file: string, raw: Record<string, unknown>): CourseMeta => {
  const parsed = courseMetaSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`${file}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
  return parsed.data
}

/** Reads `course.md`. Null when there is none. A file that does not parse throws (a hand edit with bad YAML). */
export async function readCourseMeta(dataDir: string, slug: string): Promise<CourseMetaFile | null> {
  const got = await readRaw(dataDir, slug)
  return got ? { data: parseMeta(courseMdPath(dataDir, slug), got.raw), body: got.body } : null
}

const locks = new Map<string, Promise<unknown>>()

/**
 * Sets top-level frontmatter fields of `course.md` (a value of `undefined` or `null` deletes the field) and writes it, atomically. The file
 * is created when missing. `models` is replaced as a whole when given (pass the full map; `patchCourseModels` merges one role).
 * `body` replaces the text below the frontmatter, or is computed from the old one. Writes to one file run one after another.
 */
export function patchCourseMeta(dataDir: string, slug: string, patch: Record<string, unknown> | ((old: CourseMeta) => Record<string, unknown>), o: { body?: string | ((old: string) => string) } = {}): Promise<CourseMetaFile> {
  const file = courseMdPath(dataDir, slug)
  const run = async (): Promise<CourseMetaFile> => {
    const old = (await readRaw(dataDir, slug)) ?? { raw: {}, body: '' }
    const next: Record<string, unknown> = { ...old.raw, kind: 'course' }
    for (const [k, v] of Object.entries(typeof patch === 'function' ? patch(parseMeta(file, old.raw)) : patch)) {
      if (v === undefined || v === null) delete next[k]
      else next[k] = v
    }
    const body = typeof o.body === 'function' ? o.body(old.body) : (o.body ?? old.body)
    const data = parseMeta(file, next)
    await atomicWrite(file, serializeMd(next, body))
    return { data, body }
  }
  const prev = locks.get(file) ?? Promise.resolve()
  const result = prev.then(run, run)
  locks.set(file, result.catch(() => undefined))
  return result
}

/** Sets (or, with `null`, removes) the model of one role in `course.md` (`*` for every role). The other roles' models stay. */
export async function patchCourseModels(dataDir: string, slug: string, models: Record<string, string | null>): Promise<CourseMetaFile> {
  return patchCourseMeta(dataDir, slug, (old) => {
    const next: Record<string, string> = { ...old.models }
    for (const [role, model] of Object.entries(models)) {
      if (model === null || model.trim() === '') delete next[role]
      else next[role] = model.trim()
    }
    return { models: Object.keys(next).length ? next : undefined }
  })
}

/**
 * The media settings of a course: `course.md` `media` (`art`, `music`, `voice`, `sound`) with the defaults of `courseMediaSchema`. A course with no
 * `course.md`, or with no `media` block, gets the defaults: ComfyUI for the images, the art-critic on, Flow off.
 */
export function parseCourseMetaMedia(meta: CourseMetaFile | null): CourseMedia {
  return parseCourseMedia((meta?.data as { media?: unknown } | undefined)?.media)
}

/** The model a course sets for a role: its entry for the role, else its `*` entry. */
export function modelFor(models: Record<string, string>, role: string): string | undefined {
  return models[role] || models['*'] || undefined
}
