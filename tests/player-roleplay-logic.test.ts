import { describe, expect, it } from 'vitest'
import type { CourseItem, TextCatalog } from '../src/shared/course'
import { newCard, schedule, type Card } from '../src/shared/edu/srs'
import { makeTextResolver } from '../src/shared/edu/text'
import { walkScene, type RoleplaySection, type RpScene, type RpWord } from '../src/shared/shells/roleplay'
import { newlyOpen, nextScene, sceneBoard } from '../src/player/shells/roleplay/board'
import { accuracy, answerTurn, isDone, MAX_TRIES, replyText, reveal, startScene, stepOf, turnCount, type SceneState } from '../src/player/shells/roleplay/dialogue'
import { plantsOf, stageOf } from '../src/player/shells/roleplay/garden'

/**
 * The pure logic of the language role-play shell (EGS-13): the dialogue walker (right and wrong answers, the recovery, the retries, the
 * stars from the first try), the scene board (what is locked), the garden growth from the SM-2 cards, and the helpers of the course side.
 */

const NOW = 1_800_000_000_000

const scene: RpScene = {
  id: 'sc',
  unit: 'u1',
  title: 't',
  start: 's1',
  lines: [
    { id: 's1', say: 'ana', listen: false, text: 'k.s1', translation: 'k.s1.tr', next: 'r1' },
    { id: 'r1', reply: 'item-a', help: 'k.help', next: 's2' },
    { id: 's2', say: 'luka', text: 'k.s2', audio: 'aud-s2', listen: true, next: 'r2' },
    { id: 'r2', reply: 'item-b', next: 's3' },
    { id: 's3', say: 'ana', listen: false, text: 'k.s3', next: null }
  ]
}

const play = (steps: (boolean | number)[], sc: RpScene = scene): SceneState => {
  let st = startScene(sc)
  for (const right of steps) {
    // reveal until a turn waits
    while (stepOf(sc, st).type === 'say') st = reveal(sc, st)
    const score = typeof right === 'number' ? right : right ? 1 : 0
    st = answerTurn(sc, st, { correct: score === 1, score, text: 'my words' })
  }
  while (stepOf(sc, st).type === 'say') st = reveal(sc, st)
  return st
}

describe('walkScene', () => {
  it('follows the chain from the start to the line whose next is null', () => {
    expect(walkScene(scene)).toEqual({ path: ['s1', 'r1', 's2', 'r2', 's3'], ends: true })
    expect(turnCount(scene)).toBe(2)
  })

})

describe('dialogue: a perfect scene', () => {
  it('reveals say lines one by one and asks each turn once; both turns right first time = full accuracy', () => {
    let st = startScene(scene)
    expect(stepOf(scene, st)).toMatchObject({ type: 'say', line: { id: 's1' } })
    st = reveal(scene, st)
    expect(st.log).toEqual([{ kind: 'say', lineId: 's1', speaker: 'ana' }])
    expect(stepOf(scene, st)).toMatchObject({ type: 'turn', retry: false, tries: 0, line: { id: 'r1' } })
    expect(reveal(scene, st)).toBe(st) // reveal does nothing while a turn waits
    st = answerTurn(scene, st, { correct: true, score: 1, text: 'Dobro jutro' })
    expect(st.log.at(-1)).toEqual({ kind: 'you', lineId: 'r1', outcome: 'right', text: 'Dobro jutro' })
    expect(st.retry).toBeNull()
    expect(stepOf(scene, st)).toMatchObject({ type: 'say', line: { id: 's2' } })
    st = play([true, true])
    expect(isDone(scene, st)).toBe(true)
    expect(stepOf(scene, st)).toEqual({ type: 'done' })
    expect(st.turns.map((t) => [t.lineId, t.tries, t.score, t.right, t.shown])).toEqual([['r1', 1, 1, true, false], ['r2', 1, 1, true, false]])
    expect(accuracy(st)).toBe(1)
    expect(st.log.filter((e) => e.kind === 'help')).toEqual([])
  })
})

describe('dialogue: a miss never ends the talk', () => {
  it('the speaker helps (recovery line) and the same turn is asked again', () => {
    let st = startScene(scene)
    st = reveal(scene, st)
    st = answerTurn(scene, st, { correct: false, score: 0, text: 'Dobro jutro' })
    expect(st.retry).toEqual({ lineId: 'r1', tries: 1 })
    expect(st.log.at(-1)).toEqual({ kind: 'help', lineId: 'r1', speaker: 'ana', attempt: 1 })
    expect(stepOf(scene, st)).toMatchObject({ type: 'turn', retry: true, tries: 1, line: { id: 'r1' } })
    expect(st.cursor).toBe('r1') // the cursor stays on the turn: it is asked again through `retry`
  })

  it(`after ${MAX_TRIES} misses the right reply is shown and the scene goes on: never a dead end`, () => {
    let st = startScene(scene)
    st = reveal(scene, st)
    for (let i = 1; i <= MAX_TRIES; i++) {
      expect(stepOf(scene, st)).toMatchObject({ type: 'turn', retry: i > 1, tries: i - 1 })
      st = answerTurn(scene, st, { correct: false, score: 0, text: 'Dobro jutro' })
    }
    expect(st.retry).toBeNull()
    expect(st.log.filter((e) => e.kind === 'help').map((e) => (e.kind === 'help' ? e.attempt : 0))).toEqual([1, 2, 3])
    expect(st.log.at(-1)).toEqual({ kind: 'you', lineId: 'r1', outcome: 'shown', text: 'Dobro jutro' })
    expect(st.turns[0]).toMatchObject({ right: false, shown: true, tries: MAX_TRIES, score: 0 })
    expect(stepOf(scene, st)).toMatchObject({ type: 'say', line: { id: 's2' } })
  })

  it('only the FIRST answer counts for the stars: a retry that is right does not raise the accuracy', () => {
    const st = play([false, true, true])
    expect(st.turns[0]).toMatchObject({ tries: 2, score: 0, right: true, shown: false })
    expect(st.log.at(-1)).toMatchObject({ kind: 'say' })
    expect(accuracy(st)).toBe(0.5)
    expect(st.log.filter((e) => e.kind === 'help')).toHaveLength(1)
  })

})

describe('replyText: the words of the learner bubble', () => {
  const catalogs: Record<string, TextCatalog> = {
    en: { schema: 1, lang: 'en', strings: { 'o.hi': 'Dobar dan', 'o.no': 'Laku noć', 'cz': 'Dobra {{1}}!', 'you': 'Dobar dan, gospođo' } },
    hr: { schema: 1, lang: 'hr', strings: { 'a.typed': 'Doviđenja' }, accepted: { 'a.typed': ['Doviđenja', 'Do viđenja'], 'g.vecer': ['večer'] } }
  }
  const text = makeTextResolver(catalogs, 'en', 'hr')
  const item = (x: Record<string, unknown>): CourseItem => x as unknown as CourseItem
  it('typed: the canonical (first accepted) answer; mcq and listening-choose: the text of the right option; cloze: gaps filled', () => {
    expect(replyText(item({ kind: 'typed', answer: 'a.typed' }), {}, text)).toBe('Doviđenja')
    expect(replyText(item({ kind: 'mcq', answer: 'hi', options: [{ id: 'hi', text: 'o.hi' }, { id: 'no', text: 'o.no' }] }), {}, text)).toBe('Dobar dan')
    expect(replyText(item({ kind: 'listening', mode: 'choose', answer: 'no', options: [{ id: 'hi', text: 'o.hi' }, { id: 'no', text: 'o.no' }] }), {}, text)).toBe('Laku noć')
    expect(replyText(item({ kind: 'cloze', text: 'cz', gaps: [{ id: '1', answer: 'g.vecer' }] }), {}, text)).toBe('Dobra večer!')
  })
})

describe('sceneBoard: what is locked', () => {
  const units = [
    { id: 'u1', requires: [] as string[] },
    { id: 'u2', requires: ['u1'] },
    { id: 'u3', requires: ['u2'] },
    { id: 'u4', requires: ['u3'] } // u3 has no scene: it never blocks u4
  ]
  const sc = (id: string, unit?: string): RpScene => ({ id, ...(unit ? { unit } : {}), title: id, start: 'a', lines: [{ id: 'a', reply: 'i', next: null }] })
  const section: Pick<RoleplaySection, 'scenes' | 'finale'> = { scenes: [sc('s1', 'u1'), sc('s2', 'u2'), sc('s4', 'u4'), sc('fin')], finale: 'fin' }
  const mastered = new Set<string>()
  const stars: Record<string, number> = {}
  const board = (boss = 0) => sceneBoard({ section, pack: { units: units as never }, mastered: (u) => mastered.has(u), unitStars: (u) => stars[u] ?? 0, bossStars: boss })

  it('only the first unit is open at the start; the finale is last and locked; units without a scene are looked through', () => {
    const b = board()
    expect(b.map((e) => [e.scene.id, e.locked, e.finale])).toEqual([['s1', false, false], ['s2', true, false], ['s4', true, false], ['fin', true, true]])
    expect(b[1]?.needs).toEqual(['u1'])
    expect(b.every((e) => e.turns === 1)).toBe(true)
    expect(nextScene(b)?.scene.id).toBe('s1')
  })

  it('mastering a unit (2 stars) opens the next scene; the finale opens when every unit that has a scene is mastered', () => {
    const before = board()
    mastered.add('u1')
    stars.u1 = 2
    const b2 = board()
    expect(b2.map((e) => e.locked)).toEqual([false, false, true, true])
    expect(b2[0]?.stars).toBe(2)
    expect(newlyOpen(before, b2)).toEqual(['s2'])
    expect(nextScene(b2)?.scene.id).toBe('s2')
    expect(nextScene(b2, 3)?.scene.id).toBe('s1')
    mastered.add('u2')
    const b3 = board()
    // u3 has no scene: u4 needs what u3 needs (u2), which is mastered now
    expect(b3.map((e) => e.locked)).toEqual([false, false, false, true])
    mastered.add('u4')
    const b4 = board(1)
    expect(b4.at(-1)).toMatchObject({ locked: false, finale: true, stars: 1 })
  })

})

describe('garden: growth from the SM-2 cards', () => {
  const card = (grades: ('again' | 'hard' | 'good' | 'easy')[]): Card => grades.reduce((c, g, i) => schedule(c, g, NOW + i * 1000), newCard('i'))

  it('stages: seed, sprout, bud, bloom, wilted', () => {
    expect(stageOf(undefined, false)).toBe('seed')
    expect(stageOf(newCard('i'), false)).toBe('seed')
    expect(stageOf(card(['good']), false)).toBe('sprout')
    expect(stageOf(card(['good', 'good']), false)).toBe('sprout')
    expect(stageOf(card(['good', 'good', 'good']), false)).toBe('bud') // 3 in a row, next review within 21 days
    const mature = card(['good', 'good', 'good', 'good', 'good'])
    expect(mature.interval).toBeGreaterThanOrEqual(21)
    expect(stageOf(mature, false)).toBe('bloom')
    expect(stageOf(card(['good', 'again']), false)).toBe('wilted') // the last answer was a miss
    expect(stageOf(card(['good', 'good']), true)).toBe('wilted') // in the review queue
    expect(stageOf(undefined, true)).toBe('wilted')
  })

  const words: RpWord[] = [
    { id: 'w1', text: 'k.w1', gloss: 'k.g1', item: 'i1' },
    { id: 'w2', text: 'k.w2', gloss: 'k.g2', item: 'i2' },
    { id: 'w3', text: 'k.w3', gloss: 'k.g3', item: 'i3' },
    { id: 'w4', text: 'k.w4', gloss: 'k.g4', item: 'i4' },
    { id: 'w5', text: 'k.w5', gloss: 'k.g5', item: 'i-gone' }
  ]
  const pack = {
    items: ['i1', 'i2', 'i3', 'i4'].map((id) => ({ id, objective: id === 'i4' ? 'o2' : 'o1' })) as never,
    objectives: [{ id: 'o1', unit: 'u1' }, { id: 'o2', unit: 'u2' }] as never
  }
  const cards: Record<string, Card> = {
    i1: card(['good', 'good', 'good']), // bud, due in the future
    i2: card(['good']), // sprout; due tomorrow
    i3: card(['good', 'again']) // wilted
  }
  const plants = (over: Partial<Parameters<typeof plantsOf>[0]> = {}) => plantsOf({ section: { garden: words }, pack, cards, queue: [], doneUnits: [], now: NOW, ...over })

  it('a word is planted once its item was answered or a scene of its unit was finished; words of missing items are left out', () => {
    const p = plants()
    expect(p.map((x) => x.word.id)).toEqual(['w1', 'w2', 'w3', 'w4'])
    expect(p.map((x) => x.planted)).toEqual([true, true, true, false])
    expect(p.map((x) => x.stage)).toEqual(['bud', 'sprout', 'wilted', 'seed'])
    const finished = plants({ doneUnits: ['u2'] })
    expect(finished[3]).toMatchObject({ planted: true, stage: 'seed', due: true, dueAt: null })
  })

})
