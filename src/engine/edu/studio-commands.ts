import { coursePackSchema, textCatalogSchema, type TextCatalog } from '../../shared/course'
import type { CourseLoadedView, EngineEvent, LintProblemView, ProblemView, StudioCommand } from '../../shared/protocol'
import type { CourseStore } from './store'

/**
 * The commands of the studio's Course page (EGS-05): read a course, build it, lint it, and save one edited item. Each answers with an event
 * (`course.loaded`, `course.built`, `course.linted`, `item.updated`); a failure is a `command.error` with the slug, so the page can show it
 * next to the course. They only use the course store (`svc.courses`), the same code as the CLI and the MCP tools, so they work on the files
 * of the data folder and need no model, no queue and no generator.
 */

/** What the handler needs from the course service (`EduService` has all of it). */
export interface StudioHost {
  courses: Pick<CourseStore, 'get' | 'build' | 'lint' | 'itemUpdate'>
  emit(e: EngineEvent): void
  log(message: string): void
}

const problemView = (p: { code: string; path: string; message: string }): ProblemView => ({ code: p.code, path: p.path, message: p.message })

/** One course as the studio shows it. Throws when the files do not read (a missing course, a pack that is not valid JSON or does not match the contract). */
export async function loadCourseView(courses: StudioHost['courses'], slug: string): Promise<CourseLoadedView> {
  const got = await courses.get(slug, { text: true })
  const pack = coursePackSchema.safeParse(got.pack)
  if (!pack.success) {
    const first = pack.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(pack)'}: ${i.message}`)
    throw new Error(`pack.json of "${slug}" does not match the course contract: ${first.join('; ')}${pack.error.issues.length > 5 ? `; ... and ${pack.error.issues.length - 5} more` : ''}`)
  }
  const text: Record<string, TextCatalog> = {}
  for (const [lang, raw] of Object.entries(got.text ?? {})) {
    const cat = textCatalogSchema.safeParse(raw)
    if (cat.success) text[lang] = cat.data
  }
  return { slug, pack: pack.data, text, stats: got.stats, build: got.build }
}

/** Handles one of the studio's course commands. Never throws: a failure goes out as `command.error`. */
export async function handleStudioCommand(svc: StudioHost, cmd: StudioCommand): Promise<void> {
  const fail = (e: unknown): void => {
    const message = e instanceof Error ? e.message : String(e)
    svc.log(`${cmd.type} ${cmd.slug}: ${message}`)
    svc.emit({ type: 'command.error', command: cmd.type, message, slug: cmd.slug })
  }
  const reload = async (): Promise<void> => svc.emit({ type: 'course.loaded', ...(await loadCourseView(svc.courses, cmd.slug)) })
  try {
    switch (cmd.type) {
      case 'getCourse':
        await reload()
        return
      case 'buildCourse': {
        const r = await svc.courses.build(cmd.slug, { force: cmd.force })
        svc.emit({ type: 'course.built', slug: cmd.slug, ok: r.ok, forced: r.forced, problems: r.problems.map(problemView), files: r.files.length, at: new Date().toISOString() })
        await reload()
        return
      }
      case 'lintCourse': {
        const r = await svc.courses.lint(cmd.slug, { rebuild: cmd.rebuild })
        const problems: LintProblemView[] = r.problems.map((p) => ({ code: p.code, severity: p.severity, path: p.path, message: p.message }))
        svc.emit({ type: 'course.linted', slug: cmd.slug, ok: r.ok, errors: r.errors, warnings: r.warnings, problems, built: r.built, ...(r.stale ? { stale: true } : {}), at: new Date().toISOString() })
        await reload()
        return
      }
      case 'updateItem': {
        const r = await svc.courses.itemUpdate(cmd.slug, cmd.id, cmd.patch, cmd.text)
        svc.emit({ type: 'item.updated', slug: cmd.slug, id: cmd.id, pendingCount: r.pendingCount, pending: r.pending.map(problemView), at: new Date().toISOString() })
        await reload()
        return
      }
    }
  } catch (e) {
    fail(e)
  }
}
