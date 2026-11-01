import { describe, expect, it } from 'vitest'
import { checkItem, makeTextResolver, rngFor, type CheckContext } from '../src/shared/edu'
import type { CourseItem } from '../src/shared/course'
import { buildFeedback } from '../src/player/feedback'
import { makeUi } from '../src/player/i18n'
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

})

describe('ui strings', () => {
  it('a catalog overrides a single string with ui.<key>; unknown languages fall back to English', () => {
    expect(makeUi('en', { strings: { 'ui.start': 'Go!' } })('start')).toBe('Go!')
    expect(makeUi('xx')('start')).toBe('Start')
    expect(makeUi('hr')('question', { i: 2, n: 7 })).toBe('Pitanje 2 od 7')
  })
})
