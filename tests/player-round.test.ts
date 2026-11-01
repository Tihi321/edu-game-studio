import { describe, expect, it } from 'vitest'
import { checkItem, makeTextResolver, newCard, rngFor, schedule, solveItem, type CheckContext } from '../src/shared/edu'
import type { CourseItem } from '../src/shared/course'
import { MAX_RETRIES, gradeOf, itemsOfUnit, missedIds, pickNext, quizConfig, recordResult, roundAccuracy, startRound, timerApplies, unitOfItemId, verbDueCount, verbItems, verbPool, type RoundState } from '../src/player/round'
import { loadFixture } from './edu-fixtures'

type Fixture = Awaited<ReturnType<typeof loadFixture>>

const ctxOf = (f: Fixture, lang: string): CheckContext => ({ text: makeTextResolver(f.catalogs, lang, f.pack.targetLang), diacritics: f.pack.matching.diacritics, typos: f.pack.matching.typos })

/** Plays a round to its end; `right(item, n)` says whether to answer question number n right. */
function play(f: Fixture, rs: RoundState, right: (item: CourseItem, n: number) => boolean, seed = 1, cards = {}): { rs: RoundState; order: string[] } {
  const ctx = ctxOf(f, 'en')
  const rng = rngFor(seed, 'test')
  const order: string[] = []
  for (let n = 0; n < 200; n++) {
    const pick = pickNext(rs, f.pack, rng, cards, 0)
    if (!pick) return { rs, order }
    const item = f.pack.items.find((i) => i.id === pick.id)!
    order.push(pick.id)
    const answer = right(item, n) ? solveItem(item, ctx) : item.kind === 'flashcard' ? 'again' : '__wrong__'
    const result = checkItem(item, answer, ctx)
    rs = recordResult(rs, pick, item, result, gradeOf(item, answer, result))
  }
  throw new Error('round did not end')
}

describe('quizConfig', () => {
  it('reads shells.config.quiz-arena with limits and defaults', async () => {
    const f = await loadFixture('solar-system')
    expect(quizConfig(f.pack)).toEqual({ roundLength: 8, bossLength: 10, timerSeconds: 30 })
    expect(quizConfig({ shells: { enabled: [], config: { 'quiz-arena': { roundLength: 99, timerSeconds: 1, bossLength: 'x' } } } })).toEqual({ roundLength: 12, bossLength: 10, timerSeconds: 5 })
    expect(quizConfig({ shells: { enabled: [], config: {} } }).roundLength).toBe(7)
  })
})

describe('rounds', () => {
  it('a unit round asks only that unit, size capped by the config and the pool', async () => {
    const f = await loadFixture('solar-system')
    const unit = f.pack.units[0]!.id
    const rs = startRound(f.pack, 'unit', { unitId: unit })
    expect(rs.size).toBe(8)
    expect(rs.pool.length).toBe(itemsOfUnit(f.pack, unit).length)
    const { rs: done, order } = play(f, rs, () => true)
    expect(order.every((id) => unitOfItemId(f.pack, id) === unit)).toBe(true)
    expect(done.asked.length).toBe(8)
    expect(new Set(done.asked).size).toBe(8) // no fresh item twice
    expect(roundAccuracy(done)).toBe(1)
    expect(missedIds(done)).toEqual([])
  })

  it('mixes kinds: the same kind is rarely asked twice in a row', async () => {
    const f = await loadFixture('solar-system')
    for (const seed of [1, 2, 3, 4, 5]) {
      const { rs } = play(f, startRound(f.pack, 'unit', { unitId: f.pack.units[0]!.id }), () => true, seed)
      const kinds = rs.results.map((r) => r.kind)
      const repeats = kinds.filter((k, i) => i > 0 && k === kinds[i - 1]).length
      expect(repeats).toBeLessThanOrEqual(1)
    }
  })

  it('a miss comes back after other questions and a right retry ends the loop', async () => {
  // a miss comes back after other questions, at most MAX_RETRIES times, and does not count for the accuracy
  {
    const f = await loadFixture('solar-system')
    const rs0 = startRound(f.pack, 'unit', { unitId: f.pack.units[0]!.id })
    let firstId = ''
    const { rs, order } = play(f, rs0, (item, n) => {
      if (n === 0) firstId = item.id
      return item.id !== firstId // the first item is always wrong
    })
    const idxs = order.map((id, i) => (id === firstId ? i : -1)).filter((i) => i >= 0)
    expect(idxs[0]).toBe(0)
    expect(idxs.length).toBe(1 + MAX_RETRIES)
    expect(idxs[1]! - idxs[0]!).toBeGreaterThanOrEqual(3) // two other questions in between
    expect(rs.results.filter((r) => r.retry).length).toBe(MAX_RETRIES)
    expect(missedIds(rs)).toEqual([firstId])
    const first = rs.results.filter((r) => !r.retry)
    expect(roundAccuracy(rs)).toBeCloseTo(first.reduce((s, r) => s + r.score, 0) / first.length)
    expect(roundAccuracy(rs)).toBeLessThan(1)
  }

  // a retry that is answered right ends the loop
  {
    const f = await loadFixture('solar-system')
    const seen = new Set<string>()
    const { rs } = play(f, startRound(f.pack, 'unit', { unitId: f.pack.units[0]!.id }), (item) => {
      if (!seen.has(item.id)) {
        seen.add(item.id)
        return false // wrong the first time, right on the retry
      }
      return true
    })
    expect(rs.results.filter((r) => r.retry).every((r) => r.correct)).toBe(true)
    expect(rs.session.pending).toEqual([])
    expect(roundAccuracy(rs)).toBeLessThan(0.2)
  }
  })

  it('boss: items from every unit, never two of the same unit in a row while others are left', async () => {
    const f = await loadFixture('solar-system')
    const rs = startRound(f.pack, 'boss')
    expect(rs.size).toBe(10)
    expect(rs.adaptive.difficulty).toBe(4)
    const { rs: done } = play(f, rs, () => true)
    const units = done.results.map((r) => unitOfItemId(f.pack, r.id))
    expect(new Set(units).size).toBe(f.pack.units.length)
    expect(units.filter((u, i) => i > 0 && u === units[i - 1]).length).toBe(0)
  })

  it('a review round asks the queue', async () => {
    const f = await loadFixture('solar-system')
    const queue = [f.pack.items[3]!.id, f.pack.items[5]!.id, 'ghost']
    const rs = startRound(f.pack, 'review', { queue })
    expect(rs.size).toBe(2)
    const { order } = play(f, rs, () => true)
    expect([...order].sort()).toEqual([f.pack.items[3]!.id, f.pack.items[5]!.id].sort())
  })

  it('prefers items whose spaced-repetition card is due (seen before), at most half the round', async () => {
    const f = await loadFixture('solar-system')
    const unit = f.pack.units[0]!.id
    const items = itemsOfUnit(f.pack, unit)
    const dueIds = items.slice(0, 3).map((i) => i.id)
    const cards = Object.fromEntries(dueIds.map((id) => [id, { ...schedule(newCard(id, 0), 'good', 0), due: 1 }]))
    const rs0 = startRound(f.pack, 'unit', { unitId: unit })
    const pick = pickNext(rs0, f.pack, rngFor(1, 'due'), cards, 10_000_000)!
    expect(dueIds).toContain(pick.id)
    const { rs } = play(f, rs0, () => true, 1, cards)
    expect(rs.dueTaken).toBeLessThanOrEqual(Math.ceil(rs.size / 2))
  })

  it('adaptive difficulty moves with the answers', async () => {
    const f = await loadFixture('solar-system')
    const { rs: good } = play(f, startRound(f.pack, 'unit', { unitId: f.pack.units[0]!.id }), () => true)
    const { rs: bad } = play(f, startRound(f.pack, 'unit', { unitId: f.pack.units[0]!.id }), () => false)
    expect(good.adaptive.difficulty).toBeGreaterThan(3)
    expect(bad.adaptive.difficulty).toBeLessThan(3)
  })
})

describe('grades and the timer', () => {
  it('grades map from answers and the timer never runs on typing, flashcards or puzzles', async () => {
  // maps an answer to a grade
  {
    const ok = { correct: true, score: 1, expected: null }
    expect(gradeOf({ kind: 'mcq' }, 'a', ok)).toBe('good')
    expect(gradeOf({ kind: 'mcq' }, 'a', { ...ok, correct: false, score: 0 })).toBe('again')
    expect(gradeOf({ kind: 'typed' }, 'a', { ...ok, typo: true })).toBe('hard')
    expect(gradeOf({ kind: 'cloze' }, 'a', { ...ok, diacritics: true })).toBe('hard')
    expect(gradeOf({ kind: 'flashcard' }, 'easy', ok)).toBe('easy')
    expect(gradeOf({ kind: 'flashcard' }, 'again', { ...ok, correct: false })).toBe('again')
  }

  // the timer never runs on typing, flashcards or puzzles
  {
    const f = await loadFixture('hr-a1-greetings')
    const s = await loadFixture('solar-system')
    for (const item of [...f.pack.items, ...s.pack.items]) {
      const it = item as unknown as { mode?: string; gaps?: { bank?: string[] }[] }
      const typing = item.kind === 'typed' || (item.kind === 'listening' && it.mode === 'type') || (item.kind === 'cloze' && it.gaps!.some((g) => !g.bank))
      const off = typing || ['flashcard', 'crossword', 'word-search'].includes(item.kind)
      expect(timerApplies(item), item.id).toBe(!off)
    }
  }
  })
})

describe('verb drill (EGS-31)', () => {
  const DAY = 86_400_000
  const NOW = 100 * DAY
  const seen = (id: string, due: number, ease = 2.5) => ({ ...newCard(id, 0), last: 1, due, ease })

  it('has conjugation items only of the verb units, and none without verb units', async () => {
    const f = await loadFixture('de-verbs-a1')
    expect(verbItems(f.pack).map((i) => i.id)).toEqual(['c-sein', 'c-gehen', 'c-gehen-imp'])
    expect(verbItems({ ...f.pack, extensions: {} })).toEqual([])
    expect(verbItems({ ...f.pack, extensions: { language: { verbUnits: ['u-gehen'] } } }).map((i) => i.id)).toEqual(['c-gehen', 'c-gehen-imp'])
    const solar = await loadFixture('solar-system')
    expect(verbItems(solar.pack)).toEqual([])
  })

  it('verb drill: due cards first, a missed form returns, none without verb units', async () => {
  // picks due cards before new ones, then the weakest
  {
    const f = await loadFixture('de-verbs-a1')
    const cards = { 'c-gehen': seen('c-gehen', NOW - DAY), 'c-gehen-imp': seen('c-gehen-imp', NOW + 5 * DAY, 1.5), 'c-sein': seen('c-sein', NOW + 9 * DAY, 2.0) }
    expect(verbDueCount(f.pack, cards, NOW)).toBe(1)
    expect(verbPool(f.pack, cards, NOW, 7)).toEqual(['c-gehen', 'c-gehen-imp', 'c-sein']) // due, then weakest first
    expect(verbPool(f.pack, { 'c-gehen-imp': seen('c-gehen-imp', NOW + DAY) }, NOW, 7)).toEqual(['c-sein', 'c-gehen', 'c-gehen-imp']) // new before seen
    expect(verbPool(f.pack, {}, NOW, 2)).toEqual(['c-sein', 'c-gehen']) // capped
    const rs = startRound(f.pack, 'verbs', { cards, now: NOW })
    expect(rs.kind).toBe('verbs')
    expect(rs.size).toBe(3)
    const { order } = play(f, rs, () => true, 1, cards)
    expect(order).toEqual(['c-gehen', 'c-gehen-imp', 'c-sein'])
  }

  // brings a missed form back and is deterministic
  {
    const f = await loadFixture('de-verbs-a1')
    const run = () => play(f, startRound(f.pack, 'verbs', { now: NOW }), (item, n) => n !== 0, 7)
    const a = run()
    expect(a.order[0]).toBe('c-sein')
    expect(a.order.filter((id) => id === 'c-sein').length).toBeGreaterThan(1)
    expect(missedIds(a.rs)).toEqual(['c-sein'])
    expect(run().order).toEqual(a.order)
  }

  // is empty (no button) for a course without verb units
  {
    const f = await loadFixture('de-verbs-a1')
    const rs = startRound({ ...f.pack, extensions: {} }, 'verbs', { now: NOW })
    expect(rs.size).toBe(0)
  }
  })
})
