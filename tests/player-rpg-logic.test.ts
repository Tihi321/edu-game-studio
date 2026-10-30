import { describe, expect, it } from 'vitest'
import { autoArea, buildLayout, unitItemIds, type RpgArea } from '../src/shared/shells/rpg-layout'
import { canReachSpot, findPath, GEN_H, GEN_W, generateMap, isAdjacent, isWalkable, parseMap, pathNextTo, posKey, reachableFrom, samePos, tileAt, type Pos } from '../src/shared/shells/rpg-map'
import { sectionOf } from '../src/shared/shells'
import { BASE_DAMAGE, BOSS_STRIKE, FOE_STRIKE, HERO_MAX_HP, barPercent, foeDamage, heroDamage, newBattle, resolveTurn, streakMultiplier } from '../src/player/shells/rpg/battle'
import { bossGoto, nearby, newAreaProgress, nextGoal, pathToTarget, peopleOf, questAccuracy, replayProgress, stageOf, targetsOf, tryStep } from '../src/player/shells/rpg/model'
import { ALL_SPRITES, SPRITE_COLOURS } from '../src/player/shells/rpg/sprites'
import { RPG_STRINGS } from '../src/player/shells/rpg/strings'
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

  it('has the shape the player and the lint expect: size, walls, one start, one giver spot, one boss spot, a gate in the right wall, people alone on walkable tiles', () => {
    for (const seed of seeds) {
      const m = generateMap(seed, 3)
      expect(m.rows).toHaveLength(GEN_H)
      for (const r of m.rows) expect(r).toHaveLength(GEN_W)
      const flat = m.rows.join('')
      for (const ch of '@NBG') expect([...flat].filter((c) => c === ch)).toHaveLength(1)
      expect(m.rows[0]).toBe('#'.repeat(GEN_W))
      expect(m.rows[GEN_H - 1]).toBe('#'.repeat(GEN_W))
      expect(tileAt(m.rows, m.start)).toBe('@')
      expect(tileAt(m.rows, m.npc)).toBe('N')
      expect(tileAt(m.rows, m.boss)).toBe('B')
      expect(tileAt(m.rows, m.gate)).toBe('G')
      expect(m.gate[0]).toBe(GEN_W - 1)
      const people = [m.npc, m.boss, ...m.foes]
      expect(new Set(people.map(posKey)).size).toBe(people.length)
      expect(people.some((p) => samePos(p, m.start))).toBe(false)
      for (const p of people) expect(isWalkable(tileAt(m.rows, p)), `${seed}: ${posKey(p)}`).toBe(true)
      const parsed = parseMap(m.rows)
      expect(parsed.ragged).toBe(false)
      expect(parsed.unknown).toEqual([])
    }
  })

  it('is deterministic per seed and varies between seeds', () => {
    expect(generateMap('same', 3)).toEqual(generateMap('same', 3))
    expect(new Set(seeds.map((s) => generateMap(s, 3).rows.join('/'))).size).toBeGreaterThan(250)
  })

  it('clamps the foe count (0 to 4)', () => {
    expect(generateMap('x', -3).foes).toHaveLength(0)
    expect(generateMap('x', 9).foes).toHaveLength(4)
  })
})

describe('walking: breadth-first search on the tiles', () => {
  const rows = ['#######', '#@.#..#', '#.##.##', '#....G#', '#######']

  it('knows which tiles block (walls, trees, water) and that the gate is shut until it opens', () => {
    expect(isWalkable('.')).toBe(true)
    expect(isWalkable(',')).toBe(true)
    for (const ch of '#T~') expect(isWalkable(ch)).toBe(false)
    expect(isWalkable('G')).toBe(false)
    expect(isWalkable('G', true)).toBe(true)
    expect(isWalkable(undefined)).toBe(false)
    expect(tileAt(rows, [99, 99])).toBeUndefined()
    expect(tileAt(rows, [-1, 0])).toBeUndefined()
    expect(tileAt(rows, [1, -1])).toBeUndefined()
  })

  it('finds the shortest path (up, down, left, right order makes it stable) and none through a wall', () => {
    const p = findPath(rows, [1, 1], (q) => samePos(q, [4, 3]))
    expect(p).toEqual([[1, 2], [1, 3], [2, 3], [3, 3], [4, 3]])
    expect(findPath(rows, [1, 1], (q) => samePos(q, [5, 1]))).toHaveLength(8) // down, along the corridor and up the other side
    expect(findPath(rows, [1, 1], (q) => samePos(q, [5, 3]))).toBeNull() // the shut gate
    expect(findPath(rows, [1, 1], (q) => samePos(q, [1, 1]))).toEqual([])
  })

  it('stops next to a person, and treats occupied tiles as walls', () => {
    expect(pathNextTo(rows, [1, 1], [5, 3])).toEqual([[1, 2], [1, 3], [2, 3], [3, 3], [4, 3]])
    expect(pathNextTo(rows, [1, 1], [4, 3], { blocked: new Set([posKey([3, 3])]) })).toBeNull()
    const open = reachableFrom(rows, [1, 1])
    expect(open.has(posKey([4, 3]))).toBe(true)
    expect(open.has(posKey([5, 3]))).toBe(false) // the shut gate
    expect(reachableFrom(rows, [1, 1], { gateOpen: true }).has(posKey([5, 3]))).toBe(true)
    expect(isAdjacent([1, 1], [1, 2])).toBe(true)
    expect(isAdjacent([1, 1], [2, 2])).toBe(false)
  })

  it('canReachSpot counts a person standing in a one-tile corridor as blocking the way past them', () => {
    expect(canReachSpot(rows, [1, 1], [5, 3], [])).toBe(true)
    expect(canReachSpot(rows, [1, 1], [4, 1], [[1, 3]])).toBe(false) // someone at the only way down cuts the right side off
    // someone standing in the corridor at (2,3) cuts the way to the tiles beyond it
    expect(canReachSpot(rows, [1, 1], [4, 3], [[2, 3]])).toBe(false)
    expect(canReachSpot(rows, [1, 1], [2, 3], [[2, 3]])).toBe(true) // they themselves can be reached (from beside them)
  })

  it('parses a map: size, start, gate, raggedness, unknown characters', () => {
    const m = parseMap(['#####', '#@.G', '###'])
    expect(m.ragged).toBe(true)
    expect(m.start).toEqual([1, 1])
    expect(m.gate).toEqual([3, 1])
    expect(m.w).toBe(5)
    expect(m.h).toBe(3)
    expect(parseMap(['#x#']).unknown).toEqual(['x'])
    expect(parseMap(['###']).start).toBeNull()
  })
})

describe('the layouts', () => {
  for (const name of FIXTURE_NAMES) {
    it(`builds an automatic layout for ${name}: an area per unit in order, a foe per objective (at most four), every item asked by some foe, connected`, async () => {
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
    })
  }

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

  it('fills in an automatic area for a unit the section does not cover', async () => {
    const f = await loadFixture('solar-system')
    const section = structuredClone(sectionOf<RpgSection>(f.pack, 'rpg')) as RpgSection
    section.areas = section.areas.filter((a) => a.unit !== 'u-rocky-giant')
    const layout = buildLayout(f.pack, section)
    expect(layout.areas.map((a) => [a.unitId, a.auto])).toEqual([['u-sun-planets', false], ['u-rocky-giant', true], ['u-moons-beyond', false]])
  })

  it('gives an automatic area a generated map and one foe per objective', async () => {
    const f = await loadFixture('european-capitals')
    const a = autoArea(f.pack, 'u-central')
    expect(a.foes).toHaveLength(3)
    expect(a.id).toBe('u-central')
    expect(a.foes.every((x) => x.hp === 200)).toBe(true)
    expect(a.boss.hp).toBe(400)
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

  it('makes the foe strike back for every answer that is not right, never for a right one, at least 1', () => {
    expect(foeDamage(true, 1)).toBe(0)
    expect(foeDamage(false, 0)).toBe(FOE_STRIKE)
    expect(foeDamage(false, 0.5)).toBe(Math.round(FOE_STRIKE / 2))
    expect(foeDamage(false, 0.999)).toBe(1)
    expect(foeDamage(false, 0, BOSS_STRIKE)).toBe(BOSS_STRIKE)
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

  it('shows a bar as a whole percentage between 0 and 100', () => {
    expect(barPercent(50, 100)).toBe(50)
    expect(barPercent(-5, 100)).toBe(0)
    expect(barPercent(500, 100)).toBe(100)
    expect(barPercent(1, 0)).toBe(0)
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

  it('lists everyone standing and the places the goto buttons walk to', () => {
    const p = newAreaProgress(area)
    expect(peopleOf(area, p).map((q) => q.id)).toEqual(['n1', 'f1', 'f2', 'b1'])
    expect(targetsOf(area, p).map((t) => t.testid)).toEqual(['goto-n1', 'goto-f1', 'goto-f2', bossGoto, 'goto-gate'])
    const next = { ...p, foesDown: ['f1'], bossDown: false }
    expect(peopleOf(area, next).map((q) => q.id)).toEqual(['n1', 'f2', 'b1'])
  })

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

  it('finds paths that end next to a person, and a path onto the gate only when it is open', () => {
    const p = newAreaProgress(area)
    const path = pathToTarget(area, p, 'goto-n1', false) as Pos[]
    expect(path.length).toBeGreaterThan(0)
    expect(isAdjacent(path.at(-1) as Pos, [4, 1])).toBe(true)
    expect(pathToTarget(area, p, 'nobody', false)).toBeNull()
    const shut = pathToTarget(area, p, 'goto-gate', false) as Pos[]
    const open = pathToTarget(area, p, 'goto-gate', true) as Pos[]
    expect(isAdjacent(shut.at(-1) as Pos, [8, 3])).toBe(true)
    expect(samePos(open.at(-1) as Pos, [8, 3])).toBe(true)
  })

  it('says who stands next to the hero, the one faced first', () => {
    const p = { ...newAreaProgress(area), pos: [4, 2] as Pos, face: 'up' as const }
    expect(nearby(area, p).map((q) => q.id)).toEqual(['n1', 'f2'])
    expect(nearby(area, { ...p, pos: [5, 2], face: 'down' }).map((q) => q.id)).toEqual(['f1'])
    expect(nearby(area, { ...p, pos: [6, 2], face: 'down' }).map((q) => q.id)).toEqual(['b1'])
    expect(nearby(area, { ...p, pos: [1, 3] }).length).toBe(0)
  })

  it('computes the quest accuracy as the mean of the first-try scores and starts a replay with the quest still taken', () => {
    expect(questAccuracy([])).toBe(0)
    expect(questAccuracy([1, 1, 0.5, 0])).toBe(0.625)
    const p = { ...newAreaProgress(area), accepted: true, foesDown: ['f1'], bossDown: true, done: true, scores: [1], counted: ['f1'], pos: [3, 3] as Pos }
    const r = replayProgress(area, p)
    expect(r).toMatchObject({ accepted: true, foesDown: [], bossDown: false, done: false, scores: [], counted: [], pos: [1, 1] })
  })
})

describe('the sprites and the words', () => {
  it('draws every sprite on a 16 x 16 grid with known colour letters only', () => {
    for (const [name, s] of Object.entries(ALL_SPRITES)) {
      expect(s, name).toHaveLength(16)
      s.forEach((row, i) => {
        expect(row, `${name} row ${i}`).toHaveLength(16)
        for (const ch of row) if (ch !== '.') expect(SPRITE_COLOURS[ch], `${name} row ${i}: "${ch}"`).toBeDefined()
      })
    }
  })

  it('has a Croatian word for every English one', () => {
    const en = Object.keys(RPG_STRINGS.en)
    const hr = Object.keys(RPG_STRINGS.hr ?? {})
    expect(en.filter((k) => !hr.includes(k))).toEqual([])
    expect(hr.filter((k) => !en.includes(k))).toEqual([])
  })
})
