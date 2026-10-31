import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assembleCourse, renderCourseForReview } from '../src/engine/edu/assemble'
import { numberCitations, citationsOf } from '../src/engine/edu/authoring'
import type { AuthoredItem } from '../src/engine/edu/authoring'
import { lintGame, lintGameData } from '../src/engine/edu/lint'
import { CourseStore } from '../src/engine/edu/store'
import { validateCourse } from '../src/shared/edu'
import { assembleInput, ITEMS } from './edu-authored-fixture'
import { fakeBundle, tmp, useTemp } from './edu-build-helpers'

useTemp()

const codes = (ps: { code: string }[]) => [...new Set(ps.map((p) => p.code))].sort()

describe('assembleCourse: the roles\' outputs become the course contract', () => {
  it('drops a link to an article that was never written (a planned id)', () => {
    const input = assembleInput()
    const linked = { ...input, articles: input.articles.map((x, i) => (i === 0 ? { ...x, related: [input.articles[1]!.id, 'a-u9-1'] } : x)) }
    const { pack } = assembleCourse(linked)
    expect((pack.encyclopedia as { articles: { related: string[] }[] }).articles[0]!.related).toEqual([input.articles[1]!.id])
  })

  it('the fixture assembles into a pack and a catalog with no validation problem at all', () => {
    const { pack, catalogs } = assembleCourse(assembleInput())
    const res = validateCourse(pack, catalogs)
    expect(res.problems).toEqual([])
    expect(res.ok).toBe(true)
    expect(Object.keys(catalogs)).toEqual(['en'])
    expect(pack).toMatchObject({ schema: 1, id: 'roman-basics', slug: 'roman-basics', sourceLang: 'en', languages: ['en'], subject: 'Ancient Rome', audience: 'Teenagers' })
  })

  it('uses the key names of the plan, and every text of the roles is in the catalog', () => {
    const { pack, catalogs } = assembleCourse(assembleInput())
    const s = catalogs.en!.strings
    expect(s['course.title']).toBe('Roman Basics')
    expect(s['unit.u1.title']).toBe('The fall of Rome')
    expect(s['unit.u2.summary']).toContain('Colosseum')
    expect(s['obj.u1-o1.text']).toContain('Western Roman Empire')
    for (const key of ['item.q1.prompt', 'item.q1.expl', 'item.q1.hint', 'item.q1.opt.a', 'item.q1.opt.b', 'item.q1.opt.b.why', 'item.q2.why', 'item.q4.text', 'item.q4.gap.g1', 'item.q4.gap.g1.b1', 'item.q4.gap.g1.b2', 'item.q4.dyk', 'item.q5.back', 'item.q6.pair.p1.l', 'item.q6.pair.p1.r', 'item.q7.step.s1', 'item.q7.step.s1.when', 'item.q8.group.g1', 'item.q8.entry.e1', 'item.q8.entry.e2.why', 'art.a-fall.title', 'art.a-fall.body', 'fact.f1.claim', 'story.premise', 'story.intro', 'story.outro', 'story.char.1.name', 'story.beat.u1']) {
      expect(s[key], key).toBeTruthy()
    }
    expect(catalogs.en!.accepted).toEqual({ 'item.q3.answer': ['476'], 'item.q4.gap.g1': ['Curia', 'the Curia'] })
    expect(s['item.q4.text']).toBe('The Roman Senate met in the {{g1}}.')
    expect(s['item.q4.gap.g1']).toBe('Curia') // a banked gap's answer key is a string too
    // the right option has no why, the wrong ones do
    const q1 = (pack.items as Record<string, unknown>[]).find((i) => i.id === 'q1') as { options: { id: string; why?: string }[]; answer: string; tags: string[]; extensions: { facts: string[] }; difficulty: number }
    expect(q1.options.map((o) => [o.id, !!o.why])).toEqual([['a', false], ['b', true], ['c', true], ['d', true]])
    expect(q1).toMatchObject({ answer: 'a', tags: ['unit:u1'], extensions: { facts: ['f1'] }, difficulty: 2 })
  })

  it('articles cite their facts: [f3] becomes the number of the article\'s own citation list, and the pack has the fact base', () => {
    const { pack, catalogs } = assembleCourse(assembleInput())
    const arts = (pack.encyclopedia as { articles: { id: string; citations: string[]; related: string[]; unit: string; body: string }[] }).articles
    expect(arts.map((a) => [a.id, a.unit, a.citations, a.related])).toEqual([['a-fall', 'u1', ['f1', 'f2', 'f3'], ['a-rome']], ['a-rome', 'u2', ['f4', 'f5', 'f6'], ['a-fall']]])
    expect(catalogs.en!.strings['art.a-fall.body']).toContain('ended in the year 476 [1]')
    expect(catalogs.en!.strings['art.a-fall.body']).toContain('the Curia [3]')
    expect(catalogs.en!.strings['art.a-fall.body']).not.toMatch(/\[f\d/)
    expect(pack.factbase).toHaveLength(6)
    expect(pack.factbase).toContainEqual({ id: 'f1', claim: 'fact.f1.claim', source: 'The end of the western empire', url: 'https://example.org/476' })
    expect(numberCitations('A [f5, f3] B [f3][f9] C [f7].', ['f3', 'f5'])).toBe('A [1, 2] B [1] C .')
    expect(citationsOf({ body: 'x [f2] y [f1, f2]' })).toEqual(['f2', 'f1'])
  })

  it('records the run and the brief, the design and the story; objectives carry their facts', () => {
    const { pack } = assembleCourse(assembleInput())
    expect(pack.extensions).toMatchObject({
      pipeline: { run: 1, generatedBy: 'edu-pipeline', brief: { topic: 'Ancient Rome' }, requestedShells: ['detective'] },
      story: { premise: 'story.premise', intro: 'story.intro', outro: 'story.outro', characters: [{ id: 'c1', name: 'story.char.1.name' }], beats: [{ unit: 'u1', text: 'story.beat.u1' }, { unit: 'u2', text: 'story.beat.u2' }] }
    })
    expect(pack.shells).toEqual({ enabled: ['quiz-arena', 'rpg'], config: { 'quiz-arena': { roundLength: 5, bossLength: 6, timerSeconds: 30 }, rpg: { story: { intro: ['story.intro'], outro: ['story.outro'] } } } }) // the rpg plays from its automatic layout and tells the frame story; the detective needs authored cases, so it is only recorded
    expect((pack.objectives as { id: string; facts: string[] }[]).find((o) => o.id === 'u1-o1')!.facts).toEqual(['f1', 'f2'])
    expect((pack.items as { id: string; difficulty: number }[]).find((i) => i.id === 'q3')!.difficulty).toBe(3) // the design's value
    const bare = assembleCourse(assembleInput({ design: undefined, story: undefined, brief: undefined }))
    expect(bare.pack.shells).toEqual({ enabled: ['quiz-arena'], config: {} })
    expect((bare.pack.extensions as Record<string, unknown>).story).toBeUndefined()
    expect(validateCourse(bare.pack, bare.catalogs).problems).toEqual([])
  })

  it('applies the explainer\'s feedback, the coach\'s accepted answers and the polished strings', () => {
    const { pack, catalogs, itemKeys } = assembleCourse(
      assembleInput({
        explain: { items: [{ id: 'q1', explanation: 'It ended in 476, when Odoacer removed the last emperor.', hint: 'Think of the fifth century.', didYouKnow: 'Romulus Augustulus was a boy.', didYouKnowFact: 'f2' }] },
        accepted: { answers: [{ ref: 'q3', accepted: ['476', 'the year 476', 'in 476'] }, { ref: 'q4.g1', accepted: ['Curia', 'Curia Julia'] }] },
        polish: { 'art.a-fall.title': 'How the western empire ended', 'item.nope.prompt': 'ignored' }
      })
    )
    const s = catalogs.en!.strings
    expect(s['item.q1.expl']).toBe('It ended in 476, when Odoacer removed the last emperor.')
    expect(s['item.q1.dyk']).toBe('Romulus Augustulus was a boy.')
    expect((pack.items as { id: string; extensions: Record<string, unknown> }[]).find((i) => i.id === 'q1')!.extensions).toEqual({ facts: ['f1'], didYouKnowFact: 'f2' })
    expect(catalogs.en!.accepted!['item.q3.answer']).toEqual(['476', 'the year 476', 'in 476'])
    expect(catalogs.en!.accepted!['item.q4.gap.g1']).toEqual(['Curia', 'the Curia', 'Curia Julia']) // the canonical first, nothing twice
    expect(s['art.a-fall.title']).toBe('How the western empire ended')
    expect(Object.keys(s)).not.toContain('item.nope.prompt')
    expect(validateCourse(pack, catalogs).problems).toEqual([])
    expect(itemKeys.q1).toEqual(expect.arrayContaining(['item.q1.prompt', 'item.q1.expl', 'item.q1.opt.a', 'item.q1.opt.b.why']))
    expect(itemKeys.q1).not.toContain('item.q3.prompt')
  })

  it('refuses an item whose objective is not in the curriculum', () => {
    const bad: AuthoredItem[] = [{ ...ITEMS[2]!, objective: 'u9-o9' }]
    expect(() => assembleCourse(assembleInput({ items: bad }))).toThrow(/objective "u9-o9"/)
  })

  it('a language course: the taught answers are in the target-language catalog, the rest in the source one, and it validates', () => {
    const items: AuthoredItem[] = [
      { id: 'l1', kind: 'typed', objective: 'u1-o1', prompt: 'How do you say "hello" in Croatian?', accepted: ['bok'], explanation: '"Bok" is the everyday greeting.', facts: ['f1'], taught: true },
      { id: 'l2', kind: 'mcq', objective: 'u1-o1', prompt: 'Which word means "thank you"?', options: [{ id: 'a', text: 'hvala' }, { id: 'b', text: 'molim', why: '"Molim" means "please".' }, { id: 'c', text: 'bok', why: '"Bok" means "hello".' }], answer: 'a', explanation: '"Hvala" means thank you.', facts: ['f1'], taught: true },
      { id: 'l3', kind: 'typed', objective: 'u1-o2', prompt: 'Type the English word for "hvala".', accepted: ['thank you', 'thanks'], explanation: 'Hvala is thank you.', facts: ['f3'] },
      { id: 'l4', kind: 'cloze', objective: 'u1-o2', prompt: 'Complete the greeting.', text: 'Dobar {{g1}}!', gaps: [{ id: 'g1', accepted: ['dan'], bank: ['dan', 'noc', 'jutro'] }], explanation: '"Dobar dan" is good day.', facts: ['f3'], taught: true },
      { ...ITEMS[5]!, objective: 'u2-o1' },
      { ...ITEMS[6]!, objective: 'u2-o1' },
      { ...ITEMS[7]!, objective: 'u2-o2' },
      { ...ITEMS[8]!, objective: 'u2-o2' }
    ]
    const { pack, catalogs } = assembleCourse(assembleInput({ items, targetLang: 'hr', cefr: 'A1', story: undefined }))
    expect(validateCourse(pack, catalogs).problems).toEqual([])
    expect(pack).toMatchObject({ sourceLang: 'en', languages: ['en'], targetLang: 'hr', cefr: 'A1' })
    expect(Object.keys(catalogs).sort()).toEqual(['en', 'hr'])
    expect(catalogs.hr!.accepted).toEqual({ 'item.l1.answer': ['bok'], 'item.l4.gap.g1': ['dan'] })
    expect(catalogs.hr!.strings).toMatchObject({ 'item.l2.opt.a': 'hvala', 'item.l4.text': 'Dobar {{g1}}!', 'item.l4.gap.g1': 'dan', 'item.l4.gap.g1.b1': 'noc' })
    expect(catalogs.en!.accepted).toEqual({ 'item.l3.answer': ['thank you', 'thanks'] }) // the answer is in English: not taught
    expect(catalogs.en!.strings['item.l1.prompt']).toContain('Croatian')
    expect(catalogs.en!.strings['item.l2.opt.b.why']).toContain('please')
    expect(catalogs.hr!.strings['item.l1.prompt']).toBeUndefined()
  })
})

describe('what a reviewer reads', () => {
  it('renderCourseForReview shows each text as [key] text, grouped by unit, so a problem can name the key', () => {
    const { pack, catalogs } = assembleCourse(assembleInput())
    const text = renderCourseForReview(pack as never, catalogs, 'en')
    expect(text).toContain('## Unit u1')
    expect(text).toContain('[unit.u1.title] The fall of Rome')
    expect(text).toContain('Article a-fall:')
    expect(text).toContain('[art.a-fall.body] ')
    expect(text).toContain('Item q1 (mcq):')
    expect(text).toContain('[item.q1.prompt] prompt: In which year did the Western Roman Empire end?')
    expect(text).toContain('[item.q1.opt.b.why] why: In 410')
    expect(text).toContain('## Unit u2')
    expect(text.indexOf('Item q9')).toBeGreaterThan(text.indexOf('## Unit u2'))
    expect(text).not.toContain('item.q1.opt.a.why')
  })
})

describe('the assembled course goes through the course store: import, build and lint clean', () => {
  it('writeAssembled, validate, build with the fake player bundle, lint with no error and no warning', async () => {
    const dataDir = await tmp('edu-assemble-')
    const store = new CourseStore(dataDir, { playerDir: await fakeBundle() })
    const { pack, catalogs } = assembleCourse(assembleInput())
    const written = await store.writeAssembled('roman-basics', pack, catalogs)
    expect(written.slug).toBe('roman-basics')
    expect(JSON.parse(await readFile(path.join(written.dir, 'course', 'pack.json'), 'utf8')).slug).toBe('roman-basics')
    expect((await store.validate('roman-basics')).ok).toBe(true)
    const built = await store.build('roman-basics')
    expect(built.ok).toBe(true)
    const lint = await store.lint('roman-basics')
    expect(lint.problems).toEqual([])
    expect(lint).toMatchObject({ ok: true, errors: 0, warnings: 0 })
    // the same course read back through the lint of the build folder
    expect((await lintGame(store.buildDir('roman-basics'))).ok).toBe(true)
  })

  it('writeAssembled refuses an incomplete course and writes nothing', async () => {
    const dataDir = await tmp('edu-assemble-')
    const store = new CourseStore(dataDir)
    const { pack, catalogs } = assembleCourse(assembleInput())
    delete catalogs.en!.strings['item.q1.prompt']
    await expect(store.writeAssembled('roman-basics', pack, catalogs)).rejects.toThrow(/nothing was written.*MISSING_TEXT/)
    await expect(store.get('roman-basics')).rejects.toThrow()
    await expect(store.writeAssembled('Bad Slug', pack, catalogs)).rejects.toThrow(/invalid slug/)
  })
})

describe('lint: ITEM_NO_FACT and ARTICLE_NO_CITATION for packs made by the pipeline', () => {
  interface Game {
    pack: { items: { extensions: Record<string, unknown> }[]; encyclopedia: { articles: { citations: string[] }[] }; extensions: Record<string, unknown> }
    catalogs: unknown
  }
  async function built() {
    const dataDir = await tmp('edu-assemble-')
    const store = new CourseStore(dataDir, { playerDir: await fakeBundle() })
    const { pack, catalogs } = assembleCourse(assembleInput())
    await store.writeAssembled('roman-basics', pack, catalogs)
    const r = await store.build('roman-basics')
    expect(r.ok).toBe(true)
    return JSON.parse(await readFile(path.join(store.buildDir('roman-basics'), 'game-data.json'), 'utf8')) as Game
  }
  const lint = (data: Game) => lintGameData(data as never, () => true)

  it('an item without facts, an item with an unknown fact, an article without a citation and one that cites an unknown fact are errors', async () => {
    const data = await built()
    expect(lint(data)).toEqual([])
    const broken = structuredClone(data)
    broken.pack.items[0]!.extensions = {}
    broken.pack.items[1]!.extensions = { facts: ['f1', 'f99'] }
    broken.pack.encyclopedia.articles[0]!.citations = []
    broken.pack.encyclopedia.articles[1]!.citations = ['f4', 'f98']
    const problems = lint(broken)
    expect(codes(problems.filter((p) => p.code.includes('NO_')))).toEqual(['ARTICLE_NO_CITATION', 'ITEM_NO_FACT'])
    const msgs = problems.map((p) => `${p.code} ${p.path} ${p.message}`)
    expect(msgs.some((m) => /ITEM_NO_FACT items\[0\] .*"q1" names no fact/.test(m))).toBe(true)
    expect(msgs.some((m) => /ITEM_NO_FACT items\[1\].*"q2" names the fact "f99"/.test(m))).toBe(true)
    expect(msgs.some((m) => /ARTICLE_NO_CITATION encyclopedia.articles\[0\] .*"a-fall" cites no fact/.test(m))).toBe(true)
    expect(msgs.some((m) => /ARTICLE_NO_CITATION .*"a-rome" cites the fact "f98"/.test(m))).toBe(true)
    expect(problems.filter((p) => p.code === 'ITEM_NO_FACT' || p.code === 'ARTICLE_NO_CITATION').every((p) => p.severity === 'error')).toBe(true)
  })

  it('a hand-made pack (no extensions.pipeline) is not held to it', async () => {
    const data = await built()
    delete data.pack.extensions.pipeline
    data.pack.items[0]!.extensions = {}
    data.pack.encyclopedia.articles[0]!.citations = []
    expect(lint(data).filter((p) => p.code === 'ITEM_NO_FACT' || p.code === 'ARTICLE_NO_CITATION')).toEqual([])
  })
})
