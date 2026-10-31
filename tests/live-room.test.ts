import { describe, expect, it } from 'vitest'
import { LIVE_KINDS, LiveRoom, MAX_PLAYERS, cleanNickname, pointsFor, publicQuestion, selectQuestions, type RoomOptions } from '../src/shared/live'
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

describe('scoring', () => {
  it('is 1000 at once, 750 at half time, 500 at the deadline, plus 50 per earlier right answer in a row (at most 200)', () => {
    expect(pointsFor(20_000, 20_000, 0)).toBe(1000)
    expect(pointsFor(10_000, 20_000, 0)).toBe(750)
    expect(pointsFor(0, 20_000, 0)).toBe(500)
    expect(pointsFor(20_000, 20_000, 1)).toBe(1050)
    expect(pointsFor(20_000, 20_000, 9)).toBe(1200)
    expect(pointsFor(-5, 20_000, 0)).toBe(500)
  })
})

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
  })

  it('tick() ends the question exactly at the deadline, not before', () => {
    const { r, clock } = room(1)
    join(r, 'Ana')
    r.start()
    clock.advance(19_999)
    expect(r.tick()).toBe(false)
    clock.advance(1)
    expect(r.tick()).toBe(true)
    expect(r.phase).toBe('reveal')
  })

  it('ends the question when every connected player has answered', () => {
    const { r } = room(1)
    const a = join(r, 'Ana')
    const b = join(r, 'Bo')
    r.setConnected(a, true)
    r.setConnected(b, true)
    r.start()
    r.answer(a, { option: 'a' })
    expect(r.phase).toBe('question')
    r.answer(b, { option: 'b' })
    expect(r.phase).toBe('reveal')
  })

  it('lets the host end a question early and kick a player', () => {
    const { r } = room(1)
    const a = join(r, 'Ana')
    const b = join(r, 'Bo')
    expect(r.kick(b)).toBe(true)
    expect(r.playerOf('tok2')).toBeUndefined()
    r.start()
    expect(r.answer(b, { option: 'a' })).toEqual({ ok: false, error: 'unknown' })
    expect(r.endQuestion().ok).toBe(true)
    expect(r.view(a).playerCount).toBe(1)
    expect(r.kick('nobody')).toBe(false)
  })
})

describe('answers and points', () => {
  it('counts only the first answer of a player, and a malformed one may be retried', () => {
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
  })

  it('scores by speed, adds the streak bonus on the second right answer, and breaks the streak on a wrong or missing one', () => {
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

  it('never gives partial credit on a multi-select', async () => {
    const { pack, catalogs } = await loadFixture('solar-system')
    const q = selectQuestions(pack, catalogs, 'en', { count: 50, seed: 1 }).find((x) => x.kind === 'multi-select')
    expect(q).toBeTruthy()
    const [first] = q!.correctIds
    expect(q!.correctIds.length).toBeGreaterThan(1)
    expect(q!.grade({ options: [first] })?.correct).toBe(false)
    expect(q!.grade({ options: q!.correctIds })?.correct).toBe(true)
    expect(q!.grade({ options: [...q!.correctIds, q!.options.find((o) => !q!.correctIds.includes(o.id))!.id] })?.correct).toBe(false)
    expect(q!.grade({ options: ['nope'] })).toBeNull()
    expect(q!.grade({ options: [] })).toBeNull()
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

  it('has the same view for a player that reconnects (the whole view is a function of the room)', () => {
    const { r } = room(1)
    const a = join(r, 'Ana')
    r.start()
    expect(r.view(a)).toEqual(r.view(a))
    expect(r.view(a).question?.remainingMs).toBe(20_000)
  })
})

describe('the limits', () => {
  it('cleans nicknames: trim, 1..20 characters, no control characters, unique ignoring case', () => {
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
    const { r } = room(1)
    join(r, 'Ana')
    expect(r.join('ana')).toEqual({ ok: false, error: 'taken' })
    expect(r.join('')).toEqual({ ok: false, error: 'name' })
  })

  it('takes at most 60 players', () => {
    const { r } = room(1)
    for (let i = 0; i < MAX_PLAYERS; i++) join(r, `p-${i}`)
    expect(r.join('one too many')).toEqual({ ok: false, error: 'full' })
  })

  it('refuses an answer payload over 500 characters', async () => {
    const { pack, catalogs } = await loadFixture('solar-system')
    const typed = selectQuestions(pack, catalogs, 'en', { count: 50, seed: 3 }).find((x) => x.kind === 'typed')!
    expect(typed.grade({ text: 'x'.repeat(501) })).toBeNull()
    const { r } = room(1, { questions: [typed] })
    const a = join(r, 'Ana')
    r.start()
    expect(r.answer(a, { text: 'y'.repeat(2000) })).toEqual({ ok: false, error: 'invalid' })
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

  it('makes the question text of the chosen edition and strips the key from the public view', async () => {
    const { pack, catalogs } = await loadFixture('solar-system')
    const hr = selectQuestions(pack, catalogs, 'hr', { count: 12, seed: 5 })
    const en = selectQuestions(pack, catalogs, 'en', { count: 12, seed: 5 })
    expect(hr.map((q) => q.prompt)).not.toEqual(en.map((q) => q.prompt))
    const tf = hr.find((q) => q.kind === 'true-false')!
    expect(tf.options.map((o) => o.text)).toEqual(['Točno', 'Netočno'])
    for (const q of en) {
      const pub = publicQuestion(q, 0, 1, 20, 20_000)
      expect(Object.keys(pub).sort()).toEqual(['index', 'kind', 'multi', 'options', 'prompt', 'remainingMs', 'seconds', 'total'])
      if (q.explanation) expect(JSON.stringify(pub)).not.toContain(q.explanation)
      if (q.kind === 'typed') expect(JSON.stringify(pub)).not.toContain(q.correctText)
    }
  })

  it('checks typed answers with the shared tolerant matcher', async () => {
    const { pack, catalogs } = await loadFixture('solar-system')
    const typed = selectQuestions(pack, catalogs, 'en', { count: 50, seed: 9 }).filter((q) => q.kind === 'typed')
    expect(typed.length).toBeGreaterThan(0)
    for (const q of typed) {
      expect(q.grade({ text: q.correctText })?.correct).toBe(true)
      expect(q.grade({ text: `  ${q.correctText.toUpperCase()}  ` })?.correct).toBe(true)
      expect(q.grade({ text: 'zzzzzzzz qqqq' })?.correct).toBe(false)
      expect(q.grade({ text: '   ' })).toBeNull()
      expect(q.grade({ nope: 1 })).toBeNull()
    }
  })
})

describe('determinism', () => {
  it('gives the same standings when the same script is played twice with the same seed and clock', async () => {
    const { pack, catalogs } = await loadFixture('solar-system')
    const play = (): string => {
      const questions = selectQuestions(pack, catalogs, 'en', { count: 4, seed: 7 })
      const clock = fakeClock()
      let k = 0
      const r = new LiveRoom({ questions, secondsPerQuestion: 20, lang: 'en', title: 'T', now: clock.now, makeToken: () => `t${++k}` })
      const ids = ['A', 'B', 'C'].map((n) => join(r, n))
      r.start()
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i]!
        ids.forEach((id, n) => {
          clock.advance(1000 * (n + 1))
          const right = q.kind === 'typed' ? { text: q.correctText } : q.kind === 'multi-select' ? { options: q.correctIds } : { option: q.correctIds[0] }
          const wrong = q.kind === 'typed' ? { text: 'nope nope' } : q.kind === 'multi-select' ? { options: [q.options[0]!.id] } : { option: q.options.find((o) => !q.correctIds.includes(o.id))?.id ?? q.options[0]!.id }
          r.answer(id, (i + n) % 2 === 0 ? right : wrong)
        })
        r.endQuestion()
        r.next()
        r.next()
      }
      return JSON.stringify(r.view(ids[0]).podium)
    }
    expect(play()).toBe(play())
  })
})
