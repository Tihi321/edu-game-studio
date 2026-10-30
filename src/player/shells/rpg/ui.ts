import { h, pulse } from '../../dom'
import { barPercent, streakMultiplier, type Battle } from './battle'
import { drawBattleScene, drawSprite, SCENE_H, SCENE_W, type Palette, type Skin } from './draw'
import type { Sprite } from './sprites'

/**
 * The small DOM pieces of the RPG shell (EGS-12) that more than one screen uses: an HP line with its bar, the battle scene (the foe, the
 * hero, both life bars, the streak) and a portrait. No game rules in here (battle.ts has them) and no course words: the caller passes them.
 */

export interface HpLine {
  el: HTMLElement
  set(hp: number, max: number): void
}

/** `HP 75 / 100` with a bar. The bar turns amber when low; it is decoration only (the text carries the number). */
export function hpLine(text: (hp: number, max: number) => string, hp: number, max: number, tone: 'hero' | 'foe', testid: string): HpLine {
  const fill = h('span', { class: `hp-fill ${tone === 'foe' ? 'is-foe' : ''}` })
  const label = h('span', { class: 'hp-text' })
  const el = h('div', { class: 'hp-line', testid }, label, h('span', { class: 'hp-bar', 'aria-hidden': 'true' }, fill))
  const set = (v: number, m: number): void => {
    label.textContent = text(v, m)
    const pct = barPercent(v, m)
    fill.style.width = `${pct}%`
    fill.classList.toggle('is-low', pct <= 30 && tone === 'hero')
    el.setAttribute('data-hp', String(v))
    el.setAttribute('data-max', String(m))
  }
  set(hp, max)
  return { el, set }
}

export interface SceneWords {
  hero: string
  foeName: string
  foeLine(hp: number, max: number): string
  heroLine(hp: number, max: number): string
  streakLine(n: number, multiplier: string): string
  /** The text alternative of the picture. */
  alt: string
}

export interface SceneUpdate {
  /** Damage the hero dealt and took in the last turn (0 for none): shown as floating numbers. */
  dealt: number
  taken: number
  foeDown: boolean
  heroDown: boolean
}

export interface BattleScene {
  el: HTMLElement
  update(b: Battle, fx?: SceneUpdate): void
}

const formatMultiplier = (m: number): string => (Number.isInteger(m) ? String(m) : m.toFixed(2).replace(/0$/, ''))

/** The battle scene: bars on top, the JRPG picture (3x pixel scale), the streak line. */
export function battleScene(o: { words: SceneWords; pal: Palette; seed: number; skin?: Skin; foe: Sprite; boss: boolean; battle: Battle }): BattleScene {
  const canvas = h('canvas', { class: 'rpg-canvas rpg-battle-canvas', width: SCENE_W * 3, height: SCENE_H * 3, role: 'img', 'aria-label': o.words.alt, testid: 'battle-scene' })
  const heroBar = hpLine(o.words.heroLine, o.battle.hp, o.battle.maxHp, 'hero', 'hero-hp')
  const foeBar = hpLine(o.words.foeLine, o.battle.foeHp, o.battle.foeMax, 'foe', 'foe-hp')
  const streak = h('p', { class: 'rpg-streak', testid: 'streak' })
  const view = h('div', { class: 'rpg-scene-view' }, canvas)
  const el = h(
    'div',
    { class: 'rpg-scene' },
    h(
      'div',
      { class: 'rpg-scene-bars' },
      h('div', { class: 'rpg-panel' }, h('span', { class: 'rpg-who' }, o.words.hero), heroBar.el),
      h('div', { class: 'rpg-panel' }, h('span', { class: 'rpg-who' }, o.words.foeName), foeBar.el)
    ),
    view,
    streak
  )
  const paint = (foeDown: boolean, heroDown: boolean): void => drawBattleScene(canvas, o.pal, { foe: o.foe, boss: o.boss, down: foeDown, heroDown }, o.seed, o.skin)
  const pop = (text: string, cls: string): void => {
    const p = h('span', { class: `rpg-pop ${cls}`, 'aria-hidden': 'true' }, text)
    view.appendChild(p)
    window.setTimeout(() => p.remove(), 1300)
  }
  const update = (b: Battle, fx?: SceneUpdate): void => {
    heroBar.set(b.hp, b.maxHp)
    foeBar.set(b.foeHp, b.foeMax)
    const m = streakMultiplier(b.streak)
    streak.textContent = o.words.streakLine(b.streak, formatMultiplier(m))
    streak.classList.toggle('is-hot', b.streak > 0)
    el.setAttribute('data-streak', String(b.streak))
    paint(fx?.foeDown ?? false, fx?.heroDown ?? false)
    if (fx) {
      if (fx.dealt > 0) pop(`-${fx.dealt}`, 'is-foe')
      if (fx.taken > 0) {
        pop(`-${fx.taken}`, 'is-hero')
        pulse(view, 'is-hit', 500)
      }
    }
  }
  update(o.battle)
  return { el, update }
}

/** A 16 x 16 sprite as a portrait (shown big and crisp by the CSS), or the course's image when it has one. */
export function portrait(o: { sprite: Sprite; pal: Palette; image?: { url: string; alt: string } | null; alt: string }): HTMLElement {
  if (o.image) return h('img', { class: 'rpg-portrait', src: o.image.url, alt: o.image.alt, testid: 'portrait' })
  const c = h('canvas', { class: 'rpg-portrait', width: 16, height: 16, role: 'img', 'aria-label': o.alt, testid: 'portrait' })
  const ctx = c.getContext('2d')
  if (ctx) {
    ctx.imageSmoothingEnabled = false
    drawSprite(ctx, o.sprite, o.pal, 0, 0)
  }
  return c
}
