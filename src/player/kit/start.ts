import '../../design/themes/menu.css'
import type { CoursePack } from '../../shared/course'
import { classroomBlock } from '../classroom'
import { button, h, type Child } from '../dom'
import type { Ui, UiKey } from '../i18n'
import { exportProgress, parseProgress, type Progress } from '../progress'
import type { SpeechService } from '../speech'
import { speakToggle } from '../speech/toggle'
import { modeIcon } from './mode-icons'

/**
 * The start screen every game mode shares (EGS-25): the title and the mode picker in one component and one look (the `menu` theme).
 * Header (course title, subject, audience), language picker, a card per playable mode, settings, **Start**, export / import / reset.
 * A mode keeps its own theme in every in-game screen: `applyScreenTheme` puts `menu` on the root while the title shows.
 * Test ids are frozen (the bot and the tests drive them): the mode card IS `shell-<id>`.
 */

/** The theme of the start screen. */
export const MENU_THEME = 'menu'

/** `data-edu-theme` of the root for a screen: `menu` on the title, the mode's own theme everywhere else. */
export function applyScreenTheme(root: HTMLElement, screen: string, shellTheme: string): void {
  const theme = screen === 'title' ? MENU_THEME : shellTheme
  if (root.getAttribute('data-edu-theme') !== theme) root.setAttribute('data-edu-theme', theme)
}

export const languageName = (code: string): string => {
  try {
    const n = new Intl.DisplayNames([code], { type: 'language' }).of(code)
    return n ? n.charAt(0).toLocaleUpperCase(code) + n.slice(1) : code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

const word = (ui: Ui, key: string): string | undefined => {
  const s = (ui as (k: UiKey) => string | undefined)(key as UiKey)
  return s && s !== key ? s : undefined
}

/** The name of a mode in the edition (`mode.<id>.name` of the player's words, else the id). */
export const shellName = (ui: Ui, id: string): string => word(ui, `mode.${id}.name`) ?? id

/** What the start screen needs from the game that shows it. The shell kit session and the quiz arena both provide it. */
export interface StartHost {
  pack: CoursePack
  ui: Ui
  shellId: string
  /** The modes this game can be played in. */
  shells: readonly string[]
  switchShell(id: string): void
  courseTitle(): string
  unitTitle(unitId: string): string
  /** The edition being played. */
  lang: string
  /** Switches the edition and saves it; the start screen draws itself again. */
  setLang(code: string): void
  progress: Progress
  save(): void
  /** False when the browser keeps no progress. */
  persistent: boolean
  /** True when the learner has played before (the button says Continue). */
  started: boolean
  refreshAudio(): void
  speechService: SpeechService | undefined
  /** Clears the saved progress and the run in memory. */
  reset(): void
}

export interface StartOptions {
  /** The big button; default Start / Continue. */
  startLabel?: string
  onStart(): void
  /** Extra settings (checkboxes ...), above the shared ones. */
  settings?: Child
}

/** What the start screen keeps between redraws (a pending reset confirmation, the last message). Keep one per game. */
export interface TitleState {
  confirmReset: boolean
  message: { text: string; kind: 'ok' | 'bad' } | null
}
export const newTitleState = (): TitleState => ({ confirmReset: false, message: null })

function modePicker(host: StartHost): HTMLElement | null {
  if (host.shells.length < 2) return null
  const ui = host.ui
  return h(
    'div',
    { class: 'mode-picker', role: 'group', 'aria-label': ui('start.choose'), testid: 'shell-picker' },
    h('p', { class: 'mode-picker-label', 'aria-hidden': 'true' }, ui('start.choose')),
    h(
      'div',
      { class: 'mode-grid' },
      host.shells.map((id) =>
        button(
          `shell-${id}`,
          [
            h('span', { class: 'mode-pictogram' }, modeIcon(id)),
            h('span', { class: 'mode-text' }, h('b', { class: 'mode-name' }, shellName(ui, id)), h('small', { class: 'mode-blurb' }, word(ui, `mode.${id}.blurb`) ?? '')),
            h('span', { class: 'mode-dot', 'aria-hidden': 'true' })
          ],
          () => {
            if (id !== host.shellId) host.switchShell(id)
          },
          { class: 'mode-card', 'data-mode': id, 'aria-pressed': String(id === host.shellId) }
        )
      )
    )
  )
}

function toggle(testid: string, label: string, hint: string | null, on: boolean, set: (on: boolean) => void): HTMLElement {
  return h(
    'label',
    { class: 'toggle' },
    h('input', { type: 'checkbox', testid, ...(on ? { checked: true } : {}), onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }),
    h('span', { class: 'toggle-text' }, h('b', {}, label), hint ? h('small', {}, hint) : null)
  )
}

/**
 * The start screen: `course-title` (h1), `course-subject`, `lang-picker` / `lang-<code>`, `shell-picker` / `shell-<id>`, `setting-sound`,
 * `setting-reduce-audio`, `setting-speak`, **`start`**, `export`, `import` + `import-file`, `reset` then `reset-confirm` / `reset-cancel`,
 * `title-message`, `storage-warning`. `redraw` draws it again (after a language switch, an import, a reset).
 */
export function startScreen(host: StartHost, opts: StartOptions, redraw: () => void, state: TitleState): HTMLElement {
  const ui = host.ui
  const pack = host.pack
  const title = host.courseTitle()
  const say = (text: string, kind: 'ok' | 'bad'): void => {
    state.message = { text, kind }
    redraw()
  }
  const setSettings = (patch: Partial<Progress['settings']>): void => {
    host.progress = { ...host.progress, settings: { ...host.progress.settings, ...patch } }
    host.save()
  }
  const langs =
    pack.languages.length > 1
      ? h(
          'div',
          { class: 'lang-picker', role: 'group', 'aria-label': ui('language'), testid: 'lang-picker' },
          pack.languages.map((code) =>
            button(`lang-${code}`, languageName(code), () => {
              host.setLang(code)
              redraw()
            }, { class: 'chip', 'aria-pressed': String(code === host.lang), lang: code })
          )
        )
      : null
  const sound = pack.cues.length
    ? toggle('setting-sound', ui('sound'), null, !!host.progress.settings.sound, (on) => {
        setSettings({ sound: on })
        host.refreshAudio()
      })
    : null
  const reduceAudio = pack.cues.length
    ? toggle('setting-reduce-audio', ui('reduceAudio'), ui('reduceAudio.hint'), !!host.progress.settings.reduceAudio, (on) => {
        setSettings({ reduceAudio: on })
        host.refreshAudio()
      })
    : null
  const speak = speakToggle(ui, host.speechService, host.progress.settings.speak !== false, (on) => setSettings({ speak: on }))
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
          host.progress = res.progress
          host.save()
          const lang = res.progress.settings.lang
          if (lang && pack.languages.includes(lang) && lang !== host.lang) host.setLang(lang)
          say(ui('import.ok'), 'ok')
        },
        () => say(ui('import.bad', { why: 'unreadable' }), 'bad')
      )
    }
  })
  const doExport = (): void => {
    try {
      const blob = new Blob([exportProgress(host.progress)], { type: 'application/json' })
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
          host.reset()
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
  const settings = opts.settings || sound || reduceAudio || speak ? h('div', { class: 'settings' }, opts.settings ?? null, sound, reduceAudio, speak) : null
  const blurb = word(ui, `mode.${host.shellId}.blurb`)
  return h(
    'section',
    { class: `title-screen start-screen shell-title shell-title-${host.shellId}` },
    h(
      'header',
      { class: 'start-head' },
      blurb ? h('p', { class: 'eyebrow', testid: 'mode-blurb' }, blurb) : null,
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'course-title' }, title),
      title.toLocaleLowerCase() === pack.subject.toLocaleLowerCase() ? null : h('p', { class: 'subject', testid: 'course-subject' }, subject),
      h('p', { class: 'audience' }, pack.audience)
    ),
    classroomBlock({
      pack,
      ui,
      unitTitle: (id) => host.unitTitle(id),
      getProgress: () => host.progress,
      setProgress: (p) => {
        host.progress = p
      },
      save: () => host.save(),
      say
    }),
    langs,
    modePicker(host),
    settings,
    h('div', { class: 'actions actions-center' }, button('start', opts.startLabel ?? (host.started ? ui('continue') : ui('start')), () => opts.onStart(), { class: 'btn btn-primary btn-big', ...(state.confirmReset ? {} : { 'data-autofocus': '' }) })),
    h(
      'div',
      { class: 'progress-tools', role: 'group', 'aria-label': ui('export') + ' / ' + ui('import') },
      button('export', ui('export'), doExport, { class: 'btn btn-small btn-ghost' }),
      button('import', ui('import'), () => fileInput.click(), { class: 'btn btn-small btn-ghost' }),
      fileInput,
      reset
    ),
    message ? h('p', { class: `message message-${message.kind}`, role: 'status', testid: 'title-message' }, message.text) : null,
    !host.persistent ? h('p', { class: 'message message-bad', testid: 'storage-warning' }, ui('storage.off')) : null
  )
}
