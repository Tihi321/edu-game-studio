import { describe, expect, it } from 'vitest'
import { LIVE_KINDS, LiveRoom, MAX_PLAYERS, cleanNickname, pointsFor, selectQuestions, type RoomOptions } from '../src/shared/live'
import { fakeClock, fakeQuestion, loadFixture } from './live-helpers'

/** The live quiz state machine and the question selection (EGS-21): pure, with a hand-moved clock. */

function room(n = 2, extra: Partial<RoomOptions> = {}): { r: LiveRoom; clock: ReturnType<typeof fakeClock> } {
  const clock = fakeClock()
  let k = 0
  const r = new LiveRoom({
    questions: Array.from({ length: n }, (_, i) => fakeQuestion(`q${i + 1}`)),
    secondsPerQuestion: 20,
    lang: 'en',
    title: 'T',
    now: clock.now,
    makeToken: () => `tok${++k}`,
    ...extra
  })
  return { r, clock }
}

const join = (r: LiveRoom, name: string): string => {
  const j = r.join(name)
  if (!j.ok) throw new Error(`join failed: ${j.error}`)
  return j.id
}

describe('the room phases', () => {
  it('goes lobby -> question -> reveal -> leaderboard -> question -> reveal -> leaderboard -> podium -> closed', () => {
    const { r } = room(2)
    expect(r.phase).toBe('lobby')
    expect(r.start()).toEqual({ ok: false, error: 'empty' })
    const a = join(r, 'Ana')
    expect(r.next()).toEqual({ ok: false, error: 'phase' })
    expect(r.start()).toEqual({ ok: true })
    expect(r.phase).toBe('question')
    expect(r.start()).toEqual({ ok: false, error: 'phase' })
    expect(r.answer(a, { option: 'a' })).toEqual({ ok: true })
    expect(r.endQuestion().ok).toBe(true)
    const seen = [r.phase]
    r.next()
    seen.push(r.phase)
    r.next()
    seen.push(r.phase)
    r.endQuestion()
    seen.push(r.phase)
    r.next()
    seen.push(r.phase)
    r.next()
    seen.push(r.phase)
    expect(seen).toEqual(['reveal', 'leaderboard', 'question', 'reveal', 'leaderboard', 'podium'])
    expect(r.next()).toEqual({ ok: false, error: 'phase' })
    r.close()
    expect(r.phase).toBe('closed')
    expect(r.join('Late')).toEqual({ ok: false, error: 'closed' })
  })

  it('refuses a join after the start and a late answer after the deadline, and ends the question by itself', () => {
    const { r, clock } = room(1)
    const a = join(r, 'Ana')
    const b = join(r, 'Bo')
    r.start()
    expect(r.join('Cy')).toEqual({ ok: false, error: 'started' })
    clock.advance(5000)
    expect(r.answer(a, { option: 'a' })).toEqual({ ok: true })
    clock.advance(15_001)
    expect(r.answer(b, { option: 'a' })).toEqual({ ok: false, error: 'late' })
    expect(r.phase).toBe('reveal')
    expect(r.view(b).reveal?.you).toEqual({ answered: false, correct: false, points: 0 })

    const { r: all } = room(1)
    const c = join(all, 'Cy')
    const d = join(all, 'Di')
    all.setConnected(c, true)
    all.setConnected(d, true)
    all.start()
    all.answer(c, { option: 'a' })
    expect(all.phase).toBe('question')
    all.answer(d, { option: 'b' })
    expect(all.phase).toBe('reveal')
  })
})

describe('answers and points', () => {
  it('counts only the first answer of a player, and a malformed one may be retried', async () => {
    const { r } = room(1)
    const a = join(r, 'Ana')
    r.start()
    expect(r.answer(a, { option: 'zzz' })).toEqual({ ok: false, error: 'invalid' })
    expect(r.answer(a, 'a')).toEqual({ ok: false, error: 'invalid' })
    expect(r.answer(a, { option: 'b' })).toEqual({ ok: true })
    expect(r.answer(a, { option: 'a' })).toEqual({ ok: false, error: 'already' })
    r.endQuestion()
    expect(r.view(a).you?.score).toBe(0)
    expect(r.view(a).reveal?.you.correct).toBe(false)

    const { pack, catalogs } = await loadFixture('solar-system')
    const q = selectQuestions(pack, catalogs, 'en', { count: 50, seed: 1 }).find((x) => x.kind === 'multi-select')!
    expect(q.correctIds.length).toBeGreaterThan(1)
    expect(q.grade({ options: [q.correctIds[0]] })?.correct).toBe(false)
    expect(q.grade({ options: q.correctIds })?.correct).toBe(true)
    expect(q.grade({ options: [...q.correctIds, q.options.find((o) => !q.correctIds.includes(o.id))!.id] })?.correct).toBe(false)
    expect(q.grade({ options: [] })).toBeNull()
  })

  it('scores by speed, adds the streak bonus on the second right answer, and breaks the streak on a wrong or missing one', () => {
    expect([pointsFor(20_000, 20_000, 0), pointsFor(10_000, 20_000, 0), pointsFor(0, 20_000, 0), pointsFor(20_000, 20_000, 9)]).toEqual([1000, 750, 500, 1200])
    const t = room(1)
    join(t.r, 'Zed')
    t.r.start()
    t.clock.advance(19_999)
    expect(t.r.tick()).toBe(false)
    t.clock.advance(1)
    expect(t.r.tick()).toBe(true)
    const { r, clock } = room(4)
    const fast = join(r, 'Fast')
    const slow = join(r, 'Slow')
    const miss = join(r, 'Miss')
    r.start()
    r.answer(fast, { option: 'a' })
    clock.advance(10_000)
    r.answer(slow, { option: 'a' })
    r.endQuestion()
    expect(r.view(fast).you?.score).toBe(1000)
    expect(r.view(slow).you?.score).toBe(750)
    expect(r.view(miss).you?.score).toBe(0)
    r.next()
    r.next() // question 2
    r.answer(fast, { option: 'a' })
    r.answer(slow, { option: 'b' })
    r.endQuestion()
    expect(r.view(fast).you?.score).toBe(1000 + 1050)
    expect(r.view(fast).you?.streak).toBe(2)
    expect(r.view(slow).you?.score).toBe(750)
    expect(r.view(slow).you?.streak).toBe(0)
    r.next()
    r.next() // question 3: the streak of "fast" gives 100 more
    r.answer(fast, { option: 'a' })
    r.endQuestion()
    expect(r.view(fast).you?.score).toBe(1000 + 1050 + 1100)
  })
})

describe('what a player is allowed to see', () => {
  it('has no key, explanation or item id in the question view and has them in the reveal', () => {
    const { r } = room(1)
    const a = join(r, 'Ana')
    r.start()
    const open = JSON.stringify(r.view(a))
    expect(open).not.toContain('Because q1')
    expect(open).not.toContain('correctIds')
    expect(open).not.toContain('item-q1')
    expect(open).not.toContain('explanation')
    expect(open).toContain('Option A')
    r.endQuestion()
    const rev = r.view(a).reveal
    expect(rev?.correctIds).toEqual(['a'])
    expect(rev?.explanation).toBe('Because q1')
  })

  it('shows the lobby roster, the top 5 plus your own row, and the top 3 of the podium', () => {
    const { r } = room(1)
    const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n) => join(r, n))
    expect(r.view(ids[0]).players).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
    r.start()
    ids.slice(0, 6).forEach((id, i) => {
      r.answer(id, { option: i < 3 ? 'a' : 'b' })
    })
    r.endQuestion()
    r.next()
    const view = r.view(ids[6])
    expect(view.leaderboard?.rows.length).toBe(6)
    expect(view.leaderboard?.rows.at(-1)).toMatchObject({ nickname: 'G', you: true })
    expect(view.leaderboard?.total).toBe(7)
    // equal scores share a rank: A, B and C scored the same, D, E and G (no points) share rank 4
    expect(view.leaderboard?.rows.filter((x) => x.rank === 1).map((x) => x.nickname)).toEqual(['A', 'B', 'C'])
    expect(view.leaderboard?.rows.filter((x) => x.rank === 4).map((x) => x.nickname)).toEqual(['D', 'E', 'G'])
    r.next()
    const pod = r.view(ids[6])
    expect(pod.phase).toBe('podium')
    expect(pod.podium?.rows.map((x) => x.nickname)).toEqual(['A', 'B', 'C', 'G'])
  })
})

describe('the limits', () => {
  it('cleans nicknames: trim, 1..20 characters, no control characters, unique ignoring case', async () => {
    expect(cleanNickname('  Ana  ')).toBe('Ana')
    expect(cleanNickname('')).toBeNull()
    expect(cleanNickname('   ')).toBeNull()
    expect(cleanNickname('x'.repeat(20))).toBe('x'.repeat(20))
    expect(cleanNickname('x'.repeat(21))).toBeNull()
    expect(cleanNickname('a\u0000b')).toBeNull()
    expect(cleanNickname('a\nb')).toBeNull()
    expect(cleanNickname('a‮b')).toBeNull()
    expect(cleanNickname(5)).toBeNull()
    expect(cleanNickname('<b onclick=x>hi</b>')).toBe('<b onclick=x>hi</b>')
    const { r: small } = room(1)
    join(small, 'Ana')
    expect(small.join('ana')).toEqual({ ok: false, error: 'taken' })
    expect(small.join('')).toEqual({ ok: false, error: 'name' })
    const full = room(1).r
    for (let i = 0; i < MAX_PLAYERS; i++) join(full, `p-${i}`)
    expect(full.join('one too many')).toEqual({ ok: false, error: 'full' })
    const { pack, catalogs } = await loadFixture('solar-system')
    const typed = selectQuestions(pack, catalogs, 'en', { count: 50, seed: 3 }).find((x) => x.kind === 'typed')!
    expect(typed.grade({ text: 'x'.repeat(501) })).toBeNull()
    const { r: live } = room(1, { questions: [typed] })
    const a = join(live, 'Ana')
    live.start()
    expect(live.answer(a, { text: 'y'.repeat(2000) })).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('the question selection', () => {
  it('uses only the live kinds, is balanced over the units and is the same for the same seed', async () => {
    const { pack, catalogs } = await loadFixture('solar-system')
    const a = selectQuestions(pack, catalogs, 'en', { count: 6, seed: 42 })
    const b = selectQuestions(pack, catalogs, 'en', { count: 6, seed: 42 })
    const c = selectQuestions(pack, catalogs, 'en', { count: 6, seed: 43 })
    expect(a.map((q) => q.itemId)).toEqual(b.map((q) => q.itemId))
    expect(a.map((q) => q.options.map((o) => o.id))).toEqual(b.map((q) => q.options.map((o) => o.id)))
    expect(a.map((q) => q.itemId)).not.toEqual(c.map((q) => q.itemId))
    expect(a).toHaveLength(6)
    for (const q of a) expect(LIVE_KINDS as readonly string[]).toContain(q.kind)
    const perUnit = new Map<string, number>()
    for (const q of a) perUnit.set(q.unitId, (perUnit.get(q.unitId) ?? 0) + 1)
    expect(perUnit.size).toBe(pack.units.length)
    expect(Math.max(...perUnit.values()) - Math.min(...perUnit.values())).toBeLessThanOrEqual(1)
    expect(new Set(a.map((q) => q.itemId)).size).toBe(6)
    const all = selectQuestions(pack, catalogs, 'en', { count: 500, seed: 1 })
    expect(all.length).toBeGreaterThan(8)
    expect(all.length).toBeLessThan(pack.items.length)
  })
})
