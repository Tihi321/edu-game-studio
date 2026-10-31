import { z } from 'zod'
import type { CoursePack } from './course'

/**
 * Classroom mode (EGS-20): a file-based loop with no server and no account.
 *  - The teacher gives a course an ASSIGNMENT (`pack.extensions.classroom.assignment`; `extensions` is a free record, so the strict pack schema
 *    is untouched and the player validates the assignment itself with `assignmentOf`).
 *  - A student plays the built game and exports a RESULT file: a summary only (never the whole progress or localStorage dump).
 *  - The teacher reads many result files with `parseStudentResult` and gets a `classReport`, as Markdown or CSV.
 * Pure (no DOM, no node): the player bundles it for the banner and the result file, the engine for the report.
 */

export const RESULT_KIND = 'edu-student-result'
export const RESULT_SCHEMA = 1
/** A result file larger than this is refused unread. */
export const MAX_RESULT_BYTES = 200 * 1024
export const MAX_NAME = 60
export const MAX_MESSAGE = 400

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/
const idStr = z.string().regex(SAFE_ID)
const isoDate = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/, 'an ISO date such as 2026-11-20')
  .refine((s) => Number.isFinite(Date.parse(s)), 'not a real date')

export const assignmentSchema = z.object({
  id: z.string().min(1).max(60),
  title: z.string().min(1).max(120),
  /** Unit ids; empty means every unit. */
  units: z.array(idStr).max(200).default([]),
  targetStars: z.number().int().min(1).max(3).default(2),
  due: isoDate.optional(),
  /** Plain text shown as is (no catalog key, no markup): the player sets it with textContent. */
  message: z.string().max(MAX_MESSAGE).optional(),
  createdAt: isoDate
})
export type Assignment = z.infer<typeof assignmentSchema>

/** The assignment of a pack's `extensions`, checked; null when there is none or it does not fit. */
export function assignmentOf(extensions: unknown): Assignment | null {
  const raw = (extensions as { classroom?: { assignment?: unknown } } | null | undefined)?.classroom?.assignment
  if (raw === undefined || raw === null) return null
  const r = assignmentSchema.safeParse(raw)
  return r.success ? r.data : null
}

/** The unit ids an assignment covers in this pack: its list (unknown ids dropped), or every unit when the list is empty or names none. */
export function assignedUnits(pack: Pick<CoursePack, 'units'>, a: Pick<Assignment, 'units'> | null): string[] {
  const all = pack.units.map((u) => u.id)
  if (!a || a.units.length === 0) return all
  const known = all.filter((id) => a.units.includes(id))
  return known.length ? known : all
}

// ---- the student's result file ----

const unitSummary = z.object({ stars: z.number().int().min(0).max(3), best: z.number().min(0).max(1), rounds: z.number().int().min(0).max(1_000_000) })
export const studentResultSchema = z.object({
  schema: z.literal(RESULT_SCHEMA),
  kind: z.literal(RESULT_KIND),
  courseId: z.string().min(1).max(120),
  assignmentId: z.string().min(1).max(60).optional(),
  student: z.object({ name: z.string().min(1).max(MAX_NAME), id: z.string().min(1).max(80) }),
  exportedAt: isoDate,
  units: z.record(idStr, unitSummary),
  boss: unitSummary,
  answered: z.number().int().min(0).max(1e9),
  right: z.number().int().min(0).max(1e9),
  queue: z.array(idStr).max(2000),
  missed: z.record(idStr, z.number().int().min(1).max(100_000)),
  playSeconds: z.number().int().min(0).max(36_000_000)
})
export type StudentResult = z.infer<typeof studentResultSchema>

/** A name as stored: control characters out, spaces collapsed, trimmed, at most 60 characters; '' when nothing is left. */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim()
}

/** The slice of the player's Progress a result needs (structural, so this file does not import the player). */
export interface ProgressLike {
  units: Record<string, { stars: number; best: number; rounds: number }>
  boss: { stars: number; best: number; rounds: number }
  cards: Record<string, { lapses: number }>
  queue: string[]
  answered: number
  right: number
  playSeconds?: number
  shells?: Record<string, { units: Record<string, { stars: number; best: number; rounds: number }>; boss: { stars: number; best: number; rounds: number } }>
}

const merge = (a: { stars: number; best: number; rounds: number } | undefined, b: { stars: number; best: number; rounds: number } | undefined) => ({
  stars: Math.max(a?.stars ?? 0, b?.stars ?? 0),
  best: Math.max(a?.best ?? 0, b?.best ?? 0),
  rounds: (a?.rounds ?? 0) + (b?.rounds ?? 0)
})

/** The result file of one learner: stars per unit (the best over the quiz arena and every shell), the boss, counts, the review queue and the misses. */
export function buildStudentResult(pack: Pick<CoursePack, 'id' | 'units' | 'items'>, p: ProgressLike, who: { name: string; id: string; assignmentId?: string; now?: Date }): StudentResult {
  const units: StudentResult['units'] = {}
  let boss = merge(p.boss, undefined)
  for (const u of pack.units) {
    let m = merge(p.units[u.id], undefined)
    for (const sp of Object.values(p.shells ?? {})) m = merge(m, sp.units[u.id])
    if (m.stars > 0 || m.rounds > 0) units[u.id] = m
  }
  for (const sp of Object.values(p.shells ?? {})) boss = merge(boss, sp.boss)
  const itemIds = new Set(pack.items.map((i) => i.id))
  const queue = p.queue.filter((q) => itemIds.has(q))
  const missed: Record<string, number> = {}
  for (const [id, c] of Object.entries(p.cards)) if (itemIds.has(id) && c.lapses > 0) missed[id] = c.lapses
  for (const id of queue) missed[id] = Math.max(1, missed[id] ?? 0)
  const answered = Math.max(0, Math.round(p.answered))
  return studentResultSchema.parse({
    schema: RESULT_SCHEMA,
    kind: RESULT_KIND,
    courseId: pack.id,
    ...(who.assignmentId ? { assignmentId: who.assignmentId } : {}),
    student: { name: cleanName(who.name) || 'Student', id: who.id },
    exportedAt: (who.now ?? new Date()).toISOString(),
    units,
    boss,
    answered,
    right: Math.min(answered, Math.max(0, Math.round(p.right))),
    queue,
    missed,
    playSeconds: Math.max(0, Math.round(p.playSeconds ?? 0))
  })
}

export type ParsedResult = { ok: true; result: StudentResult } | { ok: false; error: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const clampInt = (v: unknown, min: number, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : min)
const clampNum = (v: unknown, min: number, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min)
const cleanUnit = (v: unknown) => (isObj(v) ? { stars: clampInt(v.stars, 0, 3), best: clampNum(v.best, 0, 1), rounds: clampInt(v.rounds, 0, 1_000_000) } : { stars: 0, best: 0, rounds: 0 })

/**
 * Reads a result file defensively: at most 200 KB, the right kind and schema, unknown keys dropped, numbers clamped, ids that are not plain
 * ids dropped, the name cleaned. A file that is not a result, or has no usable name, is refused with the reason.
 */
export function parseStudentResult(text: string): ParsedResult {
  if (typeof text !== 'string') return { ok: false, error: 'not text' }
  if (Buffer_length(text) > MAX_RESULT_BYTES) return { ok: false, error: `larger than ${MAX_RESULT_BYTES / 1024} KB` }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'not JSON' }
  }
  if (!isObj(data)) return { ok: false, error: 'not an object' }
  if (data.kind !== RESULT_KIND) return { ok: false, error: `not a student result (kind "${typeof data.kind === 'string' ? data.kind.slice(0, 40) : '?'}")` }
  if (data.schema !== RESULT_SCHEMA) return { ok: false, error: `unknown schema ${String(typeof data.schema === 'number' ? data.schema : '?')}` }
  if (typeof data.courseId !== 'string' || !data.courseId) return { ok: false, error: 'no course id' }
  const st = isObj(data.student) ? data.student : {}
  const name = cleanName(st.name)
  if (!name) return { ok: false, error: 'no student name' }
  const units: Record<string, unknown> = {}
  if (isObj(data.units)) {
    for (const [id, u] of Object.entries(data.units).slice(0, 500)) if (SAFE_ID.test(id)) units[id] = cleanUnit(u)
  }
  const missed: Record<string, number> = {}
  if (isObj(data.missed)) {
    for (const [id, n] of Object.entries(data.missed).slice(0, 2000)) if (SAFE_ID.test(id) && typeof n === 'number' && Number.isFinite(n)) missed[id] = clampInt(n, 1, 100_000)
  }
  const answered = clampInt(data.answered, 0, 1e9)
  const when = typeof data.exportedAt === 'string' && Number.isFinite(Date.parse(data.exportedAt)) ? data.exportedAt.slice(0, 40) : undefined
  if (!when || !isoDate.safeParse(when).success) return { ok: false, error: 'no export date' }
  const candidate = {
    schema: RESULT_SCHEMA,
    kind: RESULT_KIND,
    courseId: data.courseId.slice(0, 120),
    ...(typeof data.assignmentId === 'string' && data.assignmentId ? { assignmentId: data.assignmentId.slice(0, 60) } : {}),
    student: { name, id: typeof st.id === 'string' && st.id ? st.id.slice(0, 80) : name },
    exportedAt: when,
    units,
    boss: cleanUnit(data.boss),
    answered,
    right: Math.min(answered, clampInt(data.right, 0, 1e9)),
    queue: Array.isArray(data.queue) ? [...new Set(data.queue.filter((q): q is string => typeof q === 'string' && SAFE_ID.test(q)))].slice(0, 2000) : [],
    missed,
    playSeconds: clampInt(data.playSeconds, 0, 36_000_000)
  }
  const r = studentResultSchema.safeParse(candidate)
  return r.success ? { ok: true, result: r.data } : { ok: false, error: r.error.issues[0]?.message ?? 'invalid' }
}

/** UTF-8 length without Buffer (the player bundle has none). */
function Buffer_length(s: string): number {
  return new TextEncoder().encode(s).length
}

// ---- the class report ----

export interface ReportInput {
  result: StudentResult
  /** Where it came from (a file name), for the messages. */
  source?: string
}
export interface StudentRow {
  name: string
  unitsMastered: number
  unitsAssigned: number
  stars: number
  maxStars: number
  /** Percent, 0..100 (first-try answers right over answers given). */
  accuracy: number
  /** Time on task proxy: minutes of play with activity. */
  minutes: number
  answered: number
  queue: string[]
  /** Every assigned unit has at least the target stars. */
  finished: boolean
  exportedAt: string
  source?: string
}
export interface UnitStat {
  unit: string
  /** Students with at least 2 stars. */
  mastered: number
  reachedTarget: number
  avgStars: number
}
export interface ItemStat {
  item: string
  objective: string
  unit: string
  label?: string
  /** Students who missed it at least once. */
  students: number
  misses: number
}
export interface ObjectiveStat {
  objective: string
  unit: string
  label?: string
  items: number
  /** 0..1: of all (student, item) pairs of the objective, the share missed. */
  missRate: number
}
export interface ClassReport {
  courseId: string
  assignment: Assignment | null
  students: StudentRow[]
  units: UnitStat[]
  items: ItemStat[]
  weakestObjectives: ObjectiveStat[]
  unfinished: string[]
  /** Files left out, with the reason. */
  rejected: { source: string; reason: string }[]
  /** Notes: replaced duplicates and so on. */
  flags: string[]
}

export interface ReportOptions {
  assignment?: Assignment | null
  /** Readable text for ids (items, objectives), for example the prompt in the source language. */
  labels?: Record<string, string>
  /** Result files already refused when they were read (bad JSON ...), carried into the report. */
  rejected?: { source: string; reason: string }[]
}

const nameKey = (n: string): string => n.normalize('NFKC').toLocaleLowerCase()

export function classReport(pack: Pick<CoursePack, 'id' | 'units' | 'items' | 'objectives'>, inputs: readonly (ReportInput | StudentResult)[], opts: ReportOptions = {}): ClassReport {
  const assignment = opts.assignment ?? null
  const rejected = [...(opts.rejected ?? [])]
  const flags: string[] = []
  const byName = new Map<string, ReportInput>()
  inputs.forEach((raw, i) => {
    const inp: ReportInput = 'result' in raw ? raw : { result: raw }
    const r = inp.result
    const src = inp.source ?? `result ${i + 1}`
    if (r.courseId !== pack.id) return void rejected.push({ source: src, reason: `it is for the course "${r.courseId}", not "${pack.id}"` })
    if (assignment && r.assignmentId !== undefined && r.assignmentId !== assignment.id) return void rejected.push({ source: src, reason: `it is for the assignment "${r.assignmentId}", not "${assignment.id}"` })
    const key = nameKey(r.student.name)
    const cur = byName.get(key)
    if (!cur) return void byName.set(key, { ...inp, source: src })
    const newer = Date.parse(r.exportedAt) >= Date.parse(cur.result.exportedAt)
    flags.push(`"${r.student.name}" sent two files (${cur.source}, ${src}): the newer one is used`)
    if (newer) byName.set(key, { ...inp, source: src })
  })
  const results = [...byName.values()]
  const assigned = assignedUnits(pack, assignment)
  const target = assignment?.targetStars ?? 2
  const students: StudentRow[] = results
    .map(({ result: r, source }) => {
      const stars = assigned.reduce((n, id) => n + (r.units[id]?.stars ?? 0), 0)
      return {
        name: r.student.name,
        unitsMastered: assigned.filter((id) => (r.units[id]?.stars ?? 0) >= 2).length,
        unitsAssigned: assigned.length,
        stars,
        maxStars: assigned.length * 3,
        accuracy: r.answered > 0 ? Math.round((r.right / r.answered) * 100) : 0,
        minutes: Math.round(r.playSeconds / 60),
        answered: r.answered,
        queue: r.queue,
        finished: assigned.every((id) => (r.units[id]?.stars ?? 0) >= target),
        exportedAt: r.exportedAt,
        ...(source ? { source } : {})
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const n = results.length
  const units: UnitStat[] = assigned.map((unit) => {
    const stars = results.map(({ result: r }) => r.units[unit]?.stars ?? 0)
    return { unit, mastered: stars.filter((s) => s >= 2).length, reachedTarget: stars.filter((s) => s >= target).length, avgStars: n ? Math.round((stars.reduce((a, b) => a + b, 0) / n) * 10) / 10 : 0 }
  })
  const objOf = new Map(pack.objectives.map((o) => [o.id, o]))
  const inScope = new Set(assigned)
  const scoped = pack.items.filter((it) => inScope.has(objOf.get(it.objective)?.unit ?? ''))
  const items: ItemStat[] = scoped
    .map((it) => {
      const counts = results.map(({ result: r }) => r.missed[it.id] ?? 0)
      return { item: it.id, objective: it.objective, unit: objOf.get(it.objective)?.unit ?? '', ...(opts.labels?.[it.id] ? { label: opts.labels[it.id] } : {}), students: counts.filter((c) => c > 0).length, misses: counts.reduce((a, b) => a + b, 0) }
    })
    .filter((s) => s.students > 0)
    .sort((a, b) => b.students - a.students || b.misses - a.misses || a.item.localeCompare(b.item))
  const missedBy = new Map(items.map((s) => [s.item, s.students]))
  const weakestObjectives: ObjectiveStat[] = pack.objectives
    .filter((o) => inScope.has(o.unit))
    .map((o) => {
      const its = scoped.filter((it) => it.objective === o.id)
      const pairs = its.length * n
      const missedPairs = its.reduce((a, it) => a + (missedBy.get(it.id) ?? 0), 0)
      return { objective: o.id, unit: o.unit, ...(opts.labels?.[o.id] ? { label: opts.labels[o.id] } : {}), items: its.length, missRate: pairs ? Math.round((missedPairs / pairs) * 100) / 100 : 0 }
    })
    .filter((o) => o.missRate > 0)
    .sort((a, b) => b.missRate - a.missRate || a.objective.localeCompare(b.objective))
    .slice(0, 5)
  return { courseId: pack.id, assignment, students, units, items, weakestObjectives, unfinished: students.filter((s) => !s.finished).map((s) => s.name), rejected, flags }
}

// ---- Markdown and CSV ----

const mdCell = (s: string): string => s.replace(/[\r\n]+/g, ' ').replace(/[|\\`*_<>[\]]/g, (c) => `\\${c}`)

export function reportToMarkdown(r: ClassReport, title = r.courseId): string {
  const out: string[] = [`# Class report: ${mdCell(title)}`, '']
  if (r.assignment) {
    out.push(`Assignment: **${mdCell(r.assignment.title)}** (reach ${r.assignment.targetStars} star${r.assignment.targetStars === 1 ? '' : 's'} in ${r.assignment.units.length ? r.assignment.units.map(mdCell).join(', ') : 'every unit'}${r.assignment.due ? `, due ${r.assignment.due.slice(0, 10)}` : ''})`, '')
  }
  out.push(`${r.students.length} student${r.students.length === 1 ? '' : 's'}, ${r.unfinished.length} not finished.`, '')
  out.push('## Students', '', '| Student | Units mastered | Stars | Accuracy | Minutes | Review queue | Finished |', '| --- | --- | --- | --- | --- | --- | --- |')
  for (const s of r.students) out.push(`| ${mdCell(s.name)} | ${s.unitsMastered}/${s.unitsAssigned} | ${s.stars}/${s.maxStars} | ${s.accuracy}% | ${s.minutes} | ${s.queue.length} | ${s.finished ? 'yes' : 'no'} |`)
  out.push('', '## Units', '', '| Unit | Mastered | Reached the target | Average stars |', '| --- | --- | --- | --- |')
  for (const u of r.units) out.push(`| ${mdCell(u.unit)} | ${u.mastered}/${r.students.length} | ${u.reachedTarget}/${r.students.length} | ${u.avgStars} |`)
  out.push('', '## Weakest objectives', '')
  if (r.weakestObjectives.length === 0) out.push('None: nobody missed anything.')
  for (const o of r.weakestObjectives) out.push(`- ${mdCell(o.label ?? o.objective)} (${mdCell(o.unit)}): ${Math.round(o.missRate * 100)}% of answers missed`)
  out.push('', '## Most missed items', '')
  if (r.items.length === 0) out.push('None.')
  for (const it of r.items.slice(0, 20)) out.push(`- ${mdCell(it.label ?? it.item)} (${mdCell(it.item)}): ${it.students} student${it.students === 1 ? '' : 's'}, ${it.misses} miss${it.misses === 1 ? '' : 'es'}`)
  out.push('', '## Not finished', '')
  out.push(r.unfinished.length ? r.unfinished.map((n) => `- ${mdCell(n)}`).join('\n') : 'Everyone reached the target.')
  if (r.flags.length || r.rejected.length) {
    out.push('', '## Notes', '')
    for (const f of r.flags) out.push(`- ${mdCell(f)}`)
    for (const x of r.rejected) out.push(`- Left out ${mdCell(x.source)}: ${mdCell(x.reason)}`)
  }
  return out.join('\n') + '\n'
}

/** One CSV cell: a cell that a spreadsheet would read as a formula (= + - @, tab, CR) gets a leading quote; commas, quotes and newlines are quoted. */
export function csvCell(v: string | number | boolean): string {
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function reportToCsv(r: ClassReport): string {
  const head = ['student', 'units_mastered', 'units_assigned', 'stars', 'max_stars', 'accuracy_pct', 'minutes', 'answered', 'review_queue', 'finished', 'exported_at']
  const rows = r.students.map((s) => [s.name, s.unitsMastered, s.unitsAssigned, s.stars, s.maxStars, s.accuracy, s.minutes, s.answered, s.queue.length, s.finished, s.exportedAt])
  return [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n'
}
