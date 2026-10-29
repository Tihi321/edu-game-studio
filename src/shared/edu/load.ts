import type { Problem } from './registry'

/**
 * Reads a course from files without knowing where they are: the caller gives a way to read a text file and to list a folder (node's
 * `fs`, a zip, the browser). Layout: `course/pack.json` and `course/text/<lang>.json`. Nothing is validated here; hand the result to
 * `validateCourse`. A file that is missing or is not JSON is a `PARSE` problem.
 */
export interface CourseFiles {
  /** The text of a file, or undefined when it does not exist. Paths use `/`. */
  readText(path: string): Promise<string | undefined>
  /** The file names in a folder (empty when it does not exist). */
  list(dir: string): Promise<string[]>
}

export interface LoadedCourse {
  pack: unknown
  /** By language (the file name without `.json`). */
  catalogs: Record<string, unknown>
  /** Files that are missing or not JSON. */
  problems: Problem[]
}

export async function loadCourseFromFiles(files: CourseFiles): Promise<LoadedCourse> {
  const problems: Problem[] = []
  const parse = async (path: string): Promise<unknown> => {
    const text = await files.readText(path)
    if (text === undefined) {
      problems.push({ code: 'PARSE', path, message: `${path} does not exist` })
      return undefined
    }
    try {
      return JSON.parse(text.replace(/^\uFEFF/, ''))
    } catch (e) {
      problems.push({ code: 'PARSE', path, message: `${path} is not valid JSON: ${(e as Error).message}` })
      return undefined
    }
  }
  const pack = await parse('course/pack.json')
  const catalogs: Record<string, unknown> = {}
  for (const name of (await files.list('course/text')).filter((n) => n.endsWith('.json')).sort()) {
    const v = await parse(`course/text/${name}`)
    if (v !== undefined) catalogs[name.slice(0, -'.json'.length)] = v
  }
  return { pack, catalogs, problems }
}
