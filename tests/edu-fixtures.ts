import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCourseFolder } from '../src/engine/edu/course-io'
import { makeTextResolver, validateCourse, type CheckContext } from '../src/shared/edu'
import type { CoursePack, TextCatalog } from '../src/shared/course'

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'courses')
export const FIXTURE_NAMES = ['solar-system', 'hr-a1-greetings', 'european-capitals'] as const

export interface LoadedFixture {
  dir: string
  rawPack: Record<string, unknown>
  rawCatalogs: Record<string, Record<string, unknown>>
  pack: CoursePack
  catalogs: Record<string, TextCatalog>
}

/** Loads a golden fixture and validates it (throws when it is not valid, listing the problems). */
export async function loadFixture(name: (typeof FIXTURE_NAMES)[number]): Promise<LoadedFixture> {
  const dir = path.join(FIXTURES, name)
  const loaded = await loadCourseFolder(dir)
  const res = validateCourse(loaded.pack, loaded.catalogs)
  if (!res.ok || !res.pack || !res.catalogs) throw new Error(`fixture ${name} is invalid: ${JSON.stringify(res.problems.slice(0, 5))}`)
  return { dir, rawPack: loaded.pack as Record<string, unknown>, rawCatalogs: loaded.catalogs as Record<string, Record<string, unknown>>, pack: res.pack, catalogs: res.catalogs }
}

/** A check context for one edition of a fixture. */
export function ctxFor(f: Pick<LoadedFixture, 'pack' | 'catalogs'>, lang: string): CheckContext {
  return { text: makeTextResolver(f.catalogs, lang, f.pack.targetLang), diacritics: f.pack.matching.diacritics, typos: f.pack.matching.typos }
}
