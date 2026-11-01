import '../../../design/themes/castle.css'
import './mindmaze.css'
import {
  canReachKey,
  keyRooms,
  resolveMaze,
  roomOf,
  routeToKey,
  type Maze,
  type MazeCharacter,
  type MazeDoor,
  type MazeLabel,
  type MazeRoom,
  type MindmazeSection,
  type MazeWing
} from '../../../shared/shells/mindmaze'
import { answerLines } from '../../feedback'
import { button, h, isTyping } from '../../dom'
import { ask } from '../../kit/question'
import { endScreen, newTitleState, titleScreen } from '../../kit/screens'
import { ShellSession } from '../../kit/session'
import { missedIds, type RoundState } from '../../round'
import type { Shell, ShellHost } from '../../types'
import { doorSvg, keySvg, miniMapSvg, portraitFrame, setDoorOpen, skylineSvg, throneSvg, torchesEl } from './art'
import { layoutRooms, wingRows } from './layout'
import { MAZE_STRINGS, type MazeKey } from './strings'
import { goBack, ghostLeads, isOpen, loseTorch, moodAfter, newWalk, openDoor, pickForDoor, walkThrough, type Walk } from './walk'

/**
 * The MindMaze castle shell (EGS-11): title -> castle (a wing per unit, the throne room) -> room (doors, a character, the wing's map)
 * -> a door asks its question (`ask()`: context `door`) -> the key room -> wing-done -> throne (a gauntlet over every unit) -> end.
 * The learning logic is the kit's (`ShellSession`: runs, answers, stars) and the pure `walk.ts`; the section and the maze graph are
 * `src/shared/shells/mindmaze.ts`; the pictures are inline SVG (`art.ts`) painted by `mindmaze.css`. Screens and test ids: docs/player.md.
 */

const SHELL_ID = 'mindmaze'
const THEME_ID = 'castle'

type Session = ShellSession<MazeKey>

interface Throne {
  run: RoundState
  torches: number
  max: number
  /** The last answer put out the last torch and the ghost relit them. */
  relit: boolean
}

class MindMaze {
  private readonly session: Session
  private maze: Maze
  private readonly walks = new Map<string, Walk>()
  private throne: Throne | null = null
  private currentWing: string | null = null
  private readonly titleState = newTitleState()

  constructor(private readonly host: ShellHost) {
    this.session = new ShellSession<MazeKey>(host, { shellId: SHELL_ID, theme: THEME_ID, strings: MAZE_STRINGS })
    this.maze = resolveMaze(this.session.pack, this.session.section<MindmazeSection>())
  }

  private get s(): Session['s'] {
    return this.session.s
  }

  mount(): void {
    const ses = this.session
    ses.mount()
    ses.setKeyHandler((e) => this.onKey(e))
    ses.setDebug({
      route: () => this.route(),
      view: () => this.roomView(),
      maze: () => this.mazeSummary()
    })
    this.title()
  }

  unmount(): void {
    this.session.unmount()
  }

  // ---- words, lookups ----

  private label(l: MazeLabel | undefined): string {
    if (!l) return ''
    return l.key ? this.session.t(l.key) : l.ui ? this.s(l.ui as MazeKey) : ''
  }

  /** A room's name: an automatic room is named after an objective, a sentence that ends in a full stop. */
  private roomLabel(l: MazeLabel | undefined): string {
    return this.label(l).replace(/[.。]$/, '')
  }

  private wing(id: string): MazeWing {
    return this.maze.wings.find((w) => w.id === id) as MazeWing
  }

  private roomName(wing: MazeWing, id: string): string {
    return this.roomLabel(roomOf(wing, id)?.name) || id
  }

  private assetOf(id: string | undefined): { url: string; alt: string } | null {
    if (!id) return null
    const url = this.session.data.assets[id]
    const a = this.session.pack.assets.find((x) => x.id === id)
    return url && a ? { url, alt: this.session.t(a.alt) } : null
  }

  private poolOfWing(wing: MazeWing): string[] {
    return [...new Set(wing.rooms.flatMap((r) => r.doors.flatMap((d) => d.items)))]
  }

  private keysWon(): number {
    return this.maze.wings.filter((w) => this.session.isMastered(w.unit)).length
  }

  private everyKey(): boolean {
    return this.maze.wings.every((w) => this.session.isMastered(w.unit))
  }

  private crowned(): boolean {
    return this.session.bossStars() >= 1
  }

  // ---- views (the JSON of getState().view) and the bot's helpers ----

  private castleView(): Record<string, unknown> {
    const ses = this.session
    return {
      wings: this.maze.wings.map((w) => ({ id: w.id, unit: w.unit, stars: ses.unitStars(w.unit), locked: !ses.isUnlocked(w.unit), key: ses.isMastered(w.unit), walking: this.walks.has(w.id) })),
      keys: this.keysWon(),
      total: this.maze.wings.length,
      throneOpen: this.everyKey(),
      crowned: this.crowned()
    }
  }

  private roomView(): Record<string, unknown> | null {
    const id = this.currentWing
    const w = id ? this.walks.get(id) : undefined
    if (!id || !w) return null
    const wing = this.wing(id)
    const room = roomOf(wing, w.room)
    return {
      wing: id,
      unit: wing.unit,
      room: w.room,
      entry: wing.entry,
      keyRoom: room?.key === true,
      torches: w.torches,
      maxTorches: w.maxTorches,
      trail: w.trail,
      open: w.open,
      doors: (room?.doors ?? []).map((d) => ({ to: d.to, state: isOpen(w, w.room, d.to) ? 'open' : 'locked' })),
      ghost: w.ghosted,
      mood: w.mood,
      answered: w.run.asked.length
    }
  }

  private throneView(phase: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const t = this.throne
    return { phase, torches: t?.torches ?? 0, maxTorches: t?.max ?? this.maze.torches, size: t?.run.size ?? this.maze.throne.size, asked: t?.run.asked.length ?? 0, crowned: this.crowned(), ...extra }
  }

  /** `EduEngine.debug.shell.route()`: the next door on the cheapest way to the key room (open doors first) in the wing being walked. */
  private route(): Record<string, unknown> | null {
    const id = this.currentWing
    const w = id ? this.walks.get(id) : undefined
    if (!id || !w) return null
    const wing = this.wing(id)
    const r = routeToKey(wing, w.room, new Set(w.open))
    const here = roomOf(wing, w.room)
    return {
      wing: id,
      room: w.room,
      found: r.found,
      path: r.path,
      locked: r.locked,
      door: r.next ? `door-${r.next}` : null,
      state: r.next ? (isOpen(w, w.room, r.next) ? 'open' : 'locked') : null,
      takeKey: here?.key === true
    }
  }

  /** `EduEngine.debug.shell.maze()`: the shape of the castle (wings, rooms, key rooms, doors on the shortest route). */
  private mazeSummary(): Record<string, unknown> {
    return {
      torches: this.maze.torches,
      throne: this.maze.throne.size,
      wings: this.maze.wings.map((w) => ({
        id: w.id,
        unit: w.unit,
        entry: w.entry,
        auto: w.auto,
        rooms: w.rooms.map((r) => r.id),
        keys: keyRooms(w),
        doors: routeToKey(w, w.entry).path.length - 1,
        solvable: canReachKey(w, w.entry)
      }))
    }
  }

  // ---- keyboard: the number keys walk through the doors of the room ----

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
    if (this.session.screen !== 'room' || !/^[1-9]$/.test(e.key)) return
    const doors = [...this.host.root.querySelectorAll<HTMLButtonElement>('.mm-door')]
    const door = doors[Number(e.key) - 1]
    if (door) {
      e.preventDefault()
      door.click()
    }
  }

  // ---- title ----

  private title(): void {
    const ses = this.session
    ses.finished = false
    this.walks.clear()
    this.throne = null
    this.currentWing = null
    ses.render('title', titleScreen(ses, { onStart: () => this.castle() }, () => this.title(), this.titleState))
  }

  // ---- the castle ----

  private castle(): void {
    const ses = this.session
    ses.finished = false
    this.currentWing = null
    const s = this.s
    const rows = wingRows(this.maze.wings, ses.units())
    const wingBy = new Map(this.maze.wings.map((w) => [w.id, w]))
    const throneOpen = this.everyKey()
    const total = this.maze.wings.length
    const won = this.keysWon()
    const towers = this.maze.wings.map((w) => ({ state: ses.isMastered(w.unit) ? ('won' as const) : ses.isUnlocked(w.unit) ? ('open' as const) : ('sealed' as const) }))
    const wingCard = (w: MazeWing): HTMLElement => {
      const locked = !ses.isUnlocked(w.unit)
      const stars = ses.unitStars(w.unit)
      const key = ses.isMastered(w.unit)
      const needs = (ses.pack.units.find((u) => u.id === w.unit)?.requires ?? []).filter((r) => !ses.isMastered(r))
      const needNames = needs.map((r) => this.label(this.maze.wings.find((x) => x.unit === r)?.name) || ses.unitTitle(r)).join(', ')
      const walking = this.walks.has(w.id)
      return h(
        'li',
        { class: 'mm-wing-item' },
        h(
          'button',
          {
            type: 'button',
            class: `mm-wing ${locked ? 'is-locked' : 'is-open'}${key ? ' is-key' : ''}`,
            testid: `wing-${w.id}`,
            'data-stars': String(stars),
            'data-locked': String(locked),
            'data-key': String(key),
            'data-unit': w.unit,
            'data-requires': (ses.pack.units.find((u) => u.id === w.unit)?.requires ?? []).join(' '),
            ...(locked ? { disabled: true } : {}),
            onclick: () => this.enterWing(w)
          },
          h('span', { class: 'mm-wing-name' }, this.label(w.name)),
          w.description ? h('span', { class: 'mm-wing-desc' }, this.label(w.description)) : null,
          h('span', { class: 'mm-wing-meta' }, locked ? `${s('maze.wing.sealed')}. ${s('maze.wing.needs', { wings: needNames })}` : key ? `${s('maze.wing.key')}` : walking ? s('maze.wing.resume') : s('maze.wing.rooms', { n: w.rooms.length })),
          key ? h('span', { class: 'mm-wing-keyicon' }, keySvg()) : null,
          ses.stars(stars)
        )
      )
    }
    const throneBtn = h(
      'button',
      {
        type: 'button',
        class: `mm-throne-btn ${throneOpen ? 'is-open' : 'is-locked'}${this.crowned() ? ' is-crowned' : ''}`,
        testid: 'throne',
        'data-locked': String(!throneOpen),
        'data-stars': String(ses.bossStars()),
        ...(throneOpen ? {} : { disabled: true }),
        onclick: () => this.throneIntro()
      },
      h('span', { class: 'mm-throne-icon' }, throneSvg(this.crowned())),
      h('span', { class: 'mm-wing-name' }, this.label(this.maze.throne.name) || s('maze.throne.name')),
      h('span', { class: 'mm-wing-meta' }, this.crowned() ? s('maze.throne.crowned') : throneOpen ? s('maze.throne.ready') : s('maze.throne.sealed')),
      ses.stars(ses.bossStars())
    )
    const body = h(
      'section',
      { class: 'castle-screen mm-castle' },
      h('div', { class: 'topbar' }, button('menu', `‹ ${ses.ui('menu')}`, () => this.title(), { class: 'btn btn-small btn-ghost' }), h('span', { class: 'topbar-stars', testid: 'castle-keys' }, s('maze.keys', { n: won, total }))),
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'castle-title' }, s('maze.castle.title')),
      h('p', { class: 'subject' }, s('maze.castle.sub')),
      h('div', { class: 'mm-skyline' }, skylineSvg(towers, this.crowned() ? 'won' : throneOpen ? 'open' : 'sealed', s('maze.castle.map', { won, total }))),
      h('div', { class: 'mm-throne-wrap' }, throneBtn),
      h(
        'ol',
        { class: 'mm-wing-rows', testid: 'wing-map' },
        [...rows].reverse().map((row) => h('li', { class: 'mm-wing-row' }, h('div', { class: 'mm-corridor', 'aria-hidden': 'true' }), h('ul', { class: 'mm-wing-list' }, row.map((id) => wingCard(wingBy.get(id) as MazeWing)))))
      )
    )
    ses.render('castle', body, { view: this.castleView() })
  }

  // ---- walking a wing ----

  private enterWing(wing: MazeWing): void {
    const ses = this.session
    this.currentWing = wing.id
    if (!this.walks.has(wing.id)) {
      const run = ses.startRun(this.poolOfWing(wing), { kind: 'unit', unitId: wing.unit })
      this.walks.set(wing.id, newWalk(wing, run, this.maze.torches))
    }
    this.room()
  }

  private setWalk(w: Walk): void {
    this.walks.set(w.wingId, w)
  }

  private room(): void {
    const ses = this.session
    const id = this.currentWing as string
    const walk = this.walks.get(id) as Walk
    const wing = this.wing(id)
    const room = roomOf(wing, walk.room) as MazeRoom
    const s = this.s
    const open = new Set(walk.open)
    const name = this.roomLabel(room.name)
    const desc = this.label(room.description)
    const picture = this.assetOf(room.asset)
    const prev = walk.trail.at(-1)

    const doorBtn = (d: MazeDoor, i: number): HTMLElement => {
      const isOpenNow = isOpen(walk, room.id, d.to)
      const target = roomOf(wing, d.to)
      const toName = this.roomName(wing, d.to)
      return h(
        'li',
        { class: 'mm-door-item' },
        h(
          'button',
          {
            type: 'button',
            class: `mm-door ${isOpenNow ? 'is-open' : 'is-locked'}${target?.key ? ' is-key' : ''}`,
            testid: `door-${d.to}`,
            'data-state': isOpenNow ? 'open' : 'locked',
            ...(target?.key ? { 'data-key': 'true' } : {}),
            onclick: () => this.pressDoor(room, d)
          },
          doorSvg(isOpenNow),
          h('span', { class: 'mm-door-num', 'aria-hidden': 'true' }, String(i + 1)),
          h('span', { class: 'mm-door-name' }, toName),
          h('span', { class: 'mm-door-state' }, isOpenNow ? `✓ ${s('maze.door.open')}` : s('maze.door.locked'))
        )
      )
    }

    const doors = room.doors.length
      ? h('section', { class: 'mm-doors', 'aria-labelledby': 'mm-doors-h' }, h('h2', { class: 'sr-only', id: 'mm-doors-h' }, s('maze.doors')), h('ul', { class: 'mm-door-list', testid: 'doors' }, room.doors.map(doorBtn)))
      : null

    const keyBox = room.key
      ? h(
          'div',
          { class: 'mm-keybox' },
          h('span', { class: 'mm-keybox-icon' }, keySvg()),
          h('p', {}, s('maze.keyroom')),
          button('take-key', s('maze.take'), () => this.takeKey(), { class: 'btn btn-primary btn-big' })
        )
      : null

    const back = prev !== undefined ? button('back', `‹ ${s('maze.back', { room: this.roomName(wing, prev) })}`, () => {
          this.setWalk({ ...goBack(walk), mood: 'none' })
          this.room()
        }, { class: 'btn btn-ghost' }) : null

    const notice = walk.ghosted ? h('p', { class: 'mm-notice', role: 'status', testid: 'notice' }, s('maze.notice.ghost')) : null

    const map = layoutRooms(wing)
    const keys = new Set(keyRooms(wing))
    const mapAlt = s('maze.map.alt', { wing: this.label(wing.name), n: wing.rooms.length, here: String(map.nodes.find((n) => n.id === walk.room)?.n ?? 0) })
    const legend = [...map.nodes]
      .sort((a, b) => a.n - b.n)
      .map((n) => {
        const r = roomOf(wing, n.id) as MazeRoom
        const notes = [n.id === walk.room ? s('maze.map.here') : '', keys.has(n.id) ? s('maze.map.key') : ''].filter(Boolean).join(', ')
        return h('li', { class: `mm-legend-item${n.id === walk.room ? ' is-here' : ''}`, 'data-room': n.id }, h('b', {}, `${n.n}.`), ' ', this.roomLabel(r.name), notes ? h('em', {}, ` (${notes})`) : null)
      })
    const mini = h(
      'section',
      { class: 'mm-map', 'aria-labelledby': 'mm-map-h' },
      h('h2', { id: 'mm-map-h' }, s('maze.minimap')),
      h('div', { class: 'mm-parchment' }, miniMapSvg(map, { here: walk.room, open, keys, entry: wing.entry }, mapAlt)),
      h('ol', { class: 'mm-legend', testid: 'minimap-list' }, legend)
    )

    const char = this.characterPanel(room, wing, walk)

    const body = h(
      'section',
      { class: 'room-screen mm-room' },
      h(
        'div',
        { class: 'topbar mm-topbar' },
        button('to-castle', `‹ ${s('maze.to.castle')}`, () => this.castle(), { class: 'btn btn-small btn-ghost' }),
        h('span', { class: 'mm-wing-tag', testid: 'wing-tag' }, s('maze.wing.of', { wing: this.label(wing.name) })),
        torchesEl(walk.torches, walk.maxTorches, s('maze.torches', { n: walk.torches, max: walk.maxTorches }))
      ),
      notice,
      h(
        'div',
        { class: 'mm-layout' },
        h(
          'div',
          { class: 'mm-scene' },
          h('h1', { class: 'screen-title mm-room-name', tabindex: '-1', testid: 'room-name' }, name),
          desc ? h('p', { class: 'mm-room-desc', testid: 'room-desc' }, desc) : null,
          picture ? h('figure', { class: 'mm-room-figure' }, h('img', { src: picture.url, alt: picture.alt, loading: 'lazy' })) : null,
          doors,
          keyBox,
          back ? h('div', { class: 'actions' }, back) : null
        ),
        h('aside', { class: 'mm-side' }, char, mini)
      )
    )
    ses.render('room', body, { unitId: wing.unit, roundKind: 'unit', roundSize: walk.run.size, view: this.roomView() ?? {} })
  }

  private characterPanel(room: MazeRoom, wing: MazeWing, walk: Walk): HTMLElement | null {
    const c = room.character
    if (!c) return null
    const s = this.s
    const name = this.label(c.name)
    const pic = this.assetOf(c.portrait)
    const portrait = portraitFrame(c, pic ? { url: pic.url, alt: s('maze.portrait', { name }) } : null)
    const line = h('p', { class: 'mm-bubble mm-line', testid: 'character-line', hidden: true }, this.label(c.line))
    const hintText = this.hintFor(room, c, walk)
    const hint = h('p', { class: 'mm-bubble mm-hint', testid: 'character-hint', hidden: true }, hintText ?? '')
    const talkBtn = button('talk', s('maze.talk'), () => {
      line.hidden = !line.hidden
      talkBtn.setAttribute('aria-expanded', String(!line.hidden))
    }, { class: 'btn btn-small', 'aria-expanded': 'false' })
    const toggleHint = (): void => {
      hint.hidden = !hint.hidden
      hintBtn?.setAttribute('aria-expanded', String(!hint.hidden))
    }
    const hintBtn = hintText ? button('hint', `💡 ${s('maze.hint')}`, toggleHint, { class: 'btn btn-small', 'aria-expanded': 'false' }) : null
    const reaction = walk.mood === 'none' ? '' : walk.mood === 'cheer' ? this.label(c.right) || s('maze.say.right') : this.label(c.wrong) || s('maze.say.wrong')
    void wing
    return h(
      'section',
      { class: 'mm-char', 'aria-labelledby': 'mm-char-h', 'data-mood': walk.mood },
      portrait,
      h('div', { class: 'mm-char-body' }, h('h2', { class: 'mm-char-name', id: 'mm-char-h', testid: 'character-name' }, name), h('div', { class: 'mm-char-actions' }, talkBtn, hintBtn), line, hint, reaction ? h('p', { class: 'mm-bubble mm-react', testid: 'character-reaction' }, reaction) : null)
    )
  }

  /** The hint for the doors of this room: the character's own, else the hints of the items the shut doors ask (at most three). */
  private hintFor(room: MazeRoom, c: MazeCharacter, walk: Walk): string | null {
    if (c.hint) return this.label(c.hint)
    const ses = this.session
    const out: string[] = []
    for (const d of room.doors) {
      if (isOpen(walk, room.id, d.to)) continue
      for (const id of d.items) {
        const it = ses.item(id)
        if (it?.hint && ses.text.hasText(it.hint)) {
          const t = ses.t(it.hint)
          if (!out.includes(t)) out.push(t)
        }
      }
    }
    return out.length > 0 ? out.slice(0, 3).join(' ') : null
  }

  // ---- a door asks ----

  private pressDoor(room: MazeRoom, door: MazeDoor): void {
    const id = this.currentWing as string
    const walk = this.walks.get(id) as Walk
    if (isOpen(walk, room.id, door.to)) {
      this.setWalk({ ...walkThrough(walk, door.to), mood: 'none' })
      return this.room()
    }
    this.askDoor(room, door)
  }

  private askDoor(room: MazeRoom, door: MazeDoor): void {
    const ses = this.session
    const id = this.currentWing as string
    const wing = this.wing(id)
    const walk = this.walks.get(id) as Walk
    const s = this.s
    const pick = pickForDoor(walk.run, door.items, (rs) => ses.next(rs), ses.rng)
    const item = pick ? ses.item(pick.id) : undefined
    if (!pick || !ses.canAsk(item)) {
      // nothing can be asked here (no question in the pool): the door yields, so nobody is ever locked out
      this.setWalk({ ...walkThrough(openDoor(walk, room.id, door.to), door.to), mood: 'none' })
      return this.room()
    }
    const doorArt = doorSvg(false)
    const torches = torchesEl(walk.torches, walk.maxTorches, s('maze.torches', { n: walk.torches, max: walk.maxTorches }))
    const hud = h(
      'div',
      { class: 'mm-hud' },
      h('div', { class: 'mm-hud-door' }, doorArt),
      h('div', { class: 'mm-hud-text' }, h('p', { class: 'mm-hud-wing' }, this.label(wing.name)), torches)
    )
    ask(ses, {
      item,
      context: 'door',
      retry: pick.retry,
      hud,
      lead: h('span', {}, s('maze.asks', { room: this.roomName(wing, door.to) })),
      unitId: wing.unit,
      roundKind: 'unit',
      roundSize: walk.run.size,
      index: walk.run.results.length,
      view: () => this.roomView() ?? {},
      leaveLabel: s('maze.stepback'),
      onLeave: () => this.room(),
      onAnswered: (o) => {
        let w = this.walks.get(id) as Walk
        // a new answer ends the ghost scene: its notice goes away
        w = { ...w, run: ses.record(w.run, pick, o), ghosted: false }
        const correct = o.result.correct
        w = { ...w, mood: moodAfter(correct, ses.combo) }
        if (correct) {
          w = openDoor(w, room.id, door.to)
          setDoorOpen(doorArt, true)
          this.burst()
        } else {
          w = loseTorch(w).walk
          this.setTorches(torches, w)
        }
        this.setWalk(w)
      },
      effect: (o) => {
        const w = this.walks.get(id) as Walk
        if (o.result.correct) return { text: s('maze.fx.open'), tone: 'good' }
        return w.torches === 0 ? { text: s('maze.fx.dark'), tone: 'bad' } : { text: s('maze.fx.torch', { n: w.torches }), tone: 'bad' }
      },
      nextLabel: (o) => (o.result.correct ? s('maze.next.walk') : (this.walks.get(id) as Walk).torches === 0 ? s('maze.next.ghost') : s('maze.next.room')),
      onNext: (o) => {
        const w = this.walks.get(id) as Walk
        if (o.result.correct) this.setWalk(walkThrough(w, door.to))
        else if (w.torches === 0) this.setWalk(ghostLeads(w, wing.entry))
        this.room()
      }
    })
  }

  private setTorches(el: HTMLElement, w: { torches: number; maxTorches: number }): void {
    el.setAttribute('data-torches', String(w.torches))
    el.setAttribute('aria-label', this.s('maze.torches', { n: w.torches, max: w.maxTorches }))
    el.querySelectorAll('.mm-torch').forEach((t, i) => {
      t.classList.toggle('is-lit', i < w.torches)
      t.classList.toggle('is-out', i >= w.torches)
    })
  }

  /** A streak (3, 5, 7, 10 ...) stamps its lettering over the screen with a puff of sparks (the arena's burst, in the castle's colours). */
  private burst(): void {
    const n = this.session.combo
    if (![3, 5, 7, 10, 15, 20, 30].includes(n)) return
    const layer = this.host.root.querySelector('.burst-layer')
    if (!layer) return
    const dust = Array.from({ length: 12 }, (_v, i) => {
      const angle = (i / 12) * Math.PI * 2 + (i % 2) * 0.22
      const dist = 80 + (i % 3) * 44
      return h('span', { class: 'dust', 'aria-hidden': 'true', style: `--dx:${Math.round(Math.cos(angle) * dist)}px;--dy:${Math.round(Math.sin(angle) * dist)}px;--s:${5 + (i % 4) * 2}px;--delay:${(i % 5) * 30}ms` })
    })
    const el = h('div', { class: 'burst', testid: 'combo-burst' }, this.session.ui('burst', { n }), dust)
    layer.appendChild(el)
    window.setTimeout(() => el.remove(), 1400)
  }

  // ---- the key room: the wing is done ----

  private takeKey(): void {
    const ses = this.session
    const id = this.currentWing as string
    const walk = this.walks.get(id) as Walk
    const wing = this.wing(id)
    const accuracy = ses.accuracy(walk.run)
    const r = ses.recordUnit({ unitId: wing.unit }, accuracy)
    this.walks.delete(id)
    ses.playCue('unit-complete')
    this.wingDone(wing, r.stars, accuracy, r.unlocked, missedIds(walk.run))
  }

  private wingDone(wing: MazeWing, stars: number, accuracy: number, unlocked: string[], misses: string[]): void {
    const ses = this.session
    const s = this.s
    const key = ses.isMastered(wing.unit)
    const opened = this.maze.wings.filter((w) => unlocked.includes(w.unit)).map((w) => this.label(w.name))
    const pct = Math.round(accuracy * 100)
    const body = h(
      'section',
      { class: `wingdone-screen mm-done ${key ? 'is-key' : 'is-crumble'}` },
      h('div', { class: 'mm-done-art', 'aria-hidden': 'true' }, key ? keySvg() : doorSvg(false)),
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'wing-title' }, stars >= 2 || key ? s('maze.done.won') : s('maze.done.crumble')),
      h('p', { class: 'subject' }, this.label(wing.name)),
      ses.stars(stars, 'wing-stars'),
      h('p', { class: 'big-number', testid: 'wing-accuracy' }, s('maze.done.accuracy', { n: pct })),
      key ? h('p', { class: 'message message-ok', testid: 'wing-key' }, s('maze.done.key', { wing: this.label(wing.name) })) : h('p', { class: 'message message-bad', testid: 'wing-crumble' }, s('maze.done.crumble.text')),
      opened.length > 0 ? h('p', { class: 'message', testid: 'wing-unlocked' }, s('maze.done.unlocked', { wings: opened.join(', ') })) : null,
      this.everyKey() ? h('p', { class: 'message message-ok', testid: 'throne-open' }, s('maze.done.throne')) : null,
      misses.length > 0
        ? h(
            'div',
            { class: 'mm-misses' },
            h('h2', {}, s('maze.done.misses')),
            h(
              'ul',
              { class: 'miss-list', testid: 'wing-misses' },
              misses.map((mid) => {
                const item = ses.item(mid)
                const ans = item ? answerLines(item, { text: ses.text, ui: ses.ui }).join(' / ') : ''
                return h('li', { testid: `miss-${mid}` }, h('span', {}, ses.t(item?.prompt ?? mid)), ans ? h('small', { class: 'miss-answer' }, ans.length > 140 ? `${ans.slice(0, 139)}…` : ans) : null)
              })
            )
          )
        : null,
      h(
        'div',
        { class: 'actions actions-center' },
        button('to-castle', s('maze.to.castle'), () => this.castle(), { class: 'btn btn-primary btn-big' }),
        stars < 3 ? button('retry-wing', s('maze.retry'), () => this.enterWing(wing), { class: 'btn btn-big' }) : null
      )
    )
    ses.render('wing-done', body, { unitId: wing.unit, roundKind: 'unit', view: { wing: wing.id, stars, key, accuracy: pct, unlocked, misses } })
  }

  // ---- the throne room ----

  private throneIntro(): void {
    const ses = this.session
    const s = this.s
    this.throne = null
    const body = h(
      'section',
      { class: 'throne-screen mm-throne' },
      h('div', { class: 'topbar' }, button('to-castle', `‹ ${s('maze.to.castle')}`, () => this.castle(), { class: 'btn btn-small btn-ghost' }), h('span', { class: 'topbar-stars' }, s('maze.keys', { n: this.keysWon(), total: this.maze.wings.length }))),
      h('div', { class: 'mm-throne-art', 'aria-hidden': 'true' }, throneSvg(this.crowned())),
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'throne-title' }, this.label(this.maze.throne.name) || s('maze.throne.name')),
      h('p', { class: 'mm-room-desc' }, this.label(this.maze.throne.description) || s('maze.throne.desc')),
      this.crowned() ? h('p', { class: 'message message-ok', testid: 'throne-crowned' }, s('maze.throne.crowned')) : null,
      ses.stars(ses.bossStars(), 'throne-stars'),
      h(
        'div',
        { class: 'actions actions-center' },
        button('throne-begin', s('maze.throne.begin'), () => this.startThrone(), { class: 'btn btn-primary btn-big' }),
        this.crowned() ? button('finish', s('maze.throne.finish'), () => this.end(), { class: 'btn btn-big' }) : null
      )
    )
    ses.render('throne', body, { view: this.throneView('intro') })
  }

  private startThrone(): void {
    const ses = this.session
    const pool = ses.pack.items.map((i) => i.id)
    const run = ses.startRun(pool, { kind: 'boss', size: Math.min(this.maze.throne.size, pool.length) })
    this.throne = { run, torches: this.maze.torches, max: this.maze.torches, relit: false }
    this.throneStep()
  }

  private throneStep(): void {
    const ses = this.session
    const t = this.throne
    if (!t) return this.throneIntro()
    const s = this.s
    const pick = ses.next(t.run)
    if (!pick) return this.throneResult()
    const item = ses.item(pick.id)
    if (!ses.canAsk(item)) {
      // cannot be shown: leave it out of the run
      t.run = { ...t.run, pool: t.run.pool.filter((id) => id !== pick.id), size: Math.max(0, t.run.size - 1) }
      return this.throneStep()
    }
    const torches = torchesEl(t.torches, t.max, s('maze.torches', { n: t.torches, max: t.max }))
    const hud = h('div', { class: 'mm-hud mm-hud-throne' }, h('div', { class: 'mm-hud-door' }, throneSvg(false)), h('div', { class: 'mm-hud-text' }, h('p', { class: 'mm-hud-wing' }, this.label(this.maze.throne.name) || s('maze.throne.name')), torches))
    ask(ses, {
      item,
      context: 'throne',
      retry: pick.retry,
      hud,
      lead: h('span', {}, s('maze.throne.step', { i: Math.min(t.run.asked.length + (pick.retry ? 0 : 1), t.run.size), n: t.run.size })),
      roundKind: 'boss',
      roundSize: t.run.size,
      index: t.run.results.length,
      view: () => this.throneView('question'),
      leaveLabel: s('maze.stepback'),
      onLeave: () => this.throneIntro(),
      onAnswered: (o) => {
        t.run = ses.record(t.run, pick, o)
        t.relit = false
        if (o.result.correct) this.burst()
        else {
          t.torches = Math.max(0, t.torches - 1)
          // the last torch dies and the ghost relights them all: the gauntlet is never lost, only harder to win stars in
          if (t.torches === 0) {
            t.torches = t.max
            t.relit = true
          }
          this.setTorches(torches, { torches: t.torches, maxTorches: t.max })
        }
      },
      effect: (o) => (o.result.correct ? { text: s('maze.fx.t.right'), tone: 'good' } : t.relit ? { text: s('maze.fx.t.relit'), tone: 'info' } : { text: s('maze.fx.t.torch', { n: t.torches }), tone: 'bad' }),
      nextLabel: s('maze.next.throne'),
      onNext: () => this.throneStep()
    })
  }

  private throneResult(): void {
    const ses = this.session
    const t = this.throne as Throne
    const s = this.s
    const accuracy = ses.accuracy(t.run)
    const r = ses.recordUnit({ boss: true }, accuracy)
    ses.playCue('boss')
    const won = this.crowned()
    const misses = missedIds(t.run)
    const pct = Math.round(accuracy * 100)
    const body = h(
      'section',
      { class: `throne-screen mm-throne ${won ? 'is-won' : 'is-lost'}` },
      h('div', { class: 'mm-throne-art', 'aria-hidden': 'true' }, throneSvg(r.stars >= 1)),
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'throne-title' }, r.stars >= 1 ? s('maze.throne.won') : s('maze.throne.lost')),
      ses.stars(r.stars, 'throne-stars'),
      h('p', { class: 'big-number', testid: 'throne-accuracy' }, s('maze.done.accuracy', { n: pct })),
      r.stars >= 1 ? null : h('p', { class: 'message message-bad', testid: 'throne-lost' }, s('maze.throne.lost.text')),
      misses.length > 0
        ? h(
            'div',
            { class: 'mm-misses' },
            h('h2', {}, s('maze.done.misses')),
            h(
              'ul',
              { class: 'miss-list', testid: 'throne-misses' },
              misses.map((mid) => {
                const item = ses.item(mid)
                const ans = item ? answerLines(item, { text: ses.text, ui: ses.ui }).join(' / ') : ''
                return h('li', { testid: `miss-${mid}` }, h('span', {}, ses.t(item?.prompt ?? mid)), ans ? h('small', { class: 'miss-answer' }, ans.length > 140 ? `${ans.slice(0, 139)}…` : ans) : null)
              })
            )
          )
        : null,
      h(
        'div',
        { class: 'actions actions-center' },
        won ? button('finish', s('maze.throne.finish'), () => this.end(), { class: 'btn btn-primary btn-big' }) : null,
        r.stars < 3 ? button('retry-throne', s('maze.throne.retry'), () => this.startThrone(), { class: won ? 'btn btn-big' : 'btn btn-primary btn-big' }) : null,
        button('to-castle', s('maze.to.castle'), () => this.castle(), { class: 'btn btn-big' })
      )
    )
    ses.render('throne', body, { view: this.throneView('result', { stars: r.stars, accuracy: pct, misses }) })
  }

  // ---- the end ----

  private end(): void {
    const ses = this.session
    const s = this.s
    ses.finish()
    this.currentWing = null
    ses.render(
      'end',
      endScreen(ses, {
        title: s('maze.end.title'),
        sub: s('maze.end.sub'),
        stats: h('p', { class: 'subject', testid: 'end-keys' }, s('maze.end.keys', { n: this.keysWon(), total: this.maze.wings.length })),
        onAgain: () => this.castle(),
        onTitle: () => this.title()
      }),
      { view: { keys: this.keysWon(), total: this.maze.wings.length, crowned: this.crowned() } }
    )
  }
}

export const mindmazeShell: Shell = (() => {
  let game: MindMaze | null = null
  return {
    id: SHELL_ID,
    mount(host: ShellHost) {
      game = new MindMaze(host)
      game.mount()
    },
    unmount() {
      game?.unmount()
      game = null
    }
  }
})()
