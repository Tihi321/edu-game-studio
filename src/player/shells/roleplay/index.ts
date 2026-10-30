import '../../../design/themes/postcard.css'
import './roleplay.css'
import type { CourseItem } from '../../../shared/course'
import { roleplaySectionSchema, isReply, isSay, lineById, type RoleplaySection, type RpReplyLine, type RpSayLine, type RpScene } from '../../../shared/shells/roleplay'
import { button, h } from '../../dom'
import { ask } from '../../kit/question'
import { endScreen, languageName, newTitleState, titleScreen } from '../../kit/screens'
import { ShellSession } from '../../kit/session'
import type { RoundState } from '../../round'
import type { Shell, ShellHost } from '../../types'
import { bubble, levelChip, plantSvg, smallButton, stamp, type PortraitInput } from './art'
import { newlyOpen, sceneBoard, type SceneEntry } from './board'
import { accuracy as accuracyOf, answerTurn, hiddenLines, isDone, lastSay, replyText, reveal, skipTurn, startScene, stepOf, turnCount, type LogEntry, type SceneState } from './dialogue'
import { daysUntil, growth, metIn, plantsOf, stageCounts, stageOf, waterPool, type Plant, type Stage } from './garden'
import { RP_STRINGS, type RpKey } from './strings'

/**
 * The language role-play shell (EGS-13): title (CEFR stamp) -> scenes (a conversation per unit, the finale, the garden) -> scene (a
 * dialogue in the target language: speech bubbles, translate and play buttons; the learner's turns are questions) -> a turn asks
 * through `ask()` (context `line`) -> scene-done -> garden (a plant per word, grown by spaced repetition; `water` practises the due words,
 * context `garden`) -> finale (a conversation mixing every unit: the boss) -> end.
 * The learning logic is the kit's (`ShellSession`) plus the pure `dialogue.ts`, `garden.ts` and `board.ts`; the section is
 * `src/shared/shells/roleplay.ts`; the pictures are inline SVG (`art.ts`) dressed by `roleplay.css` and the postcard theme.
 */

const SHELL_ID = 'roleplay'
const THEME_ID = 'postcard'
/** At most this many words are watered in one go (a long garden is watered in several visits). */
const WATER_MAX = 8

type Session = ShellSession<RpKey>

interface Playing {
  scene: RpScene
  st: SceneState
  finale: boolean
}

interface Water {
  run: RoundState
  /** Fresh questions answered and the ones right the first time. */
  n: number
  right: number
}

interface RpData {
  /** Ids of the scenes finished at least once (their words are planted). */
  done: string[]
}

class Roleplay {
  private readonly session: Session
  private readonly section: RoleplaySection
  private playing: Playing | null = null
  private water: Water | null = null
  private finishedScene: Playing | null = null
  private audio: HTMLAudioElement | null = null
  private readonly titleState = newTitleState()

  constructor(private readonly host: ShellHost) {
    this.session = new ShellSession<RpKey>(host, { shellId: SHELL_ID, theme: THEME_ID, strings: RP_STRINGS })
    this.section = this.session.section<RoleplaySection>() ?? roleplaySectionSchema.parse({})
  }

  private get s(): Session['s'] {
    return this.session.s
  }

  mount(): void {
    const ses = this.session
    ses.mount()
    ses.setDebug({
      scenes: () => this.board().map((e) => ({ id: e.scene.id, unit: e.unit ?? null, finale: e.finale, locked: e.locked, stars: e.stars, turns: e.turns, done: this.doneScenes().includes(e.scene.id) })),
      scene: () => this.sceneView(),
      garden: () => this.gardenView(null)
    })
    this.title()
  }

  unmount(): void {
    this.stopAudio()
    this.session.unmount()
  }

  // ---- data ----

  private get targetLang(): string | undefined {
    return this.session.pack.targetLang
  }

  /** The scene ids finished at least once (validated: the shell's data may come from an imported file). */
  private doneScenes(): string[] {
    const d = this.session.shellData<Partial<RpData>>()
    const ids = new Set(this.section.scenes.map((s) => s.id))
    return Array.isArray(d?.done) ? (d.done as unknown[]).filter((x): x is string => typeof x === 'string' && ids.has(x)) : []
  }

  private markDone(sceneId: string): void {
    const done = this.doneScenes()
    if (!done.includes(sceneId)) this.session.setShellData({ done: [...done, sceneId] } satisfies RpData)
  }

  private doneUnits(): string[] {
    const done = new Set(this.doneScenes())
    return this.section.scenes.filter((s) => done.has(s.id) && s.unit).map((s) => s.unit as string)
  }

  private board(): SceneEntry[] {
    const ses = this.session
    return sceneBoard({ section: this.section, pack: ses.pack, mastered: (u) => ses.isMastered(u), unitStars: (u) => ses.unitStars(u), bossStars: ses.bossStars() })
  }

  private plants(): Plant[] {
    const ses = this.session
    return plantsOf({ section: this.section, pack: ses.pack, cards: ses.progress.cards, queue: ses.progress.queue, doneUnits: this.doneUnits(), now: Date.now() })
  }

  private wordsOfItem(itemId: string): Plant['word'][] {
    return this.section.garden.filter((w) => w.item === itemId)
  }

  private stageOfItem(itemId: string): Stage {
    const ses = this.session
    return stageOf(ses.progress.cards[itemId], ses.progress.queue.includes(itemId))
  }

  private stageName(stage: Stage): string {
    return this.s(`rp.stage.${stage}` as RpKey)
  }

  private who(id: string | undefined): PortraitInput {
    const ses = this.session
    const speakers = this.section.speakers
    const at = speakers.findIndex((x) => x.id === id)
    const sp = speakers[at]
    if (!sp) return { name: id ?? this.s('rp.you'), index: 0 }
    const url = sp.portrait ? ses.data.assets[sp.portrait] : undefined
    return { name: ses.t(sp.name), index: at, ...(url ? { url } : {}) }
  }

  private learner(): PortraitInput {
    const at = this.section.speakers.findIndex((x) => x.learner)
    return at >= 0 ? this.who(this.section.speakers[at]?.id) : { name: this.s('rp.you'), index: 5 }
  }

  /** The speaker who said the last line to the learner (who helps after a miss), else the first speaker who is not the learner. */
  private helperOf(st: Pick<SceneState, 'log'>): string | undefined {
    return lastSay(st)?.speaker ?? this.section.speakers.find((x) => !x.learner)?.id
  }

  private audioUrl(line: RpSayLine): string | undefined {
    return line.audio ? this.session.data.assets[line.audio] : undefined
  }

  private playUrl(url: string): void {
    this.stopAudio()
    try {
      const a = new Audio(url)
      this.audio = a
      void a.play().catch(() => undefined)
    } catch {
      /* a sound is never worth an error */
    }
  }

  private stopAudio(): void {
    try {
      this.audio?.pause()
    } catch {
      /* ignore */
    }
    this.audio = null
  }

  // ---- bubbles ----

  /** One line somebody says: the words in the target language, a translate button (hidden by default) and a play button when the line has a clip. */
  private sayBubble(line: RpSayLine, o: { testid: string; kind: 'say' | 'hud'; hidden: boolean; noPlay?: boolean }): HTMLElement {
    const ses = this.session
    const s = this.s
    // a listen line that is still hidden has no translation: it would give the answer away
    const tr = !o.hidden && line.translation && ses.text.hasText(line.translation) ? ses.text.t(line.translation) : null
    const trBox = tr ? h('p', { class: 'pc-translation', testid: `translation-${line.id}`, hidden: true, lang: ses.lang }, tr) : null
    const trBtn = tr
      ? smallButton(`translate-${line.id}`, s('rp.translate'), () => {
          const open = trBox?.hidden === true
          if (trBox) trBox.hidden = !open
          trBtn?.setAttribute('aria-expanded', String(open))
          if (trBtn) trBtn.textContent = open ? s('rp.translate.hide') : s('rp.translate')
        }, { 'aria-expanded': 'false' })
      : null
    const url = this.audioUrl(line)
    const play = url && !o.noPlay ? smallButton(`line-play-${line.id}`, `▶ ${s('rp.play')}`, () => this.playUrl(url)) : null
    return bubble({
      testid: o.testid,
      kind: o.kind,
      speaker: this.who(line.say),
      text: o.hidden ? null : ses.text.t(line.text),
      ...(this.targetLang ? { lang: this.targetLang } : {}),
      hidden: s('rp.hidden'),
      actions: [trBtn, play],
      extra: trBox
    })
  }

  /** The log of a scene as bubbles: what was said, what the learner answered, the speaker's recovery lines. */
  private logBubbles(sc: RpScene, st: SceneState): HTMLElement[] {
    const ses = this.session
    const s = this.s
    const hidden = hiddenLines(sc, st, (a) => !!ses.data.assets[a])
    const out: HTMLElement[] = []
    let prev: RpSayLine | undefined
    for (const e of st.log) {
      if (e.kind === 'say') {
        const line = lineById(sc, e.lineId)
        if (!line || !isSay(line)) continue
        prev = line
        out.push(this.sayBubble(line, { testid: `line-${line.id}`, kind: 'say', hidden: hidden.has(line.id) }))
      } else if (e.kind === 'you') {
        if (e.text === null) continue
        out.push(
          bubble({
            testid: `you-${e.lineId}`,
            kind: 'you',
            speaker: this.learner(),
            text: e.text,
            ...(this.targetLang ? { lang: this.targetLang } : {}),
            outcome: e.outcome,
            lead: e.outcome === 'shown' ? s('rp.model') : null,
            note: e.outcome === 'shown' ? s('rp.model.shown') : null
          })
        )
      } else out.push(this.helpBubble(sc, e, prev, hidden))
    }
    return out
  }

  /** The speaker says the last line again, slowly, with the hint of the turn (a `help` note of the section). */
  private helpBubble(sc: RpScene, e: Extract<LogEntry, { kind: 'help' }>, prev: RpSayLine | undefined, hidden: Set<string>): HTMLElement {
    const ses = this.session
    const s = this.s
    const reply = lineById(sc, e.lineId)
    const helpKey = reply && isReply(reply) ? reply.help : undefined
    const note = helpKey && ses.text.hasText(helpKey) ? ses.text.t(helpKey) : null
    const who = this.who(e.speaker)
    const show = !!prev && !hidden.has(prev.id)
    return bubble({
      testid: `help-${e.lineId}-${e.attempt}`,
      kind: 'help',
      speaker: who,
      slow: true,
      lead: prev ? s(e.attempt >= 2 ? 'rp.again.second' : 'rp.again', { name: who.name }) : s('rp.again.plain'),
      text: prev && show ? ses.text.t(prev.text) : null,
      ...(this.targetLang ? { lang: this.targetLang } : {}),
      hidden: s('rp.hidden'),
      note
    })
  }

  // ---- views (the JSON of getState().view) ----

  private sceneView(): Record<string, unknown> | null {
    const p = this.playing
    if (!p) return null
    const step = stepOf(p.scene, p.st)
    return {
      scene: p.scene.id,
      unit: p.scene.unit ?? null,
      finale: p.finale,
      step: step.type,
      line: step.type === 'done' ? null : step.line.id,
      retry: step.type === 'turn' ? step.retry : false,
      tries: step.type === 'turn' ? step.tries : 0,
      said: p.st.log.filter((e) => e.kind === 'say').length,
      turns: turnCount(p.scene),
      answered: p.st.turns.length,
      helped: p.st.log.filter((e) => e.kind === 'help').length,
      shown: p.st.turns.filter((t) => t.shown).length,
      hidden: [...hiddenLines(p.scene, p.st, (a) => !!this.session.data.assets[a])]
    }
  }

  private gardenView(result: { right: number; n: number } | null): Record<string, unknown> {
    const plants = this.plants()
    return {
      plants: plants.filter((p) => p.planted).map((p) => ({ id: p.word.id, item: p.word.item, stage: p.stage, due: p.due })),
      counts: stageCounts(plants),
      packet: plants.filter((p) => !p.planted).length,
      pool: waterPool(plants).length,
      result
    }
  }

  // ---- title ----

  private title(): void {
    const ses = this.session
    const s = this.s
    ses.finished = false
    this.playing = null
    this.water = null
    const level = ses.pack.cefr
    const lang = this.targetLang ? languageName(this.targetLang) : ''
    const art = h(
      'div',
      { class: 'pc-title-art' },
      level ? stamp(level, lang, `${s('rp.title.level', { level })}${lang ? `, ${lang}` : ''}`) : null,
      h('p', { class: 'pc-intro' }, s('rp.title.about'))
    )
    ses.render('title', titleScreen(ses, { tagline: s('rp.tagline'), art, onStart: () => this.scenes() }, () => this.title(), this.titleState), { view: { cefr: level ?? null, target: this.targetLang ?? null, scenes: this.section.scenes.length } })
  }

  // ---- the scene list ----

  private scenes(): void {
    const ses = this.session
    const s = this.s
    ses.finished = false
    this.playing = null
    this.water = null
    this.stopAudio()
    const board = this.board()
    const total = ses.pack.units.length
    const stars = ses.totalStars()
    const finale = board.find((e) => e.finale)
    const crowned = finale ? ses.bossStars() >= 1 : ses.allMastered()
    const planted = this.plants().filter((p) => p.planted).length
    const card = (e: SceneEntry): HTMLElement => {
      const sc = e.scene
      const level = sc.cefr ?? ses.pack.cefr
      const needNames = e.needs.map((u) => ses.unitTitle(u)).join(', ')
      return h(
        'li',
        { class: 'pc-scene-item' },
        h(
          'button',
          {
            type: 'button',
            class: `pc-scene ${e.locked ? 'is-locked' : 'is-open'}${e.finale ? ' is-finale' : ''}${e.stars >= 2 ? ' is-mastered' : ''}`,
            testid: `scene-${sc.id}`,
            'data-stars': String(e.stars),
            'data-locked': String(e.locked),
            'data-finale': String(e.finale),
            ...(e.unit ? { 'data-unit': e.unit } : {}),
            ...(e.locked ? { disabled: true } : {}),
            onclick: () => this.openScene(e)
          },
          h('span', { class: 'pc-scene-kicker' }, e.finale ? s('rp.scenes.finale') : ses.unitTitle(e.unit)),
          h('span', { class: 'pc-scene-name' }, ses.t(sc.title)),
          sc.setting ? h('span', { class: 'pc-scene-setting' }, ses.t(sc.setting)) : null,
          h(
            'span',
            { class: 'pc-scene-meta' },
            level ? levelChip(level) : null,
            h('span', {}, s('rp.scene.turns', { n: e.turns })),
            e.locked ? h('span', { class: 'pc-lock' }, `${e.finale ? s('rp.scenes.finale.locked') : s('rp.scenes.locked')}${needNames ? ` (${needNames})` : ''}`) : null
          ),
          ses.stars(e.stars)
        )
      )
    }
    const body = h(
      'section',
      { class: 'scenes-screen pc-scenes' },
      h(
        'div',
        { class: 'topbar' },
        button('menu', `‹ ${ses.ui('menu')}`, () => this.title(), { class: 'btn btn-small btn-ghost' }),
        h('span', { class: 'topbar-stars', testid: 'scenes-stars' }, s('rp.scenes.stars', { n: stars, total: total * 3 })),
        button('to-garden', `🌱 ${s('rp.scenes.garden')} (${planted})`, () => this.garden(), { class: 'btn btn-small' })
      ),
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'scenes-title' }, s('rp.scenes.title')),
      h('p', { class: 'subject' }, s('rp.scenes.sub')),
      board.length === 0 ? h('p', { class: 'message message-bad', testid: 'scenes-empty' }, s('rp.garden.empty')) : null,
      h('ol', { class: 'pc-scene-list', testid: 'scene-list' }, board.map(card)),
      crowned ? h('div', { class: 'actions actions-center' }, button('finish', s('rp.done.finish'), () => this.end(), { class: 'btn btn-primary btn-big' })) : null
    )
    ses.render('scenes', body, { view: { scenes: board.map((e) => ({ id: e.scene.id, unit: e.unit ?? null, finale: e.finale, locked: e.locked, stars: e.stars })), finaleOpen: finale ? !finale.locked : false, crowned, planted } })
  }

  private openScene(e: SceneEntry): void {
    if (e.locked) return
    const cur = this.playing
    // the scene being played is resumed; any other starts fresh
    this.playing = cur && cur.scene.id === e.scene.id ? cur : { scene: e.scene, st: startScene(e.scene), finale: e.finale }
    this.scene()
  }

  // ---- a scene: the dialogue ----

  private scene(): void {
    const ses = this.session
    const s = this.s
    const p = this.playing
    if (!p) return this.scenes()
    const { scene: sc, st } = p
    const step = stepOf(sc, st)
    const bubbles = this.logBubbles(sc, st)
    const level = sc.cefr ?? ses.pack.cefr
    const action =
      step.type === 'say'
        ? button('scene-next', s('rp.next'), () => this.nextLine(), { class: 'btn btn-primary btn-big', 'data-autofocus': '' })
        : step.type === 'turn'
          ? button('scene-reply', step.retry ? s('rp.retry') : s('rp.turn'), () => this.askTurn(), { class: 'btn btn-primary btn-big', 'data-autofocus': '' })
          : button('scene-finish', s('rp.finish'), () => this.sceneDone(), { class: 'btn btn-primary btn-big', 'data-autofocus': '' })
    const body = h(
      'section',
      { class: 'scene-screen pc-scene-screen' },
      h(
        'div',
        { class: 'topbar' },
        button('to-scenes', `‹ ${s('rp.scene.back')}`, () => {
          this.stopAudio()
          this.scenes()
        }, { class: 'btn btn-small btn-ghost' }),
        level ? levelChip(level) : null
      ),
      h('h1', { class: 'screen-title pc-scene-title', tabindex: '-1', testid: 'scene-title' }, ses.t(sc.title)),
      sc.setting ? h('p', { class: 'pc-setting', testid: 'scene-setting' }, h('b', {}, `${s('rp.scene.setting')}: `), ses.t(sc.setting)) : null,
      h('h2', { class: 'sr-only' }, s('rp.log')),
      bubbles.length > 0 ? h('ol', { class: 'pc-log', testid: 'scene-log' }, bubbles) : null,
      h('div', { class: 'pc-actionbar actions actions-center' }, action)
    )
    ses.render('scene', body, { ...(sc.unit ? { unitId: sc.unit } : {}), view: this.sceneView() ?? {} }, { focus: false })
    const last = st.log[st.log.length - 1]
    if (last && last.kind === 'say') {
      const line = lineById(sc, last.lineId)
      if (line && isSay(line)) ses.live(`${this.who(line.say).name}: ${ses.text.t(line.text)}`)
    }
    action.focus({ preventScroll: bubbles.length > 0 ? false : true })
    if (bubbles.length === 0) window.scrollTo(0, 0)
  }

  private nextLine(): void {
    const p = this.playing
    if (!p) return
    p.st = reveal(p.scene, p.st)
    this.scene()
  }

  // ---- a turn: the learner answers ----

  private askTurn(): void {
    const ses = this.session
    const s = this.s
    const p = this.playing
    if (!p) return this.scenes()
    const sc = p.scene
    const step = stepOf(sc, p.st)
    if (step.type !== 'turn') return this.scene()
    const line: RpReplyLine = step.line
    const item = ses.item(line.reply)
    if (!ses.canAsk(item)) {
      // nothing can be shown for this turn (no renderer): the talk goes on, nobody is stuck
      p.st = skipTurn(sc, p.st)
      return this.afterTurn()
    }
    const before = this.stageOfItem(item.id)
    const helperId = this.helperOf(p.st)
    const helper = this.who(helperId).name
    const prev = lastSay(p.st)
    const prevLine = prev ? lineById(sc, prev.lineId) : undefined
    const hiddenNow = !!prevLine && isSay(prevLine) && hiddenLines(sc, p.st, (a) => !!ses.data.assets[a]).has(prevLine.id)
    let heard: HTMLElement | null = null
    if (prevLine && isSay(prevLine)) heard = this.sayBubble(prevLine, { testid: 'hud-last', kind: 'hud', hidden: hiddenNow, noPlay: hiddenNow && item.kind === 'listening' })
    const helpKey = line.help && ses.text.hasText(line.help) ? ses.text.t(line.help) : null
    const hud = h(
      'div',
      { class: 'pc-hud' },
      h('p', { class: 'pc-hud-label' }, prevLine ? s('rp.hud.last') : s('rp.scene.setting')),
      heard
        ? h('ul', { class: 'pc-log pc-log-hud' }, heard)
        : h('p', { class: 'pc-setting', testid: 'hud-setting' }, sc.setting ? ses.t(sc.setting) : ses.t(sc.title)),
      step.retry && helpKey ? h('p', { class: 'pc-hud-help', testid: 'hud-help' }, h('b', {}, `${s(step.tries >= 2 ? 'rp.again.second' : 'rp.again', { name: helper })} `), helpKey) : null
    )
    const turnNo = p.st.turns.length + (step.retry ? 0 : 1)
    ask(ses, {
      item,
      context: 'line',
      retry: step.retry,
      hud,
      lead: h('span', {}, s('rp.lead', { i: Math.min(turnNo, turnCount(sc)), n: turnCount(sc) })),
      ...(sc.unit && !p.finale ? { unitId: sc.unit } : {}),
      roundKind: p.finale ? 'boss' : 'unit',
      roundSize: turnCount(sc),
      index: Math.max(0, p.st.turns.length - (step.retry ? 1 : 0)),
      view: () => this.sceneView() ?? {},
      leaveLabel: s('rp.scene.back'),
      onLeave: () => this.scene(),
      onAnswered: (o) => {
        const text = replyText(item, line, ses.text)
        p.st = answerTurn(sc, p.st, { correct: o.result.correct, score: o.result.score, text })
        // a listen line shows its words now that the learner has answered
        if (hiddenNow && prevLine && isSay(prevLine) && heard) {
          const t = heard.querySelector('.pc-text')
          if (t) {
            t.textContent = ses.text.t(prevLine.text)
            t.classList.remove('pc-hidden-text')
            if (this.targetLang) t.setAttribute('lang', this.targetLang)
          }
        }
      },
      effect: (o) => {
        const st = p.st
        const missed = !o.result.correct
        const base = !missed ? s('rp.effect.right', { name: helper }) : st.retry ? s('rp.effect.wrong', { name: helper }) : s('rp.effect.shown', { name: helper })
        const plant = this.plantNote(item.id, before)
        return { text: plant ? `${base} ${plant}` : base, tone: !missed ? 'good' : st.retry ? 'bad' : 'info' }
      },
      nextLabel: (o) => (o.result.correct || !p.st.retry ? s('rp.cont') : s('rp.retry')),
      onNext: () => this.afterTurn()
    })
  }

  private afterTurn(): void {
    const p = this.playing
    if (!p) return this.scenes()
    if (isDone(p.scene, p.st)) return this.sceneDone()
    this.scene()
  }

  /** What the answer did to the plant of the item's word, as a sentence (empty when the item has no plant). */
  private plantNote(itemId: string, before: Stage): string {
    const word = this.wordsOfItem(itemId)[0]
    if (!word) return ''
    const s = this.s
    const text = this.session.text.t(word.text)
    const after = this.stageOfItem(itemId)
    const g = growth(before, after)
    if (g === 'wilted') return s('rp.effect.wilted', { word: text })
    if (g === 'grew') return before === 'seed' ? s('rp.effect.planted', { word: text }) : s('rp.effect.grew', { word: text, from: this.stageName(before), to: this.stageName(after) })
    return s('rp.effect.same', { word: text, stage: this.stageName(after) })
  }

  // ---- a scene is done ----

  private sceneDone(): void {
    const ses = this.session
    const s = this.s
    const p = this.playing
    if (!p) return this.scenes()
    const sc = p.scene
    const boardBefore = this.board()
    const accuracy = accuracyOf(p.st)
    const result = p.finale ? ses.recordUnit({ boss: true }, accuracy) : sc.unit ? ses.recordUnit({ unitId: sc.unit }, accuracy) : { stars: 0, unlocked: [] as string[] }
    const stars = result.stars
    this.markDone(sc.id)
    ses.playCue(p.finale ? 'boss' : 'unit-complete')
    const opened = newlyOpen(boardBefore, this.board()).map((id) => ses.t(sc.id === id ? sc.title : (this.section.scenes.find((x) => x.id === id)?.title ?? id)))
    const itemIds = new Set(p.st.turns.map((t) => t.itemId))
    const words = this.plants().filter((pl) => itemIds.has(pl.word.item))
    const pct = Math.round(accuracy * 100)
    const passed = p.finale ? stars >= 1 : stars >= 2
    this.stopAudio()
    const body = h(
      'section',
      { class: `scenedone-screen pc-done ${passed ? 'is-passed' : 'is-again'}` },
      h('p', { class: 'eyebrow' }, ses.t(sc.title)),
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'done-title' }, p.finale ? s('rp.done.finale') : s('rp.done.title')),
      ses.stars(stars, 'scene-stars'),
      h('p', { class: 'big-number', testid: 'scene-accuracy' }, s('rp.done.accuracy', { n: pct })),
      h(
        'div',
        { class: 'pc-words' },
        h('h2', {}, s('rp.done.words')),
        words.length > 0
          ? h(
              'ul',
              { class: 'pc-word-list', testid: 'scene-words' },
              words.map((pl) =>
                h(
                  'li',
                  { class: `pc-word stage-${pl.stage}`, testid: `word-${pl.word.id}`, 'data-stage': pl.stage },
                  h('b', { class: 'pc-word-text', ...(this.targetLang ? { lang: this.targetLang } : {}) }, ses.text.t(pl.word.text)),
                  h('span', { class: 'pc-word-gloss' }, ses.t(pl.word.gloss)),
                  h('span', { class: 'pc-stage-chip' }, this.stageName(pl.stage))
                )
              )
            )
          : h('p', { class: 'pc-none' }, s('rp.done.nowords'))
      ),
      opened.length > 0 ? h('p', { class: 'message message-ok', testid: 'scene-unlocked' }, s('rp.done.unlocked', { scenes: opened.join(', ') })) : null,
      !passed ? h('p', { class: 'message message-bad', testid: p.finale ? 'finale-retry' : 'scene-need' }, p.finale ? s('rp.done.boss.fail') : s('rp.done.need')) : null,
      h(
        'div',
        { class: 'actions actions-center' },
        p.finale && passed ? button('finish', s('rp.done.finish'), () => this.end(), { class: 'btn btn-primary btn-big' }) : null,
        button('to-scenes', s('rp.scene.back'), () => this.scenes(), { class: passed && !p.finale ? 'btn btn-primary btn-big' : 'btn btn-big' }),
        stars < 3 ? button('replay-scene', s('rp.done.replay'), () => this.replay(), { class: passed ? 'btn btn-big' : 'btn btn-primary btn-big' }) : null,
        button('to-garden', s('rp.done.garden'), () => this.garden(), { class: 'btn btn-big' })
      )
    )
    const keep = { scene: sc.id, finale: p.finale, stars, accuracy: pct, passed, unlocked: result.unlocked, opened, words: words.map((pl) => ({ id: pl.word.id, stage: pl.stage })), helped: p.st.log.filter((e) => e.kind === 'help').length, shown: p.st.turns.filter((t) => t.shown).length }
    this.finishedScene = p
    ses.render('scene-done', body, { ...(sc.unit && !p.finale ? { unitId: sc.unit } : {}), view: keep })
    this.playing = null
  }

  private replay(): void {
    const p = this.finishedScene
    if (!p) return this.scenes()
    this.playing = { scene: p.scene, st: startScene(p.scene), finale: p.finale }
    this.scene()
  }

  // ---- the garden ----

  private garden(result: { right: number; n: number } | null = null): void {
    const ses = this.session
    const s = this.s
    this.playing = null
    this.water = null
    this.stopAudio()
    const plants = this.plants()
    const planted = plants.filter((p) => p.planted)
    const counts = stageCounts(plants)
    const pool = waterPool(plants)
    const finished = new Set(this.doneScenes())
    const now = Date.now()
    const resolve = (key: string): string => ses.text.t(key)
    const card = (pl: Plant): HTMLElement => {
      const met = metIn(this.section, pl.word, resolve, finished)
      const metScene = met ? this.section.scenes.find((x) => x.id === met.sceneId) : undefined
      const metText = met && metScene ? s(met.how === 'heard' ? 'rp.garden.met' : 'rp.garden.used', { scene: ses.t(metScene.title), name: this.who(met.speaker).name, line: resolve(met.text) }) : null
      const days = daysUntil(pl, now)
      const when = days === null || days === 0 ? s('rp.garden.next.due') : days === 1 ? s('rp.garden.next.day') : s('rp.garden.next.days', { n: days })
      return h(
        'li',
        { class: `pc-plant-card stage-${pl.stage}${pl.due ? ' is-due' : ''}`, testid: `plant-${pl.word.id}`, 'data-stage': pl.stage, 'data-due': String(pl.due), 'data-item': pl.word.item },
        h('div', { class: 'pc-plant-pic' }, plantSvg(pl.stage)),
        h(
          'div',
          { class: 'pc-plant-body' },
          h('p', { class: 'pc-plant-word', ...(this.targetLang ? { lang: this.targetLang } : {}) }, resolve(pl.word.text)),
          h('p', { class: 'pc-plant-gloss' }, ses.t(pl.word.gloss)),
          h('p', { class: 'pc-plant-stage' }, h('span', { class: 'pc-stage-chip' }, this.stageName(pl.stage)), ' ', h('span', { class: 'sr-only' }, s('rp.stage.label', { stage: this.stageName(pl.stage) }))),
          metText ? h('p', { class: 'pc-plant-met' }, metText) : null,
          h('p', { class: 'pc-plant-next' }, s('rp.garden.next', { when }))
        )
      )
    }
    const packet = plants.length - planted.length
    const body = h(
      'section',
      { class: 'garden-screen pc-garden' },
      h(
        'div',
        { class: 'topbar' },
        button('to-scenes', `‹ ${s('rp.garden.back')}`, () => this.scenes(), { class: 'btn btn-small btn-ghost' }),
        h('span', { class: 'topbar-stars', testid: 'garden-planted' }, s('rp.garden.planted', { n: planted.length, total: plants.length }))
      ),
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'garden-title' }, s('rp.garden.title')),
      h('p', { class: 'subject' }, s('rp.garden.sub')),
      planted.length > 0 ? h('p', { class: 'pc-garden-stats', testid: 'garden-stats' }, s('rp.garden.stats', counts)) : h('p', { class: 'message', testid: 'garden-empty' }, s('rp.garden.empty')),
      result ? h('p', { class: 'message message-ok', role: 'status', testid: 'water-result' }, s('rp.water.done', { right: result.right, n: result.n })) : null,
      h(
        'div',
        { class: 'actions actions-center' },
        pool.length > 0
          ? button('water', `💧 ${s('rp.water', { n: Math.min(pool.length, WATER_MAX) })}`, () => this.startWater(), { class: 'btn btn-primary btn-big', 'data-autofocus': '' })
          : h('p', { class: 'message', testid: 'water-empty' }, planted.length > 0 ? s('rp.water.empty') : s('rp.water.none'))
      ),
      planted.length > 0 ? h('ul', { class: 'pc-plant-list', testid: 'plant-list' }, planted.map(card)) : null,
      packet > 0 ? h('p', { class: 'pc-packet', testid: 'garden-packet' }, s('rp.garden.packet', { n: packet })) : null
    )
    ses.render('garden', body, { view: this.gardenView(result) })
  }

  private startWater(): void {
    const ses = this.session
    const pool = waterPool(this.plants())
    if (pool.length === 0) return this.garden()
    const size = Math.min(pool.length, WATER_MAX)
    this.water = { run: ses.startRun(pool, { kind: 'review', size }), n: 0, right: 0 }
    this.waterStep()
  }

  private waterStep(): void {
    const ses = this.session
    const s = this.s
    const w = this.water
    if (!w) return this.garden()
    const pick = ses.next(w.run)
    if (!pick) {
      const result = { right: w.right, n: w.n }
      this.water = null
      return this.garden(result)
    }
    const item = ses.item(pick.id) as CourseItem
    const before = this.stageOfItem(item.id)
    const word = this.wordsOfItem(item.id)[0]
    const hud = h(
      'div',
      { class: 'pc-hud pc-hud-plant' },
      h('div', { class: 'pc-hud-pot', 'aria-hidden': 'true' }, plantSvg(before)),
      h('div', { class: 'pc-hud-text' }, h('p', { class: 'pc-hud-label' }, s('rp.hud.plant')), h('p', { class: 'pc-hud-stage', testid: 'hud-stage' }, this.stageName(before)))
    )
    ask(ses, {
      item,
      context: 'garden',
      retry: pick.retry,
      hud,
      lead: h('span', {}, s('rp.water.lead', { i: Math.min(w.run.asked.length + (pick.retry ? 0 : 1), w.run.size), n: w.run.size })),
      roundKind: 'review',
      roundSize: w.run.size,
      index: w.run.results.length,
      view: () => ({ ...this.gardenView(null), word: word?.id ?? null, stage: before }),
      leaveLabel: s('rp.garden.back'),
      onLeave: () => this.garden(),
      onAnswered: (o) => {
        w.run = ses.record(w.run, pick, o)
        if (!pick.retry) {
          w.n += 1
          if (o.result.correct) w.right += 1
        }
      },
      effect: (o) => {
        const note = this.plantNote(item.id, before)
        if (!note) return null
        return { text: note, tone: o.result.correct ? 'good' : 'bad' }
      },
      nextLabel: s('rp.next'),
      onNext: () => this.waterStep()
    })
  }

  // ---- the end ----

  private end(): void {
    const ses = this.session
    const s = this.s
    ses.finish()
    this.playing = null
    const plants = this.plants()
    const counts = stageCounts(plants)
    ses.render(
      'end',
      endScreen(ses, {
        title: s('rp.end.title'),
        sub: s('rp.end.sub'),
        stats: h('p', { class: 'subject', testid: 'end-words' }, s('rp.end.words', { n: plants.filter((p) => p.planted).length, bloom: counts.bloom })),
        onAgain: () => this.scenes(),
        onTitle: () => this.title()
      }),
      { view: { words: plants.filter((p) => p.planted).length, bloom: counts.bloom, scenes: this.board().length } }
    )
  }
}

export const roleplayShell: Shell = (() => {
  let game: Roleplay | null = null
  return {
    id: SHELL_ID,
    mount(host: ShellHost) {
      game = new Roleplay(host)
      game.mount()
    },
    unmount() {
      game?.unmount()
      game = null
    }
  }
})()
