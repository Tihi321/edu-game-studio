import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { loadCourseFromFiles, type LoadedCourse } from '../../shared/edu/load'
import { validateCourse, type ValidationResult } from '../../shared/edu/validate'
import type { Problem } from '../../shared/edu/registry'

/**
 * Node side of the course contract: reads `course/pack.json` and `course/text/*.json` from a folder and validates them, and checks that
 * the files the assets name exist. The folder holds a `course/` folder (a course of the data folder, or a golden fixture).
 */

/** Loads the files of a course folder. Nothing is validated. */
export function loadCourseFolder(root: string): Promise<LoadedCourse> {
  return loadCourseFromFiles({
    readText: async (p) => {
      try {
        return await readFile(path.join(root, ...p.split('/')), 'utf8')
      } catch {
        return undefined
      }
    },
    list: async (d) => {
      try {
        return await readdir(path.join(root, ...d.split('/')))
      } catch {
        return []
      }
    }
  })
}

export type FolderValidation = ValidationResult & { problems: Problem[] }

/** Loads and validates a course folder: the schema and the references (`validateCourse`) plus `MISSING_ASSET_FILE` for assets whose file is not on disk. */
export async function validateCourseFolder(root: string): Promise<FolderValidation> {
  const loaded = await loadCourseFolder(root)
  const res = validateCourse(loaded.pack, loaded.catalogs)
  const problems = [...loaded.problems, ...res.problems]
  const assets = (loaded.pack as { assets?: { id?: unknown; file?: unknown }[] } | undefined)?.assets
  if (Array.isArray(assets)) {
    for (const [i, a] of assets.entries()) {
      if (typeof a?.file !== 'string') continue
      const file = path.join(root, 'course', ...a.file.split('/'))
      if (path.relative(path.join(root, 'course'), file).startsWith('..')) {
        problems.push({ code: 'MISSING_ASSET_FILE', path: `assets[${i}].file`, message: `"${a.file}" is outside the course folder` })
        continue
      }
      const ok = await stat(file).then((s) => s.isFile(), () => false)
      if (!ok) problems.push({ code: 'MISSING_ASSET_FILE', path: `assets[${i}].file`, message: `the file "${a.file}" does not exist` })
    }
  }
  const ok = problems.length === 0
  return { ...res, ok, problems, ...(ok ? {} : { pack: undefined, catalogs: undefined }) }
}
