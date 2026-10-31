import { assignedUnits, assignmentOf, buildStudentResult, cleanName, MAX_NAME, type Assignment } from '../shared/classroom'
import type { CoursePack } from '../shared/course'
import { button, h, type Child } from './dom'
import type { Ui } from './i18n'
import { MAX_PLAY_SECONDS, type Progress } from './progress'

/**
 * Classroom mode in the player (EGS-20), shared by the quiz arena title and the shell kit title: the assignment banner (when the pack has
 * one), the "Your name" field (`settings.name`), the "Send to my teacher" button (downloads `<course>-<name>-result.json`: a summary, not the
 * progress) and the play-time counter. All of it is plain DOM; the teacher's message goes in with textContent.
 */

export interface ClassroomHost {
  pack: Pick<CoursePack, 'id' | 'slug' | 'units' | 'items' | 'extensions'>
  ui: Ui
  /** The title of a unit in the player's language. */
  unitTitle(unitId: string): string
  getProgress(): Progress
  setProgress(p: Progress): void
  save(): void
  /** Shows a message on the title. */
  say(text: string, kind: 'ok' | 'bad'): void
}

export const assignmentOfPack = (pack: Pick<CoursePack, 'extensions'>): Assignment | null => assignmentOf(pack.extensions)

/** True when `unitId` is one of the units the assignment covers. */
export const isAssignedUnit = (pack: Pick<CoursePack, 'units' | 'extensions'>, unitId: string): boolean => {
  const a = assignmentOfPack(pack)
  return !!a && assignedUnits(pack, a).includes(unitId)
}

function randomId(): string {
  const bytes = new Uint8Array(12)
  try {
    crypto.getRandomValues(bytes)
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** A file name part: letters and digits of any alphabet, the rest becomes a dash. */
const fileSafe = (s: string): string => s.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'student'

/** The due date as the learner sees it (the date part, in the browser's locale). */
function dueText(due: string): string {
  const d = new Date(due)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : due.slice(0, 10)
}

export function sendToTeacher(host: ClassroomHost): void {
  const a = assignmentOfPack(host.pack)
  let p = host.getProgress()
  const name = cleanName(p.settings.name)
  if (!name) return host.say(host.ui('class.needName'), 'bad')
  const id = p.settings.studentId ?? randomId()
  if (id !== p.settings.studentId) {
    p = { ...p, settings: { ...p.settings, studentId: id } }
    host.setProgress(p)
    host.save()
  }
  try {
    const result = buildStudentResult(host.pack, p, { name, id, ...(a ? { assignmentId: a.id } : {}) })
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = h('a', { href: url, download: `${host.pack.slug}-${fileSafe(name)}-result.json`, class: 'sr-only' })
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
    host.say(host.ui('class.sent'), 'ok')
  } catch (e) {
    host.say(String(e instanceof Error ? e.message : e), 'bad')
  }
}

/**
 * The classroom part of a title screen: `assignment-banner` (title, `assignment-target`, `assignment-due`, `assignment-message`), the
 * `student-name` input and the `send-teacher` button. Null when the course has no assignment.
 */
export function classroomBlock(host: ClassroomHost): Child {
  const a = assignmentOfPack(host.pack)
  if (!a) return null
  const ui = host.ui
  const units = assignedUnits(host.pack, a)
  const all = units.length === host.pack.units.length
  const target = ui('class.target', { n: a.targetStars, units: all ? ui('class.allUnits') : units.map((u) => host.unitTitle(u)).join(', ') })
  const input = h('input', {
    type: 'text',
    class: 'student-name-input',
    testid: 'student-name',
    maxlength: String(MAX_NAME),
    autocomplete: 'off',
    value: host.getProgress().settings.name ?? '',
    onchange: (e: Event) => {
      const name = cleanName((e.target as HTMLInputElement).value)
      const cur = host.getProgress()
      host.setProgress({ ...cur, settings: { ...cur.settings, ...(name ? { name } : { name: undefined }) } })
      host.save()
    },
    oninput: (e: Event) => {
      // keep the name as typed in the store, so a click on Send right after typing sees it
      const name = cleanName((e.target as HTMLInputElement).value)
      const cur = host.getProgress()
      host.setProgress({ ...cur, settings: { ...cur.settings, ...(name ? { name } : { name: undefined }) } })
    }
  })
  const msg = h('p', { class: 'assignment-message', testid: 'assignment-message' })
  if (a.message) msg.textContent = a.message
  const title = h('h2', { class: 'assignment-title' })
  title.textContent = a.title
  return h(
    'section',
    { class: 'assignment-banner', testid: 'assignment-banner', 'aria-label': ui('class.assignment') },
    h('p', { class: 'eyebrow' }, ui('class.assignment')),
    title,
    h('p', { class: 'assignment-target', testid: 'assignment-target' }, target),
    a.due ? h('p', { class: 'assignment-due', testid: 'assignment-due' }, ui('class.due', { date: dueText(a.due) })) : null,
    a.message ? msg : null,
    h(
      'div',
      { class: 'student-box' },
      h('label', { class: 'student-label' }, h('span', {}, ui('class.yourName')), input),
      button('send-teacher', ui('class.send'), () => sendToTeacher(host), { class: 'btn btn-small' })
    )
  )
}

/**
 * Counts seconds of play with activity: a key, a pointer or a touch in the last 20 seconds while the page is visible. The count goes into
 * `progress.playSeconds` (capped) every 5 seconds and when the shell closes. One per shell instance; `dispose` stops it.
 */
export class PlayTimer {
  private last = 0
  private pending = 0
  private timer: number | undefined
  private readonly touch = (): void => {
    this.last = Date.now()
  }

  constructor(
    private readonly get: () => Progress,
    private readonly set: (p: Progress) => void,
    private readonly save: () => void
  ) {}

  start(): void {
    if (this.timer !== undefined) return
    for (const ev of ['keydown', 'pointerdown', 'touchstart'] as const) document.addEventListener(ev, this.touch, true)
    this.touch()
    this.timer = window.setInterval(() => this.tick(), 1000)
  }

  private tick(): void {
    if (document.visibilityState === 'hidden' || Date.now() - this.last > 20_000) return
    this.pending++
    if (this.pending >= 5) this.flush()
  }

  flush(): void {
    if (this.pending <= 0) return
    const p = this.get()
    const next = Math.min(MAX_PLAY_SECONDS, (p.playSeconds ?? 0) + this.pending)
    this.pending = 0
    if (next === p.playSeconds) return
    this.set({ ...p, playSeconds: next })
    this.save()
  }

  dispose(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer)
    this.timer = undefined
    for (const ev of ['keydown', 'pointerdown', 'touchstart'] as const) document.removeEventListener(ev, this.touch, true)
    this.flush()
  }
}
