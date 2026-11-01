import { buildEncyclopedia, glossaryOf, passageOf, readerChapters, type EncArticle, type EncHunt, type EncModel, type EncStep, type EncyclopediaSection } from '../../../shared/shells/encyclopedia'
import { button, h, type Child } from '../../dom'
import type { GlossWord } from '../../gloss'
import { ask } from '../../kit/question'
import { endScreen, newTitleState, titleScreen } from '../../kit/screens'
import { ShellSession } from '../../kit/session'
import type { NextQuestion, RoundState } from '../../round'
import type { Shell } from '../../types'
import { linkify, linkedIds, paragraphsOf, searchArticles, searchTermFor, type ArticleText, type Seg } from './articles'
import { emptyData, glossKey, readData, withChapterDone, withFound, withGlossDeck, withRead, withReaderAt, type EncData } from './data'
import { ENC_STRINGS, type EncKey } from './strings'
import { articleScreenBody } from './view-article'
import { codexBody, huntsBody, clueBar, hudBar } from './view-hunts'
import { exploreBody } from './view-explore'
import { mapBody, timelineBody } from './view-places'
import { readerBody } from './view-reader'

/** The parts of the book the tabs lead to. */
export type Part = 'index' | 'reader' | 'timeline' | 'map' | 'codex' | 'hunts'

export interface ActiveHunt {
  hunt: EncHunt
  /** The grand hunt (a boss run over the steps of every unit). */
  final: boolean
  /** The steps that can be played (the item and the article exist). */
  steps: EncStep[]
  run: RoundState
  /** The question the pinned clue leads to (null once the run is over). */
  pick: NextQuestion | null
  /** Questions answered in this hunt, retries included. */
  answered: number
  /** Steps collected in this hunt (right answers, first try or retry). */
  collected: string[]
}

export interface HuntResult {
  huntId: string
  final: boolean
  stars: number
  accuracy: number
  collected: number
  total: number
  /** Titles of the units this hunt has just opened. */
  unlocked: string[]
}

/** An article with its texts in the edition being read. */
export interface ArtView {
  id: string
  title: string
  paragraphs: string[]
  unit?: string
  assetId?: string
  citations: string[]
  related: string[]
  virtual: boolean
}

const PARTS: Part[] = ['index', 'reader', 'timeline', 'map', 'codex', 'hunts']

/**
 * The encyclopedia explorer: one object holds the model of the course (articles, hunts, timeline, map), what the learner has found and read,
 * the hunt in progress and the trail of screens, and draws each screen. The learning logic is the kit's (`ask`, runs, stars, review queue);
 * what this shell adds is the world: browsing, the clue pinned on every page, the collect button on the target article.
 */
export class EncApp {
  readonly s: ShellSession<EncKey>
  model!: EncModel
  arts = new Map<string, ArtView>()
  data: EncData = emptyData()
  hunt: ActiveHunt | null = null
  result: HuntResult | null = null
  /** The text in the search box (kept when the learner comes back to the index). */
  query = ''
  /** The event shown in the timeline's detail line. */
  eventId: string | null = null
  /** Where `back` goes: the screens the learner came from, oldest first. */
  trail: (() => void)[] = []
  audio: HTMLAudioElement | null = null
  /** Undoes what the screen on show set up outside its DOM (a scroll listener, an observer); run before the next screen is drawn. */
  cleanup: (() => void)[] = []
  /** What the screen being built wants undone when the next one is drawn (moved to `cleanup` by `page`, which runs after the screen's body exists). */
  pendingCleanup: (() => void)[] = []
  private readonly titleState = newTitleState()
  private linkCache = new Map<string, string[]>()

  constructor(session: ShellSession<EncKey>) {
    this.s = session
    this.rebuild()
  }

  // ---- the course in this edition ----

  /** Builds the model and the article texts for the edition (again after a language switch). */
  rebuild(): void {
    this.model = buildEncyclopedia(this.s.pack, this.s.section<EncyclopediaSection>(), this.s.text)
    this.arts = new Map(
      this.model.articles.map((a: EncArticle) => [
        a.id,
        { id: a.id, title: this.s.t(a.titleKey), paragraphs: paragraphsOf(a.bodyKeys.map((k) => this.s.t(k))), ...(a.unit ? { unit: a.unit } : {}), ...(a.assetId ? { assetId: a.assetId } : {}), citations: a.citations, related: a.related, virtual: a.virtual }
      ])
    )
    this.linkCache = new Map()
    const section = this.s.section<EncyclopediaSection>()
    const glossKeys = new Set(Object.entries(section?.glossary ?? {}).flatMap(([a, es]) => es.map((e) => glossKey(a, e.id))))
    this.data = readData(this.s.shellData(), new Set(this.allSteps().map((x) => x.id)), new Set(this.model.articles.map((a) => a.id)), glossKeys)
  }

  allSteps(): EncStep[] {
    return this.model.hunts.flatMap((x) => x.steps)
  }

  /** A step can be played when its article and its item exist and the item can be shown. */
  validStep(step: EncStep): boolean {
    return this.arts.has(step.article) && this.s.canAsk(this.s.item(step.item))
  }

  stepsOf(hunt: EncHunt): EncStep[] {
    return hunt.steps.filter((x) => this.validStep(x))
  }

  finalSteps(): EncStep[] {
    return this.model.finalSteps.filter((x) => this.validStep(x))
  }

  articleList(): ArtView[] {
    return this.model.articles.map((a) => this.arts.get(a.id) as ArtView)
  }

  articleTexts(): ArticleText[] {
    return this.articleList().map((a) => ({ id: a.id, title: a.title, paragraphs: a.paragraphs }))
  }

  articleTitle(id: string): string {
    return this.arts.get(id)?.title ?? id
  }

  search(q: string): { id: string; snippet: string }[] {
    return searchArticles(q, this.articleTexts())
  }

  /** The body of an article as runs of text and links to the other articles. */
  segments(id: string): Seg[][] {
    const a = this.arts.get(id)
    if (!a) return []
    return linkify(a.paragraphs, id, this.articleList().map((x) => ({ id: x.id, title: x.title })))
  }

  /** The ids of the articles an article links to in its body. */
  linksFrom(id: string): string[] {
    let l = this.linkCache.get(id)
    if (!l) {
      l = linkedIds(this.segments(id))
      this.linkCache.set(id, l)
    }
    return l
  }

  /** How to reach `target` from another page: a cross-link in its body, or a "See also" entry. */
  via(target: string): { from: string; testid: string } | null {
    for (const a of this.articleList()) if (a.id !== target && this.linksFrom(a.id).includes(target)) return { from: a.id, testid: `link-${target}` }
    for (const a of this.articleList()) if (a.id !== target && a.related.includes(target)) return { from: a.id, testid: `related-${target}` }
    return null
  }

  // ---- the reader (B2 readings, EGS-35) ----

  /** The chapters of the reader: the real articles in unit order. */
  chapters(): ArtView[] {
    return readerChapters(this.s.pack, this.model.articles).map((a) => this.arts.get(a.id) as ArtView)
  }

  /** The reader is offered when the course has readings and either says so (`reader: true`) or glosses a text. */
  hasReader(): boolean {
    const section = this.s.section<EncyclopediaSection>()
    return this.chapters().length > 0 && (section?.reader === true || Object.values(section?.glossary ?? {}).some((es) => es.length > 0))
  }

  readerFirst(): boolean {
    return this.s.section<EncyclopediaSection>()?.reader === true && this.chapters().length > 0
  }

  /** The glossary of a text in the edition being read (terms from the target catalog, glosses from the edition). */
  glossWords(articleId: string): GlossWord[] {
    return glossaryOf(this.s.section<EncyclopediaSection>(), articleId).flatMap((e) => {
      const term = this.s.text.text(e.term)
      const gloss = this.s.text.text(e.gloss)
      if (term === undefined || gloss === undefined) return []
      const lemma = e.lemma ? this.s.text.text(e.lemma) : undefined
      const note = e.note ? this.s.text.text(e.note) : undefined
      return [{ id: e.id, term, gloss, ...(lemma ? { lemma } : {}), ...(e.pos ? { pos: e.pos } : {}), ...(note ? { note } : {}) }]
    })
  }

  glossOff(): Set<string> {
    return new Set(this.data.glossOff ?? [])
  }

  setGlossDeck(articleId: string, glossId: string, inDeck: boolean): void {
    this.data = withGlossDeck(this.data, glossKey(articleId, glossId), inDeck)
    this.saveData()
  }

  /** The chapter the reader opens on: the one it stood on, else the first. */
  readerChapter(): string {
    const chapters = this.chapters()
    const at = this.data.reader?.chapter
    return chapters.find((c) => c.id === at)?.id ?? (chapters[0]?.id as string)
  }

  /** The reader moved (`scroll` 0 to 1 down the chapter): remembered. */
  rememberReader(chapter: string, scroll: number): void {
    const next = withReaderAt(this.data, chapter, scroll)
    if (next === this.data) return
    this.data = next
    this.saveData()
  }

  chapterRead(chapter: string): boolean {
    return this.data.reader?.done.includes(chapter) === true
  }

  /** A chapter was read to its last paragraph. */
  markChapterRead(chapter: string): void {
    if (this.chapterRead(chapter)) return
    this.data = withChapterDone(withRead(this.data, chapter), chapter)
    this.saveData()
    document.querySelector('[data-testid="reader-progress"]')?.setAttribute('data-read', 'true')
    document.querySelector('[data-testid="reader-done"]')?.removeAttribute('hidden')
    document.querySelector(`[data-testid="reader-chapter-${chapter}"]`)?.setAttribute('data-read', 'true')
  }

  /** Questions of a chapter (the items whose `extensions.passage` names it). */
  chapterItems(chapter: string): string[] {
    return this.s.pack.items.filter((i) => passageOf(i)?.article === chapter && this.s.canAsk(i)).map((i) => i.id)
  }

  /** The questions on a text, one after the other, with the text open above each; the end (or Back) returns to the chapter. */
  practice(chapter: string): void {
    const ids = this.chapterItems(chapter)
    if (ids.length === 0) return
    this.s.passageOpen = true
    this.askPractice(this.s.startRun(ids, { kind: 'review' }), chapter, 0)
  }

  private askPractice(run: RoundState, chapter: string, index: number): void {
    const s = this.s
    const done = (): void => {
      s.passageOpen = false
      this.reader(chapter)
    }
    const pick = s.next(run)
    const item = pick ? s.item(pick.id) : undefined
    if (!pick || !item) return done()
    let current = run
    ask(s, {
      item,
      context: 'reader',
      retry: pick.retry,
      roundKind: 'review',
      roundSize: run.size,
      index,
      view: () => ({ ...this.baseView(), chapter }),
      leaveLabel: s.ui('reader.leave'),
      onLeave: done,
      onAnswered: (o) => {
        current = s.record(current, pick, o)
      },
      onNext: () => this.askPractice(current, chapter, index + 1)
    })
  }

  // ---- words of the hunts ----

  stepClue(step: EncStep): string {
    return step.clue ? this.s.t(step.clue) : this.s.s('enc.auto.clue', { title: this.articleTitle(step.article) })
  }

  collectibleName(step: EncStep): string {
    return step.collectible ? this.s.t(step.collectible) : this.s.s('enc.auto.name', { title: this.articleTitle(step.article) })
  }

  huntTitle(hunt: EncHunt): string {
    return hunt.title ? this.s.t(hunt.title) : this.s.s('enc.hunt.auto', { unit: this.s.unitTitle(hunt.unit) })
  }

  huntIntro(hunt: EncHunt): string {
    return hunt.intro ? this.s.t(hunt.intro) : hunt.auto ? this.s.s('enc.hunt.auto.intro') : ''
  }

  /** What a collectible taught: the item's did-you-know, else its explanation. */
  taught(step: EncStep): string {
    const item = this.s.item(step.item)
    if (!item) return ''
    if (item.didYouKnow && this.s.text.hasText(item.didYouKnow)) return this.s.t(item.didYouKnow)
    return this.s.text.text(item.explanation) ?? ''
  }

  /** The step the pinned clue is about, and its place in its hunt. */
  pinned(): { step: EncStep; n: number; total: number; retry: boolean } | null {
    const ah = this.hunt
    if (!ah || !ah.pick) return null
    const pick = ah.pick
    const step = ah.steps.find((x) => x.item === pick.id)
    if (!step) return null
    return { step, n: ah.steps.indexOf(step) + 1, total: ah.steps.length, retry: pick.retry }
  }

  found(step: EncStep): boolean {
    return this.data.found.includes(step.id)
  }

  statusCounts(): { found: number; total: number; stars: number; maxStars: number; read: number; articles: number } {
    const steps = this.allSteps().filter((x) => this.validStep(x))
    return { found: steps.filter((x) => this.found(x)).length, total: steps.length, stars: this.s.totalStars(), maxStars: this.s.pack.units.length * 3, read: this.data.read.length, articles: this.model.articles.length }
  }

  hasMap(): boolean {
    return !!this.model.map && !!this.s.data.assets[this.model.map.asset]
  }

  hasTimeline(): boolean {
    return this.model.timeline.length > 0
  }

  // ---- navigation ----

  private partAvailable(p: Part): boolean {
    return p === 'reader' ? this.hasReader() : p === 'timeline' ? this.hasTimeline() : p === 'map' ? this.hasMap() : true
  }

  /** The tabs: the title page, then the parts of the book (brass index tabs). */
  nav(active: Part | null): HTMLElement {
    const s = this.s
    const go: Record<Part, () => void> = { index: () => this.explore(), reader: () => this.reader(), timeline: () => this.timeline(), map: () => this.map(), codex: () => this.codex(), hunts: () => this.hunts() }
    return h(
      'nav',
      { class: 'enc-tabs', 'aria-label': s.s('enc.nav.label') },
      button('menu', s.s('enc.nav.title'), () => this.title(), { class: 'enc-tab enc-tab-title' }),
      PARTS.filter((p) => this.partAvailable(p)).map((p) =>
        button(
          `nav-${p}`,
          p === 'reader' ? s.ui('reader.nav') : s.s(`enc.nav.${p}` as EncKey),
          () => {
            this.trail = []
            go[p]()
          },
          { class: 'enc-tab', ...(p === active ? { 'aria-current': 'page' } : {}) }
        )
      )
    )
  }

  /** The frame every world screen shares: the tabs, the pinned clue, then the content. */
  private page(screen: string, part: Part | null, content: Child, view: Record<string, unknown> = {}): HTMLElement {
    this.stopAudio()
    for (const f of this.cleanup.splice(0)) f()
    this.cleanup = this.pendingCleanup.splice(0)
    const body = h('div', { class: `enc-page enc-page-${screen}`, 'data-part': part ?? '' }, this.nav(part), clueBar(this), content)
    return this.s.render(screen, body, { view: { ...this.baseView(), ...view } })
  }

  /** The JSON-safe state every screen publishes as `getState().view`. */
  baseView(): Record<string, unknown> {
    const c = this.statusCounts()
    const p = this.pinned()
    const ah = this.hunt
    return {
      found: [...this.data.found],
      read: [...this.data.read],
      counts: c,
      hunt: ah ? { id: ah.hunt.id, final: ah.final, step: p?.step.id ?? null, article: p?.step.article ?? null, item: ah.pick?.id ?? null, retry: p?.retry ?? false, answered: ah.answered, size: ah.steps.length, collected: [...ah.collected] } : null
    }
  }

  private saveData(): void {
    this.s.setShellData(this.data)
  }

  stopAudio(): void {
    if (this.audio) {
      this.audio.pause()
      this.audio = null
      this.s.audio.duck(false)
    }
  }

  // ---- screens ----

  title(): void {
    this.rebuild()
    this.s.finished = false
    this.trail = []
    this.s.render(
      'title',
      titleScreen(
        this.s,
        { startLabel: this.readerFirst() ? this.s.ui(this.data.reader ? 'reader.continue' : 'reader.open') : this.s.started ? this.s.s('enc.continue') : this.s.s('enc.open'), onStart: () => (this.readerFirst() ? this.reader() : this.explore()) },
        () => this.title(),
        this.titleState
      )
    )
  }

  explore(): void {
    this.s.finished = false
    this.page('explore', 'index', exploreBody(this), { query: this.query })
  }

  /** The reader: one chapter of the readings with tap-to-gloss, its glossary and the way on (`chapter` default: where the learner stood). */
  reader(chapter?: string): void {
    const chapters = this.chapters()
    if (chapters.length === 0) return this.explore()
    const id = chapters.some((c) => c.id === chapter) ? (chapter as string) : this.readerChapter()
    if (id !== this.data.reader?.chapter) this.rememberReader(id, 0)
    this.trail = []
    this.page('reader', 'reader', readerBody(this, id), { chapter: id })
  }

  article(id: string, from?: () => void): void {
    if (!this.arts.has(id)) return this.explore()
    if (from) this.trail.push(from)
    if (!this.data.read.includes(id)) {
      this.data = withRead(this.data, id)
      this.saveData()
    }
    this.page('article', null, articleScreenBody(this, id), { article: id })
  }

  /** `back` on an article: the screen the learner came from, else the index. */
  back(): void {
    const prev = this.trail.pop()
    if (prev) prev()
    else this.explore()
  }

  timeline(): void {
    this.page('timeline', 'timeline', timelineBody(this), { event: this.eventId })
  }

  map(): void {
    this.page('map', 'map', mapBody(this))
  }

  codex(): void {
    this.page('codex', 'codex', codexBody(this))
  }

  hunts(): void {
    const r = this.result
    this.page('hunts', 'hunts', huntsBody(this, r), { result: r })
    if (r) this.s.live(this.resultText(r))
  }

  resultText(r: HuntResult): string {
    const s = this.s
    if (r.final) return s.s('enc.res.final')
    const head = r.stars >= 2 ? s.s('enc.res.good', { n: r.collected, total: r.total }) : s.s('enc.res.more', { n: r.collected, total: r.total })
    return r.unlocked.length > 0 ? `${head} ${s.s('enc.res.unlocked', { units: r.unlocked.join(', ') })}` : head
  }

  end(): void {
    const s = this.s
    s.finish()
    const c = this.statusCounts()
    s.render(
      'end',
      endScreen(s, {
        title: s.s('enc.end.title'),
        sub: s.s('enc.end.sub'),
        stats: h('p', { class: 'enc-end-stats', testid: 'end-collected' }, s.s('enc.end.stats', { found: c.found, total: c.total, read: c.read, articles: c.articles })),
        onAgain: () => {
          this.hunt = null
          this.result = null
          this.explore()
        },
        onTitle: () => this.title()
      }),
      { view: this.baseView() }
    )
  }

  // ---- hunts ----

  isHuntOpen(hunt: EncHunt): boolean {
    return this.s.isUnlocked(hunt.unit) && this.stepsOf(hunt).length > 0
  }

  /** The grand hunt opens when every unit is mastered. */
  isFinalOpen(): boolean {
    return this.s.allMastered() && this.finalSteps().length > 0
  }

  startHunt(hunt: EncHunt, final = false): void {
    const steps = final ? this.finalSteps() : this.stepsOf(hunt)
    if (steps.length === 0) return
    const run = this.s.startRun(steps.map((x) => x.item), final ? { kind: 'boss' } : { kind: 'unit', unitId: hunt.unit })
    const pick = this.s.next(run)
    if (!pick) return
    this.hunt = { hunt, final, steps, run, pick, answered: 0, collected: [] }
    this.result = null
    this.trail = []
    this.explore()
  }

  /** The grand hunt: a boss run over the first and last step of every unit's hunts. */
  startFinal(): void {
    this.startHunt({ id: 'final', unit: '', steps: this.finalSteps(), auto: false }, true)
  }

  /** Puts the hunt aside (the collectibles stay; the stars come only from a finished hunt). */
  dropHunt(): void {
    this.hunt = null
    this.result = null
    this.hunts()
  }

  /** The collect button on the target article: asks the step's item. */
  collect(step: EncStep): void {
    const ah = this.hunt
    const pick = ah?.pick
    if (!ah || !pick || pick.id !== step.item) return
    const item = this.s.item(step.item)
    if (!item) return
    const name = this.collectibleName(step)
    const idx = ah.steps.indexOf(step) + 1
    const hadBefore = this.found(step)
    const hud = hudBar(this, ah, idx)
    ask(this.s, {
      item,
      context: 'hunt',
      retry: pick.retry,
      ...(ah.final ? { roundKind: 'boss' as const } : { roundKind: 'unit' as const, unitId: ah.hunt.unit }),
      roundSize: ah.run.size,
      index: ah.answered,
      hud,
      lead: h('span', {}, this.s.s('enc.lead', { name })),
      view: () => ({ ...this.baseView(), step: step.id, article: step.article }),
      nextLabel: this.s.s('enc.turn'),
      leaveLabel: this.s.s('enc.q.back'),
      onLeave: () => this.article(step.article),
      onAnswered: (o) => {
        ah.run = this.s.record(ah.run, pick, o)
        ah.answered += 1
        if (o.result.correct) {
          if (!ah.collected.includes(step.id)) ah.collected.push(step.id)
          this.data = withFound(this.data, step.id)
          this.saveData()
          // the brass pip of this step fills in (and the label of the strip follows)
          hud.querySelectorAll('.enc-hud-pip')[idx - 1]?.classList.add('is-found')
          hud.querySelector('.enc-hud-pips')?.setAttribute('aria-label', this.s.s('enc.hunt.found', { found: ah.collected.length, n: ah.steps.length }))
        }
      },
      effect: (o) => (o.result.correct ? { text: this.s.s(hadBefore ? 'enc.fx.again' : 'enc.fx.found', { name }), tone: 'good' } : { text: this.s.s('enc.fx.missed'), tone: 'bad' }),
      onNext: () => {
        ah.pick = this.s.next(ah.run)
        if (!ah.pick) this.finishHunt()
        else this.article(step.article)
      }
    })
  }

  /** The run is over: stars from its first-try accuracy, what it opened, back to the hunts. */
  private finishHunt(): void {
    const ah = this.hunt
    if (!ah) return this.hunts()
    const accuracy = this.s.accuracy(ah.run)
    const r = this.s.recordUnit(ah.final ? { boss: true } : { unitId: ah.hunt.unit }, accuracy)
    this.result = { huntId: ah.final ? 'final' : ah.hunt.id, final: ah.final, stars: r.stars, accuracy, collected: ah.collected.length, total: ah.steps.length, unlocked: r.unlocked.map((u) => this.s.unitTitle(u)) }
    this.hunt = null
    this.trail = []
    this.hunts()
  }

  // ---- bot helpers (read-only) ----

  debug(): Record<string, (...args: never[]) => unknown> {
    return {
      hunts: () => this.model.hunts.map((x) => ({ id: x.id, unit: x.unit, open: this.isHuntOpen(x), stars: this.s.unitStars(x.unit), steps: this.stepsOf(x).map((st) => ({ id: st.id, article: st.article, item: st.item })) })),
      finalHunt: () => ({ open: this.isFinalOpen(), steps: this.finalSteps().map((st) => ({ id: st.id, article: st.article, item: st.item })) }),
      target: () => {
        const p = this.pinned()
        if (!p) return null
        const via = this.via(p.step.article)
        return { hunt: this.hunt?.hunt.id ?? null, final: this.hunt?.final ?? false, step: p.step.id, article: p.step.article, item: p.step.item, retry: p.retry, clue: this.stepClue(p.step), term: searchTermFor(this.articleTexts().find((a) => a.id === p.step.article) as ArticleText, this.articleTexts()), via }
      },
      searchTerm: (id: string) => {
        const t = this.articleTexts()
        const a = t.find((x) => x.id === id)
        return a ? searchTermFor(a, t) : null
      },
      chapters: () => this.chapters().map((c) => ({ id: c.id, read: this.chapterRead(c.id), glosses: this.glossWords(c.id).map((g) => g.id), items: this.chapterItems(c.id) })),
      links: (id: string) => ({ links: this.linksFrom(id), related: this.arts.get(id)?.related ?? [] }),
      articles: () => this.model.articles.map((a) => a.id),
      timeline: () => this.model.timeline.map((e) => ({ id: e.id, year: e.year, article: e.article ?? null })),
      places: () => (this.model.map?.places ?? []).map((p) => ({ id: p.id, article: p.article })),
      codex: () => this.allSteps().filter((x) => this.validStep(x)).map((x) => ({ id: x.id, found: this.found(x) })),
      queue: () => [...this.s.progress.queue]
    }
  }
}

/** The shell: mounts the app on a session and removes it again. */
export function makeEncyclopediaShell(id: string, theme: string): Shell {
  let session: ShellSession<EncKey> | null = null
  let app: EncApp | null = null
  return {
    id,
    mount(host) {
      const s = new ShellSession<EncKey>(host, { shellId: id, theme, strings: ENC_STRINGS })
      session = s
      app = new EncApp(s)
      s.mount()
      s.setDebug(app.debug())
      app.title()
    },
    unmount() {
      app?.stopAudio()
      session?.unmount()
      session = null
      app = null
    }
  }
}

