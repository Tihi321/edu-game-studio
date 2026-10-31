import type { CourseItem, CoursePack, CourseUnit } from '../../shared/course'
import { unitOrder } from '../../shared/course'
import { checkItem, makeTextResolver, rngFor, schedule, SeededRandom, type CheckContext, type CheckResult, type TextResolver } from '../../shared/edu'
import type { GameData } from '../../shared/game-data'
import { unitArea } from '../../shared/music'
import { GameAudio, loopsOf } from '../audio'
import { button, clear, h, isTyping, pulse, type Child } from '../dom'
import { buildFeedback, answerLines, type Feedback } from '../feedback'
import { makeUi, SPECIAL_LETTERS, type Ui, type UiKey } from '../i18n'
import { itemImage } from '../items/common'
import { createSpeechService, type SpeechService } from '../speech'
import { speakToggle } from '../speech/toggle'
import { shellPicker } from '../kit/screens'
import {
  allMastered,
  browserStorage,
  cardOf,
  dequeue,
  enqueueMiss,
  exportProgress,
  hasProgress,
  isMastered,
  isUnlocked,
  masteryMap,
  newProgress,
  newlyUnlocked,
  parseProgress,
  ProgressStore,
  recordRound,
  starsFor,
  totalStars,
  type Progress
} from '../progress'
import { gradeOf, itemsOfUnit, missedIds, pickNext, quizConfig, recordResult, roundAccuracy, startRound, timerApplies, type NextQuestion, type RoundState } from '../round'
import { buildSnapshot } from '../state'
import type { ItemContext, ItemRenderer, ItemView, ScreenName, Shell, ShellHost } from '../types'

/**
 * The chalkboard quiz arena: title -> unit map -> rounds of mixed questions -> feedback -> summary -> (boss) -> review -> end.
 * One controller that renders each screen into the root and publishes a snapshot (`getState()`) after every change. The learning logic
 * (round building, adaptive difficulty, spaced repetition, mastery) is in `round.ts` and `progress.ts`; the answer checking is the shared
 * `checkItem`; the question widgets are the item renderers registered on the engine. Test ids and screens: `docs/player.md`.
 */

const SHELL_ID = 'quiz-arena'
/** The look of this shell: a theme id of src/design/themes. */
const THEME_ID = 'chalkboard'
const NO_IMAGE_KINDS = new Set(['hotspot', 'listening', 'flashcard'])

const pickLang = (data: GameData, saved: string | undefined): string => {
  const langs = data.pack.languages
  if (saved && langs.includes(saved)) return saved
  const nav = (typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []).map((l) => l.toLowerCase())
  for (const n of nav) {
    const hit = langs.find((l) => l === n || l === n.split('-')[0])
    if (hit) return hit
  }
  return langs.includes(data.defaultLang) ? data.defaultLang : (langs[0] as string)
}

const languageName = (code: string): string => {
  try {
    const n = new Intl.DisplayNames([code], { type: 'language' }).of(code)
    return n ? n.charAt(0).toLocaleUpperCase(code) + n.slice(1) : code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

interface Current {
  pick: NextQuestion
  item: CourseItem
  view: ItemView
  renderer: ItemRenderer
  answered: boolean
  answer?: unknown
  result?: CheckResult
  feedback?: Feedback
  deadline?: number
  timerId?: number
}

class QuizArena {
  private readonly pack: CoursePack
  private readonly data: GameData
  private readonly store: ProgressStore
  private progress: Progress
  private lang: string
  private ui: Ui
  private text: TextResolver
  private check: CheckContext
  private screen: ScreenName = 'title'
  private round: RoundState | null = null
  private roundNumber = 0
  private roundScore = 0
  private roundBestCombo = 0
  private roundStars = 0
  private roundUnlocked: string[] = []
  private current: Current | null = null
  private combo = 0
  private steps = 0
  private finished = false
  private turn = 0
  private difficulty = 3
  private lastResult: CheckResult | undefined
  private message: { text: string; kind: 'ok' | 'bad' } | null = null
  private confirmReset = false
  private hud: { score?: HTMLElement; combo?: HTMLElement; progress?: HTMLElement; timer?: HTMLElement } = {}
  private readonly rng: SeededRandom
  /** The music of the area and the sound effects of the events (EGS-16). */
  private readonly audio: GameAudio
  private readonly onKey = (e: KeyboardEvent): void => this.handleKey(e)

  constructor(private readonly host: ShellHost) {
    this.data = host.data
    this.pack = host.data.pack
    this.store = new ProgressStore(this.pack, browserStorage())
    this.progress = this.store.load()
    this.lang = pickLang(this.data, this.progress.settings.lang)
    this.ui = makeUi(this.lang)
    this.text = makeTextResolver(this.data.catalogs, this.lang, this.pack.targetLang)
    this.check = { text: this.text, diacritics: this.pack.matching.diacritics, typos: this.pack.matching.typos }
    this.rng = rngFor(host.seed, 'arena')
    this.audio = new GameAudio({ cues: this.pack.cues, assets: this.data.assets, loops: loopsOf(this.pack.extensions), settings: () => this.progress.settings })
    this.setLang(this.lang, false)
  }

  private speechMade: SpeechService | undefined | null = null
  /** The course's speech service (EGS-18), made once; undefined when the course or the browser has none. */
  private get speechService(): SpeechService | undefined {
    if (this.speechMade === null) this.speechMade = createSpeechService(window, this.pack.extensions, this.pack.targetLang)
    return this.speechMade
  }

  mount(): void {
    // the player root is the stage the design system styles: item and screen CSS are scoped under .edu-stage, the theme by attribute
    this.host.root.classList.add('edu-stage')
    this.host.root.setAttribute('data-edu-theme', THEME_ID)
    document.addEventListener('keydown', this.onKey)
    this.go('title')
  }

  unmount(): void {
    document.removeEventListener('keydown', this.onKey)
    this.audio.dispose()
    this.stopTimer()
    this.current?.view.destroy?.()
  }

  // ---- language, state ----

  private setLang(lang: string, render = true): void {
    this.lang = lang
    this.text = makeTextResolver(this.data.catalogs, lang, this.pack.targetLang)
    this.ui = makeUi(lang, this.data.catalogs[lang])
    this.check = { text: this.text, diacritics: this.pack.matching.diacritics, typos: this.pack.matching.typos }
    document.documentElement.lang = lang
    document.title = this.courseTitle()
    if (render) {
      this.progress = { ...this.progress, settings: { ...this.progress.settings, lang } }
      this.save()
      this.go(this.screen)
    }
  }

  /** The pack has no title field: the catalog key `course.title` names the course when a course sets it, else the subject is the title. */
  private courseTitle(): string {
    const t = this.text.text('course.title')
    if (t) return t
    return this.pack.subject.charAt(0).toLocaleUpperCase() + this.pack.subject.slice(1)
  }

  private publish(): void {
    const r = this.round
    const cur = this.current
    this.host.publish(
      buildSnapshot({
        screen: this.screen,
        shell: SHELL_ID,
        lang: this.lang,
        seed: this.host.seed,
        ...(r ? { roundNumber: this.roundNumber, roundKind: r.kind, roundSize: r.size, ...(r.unitId ? { unitId: r.unitId } : {}) } : {}),
        ...(cur ? { itemId: cur.item.id, itemKind: cur.item.kind, itemIndex: r ? r.results.length - (cur.answered ? 1 : 0) : 0 } : {}),
        combo: this.combo,
        score: this.progress.score,
        ...(this.lastResult ? { lastResult: this.lastResult } : {}),
        reviewQueue: this.progress.queue,
        mastery: masteryMap(this.pack, this.progress),
        finished: this.finished,
        steps: this.steps
      })
    )
  }

  private save(): void {
    this.store.save(this.progress)
  }

  // ---- navigation ----

  private go(screen: ScreenName): void {
    this.stopTimer()
    if (screen !== 'item' && screen !== 'feedback') {
      this.current?.view.destroy?.()
      this.current = null
    }
    this.screen = screen
    const area = this.musicArea(screen)
    if (area !== undefined) this.audio.setArea(area)
    this.hud = {}
    const root = this.host.root
    clear(root)
    const body = this.build(screen)
    const app = h(
      'div',
      { class: 'edu-app', testid: 'app', 'data-screen': screen, 'data-shell': SHELL_ID },
      h('div', { class: 'frame' }, h('main', { class: `board board-${screen}`, id: 'edu-main' }, body)),
      h('div', { class: 'burst-layer', 'aria-hidden': 'true' }),
      h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', testid: 'live' })
    )
    root.appendChild(app)
    this.publish()
    this.focusScreen()
  }

  /** The music area of a screen: the menu music on the title, the map and the review, the unit's or the boss's during a round, the end music at the end; the summary keeps what plays. */
  private musicArea(screen: ScreenName): string | null | undefined {
    switch (screen) {
      case 'title':
      case 'map':
      case 'review':
        return 'menu'
      case 'item':
      case 'feedback': {
        const r = this.round
        if (!r || r.kind === 'review') return 'menu'
        return r.kind === 'boss' ? 'boss' : unitArea(r.unitId ?? '')
      }
      case 'end':
        return 'end'
      default:
        return undefined
    }
  }

  private focusScreen(): void {
    const main = this.host.root.querySelector<HTMLElement>('#edu-main')
    if (this.screen === 'item') {
      this.current?.view.focus()
      if (!main?.contains(document.activeElement)) main?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
      return
    }
    if (this.screen === 'feedback') return
    const target = main?.querySelector<HTMLElement>('[data-autofocus]') ?? main?.querySelector<HTMLElement>('h1, h2')
    target?.focus({ preventScroll: false })
    window.scrollTo(0, 0)
  }

  private build(screen: ScreenName): Child {
    switch (screen) {
      case 'title':
        return this.buildTitle()
      case 'map':
        return this.buildMap()
      case 'item':
      case 'feedback':
        return this.buildItem()
      case 'summary':
        return this.buildSummary()
      case 'review':
        return this.buildReview()
      case 'end':
        return this.buildEnd()
      default:
        return h('p', {}, this.ui('loading'))
    }
  }

  private heading(tag: 'h1' | 'h2', text: string, testid: string): HTMLElement {
    return h(tag, { class: 'screen-title', tabindex: '-1', testid, 'data-autofocus': '' }, text)
  }

  // ---- title ----

  private buildTitle(): Child {
    const ui = this.ui
    const langs = this.pack.languages
    const started = hasProgress(this.progress)
    const picker =
      langs.length > 1
        ? h(
            'div',
            { class: 'lang-picker', role: 'group', 'aria-label': ui('language'), testid: 'lang-picker' },
            langs.map((code) =>
              button(`lang-${code}`, languageName(code), () => this.setLang(code), { class: 'chip', 'aria-pressed': String(code === this.lang), lang: code })
            )
          )
        : null
    const timer = h(
      'label',
      { class: 'toggle' },
      h('input', {
        type: 'checkbox',
        testid: 'setting-timer',
        ...(this.progress.settings.timer ? { checked: true } : {}),
        onchange: (e: Event) => {
          this.progress = { ...this.progress, settings: { ...this.progress.settings, timer: (e.target as HTMLInputElement).checked } }
          this.save()
        }
      }),
      h('span', { class: 'toggle-text' }, h('b', {}, ui('timer')), h('small', {}, ui('timer.hint', { s: quizConfig(this.pack).timerSeconds })))
    )
    const sound = this.pack.cues.length
      ? h(
          'label',
          { class: 'toggle' },
          h('input', {
            type: 'checkbox',
            testid: 'setting-sound',
            ...(this.progress.settings.sound ? { checked: true } : {}),
            onchange: (e: Event) => {
              this.progress = { ...this.progress, settings: { ...this.progress.settings, sound: (e.target as HTMLInputElement).checked } }
              this.save()
              this.audio.refresh()
            }
          }),
          h('span', { class: 'toggle-text' }, h('b', {}, ui('sound')))
        )
      : null
    const reduceAudio = this.pack.cues.length
      ? h(
          'label',
          { class: 'toggle' },
          h('input', {
            type: 'checkbox',
            testid: 'setting-reduce-audio',
            ...(this.progress.settings.reduceAudio ? { checked: true } : {}),
            onchange: (e: Event) => {
              this.progress = { ...this.progress, settings: { ...this.progress.settings, reduceAudio: (e.target as HTMLInputElement).checked } }
              this.save()
              this.audio.refresh()
            }
          }),
          h('span', { class: 'toggle-text' }, h('b', {}, ui('reduceAudio')), h('small', {}, ui('reduceAudio.hint')))
        )
      : null
    const speak = speakToggle(ui, this.speechService, this.progress.settings.speak !== false, (on) => {
      this.progress = { ...this.progress, settings: { ...this.progress.settings, speak: on } }
      this.save()
    })
    const fileInput = h('input', {
      type: 'file',
      accept: 'application/json,.json',
      class: 'sr-only',
      testid: 'import-file',
      tabindex: '-1',
      'aria-label': ui('import'),
      onchange: (e: Event) => void this.importFile((e.target as HTMLInputElement).files?.[0])
    })
    const reset = this.confirmReset
      ? h(
          'span',
          { class: 'confirm', role: 'group', 'aria-label': ui('reset.confirm') },
          h('span', {}, ui('reset.confirm')),
          button('reset-confirm', ui('reset.yes'), () => this.doReset(), { class: 'btn btn-danger btn-small' }),
          button('reset-cancel', ui('reset.no'), () => {
            this.confirmReset = false
            this.go('title')
          }, { class: 'btn btn-small', 'data-autofocus': '' })
        )
      : button('reset', ui('reset'), () => {
          this.confirmReset = true
          this.go('title')
        }, { class: 'btn btn-small btn-ghost' })
    return h(
      'section',
      { class: 'title-screen' },
      h('p', { class: 'eyebrow' }, ui('title.tagline')),
      this.heading('h1', this.courseTitle(), 'course-title'),
      this.courseTitle().toLocaleLowerCase() === this.pack.subject.toLocaleLowerCase() ? null : h('p', { class: 'subject', testid: 'course-subject' }, this.pack.subject.charAt(0).toLocaleUpperCase() + this.pack.subject.slice(1)),
      h('p', { class: 'audience' }, this.pack.audience),
      picker,
      shellPicker(this.host, ui, SHELL_ID),
      h('div', { class: 'settings' }, timer, sound, reduceAudio, speak),
      h('div', { class: 'actions actions-center' }, button('start', started ? ui('continue') : ui('start'), () => this.go('map'), { class: 'btn btn-primary btn-big', ...(this.confirmReset ? {} : { 'data-autofocus': '' }) })),
      h(
        'div',
        { class: 'progress-tools', role: 'group', 'aria-label': ui('export') + ' / ' + ui('import') },
        button('export', ui('export'), () => this.doExport(), { class: 'btn btn-small btn-ghost' }),
        button('import', ui('import'), () => fileInput.click(), { class: 'btn btn-small btn-ghost' }),
        fileInput,
        reset
      ),
      this.message ? h('p', { class: `message message-${this.message.kind}`, role: 'status', testid: 'title-message' }, this.message.text) : null,
      !this.store.persistent ? h('p', { class: 'message message-bad', testid: 'storage-warning' }, ui('storage.off')) : null
    )
  }

  private doExport(): void {
    try {
      const blob = new Blob([exportProgress(this.progress)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = h('a', { href: url, download: `${this.pack.slug}-progress.json`, class: 'sr-only' })
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 2000)
      this.message = { text: this.ui('export.done'), kind: 'ok' }
    } catch (e) {
      this.message = { text: String(e instanceof Error ? e.message : e), kind: 'bad' }
    }
    this.go('title')
  }

  private async importFile(file: File | undefined): Promise<void> {
    if (!file) return
    let text: string
    try {
      text = await file.text()
    } catch {
      this.message = { text: this.ui('import.bad', { why: 'unreadable' }), kind: 'bad' }
      return this.go('title')
    }
    const res = parseProgress(text, this.pack)
    if (res.ok) {
      this.progress = res.progress
      this.save()
      if (this.progress.settings.lang && this.pack.languages.includes(this.progress.settings.lang)) this.setLang(this.progress.settings.lang, false)
      this.message = { text: this.ui('import.ok'), kind: 'ok' }
    } else this.message = { text: this.ui('import.bad', { why: res.error }), kind: 'bad' }
    this.go('title')
  }

  private doReset(): void {
    this.store.clear()
    this.progress = newProgress(this.pack.id)
    this.confirmReset = false
    this.combo = 0
    this.finished = false
    this.message = { text: this.ui('reset.done'), kind: 'ok' }
    this.go('title')
  }

  // ---- the unit map ----

  private unitLevels(): Map<string, number> {
    const levels = new Map<string, number>()
    for (const id of unitOrder(this.pack.units)) {
      const u = this.pack.units.find((x) => x.id === id) as CourseUnit
      levels.set(id, u.requires.length === 0 ? 0 : 1 + Math.max(...u.requires.map((r) => levels.get(r) ?? 0)))
    }
    for (const u of this.pack.units) if (!levels.has(u.id)) levels.set(u.id, 0)
    return levels
  }

  private starsEl(n: number, testid?: string): HTMLElement {
    return h('span', { class: 'stars', role: 'img', 'aria-label': this.ui('stars', { n }), 'data-stars': String(n), ...(testid ? { testid } : {}) }, [1, 2, 3].map((i) => h('span', { class: `star ${i <= n ? 'on' : 'off'}`, 'aria-hidden': 'true' }, i <= n ? '★' : '☆')))
  }

  private buildMap(): Child {
    const ui = this.ui
    const levels = this.unitLevels()
    const max = Math.max(0, ...levels.values())
    const unitName = (id: string): string => this.text.t(this.pack.units.find((u) => u.id === id)?.title ?? id)
    const rows: HTMLElement[] = []
    for (let lv = 0; lv <= max; lv++) {
      const units = this.pack.units.filter((u) => levels.get(u.id) === lv)
      if (units.length === 0) continue
      rows.push(
        h(
          'li',
          { class: 'map-level' },
          lv > 0 ? h('div', { class: 'map-link', 'aria-hidden': 'true' }) : null,
          h(
            'ul',
            { class: 'map-row' },
            units.map((u) => {
              const open = isUnlocked(this.pack, this.progress, u.id)
              const stars = this.progress.units[u.id]?.stars ?? 0
              const count = itemsOfUnit(this.pack, u.id).length
              return h(
                'li',
                {},
                h(
                  'button',
                  {
                    type: 'button',
                    class: `unit-card ${open ? 'is-open' : 'is-locked'} ${isMastered(this.progress, u.id) ? 'is-mastered' : ''}`,
                    testid: `unit-${u.id}`,
                    'data-stars': String(stars),
                    'data-locked': String(!open),
                    'data-requires': u.requires.join(' '),
                    ...(open && count > 0 ? {} : { disabled: true }),
                    onclick: () => this.beginRound('unit', u.id)
                  },
                  h('span', { class: 'unit-name' }, this.text.t(u.title)),
                  u.summary ? h('span', { class: 'unit-summary' }, this.text.t(u.summary)) : null,
                  h('span', { class: 'unit-meta' }, open ? ui('map.items', { n: count }) : `🔒 ${ui('map.locked')}`),
                  u.requires.length ? h('span', { class: 'unit-req' }, ui('map.requires', { units: u.requires.map(unitName).join(', ') })) : null,
                  this.starsEl(stars)
                )
              )
            })
          )
        )
      )
    }
    const bossOpen = allMastered(this.pack, this.progress)
    const bossStars = this.progress.boss.stars
    const boss = h(
      'li',
      { class: 'map-level map-boss' },
      h('div', { class: 'map-link', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'map-boss-wrap' },
      h(
        'button',
        {
          type: 'button',
          class: `unit-card boss-card ${bossOpen ? 'is-open' : 'is-locked'}`,
          testid: 'boss',
          'data-stars': String(bossStars),
          'data-locked': String(!bossOpen),
          ...(bossOpen ? {} : { disabled: true }),
          onclick: () => this.beginRound('boss')
        },
        h('span', { class: 'unit-name' }, `👑 ${ui('map.boss')}`),
        h('span', { class: 'unit-summary' }, bossOpen ? ui('map.boss.ready') : ui('map.boss.locked')),
        this.starsEl(bossStars)
      )
      )
    )
    const queue = this.progress.queue
    return h(
      'section',
      { class: 'map-screen' },
      h(
        'div',
        { class: 'topbar' },
        button('menu', `‹ ${ui('menu')}`, () => this.go('title'), { class: 'btn btn-small btn-ghost' }),
        h('span', { class: 'topbar-stars', testid: 'map-stars' }, `★ ${ui('map.stars', { n: totalStars(this.pack, this.progress), total: this.pack.units.length * 3 })}`)
      ),
      this.heading('h1', ui('map.title'), 'map-title'),
      h('p', { class: 'subject' }, this.courseTitle()),
      queue.length > 0 ? h('div', { class: 'actions actions-center' }, button('review', `↻ ${ui('map.review', { n: queue.length })}`, () => this.go('review'), { class: 'btn' })) : null,
      h('ol', { class: 'map-levels', testid: 'unit-map' }, rows, boss),
      bossStars > 0 ? h('div', { class: 'actions actions-center' }, button('finish', ui('summary.finish'), () => this.finish(), { class: 'btn btn-primary' })) : null
    )
  }

  // ---- rounds ----

  private beginRound(kind: 'unit' | 'boss' | 'review', unitId?: string): void {
    const rs = startRound(this.pack, kind, { ...(unitId ? { unitId } : {}), queue: this.progress.queue, difficulty: kind === 'boss' ? 4 : this.difficulty })
    if (rs.size === 0) return this.go('map')
    this.round = rs
    this.roundNumber += 1
    this.roundScore = 0
    this.roundBestCombo = 0
    this.combo = 0
    this.lastResult = undefined
    this.finished = false
    this.nextQuestion()
  }

  private nextQuestion(): void {
    if (!this.round) return this.go('map')
    const pick = pickNext(this.round, this.pack, this.rng, this.progress.cards, Date.now())
    if (!pick) return this.endRound()
    const item = this.pack.items.find((i) => i.id === pick.id)
    if (!item) return this.endRound()
    this.turn += 1
    this.lastResult = undefined
    const renderer = this.host.getItemRenderer(item.kind)
    if (!renderer) return this.unsupported(pick, item)
    const view = renderer.render(this.itemContext(item))
    this.current = { pick, item, view, renderer, answered: false }
    this.go('item')
    this.startTimer()
  }

  /** A kind with no renderer (a plugin that is not loaded): say so, skip it, never crash. */
  private unsupported(pick: NextQuestion, item: CourseItem): void {
    console.warn(`[EduEngine] no renderer for the item kind "${item.kind}"; skipping ${item.id}`)
    if (this.round) this.round = recordResult(this.round, pick, item, { correct: true, score: 1 }, 'good')
    this.nextQuestion()
  }

  private itemContext(item: CourseItem): ItemContext {
    const seed = `${this.host.seed}:${item.id}:${this.turn}`
    const assets = new Map(this.pack.assets.map((a) => [a.id, a]))
    const target = this.pack.targetLang ?? this.lang
    return {
      item,
      data: this.data,
      lang: this.lang,
      text: this.text,
      check: this.check,
      rng: new SeededRandom(seed),
      seed,
      assetUrl: (id) => (id ? this.data.assets[id] : undefined),
      assetAlt: (id) => {
        const a = id ? assets.get(id) : undefined
        return a ? this.text.t(a.alt) : ''
      },
      ui: (key: UiKey, vars) => this.ui(key, vars),
      specialLetters: SPECIAL_LETTERS[target] ?? [],
      submit: (answer) => this.submit(answer),
      duck: (on) => this.audio.duck(on),
      ...(this.progress.settings.speak !== false && this.speechService ? { speech: this.speechService } : {})
    }
  }

  private submit(answer: unknown): CheckResult {
    const cur = this.current
    if (!cur) return { correct: false, score: 0, expected: null, invalid: true }
    if (cur.result) return cur.result
    return this.answered(cur, answer, checkItem(cur.item, answer, this.check), false)
  }

  private answered(cur: Current, answer: unknown, result: CheckResult, timedOut: boolean): CheckResult {
    this.stopTimer()
    if (!this.round) return result
    const grade = gradeOf(cur.item, answer, result)
    const now = Date.now()
    const timeLeft = cur.deadline ? Math.max(0, cur.deadline - now) / 1000 : 0
    this.round = recordResult(this.round, cur.pick, cur.item, result, grade, this.progress.cards, now)
    this.steps += 1
    const p = this.progress
    const fresh = !cur.pick.retry
    let queue = p.queue
    if (!result.correct) queue = enqueueMiss(queue, cur.item.id)
    else if (fresh || this.round.kind === 'review') queue = dequeue(queue, cur.item.id)
    // combo and score
    let points = Math.round(100 * result.score)
    if (result.correct) {
      points += Math.min(this.combo, 10) * 10 + Math.round(timeLeft * 2)
      if (cur.pick.retry) points = Math.round(points / 2)
      this.combo += 1
    } else this.combo = 0
    this.roundBestCombo = Math.max(this.roundBestCombo, this.combo)
    this.roundScore += points
    this.progress = {
      ...p,
      cards: { ...p.cards, [cur.item.id]: schedule(cardOf(p, cur.item.id, now), grade, now) },
      queue,
      score: p.score + points,
      bestCombo: Math.max(p.bestCombo, this.combo),
      answered: p.answered + (fresh ? 1 : 0),
      right: p.right + (fresh && result.correct ? 1 : 0)
    }
    this.save()
    cur.answered = true
    cur.answer = answer
    cur.result = result
    this.lastResult = result
    cur.view.reveal(result, answer)
    const feedback = buildFeedback(cur.item, answer, result, { text: this.text, ui: this.ui, rng: this.rng }, timedOut)
    cur.feedback = feedback
    this.screen = 'feedback'
    this.showFeedback(cur, feedback)
    this.updateHud()
    this.audio.sfx(result.correct ? 'correct' : 'wrong')
    if (result.correct && [3, 5, 7, 10, 15, 20, 30].includes(this.combo)) {
      this.burst(this.combo)
      this.audio.sfx('combo')
    }
    this.publish()
    return result
  }

  private showFeedback(cur: Current, fb: Feedback): void {
    const root = this.host.root
    const app = root.querySelector<HTMLElement>('.edu-app')
    if (app) app.setAttribute('data-screen', 'feedback')
    const body = root.querySelector<HTMLElement>('.item-body')
    const slot = root.querySelector<HTMLElement>('.feedback-slot')
    if (!slot) return
    const ui = this.ui
    const last = !!this.round && this.round.asked.length >= this.round.size && this.round.session.pending.length === 0
    const section = (cls: string, testid: string, title: string, ...kids: Child[]): HTMLElement => h('div', { class: `fb-part ${cls}`, testid }, h('h3', {}, title), kids)
    const panel = h(
      'div',
      { class: `feedback is-${fb.verdict}`, testid: 'feedback', 'data-result': fb.verdict, tabindex: '-1' },
      h('h2', { class: 'fb-title', testid: 'feedback-title' }, h('span', { class: 'fb-icon', 'aria-hidden': 'true' }, fb.verdict === 'correct' ? '✓' : fb.verdict === 'partial' ? '≈' : fb.verdict === 'timeout' ? '⏱' : '✗'), fb.title),
      fb.notes.length ? h('ul', { class: 'fb-notes', testid: 'feedback-notes' }, fb.notes.map((n) => h('li', {}, n))) : null,
      fb.detail ? h('p', { class: 'fb-detail', testid: 'feedback-detail' }, fb.detail) : null,
      fb.whys.length ? section('fb-why', 'feedback-why', ui('fb.why'), fb.whys.map((w) => h('p', {}, w))) : null,
      fb.answer.length ? section('fb-answer', 'feedback-answer', ui('fb.answer'), fb.answer.length === 1 ? h('p', { class: 'fb-answer-text' }, fb.answer[0] as string) : h('ul', {}, fb.answer.map((a) => h('li', {}, a)))) : null,
      fb.explanation ? section('fb-explain', 'feedback-explanation', ui('fb.explain'), h('p', {}, fb.explanation)) : null,
      fb.dyk ? section('fb-dyk', 'feedback-dyk', `💡 ${ui('fb.dyk')}`, h('p', {}, fb.dyk)) : null,
      h('div', { class: 'actions' }, button('next', last ? ui('results') : ui('next'), () => this.nextQuestion(), { class: 'btn btn-primary btn-big', 'data-autofocus': '' }))
    )
    slot.appendChild(panel)
    const live = root.querySelector<HTMLElement>('[data-testid="live"]')
    if (live) live.textContent = `${fb.title}. ${fb.whys.join(' ')} ${fb.answer.join('. ')}`
    body?.classList.add('is-answered')
    if (cur.result?.correct) pulse(body ?? panel, 'fx-glow')
    else pulse(body ?? panel, 'fx-shake')
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    root.querySelector<HTMLElement>('[data-testid="next"]')?.focus({ preventScroll: true })
  }

  private burst(n: number): void {
    const layer = this.host.root.querySelector('.burst-layer')
    if (!layer) return
    // a puff of dust (chalk, sparks or coins, by theme) flies out from the lettering; CSS hides it for reduced motion
    const dust = Array.from({ length: 14 }, (_, i) => {
      const angle = (i / 14) * Math.PI * 2 + (i % 2) * 0.22
      const dist = 90 + (i % 3) * 48
      return h('span', {
        class: 'dust',
        'aria-hidden': 'true',
        style: `--dx:${Math.round(Math.cos(angle) * dist)}px;--dy:${Math.round(Math.sin(angle) * dist)}px;--s:${5 + (i % 4) * 2}px;--delay:${(i % 5) * 30}ms`
      })
    })
    const el = h('div', { class: 'burst', testid: 'combo-burst' }, this.ui('burst', { n }), dust)
    layer.appendChild(el)
    window.setTimeout(() => el.remove(), 1400)
  }

  // ---- timer ----

  private startTimer(): void {
    const cur = this.current
    if (!cur || !this.progress.settings.timer || !timerApplies(cur.item)) return
    const total = quizConfig(this.pack).timerSeconds * 1000
    cur.deadline = Date.now() + total
    const tick = (): void => {
      if (!this.current || this.current !== cur || cur.answered) return this.stopTimer()
      const left = (cur.deadline as number) - Date.now()
      this.setTimer(Math.max(0, left), total)
      if (left <= 0) {
        this.stopTimer()
        this.answered(cur, undefined, checkItem(cur.item, undefined, this.check), true)
      }
    }
    this.setTimer(total, total)
    cur.timerId = window.setInterval(tick, 200)
  }

  private setTimer(left: number, total: number): void {
    const el = this.hud.timer
    if (!el) return
    el.hidden = false
    el.style.setProperty('--left', String(Math.max(0, left / total)))
    const s = el.querySelector('.timer-s')
    if (s) s.textContent = String(Math.ceil(left / 1000))
    el.classList.toggle('is-low', left / total < 0.25)
  }

  private stopTimer(): void {
    const t = this.current?.timerId
    if (t !== undefined) window.clearInterval(t)
    if (this.current) this.current.timerId = undefined
  }

  // ---- the question screen ----

  private updateHud(): void {
    if (this.hud.score) this.hud.score.textContent = String(this.progress.score)
    if (this.hud.combo) {
      this.hud.combo.textContent = `x${this.combo}`
      const meter = this.hud.combo.closest('.combo')
      meter?.setAttribute('data-combo', String(Math.min(this.combo, 10)))
      meter?.classList.toggle('is-hot', this.combo >= 3)
      if (this.combo > 0) pulse(this.hud.combo, 'fx-pop', 500)
    }
    if (this.hud.progress && this.round) this.hud.progress.replaceChildren(...this.pips())
  }

  private pips(): HTMLElement[] {
    const rs = this.round
    if (!rs) return []
    const fresh = rs.results.filter((r) => !r.retry)
    return Array.from({ length: rs.size }, (_, i) => {
      const r = fresh[i]
      const cls = r ? (r.correct ? 'is-right' : 'is-wrong') : i === fresh.length ? 'is-now' : ''
      return h('span', { class: `pip ${cls}`, 'aria-hidden': 'true' })
    })
  }

  private roundTitle(): string {
    const rs = this.round
    if (!rs) return ''
    if (rs.kind === 'boss') return `👑 ${this.ui('map.boss')}`
    if (rs.kind === 'review') return `↻ ${this.ui('review')}`
    return this.text.t(this.pack.units.find((u) => u.id === rs.unitId)?.title ?? '')
  }

  private buildItem(): Child {
    const cur = this.current
    const rs = this.round
    if (!cur || !rs) return h('p', {}, this.ui('loading'))
    const ui = this.ui
    const item = cur.item
    this.hud.score = h('b', { testid: 'hud-score' }, String(this.progress.score))
    this.hud.combo = h('b', { testid: 'hud-combo' }, `x${this.combo}`)
    this.hud.progress = h('span', { class: 'pips', testid: 'hud-progress' }, this.pips())
    this.hud.timer = h('div', { class: 'timer', role: 'timer', testid: 'hud-timer', hidden: true }, h('span', { class: 'timer-s' }), h('span', { class: 'timer-bar' }, h('span', { class: 'timer-fill' })))
    const hud = h(
      'header',
      { class: 'hud' },
      button('leave', `‹ ${ui('leave')}`, () => this.leaveRound(), { class: 'btn btn-small btn-ghost' }),
      h('div', { class: 'hud-mid' }, h('span', { class: 'hud-unit', testid: 'hud-unit' }, this.roundTitle()), this.hud.progress),
      h('div', { class: 'hud-stats' }, h('span', { class: 'stat' }, h('small', {}, ui('score')), this.hud.score), h('span', { class: `combo ${this.combo >= 3 ? 'is-hot' : ''}`, 'data-combo': String(Math.min(this.combo, 10)) }, h('small', {}, ui('combo')), this.hud.combo)),
      this.hud.timer
    )
    const meta = h(
      'p',
      { class: 'q-meta', testid: 'question-number' },
      cur.pick.retry ? h('span', { class: 'tag tag-retry', testid: 'retry-tag' }, ui('retry')) : ui('question', { i: Math.min(rs.asked.length + (cur.answered ? 0 : 1), rs.size), n: rs.size })
    )
    // every screen has exactly one h1: the question (a flashcard draws its question on the card, so the round's name is the hidden h1)
    const prompt = cur.renderer.ownsPrompt ? h('h1', { class: 'sr-only' }, this.roundTitle()) : h('h1', { class: 'prompt', testid: 'prompt', tabindex: '-1' }, this.text.t(item.prompt))
    const image = NO_IMAGE_KINDS.has(item.kind) ? null : itemImage(this.itemContext(item))
    const hintKey = item.hint
    const hintText = hintKey && this.text.hasText(hintKey) ? this.text.t(hintKey) : null
    let hintShown = false
    const hintBox = h('p', { class: 'hint-text', testid: 'hint-text', hidden: true }, hintText ?? '')
    const hintBtn = hintText
      ? button('hint', `💡 ${ui('hint')}`, () => {
          hintShown = !hintShown
          hintBox.hidden = !hintShown
          hintBtn?.setAttribute('aria-expanded', String(hintShown))
        }, { class: 'btn btn-small btn-ghost', 'aria-expanded': 'false' })
      : null
    const body = h('div', { class: `item-body kind-${item.kind}${cur.answered ? ' is-answered' : ''}`, testid: 'item-body', 'data-kind': item.kind }, cur.view.el)
    return h('section', { class: 'question', 'aria-label': this.text.t(item.prompt) }, hud, meta, prompt, image, hintBtn, hintBox, body, h('div', { class: 'feedback-slot', 'aria-live': 'polite' }))
  }

  private leaveRound(): void {
    this.round = null
    this.go('map')
  }

  // ---- summary ----

  private endRound(): void {
    const rs = this.round
    if (!rs) return this.go('map')
    const accuracy = roundAccuracy(rs)
    const before = this.progress
    if (rs.kind === 'unit' || rs.kind === 'boss') {
      this.progress = recordRound(this.progress, rs.kind === 'boss' ? { boss: true } : { unitId: rs.unitId as string }, accuracy)
      this.roundStars = starsFor(accuracy)
      this.roundUnlocked = newlyUnlocked(this.pack, before, this.progress)
      if (rs.kind === 'unit') this.difficulty = rs.adaptive.difficulty
    } else {
      this.roundStars = 0
      this.roundUnlocked = []
    }
    this.save()
    if (rs.kind !== 'review') this.audio.sfx(rs.kind === 'boss' ? 'boss' : 'level-up')
    this.go('summary')
  }

  private buildSummary(): Child {
    const rs = this.round
    if (!rs) return this.buildMap()
    const ui = this.ui
    const accuracy = Math.round(roundAccuracy(rs) * 100)
    const missed = missedIds(rs)
    const rated = rs.kind !== 'review'
    const bossPassed = rs.kind === 'boss' && this.roundStars >= 1
    const unitName = (id: string): string => this.text.t(this.pack.units.find((u) => u.id === id)?.title ?? id)
    const notes: HTMLElement[] = []
    if (this.roundUnlocked.length) notes.push(h('p', { class: 'message message-ok', testid: 'summary-unlocked' }, `🔓 ${ui('summary.unlocked', { units: this.roundUnlocked.map(unitName).join(', ') })}`))
    if (rs.kind === 'unit' && allMastered(this.pack, this.progress) && this.progress.boss.rounds === 0) notes.push(h('p', { class: 'message message-ok', testid: 'summary-boss-open' }, `👑 ${ui('summary.bossLocked')}`))
    if (rs.kind === 'unit' && this.roundStars < 2) notes.push(h('p', { class: 'message', testid: 'summary-need-stars' }, ui('summary.needStars')))
    if (rs.kind === 'boss' && !bossPassed) notes.push(h('p', { class: 'message message-bad', testid: 'summary-boss-fail' }, ui('summary.bossFail')))
    return h(
      'section',
      { class: 'summary-screen' },
      this.heading('h1', accuracy === 100 && rated ? ui('summary.perfect') : ui('summary.title'), 'summary-title'),
      h('p', { class: 'subject' }, this.roundTitle()),
      rated ? this.starsEl(this.roundStars, 'summary-stars') : null,
      h('p', { class: 'big-number', testid: 'summary-accuracy' }, ui('summary.accuracy', { n: accuracy })),
      h('p', { testid: 'summary-score' }, `${ui('summary.score', { n: this.roundScore })} · ${ui('summary.combo', { n: this.roundBestCombo })}`),
      notes,
      missed.length
        ? h('ul', { class: 'miss-list', testid: 'summary-misses' }, missed.map((id) => {
              const item = this.pack.items.find((i) => i.id === id)
              const ans = item ? answerLines(item, { text: this.text, ui }).join(' / ') : ''
              return h('li', { testid: `miss-${id}` }, h('span', {}, this.text.t(item?.prompt ?? id)), ans ? h('small', { class: 'miss-answer' }, ans.length > 140 ? `${ans.slice(0, 139)}…` : ans) : null)
            }))
        : null,
      h(
        'div',
        { class: 'actions actions-center' },
        bossPassed ? button('finish', ui('summary.finish'), () => this.finish(), { class: 'btn btn-primary btn-big' }) : null,
        button('to-map', ui('summary.back'), () => this.leaveRound(), { class: `btn ${bossPassed ? '' : 'btn-primary'} btn-big` }),
        this.progress.queue.length > 0 ? button('review', `↻ ${ui('map.review', { n: this.progress.queue.length })}`, () => this.go('review'), { class: 'btn' }) : null,
        rs.kind !== 'review' ? button('replay', ui('summary.again'), () => this.beginRound(rs.kind, rs.unitId), { class: 'btn' }) : null
      )
    )
  }

  // ---- review ----

  private buildReview(): Child {
    const ui = this.ui
    const ids = this.progress.queue.filter((id) => this.pack.items.some((i) => i.id === id))
    const items = ids.map((id) => this.pack.items.find((i) => i.id === id) as CourseItem)
    return h(
      'section',
      { class: 'review-screen' },
      h('div', { class: 'topbar' }, button('to-map', `‹ ${ui('review.back')}`, () => this.leaveRound(), { class: 'btn btn-small btn-ghost' })),
      this.heading('h1', ui('review.title'), 'review-title'),
      items.length === 0
        ? h('p', { class: 'message', testid: 'review-empty' }, ui('review.empty'))
        : h(
            'ul',
            { class: 'review-list', testid: 'review-list' },
            items.map((item) => {
              const lines = answerLines(item, { text: this.text, ui })
              return h(
                'li',
                { class: 'review-item', testid: `review-item-${item.id}` },
                h('p', { class: 'review-q' }, this.text.t(item.prompt)),
                lines.length ? h('p', { class: 'review-a' }, h('b', {}, `${ui('review.answer')}: `), lines.join(' / ')) : null,
                this.text.text(item.explanation) ? h('p', { class: 'review-e' }, this.text.t(item.explanation)) : null
              )
            })
          ),
      h(
        'div',
        { class: 'actions actions-center' },
        items.length ? button('practice', ui('review.practice'), () => this.beginRound('review'), { class: 'btn btn-primary btn-big', 'data-autofocus': '' }) : null,
        button('to-map', ui('review.back'), () => this.leaveRound(), { class: 'btn btn-big' })
      )
    )
  }

  // ---- end ----

  private finish(): void {
    this.finished = true
    this.round = null
    this.go('end')
  }

  private buildEnd(): Child {
    const ui = this.ui
    const p = this.progress
    const acc = p.answered > 0 ? Math.round((p.right / p.answered) * 100) : 0
    return h(
      'section',
      { class: 'end-screen' },
      h('p', { class: 'eyebrow' }, this.courseTitle()),
      this.heading('h1', ui('end.title'), 'end-title'),
      h('p', { class: 'subject' }, ui('end.sub')),
      h(
        'ul',
        { class: 'end-stars', testid: 'end-units' },
        this.pack.units.map((u) => h('li', {}, h('span', {}, this.text.t(u.title)), this.starsEl(p.units[u.id]?.stars ?? 0))),
        h('li', { class: 'end-boss' }, h('span', {}, `👑 ${ui('map.boss')}`), this.starsEl(p.boss.stars))
      ),
      h('p', { class: 'big-number', testid: 'end-score' }, `${ui('end.score')}: ${p.score}`),
      h('p', { testid: 'end-accuracy' }, ui('end.accuracy', { n: acc })),
      h(
        'div',
        { class: 'actions actions-center' },
        button('play-again', ui('end.again'), () => {
          this.finished = false
          this.round = null
          this.combo = 0
          this.go('map')
        }, { class: 'btn btn-primary btn-big', 'data-autofocus': '' }),
        button('to-title', ui('end.title.screen'), () => {
          this.finished = false
          this.go('title')
        }, { class: 'btn btn-big' })
      )
    )
  }

  // ---- keys ----

  private handleKey(e: KeyboardEvent): void {
    if (e.defaultPrevented) return
    const cur = this.current
    if (this.screen === 'item' && cur && !cur.answered) {
      if (isTyping(e.target) && /^[0-9]$/.test(e.key)) return
      cur.view.key?.(e)
      return
    }
    if (this.screen === 'feedback' && cur && (e.key === 'Enter' || e.key === ' ')) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.getAttribute('role') === 'button')) return
      e.preventDefault()
      this.nextQuestion()
    }
  }
}

export const quizArenaShell: Shell = {
  id: SHELL_ID,
  mount(host) {
    const arena = new QuizArena(host)
    this.unmount = () => arena.unmount()
    arena.mount()
  }
}
