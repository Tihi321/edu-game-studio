import type { CourseItem } from '../../shared/course'
import type { CheckResult } from '../../shared/edu'
import { button, h, isTyping, pulse, type Child } from '../dom'
import { itemImage } from '../items/common'
import type { ItemView, RoundKind } from '../types'
import { NO_IMAGE_KINDS, type AnswerOutcome, type ShellSession } from './session'

/**
 * The question screen every shell shares (EGS-10), so the autoplay bot answers in every shell the same way it does in the quiz arena:
 * the same test ids (`prompt`, `item-body`, the item widgets, `hint`, `feedback`, `feedback-why`, `feedback-answer`, `next` ...), the
 * same screens (`item` while the question waits, `feedback` after the answer) and the same explanatory feedback. The shell adds its
 * frame around it (a door, a battle, a dialogue: `hud` and `lead`) and its reaction to the answer (`effect`, shown as `feedback-effect`).
 */

export interface AskOptions {
  item: CourseItem
  /** What the question is for (`getState().context`): `door`, `battle`, `hunt`, `line`, `clue` ... */
  context: string
  /** A missed item asked again in the same run (half points; it stays in the review queue until a later fresh right answer). */
  retry?: boolean
  /** The shell's frame above the question: the battle scene, the door, the speaker. Must not contain an h1. */
  hud?: Child
  /** A short line above the prompt ("The north door asks:"). */
  lead?: Child
  /** For the snapshot. */
  unitId?: string
  roundKind?: RoundKind
  roundSize?: number
  /** 0-based position of the question in the run. */
  index?: number
  /** The shell's own state for the snapshot (`getState().view`), read when the question opens and after the answer. */
  view?(): Record<string, unknown>
  /** Called right after the answer is recorded (update hit points, torches, plants ...), before the feedback is drawn. */
  onAnswered?(o: AnswerOutcome): void
  /** What the answer did in the shell's world, shown in the feedback panel (`feedback-effect`). */
  effect?(o: AnswerOutcome): { text: string; tone: 'good' | 'bad' | 'info' } | null
  /** The label of `next` (default: the player's "Next"). */
  nextLabel?: string | ((o: AnswerOutcome) => string)
  /** `next` was pressed: the shell goes on (draws its world again). */
  onNext(o: AnswerOutcome): void
  /** When set, a `leave` button lets the learner step back without answering. */
  onLeave?(): void
  leaveLabel?: string
}

export interface OpenQuestion {
  item: CourseItem
  view: ItemView
  outcome?: AnswerOutcome
  /** Removes the question's key routing and destroys the renderer (the shell calls it only when it abandons the screen itself). */
  close(): void
}

/**
 * Draws the question screen for `opts.item` and publishes `item`; on the answer, records it (`session.answer`), shows the feedback and
 * publishes `feedback`; `next` calls `opts.onNext`. Returns null (with a console warning) when no renderer exists for the item's kind;
 * the shell then picks another item.
 */
export function ask<K extends string>(session: ShellSession<K>, opts: AskOptions): OpenQuestion | null {
  const { item } = opts
  const renderer = session.host.getItemRenderer(item.kind)
  if (!renderer) {
    console.warn(`[EduEngine] no renderer for the item kind "${item.kind}"; ${session.shellId} skips ${item.id}`)
    return null
  }
  const ui = session.ui
  session.turn += 1
  let open: OpenQuestion | null = null
  const submit = (answer: unknown): CheckResult => {
    if (!open) return { correct: false, score: 0, expected: null, invalid: true }
    if (open.outcome) return open.outcome.result
    return answered(answer)
  }
  const view = renderer.render(session.itemContext(item, submit))
  const extraOf = (o?: AnswerOutcome) => ({
    context: opts.context,
    item: { id: item.id, kind: item.kind, index: opts.index ?? 0 },
    ...(opts.unitId ? { unitId: opts.unitId } : {}),
    ...(opts.roundKind ? { roundKind: opts.roundKind, roundSize: opts.roundSize ?? 0 } : {}),
    ...(opts.view ? { view: opts.view() } : {}),
    ...(o ? { lastResult: o.result } : {})
  })

  // ---- the screen ----
  const hintText = item.hint && session.text.hasText(item.hint) ? session.text.t(item.hint) : null
  let hintShown = false
  const hintBox = h('p', { class: 'hint-text', testid: 'hint-text', hidden: true }, hintText ?? '')
  const hintBtn: HTMLButtonElement | null = hintText
    ? button(
        'hint',
        `💡 ${ui('hint')}`,
        () => {
          hintShown = !hintShown
          hintBox.hidden = !hintShown
          hintBtn?.setAttribute('aria-expanded', String(hintShown))
        },
        { class: 'btn btn-small btn-ghost', 'aria-expanded': 'false' }
      )
    : null
  const leave = opts.onLeave
    ? button(
        'leave',
        `‹ ${opts.leaveLabel ?? ui('leave')}`,
        () => {
          open?.close()
          opts.onLeave?.()
        },
        { class: 'btn btn-small btn-ghost' }
      )
    : null
  const lead = h(
    'p',
    { class: 'q-meta', testid: 'question-number' },
    opts.retry ? h('span', { class: 'tag tag-retry', testid: 'retry-tag' }, ui('retry')) : null,
    opts.lead ?? null
  )
  const prompt = renderer.ownsPrompt
    ? h('h1', { class: 'sr-only' }, typeof opts.lead === 'string' ? opts.lead : ui('question.lead'))
    : h('h1', { class: 'prompt', testid: 'prompt', tabindex: '-1' }, session.text.t(item.prompt))
  const ctxForImage = session.itemContext(item, submit)
  const image = NO_IMAGE_KINDS.has(item.kind) ? null : itemImage(ctxForImage)
  const body = h('div', { class: `item-body kind-${item.kind}`, testid: 'item-body', 'data-kind': item.kind }, view.el)
  const slot = h('div', { class: 'feedback-slot', 'aria-live': 'polite' })
  const section = h(
    'section',
    { class: `question shell-question context-${opts.context}`, 'aria-label': session.text.t(item.prompt) },
    leave || opts.hud ? h('header', { class: 'shell-hud' }, leave, opts.hud ?? null) : null,
    lead,
    prompt,
    image,
    hintBtn,
    hintBox,
    body,
    slot
  )

  const close = (): void => {
    if (session.questionKeys === keys) session.questionKeys = null
    view.destroy?.()
  }

  function answered(answer: unknown): CheckResult {
    const cur = open as OpenQuestion
    const outcome = session.answer(item, answer, { retry: opts.retry === true })
    cur.outcome = outcome
    view.reveal(outcome.result, answer)
    opts.onAnswered?.(outcome)
    showFeedback(outcome)
    session.playCue(outcome.result.correct ? 'correct' : 'wrong')
    return outcome.result
  }

  function showFeedback(o: AnswerOutcome): void {
    const fb = o.feedback
    const effect = opts.effect?.(o) ?? null
    const part = (cls: string, testid: string, title: string, ...kids: Child[]): HTMLElement => h('div', { class: `fb-part ${cls}`, testid }, h('h3', {}, title), kids)
    const nextLabel = typeof opts.nextLabel === 'function' ? opts.nextLabel(o) : (opts.nextLabel ?? ui('next'))
    const panel = h(
      'div',
      { class: `feedback is-${fb.verdict}`, testid: 'feedback', 'data-result': fb.verdict, tabindex: '-1' },
      h('h2', { class: 'fb-title', testid: 'feedback-title' }, h('span', { class: 'fb-icon', 'aria-hidden': 'true' }, fb.verdict === 'correct' ? '✓' : fb.verdict === 'partial' ? '≈' : fb.verdict === 'timeout' ? '⏱' : '✗'), fb.title),
      effect ? h('p', { class: `fb-effect is-${effect.tone}`, testid: 'feedback-effect' }, effect.text) : null,
      fb.notes.length ? h('ul', { class: 'fb-notes', testid: 'feedback-notes' }, fb.notes.map((n) => h('li', {}, n))) : null,
      fb.detail ? h('p', { class: 'fb-detail', testid: 'feedback-detail' }, fb.detail) : null,
      fb.whys.length ? part('fb-why', 'feedback-why', ui('fb.why'), fb.whys.map((w) => h('p', {}, w))) : null,
      fb.answer.length ? part('fb-answer', 'feedback-answer', ui('fb.answer'), fb.answer.length === 1 ? h('p', { class: 'fb-answer-text' }, fb.answer[0] as string) : h('ul', {}, fb.answer.map((a) => h('li', {}, a)))) : null,
      fb.explanation ? part('fb-explain', 'feedback-explanation', ui('fb.explain'), h('p', {}, fb.explanation)) : null,
      fb.dyk ? part('fb-dyk', 'feedback-dyk', `💡 ${ui('fb.dyk')}`, h('p', {}, fb.dyk)) : null,
      h('div', { class: 'actions' }, button('next', nextLabel, () => goNext(), { class: 'btn btn-primary btn-big', 'data-autofocus': '' }))
    )
    slot.appendChild(panel)
    body.classList.add('is-answered')
    session.markScreen('feedback')
    session.publish('feedback', extraOf(o))
    session.live(`${fb.title}. ${effect ? `${effect.text} ` : ''}${fb.whys.join(' ')} ${fb.answer.join('. ')}`)
    pulse(body, o.result.correct ? 'fx-glow' : 'fx-shake')
    if (typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    session.host.root.querySelector<HTMLElement>('[data-testid="next"]')?.focus({ preventScroll: true })
  }

  let leaving = false
  function goNext(): void {
    const o = open?.outcome
    if (!o || leaving) return
    leaving = true
    close()
    opts.onNext(o)
  }

  // number keys go to the item (not while typing); Enter or Space on the feedback continues
  const keys = (e: KeyboardEvent): boolean => {
    const cur = open
    if (!cur) return false
    if (!cur.outcome) {
      if (isTyping(e.target) && /^[0-9]$/.test(e.key)) return true
      return view.key?.(e) ?? false
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.getAttribute('role') === 'button')) return true
      e.preventDefault()
      goNext()
      return true
    }
    return false
  }

  open = { item, view, close }
  session.render('item', section, extraOf(), { focus: false })
  session.questionKeys = keys
  view.focus()
  const main = session.host.root.querySelector<HTMLElement>('#edu-main')
  if (!main?.contains(document.activeElement)) main?.querySelector<HTMLElement>('[data-autofocus], .prompt')?.focus()
  return open
}
