import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { assignmentOf, assignmentSchema, classReport, MAX_RESULT_BYTES, parseStudentResult, reportToCsv, reportToMarkdown, type Assignment, type ReportInput } from '../../shared/classroom'
import type { EduService } from '../edu/service'
import type { Tool, ToolDef } from './tools'

/**
 * The classroom tools (EGS-20): `edu_class_assign` gives a course an assignment (`pack.extensions.classroom.assignment`, written through the
 * same validated edit as `edu_course_edit`), `edu_class_report` reads the result files the students sent and makes the class report. Only files
 * inside the results folder are read (a link that leaves it is skipped), at most 500 of them, and a bad file is listed and skipped.
 */

const slug = z.string().describe('The course slug (see edu_list_courses)')
export const MAX_RESULT_FILES = 500

const assignInput = z.object({
  id: z.string().min(1).max(60).optional().describe('Default: a-<date>'),
  title: z.string().min(1).max(120),
  units: z.array(z.string()).optional().describe('Unit ids; empty or missing = every unit'),
  targetStars: z.number().int().min(1).max(3).optional().describe('Default 2'),
  due: z.string().optional().describe('ISO date, for example 2026-11-20'),
  message: z.string().max(400).optional().describe('Plain text shown on the title screen as is (max 400 characters)')
})

/** True when `file` is `dir` or inside it. */
const inside = (dir: string, file: string): boolean => {
  const rel = path.relative(dir, file)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function classTools(svc: EduService, def: ToolDef): Tool[] {
  const need = async (s: string) => {
    if (!(await svc.courseExists(s))) throw new Error(`no course "${s}" (edu_list_courses shows the courses)`)
  }

  return [
    def(
      'edu_class_assign',
      'Give a course an ASSIGNMENT for classroom mode: which units (empty = all), the stars to reach (1-3), a due date and a message. It is written to pack.extensions.classroom.assignment; the built game must be built again (`build: true` does it, or run edu_build) before students see the banner on the title screen. `clear: true` removes the assignment. Students type their name and press "Send to my teacher", which saves a result file; collect those files in courses/<slug>/class/results/ and call edu_class_report.',
      z.object({ slug, assignment: assignInput.optional(), clear: z.boolean().optional().describe('Remove the assignment'), build: z.boolean().optional().describe('Build the game again afterwards') }),
      async (a) => {
        await need(a.slug)
        const { pack } = await svc.courses.get(a.slug)
        if (a.clear) {
          const out = await svc.courses.edit(a.slug, { extensions: { classroom: { assignment: null } } })
          return { slug: a.slug, cleared: true, pendingCount: out.pendingCount, next: 'edu_build {slug} makes the game without the banner' }
        }
        if (!a.assignment) throw new Error('pass `assignment` (title, units, targetStars, due, message), or clear: true')
        const known = new Set(((pack.units as { id: string }[] | undefined) ?? []).map((u) => u.id))
        const bad = (a.assignment.units ?? []).filter((u) => !known.has(u))
        if (bad.length) throw new Error(`unknown unit(s) ${bad.map((b) => `"${b}"`).join(', ')}; the course has ${[...known].join(', ')}`)
        const now = new Date()
        const parsed = assignmentSchema.safeParse({ ...a.assignment, id: a.assignment.id ?? `a-${now.toISOString().slice(0, 10)}`, units: a.assignment.units ?? [], targetStars: a.assignment.targetStars ?? 2, createdAt: now.toISOString() })
        if (!parsed.success) throw new Error(`the assignment does not fit: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
        const asg: Assignment = parsed.data
        // a merge patch merges objects: an optional field that is absent must be deleted explicitly, or an older value would stay
        const patch = { extensions: { classroom: { assignment: { ...asg, due: asg.due ?? null, message: asg.message ?? null } } } }
        const out = await svc.courses.edit(a.slug, patch)
        const built = a.build ? await svc.courses.build(a.slug) : undefined
        return {
          slug: a.slug,
          assignment: asg,
          pendingCount: out.pendingCount,
          ...(built ? { built: built.ok, buildProblems: built.problems } : { next: 'the game must be built again to show the banner: edu_build {slug} (or pass build: true)' }),
          resultsFolder: path.join(svc.courses.root(a.slug), 'class', 'results')
        }
      }
    ),
    def(
      'edu_class_report',
      'Make the CLASS REPORT from the result files students sent: per student (units mastered, stars, accuracy, minutes of play, review queue), per unit, the most missed items, the weakest objectives and who has not reached the target. Reads every .json file of `folder` (default courses/<slug>/class/results/), or only the named `files`; a file that is not a result, is too big (200 KB), is for another course or assignment is listed under `rejected` and skipped. A student who sent two files counts once (the newer). Writes courses/<slug>/class/report.md and report.csv; `format` picks what is also returned (json default, markdown, csv).',
      z.object({
        slug,
        files: z.array(z.string()).optional().describe('File names inside the folder (not paths elsewhere)'),
        folder: z.string().optional().describe('The folder with the result files; default courses/<slug>/class/results'),
        format: z.enum(['markdown', 'csv', 'json']).optional()
      }),
      async (a) => {
        await need(a.slug)
        const root = svc.courses.root(a.slug)
        const folder = path.resolve(a.folder ?? path.join(root, 'class', 'results'))
        let realFolder: string
        try {
          realFolder = await realpath(folder)
          if (!(await stat(realFolder)).isDirectory()) throw new Error('not a folder')
        } catch {
          throw new Error(`the results folder ${folder} does not exist: put the students' result files there (or pass folder)`)
        }
        const rejected: { source: string; reason: string }[] = []
        let names: string[]
        if (a.files?.length) names = a.files
        else names = (await readdir(realFolder)).filter((n) => n.toLowerCase().endsWith('.json')).sort()
        if (names.length === 0) throw new Error(`no result files in ${folder}: students press "Send to my teacher" and give you the .json file`)
        if (names.length > MAX_RESULT_FILES) {
          for (const n of names.slice(MAX_RESULT_FILES)) rejected.push({ source: n, reason: `more than ${MAX_RESULT_FILES} files: this one was not read` })
          names = names.slice(0, MAX_RESULT_FILES)
        }
        const inputs: ReportInput[] = []
        for (const n of names) {
          const want = path.resolve(realFolder, n)
          try {
            if (!inside(realFolder, want)) throw new Error('it is outside the results folder')
            const st = await lstat(want)
            const real = st.isSymbolicLink() ? await realpath(want) : want
            if (!inside(realFolder, real)) throw new Error('it is a link that leaves the results folder')
            const fst = await stat(real)
            if (!fst.isFile()) throw new Error('not a file')
            if (fst.size > MAX_RESULT_BYTES) throw new Error(`larger than ${MAX_RESULT_BYTES / 1024} KB`)
            const r = parseStudentResult(await readFile(real, 'utf8'))
            if (r.ok) inputs.push({ result: r.result, source: path.basename(n) })
            else rejected.push({ source: path.basename(n), reason: r.error })
          } catch (e) {
            rejected.push({ source: path.basename(n), reason: (e as Error).message.includes('ENOENT') ? 'no such file' : (e as Error).message })
          }
        }
        const { pack, text } = await svc.courses.get(a.slug, { text: true })
        const p = pack as unknown as Parameters<typeof classReport>[0] & { sourceLang?: string; extensions?: unknown }
        const strings = ((text?.[p.sourceLang ?? 'en'] as { strings?: Record<string, string> } | null | undefined)?.strings ?? {}) as Record<string, string>
        const labels: Record<string, string> = {}
        for (const it of p.items as unknown as { id: string; prompt?: string }[]) if (it.prompt && strings[it.prompt]) labels[it.id] = strings[it.prompt]!.slice(0, 120)
        for (const o of p.objectives as unknown as { id: string; text?: string }[]) if (o.text && strings[o.text]) labels[o.id] = strings[o.text]!.slice(0, 120)
        const report = classReport(p, inputs, { assignment: assignmentOf(p.extensions), labels, rejected })
        const title = strings['course.title'] ?? a.slug
        const md = reportToMarkdown(report, title)
        const csv = reportToCsv(report)
        const dir = path.join(root, 'class')
        await mkdir(dir, { recursive: true })
        await writeFile(path.join(dir, 'report.md'), md, 'utf8')
        await writeFile(path.join(dir, 'report.csv'), csv, 'utf8')
        const fmt = a.format ?? 'json'
        return {
          slug: a.slug,
          filesRead: names.length,
          students: report.students.length,
          rejectedCount: report.rejected.length,
          written: [path.join(dir, 'report.md'), path.join(dir, 'report.csv')],
          ...(report.students.length === 0 ? { note: 'no usable result file: see `rejected`' } : {}),
          ...(fmt === 'markdown' ? { markdown: md, flags: report.flags, rejected: report.rejected } : fmt === 'csv' ? { csv, flags: report.flags, rejected: report.rejected } : { report })
        }
      }
    )
  ]
}
