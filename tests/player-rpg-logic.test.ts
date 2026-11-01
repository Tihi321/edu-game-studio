import { describe, expect, it } from 'vitest'
import { buildLayout, unitItemIds, type RpgArea } from '../src/shared/shells/rpg-layout'
import { canReachSpot, findPath, generateMap, posKey, samePos, type Pos } from '../src/shared/shells/rpg-map'
import { sectionOf } from '../src/shared/shells'
import { BASE_DAMAGE, FOE_STRIKE, HERO_MAX_HP, heroDamage, newBattle, resolveTurn, streakMultiplier } from '../src/player/shells/rpg/battle'
import { bossGoto, newAreaProgress, nextGoal, questAccuracy, replayProgress, stageOf, tryStep } from '../src/player/shells/rpg/model'
import type { RpgSection } from '../src/shared/shells/rpg-layout'
import { FIXTURE_NAMES, loadFixture } from './edu-fixtures'

/** The pure logic of the RPG shell (EGS-12): the map generator, the walking search, the layouts, the battle maths, the world model. */

describe('the map generator', () => {
  const seeds = Array.from({ length: 300 }, (_, i) => `seed-${i}`)

  it('always makes a connected map: the giver, every foe, the boss and the gate can be reached from the start', () => {
    for (const seed of seeds)
      for (const foes of [0, 1, 2, 3, 4]) {
        const m = generateMap(seed, foes)
        const people = [m.npc, m.boss, ...m.foes]
        expect(m.foes, `${seed}/${foes}`).toHaveLength(foes)
        for (const p of people) expect(canReachSpot(m.rows, m.start, p, people), `${seed}/${foes}: ${posKey(p)} cannot be reached\n${m.rows.join('\n')}`).toBe(true)
        expect(canReachSpot(m.rows, m.start, m.gate, people, true), `${seed}/${foes}: the gate cannot be reached`).toBe(true)
      }
  })

})

describe('walking: breadth-first search on the tiles', () => {
  const rows = ['#######', '#@.#..#', '#.##.##', '#....G#', '#######']

  it('finds the shortest path (up, down, left, right order makes it stable) and none through a wall', () => {
    const p = findPath(rows, [1, 1], (q) => samePos(q, [4, 3]))
    expect(p).toEqual([[1, 2], [1, 3], [2, 3], [3, 3], [4, 3]])
    expect(findPath(rows, [1, 1], (q) => samePos(q, [5, 1]))).toHaveLength(8) // down, along the corridor and up the other side
    expect(findPath(rows, [1, 1], (q) => samePos(q, [5, 3]))).toBeNull() // the shut gate
    expect(findPath(rows, [1, 1], (q) => samePos(q, [1, 1]))).toEqual([])
  })

})

describe('the layouts', () => {
  it('builds an automatic layout for each: an area per unit in order, a foe per objective (at most four), every item asked by some foe, connected (each fixture)', async () => {
    for (const name of FIXTURE_NAMES) {
      const f = await loadFixture(name)
      const layout = buildLayout(f.pack, undefined)
      expect(layout.authored).toBe(false)
      expect(layout.areas.map((a) => a.unitId).sort()).toEqual(f.pack.units.map((u) => u.id).sort())
      // prerequisite order: a unit never comes before one it requires
      const order = layout.areas.map((a) => a.unitId)
      for (const u of f.pack.units) for (const r of u.requires) expect(order.indexOf(r)).toBeLessThan(order.indexOf(u.id))
      for (const a of layout.areas) {
        expect(a.auto).toBe(true)
        expect(a.foes.length).toBeGreaterThan(0)
        expect(a.foes.length).toBeLessThanOrEqual(4)
        expect(a.npcs.filter((n) => n.quest)).toHaveLength(1)
        const asked = new Set(a.foes.flatMap((x) => x.items))
        for (const id of unitItemIds(f.pack, a.unitId)) expect(asked.has(id), `${name}/${a.id}: ${id} is asked by no foe`).toBe(true)
        const people = [...a.npcs.map((n) => n.at), a.boss.at, ...a.foes.map((x) => x.at)]
        for (const p of people) expect(canReachSpot(a.rows, a.start, p, people)).toBe(true)
        if (a.gate) expect(canReachSpot(a.rows, a.start, a.gate, people, true)).toBe(true)
      }
      // the same course always gets the same maps
      expect(buildLayout(f.pack, undefined).areas.map((a) => a.rows)).toEqual(layout.areas.map((a) => a.rows))
    }
  })

  it('uses the authored section of solar-system: three areas with the authored maps, foes and frame story', async () => {
    const f = await loadFixture('solar-system')
    const section = sectionOf<RpgSection>(f.pack, 'rpg')
    expect(section).toBeDefined()
    const layout = buildLayout(f.pack, section)
    expect(layout.authored).toBe(true)
    expect(layout.areas.map((a) => a.id)).toEqual(['a-sun', 'a-rocky', 'a-moons'])
    expect(layout.areas.every((a) => !a.auto)).toBe(true)
    expect(layout.intro.length).toBeGreaterThanOrEqual(3)
    expect(layout.outro.length).toBeGreaterThanOrEqual(1)
    expect(layout.heroNameKey).toBe('rpg.hero')
    for (const a of layout.areas) {
      expect(a.foes.length).toBe(3)
      expect(a.npcs.some((n) => n.quest)).toBe(true)
      // every item of the unit is asked by a foe of the area
      const asked = new Set(a.foes.flatMap((x) => x.items))
      for (const id of unitItemIds(f.pack, a.unitId)) expect(asked.has(id), `${a.id}: ${id}`).toBe(true)
    }
  })

})

describe('the battle maths', () => {
  it('multiplies the base damage by the answer score and the streak (x1 .. x2 in steps of 0.25)', () => {
    expect(heroDamage(1, 0)).toBe(BASE_DAMAGE)
    expect(heroDamage(1, 1)).toBe(125)
    expect(heroDamage(1, 2)).toBe(150)
    expect(heroDamage(1, 4)).toBe(200)
    expect(heroDamage(1, 40)).toBe(200) // the cap
    expect(heroDamage(0.5, 0)).toBe(50) // partial credit counts
    expect(heroDamage(0.5, 2)).toBe(75)
    expect(heroDamage(0, 5)).toBe(0)
    expect(heroDamage(7, 0)).toBe(BASE_DAMAGE) // a score is clamped to 0..1
    expect(heroDamage(Number.NaN, 0)).toBe(0)
    expect(streakMultiplier(-3)).toBe(1)
    expect(streakMultiplier(3)).toBe(1.75)
  })

  it('runs a battle: right answers strike harder with the streak, a wrong one breaks it and costs hit points', () => {
    let b = newBattle(400)
    expect(b.hp).toBe(HERO_MAX_HP)
    const hits: number[] = []
    for (let i = 0; i < 3; i++) {
      const t = resolveTurn(b, { correct: true, score: 1 })
      hits.push(t.dealt)
      expect(t.taken).toBe(0)
      expect(t.won).toBe(false)
      b = t.battle
    }
    expect(hits).toEqual([100, 125, 150])
    expect(b.streak).toBe(3)
    expect(b.foeHp).toBe(25)
    const wrong = resolveTurn(b, { correct: false, score: 0 })
    expect(wrong.dealt).toBe(0)
    expect(wrong.taken).toBe(FOE_STRIKE)
    expect(wrong.battle.streak).toBe(0)
    expect(wrong.battle.hp).toBe(HERO_MAX_HP - FOE_STRIKE)
    expect(wrong.battle.turns).toBe(4)
    const win = resolveTurn(wrong.battle, { correct: true, score: 1 })
    expect(win.won).toBe(true)
    expect(win.battle.foeHp).toBe(0)
  })

  it('lets a fatal blow spare the hero, counts a half-right answer for both sides, and faints the hero at 0', () => {
    const last = resolveTurn({ ...newBattle(100), hp: 5 }, { correct: true, score: 1 })
    expect(last.won).toBe(true)
    expect(last.taken).toBe(0)
    expect(last.fainted).toBe(false)
    const half = resolveTurn(newBattle(400), { correct: false, score: 0.5 })
    expect(half.dealt).toBe(50)
    expect(half.taken).toBe(Math.round(FOE_STRIKE / 2))
    expect(half.battle.streak).toBe(0)
    let b = newBattle(10_000)
    let fainted = false
    for (let i = 0; i < 4; i++) {
      const t = resolveTurn(b, { correct: false, score: 0 })
      b = t.battle
      fainted = t.fainted
    }
    expect(b.hp).toBe(0)
    expect(fainted).toBe(true)
  })

})

describe('the world model', () => {
  const area: RpgArea = {
    id: 'a',
    unitId: 'u',
    rows: ['#########', '#@..N...#', '#.......#', '#.....B.G', '#########'],
    start: [1, 1],
    gate: [8, 3],
    npcs: [{ id: 'n1', at: [4, 1], lines: [], quest: true }],
    foes: [
      { id: 'f1', at: [5, 3], hp: 200, items: [], n: 1 },
      { id: 'f2', at: [3, 2], hp: 200, items: [], n: 2 }
    ],
    boss: { id: 'b1', at: [6, 3], hp: 400 },
    auto: false
  }

  it('moves the hero, bumps into people, and stops at walls and the shut gate', () => {
    const p = newAreaProgress(area)
    expect(tryStep(area, p, 'right', false)).toEqual({ kind: 'move', pos: [2, 1] })
    expect(tryStep(area, p, 'up', false)).toEqual({ kind: 'blocked' })
    expect(tryStep(area, { ...p, pos: [3, 1] }, 'right', false)).toMatchObject({ kind: 'bump', person: { id: 'n1' } })
    expect(tryStep(area, { ...p, pos: [6, 2] }, 'down', false)).toMatchObject({ kind: 'bump', person: { id: 'b1' } })
    expect(tryStep(area, { ...p, pos: [8, 2] }, 'down', false)).toEqual({ kind: 'blocked' })
    expect(tryStep(area, { ...p, pos: [8, 2] }, 'down', true)).toEqual({ kind: 'gate' })
  })

  it('walks the quest: the giver, the foes in order, the boss, the gate', () => {
    let p = newAreaProgress(area)
    expect(stageOf(area, p)).toBe('talk')
    let g = nextGoal(area, p, false)
    expect(g).toMatchObject({ kind: 'giver', id: 'n1', testid: 'goto-n1', adjacent: false })
    expect(g.steps).toBeGreaterThan(0)
    p = { ...p, pos: [3, 1] }
    expect(nextGoal(area, p, false).adjacent).toBe(true)
    p = { ...p, accepted: true }
    expect(stageOf(area, p)).toBe('foes')
    expect(nextGoal(area, p, false)).toMatchObject({ kind: 'foe', id: 'f1' })
    p = { ...p, foesDown: ['f1', 'f2'] }
    expect(stageOf(area, p)).toBe('boss')
    expect(nextGoal(area, p, false)).toMatchObject({ kind: 'boss', id: 'b1', testid: bossGoto })
    p = { ...p, bossDown: true, done: true }
    expect(stageOf(area, p)).toBe('done')
    g = nextGoal(area, p, true)
    expect(g).toMatchObject({ kind: 'gate', testid: 'goto-gate' })
    expect(g.steps).toBeGreaterThan(0)
  })

  it('computes the quest accuracy as the mean of the first-try scores and starts a replay with the quest still taken', () => {
    expect(questAccuracy([])).toBe(0)
    expect(questAccuracy([1, 1, 0.5, 0])).toBe(0.625)
    const p = { ...newAreaProgress(area), accepted: true, foesDown: ['f1'], bossDown: true, done: true, scores: [1], counted: ['f1'], pos: [3, 3] as Pos }
    const r = replayProgress(area, p)
    expect(r).toMatchObject({ accepted: true, foesDown: [], bossDown: false, done: false, scores: [], counted: [], pos: [1, 1] })
  })
})
