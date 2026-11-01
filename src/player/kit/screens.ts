import { button, h, type Child } from '../dom'
import { newProgress } from '../progress'
import type { ShellSession } from './session'
import { languageName, newTitleState, shellName, startScreen, type StartHost, type TitleState } from './start'

/**
 * Screens every shell shares (EGS-10): the title (EGS-25: one component, `start.ts`; this file keeps the wrapper shells call) and the end.
 * Test ids are the quiz arena's, so the bot opens and closes every shell the same way; see docs/player.md, "Shells".
 */

export { languageName, newTitleState, shellName, type TitleState }

export interface TitleOptions {
  /** The big button; default Start / Continue. */
  startLabel?: string
  onStart(): void
  /** Extra settings (checkboxes ...). */
  settings?: Child
}

/** The start screen host of a shell kit session. */
export function startHostOf<K extends string>(session: ShellSession<K>): StartHost {
  return {
    pack: session.pack,
    get ui() {
      return session.ui
    },
    shellId: session.shellId,
    shells: session.host.shells,
    switchShell: (id) => session.host.switchShell(id),
    courseTitle: () => session.courseTitle(),
    unitTitle: (id) => session.unitTitle(id),
    get lang() {
      return session.lang
    },
    setLang: (code) => session.setLang(code),
    get progress() {
      return session.progress
    },
    set progress(p) {
      session.progress = p
    },
    save: () => session.save(),
    persistent: session.store.persistent,
    get started() {
      return session.started
    },
    refreshAudio: () => session.audio.refresh(),
    get speechService() {
      return session.speechService
    },
    reset: () => {
      session.store.clear()
      session.progress = newProgress(session.pack.id)
      session.combo = 0
      session.finished = false
    }
  }
}

/** The title screen of a shell: the shared start screen (see `start.ts` for the test ids). `redraw` draws it again. */
export function titleScreen<K extends string>(session: ShellSession<K>, opts: TitleOptions, redraw: () => void, state: TitleState): HTMLElement {
  return startScreen(startHostOf(session), opts, redraw, state)
}

export interface EndOptions {
  /** The h1 (default: "Course complete!"). */
  title?: string
  sub?: string
  /** The shell's own lines (codex size, rooms, plants ...). */
  stats?: Child
  /** `play-again`: back into the shell's world, progress kept. */
  onAgain(): void
  /** `to-title`. */
  onTitle(): void
}

/** The end screen: `end-title` (h1), `end-units` (stars per unit), `end-score`, `end-accuracy`, **`play-again`**, `to-title`. */
export function endScreen<K extends string>(session: ShellSession<K>, opts: EndOptions): HTMLElement {
  const ui = session.ui
  const p = session.progress
  const acc = p.answered > 0 ? Math.round((p.right / p.answered) * 100) : 0
  return h(
    'section',
    { class: `end-screen shell-end shell-end-${session.shellId}` },
    h('p', { class: 'eyebrow' }, session.courseTitle()),
    h('h1', { class: 'screen-title', tabindex: '-1', testid: 'end-title' }, opts.title ?? ui('end.title')),
    opts.sub ? h('p', { class: 'subject' }, opts.sub) : null,
    h(
      'ul',
      { class: 'end-stars', testid: 'end-units' },
      session.units().map((u) => h('li', {}, h('span', {}, session.t(u.title)), session.stars(session.unitStars(u.id))))
    ),
    opts.stats ?? null,
    h('p', { class: 'big-number', testid: 'end-score' }, `${ui('end.score')}: ${p.score}`),
    h('p', { testid: 'end-accuracy' }, ui('end.accuracy', { n: acc })),
    h(
      'div',
      { class: 'actions actions-center' },
      button('play-again', ui('end.again'), () => opts.onAgain(), { class: 'btn btn-primary btn-big', 'data-autofocus': '' }),
      button('to-title', ui('end.title.screen'), () => opts.onTitle(), { class: 'btn btn-big' })
    )
  )
}
