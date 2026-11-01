import { describe, expect, it } from 'vitest'
import { DAY_MS, dueCards, isGrade, mastery, newCard, newSession, nextItem, recordAnswer, retryGap, schedule, type Card, type Grade } from '../src/shared/edu'

const T0 = Date.UTC(2026, 0, 1)
const run = (grades: Grade[], start: Card = newCard('c', T0)): Card[] => {
  const out: Card[] = []
  let c = start
  let now = T0
  for (const g of grades) {
    c = schedule(c, g, now)
    out.push(c)
    now = c.due
  }
  return out
}

describe('SM-2 schedule', () => {
  it('SM-2: good, easy and hard schedules, a lapse, the ease floor', () => {
  // good, good, good, good: 1, 6, 15, 38 days, ease stays 2.5
  {
    const cards = run(['good', 'good', 'good', 'good'])
    expect(cards.map((c) => c.interval)).toEqual([1, 6, 15, 38])
    expect(cards.map((c) => c.ease)).toEqual([2.5, 2.5, 2.5, 2.5])
    expect(cards.map((c) => c.reps)).toEqual([1, 2, 3, 4])
    expect(cards[0]!.due).toBe(T0 + DAY_MS)
    expect(cards[1]!.due).toBe(T0 + DAY_MS + 6 * DAY_MS)
  }
  // easy raises the ease by 0.1 each time: 1, 6, 17, 49
  {
    const cards = run(['easy', 'easy', 'easy', 'easy'])
    expect(cards.map((c) => c.ease)).toEqual([2.6, 2.7, 2.8, 2.9])
    expect(cards.map((c) => c.interval)).toEqual([1, 6, 17, 49])
  }
  // hard lowers the ease by 0.14 each time: 1, 6, 12
  {
    const cards = run(['hard', 'hard', 'hard'])
    expect(cards.map((c) => c.ease)).toEqual([2.36, 2.22, 2.08])
    expect(cards.map((c) => c.interval)).toEqual([1, 6, 12])
  }
  // again is a lapse: back to 1 day, reps 0, lapses + 1, ease - 0.32
  {
    const [a, b, c] = run(['good', 'good', 'again'])
    expect(b!.interval).toBe(6)
    expect(c).toMatchObject({ interval: 1, reps: 0, lapses: 1, ease: 2.18 })
    expect(c!.due).toBe(b!.due + DAY_MS)
    expect(a!.lapses).toBe(0)
    // after the lapse the climb starts again: 1, 6
    expect(run(['good', 'good'], c).map((x) => x.interval)).toEqual([1, 6])
  }
  // the ease never falls below 1.3
  {
    const cards = run(['again', 'again', 'again', 'again', 'again', 'again'])
    expect(cards.map((c) => c.ease)).toEqual([2.18, 1.86, 1.54, 1.3, 1.3, 1.3])
    expect(cards.at(-1)!.lapses).toBe(6)
  }
  })
  it('helpers: no mutation, dueCards order, mastery stages, isGrade', () => {
  // does not change the card it is given, and takes a Date
  {
    const c = newCard('x', T0)
    const n = schedule(c, 'good', new Date(T0))
    expect(c.reps).toBe(0)
    expect(n.due).toBe(T0 + DAY_MS)
    expect(n.last).toBe(T0)
  }
  // dueCards: the most overdue first, ties by id
  {
    const cards = [
      { ...newCard('b', T0), due: T0 + 5 },
      { ...newCard('a', T0), due: T0 + 5 },
      { ...newCard('c', T0), due: T0 - 1000 },
      { ...newCard('d', T0), due: T0 + 9999 }
    ]
    expect(dueCards(cards, T0 + 10).map((c) => c.id)).toEqual(['c', 'a', 'b'])
  }
  // mastery stages
  {
    expect(mastery(newCard('x'))).toBe('new')
    const cards = run(['good', 'good', 'good', 'good'])
    expect(cards.map(mastery)).toEqual(['learning', 'learning', 'young', 'mature'])
  }
  // isGrade
  {
    expect(isGrade('good')).toBe(true)
    expect(isGrade('great')).toBe(false)
  }
  })
})

describe('in-session short steps', () => {
  it('in-session short steps: retry gaps, a missed item returns, repeat when nothing is fresh, misses recorded', () => {
  // retry gaps are 2, 3, then 4 other items
  {
    expect([1, 2, 3, 4, 9].map(retryGap)).toEqual([2, 3, 4, 4, 4])
  }
  // a missed item comes back after 2 other items, then after 3 if missed again
  {
    let s = newSession()
    const fresh = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const order: string[] = []
    const answer = (id: string, g: Grade): void => {
      order.push(id)
      s = recordAnswer(s, id, g)
      const i = fresh.indexOf(id)
      if (i >= 0) fresh.splice(i, 1) // seen once: a miss is handled by the pending list
    }
    answer(nextItem(s, fresh)!, 'again') // a
    answer(nextItem(s, fresh)!, 'good') // b
    answer(nextItem(s, fresh)!, 'good') // c
    expect(nextItem(s, fresh)).toBe('a') // two other items (b, c) came between
    answer('a', 'again')
    answer(nextItem(s, fresh)!, 'good') // d
    answer(nextItem(s, fresh)!, 'good') // e
    expect(nextItem(s, fresh)).toBe('f') // the second gap is 3: not yet
    answer('f', 'good')
    expect(nextItem(s, fresh)).toBe('a')
    answer('a', 'good')
    expect(s.pending).toEqual([])
    expect(order).toEqual(['a', 'b', 'c', 'a', 'd', 'e', 'f', 'a'])
  }
  // when nothing fresh is left the pending item is repeated, and null when all is done
  {
    let s = recordAnswer(newSession(), 'a', 'again')
    expect(nextItem(s, [])).toBe('a')
    s = recordAnswer(s, 'a', 'hard')
    expect(nextItem(s, [])).toBeNull()
  }
  // records misses and does not mutate the previous state
  {
    const s0 = newSession()
    const s1 = recordAnswer(s0, 'x', 'again')
    expect(s0.pending).toEqual([])
    expect(s1).toMatchObject({ answered: 1, misses: { x: 1 }, pending: [{ id: 'x', dueAt: 3, misses: 1 }] })
    const s2 = recordAnswer(s1, 'x', 'again')
    expect(s2.pending).toEqual([{ id: 'x', dueAt: 5, misses: 2 }])
  }
  })
})
