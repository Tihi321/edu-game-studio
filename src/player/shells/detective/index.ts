import '../../../design/themes/noir.css'
import './detective.css'
import { cellItems } from '../../../shared/puzzles'
import type { CourseItem } from '../../../shared/course'
import { chaseEnd, caseParams, finalRoom, type ChaseSection, type DetectiveSection, type RoomSection } from '../../../shared/shells/detective'
import {
  accusationKeys,
  accusationOf,
  buildCase,
  checkAccuse,
  crossOut,
  cycle,
  hintFor,
  markOf,
  phrase,
  renderClue,
  yesCells,
  yesPairs,
  type BuiltCase,
  type MarkValue,
  type Namer,
  type Puzzle
} from '../../../shared/shells/detective-case'
import { button, h } from '../../dom'
import { ask } from '../../kit/question'
import { endScreen, newTitleState, titleScreen } from '../../kit/screens'
import { ShellSession } from '../../kit/session'
import type { Shell, ShellHost } from '../../types'
import { doorSvg, magnifierSvg } from './art'
import { corkBoard, type Cork } from './board'
import { gridView } from './grid'
import { chaseMap } from './map'
import {
  afterAnswer,
  caseAccuracy,
  chaseAccuracy,
  clockText,
  faceDown,
  heard,
  judge,
  newCase,
  newChase,
  poolOf,
  travel,
  turned,
  turnedIds,
  type CaseState,
  type ChaseState
} from './model'
import { STRINGS, type DetKey } from './strings'

/**
 * The detective shell (EGS-14), inspired by Murdle and Carmen Sandiego: title -> office (the case board: an escape room per unit with a
 * locked door, the final room, the chase) -> case (a generated, PROVED puzzle whose clue cards are face-down until the learner answers
 * a course question: context `clue`) -> case-solved (the door opens) ... and chase (a suspect flees across a map; a witness gives a
 * course fact about the next place once the clue question is answered; the learner travels there) -> caught -> end.
 *
 * Pure parts: `model.ts` (case and chase state), `../../../shared/shells/detective-case.ts` (the puzzle wrapper); DOM: `grid.ts`,
 * `board.ts`, `map.ts`, `art.ts` and this file; the look: `detective.css` over the noir theme. Screens and test ids: docs/player.md.
 */

const SHELL_ID = 'detective'
const THEME_ID = 'noir'
const NO_FACT = '-'
const cap = (t: string): string => (t.length > 0 ? (t[0] as string).toLocaleUpperCase() + t.slice(1) : t)

type Session = ShellSession<DetKey>

/** What the shell keeps in `progress.shells.detective.data`. */
interface Saved {
  solved: string[]
  caught: boolean
}

const EMPTY_SECTION: DetectiveSection = { rooms: [] }

class Detective {
  private readonly session: Session
  private readonly section: DetectiveSection
  private readonly cases = new Map<string, CaseState>()
  private readonly titleState = newTitleState()
  private room: RoomSection | null = null
  private chase: ChaseState | null = null
  private coldPlaces = new Set<string>()
  private chaseNotice: { kind: 'cold' | 'warm' | 'hazy'; place: string; back: string } | null = null
  private cork: Cork | null = null

  constructor(private readonly host: ShellHost) {
    this.session = new ShellSession<DetKey>(host, { shellId: SHELL_ID, theme: THEME_ID, strings: STRINGS })
    this.section = this.session.section<DetectiveSection>() ?? EMPTY_SECTION
  }

  private get s(): Session['s'] {
    return this.session.s
  }

  mount(): void {
    const ses = this.session
    ses.mount()
    ses.setDebug({
      solution: () => this.solution(),
      route: () => this.route()
    })
    this.title()
  }

  unmount(): void {
    this.cork?.dispose()
    this.cork = null
    this.session.unmount()
  }

  // ---- lookups ----

  private saved(): Saved {
    const d = this.session.shellData<Partial<Saved>>()
    const solved = Array.isArray(d?.solved) ? d.solved.filter((x): x is string => typeof x === 'string') : []
    return { solved, caught: d?.caught === true }
  }

  private save(next: Saved): void {
    this.session.setShellData(next)
  }

  private rooms(): RoomSection[] {
    const order = this.session.units().map((u) => u.id)
    const at = (r: RoomSection): number => (r.unit === undefined ? 1e6 : order.indexOf(r.unit))
    return [...this.section.rooms].sort((a, b) => at(a) - at(b))
  }

  private isFinal(room: RoomSection): boolean {
    return room.unit === undefined
  }

  private roomLocked(room: RoomSection): boolean {
    return room.unit === undefined ? !this.session.allMastered() : !this.session.isUnlocked(room.unit)
  }

  private roomStars(room: RoomSection): number {
    return room.unit === undefined ? this.session.bossStars() : this.session.unitStars(room.unit)
  }

  private chaseOpen(ch: ChaseSection): boolean {
    return ch.unit === undefined ? this.session.allMastered() : this.session.isUnlocked(ch.unit)
  }

  private chaseStars(ch: ChaseSection): number {
    return ch.unit === undefined ? this.session.bossStars() : this.session.unitStars(ch.unit)
  }

  /** The units a locked door waits for: the ones it requires that are not mastered yet. */
  private needs(room: RoomSection): string {
    const ses = this.session
    if (room.unit === undefined) return ''
    const unit = ses.pack.units.find((u) => u.id === room.unit)
    return (unit?.requires ?? []).filter((r) => !ses.isMastered(r)).map((r) => ses.unitTitle(r)).join(', ')
  }

  private done(): boolean {
    return this.session.bossStars() >= 1
  }

  private nameOf(room: RoomSection): (id: string) => string {
    return (id) => this.session.t(room.case.names[id]) || id
  }

  private labelOf(room: RoomSection): (category: string) => string {
    const s = this.s
    const known: Record<string, DetKey> = { suspect: 'det.cat.suspect.label', weapon: 'det.cat.weapon.label', place: 'det.cat.place.label', motive: 'det.cat.motive.label' }
    return (key) => {
      const own = room.case.labels[key]
      if (own) return this.session.t(own)
      const k = known[key]
      return k ? s(k) : key
    }
  }

  private namer(room: RoomSection): Namer {
    const name = this.nameOf(room)
    return { name, alias: (id) => (room.case.aliases[id] ? this.session.t(room.case.aliases[id]) : undefined) }
  }

  /** The fact a clue card rests on: the did-you-know of the item that turned it, else its explanation. */
  private factOf(item: CourseItem | undefined): string {
    const ses = this.session
    if (!item) return ''
    for (const key of [item.didYouKnow, item.explanation]) if (key && ses.text.hasText(key)) return ses.t(key)
    return ''
  }

  private caseOf(room: RoomSection, p: Puzzle): CaseState {
    const have = this.cases.get(room.id)
    if (have) return have
    const fresh = newCase(p.clues.length, room.id)
    this.cases.set(room.id, fresh)
    return fresh
  }

  private built(room: RoomSection): BuiltCase | null {
    try {
      return buildCase(caseParams(room.case))
    } catch {
      return null
    }
  }

  // ---- the bot's helpers (read-only) ----

  /** `EduEngine.debug.shell.solution()`: the answer of the case that is open (the accusation, the cells that are yes, the cards left). */
  private solution(): Record<string, unknown> | null {
    const room = this.room
    const b = room ? this.built(room) : null
    if (!room || !b) return null
    const p = b.puzzle
    const c = this.cases.get(room.id)
    const right = accusationOf(p)
    const yes = yesCells(p)
    return {
      room: room.id,
      kind: p.kind,
      accusation: right,
      accuse: right ? Object.entries(right).map(([k, v]) => `accuse-${k}-${v}`) : [],
      yes,
      cells: yes.map((k) => {
        const [a, bb] = cellItems(k)
        return `cell-${a}-${bb}`
      }),
      cards: c ? { turned: turned(c), total: c.cards.length, faceDown: faceDown(c) } : { turned: 0, total: p.clues.length, faceDown: p.clues.map((_x, i) => i + 1) },
      marks: c ? yesPairs(p, c.marks).length : 0
    }
  }

  /** `EduEngine.debug.shell.route()`: the next place of the chase (the right button to press) and the decoys. */
  private route(): Record<string, unknown> | null {
    const ch = this.section.chase
    const st = this.chase
    if (!ch || !st) return null
    const leg = ch.route[st.leg]
    return {
      active: !st.caught,
      caught: st.caught,
      at: st.at,
      leg: st.leg,
      legs: ch.route.length,
      phase: st.caught ? 'caught' : st.heard ? 'travel' : 'witness',
      next: leg?.to ?? null,
      travel: leg ? `travel-${leg.to}` : null,
      options: st.options,
      decoys: st.options.filter((o) => o !== leg?.to),
      end: chaseEnd(ch)
    }
  }

  // ---- title ----

  private title(): void {
    const ses = this.session
    ses.finished = false
    this.room = null
    ses.render('title', titleScreen(ses, { onStart: () => this.office() }, () => this.title(), this.titleState))
  }

  // ---- the case board (office) ----

  private office(): void {
    const ses = this.session
    const s = this.s
    ses.finished = false
    this.room = null
    this.disposeCork()
    const saved = this.saved()
    const rooms = this.rooms()
    const ch = this.section.chase
    const open = rooms.filter((r) => !this.roomLocked(r))
    const solvedCount = rooms.filter((r) => saved.solved.includes(r.id)).length

    const roomCard = (r: RoomSection): HTMLElement => {
      const locked = this.roomLocked(r)
      const stars = this.roomStars(r)
      const solved = saved.solved.includes(r.id)
      const resuming = this.cases.has(r.id) && !this.cases.get(r.id)?.solved
      const state = locked ? 'locked' : solved ? 'solved' : 'open'
      const meta = locked ? (this.isFinal(r) ? s('det.room.final.locked') : s('det.room.locked', { unit: this.needs(r) })) : solved ? s('det.room.solved') : resuming ? s('det.room.resume') : this.isFinal(r) ? s('det.room.final') : s('det.room.open')
      return h(
        'li',
        { class: 'det-room-item' },
        h(
          'button',
          {
            type: 'button',
            class: `det-room is-${state}${this.isFinal(r) ? ' is-final' : ''}`,
            testid: `room-${r.id}`,
            'data-state': state,
            'data-stars': String(stars),
            'data-locked': String(locked),
            ...(r.unit ? { 'data-unit': r.unit } : { 'data-final': 'true' }),
            ...(locked ? { disabled: true } : {}),
            onclick: () => this.openRoom(r)
          },
          h('span', { class: 'det-room-door' }, doorSvg(locked ? 'locked' : solved ? 'solved' : 'open')),
          h('span', { class: 'det-room-body' }, h('span', { class: 'det-room-name' }, ses.t(r.title)), h('span', { class: 'det-room-meta' }, meta), ses.stars(stars))
        )
      )
    }

    const chaseCard = ch
      ? h(
          'div',
          { class: 'det-chase-card' },
          h('h2', {}, ses.t(ch.title) || s('det.chase.title')),
          h('p', {}, ch.story ? ses.t(ch.story) : s('det.chase.lead')),
          this.chaseOpen(ch)
            ? button('chase-start', this.chase && !this.chase.caught ? s('det.chase.resume') : saved.caught ? s('det.chase.again') : s('det.chase.start'), () => this.startChase(), { class: 'btn btn-primary' })
            : h('p', { class: 'message' }, ch.unit ? s('det.chase.locked', { unit: ses.unitTitle(ch.unit) }) : s('det.room.final.locked')),
          saved.caught ? h('p', { class: 'message message-ok', testid: 'chase-caught-tag' }, s('det.chase.caught.tag')) : null
        )
      : null

    const body = h(
      'section',
      { class: 'office-screen det-office' },
      h('div', { class: 'topbar' }, button('menu', `‹ ${ses.ui('menu')}`, () => this.title(), { class: 'btn btn-small btn-ghost' }), h('span', { class: 'topbar-stars', testid: 'office-progress' }, s('det.office.progress', { n: solvedCount, total: rooms.length }))),
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'office-title' }, s('det.office.title')),
      h('p', { class: 'subject' }, s('det.office.lead')),
      h('h2', { class: 'det-h2' }, s('det.office.rooms')),
      h('ol', { class: 'det-rooms', testid: 'rooms' }, rooms.map(roomCard)),
      chaseCard,
      this.done()
        ? h('div', { class: 'det-finish' }, h('p', { class: 'message message-ok' }, s('det.finish.ready')), button('finish', s('det.finish'), () => this.end(), { class: 'btn btn-primary btn-big' }))
        : h('p', { class: 'det-finish-hint', testid: 'finish-hint' }, s('det.finish.hint'))
    )
    ses.render('office', body, {
      view: {
        rooms: rooms.map((r) => ({ id: r.id, unit: r.unit ?? null, final: this.isFinal(r), stars: this.roomStars(r), locked: this.roomLocked(r), solved: saved.solved.includes(r.id), open: open.includes(r) })),
        chase: ch ? { open: this.chaseOpen(ch), caught: saved.caught, stars: this.chaseStars(ch) } : null,
        final: this.section.final ?? null,
        done: this.done()
      }
    })
  }

  // ---- a case ----

  private openRoom(room: RoomSection): void {
    this.room = room
    const c = this.cases.get(room.id)
    if (c?.solved) this.cases.delete(room.id)
    this.caseScreen(room)
  }

  private disposeCork(): void {
    this.cork?.dispose()
    this.cork = null
  }

  private caseView(room: RoomSection): Record<string, unknown> {
    const b = this.built(room)
    const c = this.cases.get(room.id)
    if (!b || !c) return { room: room.id }
    const p = b.puzzle
    return {
      room: room.id,
      unit: room.unit ?? null,
      kind: p.kind,
      size: p.size,
      seed: b.seed,
      clues: c.cards.map((x, i) => ({ n: i + 1, state: x === null ? 'down' : 'up', item: x })),
      turned: turned(c),
      total: c.cards.length,
      yes: yesPairs(p, c.marks).length,
      hints: c.hints,
      accusation: c.accusation,
      wrongAccusations: c.wrongAccusations,
      solved: c.solved
    }
  }

  private caseScreen(room: RoomSection, focusCard?: number): void {
    const ses = this.session
    const s = this.s
    this.room = room
    this.disposeCork()
    const b = this.built(room)
    if (!b) return this.caseBroken(room)
    const p = b.puzzle
    let c = this.caseOf(room, p)
    const nameOf = this.nameOf(room)
    const labelOf = this.labelOf(room)
    const who = this.namer(room)
    const commit = (next: CaseState): void => {
      c = next
      this.cases.set(room.id, c)
    }
    let hintCell = ''
    const publish = (): void => ses.publish('case', { ...(room.unit ? { unitId: room.unit } : {}), view: this.caseView(room) })

    // ---- the clue cards ----
    const total = c.cards.length
    const cards = p.clues.map((clue, i) => {
      const n = i + 1
      const itemId = c.cards[i]
      if (itemId === null || itemId === undefined) {
        return h(
          'li',
          { class: 'det-card is-down', 'data-state': 'down' },
          button(`clue-${n}`, [h('span', { class: 'det-card-art' }, magnifierSvg()), h('span', { class: 'det-card-no' }, s('det.clue.n', { n })), h('span', { class: 'det-card-act' }, s('det.clue.turn'))], () => this.turnCard(room, n), { class: 'det-card-btn' })
        )
      }
      const fact = this.factOf(ses.item(itemId))
      return h(
        'li',
        { class: 'det-card is-up', 'data-state': 'up', testid: `clue-${n}`, tabindex: '-1', ...(focusCard === n ? { 'data-autofocus': '' } : {}) },
        h('h3', { class: 'det-card-no' }, s('det.clue.n', { n })),
        h('p', { class: 'det-clue-text' }, renderClue(p, clue, who, ses.lang)),
        fact ? h('p', { class: 'det-clue-fact' }, h('span', { class: 'det-fact-label' }, s('det.clue.fact')), ' ', fact) : null
      )
    })

    // ---- the grid, the cork board ----
    const words = {
      mark: (m: MarkValue): string => (m === 'yes' ? s('det.mark.yes') : m === 'no' ? s('det.mark.no') : s('det.mark.blank')),
      cell: (a: string, bb: string, state: string): string => s('det.cell.label', { a, b: bb, state }),
      caption: (rows: string, cols: string): string => s('det.grid.caption', { rows, cols })
    }
    const hintText = h('p', { class: 'det-hint-text', testid: 'hint-text', role: 'status', hidden: true })
    const grid = gridView(p, c.marks, nameOf, labelOf, words, (key) => {
      let m = cycle(c.marks, key)
      if (markOf(m, key) === 'yes') m = crossOut(p, m, key)
      commit({ ...c, marks: m })
      hintCell = ''
      grid.update(m)
      this.cork?.update(m)
      const [a, bb] = cellItems(key)
      ses.live(words.cell(nameOf(a), nameOf(bb), words.mark(markOf(m, key))))
      publish()
    })
    const cork = corkBoard(p, nameOf, labelOf, c.marks)
    this.cork = cork

    // ---- hint ----
    const hintBtn = button(
      'hint',
      `💡 ${s('det.hint')}`,
      () => {
        const hint = hintFor(p, turnedIds(c), c.marks, who, ses.lang)
        commit({ ...c, hints: c.hints + 1 })
        hintText.hidden = false
        hintText.textContent = hint.text
        hintCell = hint.kind === 'step' || hint.kind === 'wrong' ? hint.cell : ''
        grid.update(c.marks, hintCell)
        hintCount.textContent = s('det.hint.used', { n: c.hints })
        publish()
      },
      { class: 'btn btn-small' }
    )
    const hintCount = h('span', { class: 'det-hint-count', testid: 'hint-count' }, s('det.hint.used', { n: c.hints }))

    // ---- the accusation ----
    const picks = new Map<string, HTMLButtonElement>()
    const message = h('p', { class: 'det-accuse-message', testid: 'accuse-message', role: 'status', hidden: true })
    const say = (text: string, tone: 'bad' | 'ok'): void => {
      message.hidden = false
      message.className = `det-accuse-message message ${tone === 'bad' ? 'message-bad' : 'message-ok'}`
      message.textContent = text
    }
    const keys = accusationKeys(p)
    const pickRows = keys.map((key) => {
      const cat = p.categories.find((x) => x.key === key)
      const label = labelOf(key)
      return h(
        'div',
        { class: 'det-pick-row', role: 'group', 'aria-label': label },
        h('span', { class: 'det-pick-label' }, label),
        h(
          'span',
          { class: 'det-picks' },
          (cat?.items ?? []).map((id) => {
            const btn = button(`accuse-${key}-${id}`, nameOf(id), () => {
              commit({ ...c, accusation: { ...c.accusation, [key]: c.accusation[key] === id ? '' : id } })
              for (const [k, el] of picks) el.setAttribute('aria-pressed', String(c.accusation[k.split('|')[0] as string] === k.split('|')[1]))
              publish()
            }, { class: 'det-pick', 'aria-pressed': String(c.accusation[key] === id) })
            picks.set(`${key}|${id}`, btn)
            return btn
          })
        )
      )
    })
    const submit = button(
      'accuse-submit',
      p.kind === 'murdle' ? s('det.accuse.submit') : s('det.accuse.submit.grid'),
      () => {
        const verdict = judge(p, c, (acc, marks) => checkAccuse(p, acc, marks))
        if (verdict.kind === 'cards') return say(s('det.accuse.cards'), 'bad')
        if (verdict.kind === 'pick') return say(s('det.accuse.pick'), 'bad')
        if (verdict.kind === 'wrong') {
          commit({ ...c, wrongAccusations: c.wrongAccusations + 1 })
          say(p.kind === 'murdle' ? s('det.accuse.wrong', { what: verdict.wrong.map((k) => this.categoryWords(k, labelOf)).join(', ') }) : s('det.accuse.wrong.grid'), 'bad')
          ses.live(message.textContent ?? '')
          return publish()
        }
        commit({ ...c, solved: true })
        this.solved(room, p, c)
      },
      { class: 'btn btn-primary btn-big' }
    )

    const crime = p.kind === 'murdle' && p.murder ? h('p', { class: 'det-crime', testid: 'case-crime' }, s('det.case.crime', { place: phrase(p, p.murder.place, who, ses.lang) })) : null
    const body = h(
      'section',
      { class: 'case-screen det-case' },
      h('div', { class: 'topbar' }, button('to-office', `‹ ${s('det.back')}`, () => this.office(), { class: 'btn btn-small btn-ghost' }), h('span', { class: 'topbar-stars', testid: 'case-progress' }, s('det.case.turned', { n: turned(c), total }))),
      h('h1', { class: 'screen-title det-case-title', tabindex: '-1', testid: 'case-title' }, ses.t(room.title)),
      h('p', { class: 'det-story', testid: 'case-story' }, ses.t(room.story)),
      crime,
      h(
        'div',
        { class: 'det-layout' },
        h(
          'section',
          { class: 'det-col-cards', 'aria-labelledby': 'det-cards-h' },
          h('h2', { class: 'det-h2', id: 'det-cards-h' }, s('det.case.clues')),
          turned(c) === total ? h('p', { class: 'det-note' }, s('det.case.no.cards')) : null,
          h('ol', { class: 'det-cards', testid: 'clues' }, cards)
        ),
        h(
          'section',
          { class: 'det-col-grid', 'aria-labelledby': 'det-grid-h' },
          h('h2', { class: 'det-h2', id: 'det-grid-h' }, s('det.case.grid')),
          h('p', { class: 'det-help' }, s('det.case.grid.help')),
          grid.el
        )
      ),
      h('section', { class: 'det-board-wrap', 'aria-labelledby': 'det-board-h' }, h('h2', { class: 'det-h2', id: 'det-board-h' }, s('det.board.title')), h('p', { class: 'det-help' }, s('det.board.help')), cork.el),
      h(
        'section',
        { class: 'det-accuse', 'aria-labelledby': 'det-accuse-h' },
        h('h2', { class: 'det-h2', id: 'det-accuse-h' }, s('det.accuse.title')),
        h('div', { class: 'det-hint-row' }, hintBtn, hintCount),
        hintText,
        p.kind === 'murdle' ? h('div', { class: 'det-pick-rows' }, pickRows) : h('p', { class: 'det-help' }, s('det.accuse.grid')),
        h('div', { class: 'actions' }, submit),
        message
      )
    )
    ses.render('case', body, { ...(room.unit ? { unitId: room.unit } : {}), view: this.caseView(room) })
    // marks drawn from an earlier visit show their strings once the board has a size
    cork.update(c.marks)
  }

  private categoryWords(key: string, labelOf: (k: string) => string): string {
    const s = this.s
    const map: Record<string, DetKey> = { suspect: 'det.cat.suspect', weapon: 'det.cat.weapon', place: 'det.cat.place', motive: 'det.cat.motive' }
    const k = map[key]
    return k ? s(k) : labelOf(key)
  }

  private caseBroken(room: RoomSection): void {
    const ses = this.session
    const s = this.s
    ses.render(
      'case',
      h(
        'section',
        { class: 'case-screen det-case' },
        h('h1', { class: 'screen-title', tabindex: '-1', testid: 'case-title' }, ses.t(room.title)),
        h('p', { class: 'message message-bad', testid: 'case-broken' }, s('det.case.broken')),
        h('div', { class: 'actions' }, button('to-office', s('det.back'), () => this.office(), { class: 'btn btn-primary' }))
      ),
      { view: { room: room.id, broken: true } }
    )
  }

  /** A face-down card was pressed: a course question (context `clue`) turns it. */
  private turnCard(room: RoomSection, n: number): void {
    const ses = this.session
    const s = this.s
    const b = this.built(room)
    const c0 = this.cases.get(room.id)
    if (!b || !c0) return this.caseScreen(room)
    const total = c0.cards.length
    const kind = room.unit ? ('unit' as const) : ('boss' as const)
    let run = c0.run
    let pick = run ? ses.next(run) : null
    if (!pick) {
      run = ses.startRun(poolOf(room.case.items, c0), { kind, ...(room.unit ? { unitId: room.unit } : {}) })
      pick = ses.next(run)
    }
    const item = pick ? ses.item(pick.id) : undefined
    if (!run || !pick || !ses.canAsk(item)) {
      // nothing can be asked: the card turns by itself, so nobody is stuck
      this.cases.set(room.id, { ...c0, run, cards: c0.cards.map((x, i) => (i === n - 1 ? NO_FACT : x)) })
      return this.caseScreen(room, n)
    }
    this.cases.set(room.id, { ...c0, run })
    const theRun = run
    const thePick = pick
    const hud = h(
      'div',
      { class: 'det-hud' },
      h('span', { class: 'det-hud-card' }, magnifierSvg()),
      h('div', { class: 'det-hud-text' }, h('p', { class: 'det-hud-room' }, ses.t(room.title)), h('p', { class: 'det-hud-count' }, s('det.case.turned', { n: turned(c0), total })))
    )
    ask(ses, {
      item,
      context: 'clue',
      retry: thePick.retry,
      hud,
      lead: h('span', {}, s('det.hud.clue', { n, total })),
      ...(room.unit ? { unitId: room.unit } : {}),
      roundKind: kind,
      roundSize: theRun.size,
      index: theRun.results.length,
      view: () => this.caseView(room),
      leaveLabel: s('det.case.leave'),
      onLeave: () => this.caseScreen(room),
      onAnswered: (o) => {
        const cur = this.cases.get(room.id) as CaseState
        const next = afterAnswer({ ...cur, run: ses.record(theRun, thePick, o) }, n, item.id, o.result.correct, o.result.score)
        this.cases.set(room.id, next)
      },
      effect: (o) => (o.result.correct ? { text: s('det.effect.up', { n }), tone: 'good' } : { text: s('det.effect.down'), tone: 'bad' }),
      nextLabel: (o) => (o.result.correct ? s('det.next.up') : s('det.next.down')),
      onNext: (o) => this.caseScreen(room, o.result.correct ? n : undefined)
    })
  }

  // ---- case solved ----

  private solved(room: RoomSection, p: Puzzle, c: CaseState): void {
    const ses = this.session
    const s = this.s
    const accuracy = caseAccuracy(c)
    const r = ses.recordUnit(room.unit ? { unitId: room.unit } : { boss: true }, accuracy)
    const saved = this.saved()
    if (!saved.solved.includes(room.id)) this.save({ ...saved, solved: [...saved.solved, room.id] })
    ses.playCue(room.unit ? 'unit-complete' : 'boss')
    const nameOf = this.nameOf(room)
    const labelOf = this.labelOf(room)
    const right = accusationOf(p)
    const answer = right ? Object.entries(right).map(([k, v]) => `${labelOf(k)}: ${nameOf(v)}`).join('; ') : ''
    const opened = r.unlocked.map((u) => ses.unitTitle(u))
    const pct = Math.round(accuracy * 100)
    const facts = c.cards.flatMap((x, i) => {
      const f = this.factOf(x ? ses.item(x) : undefined)
      return f ? [{ n: i + 1, text: f }] : []
    })
    const door = doorSvg('locked')
    const body = h(
      'section',
      { class: 'solved-screen det-solved' },
      h('div', { class: 'det-solved-door', 'aria-hidden': 'true' }, door),
      h('p', { class: 'det-stamp', 'aria-hidden': 'true' }, s('det.solved.stamp')),
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'solved-title' }, s('det.solved.title')),
      h('p', { class: 'subject' }, ses.t(room.title)),
      answer ? h('p', { class: 'det-answer', testid: 'solved-answer' }, s('det.solved.who', { what: answer })) : null,
      ses.stars(r.stars, 'case-stars'),
      h('p', { class: 'big-number', testid: 'case-accuracy' }, s('det.solved.accuracy', { n: pct })),
      c.hints > 0 ? h('p', { class: 'det-note', testid: 'case-hints' }, s('det.solved.hints', { n: c.hints })) : null,
      h('p', { class: 'message message-ok', testid: 'door-open' }, room.unit ? s('det.solved.door', { unit: ses.t(room.title) }) : s('det.solved.door.final')),
      opened.length > 0 ? h('p', { class: 'message', testid: 'solved-unlocked' }, s('det.solved.unlocked', { units: opened.join(', ') })) : null,
      r.stars < 2 ? h('p', { class: 'message message-bad', testid: 'solved-more' }, s('det.solved.more')) : null,
      facts.length > 0
        ? h('div', { class: 'det-facts' }, h('h2', { class: 'det-h2' }, s('det.solved.facts')), h('ul', { class: 'det-fact-list', testid: 'solved-facts' }, facts.map((f) => h('li', {}, h('b', {}, s('det.clue.n', { n: f.n })), ' ', f.text))))
        : null,
      h('div', { class: 'actions actions-center' }, button('to-office', s('det.back'), () => this.office(), { class: 'btn btn-primary btn-big', 'data-autofocus': '' }), r.stars < 3 ? button('solve-again', s('det.solved.again'), () => this.again(room), { class: 'btn btn-big' }) : null)
    )
    ses.render('case-solved', body, { ...(room.unit ? { unitId: room.unit } : {}), view: { room: room.id, stars: r.stars, accuracy: pct, hints: c.hints, unlocked: r.unlocked, wrongAccusations: c.wrongAccusations } })
    // the door swings open once the screen is up (a transition: instant under reduced motion)
    window.requestAnimationFrame(() => door.classList.add('is-swinging'))
  }

  private again(room: RoomSection): void {
    this.cases.delete(room.id)
    this.openRoom(room)
  }

  // ---- the chase ----

  private startChase(): void {
    const ch = this.section.chase
    if (!ch) return this.office()
    if (!this.chase || this.chase.caught) {
      this.chase = newChase(ch, this.session.rng)
      this.coldPlaces = new Set()
      this.chaseNotice = null
    }
    this.chaseScreen()
  }

  private placeName(ch: ChaseSection, id: string): string {
    const p = ch.places.find((x) => x.id === id)
    return p ? this.session.t(p.name) : id
  }

  private chaseView(): Record<string, unknown> {
    const ch = this.section.chase
    const st = this.chase
    if (!ch || !st) return {}
    return {
      phase: st.caught ? 'caught' : st.heard ? 'travel' : 'witness',
      at: st.at,
      leg: st.leg,
      legs: ch.route.length,
      hours: st.hours,
      clock: clockText(st.hours),
      heard: st.heard,
      options: st.heard ? st.options : [],
      cold: st.cold,
      trail: st.trail
    }
  }

  /** What the witness says: the leg's own words, else the did-you-know or explanation of the clue item. */
  private witnessText(ch: ChaseSection, leg: number): string {
    const ses = this.session
    const l = ch.route[leg]
    if (!l) return ''
    if (l.clue) return ses.t(l.clue)
    const item = ses.item(l.item)
    return this.factOf(item) || (item ? ses.t(item.prompt) : '')
  }

  private chaseScreen(): void {
    const ses = this.session
    const s = this.s
    const ch = this.section.chase as ChaseSection
    const st = this.chase as ChaseState
    this.disposeCork()
    const leg = ch.route[st.leg]
    const asset = ses.pack.assets.find((a) => a.id === ch.map)
    const map = chaseMap({
      src: ses.data.assets[ch.map],
      alt: asset ? ses.t(asset.alt) : s('det.chase.map'),
      width: ch.width,
      height: ch.height,
      places: ch.places.map((p) => ({ id: p.id, name: ses.t(p.name), x: p.x, y: p.y })),
      trail: st.trail,
      options: st.heard ? st.options : [],
      here: st.at
    })
    const notice = this.chaseNotice
    const noticeEl = notice
      ? h(
          'p',
          { class: `message ${notice.kind === 'warm' ? 'message-ok' : 'message-bad'}`, role: 'status', testid: 'chase-notice', 'data-kind': notice.kind },
          notice.kind === 'cold' ? s('det.chase.cold', { place: notice.place, back: notice.back }) : notice.kind === 'warm' ? s('det.chase.warm', { place: notice.place }) : s('det.chase.hazy')
        )
      : null
    const options = st.heard && leg ? st.options : []
    const panel = !leg
      ? null
      : st.heard
        ? h(
            'div',
            { class: 'det-travel-panel' },
            h('figure', { class: 'det-witness', testid: 'witness-line' }, h('figcaption', {}, s('det.chase.witness')), h('blockquote', {}, this.witnessText(ch, st.leg))),
            h('h2', { class: 'det-h2' }, s('det.chase.heard')),
            h(
              'ul',
              { class: 'det-travel', testid: 'travel' },
              options.map((id, i) =>
                h(
                  'li',
                  {},
                  button(`travel-${id}`, this.s('det.chase.travel', { place: this.placeName(ch, id) }), () => this.go(id), {
                    class: `btn det-go${this.coldPlaces.has(id) ? ' is-cold' : ''}`,
                    ...(this.coldPlaces.has(id) ? { disabled: true, 'data-cold': 'true' } : {}),
                    ...(i === options.findIndex((o) => !this.coldPlaces.has(o)) ? { 'data-autofocus': '' } : {})
                  })
                )
              )
            )
          )
        : h(
            'div',
            { class: 'det-witness-panel' },
            h('p', { class: 'det-here', testid: 'chase-here' }, s('det.chase.at', { place: this.placeName(ch, st.at) })),
            button('ask-witness', s('det.chase.ask'), () => this.askWitness(), { class: 'btn btn-primary btn-big', 'data-autofocus': '' })
          )
    const body = h(
      'section',
      { class: 'chase-screen det-chase' },
      h(
        'div',
        { class: 'topbar' },
        button('to-office', `‹ ${s('det.chase.leave')}`, () => this.office(), { class: 'btn btn-small btn-ghost' }),
        h('span', { class: 'det-clock', testid: 'clock', role: 'timer', 'aria-label': s('det.chase.clock.label', { time: clockText(st.hours) }) }, h('span', { class: 'det-clock-label' }, s('det.chase.clock')), ' ', clockText(st.hours))
      ),
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'chase-title' }, ses.t(ch.title) || s('det.chase.title')),
      h('p', { class: 'subject', testid: 'chase-suspect' }, s('det.chase.suspect', { who: ses.t(ch.suspect) })),
      h('p', { class: 'det-legs', testid: 'chase-legs' }, s('det.chase.legs', { n: Math.min(st.leg + 1, ch.route.length), total: ch.route.length })),
      h('div', { class: 'det-chase-layout' }, map, h('div', { class: 'det-chase-side' }, noticeEl, panel))
    )
    ses.render('chase', body, { ...(ch.unit ? { unitId: ch.unit } : {}), view: this.chaseView() })
  }

  /** The witness is questioned: the clue item is asked (context `clue`); a hazy (wrong) answer costs an hour, and she still speaks. */
  private askWitness(): void {
    const ses = this.session
    const s = this.s
    const ch = this.section.chase as ChaseSection
    const st0 = this.chase as ChaseState
    const leg = ch.route[st0.leg]
    if (!leg) return this.chaseScreen()
    const item = ses.item(leg.item)
    this.chaseNotice = null
    if (!ses.canAsk(item)) {
      this.chase = heard(st0, true, 1)
      return this.chaseScreen()
    }
    const hud = h(
      'div',
      { class: 'det-hud' },
      h('span', { class: 'det-hud-card' }, magnifierSvg()),
      h('div', { class: 'det-hud-text' }, h('p', { class: 'det-hud-room' }, this.placeName(ch, st0.at)), h('p', { class: 'det-hud-count' }, s('det.chase.clock.label', { time: clockText(st0.hours) })))
    )
    ask(ses, {
      item,
      context: 'clue',
      hud,
      lead: h('span', {}, s('det.chase.legs', { n: st0.leg + 1, total: ch.route.length })),
      ...(ch.unit ? { unitId: ch.unit } : {}),
      index: st0.leg,
      view: () => this.chaseView(),
      leaveLabel: s('det.chase.leave'),
      onLeave: () => this.chaseScreen(),
      onAnswered: (o) => {
        this.chase = heard(this.chase as ChaseState, o.result.correct, o.result.score)
        if (!o.result.correct) this.chaseNotice = { kind: 'hazy', place: '', back: '' }
      },
      effect: (o) => (o.result.correct ? { text: s('det.chase.effect.right'), tone: 'good' } : { text: s('det.chase.effect.wrong'), tone: 'bad' }),
      nextLabel: s('det.chase.next'),
      onNext: () => this.chaseScreen()
    })
  }

  /** The learner travels to a place: the right one follows the trail, a decoy is a cold trail (an hour, back where she was). */
  private go(place: string): void {
    const ses = this.session
    const ch = this.section.chase as ChaseSection
    const before = this.chase as ChaseState
    const r = travel(before, ch, place, ses.rng)
    this.chase = r.state
    if (!r.right) {
      this.coldPlaces.add(place)
      this.chaseNotice = { kind: 'cold', place: this.placeName(ch, place), back: this.placeName(ch, before.at) }
      ses.live(this.s('det.chase.cold', { place: this.placeName(ch, place), back: this.placeName(ch, before.at) }))
      return this.chaseScreen()
    }
    this.coldPlaces = new Set()
    if (r.state.caught) return this.caught()
    this.chaseNotice = { kind: 'warm', place: this.placeName(ch, place), back: '' }
    this.chaseScreen()
  }

  private caught(): void {
    const ses = this.session
    const s = this.s
    const ch = this.section.chase as ChaseSection
    const st = this.chase as ChaseState
    const accuracy = chaseAccuracy(st)
    const r = ses.recordUnit(ch.unit ? { unitId: ch.unit } : { boss: true }, accuracy)
    this.save({ ...this.saved(), caught: true })
    ses.playCue(ch.unit ? 'unit-complete' : 'boss')
    this.chaseNotice = null
    const pct = Math.round(accuracy * 100)
    const opened = r.unlocked.map((u) => ses.unitTitle(u))
    const body = h(
      'section',
      { class: 'caught-screen det-solved det-caught' },
      h('p', { class: 'det-stamp', 'aria-hidden': 'true' }, s('det.chase.caught.tag')),
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'caught-title' }, s('det.caught.title')),
      h('p', { class: 'subject', testid: 'caught-text' }, s('det.caught.text', { who: cap(ses.t(ch.suspect)), place: this.placeName(ch, chaseEnd(ch)) })),
      ses.stars(r.stars, 'chase-stars'),
      h('p', { class: 'big-number', testid: 'chase-accuracy' }, s('det.caught.accuracy', { n: pct })),
      h('p', { class: 'det-note', testid: 'caught-clock' }, s('det.caught.clock', { time: clockText(st.hours) })),
      h('p', { class: 'det-note', testid: 'caught-cold' }, s('det.caught.cold', { n: st.cold })),
      opened.length > 0 ? h('p', { class: 'message', testid: 'caught-unlocked' }, s('det.solved.unlocked', { units: opened.join(', ') })) : null,
      h('div', { class: 'det-facts' }, h('h2', { class: 'det-h2' }, s('det.caught.facts')), h('ol', { class: 'det-trail', testid: 'caught-trail' }, st.trail.map((id) => h('li', {}, this.placeName(ch, id))))),
      h('div', { class: 'actions actions-center' }, button('to-office', s('det.back'), () => this.office(), { class: 'btn btn-primary btn-big', 'data-autofocus': '' }), r.stars < 3 ? button('chase-again', s('det.caught.again'), () => this.restartChase(), { class: 'btn btn-big' }) : null)
    )
    ses.render('caught', body, { ...(ch.unit ? { unitId: ch.unit } : {}), view: { stars: r.stars, accuracy: pct, hours: st.hours, clock: clockText(st.hours), cold: st.cold, trail: st.trail, unlocked: r.unlocked } })
  }

  private restartChase(): void {
    this.chase = null
    this.startChase()
  }

  // ---- the end ----

  private end(): void {
    const ses = this.session
    const s = this.s
    ses.finish()
    this.disposeCork()
    const rooms = this.rooms()
    const saved = this.saved()
    const solved = rooms.filter((r) => saved.solved.includes(r.id)).length
    ses.render(
      'end',
      endScreen(ses, {
        title: s('det.end.title'),
        sub: s('det.end.sub'),
        stats: h('p', { class: 'subject', testid: 'end-rooms' }, s('det.end.rooms', { n: solved, total: rooms.length })),
        onAgain: () => this.office(),
        onTitle: () => this.title()
      }),
      { view: { solved, total: rooms.length, caught: saved.caught, final: finalRoom(this.section)?.id ?? null } }
    )
  }
}

export const detectiveShell: Shell = (() => {
  let game: Detective | null = null
  return {
    id: SHELL_ID,
    mount(host: ShellHost) {
      game = new Detective(host)
      game.mount()
    },
    unmount() {
      game?.unmount()
      game = null
    }
  }
})()

