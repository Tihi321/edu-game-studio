import { describe, expect, it } from 'vitest'
import {
  MAX_RESULT_BYTES,
  assignedUnits,
  assignmentOf,
  assignmentSchema,
  buildStudentResult,
  classReport,
  cleanName,
  csvCell,
  parseStudentResult,
  reportToCsv,
  reportToMarkdown,
  studentResultSchema,
  type StudentResult
} from '../src/shared/classroom'
import { newProgress, parseProgress, recordRound, type Progress } from '../src/player/progress'
import type { CoursePack } from '../src/shared/course'

const unit = (id: string) => ({ id, title: `${id}.t`, requires: [] as string[] })
const obj = (id: string, u: string) => ({ id, unit: u, bloom: 'remember', text: `${id}.t`, facts: [] as string[] })
const item = (id: string, o: string) => ({ id, objective: o })
const PACK = {
  id: 'course-a',
  units: [unit('u1'), unit('u2'), unit('u3')],
  objectives: [obj('o1', 'u1'), obj('o2', 'u2'), obj('o3', 'u3')],
  items: [item('i1', 'o1'), item('i2', 'o1'), item('i3', 'o2'), item('i4', 'o3')]
} as unknown as Pick<CoursePack, 'id' | 'units' | 'objectives' | 'items'>

const ASSIGNMENT = assignmentSchema.parse({ id: 'a1', title: 'Week 3', units: ['u1', 'u2'], targetStars: 2, due: '2026-11-20', message: 'Do it <b>today</b>', createdAt: '2026-11-01T08:00:00.000Z' })

function result(name: string, o: Partial<StudentResult> & { stars?: Record<string, number> } = {}): StudentResult {
  const { stars = {}, ...rest } = o
  return studentResultSchema.parse({
    schema: 1,
    kind: 'edu-student-result',
    courseId: 'course-a',
    assignmentId: 'a1',
    student: { name, id: `id-${name}` },
    exportedAt: '2026-11-10T10:00:00.000Z',
    units: Object.fromEntries(Object.entries(stars).map(([u, s]) => [u, { stars: s, best: s / 3, rounds: 1 }])),
    boss: { stars: 0, best: 0, rounds: 0 },
    answered: 10,
    right: 8,
    queue: [],
    missed: {},
    playSeconds: 600,
    ...rest
  })
}

describe('the assignment', () => {
  it('the assignment is read from pack.extensions and an empty unit list means every unit', () => {
  // is read from pack.extensions and checked
  {
    expect(assignmentOf({ classroom: { assignment: ASSIGNMENT } })?.title).toBe('Week 3')
    expect(assignmentOf({})).toBeNull()
    expect(assignmentOf(undefined)).toBeNull()
    expect(assignmentOf({ classroom: { assignment: { id: 'x' } } })).toBeNull()
    expect(assignmentOf({ classroom: { assignment: { ...ASSIGNMENT, targetStars: 4 } } })).toBeNull()
    expect(assignmentOf({ classroom: { assignment: { ...ASSIGNMENT, message: 'x'.repeat(401) } } })).toBeNull()
    expect(assignmentOf({ classroom: { assignment: { ...ASSIGNMENT, due: 'tomorrow' } } })).toBeNull()
  }
  // an empty unit list means every unit; unknown units are dropped
  {
    expect(assignedUnits(PACK, null)).toEqual(['u1', 'u2', 'u3'])
    expect(assignedUnits(PACK, { units: [] })).toEqual(['u1', 'u2', 'u3'])
    expect(assignedUnits(PACK, { units: ['u2', 'nope'] })).toEqual(['u2'])
    expect(assignedUnits(PACK, { units: ['nope'] })).toEqual(['u1', 'u2', 'u3'])
  }
  })
})

describe('building a result from a Progress', () => {
  it('keeps a summary, not the whole progress', () => {
    let p: Progress = newProgress('course-a')
    p = recordRound(p, { unitId: 'u1' }, 0.95)
    p = recordRound(p, { unitId: 'u2' }, 0.6)
    p = { ...p, answered: 20, right: 15, queue: ['i3', 'ghost'], cards: { i3: { id: 'i3', ease: 2.5, interval: 1, reps: 0, lapses: 2, due: 0, last: null }, i1: { id: 'i1', ease: 2.5, interval: 1, reps: 1, lapses: 0, due: 0, last: null } }, playSeconds: 125, score: 999 }
    p.shells.rpg = { units: { u2: { stars: 3, best: 1, rounds: 2 } }, boss: { stars: 0, best: 0, rounds: 0 }, finished: false, data: { secret: 'x'.repeat(100) } }
    const r = buildStudentResult(PACK, p, { name: '  Ana   Horvat ', id: 'dev-1', assignmentId: 'a1', now: new Date('2026-11-10T10:00:00Z') })
    expect(r.student).toEqual({ name: 'Ana Horvat', id: 'dev-1' })
    expect(r.units.u1).toMatchObject({ stars: 3, rounds: 1 })
    expect(r.units.u2).toMatchObject({ stars: 3, rounds: 3 }) // quiz arena 1 star + rpg 3 stars
    expect(r.queue).toEqual(['i3'])
    expect(r.missed).toEqual({ i3: 2 })
    expect(r).toMatchObject({ answered: 20, right: 15, playSeconds: 125, assignmentId: 'a1' })
    const text = JSON.stringify(r)
    expect(text).not.toContain('secret')
    expect(text).not.toContain('score')
    expect(text).not.toContain('cards')
    expect(parseStudentResult(text)).toMatchObject({ ok: true })
  })
})

describe('reading a result file defensively', () => {
  const good = () => JSON.parse(JSON.stringify(result('Ana', { stars: { u1: 3 } }))) as Record<string, unknown>
  it('reading a result file defensively: good file, size and kind, clamping, name cleaning', () => {
  // accepts a good file and drops unknown keys
  {
    const r = parseStudentResult(JSON.stringify({ ...good(), cards: { huge: 1 }, extra: 'x' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(Object.keys(r.result)).not.toContain('cards')
  }
  // refuses a file over 200 KB, not JSON, the wrong kind or schema
  {
    const big = JSON.stringify({ ...good(), pad: 'x'.repeat(MAX_RESULT_BYTES) })
    expect(parseStudentResult(big)).toEqual({ ok: false, error: 'larger than 200 KB' })
    expect(parseStudentResult('{nope')).toEqual({ ok: false, error: 'not JSON' })
    expect(parseStudentResult('[]')).toMatchObject({ ok: false })
    expect(parseStudentResult(JSON.stringify({ ...good(), kind: 'edu-progress' }))).toMatchObject({ ok: false, error: expect.stringContaining('not a student result') })
    expect(parseStudentResult(JSON.stringify({ ...good(), schema: 2 }))).toMatchObject({ ok: false, error: expect.stringContaining('schema') })
  }
  // clamps bad numbers and drops bad ids
  {
    const r = parseStudentResult(
      JSON.stringify({ ...good(), answered: 5, right: 99, playSeconds: -4, units: { u1: { stars: 99, best: 7, rounds: 'x' }, '../evil': { stars: 3 }, 'a b': { stars: 3 } }, missed: { i1: -5, i2: 'x', '__proto__': 3, 'ok-id': 2.4 }, queue: ['i1', 'i1', 5, '<script>'] })
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.right).toBe(5)
    expect(r.result.playSeconds).toBe(0)
    expect(r.result.units).toEqual({ u1: { stars: 3, best: 1, rounds: 0 } })
    expect(r.result.missed).toEqual({ i1: 1, 'ok-id': 2 })
    expect(r.result.queue).toEqual(['i1'])
  }
  // cleans an injection-looking name and refuses an empty one
  {
    const r = parseStudentResult(JSON.stringify({ ...good(), student: { name: '  =HYPERLINK("http://x")\u0000\n  ', id: 'z' } }))
    expect(r.ok && r.result.student.name).toBe('=HYPERLINK("http://x")')
    expect(parseStudentResult(JSON.stringify({ ...good(), student: { name: '  \n\t ', id: 'z' } }))).toMatchObject({ ok: false, error: 'no student name' })
    expect(cleanName('x'.repeat(100)).length).toBe(60)
    expect(cleanName(42)).toBe('')
  }
  })
})

describe('the class report', () => {
  const inputs = [
    { source: 'ana-old.json', result: result('Ana', { stars: { u1: 1 }, exportedAt: '2026-11-05T10:00:00.000Z', missed: { i1: 1 } }) },
    { source: 'ana-new.json', result: result('ANA', { stars: { u1: 3, u2: 2 }, queue: ['i3'], missed: { i3: 2 }, playSeconds: 3600, answered: 40, right: 30 }) },
    { source: 'ben.json', result: result('Ben', { stars: { u1: 2, u2: 1 }, queue: ['i1', 'i2', 'i3'], missed: { i1: 3, i2: 1, i3: 1 }, answered: 12, right: 6, playSeconds: 90 }) },
    { source: 'cleo.json', result: result('Cleo', { stars: { u1: 3, u2: 3, u3: 1 }, missed: { i1: 1 }, answered: 0, right: 0, playSeconds: 0 }) },
    { source: 'dino.json', result: result('Dino', { stars: {} }) },
    { source: 'other.json', result: result('Eve', { courseId: 'other-course', stars: { u1: 3 } }) },
    { source: 'wrong-assignment.json', result: result('Fay', { assignmentId: 'old', stars: { u1: 3 } }) }
  ]
  const report = classReport(PACK, inputs, { assignment: ASSIGNMENT, labels: { i1: 'First question' } })

  it('the class report: rows, per-student math, per unit and item, defaults, Markdown and CSV', () => {
  // has one row per student, the newer duplicate wins, other courses and assignments are rejected with a reason
  {
    expect(report.students.map((s) => s.name)).toEqual(['ANA', 'Ben', 'Cleo', 'Dino'])
    expect(report.students).toHaveLength(4)
    expect(report.flags.join(' ')).toContain('newer one is used')
    expect(report.rejected).toEqual([
      { source: 'other.json', reason: 'it is for the course "other-course", not "course-a"' },
      { source: 'wrong-assignment.json', reason: 'it is for the assignment "old", not "a1"' }
    ])
  }
  // per student math covers the assigned units only
  {
    const by = Object.fromEntries(report.students.map((s) => [s.name, s]))
    expect(by['ANA']).toMatchObject({ unitsMastered: 2, unitsAssigned: 2, stars: 5, maxStars: 6, accuracy: 75, minutes: 60, finished: true })
    expect(by['Ben']).toMatchObject({ unitsMastered: 1, stars: 3, accuracy: 50, minutes: 2, finished: false })
    expect(by['Ben']!.queue).toEqual(['i1', 'i2', 'i3'])
    expect(by['Cleo']).toMatchObject({ unitsMastered: 2, stars: 6, accuracy: 0, finished: true }) // u3 is not assigned
    expect(by['Dino']).toMatchObject({ unitsMastered: 0, stars: 0, finished: false })
    expect(report.unfinished).toEqual(['Ben', 'Dino'])
  }
  // per unit, per item and the weakest objectives
  {
    expect(report.units).toEqual([
      { unit: 'u1', mastered: 3, reachedTarget: 3, avgStars: 2 },
      { unit: 'u2', mastered: 2, reachedTarget: 2, avgStars: 1.5 }
    ])
    // i1: Ben and Cleo (Ana's old file was replaced); i3: Ana and Ben; u3 items are out of scope
    expect(report.items.map((i) => [i.item, i.students, i.misses])).toEqual([
      ['i1', 2, 4],
      ['i3', 2, 3],
      ['i2', 1, 1]
    ])
    expect(report.items[0]?.label).toBe('First question')
    // o1: 3 of 8 pairs; o2: 2 of 4 pairs
    expect(report.weakestObjectives.map((o) => [o.objective, o.missRate])).toEqual([
      ['o2', 0.5],
      ['o1', 0.38]
    ])
  }
  // without an assignment every unit counts with the default target of 2 stars
  {
    const r = classReport(PACK, [result('Zed', { stars: { u1: 2, u2: 2, u3: 2 } })])
    expect(r.students[0]).toMatchObject({ unitsAssigned: 3, finished: true })
    expect(r.unfinished).toEqual([])
  }
  // renders Markdown, escaping pipes and markup in names
  {
    const md = reportToMarkdown(classReport(PACK, [result('A|B <i>x</i>', { stars: { u1: 3 } })], { assignment: ASSIGNMENT }), 'Course A')
    expect(md).toContain('# Class report: Course A')
    expect(md).toContain('| A\\|B \\<i\\>x\\</i\\> |')
    expect(reportToMarkdown(report)).toContain('Left out other.json')
    expect(reportToMarkdown(report)).toContain('## Not finished')
  }
  // renders CSV that a spreadsheet cannot read as a formula
  {
    for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', '\t=x']) expect(csvCell(bad).replace(/^"/, '')).toMatch(/^'/)
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    const csv = reportToCsv(classReport(PACK, [result('=cmd|calc', { stars: { u1: 3 } })], { assignment: ASSIGNMENT }))
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('student,units_mastered,units_assigned,stars,max_stars,accuracy_pct,minutes,answered,review_queue,finished,exported_at')
    expect(lines[1]?.startsWith("'=cmd|calc,")).toBe(true)
  }
  })
})

describe('progress normalisation (name, studentId, playSeconds)', () => {
  const pack = { ...PACK } as Pick<CoursePack, 'id' | 'units' | 'items' | 'objectives'>
  const parse = (patch: Record<string, unknown>) => {
    const raw = JSON.stringify({ ...newProgress('course-a'), ...patch })
    const r = parseProgress(raw, pack)
    if (!r.ok) throw new Error(r.error)
    return r.progress
  }
  it('progress normalisation: an old save, a clean name, a bad name and play time', () => {
  // an old save has no name and no play time
  {
    const p = parse({})
    expect(p.settings.name).toBeUndefined()
    expect(p.playSeconds).toBeUndefined()
  }
  // keeps a clean name (60 characters at most) and a plain student id
  {
    const p = parse({ settings: { timer: false, sound: true, name: `  ${'N'.repeat(90)}  `, studentId: 'abc123-xyz' }, playSeconds: 90.4 })
    expect(p.settings.name).toBe('N'.repeat(60))
    expect(p.settings.studentId).toBe('abc123-xyz')
    expect(p.playSeconds).toBe(90)
  }
  // drops a bad name or id and clamps the play time
  {
    const p = parse({ settings: { timer: false, sound: true, name: 42, studentId: '<x>' }, playSeconds: 1e12 })
    expect(p.settings.name).toBeUndefined()
    expect(p.settings.studentId).toBeUndefined()
    expect(p.playSeconds).toBe(360_000)
    expect(parse({ playSeconds: -5 }).playSeconds).toBe(0)
  }
  })
})
