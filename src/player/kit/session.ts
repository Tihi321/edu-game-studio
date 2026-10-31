import type { CourseItem, CoursePack, CourseUnit } from '../../shared/course'
import { unitOrder } from '../../shared/course'
import { checkItem, makeTextResolver, rngFor, schedule, SeededRandom, type CheckContext, type CheckResult, type Grade, type TextResolver } from '../../shared/edu'
import type { GameData } from '../../shared/game-data'
import { sectionOf } from '../../shared/shells'
import { clear, h, type Child } from '../dom'
import { GameAudio, loopsOf } from '../audio'
import { buildFeedback, type Feedback } from '../feedback'
import { makeUi, SPECIAL_LETTERS, type Ui, type UiKey } from '../i18n'
import {
  allMastered,
  browserStorage,
  cardOf,
  dequeue,
  emptyShellProgress,
  enqueueMiss,
  hasProgress,
  hasShellProgress,
  isMastered,
  isUnlocked,
  masteryMap,
  newlyUnlocked,
  ProgressStore,
  recordRound,
  starsFor,
  totalStars,
  type Progress,
  type ShellProgress
} from '../progress'
import { gradeOf, itemsOfUnit, pickNext, recordResult, roundAccuracy, startPool, type NextQuestion, type RoundState } from '../round'
import { buildSnapshot } from '../state'
import type { AnyScreen, ItemContext, RoundKind, ShellDebugApi, ShellHost } from '../types'
import { makeShellUi, type ShellStrings, type ShellUi } from './strings'

/**
 * The shell kit's session (EGS-10): everything a game shell shares with the others, so a shell only draws its world and decides what a
 * right or wrong answer does in it (a door opens, a blow lands, a plant grows, a clue is found).
 *
 *  - the edition (language picking, the player's words `ui`, the shell's own words `s`, the text resolver and the check context);
 *  - the learner's progress in `localStorage` (SM-2 cards, review queue, score and settings shared by every shell; the shell's own unit
 *    stars, finish flag and data in `progress.shells[<shellId>]`);
 *  - answering: `answer()` checks with the shared `checkItem`, schedules the item's card, keeps the review queue, the combo and the
 *    score, counts the step and builds the explanatory feedback (the why of the chosen distractor, the answer, the explanation, the
 *    did-you-know);
 *  - runs: `startRun()` / `next()` / `record()` are the quiz arena's round logic over any pool of items (adaptive difficulty aiming at
 *    70-85 %, missed items coming back after 2-4 others, due cards first, no two of a kind in a row);
 *  - drawing a screen (`render`) into the standard frame and publishing the `getState()` snapshot (`publish`).
 *
 * The question screen itself is `ask()` (`question.ts`); title and end screens are in `screens.ts`. Contract: docs/player.md, "Shells".
 */

export interface AnswerOutcome {
  item: CourseItem
  answer: unknown
  result: CheckResult
  grade: Grade
  /** Points added to the score. */
  points: number
  feedback: Feedback
  /** A missed item asked again in the same run. */
  retry: boolean
  timedOut: boolean
}

/** What a snapshot carries besides the session's own fields. */
export interface PublishExtra {
  /** What the open question is for (`door`, `battle` ...), kept on `item` and `feedback`. */
  context?: string
  /** The shell's own JSON-safe state. */
  view?: Record<string, unknown>
  unitId?: string
  roundKind?: RoundKind
  roundSize?: number
  roundNumber?: number
  /** The open question (screens `item` and `feedback`). */
  item?: { id: string; kind: string; index?: number }
  lastResult?: Pick<CheckResult, 'correct' | 'typo' | 'diacritics'>
}

export interface SessionOptions<K extends string> {
  shellId: string
  /** The theme id of src/design/themes (the shell imports its CSS). */
  theme: string
  strings: ShellStrings<K>
}

const languageOf = (data: GameData, saved: string | undefined): string => {
  const langs = data.pack.languages
  if (saved && langs.includes(saved)) return saved
  const nav = (typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : []).map((l) => l.toLowerCase())
  for (const n of nav) {
    const hit = langs.find((l) => l === n || l === n.split('-')[0])
    if (hit) return hit
  }
  return langs.includes(data.defaultLang) ? data.defaultLang : (langs[0] as string)
}

/** The kinds whose renderer draws its own picture or audio (the question screen adds no item image for them). */
export const NO_IMAGE_KINDS = new Set(['hotspot', 'listening', 'flashcard'])

/**
 * The music area of a screen, as the quiz arena names them: `end` at the end screen, `boss` in a boss run, `unit-<id>` anywhere a unit's world or run is
 * open (a wing, an area, a scene, a case, a hunt, a round), `menu` on the title and the hubs. An area with no cue plays the `menu` track (`GameAudio`).
 */
export function musicAreaOf(screen: AnyScreen, extra: { roundKind?: string; unitId?: string }): string {
  if (screen === 'end') return 'end'
  if (extra.roundKind === 'boss') return 'boss'
  if (screen !== 'title' && extra.roundKind !== 'review' && extra.unitId) return `unit-${extra.unitId}`
  return 'menu'
}

export class ShellSession<K extends string = string> {
  readonly host: ShellHost
  readonly data: GameData
  readonly pack: CoursePack
  readonly shellId: string
  readonly theme: string
  readonly store: ProgressStore
  readonly rng: SeededRandom
  progress: Progress
  lang: string
  /** The player's own words (buttons, feedback, the title screen). */
  ui: Ui
  /** The shell's own words. */
  s: ShellUi<K>
  text: TextResolver
  check: CheckContext
  combo = 0
  /** Answers given in this page session (what `getState().steps` counts). */
  steps = 0
  /** Questions drawn in this page session (seeds each presentation). */
  turn = 0
  /** True on the end screen (`getState().finished`). */
  finished = false
  screen: AnyScreen = 'loading'
  /** Set by `ask()` while a question is open: the question gets the keys first. */
  questionKeys: ((e: KeyboardEvent) => boolean) | null = null
  private keyHandler: ((e: KeyboardEvent) => void) | null = null
  private gameAudio: GameAudio | null = null
  private extra: PublishExtra = {}
  private readonly strings: ShellStrings<K>
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return
    if (this.questionKeys && this.questionKeys(e)) return
    if (!this.questionKeys) this.keyHandler?.(e)
  }

  constructor(host: ShellHost, opts: SessionOptions<K>) {
    this.host = host
    this.data = host.data
    this.pack = host.data.pack
    this.shellId = opts.shellId
    this.theme = opts.theme
    this.strings = opts.strings
    this.store = new ProgressStore(this.pack, browserStorage())
    this.progress = this.store.load()
    this.rng = rngFor(host.seed, opts.shellId)
    this.lang = languageOf(this.data, this.progress.settings.lang)
    this.text = makeTextResolver(this.data.catalogs, this.lang, this.pack.targetLang)
    this.ui = makeUi(this.lang, this.data.catalogs[this.lang])
    this.s = makeShellUi(this.strings, this.lang, this.data.catalogs[this.lang])
    this.check = { text: this.text, diacritics: this.pack.matching.diacritics, typos: this.pack.matching.typos }
    this.applyLang()
  }

  /** Puts the stage class, the theme and the shell id on the root and starts listening to the keyboard. Call once from `Shell.mount`. */
  mount(): void {
    const root = this.host.root
    root.classList.add('edu-stage')
    root.setAttribute('data-edu-theme', this.theme)
    root.setAttribute('data-shell', this.shellId)
    document.addEventListener('keydown', this.onKey)
  }

  /**
   * The game's audio (EGS-16): the music of the area the game is in (`music:<area>` cues, see `musicAreaOf`) and the sound effects (`playCue`), the same in every
   * shell. Made on first use, so a course without cues never touches it.
   */
  get audio(): GameAudio {
    if (!this.gameAudio) {
      this.gameAudio = new GameAudio({ cues: this.pack.cues, assets: this.data.assets, loops: loopsOf(this.pack.extensions), settings: () => this.progress.settings })
    }
    return this.gameAudio
  }

  /** Stops listening, clears the bot helpers. Call from `Shell.unmount`. */
  unmount(): void {
    this.gameAudio?.dispose()
    this.gameAudio = null
    document.removeEventListener('keydown', this.onKey)
    this.questionKeys = null
    this.host.setDebug(null)
    this.host.root.removeAttribute('data-shell')
  }

  /** The shell's keys (moving on a map, shortcuts); they never reach it while a question is open. */
  setKeyHandler(fn: ((e: KeyboardEvent) => void) | null): void {
    this.keyHandler = fn
  }

  /** Read-only helpers for the autoplay bot (`EduEngine.debug.shell`). */
  setDebug(api: ShellDebugApi): void {
    this.host.setDebug(api)
  }

  // ---- edition ----

  private applyLang(): void {
    document.documentElement.lang = this.lang
    document.title = this.courseTitle()
  }

  /** Switches the edition and saves it (the caller draws the screen again). */
  setLang(lang: string): void {
    if (!this.pack.languages.includes(lang)) return
    this.lang = lang
    this.text = makeTextResolver(this.data.catalogs, lang, this.pack.targetLang)
    this.ui = makeUi(lang, this.data.catalogs[lang])
    this.s = makeShellUi(this.strings, lang, this.data.catalogs[lang])
    this.check = { text: this.text, diacritics: this.pack.matching.diacritics, typos: this.pack.matching.typos }
    this.progress = { ...this.progress, settings: { ...this.progress.settings, lang } }
    this.save()
    this.applyLang()
  }

  /** The text of a catalog key in the edition (the key itself when it is missing, so a gap shows). */
  t(key: string | undefined): string {
    return key ? this.text.t(key) : ''
  }

  /** The course title: the catalog key `course.title`, else the subject. */
  courseTitle(): string {
    const t = this.text.text('course.title')
    if (t) return t
    return this.pack.subject.charAt(0).toLocaleUpperCase() + this.pack.subject.slice(1)
  }

  /** The shell's section of the course (`shells.config[<shellId>]`, parsed with defaults), or undefined. */
  section<S>(): S | undefined {
    return sectionOf<S>(this.pack, this.shellId)
  }

  /** Letters offered under a text input for the language of the typed answers. */
  get specialLetters(): string[] {
    return SPECIAL_LETTERS[this.pack.targetLang ?? this.lang] ?? []
  }

  // ---- progress ----

  save(): void {
    this.store.save(this.progress)
  }

  /** This shell's progress (stars, finish, data). */
  get sp(): ShellProgress {
    return this.progress.shells[this.shellId] ?? emptyShellProgress()
  }

  private setSp(sp: ShellProgress): void {
    this.progress = { ...this.progress, shells: { ...this.progress.shells, [this.shellId]: sp } }
    this.save()
  }

  /** The shell's own saved data (validate it before use: it may come from an imported file). */
  shellData<T>(): T | undefined {
    return this.sp.data as T | undefined
  }

  setShellData(data: unknown): void {
    this.setSp({ ...this.sp, data: JSON.parse(JSON.stringify(data ?? null)) as unknown })
  }

  /** True when the learner has played this shell before (the title says Continue). */
  get started(): boolean {
    return hasShellProgress(this.progress, this.shellId) || hasProgress(this.progress)
  }

  /** The progress helpers of `progress.ts` read `units` and `boss`: this view gives them the shell's own. */
  private view(): Progress {
    const sp = this.sp
    return { ...this.progress, units: sp.units, boss: sp.boss }
  }

  unitStars(unitId: string): number {
    return this.sp.units[unitId]?.stars ?? 0
  }
  bossStars(): number {
    return this.sp.boss.stars
  }
  isMastered(unitId: string): boolean {
    return isMastered(this.view(), unitId)
  }
  /** A unit is open when every unit it requires is mastered (2+ stars) in this shell. */
  isUnlocked(unitId: string): boolean {
    return isUnlocked(this.pack, this.view(), unitId)
  }
  allMastered(): boolean {
    return allMastered(this.pack, this.view())
  }
  totalStars(): number {
    return totalStars(this.pack, this.view())
  }
  /** Unit id -> stars 0..3 in this shell (`getState().mastery`). */
  mastery(): Record<string, number> {
    return masteryMap(this.pack, this.view())
  }

  /**
   * Records a finished run of a unit (or of the boss): stars from the first-try accuracy (1 from 50 %, 2 from 70 %, 3 from 90 %), never
   * going down. Returns the stars of this run and the units it has just opened.
   */
  recordUnit(target: { unitId: string } | { boss: true }, accuracy: number): { stars: number; unlocked: string[] } {
    const before = this.view()
    const after = recordRound(before, 'boss' in target ? { boss: true } : { unitId: target.unitId }, accuracy)
    this.setSp({ ...this.sp, units: after.units, boss: after.boss })
    return { stars: starsFor(accuracy), unlocked: newlyUnlocked(this.pack, before, after) }
  }

  /** Marks the course finished in this shell (the end screen). */
  finish(): void {
    this.finished = true
    this.setSp({ ...this.sp, finished: true })
  }

  // ---- the course ----

  /** The units in prerequisite order. */
  units(): CourseUnit[] {
    return unitOrder(this.pack.units).map((id) => this.pack.units.find((u) => u.id === id) as CourseUnit)
  }

  unitTitle(unitId: string | undefined): string {
    return this.t(this.pack.units.find((u) => u.id === unitId)?.title)
  }

  item(id: string): CourseItem | undefined {
    return this.pack.items.find((i) => i.id === id)
  }

  itemsOfUnit(unitId: string): CourseItem[] {
    return itemsOfUnit(this.pack, unitId)
  }

  /** Whether an item can be shown (a renderer is registered for its kind). */
  canAsk(item: CourseItem | undefined): item is CourseItem {
    return !!item && !!this.host.getItemRenderer(item.kind)
  }

  /** The items of the review queue that still exist, oldest first. */
  queueItems(): CourseItem[] {
    return this.progress.queue.map((id) => this.item(id)).filter((i): i is CourseItem => !!i)
  }

  /** The context a renderer draws one question with. `submit` hands the answer to the question screen. */
  itemContext(item: CourseItem, submit: (answer: unknown) => CheckResult): ItemContext {
    const seed = `${this.host.seed}:${this.shellId}:${item.id}:${this.turn}`
    const assets = new Map(this.pack.assets.map((a) => [a.id, a]))
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
      specialLetters: this.specialLetters,
      submit,
      duck: (on) => this.audio.duck(on)
    }
  }

  /**
   * Checks an answer and records it: the item's SM-2 card is scheduled (a flashcard's own grade; else right = good, shaky = hard, wrong =
   * again), a miss joins the review queue and a right first answer takes it out, the combo and the score move (100 x the partial
   * credit + 10 per combo step up to 10; half for a retry), the step is counted. Saved at once.
   */
  answer(item: CourseItem, answer: unknown, opts: { retry?: boolean; timedOut?: boolean } = {}): AnswerOutcome {
    const retry = opts.retry === true
    const timedOut = opts.timedOut === true
    const result = timedOut ? checkItem(item, undefined, this.check) : checkItem(item, answer, this.check)
    const grade = gradeOf(item, answer, result)
    const now = Date.now()
    const p = this.progress
    let queue = p.queue
    if (!result.correct) queue = enqueueMiss(queue, item.id)
    else if (!retry) queue = dequeue(queue, item.id)
    let points = Math.round(100 * result.score)
    if (result.correct) {
      points += Math.min(this.combo, 10) * 10
      if (retry) points = Math.round(points / 2)
      this.combo += 1
    } else this.combo = 0
    this.steps += 1
    this.progress = {
      ...p,
      cards: { ...p.cards, [item.id]: schedule(cardOf(p, item.id, now), grade, now) },
      queue,
      score: p.score + points,
      bestCombo: Math.max(p.bestCombo, this.combo),
      answered: p.answered + (retry ? 0 : 1),
      right: p.right + (!retry && result.correct ? 1 : 0)
    }
    this.save()
    const feedback = buildFeedback(item, answer, result, { text: this.text, ui: this.ui, rng: this.rng }, timedOut)
    return { item, answer, result, grade, points, feedback, retry, timedOut }
  }

  // ---- runs: the quiz arena's round logic over any pool ----

  /** A run over a pool of item ids (a wing, a quest, a hunt, a case): `size` fresh questions (default all). */
  startRun(pool: readonly string[], opts: { kind?: RoundKind; unitId?: string; size?: number; difficulty?: number } = {}): RoundState {
    const askable = pool.filter((id) => this.canAsk(this.item(id)))
    return startPool(askable, opts)
  }

  /** The next question of a run (a missed one whose gap has passed first), or null when the run is over. */
  next(run: RoundState): NextQuestion | null {
    return pickNext(run, this.pack, this.rng, this.progress.cards, Date.now())
  }

  /** The run after an answer. */
  record(run: RoundState, pick: NextQuestion, outcome: AnswerOutcome): RoundState {
    return recordResult(run, pick, outcome.item, outcome.result, outcome.grade, this.progress.cards, Date.now())
  }

  /** First-try accuracy of the fresh questions of a run, 0..1. */
  accuracy(run: RoundState): number {
    return roundAccuracy(run)
  }

  // ---- drawing and publishing ----

  /** Publishes the `getState()` snapshot. `extra` replaces the previous extra fields (pass them again to keep them). */
  publish(screen: AnyScreen = this.screen, extra: PublishExtra = this.extra): void {
    this.screen = screen
    this.extra = extra
    if (this.pack.cues.length) this.audio.setArea(musicAreaOf(screen, extra))
    this.host.publish(
      buildSnapshot({
        screen,
        shell: this.shellId,
        lang: this.lang,
        seed: this.host.seed,
        ...(extra.roundKind ? { roundKind: extra.roundKind, roundSize: extra.roundSize ?? 0, ...(extra.roundNumber ? { roundNumber: extra.roundNumber } : {}) } : {}),
        ...(extra.unitId ? { unitId: extra.unitId } : {}),
        ...(extra.item ? { itemId: extra.item.id, itemKind: extra.item.kind, itemIndex: extra.item.index ?? 0 } : {}),
        ...(extra.lastResult ? { lastResult: extra.lastResult } : {}),
        ...(extra.context ? { context: extra.context } : {}),
        ...(extra.view ? { view: extra.view } : {}),
        combo: this.combo,
        score: this.progress.score,
        reviewQueue: this.progress.queue,
        mastery: this.mastery(),
        finished: this.finished,
        steps: this.steps
      })
    )
  }

  /**
   * Draws a screen into the standard frame and publishes it:
   * `#edu-root.edu-stage[data-edu-theme] > .edu-app[data-testid=app][data-screen][data-shell] > .frame > main#edu-main.board.board-<screen>`,
   * plus the burst layer and the `live` region. The focus goes to the first `[data-autofocus]` in the board, else its first heading
   * (pass `focus: false` when the caller places it). Every screen must have exactly one `h1`.
   */
  render(screen: AnyScreen, body: Child, extra: PublishExtra = {}, opts: { focus?: boolean } = {}): HTMLElement {
    const root = this.host.root
    clear(root)
    const main = h('main', { class: `board board-${screen}`, id: 'edu-main' }, body)
    const app = h(
      'div',
      { class: `edu-app shell-${this.shellId}`, testid: 'app', 'data-screen': screen, 'data-shell': this.shellId },
      h('div', { class: 'frame' }, main),
      h('div', { class: 'burst-layer', 'aria-hidden': 'true' }),
      h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', testid: 'live' })
    )
    root.appendChild(app)
    this.publish(screen, extra)
    if (opts.focus !== false) {
      const target = main.querySelector<HTMLElement>('[data-autofocus]') ?? main.querySelector<HTMLElement>('h1, h2')
      target?.focus({ preventScroll: false })
      if (typeof window.scrollTo === 'function') window.scrollTo(0, 0)
    }
    return main
  }

  /** Sets `data-screen` on the app without drawing again (the question screen turning into the feedback screen). */
  markScreen(screen: AnyScreen): void {
    this.host.root.querySelector('.edu-app')?.setAttribute('data-screen', screen)
  }

  /** Reads a line through the `aria-live` region. */
  live(text: string): void {
    const el = this.host.root.querySelector<HTMLElement>('[data-testid="live"]')
    if (el) el.textContent = text
  }

  /** The `★★☆` stars element (`data-stars`), with an accessible label. */
  stars(n: number, testid?: string): HTMLElement {
    return h(
      'span',
      { class: 'stars', role: 'img', 'aria-label': this.ui('stars', { n }), 'data-stars': String(n), ...(testid ? { testid } : {}) },
      [1, 2, 3].map((i) => h('span', { class: `star ${i <= n ? 'on' : 'off'}`, 'aria-hidden': 'true' }, i <= n ? '★' : '☆'))
    )
  }

  /** Plays the course's sound effects for an event (`correct`, `wrong`, `combo`, `unit-complete` (also `level-up`), `boss`, or a shell's own): nothing when sound is off, quieter with "reduce audio". */
  playCue(on: string): void {
    if (this.pack.cues.length) this.audio.sfx(on)
  }
}
