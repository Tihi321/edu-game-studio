import '../../../design/themes/pixel.css'
import './rpg.css'
import { buildLayout, unitItemIds, type RpgArea, type RpgLayout, type RpgSection } from '../../../shared/shells/rpg-layout'
import { tileAt, type Dir, type Pos } from '../../../shared/shells/rpg-map'
import { button, h, isTyping } from '../../dom'
import { ask } from '../../kit/question'
import { endScreen, newTitleState, titleScreen } from '../../kit/screens'
import { ShellSession } from '../../kit/session'
import type { NextQuestion, RoundState } from '../../round'
import type { Shell, ShellHost } from '../../types'
import { BOSS_STRIKE, FOE_STRIKE, HERO_MAX_HP, newBattle, resolveTurn, type Battle, type Turn } from './battle'
import { drawMini, emptySkin, loadImage, readPalette, WorldCanvas, type Palette, type Scene, type SceneEntity, type Skin } from './draw'
import {
  dirBetween,
  nearby,
  newAreaProgress,
  nextGoal,
  pathToTarget,
  peopleOf,
  questAccuracy,
  replayProgress,
  stageOf,
  stepFrom,
  targetsOf,
  tryStep,
  type AreaProgress,
  type Person
} from './model'
import { APPRENTICE, BOSS, FOES, HERO, SAGE, type Sprite } from './sprites'
import { RPG_STRINGS, type RpgKey } from './strings'
import { battleScene, hpLine, portrait, type HpLine } from './ui'

/**
 * The RPG quest shell (EGS-12): a tile-map world drawn on a Canvas 2D (procedural pixel art, no game engine), people to talk to, battles
 * where every move is an answer, a final boss over every unit.
 *
 * title -> intro (the frame story) -> areas (one per unit) -> world (walk, talk) -> dialogue (the sage gives the quest) -> battle (a foe,
 * then the area boss; every turn is an `ask()`) -> quest-done (stars, the gate) -> ... -> the final boss (`boss`) -> outro -> end.
 * The learning logic is the kit's (`ShellSession`: runs, answers, stars); the rules are pure and tested: `battle.ts` (damage, streak,
 * partial credit), `model.ts` (who stands where, the next goal), `src/shared/shells/rpg-map.ts` and `rpg-layout.ts` (map, layout). Screens
 * and test ids: docs/player.md, "RPG quest".
 */

const SHELL_ID = 'rpg'
const THEME_ID = 'pixel'
const HEAL_ON_WIN = 40
const STEP_MS = 70

type Ses = ShellSession<RpgKey>

/** A fight in progress: a foe, an area boss or the final boss. */
interface Fight {
  id: string
  kind: 'foe' | 'boss' | 'final'
  area: RpgArea | null
  name: string
  sprite: Sprite
  items: string[]
  size: number
  battle: Battle
  run: RoundState
  /** The questions of this attempt still count for the stars (the first pass over the items). */
  scoring: boolean
  /** The quest's stars take this fight's first answers (it is the first time the foe is fought). */
  counts: boolean
  scores: number[]
  last: Turn | null
  newScroll: boolean
}

interface WorldState {
  area: RpgArea
  p: AreaProgress
  canvas: WorldCanvas
  surroundings: HTMLElement
  message: HTMLElement
  talk: HTMLButtonElement
  hp: HpLine
  walking: boolean
  step: number
  timer: number
}

const strHash = (s: string): number => {
  let x = 2166136261
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619)
  return x >>> 0
}

const DIR_KEYS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', W: 'up', s: 'down', S: 'down', a: 'left', A: 'left', d: 'right', D: 'right' }

class Rpg {
  private readonly session: Ses
  private readonly layout: RpgLayout
  private readonly titleState = newTitleState()
  private readonly progress = new Map<string, AreaProgress>()
  private palette: Palette | null = null
  private skin: Skin = emptySkin()
  private scrolls: string[] = []
  private hp = HERO_MAX_HP
  private w: WorldState | null = null
  private message = ''
  private event = ''
  private readonly reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(private readonly host: ShellHost) {
    this.session = new ShellSession<RpgKey>(host, { shellId: SHELL_ID, theme: THEME_ID, strings: RPG_STRINGS })
    this.layout = buildLayout(this.session.pack, this.session.section<RpgSection>())
    this.loadScrolls()
  }

  private get s(): Ses['s'] {
    return this.session.s
  }

  private get pal(): Palette {
    this.palette ??= readPalette(this.host.root)
    return this.palette
  }

  mount(): void {
    const ses = this.session
    ses.mount()
    ses.setKeyHandler((e) => this.onKey(e))
    ses.setDebug({
      nextGoal: () => this.debugGoal(),
      pathTo: (id: string) => this.debugPath(id),
      layout: () => this.layoutSummary(),
      view: () => this.currentView()
    })
    void this.loadSkin()
    this.title()
  }

  unmount(): void {
    this.leaveWorld()
    this.session.unmount()
  }

  // ---- words and lookups ----

  private heroName(): string {
    return this.layout.heroNameKey ? this.session.t(this.layout.heroNameKey) : this.s('rpg.hero.default')
  }

  private areaName(a: RpgArea): string {
    return a.nameKey ? this.session.t(a.nameKey) : this.session.unitTitle(a.unitId)
  }

  private foeName(a: RpgArea, id: string): string {
    const f = a.foes.find((x) => x.id === id)
    if (!f) return id
    return f.nameKey ? this.session.t(f.nameKey) : this.s(`rpg.auto.foe.${((f.n - 1) % 4) + 1}` as RpgKey)
  }

  private bossName(a: RpgArea): string {
    return a.boss.nameKey ? this.session.t(a.boss.nameKey) : this.s('rpg.auto.boss', { unit: this.session.unitTitle(a.unitId) })
  }

  private npcName(a: RpgArea, id: string): string {
    const n = a.npcs.find((x) => x.id === id)
    if (!n) return id
    return n.nameKey ? this.session.t(n.nameKey) : this.s('rpg.auto.sage')
  }

  private personName(a: RpgArea, q: Person): string {
    return q.kind === 'npc' ? this.npcName(a, q.id) : q.kind === 'foe' ? this.foeName(a, q.id) : this.bossName(a)
  }

  private finalName(): string {
    return this.layout.finalBoss.nameKey ? this.session.t(this.layout.finalBoss.nameKey) : this.s('rpg.auto.final')
  }

  private giverOf(a: RpgArea): RpgArea['npcs'][number] | undefined {
    return a.npcs.find((n) => n.quest) ?? a.npcs[0]
  }

  private gateOpen(a: RpgArea): boolean {
    return this.session.isMastered(a.unitId)
  }

  private progressOf(a: RpgArea): AreaProgress {
    let p = this.progress.get(a.id)
    if (!p) {
      p = newAreaProgress(a)
      this.progress.set(a.id, p)
    }
    return p
  }

  private assetOf(id: string | undefined): { url: string; alt: string } | null {
    if (!id) return null
    const url = this.session.data.assets[id]
    const a = this.session.pack.assets.find((x) => x.id === id)
    return url && a ? { url, alt: this.session.t(a.alt) } : null
  }

  private async loadSkin(): Promise<void> {
    const ses = this.session
    const url = (id: string | undefined): string | undefined => (id ? ses.data.assets[id] : undefined)
    const [tiles, hero, npc, foe, boss] = await Promise.all([
      loadImage(url(this.layout.tileset)),
      loadImage(url(this.layout.sprites.hero)),
      loadImage(url(this.layout.sprites.npc)),
      loadImage(url(this.layout.sprites.foe)),
      loadImage(url(this.layout.sprites.boss))
    ])
    const skin: Skin = { sprites: {} }
    if (tiles) skin.tiles = tiles
    if (hero) skin.sprites.hero = hero
    if (npc) skin.sprites.npc = npc
    if (foe) skin.sprites.foe = foe
    if (boss) skin.sprites.boss = boss
    this.skin = skin
  }

  // ---- the scrolls: the facts learned, kept in the shell's saved data ----

  private loadScrolls(): void {
    const saved = this.session.shellData<{ scrolls?: unknown }>()
    const ids = Array.isArray(saved?.scrolls) ? (saved.scrolls as unknown[]) : []
    this.scrolls = ids.filter((id): id is string => typeof id === 'string' && !!this.session.item(id))
  }

  /** Adds the scroll of an item (its did-you-know, else its explanation); false when it was there already or says nothing. */
  private addScroll(itemId: string): boolean {
    if (this.scrolls.includes(itemId) || !this.scrollText(itemId)) return false
    this.scrolls = [...this.scrolls, itemId]
    this.session.setShellData({ scrolls: this.scrolls })
    return true
  }

  private scrollText(itemId: string): string {
    const ses = this.session
    const it = ses.item(itemId)
    if (!it) return ''
    if (it.didYouKnow && ses.text.hasText(it.didYouKnow)) return ses.t(it.didYouKnow)
    return it.explanation && ses.text.hasText(it.explanation) ? ses.t(it.explanation) : ''
  }

  // ---- the frame story ----

  private introLines(): string[] {
    const keys = this.layout.intro
    if (keys.length > 0) return keys.map((k) => this.session.t(k))
    return [this.s('rpg.auto.intro.1'), this.s('rpg.auto.intro.2', { hero: this.heroName() }), this.s('rpg.auto.intro.3')]
  }

  private outroLines(): string[] {
    const keys = this.layout.outro
    return keys.length > 0 ? keys.map((k) => this.session.t(k)) : [this.s('rpg.auto.outro.1')]
  }

  // ---- the debug helpers of the bot (read-only) ----

  private worldView(a: RpgArea, p: AreaProgress, walking: boolean): Record<string, unknown> {
    const gateOpen = this.gateOpen(a)
    return {
      area: a.id,
      areaIndex: this.layout.areas.indexOf(a),
      unit: a.unitId,
      size: [Math.max(...a.rows.map((r) => r.length)), a.rows.length],
      pos: [p.pos[0], p.pos[1]],
      face: p.face,
      hp: this.hp,
      maxHp: HERO_MAX_HP,
      stage: stageOf(a, p),
      accepted: p.accepted,
      done: p.done,
      gateOpen,
      foesLeft: a.foes.filter((f) => !p.foesDown.includes(f.id)).map((f) => f.id),
      foesDown: [...p.foesDown],
      bossDown: p.bossDown,
      nearby: nearby(a, p).map((q) => q.id),
      targets: targetsOf(a, p).map((t) => t.testid),
      walking,
      scrolls: this.scrolls.length,
      event: this.event,
      goal: nextGoal(a, p, gateOpen)
    }
  }

  private currentView(): Record<string, unknown> | null {
    const w = this.w
    return w ? this.worldView(w.area, w.p, w.walking) : null
  }

  private debugGoal(): Record<string, unknown> | null {
    const w = this.w
    return w ? { ...nextGoal(w.area, w.p, this.gateOpen(w.area)) } : null
  }

  private debugPath(id: string): Record<string, unknown> | null {
    const w = this.w
    if (!w) return null
    const path = pathToTarget(w.area, w.p, id, this.gateOpen(w.area))
    return { id, found: path !== null, steps: path?.length ?? -1, path: (path ?? []).map((q) => [q[0], q[1]]) }
  }

  private layoutSummary(): Record<string, unknown> {
    return {
      authored: this.layout.authored,
      areas: this.layout.areas.map((a) => ({
        id: a.id,
        unit: a.unitId,
        auto: a.auto,
        size: [Math.max(...a.rows.map((r) => r.length)), a.rows.length],
        npcs: a.npcs.map((n) => n.id),
        foes: a.foes.map((f) => ({ id: f.id, hp: f.hp, items: f.items })),
        boss: { id: a.boss.id, hp: a.boss.hp },
        gate: a.gate ? [a.gate[0], a.gate[1]] : null
      })),
      finalBoss: this.layout.finalBoss
    }
  }

  // ---- screens: drawing ----

  private leaveWorld(): void {
    const w = this.w
    if (!w) return
    window.clearTimeout(w.timer)
    w.canvas.destroy()
    this.w = null
  }

  private show(screen: string, body: HTMLElement, extra: Parameters<Ses['render']>[2] = {}): HTMLElement {
    this.leaveWorld()
    return this.session.render(screen, body, extra)
  }

  private takeMessage(): string {
    const m = this.message
    this.message = ''
    return m
  }

  // ---- title ----

  private title(): void {
    const ses = this.session
    ses.finished = false
    this.event = ''
    this.show('title', titleScreen(ses, { onStart: () => (this.hasPlayed() ? this.areas() : this.story('intro', 0)) }, () => this.title(), this.titleState))
  }

  private hasPlayed(): boolean {
    const sp = this.session.sp
    return Object.keys(sp.units).length > 0 || sp.boss.stars > 0 || this.scrolls.length > 0
  }

  // ---- the story ----

  private story(kind: 'intro' | 'outro', page: number): void {
    const s = this.s
    const lines = kind === 'intro' ? this.introLines() : this.outroLines()
    const i = Math.max(0, Math.min(page, lines.length - 1))
    const last = i >= lines.length - 1
    const proceed = (): void => (kind === 'intro' ? this.areas() : this.end())
    const hero = this.heroName()
    const body = h(
      'section',
      { class: 'rpg-story' },
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'story-title' }, kind === 'intro' ? s('rpg.intro.title') : s('rpg.outro.title')),
      h(
        'div',
        { class: 'rpg-speaker' },
        portrait({ sprite: HERO, pal: this.pal, image: this.assetOf(this.layout.sprites.hero), alt: s('rpg.story.alt', { name: hero }) }),
        h('div', { class: 'rpg-textbox', testid: 'story-text' }, h('p', {}, lines[i] ?? ''), h('span', { class: 'rpg-count' }, s('rpg.story.count', { n: i + 1, total: lines.length })))
      ),
      h(
        'div',
        { class: 'rpg-actions' },
        last ? button('story-next', kind === 'intro' ? s('rpg.story.begin') : s('rpg.story.end'), proceed, { class: 'btn btn-primary btn-big', 'data-autofocus': '' }) : button('story-next', s('rpg.story.next'), () => this.story(kind, i + 1), { class: 'btn btn-primary btn-big', 'data-autofocus': '' }),
        last ? null : button('story-skip', s('rpg.story.skip'), proceed, { class: 'btn btn-ghost' })
      )
    )
    this.show(kind, body, { view: { page: i, total: lines.length, last } })
  }

  // ---- the world map of areas ----

  private areas(): void {
    const ses = this.session
    const s = this.s
    const allDone = ses.allMastered()
    const note = this.takeMessage()
    const card = (a: RpgArea): HTMLElement => {
      const locked = !ses.isUnlocked(a.unitId)
      const stars = ses.unitStars(a.unitId)
      const mastered = ses.isMastered(a.unitId)
      const reqs = (ses.pack.units.find((u) => u.id === a.unitId)?.requires ?? []).filter((r) => !ses.isMastered(r)).map((r) => ses.unitTitle(r))
      const mini = h('canvas', { class: 'rpg-mini', width: 192, height: Math.round((192 * a.rows.length) / Math.max(...a.rows.map((r) => r.length))), role: 'img', 'aria-label': s('rpg.mini.alt', { area: this.areaName(a) }) })
      drawMini(mini, this.pal, a.rows, [
        ...a.npcs.map((n) => ({ at: n.at, kind: 'giver' as const })),
        ...a.foes.map((f) => ({ at: f.at, kind: 'foe' as const })),
        { at: a.boss.at, kind: 'boss' as const }
      ])
      const b = button(
        `area-${a.id}`,
        [
          mini,
          h('span', { class: 'rpg-area-title' }, this.areaName(a)),
          h('span', { class: 'rpg-area-unit' }, ses.unitTitle(a.unitId)),
          locked ? h('span', { class: 'rpg-area-need' }, s('rpg.area.locked', { units: reqs.join(', ') })) : mastered ? h('span', { class: 'rpg-area-need' }, s('rpg.area.mastered')) : h('span', { class: 'rpg-area-need' }, s('rpg.area.quest')),
          ses.stars(stars)
        ],
        () => this.enterArea(a),
        { class: `rpg-area-card${locked ? ' is-locked' : ''}${mastered ? ' is-mastered' : ''}`, 'data-stars': String(stars), 'data-locked': String(locked), 'data-unit': a.unitId, ...(locked ? { disabled: true } : {}) }
      )
      return h('li', {}, b)
    }
    const crowned = ses.bossStars() >= 1
    const finalCard = h(
      'div',
      { class: 'rpg-panel rpg-final' },
      h('h2', {}, s('rpg.final.title')),
      h('p', {}, allDone ? s('rpg.final.ready') : s('rpg.final.locked')),
      ses.stars(ses.bossStars(), 'final-stars'),
      h(
        'div',
        { class: 'rpg-actions' },
        button('final-boss', s('rpg.final.go'), () => this.finalIntro(), { class: 'btn btn-primary', 'data-stars': String(ses.bossStars()), 'data-locked': String(!allDone), ...(allDone ? {} : { disabled: true }) }),
        crowned ? button('finish', s('rpg.final.finish'), () => this.story('outro', 0), { class: 'btn' }) : null
      )
    )
    const body = h(
      'section',
      { class: 'rpg-areas' },
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'areas-title' }, s('rpg.areas.title')),
      h('p', { class: 'subject' }, s('rpg.areas.intro')),
      note ? h('p', { class: 'rpg-note rpg-message', role: 'status', testid: 'message' }, note) : null,
      h('ul', { class: 'rpg-area-list', testid: 'area-list' }, this.layout.areas.map(card)),
      finalCard,
      h(
        'div',
        { class: 'rpg-actions' },
        button('inventory', s('rpg.inventory', { n: this.scrolls.length }), () => this.inventory(() => this.areas()), { class: 'btn' }),
        button('to-title', s('rpg.to.title'), () => this.title(), { class: 'btn btn-ghost' })
      )
    )
    this.show('areas', body, {
      view: {
        areas: this.layout.areas.map((a) => ({ id: a.id, unit: a.unitId, locked: !ses.isUnlocked(a.unitId), stars: ses.unitStars(a.unitId) })),
        finalOpen: allDone,
        crowned,
        scrolls: this.scrolls.length,
        event: this.event
      }
    })
  }

  private enterArea(a: RpgArea): void {
    this.hp = HERO_MAX_HP
    this.event = 'entered'
    this.world(a)
  }

  // ---- the world ----

  private surroundingsText(a: RpgArea, p: AreaProgress): string {
    const s = this.s
    const where = s('rpg.where', { area: this.areaName(a), x: p.pos[0] + 1, y: p.pos[1] + 1 })
    const near = nearby(a, p)
    if (near.length === 0) return `${where} ${s('rpg.near.none')}`
    const side = (q: Person): string => {
      const d = dirBetween(p.pos, q.at)
      return s(`rpg.side.${d}` as RpgKey)
    }
    return `${where} ${s('rpg.near', { names: near.map((q) => `${this.personName(a, q)} (${side(q)})`).join(', ') })}`
  }

  private sceneOf(w: Pick<WorldState, 'area' | 'p' | 'step'>): Scene {
    const { area: a, p } = w
    const entities: SceneEntity[] = peopleOf(a, p).map((q) => {
      if (q.kind === 'npc') return { at: q.at, kind: q.giver ? ('giver' as const) : ('npc' as const), n: 1, ...(q.giver && !p.accepted ? { mark: true } : {}) }
      if (q.kind === 'foe') return { at: q.at, kind: 'foe' as const, n: a.foes.find((f) => f.id === q.id)?.n ?? 1 }
      return { at: q.at, kind: 'boss' as const, n: 1 }
    })
    return { hero: p.pos, face: p.face, step: w.step, entities, gateOpen: this.gateOpen(a) }
  }

  private world(a: RpgArea): void {
    const ses = this.session
    const s = this.s
    const p = this.progressOf(a)
    this.leaveWorld()
    const gateOpen = this.gateOpen(a)
    const giver = this.giverOf(a)

    const hp = hpLine((v, m) => s('rpg.hp', { hp: v, max: m }), this.hp, HERO_MAX_HP, 'hero', 'hero-hp')
    const host = h('div', { class: 'rpg-canvas-host' })
    const surroundings = h('p', { class: 'rpg-surroundings', 'aria-live': 'polite', testid: 'surroundings' }, this.surroundingsText(a, p))
    const message = h('p', { class: 'rpg-message', testid: 'message' }, this.takeMessage())
    const talk = button('talk', s('rpg.talk'), () => this.talk(), { class: 'pad-btn pad-talk', 'aria-disabled': 'true' })

    const padBtn = (dir: Dir, glyph: string): HTMLElement => button(`move-${dir}`, glyph, () => this.move(dir), { class: `pad-btn pad-${dir}`, 'aria-label': s(`rpg.move.${dir}` as RpgKey) })
    const pad = h('div', { class: 'rpg-panel' }, h('h2', {}, s('rpg.pad')), h('div', { class: 'rpg-pad', role: 'group', 'aria-label': s('rpg.pad') }, padBtn('up', '▲'), padBtn('left', '◀'), talk, padBtn('right', '▶'), padBtn('down', '▼')), h('p', { class: 'rpg-keys' }, s('rpg.keys')))

    const targets = targetsOf(a, p)
    const targetBtn = (t: (typeof targets)[number]): HTMLElement => {
      const q = peopleOf(a, p).find((x) => x.goto === t.testid)
      const label = t.kind === 'gate' ? s('rpg.goto.gate') : s('rpg.goto', { name: q ? this.personName(a, q) : t.id })
      return h('li', {}, button(t.testid, label, () => this.gotoTarget(t.testid), { class: 'btn btn-small', 'data-kind': t.kind }))
    }
    const targetPanel = h('div', { class: 'rpg-panel' }, h('h2', {}, s('rpg.targets')), h('ul', { class: 'rpg-targets', testid: 'targets' }, targets.map(targetBtn)))

    const foesDone = a.foes.filter((f) => p.foesDown.includes(f.id)).length
    const step = (id: string, text: string, done: boolean): HTMLElement =>
      h('li', { class: done ? 'is-done' : '', testid: `quest-${id}`, 'data-done': String(done) }, h('span', { class: 'tick', 'aria-hidden': 'true' }, done ? '✔' : '○'), h('span', {}, text), h('span', { class: 'sr-only' }, done ? ` (${s('rpg.quest.done')})` : ` (${s('rpg.quest.todo')})`))
    const questLog = h(
      'div',
      { class: 'rpg-panel rpg-quest', testid: 'quest-log' },
      h('h2', {}, s('rpg.quest.title')),
      h('ol', {}, step('talk', s('rpg.quest.talk', { name: giver ? this.npcName(a, giver.id) : '' }), p.accepted), a.foes.length > 0 ? step('foes', s('rpg.quest.foes', { done: foesDone, total: a.foes.length }), foesDone === a.foes.length && p.accepted) : null, step('boss', s('rpg.quest.boss', { name: this.bossName(a) }), p.bossDown), a.gate ? step('gate', s('rpg.quest.gate'), gateOpen) : null)
    )

    const body = h(
      'section',
      { class: 'rpg-world' },
      h(
        'header',
        { class: 'rpg-hud' },
        h('h1', { class: 'screen-title rpg-area-name', tabindex: '-1', testid: 'area-name' }, this.areaName(a)),
        h('div', { class: 'rpg-hud-tools' }, hp.el, button('inventory', s('rpg.inventory', { n: this.scrolls.length }), () => this.inventory(() => this.world(a)), { class: 'btn btn-small' }), button('to-areas', s('rpg.to.areas'), () => this.areas(), { class: 'btn btn-small' }))
      ),
      h('div', { class: 'rpg-stage' }, h('div', { class: 'rpg-view' }, host, surroundings, h('div', { class: 'rpg-note' }, message), questLog), h('aside', { class: 'rpg-side' }, pad, targetPanel))
    )
    this.session.render('world', body, { unitId: a.unitId, view: this.worldView(a, p, false) })

    const canvas = new WorldCanvas({ area: a, pal: this.pal, seed: strHash(`${ses.pack.id}:${a.id}`) % 997, reduced: this.reduced, skin: this.skin })
    canvas.canvas.setAttribute('role', 'img')
    canvas.canvas.setAttribute('aria-label', s('rpg.map.label', { area: this.areaName(a) }))
    canvas.canvas.setAttribute('data-testid', 'world-canvas')
    host.appendChild(canvas.canvas)
    const w: WorldState = { area: a, p, canvas, surroundings, message, talk, hp, walking: false, step: 0, timer: 0 }
    this.w = w
    canvas.fit(host)
    this.refresh()
  }

  /** Draws the world again after a step or a message: the picture, the text alternative, the talk button, the published state. */
  private refresh(): void {
    const w = this.w
    if (!w) return
    const { area: a, p } = w
    w.canvas.setScene(this.sceneOf(w))
    w.surroundings.textContent = this.surroundingsText(a, p)
    const near = nearby(a, p)[0]
    w.talk.textContent = near && near.kind !== 'npc' ? this.s('rpg.fight') : this.s('rpg.talk')
    w.talk.setAttribute('aria-disabled', String(!near))
    w.hp.set(this.hp, HERO_MAX_HP)
    this.session.publish('world', { unitId: a.unitId, view: this.worldView(a, p, w.walking) })
  }

  private say(text: string, event = ''): void {
    const w = this.w
    this.event = event
    if (w) w.message.textContent = text
    this.session.live(text)
    this.refresh()
  }

  private onKey(e: KeyboardEvent): void {
    const w = this.w
    if (!w || this.session.screen !== 'world' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
    const dir = DIR_KEYS[e.key]
    if (dir) {
      e.preventDefault()
      this.move(dir)
      return
    }
    if (e.key === 'Enter') {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'BUTTON' || t.tagName === 'A')) return // Enter on a focused button uses that button
      e.preventDefault()
      this.talk()
    }
  }

  private move(dir: Dir): void {
    const w = this.w
    if (!w || w.walking) return
    const { area: a, p } = w
    p.face = dir
    const st = tryStep(a, p, dir, this.gateOpen(a))
    if (st.kind === 'move') {
      p.pos = st.pos
      w.step = w.step === 0 ? 1 : 0
      this.event = 'moved'
      this.refresh()
    } else if (st.kind === 'bump') this.interact(st.person)
    else if (st.kind === 'gate') this.areas()
    else if (tileAt(a.rows, stepFrom(p.pos, dir)) === 'G') this.say(this.s('rpg.msg.gate.shut'), 'gate-shut')
    else this.refresh()
  }

  private talk(): void {
    const w = this.w
    if (!w || w.walking) return
    const near = nearby(w.area, w.p)[0]
    if (!near) return this.say(this.s('rpg.talk.none'), 'nobody')
    w.p.face = dirBetween(w.p.pos, near.at)
    this.interact(near)
  }

  private interact(q: Person): void {
    const w = this.w
    if (!w) return
    const { area: a, p } = w
    if (q.kind === 'npc') return this.dialogue(a, q.id, 0)
    const giver = this.giverOf(a)
    if (stageOf(a, p) === 'talk' && giver) return this.say(this.s('rpg.msg.need.giver', { name: this.npcName(a, giver.id) }), 'need-giver')
    const left = a.foes.filter((f) => !p.foesDown.includes(f.id)).length
    if (q.kind === 'boss' && left > 0) return this.say(this.s('rpg.msg.need.foes', { n: left }), 'need-foes')
    this.startBattle(a, q)
  }

  /** Walks the hero to a person or the gate (the `goto-` buttons): the shortest path, step by step unless the learner prefers reduced motion. */
  private gotoTarget(testid: string): void {
    const w = this.w
    if (!w || w.walking) return
    const { area: a, p } = w
    const open = this.gateOpen(a)
    const path = pathToTarget(a, p, testid, open)
    if (!path) return this.say(this.s('rpg.msg.noway'), 'noway')
    const target = targetsOf(a, p).find((t) => t.testid === testid)
    const finish = (): void => {
      w.walking = false
      if (target) p.face = dirBetween(p.pos, target.at)
      if (target?.kind === 'gate' && open && a.gate && p.pos[0] === a.gate[0] && p.pos[1] === a.gate[1]) return this.areas()
      this.say('', 'arrived')
    }
    if (path.length === 0) return finish()
    w.walking = true
    if (this.reduced) {
      for (let i = 0; i < path.length; i++) {
        const next = path[i] as Pos
        p.face = dirBetween(p.pos, next)
        p.pos = next
      }
      return finish()
    }
    this.event = 'walking'
    this.refresh()
    const stepOnce = (i: number): void => {
      if (this.w !== w) return
      const next = path[i] as Pos
      p.face = dirBetween(p.pos, next)
      p.pos = next
      w.step = w.step === 0 ? 1 : 0
      this.refresh()
      if (i + 1 < path.length) w.timer = window.setTimeout(() => stepOnce(i + 1), STEP_MS)
      else finish()
    }
    stepOnce(0)
  }

  // ---- dialogue ----

  private dialogueLines(a: RpgArea, n: RpgArea['npcs'][number]): string[] {
    const s = this.s
    const p = this.progressOf(a)
    const ses = this.session
    const stage = stageOf(a, p)
    const boss = this.bossName(a)
    const left = a.foes.filter((f) => !p.foesDown.includes(f.id)).length
    const hint = !n.quest ? null : stage === 'foes' ? s('rpg.sage.hint', { n: left, boss }) : stage === 'boss' ? s('rpg.sage.boss', { boss }) : stage === 'done' ? (this.gateOpen(a) ? s('rpg.sage.done') : s('rpg.sage.retry')) : null
    if (n.lines.length === 0) {
      // the automatic sage speaks from the shell's own words
      const intro = [s('rpg.auto.sage.1', { hero: this.heroName(), unit: ses.unitTitle(a.unitId) }), s('rpg.auto.sage.2', { n: a.foes.length, boss }), s('rpg.auto.sage.3')]
      return stage === 'talk' ? intro : [hint ?? intro[0] ?? '']
    }
    const own = n.lines.map((k) => ses.t(k))
    return hint ? [...own, hint] : own
  }

  private dialogue(a: RpgArea, npcId: string, i: number): void {
    const ses = this.session
    const s = this.s
    const n = a.npcs.find((x) => x.id === npcId)
    if (!n) return this.world(a)
    const p = this.progressOf(a)
    const lines = this.dialogueLines(a, n)
    const idx = Math.max(0, Math.min(i, lines.length - 1))
    const last = idx >= lines.length - 1
    const name = this.npcName(a, n.id)
    const offer = n.quest && !p.accepted
    const replay = n.quest && p.done && ses.unitStars(a.unitId) < 3
    const accept = (): void => {
      p.accepted = true
      this.message = s('rpg.msg.accepted', { area: this.areaName(a) })
      this.event = 'accepted'
      this.world(a)
    }
    const replayQuest = (): void => this.replay(a)
    const bye = (): void => {
      this.event = 'talked'
      this.world(a)
    }
    const sprite: Sprite = n.quest ? SAGE : APPRENTICE
    const body = h(
      'section',
      { class: 'rpg-dialogue' },
      h('h1', { class: 'screen-title rpg-name', tabindex: '-1', testid: 'dialogue-name' }, name),
      h(
        'div',
        { class: 'rpg-speaker' },
        portrait({ sprite, pal: this.pal, image: this.assetOf(n.portrait ?? this.layout.sprites.npc), alt: s('rpg.portrait', { name }) }),
        h('div', { class: 'rpg-textbox', testid: 'dialogue-text' }, h('p', {}, lines[idx] ?? ''), h('span', { class: 'rpg-count' }, s('rpg.dialogue.count', { n: idx + 1, total: lines.length })))
      ),
      h(
        'div',
        { class: 'rpg-actions' },
        last
          ? [
              offer ? button('accept-quest', s('rpg.quest.accept'), accept, { class: 'btn btn-primary btn-big', 'data-autofocus': '' }) : null,
              replay ? button('replay-quest', s('rpg.qd.replay'), replayQuest, { class: 'btn btn-primary btn-big', 'data-autofocus': '' }) : null,
              button('dialogue-bye', offer ? s('rpg.dialogue.later') : s('rpg.dialogue.bye'), bye, { class: offer || replay ? 'btn btn-big' : 'btn btn-primary btn-big', ...(offer || replay ? {} : { 'data-autofocus': '' }) })
            ]
          : button('dialogue-next', s('rpg.dialogue.next'), () => this.dialogue(a, npcId, idx + 1), { class: 'btn btn-primary btn-big', 'data-autofocus': '' })
      )
    )
    this.show('dialogue', body, { unitId: a.unitId, view: { npc: n.id, giver: n.quest, line: idx, total: lines.length, last, offer, replay } })
  }

  // ---- battles ----

  private itemsFor(ids: readonly string[], a: RpgArea | null): string[] {
    const ses = this.session
    const known = ids.filter((id) => ses.canAsk(ses.item(id)))
    if (known.length > 0) return known
    // nothing of its own can be asked: the unit's items stand in (never a dead end)
    const unit = a ? unitItemIds(ses.pack, a.unitId).filter((id) => ses.canAsk(ses.item(id))) : []
    return unit.length > 0 ? unit : ses.pack.items.map((i) => i.id).filter((id) => ses.canAsk(ses.item(id)))
  }

  private newFight(o: { id: string; kind: Fight['kind']; area: RpgArea | null; name: string; sprite: Sprite; items: string[]; hp: number; size?: number; counts: boolean }): Fight {
    const ses = this.session
    const strike = o.kind === 'foe' ? FOE_STRIKE : BOSS_STRIKE
    const items = this.itemsFor(o.items, o.area)
    const unitId = o.area?.unitId
    return {
      id: o.id,
      kind: o.kind,
      area: o.area,
      name: o.name,
      sprite: o.sprite,
      items,
      size: o.size ?? items.length,
      battle: newBattle(o.hp, strike, this.hp, HERO_MAX_HP),
      run: ses.startRun(items, { kind: o.kind === 'final' ? 'boss' : 'unit', ...(unitId ? { unitId } : {}), ...(o.size ? { size: o.size } : {}) }),
      scoring: true,
      counts: o.counts,
      scores: [],
      last: null,
      newScroll: false
    }
  }

  private startBattle(a: RpgArea, q: Person): void {
    const p = this.progressOf(a)
    const f =
      q.kind === 'foe'
        ? (() => {
            const def = a.foes.find((x) => x.id === q.id)
            return this.newFight({ id: q.id, kind: 'foe', area: a, name: this.foeName(a, q.id), sprite: FOES[((def?.n ?? 1) - 1) % FOES.length] ?? FOES[0] ?? BOSS, items: def?.items ?? [], hp: def?.hp ?? 200, counts: !p.counted.includes(q.id) })
          })()
        : this.newFight({ id: q.id, kind: 'boss', area: a, name: this.bossName(a), sprite: BOSS, items: unitItemIds(this.session.pack, a.unitId), hp: a.boss.hp, counts: !p.counted.includes(q.id) })
    this.battleIntro(f)
  }

  private sceneFor(f: Fight): ReturnType<typeof battleScene> {
    const s = this.s
    const hero = this.heroName()
    return battleScene({
      words: {
        hero,
        foeName: f.name,
        foeLine: (hp, max) => s('rpg.hp', { hp, max }),
        heroLine: (hp, max) => s('rpg.hp', { hp, max }),
        streakLine: (n, m) => s('rpg.battle.streak', { n, m }),
        alt: s('rpg.battle.alt', { hero, foe: f.name })
      },
      pal: this.pal,
      seed: strHash(`${this.session.pack.id}:${f.id}`) % 997,
      skin: this.skin,
      foe: f.sprite,
      boss: f.kind !== 'foe',
      battle: f.battle
    })
  }

  private fightView(f: Fight, phase: string): Record<string, unknown> {
    return { phase, fight: f.id, kind: f.kind, foe: f.name, foeHp: f.battle.foeHp, foeMax: f.battle.foeMax, hp: f.battle.hp, maxHp: f.battle.maxHp, streak: f.battle.streak, turn: f.battle.turns, area: f.area?.id ?? null }
  }

  private battleIntro(f: Fight): void {
    const s = this.s
    const scene = this.sceneFor(f)
    const final = f.kind === 'final'
    const body = h(
      'section',
      { class: 'rpg-battle' },
      h('h1', { class: 'screen-title rpg-name', tabindex: '-1', testid: 'battle-title' }, f.name),
      h('p', { class: 'subject', testid: 'battle-appears' }, final ? s('rpg.final.ready') : s('rpg.battle.appears', { name: f.name })),
      scene.el,
      h('div', { class: 'rpg-textbox' }, h('p', {}, s('rpg.battle.hint')), f.kind !== 'foe' ? h('p', {}, s('rpg.battle.boss')) : null),
      h(
        'div',
        { class: 'rpg-actions' },
        button('battle-start', s('rpg.battle.start'), () => this.fightStep(f), { class: 'btn btn-primary btn-big', 'data-autofocus': '' }),
        button('battle-flee', s('rpg.battle.flee'), () => this.flee(f), { class: 'btn btn-big' })
      )
    )
    this.show(final ? 'boss' : 'battle', body, { ...(f.area ? { unitId: f.area.unitId } : {}), view: this.fightView(f, 'intro') })
  }

  private fightStep(f: Fight): void {
    const ses = this.session
    const s = this.s
    let pick: NextQuestion | null = ses.next(f.run)
    if (!pick) {
      // every question of the pass was asked and the foe still stands: ask again, but these answers no longer count for the stars
      f.run = ses.startRun(f.items, { kind: f.kind === 'final' ? 'boss' : 'unit', ...(f.area ? { unitId: f.area.unitId } : {}), ...(f.kind === 'final' ? { size: f.size } : {}) })
      f.scoring = false
      pick = ses.next(f.run)
    }
    const item = pick ? ses.item(pick.id) : undefined
    if (!pick || !ses.canAsk(item)) return this.won(f) // nothing can be asked: the foe yields, nobody is stuck
    const chosen = pick
    const scene = this.sceneFor(f)
    f.newScroll = false
    ask(ses, {
      item,
      context: f.kind === 'foe' ? 'battle' : 'boss',
      retry: chosen.retry,
      hud: scene.el,
      lead: h('span', {}, s('rpg.battle.turn', { n: f.battle.turns + 1, name: f.name })),
      ...(f.area ? { unitId: f.area.unitId } : {}),
      roundKind: f.kind === 'final' ? 'boss' : 'unit',
      roundSize: f.run.size,
      index: f.run.results.length,
      view: () => this.fightView(f, 'turn'),
      leaveLabel: s('rpg.battle.flee'),
      onLeave: () => this.flee(f),
      onAnswered: (o) => {
        f.run = ses.record(f.run, chosen, o)
        if (f.scoring && !chosen.retry) f.scores.push(o.result.score)
        const t = resolveTurn(f.battle, { correct: o.result.correct, score: o.result.score })
        f.battle = t.battle
        f.last = t
        this.hp = t.battle.hp
        if (o.result.correct && this.addScroll(item.id)) f.newScroll = true
        scene.update(t.battle, { dealt: t.dealt, taken: t.taken, foeDown: t.won, heroDown: t.fainted })
      },
      effect: (o) => {
        const t = f.last
        if (!t) return null
        const fx = (t.multiplier > 1 ? s('rpg.fx.strike.streak', { name: f.name, n: t.dealt, m: Number.isInteger(t.multiplier) ? t.multiplier : t.multiplier.toFixed(2).replace(/0$/, '') }) : s('rpg.fx.strike', { name: f.name, n: t.dealt }))
        const scroll = f.newScroll ? ` ${s('rpg.fx.scroll')}` : ''
        if (t.won) return { text: `${fx} ${s('rpg.fx.fall', { name: f.name })}${scroll}`, tone: 'good' }
        if (o.result.correct) return { text: `${fx}${scroll}`, tone: 'good' }
        if (t.fainted) return { text: `${s('rpg.fx.hit', { name: f.name, n: t.taken })} ${s('rpg.fx.faint')}`, tone: 'bad' }
        if (t.dealt > 0) return { text: s('rpg.fx.both', { name: f.name, n: t.dealt, m: t.taken }), tone: 'bad' }
        return { text: s('rpg.fx.hit', { name: f.name, n: t.taken }), tone: 'bad' }
      },
      nextLabel: () => (f.last?.won ? s('rpg.next.win') : f.last?.fainted ? s('rpg.next.faint') : s('rpg.next.turn')),
      onNext: () => {
        if (f.last?.won) this.won(f)
        else if (f.last?.fainted) this.faint(f)
        else this.fightStep(f)
      }
    })
  }

  /** The first answers of a foe's first fight count for the quest's stars (once, however the fight ends). */
  private settle(f: Fight): void {
    if (!f.area || !f.counts || f.scores.length === 0) return
    const p = this.progressOf(f.area)
    p.scores.push(...f.scores)
    if (!p.counted.includes(f.id)) p.counted.push(f.id)
    f.counts = false
  }

  private flee(f: Fight): void {
    this.settle(f)
    this.event = 'fled'
    this.message = this.s('rpg.msg.fled', { name: f.name })
    if (f.area) this.world(f.area)
    else this.areas()
  }

  private faint(f: Fight): void {
    this.settle(f)
    this.hp = HERO_MAX_HP
    this.event = 'inn'
    this.message = this.s('rpg.msg.inn', { name: f.name })
    if (f.area) {
      const p = this.progressOf(f.area)
      p.pos = f.area.start
      p.face = 'right'
      this.world(f.area)
    } else this.areas()
  }

  private won(f: Fight): void {
    const ses = this.session
    const s = this.s
    this.settle(f)
    if (f.kind === 'final') return this.finalWon(f)
    const a = f.area as RpgArea
    const p = this.progressOf(a)
    if (f.kind === 'foe') {
      if (!p.foesDown.includes(f.id)) p.foesDown.push(f.id)
      const healed = Math.min(HEAL_ON_WIN, HERO_MAX_HP - this.hp)
      this.hp = Math.min(HERO_MAX_HP, this.hp + HEAL_ON_WIN)
      this.event = 'won'
      this.message = `${s('rpg.msg.won', { name: f.name })}${healed > 0 ? ` ${s('rpg.msg.rest', { n: healed })}` : ''}`
      return this.world(a)
    }
    p.bossDown = true
    p.done = true
    const accuracy = p.scores.length > 0 ? questAccuracy(p.scores) : 1
    const r = ses.recordUnit({ unitId: a.unitId }, accuracy)
    ses.playCue('unit-complete')
    this.event = 'quest-done'
    this.questDone(a, r.stars, accuracy, r.unlocked)
  }

  private replay(a: RpgArea): void {
    const p = this.progressOf(a)
    this.progress.set(a.id, replayProgress(a, p))
    this.hp = HERO_MAX_HP
    this.event = 'replay'
    this.world(a)
  }

  private questDone(a: RpgArea, stars: number, accuracy: number, unlocked: string[]): void {
    const ses = this.session
    const s = this.s
    const pct = Math.round(accuracy * 100)
    const mastered = ses.isMastered(a.unitId)
    const opened = this.layout.areas.filter((x) => unlocked.includes(x.unitId)).map((x) => this.areaName(x))
    const body = h(
      'section',
      { class: 'rpg-done' },
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'quest-title' }, s('rpg.qd.title')),
      h('p', { class: 'subject' }, this.areaName(a)),
      ses.stars(stars, 'quest-stars'),
      h('p', { class: 'big-number', testid: 'quest-accuracy' }, s('rpg.qd.accuracy', { n: pct })),
      h('p', { class: `message ${mastered ? 'message-ok' : 'message-bad'}`, testid: 'quest-gate' }, mastered ? s('rpg.qd.gate.open') : s('rpg.qd.gate.shut')),
      opened.length > 0 ? h('p', { class: 'message', testid: 'quest-unlocked' }, s('rpg.qd.unlocked', { units: opened.join(', ') })) : null,
      stars < 3 ? h('p', { class: 'subject' }, s('rpg.quest.replay.hint')) : null,
      h(
        'div',
        { class: 'rpg-actions' },
        button('to-world', s('rpg.qd.world'), () => this.world(a), { class: mastered ? 'btn btn-primary btn-big' : 'btn btn-big', ...(mastered ? { 'data-autofocus': '' } : {}) }),
        stars < 3 ? button('replay-quest', s('rpg.qd.replay'), () => this.replay(a), { class: mastered ? 'btn btn-big' : 'btn btn-primary btn-big', ...(mastered ? {} : { 'data-autofocus': '' }) }) : null,
        button('to-areas', s('rpg.to.areas'), () => this.areas(), { class: 'btn btn-big' })
      )
    )
    this.show('quest-done', body, { unitId: a.unitId, view: { area: a.id, unit: a.unitId, stars, accuracy: pct, mastered, gateOpen: mastered, unlocked } })
  }

  // ---- the final boss ----

  private finalIntro(): void {
    const ses = this.session
    this.hp = HERO_MAX_HP
    const all = ses.pack.items.map((i) => i.id)
    const f = this.newFight({ id: 'final', kind: 'final', area: null, name: this.finalName(), sprite: BOSS, items: all, hp: this.layout.finalBoss.hp, size: Math.min(this.layout.finalBoss.size, Math.max(1, all.length)), counts: true })
    // the final boss has no area: its stars come from its own answers
    this.battleIntro(f)
  }

  private finalWon(f: Fight): void {
    const ses = this.session
    const accuracy = f.scores.length > 0 ? questAccuracy(f.scores) : 1
    ses.recordUnit({ boss: true }, accuracy)
    ses.playCue('boss')
    this.event = 'final-won'
    this.message = this.s('rpg.final.beaten')
    this.story('outro', 0)
  }

  // ---- the scrolls ----

  private inventory(back: () => void): void {
    const ses = this.session
    const s = this.s
    const unitOf = (itemId: string): string => {
      const obj = ses.pack.objectives.find((o) => o.id === ses.item(itemId)?.objective)
      return ses.unitTitle(obj?.unit)
    }
    const body = h(
      'section',
      { class: 'rpg-inventory' },
      h('h1', { class: 'screen-title', tabindex: '-1', testid: 'inventory-title' }, s('rpg.inv.title')),
      h('p', { class: 'subject' }, this.scrolls.length === 0 ? s('rpg.inv.empty') : s('rpg.inv.intro')),
      h(
        'ul',
        { class: 'rpg-scrolls', testid: 'scrolls' },
        this.scrolls.map((id) => h('li', { class: 'rpg-scroll', testid: `scroll-${id}` }, h('span', {}, this.scrollText(id)), h('span', { class: 'scroll-from' }, s('rpg.inv.from', { unit: unitOf(id) }))))
      ),
      h('div', { class: 'rpg-actions' }, button('inventory-back', s('rpg.inv.back'), back, { class: 'btn btn-primary btn-big', 'data-autofocus': '' }))
    )
    this.show('inventory', body, { view: { scrolls: [...this.scrolls] } })
  }

  // ---- the end ----

  private end(): void {
    const ses = this.session
    const s = this.s
    ses.finish()
    this.show(
      'end',
      endScreen(ses, {
        title: s('rpg.outro.title'),
        sub: s('rpg.end.sub'),
        stats: h('p', { class: 'subject', testid: 'end-scrolls' }, s('rpg.end.scrolls', { n: this.scrolls.length })),
        onAgain: () => this.areas(),
        onTitle: () => this.title()
      }),
      { view: { scrolls: this.scrolls.length, areas: this.layout.areas.length, crowned: ses.bossStars() >= 1 } }
    )
  }
}

export const rpgShell: Shell = (() => {
  let game: Rpg | null = null
  return {
    id: SHELL_ID,
    mount(host: ShellHost) {
      game = new Rpg(host)
      game.mount()
    },
    unmount() {
      game?.unmount()
      game = null
    }
  }
})()

