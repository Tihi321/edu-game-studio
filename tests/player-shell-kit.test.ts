import { describe, expect, it } from 'vitest'
import { validateCourse } from '../src/shared/edu'
import { KNOWN_SHELLS, SHELL_DEFS, enabledShells, lintShells, parseSection, sectionOf } from '../src/shared/shells'
import { chooseShell, playableShells, shellChoiceKey } from '../src/player/engine'
import { emptyShellProgress, hasShellProgress, MAX_SHELL_DATA, newProgress, parseProgress } from '../src/player/progress'
import { pickNext, recordResult, roundAccuracy, startPool } from '../src/player/round'
import { makeShellUi } from '../src/player/kit/strings'
import { musicAreaOf } from '../src/player/kit/session'
import { rngFor } from '../src/shared/edu'
import { loadFixture } from './edu-fixtures'

/** The shell contract (EGS-10): shell choice, the per-shell progress slot, runs over any pool, the section registry, shell strings. */

describe('shell choice', () => {
  it('plays the enabled shells that are registered, in order, falling back to the default shell', () => {
    expect(playableShells(['quiz-arena', 'mindmaze', 'nope'], ['quiz-arena', 'mindmaze', 'rpg'])).toEqual(['quiz-arena', 'mindmaze'])
    expect(playableShells(['nope'], ['quiz-arena'])).toEqual(['quiz-arena'])
    expect(playableShells([], new Set(['quiz-arena']))).toEqual(['quiz-arena'])
    expect(playableShells(['x'], [])).toEqual([])
  })

  it('takes ?shell= first, then the remembered choice, then the game data, then the first playable', () => {
    const playable = ['quiz-arena', 'encyclopedia', 'mindmaze']
    expect(chooseShell({ search: '?seed=1&shell=mindmaze', playable, saved: 'encyclopedia', dataShell: 'quiz-arena' })).toBe('mindmaze')
    expect(chooseShell({ search: '?shell=rpg', playable, saved: 'encyclopedia', dataShell: 'quiz-arena' })).toBe('encyclopedia')
    expect(chooseShell({ search: '', playable, saved: null, dataShell: 'mindmaze' })).toBe('mindmaze')
    expect(chooseShell({ search: '', playable, saved: 'gone', dataShell: 'gone' })).toBe('quiz-arena')
    expect(chooseShell({ search: '', playable: [] })).toBeUndefined()
    expect(shellChoiceKey('solar-system')).toBe('edu-studio:shell:solar-system')
  })
})

describe('per-shell progress', () => {
  const pack = { id: 'c', units: [{ id: 'u1', title: 't', requires: [] }], items: [{ id: 'i1' }], objectives: [] } as never

  it('keeps each shell its own stars, finish flag and data, and cleans them on import', () => {
    const p = newProgress('c')
    expect(p.shells).toEqual({})
    p.shells.mindmaze = { ...emptyShellProgress(), units: { u1: { stars: 2, best: 0.8, rounds: 1 } }, finished: true, data: { rooms: ['a'] } }
    p.shells['bad id!'] = emptyShellProgress()
    const back = parseProgress(JSON.stringify(p), pack)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.progress.shells.mindmaze).toEqual({ units: { u1: { stars: 2, best: 0.8, rounds: 1 } }, boss: { stars: 0, best: 0, rounds: 0 }, finished: true, data: { rooms: ['a'] } })
    expect(back.progress.shells['bad id!']).toBeUndefined()
    expect(hasShellProgress(back.progress, 'mindmaze')).toBe(true)
    expect(hasShellProgress(back.progress, 'rpg')).toBe(false)
  })

  it('drops unknown units, clamps stars and refuses oversized data', () => {
    const raw = { version: 1, pack: 'c', shells: { rpg: { units: { u1: { stars: 9 }, ghost: { stars: 3 } }, data: 'x'.repeat(MAX_SHELL_DATA + 10) } } }
    const back = parseProgress(JSON.stringify(raw), pack)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.progress.shells.rpg?.units).toEqual({ u1: { stars: 3, best: 0, rounds: 0 } })
    expect(back.progress.shells.rpg?.data).toBeUndefined()
  })

  it('reads an old progress file without shells', () => {
    const old = { ...newProgress('c') } as Record<string, unknown>
    delete old.shells
    const back = parseProgress(JSON.stringify(old), pack)
    expect(back.ok && back.progress.shells).toEqual({})
  })
})

describe('runs over any pool (the round logic every shell asks from)', () => {
  it('asks each fresh item once, brings a miss back after other questions, and counts first tries only', async () => {
    const { pack } = await loadFixture('solar-system')
    const pool = pack.items.slice(0, 5).map((i) => i.id)
    let run = startPool(pool, { unitId: 'u-sun-planets' })
    expect(run.size).toBe(5)
    const rng = rngFor(1, 'test')
    const seen: { id: string; retry: boolean }[] = []
    for (let guard = 0; guard < 30; guard++) {
      const pick = pickNext(run, pack, rng, {}, 0)
      if (!pick) break
      seen.push(pick)
      const item = pack.items.find((i) => i.id === pick.id)!
      const correct = !(seen.length === 1)
      run = recordResult(run, pick, item, { correct, score: correct ? 1 : 0 }, correct ? 'good' : 'again')
    }
    expect(seen.filter((s) => !s.retry).map((s) => s.id).sort()).toEqual([...pool].sort())
    expect(seen.some((s) => s.retry && s.id === seen[0]!.id)).toBe(true)
    expect(roundAccuracy(run)).toBeCloseTo(4 / 5)
  })

  it('limits the run to size and to the unique ids of the pool', () => {
    expect(startPool(['a', 'b', 'a', 'c'], { size: 2 }).size).toBe(2)
    expect(startPool(['a', 'b', 'a'], {}).pool).toEqual(['a', 'b'])
    expect(startPool([], {}).size).toBe(0)
  })
})

describe('the shell section registry', () => {
  it('knows the quiz arena and the game shells', () => {
    expect(KNOWN_SHELLS).toEqual(expect.arrayContaining(['quiz-arena', 'encyclopedia', 'mindmaze', 'rpg', 'roleplay', 'detective']))
    for (const def of SHELL_DEFS.values()) {
      expect(def.id).toMatch(/^[a-z]+$/)
      for (const c of def.codes) expect(c).toMatch(/^[A-Z][A-Z0-9_]+$/)
      for (const w of def.warnings ?? []) expect(def.codes).toContain(w)
    }
  })

  it('a course without sections still validates (backwards compatible)', async () => {
    const { pack, catalogs } = await loadFixture('hr-a1-greetings')
    const res = validateCourse(pack, catalogs)
    expect(res.problems).toEqual([])
    expect(enabledShells(pack)).toContain('quiz-arena')
    expect(parseSection(pack, 'mindmaze')).toEqual({ present: false })
    expect(sectionOf(pack, 'mindmaze')).toBeUndefined()
  })

  it('warns about an enabled shell nobody registered', async () => {
    const { pack, catalogs } = await loadFixture('hr-a1-greetings')
    const p = { ...pack, shells: { ...pack.shells, enabled: [...pack.shells.enabled, 'pinball'] } }
    const problems = lintShells({ pack: p, catalogs }, {})
    expect(problems).toContainEqual(expect.objectContaining({ code: 'SHELL_UNKNOWN', severity: 'warning' }))
  })
})

describe('shell strings', () => {
  it('uses the edition table, falls back to English and lets the course override with ui.<key>', () => {
    const tables = { en: { 'x.door': 'Door {n}', 'x.key': 'Key' }, hr: { 'x.door': 'Vrata {n}' } }
    expect(makeShellUi(tables, 'hr')('x.door', { n: 2 })).toBe('Vrata 2')
    expect(makeShellUi(tables, 'hr')('x.key')).toBe('Key')
    expect(makeShellUi(tables, 'de-AT')('x.door', { n: 1 })).toBe('Door 1')
    expect(makeShellUi(tables, 'en', { strings: { 'ui.x.key': 'Ključ' } })('x.key')).toBe('Ključ')
  })
})

describe('the music area of a shell screen (EGS-22)', () => {
  it('menu on the title and the hubs, the unit wherever the world of a unit or run is open, boss in a boss run, end at the end; a review run is a hub', () => {
    expect(musicAreaOf('title', {})).toBe('menu')
    expect(musicAreaOf('title', { unitId: 'u1' })).toBe('menu')
    expect(musicAreaOf('explore' as never, {})).toBe('menu')
    expect(musicAreaOf('map' as never, { unitId: 'u2' })).toBe('unit-u2')
    expect(musicAreaOf('item', { roundKind: 'unit', unitId: 'u1' })).toBe('unit-u1')
    expect(musicAreaOf('item', { roundKind: 'boss' })).toBe('boss')
    expect(musicAreaOf('feedback', { roundKind: 'review', unitId: 'u1' })).toBe('menu')
    expect(musicAreaOf('end', { unitId: 'u1' })).toBe('end')
  })
})
