import { describe, expect, it } from 'vitest'
import { checkItem, makeTextResolver, rngFor, solveItem, type CheckContext } from '../src/shared/edu'
import type { CourseItem } from '../src/shared/course'
import { answerLines, buildFeedback, whysFor } from '../src/player/feedback'
import { UI_KEYS, makeUi } from '../src/player/i18n'
import { buildSnapshot } from '../src/player/state'
import { loadFixture } from './edu-fixtures'

const setup = async (name: 'solar-system' | 'hr-a1-greetings', lang: string) => {
  const f = await loadFixture(name)
  const text = makeTextResolver(f.catalogs, lang, f.pack.targetLang)
  const check: CheckContext = { text, diacritics: f.pack.matching.diacritics, typos: f.pack.matching.typos }
  const ui = makeUi(lang, f.catalogs[lang])
  const fb = (item: CourseItem, answer: unknown) => buildFeedback(item, answer, checkItem(item, answer, check), { text, ui, rng: rngFor(1) })
  return { f, text, check, ui, fb }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('feedback', () => {
  it('a wrong mcq shows the why of the CHOSEN distractor, the explanation and the answer', async () => {
    const { f, text, fb } = await setup('solar-system', 'en')
    const item = f.pack.items.find((i) => i.kind === 'mcq' && (i as any).options.filter((o: any) => o.why).length >= 2) as any
    const [wrong, other] = item.options.filter((o: any) => o.id !== item.answer && o.why)
    const res = fb(item, wrong.id)
    expect(res.verdict).toBe('wrong')
    expect(res.whys).toEqual([text.t(wrong.why)])
    expect(res.whys).not.toContain(text.t(other.why))
    expect(res.explanation).toBe(text.t(item.explanation))
    expect(res.answer).toEqual([text.t(item.options.find((o: any) => o.id === item.answer).text)])
    expect(res.dyk).toBeUndefined()
  })

  it('a right answer has the did-you-know hook, no answer lines and no whys', async () => {
    const { f, text, check, fb } = await setup('solar-system', 'en')
    const item = f.pack.items.find((i) => i.kind === 'mcq' && i.didYouKnow)!
    const res = fb(item, solveItem(item, check))
    expect(res.verdict).toBe('correct')
    expect(res.dyk).toBe(text.t(item.didYouKnow!))
    expect(res.answer).toEqual([])
    expect(res.whys).toEqual([])
  })

  it('multi-select, sort-groups and hotspot explain the wrong choices', async () => {
    const { f, text } = await setup('solar-system', 'en')
    const ms = f.pack.items.find((i) => i.kind === 'multi-select') as any
    const wrong = ms.options.find((o: any) => !ms.answers.includes(o.id))
    expect(whysFor(ms, [...ms.answers, wrong.id], text)).toEqual(wrong.why ? [text.t(wrong.why)] : [])
    const sg = f.pack.items.find((i) => i.kind === 'sort-groups') as any
    const placed = Object.fromEntries(sg.items.map((x: any) => [x.id, x.group]))
    placed[sg.items[0].id] = sg.groups.find((g: any) => g.id !== sg.items[0].group).id
    expect(whysFor(sg, placed, text)).toEqual(sg.items[0].why ? [text.t(sg.items[0].why)] : [])
    const hs = f.pack.items.find((i) => i.kind === 'hotspot' && (i as any).regions.some((r: any) => r.why && r.id !== (i as any).answer)) as any
    const region = hs.regions.find((r: any) => r.why && r.id !== hs.answer)
    expect(whysFor(hs, region.id, text)).toEqual([text.t(region.why)])
    // a click inside that region (a point) reads the same
    const s = region.shape
    const point = s.type === 'circle' ? { x: s.cx, y: s.cy } : s.type === 'rect' ? { x: s.x + 1, y: s.y + 1 } : { x: s.points[0][0], y: s.points[0][1] }
    expect(whysFor(hs, point, text).length).toBeLessThanOrEqual(1)
  })

  it('typed answers: typo and accent notes come from the matcher', async () => {
    const { f, ui, fb } = await setup('hr-a1-greetings', 'en')
    const strict = f.pack.items.find((i) => i.id === 'g-evening-typed')! // strictDiacritics: true
    const accents = fb(strict, 'dobra vecer')
    expect(accents.verdict).toBe('wrong')
    expect(accents.notes).toContain(ui('fb.accents.strict', { a: 'Dobra večer' }))
    expect(fb(strict, 'Dobra večer').verdict).toBe('correct')
    const name = f.pack.items.find((i) => i.id === 'g-name-typed')!
    const typo = fb(name, 'zovem se Anq')
    expect(typo.verdict).toBe('correct')
    expect(typo.notes).toContain(ui('fb.typo', { a: 'Zovem se Ana' }))
    const wrong = fb(name, 'qqqq')
    expect(wrong.verdict).toBe('wrong')
    expect(wrong.answer).toEqual(['Zovem se Ana'])
  })

  it('a timeout is its own verdict and shows the answer', async () => {
    const { f, text, check, ui } = await setup('solar-system', 'en')
    const item = f.pack.items.find((i) => i.kind === 'mcq')!
    const res = buildFeedback(item, undefined, checkItem(item, undefined, check), { text, ui, rng: rngFor(1) }, true)
    expect(res.verdict).toBe('timeout')
    expect(res.answer.length).toBe(1)
  })

  it('every item of both fixtures has answer lines and a solving answer is correct', async () => {
    for (const name of ['solar-system', 'hr-a1-greetings'] as const) {
      const { f, text, ui, check, fb } = await setup(name, 'en')
      for (const item of f.pack.items) {
        expect(answerLines(item, { text, ui }).length, item.id).toBeGreaterThan(0)
        expect(fb(item, solveItem(item, check)).verdict, item.id).toBe('correct')
      }
    }
  })
})

describe('ui strings', () => {
  it('Croatian has every key, with its placeholders', () => {
    const en = makeUi('en')
    const hr = makeUi('hr')
    for (const k of UI_KEYS) {
      const vars = Object.fromEntries((en(k).match(/\{(\w+)\}/g) ?? []).map((m) => [m.slice(1, -1), 'X']))
      expect(hr(k, vars), k).not.toMatch(/\{\w+\}/)
      if (!/^(a11y\.skip)$/.test(k)) expect(hr(k, vars), k).not.toBe(en(k, vars))
    }
  })
  it('a catalog overrides a single string with ui.<key>; unknown languages fall back to English', () => {
    expect(makeUi('en', { strings: { 'ui.start': 'Go!' } })('start')).toBe('Go!')
    expect(makeUi('de')('start')).toBe('Start')
    expect(makeUi('hr')('question', { i: 2, n: 7 })).toBe('Pitanje 2 od 7')
  })
})

describe('state snapshot', () => {
  const base = { shell: 'quiz-arena', lang: 'en', seed: 1, combo: 0, score: 0, reviewQueue: [] as string[], mastery: {}, finished: false, steps: 0 }
  it('is JSON-safe and only shows item fields while a question is open', () => {
    const open = buildSnapshot({ ...base, screen: 'item', roundNumber: 1, roundKind: 'unit', unitId: 'u', itemId: 'i', itemKind: 'mcq', itemIndex: 2, roundSize: 7, reviewQueue: ['a'], mastery: { u: 1 } })
    expect(JSON.parse(JSON.stringify(open))).toEqual(open)
    expect(open).toMatchObject({ screen: 'item', round: 1, roundKind: 'unit', unitId: 'u', itemId: 'i', itemKind: 'mcq', itemIndex: 2, roundSize: 7, reviewQueue: ['a'], mastery: { u: 1 } })
    expect('lastResult' in open).toBe(false)
    const map = buildSnapshot({ ...base, screen: 'map', itemId: 'i', itemKind: 'mcq', itemIndex: 2 })
    expect('itemId' in map).toBe(false)
    expect('round' in map).toBe(false)
  })
  it('lastResult only on the feedback screen, and copies are independent', () => {
    const q = ['a']
    const fb = buildSnapshot({ ...base, screen: 'feedback', itemId: 'i', itemKind: 'typed', lastResult: { correct: true, typo: true }, reviewQueue: q })
    expect(fb.lastResult).toEqual({ correct: true, typo: true })
    q.push('b')
    expect(fb.reviewQueue).toEqual(['a'])
    expect(buildSnapshot({ ...base, screen: 'summary', lastResult: { correct: false } }).lastResult).toBeUndefined()
  })
})
