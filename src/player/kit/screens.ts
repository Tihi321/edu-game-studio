import { button, h, type Child } from '../dom'
import type { Ui, UiKey } from '../i18n'
import { exportProgress, newProgress, parseProgress } from '../progress'
import type { ShellHost } from '../types'
import type { ShellSession } from './session'

/**
 * Screens every shell shares (EGS-10): the title (language, game style, start, export / import / reset of the progress) and the end.
 * Test ids are the quiz arena's, so the bot opens and closes every shell the same way; see docs/player.md, "Shells".
 */

export const languageName = (code: string): string => {
  try {
    const n = new Intl.DisplayNames([code], { type: 'language' }).of(code)
    return n ? n.charAt(0).toLocaleUpperCase(code) + n.slice(1) : code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

/** The name of a shell in the edition (`shell.<id>` of the player's words, else the id). */
export const shellName = (ui: Ui, id: string): string => {
  const key = `shell.${id}` as UiKey
  const s = ui(key)
  return s === key ? id : s
}

/**
 * The game-style picker (`shell-picker`, one `shell-<id>` per playable shell, `aria-pressed` on the current one). Null when the course
 * is played in one shell only. Picking another style unmounts this shell and mounts that one; the progress is kept.
 */
export function shellPicker(host: Pick<ShellHost, 'shells' | 'switchShell'>, ui: Ui, current: string): HTMLElement | null {
  if (host.shells.length < 2) return null
  return h(
    'div',
    { class: 'shell-picker', role: 'group', 'aria-label': ui('shell.choose'), testid: 'shell-picker' },
    h('span', { class: 'shell-picker-label', 'aria-hidden': 'true' }, ui('shell.choose')),
    host.shells.map((id) =>
      button(`shell-${id}`, shellName(ui, id), () => {
        if (id !== current) host.switchShell(id)
      }, { class: 'chip', 'aria-pressed': String(id === current) })
    )
  )
}

export interface TitleOptions {
  /** One line above the title ("An encyclopedia to explore"). */
  tagline: string
  /** The big button; default Start / Continue. */
  startLabel?: string
  onStart(): void
  /** The shell's own art or intro under the title (no h1). */
  art?: Child
  /** Extra settings (checkboxes ...). */
  settings?: Child
}

/**
 * The title screen: `course-title` (h1), `course-subject`, `lang-picker` / `lang-<code>`, `shell-picker` / `shell-<id>`, `setting-sound`
 * (when the course has cues), **`start`**, `export`, `import` + `import-file`, `reset` then `reset-confirm` / `reset-cancel`,
 * `title-message`, `storage-warning`. `redraw` draws the title again (after a language switch, an import, a reset).
 */
export function titleScreen<K extends string>(session: ShellSession<K>, opts: TitleOptions, redraw: () => void, state: TitleState): HTMLElement {
  const ui = session.ui
  const pack = session.pack
  const title = session.courseTitle()
  const picker =
    pack.languages.length > 1
      ? h(
          'div',
          { class: 'lang-picker', role: 'group', 'aria-label': ui('language'), testid: 'lang-picker' },
          pack.languages.map((code) =>
            button(`lang-${code}`, languageName(code), () => {
              session.setLang(code)
              redraw()
            }, { class: 'chip', 'aria-pressed': String(code === session.lang), lang: code })
          )
        )
      : null
  const sound = pack.cues.length
    ? h(
        'label',
        { class: 'toggle' },
        h('input', {
          type: 'checkbox',
          testid: 'setting-sound',
          ...(session.progress.settings.sound ? { checked: true } : {}),
          onchange: (e: Event) => {
            session.progress = { ...session.progress, settings: { ...session.progress.settings, sound: (e.target as HTMLInputElement).checked } }
            session.save()
            session.audio.refresh()
          }
        }),
        h('span', { class: 'toggle-text' }, h('b', {}, ui('sound')))
      )
    : null
  const reduceAudio = pack.cues.length
    ? h(
        'label',
        { class: 'toggle' },
        h('input', {
          type: 'checkbox',
          testid: 'setting-reduce-audio',
          ...(session.progress.settings.reduceAudio ? { checked: true } : {}),
          onchange: (e: Event) => {
            session.progress = { ...session.progress, settings: { ...session.progress.settings, reduceAudio: (e.target as HTMLInputElement).checked } }
            session.save()
            session.audio.refresh()
          }
        }),
        h('span', { class: 'toggle-text' }, h('b', {}, ui('reduceAudio')), h('small', {}, ui('reduceAudio.hint')))
      )
    : null
  const say = (text: string, kind: 'ok' | 'bad'): void => {
    state.message = { text, kind }
    redraw()
  }
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'sr-only',
    testid: 'import-file',
    tabindex: '-1',
    'aria-label': ui('import'),
    onchange: (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      void file.text().then(
        (text) => {
          const res = parseProgress(text, pack)
          if (!res.ok) return say(ui('import.bad', { why: res.error }), 'bad')
          session.progress = res.progress
          session.save()
          const lang = res.progress.settings.lang
          if (lang && pack.languages.includes(lang) && lang !== session.lang) session.setLang(lang)
          say(ui('import.ok'), 'ok')
        },
        () => say(ui('import.bad', { why: 'unreadable' }), 'bad')
      )
    }
  })
  const doExport = (): void => {
    try {
      const blob = new Blob([exportProgress(session.progress)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = h('a', { href: url, download: `${pack.slug}-progress.json`, class: 'sr-only' })
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 2000)
      say(ui('export.done'), 'ok')
    } catch (e) {
      say(String(e instanceof Error ? e.message : e), 'bad')
    }
  }
  const reset = state.confirmReset
    ? h(
        'span',
        { class: 'confirm', role: 'group', 'aria-label': ui('reset.confirm') },
        h('span', {}, ui('reset.confirm')),
        button('reset-confirm', ui('reset.yes'), () => {
          session.store.clear()
          session.progress = newProgress(pack.id)
          session.combo = 0
          session.finished = false
          state.confirmReset = false
          say(ui('reset.done'), 'ok')
        }, { class: 'btn btn-danger btn-small' }),
        button('reset-cancel', ui('reset.no'), () => {
          state.confirmReset = false
          redraw()
        }, { class: 'btn btn-small', 'data-autofocus': '' })
      )
    : button('reset', ui('reset'), () => {
        state.confirmReset = true
        redraw()
      }, { class: 'btn btn-small btn-ghost' })
  const subject = pack.subject.charAt(0).toLocaleUpperCase() + pack.subject.slice(1)
  const message = state.message
  state.message = null
  return h(
    'section',
    { class: `title-screen shell-title shell-title-${session.shellId}` },
    h('p', { class: 'eyebrow' }, opts.tagline),
    h('h1', { class: 'screen-title', tabindex: '-1', testid: 'course-title' }, title),
    title.toLocaleLowerCase() === pack.subject.toLocaleLowerCase() ? null : h('p', { class: 'subject', testid: 'course-subject' }, subject),
    h('p', { class: 'audience' }, pack.audience),
    opts.art ?? null,
    picker,
    shellPicker(session.host, ui, session.shellId),
    opts.settings || sound ? h('div', { class: 'settings' }, opts.settings ?? null, sound, reduceAudio) : null,
    h('div', { class: 'actions actions-center' }, button('start', opts.startLabel ?? (session.started ? ui('continue') : ui('start')), () => opts.onStart(), { class: 'btn btn-primary btn-big', ...(state.confirmReset ? {} : { 'data-autofocus': '' }) })),
    h(
      'div',
      { class: 'progress-tools', role: 'group', 'aria-label': ui('export') + ' / ' + ui('import') },
      button('export', ui('export'), doExport, { class: 'btn btn-small btn-ghost' }),
      button('import', ui('import'), () => fileInput.click(), { class: 'btn btn-small btn-ghost' }),
      fileInput,
      reset
    ),
    message ? h('p', { class: `message message-${message.kind}`, role: 'status', testid: 'title-message' }, message.text) : null,
    !session.store.persistent ? h('p', { class: 'message message-bad', testid: 'storage-warning' }, ui('storage.off')) : null
  )
}

/** What the title screen keeps between redraws (a pending reset confirmation, the last message). Keep one per shell instance. */
export interface TitleState {
  confirmReset: boolean
  message: { text: string; kind: 'ok' | 'bad' } | null
}
export const newTitleState = (): TitleState => ({ confirmReset: false, message: null })

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
