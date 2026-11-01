import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assembleCourse } from '../src/engine/edu/assemble'
import {
  acceptedSchema,
  applyDistractors,
  applyExplain,
  articlesSchema,
  askRole,
  authoredItemSchema,
  checkAccepted,
  checkArticles,
  checkCurriculum,
  checkDistractors,
  checkExplain,
  checkFrame,
  checkItems,
  checkPlan,
  checkScope,
  curriculumSchema,
  designSchema,
  distractorsSchema,
  explainSchema,
  formatProblems,
  frameSchema,
  itemsSchema,
  mergeAccepted,
  mergeRevision,
  normalizeDesign,
  planSchema,
  PROMPT_VARS,
  scopeSchema
} from '../src/engine/edu/authoring'
import type { AuthoredItem } from '../src/engine/edu/authoring'
import { validateCourse } from '../src/shared/edu'
import { parseMd } from '../src/shared/md'
import { AUTHORED_ITEM_KINDS } from '../src/shared/schemas'
import { render } from '../src/engine/pipeline/prompts'
import { languageRulesText } from '../src/shared/lang'
import { ARTICLES, CURRICULUM, DESIGN, draftItems, FACTS, FRAME, ITEMS } from './edu-authored-fixture'
import { makeEduEnv } from './edu-helpers'
import { runInJob } from './research-helpers'
import { seedDir } from './helpers'

const factIds = FACTS.map((f) => f.id)
const kinds = [...AUTHORED_ITEM_KINDS]
const objectives = CURRICULUM.objectives.map((o) => ({ id: o.id, unit: o.unit }))
const issues = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) => (r.success ? [] : r.error!.issues.map((i) => `${i.path.join('.')}: ${i.message}`))
const refs = (ps: { ref: string }[]) => ps.map((p) => p.ref)

describe('director: plan_brief', () => {
  const plan = { title: 'Roman Basics', summary: 'Learn how Rome rose and fell.', units: [{ title: 'The fall', focus: 'How it ended.' }, { title: 'The height', focus: 'The republic and the arena.' }], research: [{ question: 'When did the Western Roman Empire end?', unit: 1 }, { question: 'Who led the Roman Republic?', unit: 2 }] }

  it('plan_brief: a good plan passes; checkPlan limits', () => {
  // a good plan passes; null fields and a missing list are told apart
  {
    expect(planSchema.safeParse(plan).success).toBe(true)
    expect(issues(planSchema.safeParse({ ...plan, units: 'two' }))[0]).toMatch(/units must be a list/)
    expect(issues(planSchema.safeParse({ ...plan, research: [{ question: 'short', unit: 1 }] }))[0]).toMatch(/a research question is a full question/)
  }

  // checkPlan: the number of units, 1 to 3 questions per unit, a real unit number
  {
    const p = planSchema.parse(plan)
    expect(checkPlan(p, { units: 2 })).toEqual([])
    expect(checkPlan(p, { units: 3 }).map((x) => x.issue)).toEqual([expect.stringMatching(/2 unit\(s\), the course has exactly 3/)])
    const lone = planSchema.parse({ ...plan, research: [plan.research[0]] })
    expect(formatProblems(checkPlan(lone, { units: 2 }))).toBe('- unit 2: no research question for this unit (add 1 to 3 questions whose unit is 2)')
    const many = planSchema.parse({ ...plan, research: [...plan.research, ...Array.from({ length: 3 }, (_, i) => ({ question: `Another question number ${i}?`, unit: 1 })), { question: 'A question for no unit at all?', unit: 7 }] })
    const out = checkPlan(many, { units: 2 })
    expect(out.map((x) => x.issue)).toEqual(expect.arrayContaining([expect.stringMatching(/4 research questions, at most 3/), expect.stringMatching(/names unit 7/)]))
  }
  })
})

describe('curriculum-designer: curriculum', () => {
  it('checkCurriculum: ids unique, requires known and acyclic, every unit has an objective, every objective has existing facts', () => {
    const c = curriculumSchema.parse(CURRICULUM)
    const bad = curriculumSchema.parse({
      units: [
        { id: 'u1', title: 'One', summary: 's', requires: ['u2'] },
        { id: 'u2', title: 'Two', summary: 's', requires: ['u1', 'u9'] },
        { id: 'u2', title: 'Dup', summary: 's', requires: [] },
        { id: 'u3', title: 'Three', summary: 's', requires: [] }
      ],
      objectives: [
        { id: 'o1', unit: 'u1', bloom: 'remember', text: 't', facts: ['f1', 'f77'] },
        { id: 'o1', unit: 'u8', bloom: 'remember', text: 't', facts: ['f1'] },
        { id: 'o3', unit: 'u2', bloom: 'apply', text: 't', facts: ['f1'] }
      ]
    })
    const msgs = checkCurriculum(bad, { factIds, units: 3 }).map((p) => `${p.ref}|${p.issue}`)
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\|4 unit\(s\) given, the course has exactly 3/),
        'u2|this unit id is used twice',
        'o1|this objective id is used twice',
        expect.stringMatching(/^u2\|requires the unit "u9"/),
        expect.stringMatching(/^u3\|this unit has no objective/),
        expect.stringMatching(/^o1\|it rests on the fact "f77"/),
        expect.stringMatching(/^o1\|its unit "u8" does not exist/)
      ])
    )
    const cyc = curriculumSchema.parse({ units: [{ id: 'a', title: 'A', summary: 's', requires: ['b'] }, { id: 'b', title: 'B', summary: 's', requires: ['a'] }], objectives: [{ id: 'a-o1', unit: 'a', bloom: 'remember', text: 't', facts: ['f1'] }, { id: 'b-o1', unit: 'b', bloom: 'remember', text: 't', facts: ['f1'] }] })
    expect(formatProblems(checkCurriculum(cyc, { factIds }))).toMatch(/the prerequisites form a cycle: a -> b -> a[\s\S]*every unit has a prerequisite, so nobody can start/)
    const noStart = curriculumSchema.parse({ units: [{ id: 'a', title: 'A', summary: 's', requires: ['b'] }, { id: 'b', title: 'B', summary: 's', requires: [] }], objectives: [{ id: 'a-o1', unit: 'a', bloom: 'remember', text: 't', facts: ['f1'] }, { id: 'b-o1', unit: 'b', bloom: 'remember', text: 't', facts: ['f1'] }] })
    expect(checkCurriculum(noStart, { factIds })).toEqual([])
    expect(checkCurriculum(c, { factIds: ['f1'] }).every((p) => /not in the fact base/.test(p.issue))).toBe(true)
  })
})

describe('curriculum-designer: objectives the facts cannot support (EGS-22)', () => {
  const factTexts = Object.fromEntries(FACTS.map((f) => [f.id, f.fact]))
  const one = (text: string, facts: string[]) => curriculumSchema.parse({ units: [{ id: 'u1', title: 'U', summary: 's', requires: [] }], objectives: [{ id: 'o1', unit: 'u1', bloom: 'remember', text, facts }] })

  it('"name its causes" on facts that state no cause is flagged, with the facts it rests on', () => {
    const msgs = checkCurriculum(one('Name the causes of the fall of Rome.', ['f3']), { factIds, factTexts }).map((p) => p.issue)
    expect(msgs).toEqual(['it asks for causes or reasons, but the facts it rests on (f3) state none'])
    // a fact that says it (here: "led to") makes the same objective fine
    const withCause = { ...factTexts, f3: 'Weak emperors led to the fall of the Senate.' }
    expect(checkCurriculum(one('Name the causes of the fall of Rome.', ['f3']), { factIds, factTexts: withCause })).toEqual([])
  })

})

describe('language-coach: scope and accepted', () => {
  it('scope covers every unit; accepted answers merge with the canonical first and ignore repeats', () => {
    const scope = scopeSchema.parse({ units: [{ unit: 'u1', vocabulary: [{ term: 'bok', gloss: 'hello' }], grammar: [] }] })
    expect(checkScope(scope, ['u1', 'u2']).map((p) => p.ref)).toEqual(['u2'])
    expect(checkScope(scope, ['u1'])).toEqual([])
    expect(checkScope(scope, ['u9']).map((p) => p.ref).sort()).toEqual(['u1', 'u9'])
    const out = acceptedSchema.parse({ answers: [{ ref: 'q3', accepted: ['the year 476', '476', 'in 476', 'THE YEAR 476'] }, { ref: 'q4.g1', accepted: ['curia julia'] }, { ref: 'nope', accepted: ['x'] }, { ref: 'q1', accepted: ['y'] }] })
    expect(refs(checkAccepted(ITEMS, out)).sort()).toEqual(['nope', 'q1'])
    const merged = mergeAccepted(ITEMS, out)
    expect((merged.find((i) => i.id === 'q3') as { accepted: string[] }).accepted).toEqual(['476', 'the year 476', 'in 476'])
    expect((merged.find((i) => i.id === 'q4') as { gaps: { accepted: string[] }[] }).gaps[0]!.accepted).toEqual(['Curia', 'the Curia', 'curia julia'])
    // a wrong word of the bank may not become a second answer
    const bad = acceptedSchema.parse({ answers: [{ ref: 'q4.g1', accepted: ['Forum'] }] })
    expect(checkAccepted(ITEMS, bad)[0]!.issue).toMatch(/wrong word of the gap's bank/)
  })
})

describe('item-writer: items', () => {
  const bad = (over: Record<string, unknown>, base = ITEMS[0]!) => issues(authoredItemSchema.safeParse({ ...base, ...over }))

  it('item-writer: schemas reject wrong shapes, checkItems, mergeRevision', () => {
  // each kind\'s schema rejects a wrong shape with a readable message
  {
    expect(bad({ kind: 'riddle' })[0]).toMatch(/every item needs a kind: mcq, true-false/)
    expect(bad({ answer: 'z' })[0]).toBe('answer: answer "z" is not one of the option ids (a, b, c, d)')
    expect(bad({ options: [{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }] })[0]).toMatch(/the option id "a" is used twice/)
    expect(bad({ facts: [] })[0]).toMatch(/every item must name at least one fact id it rests on/)
    expect(bad({ id: 'q 1' })[0]).toMatch(/an id may only have letters, digits/)
    expect(bad({ prompt: '  ' })[0]).toMatch(/the prompt must not be empty/)
    expect(bad({ difficulty: 9 })[0]).toMatch(/difficulty/)
    const tf = ITEMS[1]!
    expect(bad({ answer: 'true' }, tf)[0]).toMatch(/answer is true or false/)
    const ms = ITEMS[8]!
    expect(bad({ answers: ['a', 'b', 'c'] }, ms)[0]).toMatch(/every option is right/)
    expect(bad({ answers: ['x'] }, ms)[0]).toMatch(/answer "x" is not one of the option ids/)
    const cloze = ITEMS[3]!
    expect(bad({ text: 'No marker here.' }, cloze)[0]).toMatch(/the text has no \{\{g1\}\} marker/)
    expect(bad({ text: 'A {{g1}} and {{g2}}.' }, cloze)[0]).toMatch(/the marker \{\{g2\}\} in the text has no gap/)
    expect(bad({ gaps: [{ id: 'g1', accepted: [] }] }, cloze)[0]).toMatch(/a gap needs its answer in accepted/)
    expect(bad({ accepted: [] }, ITEMS[2]!)[0]).toMatch(/give the accepted answers/)
    const sort = ITEMS[7]!
    expect(bad({ items: [{ id: 'e1', text: 'a', group: 'g1' }, { id: 'e2', text: 'b', group: 'g9' }] }, sort)[0]).toMatch(/names the group "g9"/)
    expect(bad({ items: [{ id: 'e1', text: 'a', group: 'g1' }, { id: 'e2', text: 'b', group: 'g1' }] }, sort)[0]).toMatch(/the group "g2" has no entry/)
    expect(bad({ pairs: [{ id: 'p1', left: 'a', right: 'b' }] }, ITEMS[5]!)[0]).toMatch(/at least 2 pairs/)
    expect(bad({ items: [{ id: 's1', text: 'a' }] }, ITEMS[6]!)[0]).toMatch(/at least 2 items/)
    expect(bad({ back: '' }, ITEMS[4]!)[0]).toMatch(/the back of the card must not be empty/)
  }

  // checkItems: ids, objective, unit, facts, kind, forms per objective, duplicate and key-like options, the why of a wrong option
  {
    const ok = itemsSchema.parse({ items: ITEMS }).items
    const check = (items: AuthoredItem[], o: Partial<Parameters<typeof checkItems>[1]> = {}) => formatProblems(checkItems(items, { objectives, factIds, allowedKinds: kinds, ...o }))
    expect(check([ITEMS[0]!, ITEMS[0]!])).toMatch(/q1: this item id is used twice/)
    expect(check([ITEMS[0]!], { existingIds: ['q1'], unit: 'u1' })).toMatch(/already used by another item/)
    expect(check([{ ...ITEMS[0]!, objective: 'u9-o1' }])).toMatch(/its objective "u9-o1" does not exist \(use one of: u1-o1/)
    expect(check([{ ...ITEMS[0]!, objective: 'u2-o1' }], { unit: 'u1' })).toMatch(/belongs to the unit "u2", these items are for "u1" \(use an objective of u1: u1-o1, u1-o2\)/)
    expect(check([{ ...ITEMS[0]!, facts: ['f1', 'f77'] }])).toMatch(/names the fact f77, which is not in the fact base/)
    expect(check([ITEMS[0]!], { allowedKinds: ['typed'] })).toMatch(/the kind "mcq" is not allowed for this course \(use one of: typed\)/)
    // forms per objective: only one kind, too few items, none
    const unit1 = ok.filter((i) => i.objective.startsWith('u1'))
    expect(check(unit1.filter((i) => i.objective !== 'u1-o1' || i.kind === 'mcq'), { unit: 'u1' })).toMatch(/u1-o1: only 1 item\(s\) for this objective, the course wants 2/)
    const twoSame: AuthoredItem[] = [ITEMS[2]!, { ...ITEMS[2]!, id: 'q3b' }]
    expect(check([...twoSame, ...unit1.filter((i) => i.objective === 'u1-o2')], { unit: 'u1' })).toMatch(/u1-o1: every item for this objective is "Type the answer": it needs at least two different kinds/)
    expect(check(unit1.filter((i) => i.objective === 'u1-o1'), { unit: 'u1' })).toMatch(/u1-o2: this objective has no item/)
    expect(check(unit1, { unit: 'u1', itemsPerObjective: 3 })).toMatch(/only 2 item\(s\)/)
    // options
    const mcq = ITEMS[0] as Extract<AuthoredItem, { kind: 'mcq' }>
    const dupOptions: AuthoredItem = { ...mcq, options: [{ id: 'a', text: '476' }, { id: 'b', text: ' 476 ' }, { id: 'c', text: 'x' }] }
    expect(check([dupOptions])).toMatch(/the options "a" and "b" read the same/)
    const fewWrong: AuthoredItem = { ...mcq, options: [{ id: 'a', text: '476' }, { id: 'b', text: '410' }] }
    expect(check([fewWrong])).toMatch(/an mcq needs at least 2 wrong options/)
    expect(check(draftItems([ITEMS[0]!]), { requireWhy: true })).toMatch(/the wrong option "b" has no why/)
    const bankDup: AuthoredItem = { ...ITEMS[3]!, gaps: [{ id: 'g1', accepted: ['Curia', 'the Curia'], bank: ['Curia', 'the curia', 'Forum'] }] } as AuthoredItem
    expect(check([bankDup])).toMatch(/the bank word "the curia" of gap "g1" is also an accepted answer/)
  }

  // mergeRevision: only the flagged items change, a flagged item that is not returned is a problem, the order stays
  {
    const revised = [{ ...ITEMS[0]!, prompt: 'Changed prompt?' }, { ...ITEMS[1]!, prompt: 'Not flagged, ignored.' }] as AuthoredItem[]
    const r = mergeRevision(ITEMS.slice(0, 3), revised, ['q1', 'q3'])
    expect(r.merged.map((i) => [i.id, i.prompt.slice(0, 10)])).toEqual([['q1', 'Changed pr'], ['q2', 'Odoacer re'], ['q3', 'Type the y']])
    expect(r.replaced).toEqual(['q1'])
    expect(formatProblems(r.problems)).toBe('- q3: it was flagged but not returned (return the corrected version of every flagged entry)')
  }
  })
})

describe('misconception-designer: distractors', () => {
  const draft = draftItems()
  const ok = distractorsSchema.parse({
    items: [
      { id: 'q1', options: [{ id: 'a', text: '476' }, { id: 'b', text: '410', why: 'The sack of Rome, not the end.' }, { id: 'd1', text: '395', why: 'The empire split in 395.' }] },
      { id: 'q2', why: 'Learners think one battle ended it.' },
      { id: 'q9', options: [{ id: 'a', text: 'Augustus became emperor' }, { id: 'b', text: 'The Republic had two consuls' }, { id: 'c', text: 'The western empire ended', why: 'It ended in 476.' }] }
    ]
  })

  it('a complete answer passes and is applied: right options unchanged, new wrong ones with their why, the true-false why', () => {
    expect(checkDistractors(draft, ok)).toEqual([])
    const applied = applyDistractors(draft, ok)
    const q1 = applied.find((i) => i.id === 'q1') as Extract<AuthoredItem, { kind: 'mcq' }>
    expect(q1.options).toEqual([{ id: 'a', text: '476' }, { id: 'b', text: '410', why: 'The sack of Rome, not the end.' }, { id: 'd1', text: '395', why: 'The empire split in 395.' }])
    expect((applied.find((i) => i.id === 'q2') as { why: string }).why).toBe('Learners think one battle ended it.')
    expect(applied.find((i) => i.id === 'q3')).toEqual(draft.find((i) => i.id === 'q3')) // an item not mentioned is unchanged
    expect(checkItems(applied.filter((i) => ['q1', 'q2', 'q9'].includes(i.id)), { objectives, factIds, allowedKinds: kinds, requireWhy: true }).filter((p) => !/objective/.test(p.issue))).toEqual([])
  })

  const check = (items: unknown[]) => formatProblems(checkDistractors(draft, distractorsSchema.parse({ items })))
  const q1 = (options: unknown[]) => [{ id: 'q1', options }, ok.items[2], ok.items[1]]

  it('every rule has a message: right option changed or missing, too few wrong ones, no why, repeats, wrong kind, not covered', () => {
    expect(check(q1([{ id: 'a', text: '475' }, { id: 'b', text: '410', why: 'x' }, { id: 'c', text: '395', why: 'y' }]))).toMatch(/the right option "a" was changed from "476" to "475"/)
    expect(check(q1([{ id: 'b', text: '410', why: 'x' }, { id: 'c', text: '395', why: 'y' }]))).toMatch(/the right option "a" is missing/)
    expect(check(q1([{ id: 'a', text: '476' }, { id: 'b', text: '410', why: 'x' }]))).toMatch(/1 wrong option\(s\): an mcq needs at least 2/)
    expect(check(q1([{ id: 'a', text: '476' }, { id: 'b', text: '410' }, { id: 'c', text: '395', why: 'y' }]))).toMatch(/the wrong option "b" has no why/)
    expect(check(q1([{ id: 'a', text: '476' }, { id: 'b', text: '410', why: 'x' }, { id: 'b', text: '395', why: 'y' }]))).toMatch(/the option id "b" is used twice/)
    expect(check(q1([{ id: 'a', text: '476' }, { id: 'b', text: '410', why: 'x' }, { id: 'c', text: '410.', why: 'y' }]))).toMatch(/the options "b" and "c" read the same/)
    expect(check([ok.items[0], ok.items[2], { id: 'q3', options: [{ id: 'a', text: '1', why: 'x' }] }, { id: 'zz', why: 'x' }])).toMatch(/q3: a typed item has no distractors to write[\s\S]*zz: no such item/)
    expect(check([{ id: 'q1', options: ok.items[0]!.options }])).toMatch(/q2: ?.*|q9: this item was not covered/)
    expect(check([ok.items[0], ok.items[2], { id: 'q2', options: [{ id: 'a', text: 'x' }] }])).toMatch(/a true-false item has no options[\s\S]*a true-false item needs its why/)
    expect(check([ok.items[0]])).toMatch(/q9: this item was not covered \(return its full option list/)
  })
})

describe('explainer: explain and polish', () => {
  const out = explainSchema.parse({ items: ITEMS.map((i) => ({ id: i.id, explanation: `Explained ${i.id}.` })) })

  it('every item is covered; a hook needs its fact; the explanation, hint and hook replace the writer\'s', () => {
    expect(checkExplain(ITEMS, out, factIds)).toEqual([])
    const withHook = explainSchema.parse({ items: [...out.items.slice(1), { id: 'q1', explanation: 'It ended in 476.', hint: 'Fifth century.', didYouKnow: 'A boy was the last emperor.', didYouKnowFact: 'f2' }] })
    expect(checkExplain(ITEMS, withHook, factIds)).toEqual([])
    const applied = applyExplain(ITEMS, withHook)
    expect(applied.find((i) => i.id === 'q1')).toMatchObject({ explanation: 'It ended in 476.', hint: 'Fifth century.', didYouKnow: 'A boy was the last emperor.', didYouKnowFact: 'f2' })
    const msg = (items: unknown[]) => formatProblems(checkExplain(ITEMS, explainSchema.parse({ items }), factIds))
    expect(msg([{ id: 'q1', explanation: 'x', didYouKnow: 'A hook.' }])).toMatch(/q1: a didYouKnow must name the fact it rests on/)
    expect(msg([{ id: 'q1', explanation: 'x', didYouKnow: 'A hook.', didYouKnowFact: 'f99' }])).toMatch(/didYouKnowFact "f99" is not in the fact base/)
    expect(msg([{ id: 'q1', explanation: 'x', didYouKnowFact: 'f1' }])).toMatch(/didYouKnowFact without didYouKnow/)
    expect(msg([{ id: 'zz', explanation: 'x' }, { id: 'zz', explanation: 'y' }])).toMatch(/zz: no such item[\s\S]*zz: this item is returned twice[\s\S]*q1: this item was not covered/)
  })

})

describe('game-designer, narrative-designer, playtester, publisher', () => {
  it('the design is clamped to the player\'s limits; known shells are kept, others recorded; unknown items dropped', () => {
    const d = designSchema.parse({ shells: ['detective', 'rpg', 'quiz-arena', 'mindmaze', 'warp'], quizArena: { roundLength: 40, bossLength: 1, timerSeconds: 500 }, difficulty: [{ item: 'q1', difficulty: 9 }, { item: 'qx', difficulty: 2 }, { item: 'q2', difficulty: 0 }] })
    expect(normalizeDesign(d, ['q1', 'q2'])).toEqual({ enabled: ['quiz-arena', 'rpg', 'mindmaze'], requested: ['detective', 'warp'], quizArena: { roundLength: 12, bossLength: 4, timerSeconds: 120 }, difficulty: { q1: 5, q2: 1 }, notes: '' })
    const e = normalizeDesign(designSchema.parse({ shells: ['quiz-arena'], quizArena: { roundLength: 7, bossLength: 10 }, notes: ' ok ' }), [])
    expect(e).toEqual({ enabled: ['quiz-arena'], requested: [], quizArena: { roundLength: 7, bossLength: 10 }, difficulty: {}, notes: 'ok' })
    expect(normalizeDesign(designSchema.parse({ shells: ['detective'], quizArena: { roundLength: 7, bossLength: 10 } }), []).enabled).toEqual(['quiz-arena']) // the quiz arena is always on
    expect(DESIGN.enabled).toEqual(['quiz-arena', 'rpg'])
  })

})

describe('askRole: the repair round for what a schema or a check finds', () => {
  const planObj = { title: 'T', summary: 'S', units: [{ title: 'U', focus: 'F' }], research: [{ question: 'When did it happen?', unit: 1 }] }

  async function ask(env: Awaited<ReturnType<typeof makeEduEnv>>, check?: Parameters<typeof askRole<ReturnType<typeof planSchema.parse>>>[1]['check']) {
    return runInJob(env, 'director', (ctx) => askRole(ctx, { dataDir: env.dir, role: 'director', task: 'plan_brief', vars: { topic: 'Rome', audience: 'Teens', age: '14', level: 'beginner', language: 'English', units: 1, questions_per_unit: 3, format_label: 'Quick course', notes: 'none' }, schema: planSchema, check }))
  }

  it('askRole: a check problem is repaired once; one that stays fails the job with the problems listed', async () => {
  // a check problem is sent back with its words, and the corrected answer is used
  {
    const env = await makeEduEnv()
    try {
      let calls = 0
      let last = ''
      env.mock.on({ role: 'director' }, (req) => {
        calls++
        last = req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
        return JSON.stringify(calls === 1 ? { ...planObj, units: [{ title: 'U', focus: 'F' }, { title: 'V', focus: 'G' }] } : planObj)
      })
      const r = await ask(env, (p) => checkPlan(p, { units: 1 }))
      expect(calls).toBe(2)
      expect(last).toContain('Your answer has problems:')
      expect(last).toContain('the plan has 2 unit(s), the course has exactly 1 (give exactly 1 units)')
      expect(r.value.units).toHaveLength(1)
      expect(r.problems).toHaveLength(2) // the problems of the first answer (the plan, and unit 2 has no question)
      // the prompt came from the seeded template
      expect(last).toContain('Topic: Rome')
    } finally {
      await env.cleanup()
    }
  }

  // a problem that is still there after the repair round fails the job with the problems listed; a good answer costs one call
  {
    const env = await makeEduEnv()
    try {
      let calls = 0
      env.mock.on({ role: 'director' }, () => (calls++, JSON.stringify({ ...planObj, units: [{ title: 'U', focus: 'F' }, { title: 'V', focus: 'G' }] })))
      await expect(ask(env, (p) => checkPlan(p, { units: 1 }))).rejects.toThrow(/still has problems after a repair round:\n- the plan has 2 unit\(s\)/)
      expect(calls).toBe(2)
      calls = 0
      env.mock.on({ role: 'director' }, () => (calls++, JSON.stringify(planObj)))
      expect((await ask(env, (p) => checkPlan(p, { units: 1 }))).problems).toEqual([])
      expect(calls).toBe(1)
      // a schema problem is repaired by chatJson, with the schema's message
      calls = 0
      let seen = ''
      env.mock.on({ role: 'director' }, (req) => {
        calls++
        seen = req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
        return JSON.stringify(calls === 1 ? { ...planObj, units: 'two' } : planObj)
      })
      await ask(env)
      expect(seen).toContain('units: units must be a list of {title, focus}')
    } finally {
      await env.cleanup()
    }
  }
  })
})

describe('the seeded prompts and agents of the content team', () => {
  const promptFile = (key: string) => path.join(seedDir, 'prompts', ...key.split('/')) + '.md'

  it('the seeded prompts: variables, JSON shape, the German rules for de only and the conjugation example', () => {
  // every prompt exists, uses exactly the variables its handler passes, and ends with the JSON shape
  {
    for (const [key, vars] of Object.entries(PROMPT_VARS)) {
      expect(fs.existsSync(promptFile(key)), key).toBe(true)
      const doc = parseMd(fs.readFileSync(promptFile(key), 'utf8'))
      expect(doc.data, key).toMatchObject({ kind: 'prompt', role: key.split('/')[0], task: key.split('/')[1] })
      const used = new Set([...doc.body.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]!))
      expect([...used].sort(), key).toEqual([...vars].sort())
      const out = render(doc.body, Object.fromEntries(vars.map((v) => [v, `<${v}>`])))
      expect(out, key).not.toMatch(/\{\{/)
      const lines = out.trim().split('\n')
      expect(lines[lines.length - 1], `${key}: the last line is the JSON shape`).toMatch(/^\{"/)
      expect(out, key).toMatch(/Reply with one JSON object/)
    }
  }

  // EGS-30: the writer prompts carry the German rules (and the item-writer the conjugation shape) for de only
  {
    const roleKeys = ['item-writer/items', 'item-writer/items_revise', 'language-coach/scope', 'language-coach/accepted', 'misconception-designer/distractors', 'explainer/explain', 'fact-checker/fact_check']
    for (const key of roleKeys) {
      const body = parseMd(fs.readFileSync(promptFile(key), 'utf8')).body
      const base = Object.fromEntries([...body.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => [m[1]!, `<${m[1]}>`]))
      const writer = key.startsWith('item-writer')
      const de = render(body, { ...base, language_rules: languageRulesText('de', writer) })
      expect(de, key).toContain('German rules (the taught language is German)')
      expect(de, key).toContain('CONJ_FORM_MISMATCH')
      expect(de.includes('The conjugation kind'), key).toBe(writer)
      if (writer) expect(de, key).toContain('"kind": "conjugation"')
      for (const lang of ['hr', 'en', undefined]) {
        const other = render(body, { ...base, language_rules: languageRulesText(lang, writer) })
        expect(other, `${key} ${lang}`).not.toContain('German rules')
        expect(other, `${key} ${lang}`).not.toContain('conjugation')
      }
    }
  }

  // EGS-30: the conjugation example of the rules is a valid authored item
  {
    const shape = languageRulesText('de', true).split('- Example: ')[1]!
    const parsed = authoredItemSchema.safeParse(JSON.parse(shape))
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  }
  })

})

describe('the whole chain on the mock model: roles answer, the answers are checked and applied, the course assembles and validates', () => {
  it('curriculum, articles, items, distractors, explain, design, frame -> assemble', async () => {
    const env = await makeEduEnv()
    try {
      const answers: Record<string, unknown> = {
        'curriculum-designer': CURRICULUM,
        'subject-expert': { articles: ARTICLES.slice(0, 1) },
        'item-writer': { items: draftItems(ITEMS.slice(0, 5)) },
        'misconception-designer': { items: [{ id: 'q1', options: ITEMS[0]!.kind === 'mcq' ? ITEMS[0]!.options : [] }, { id: 'q2', why: 'Learners think one battle ended it.' }] },
        explainer: { items: ITEMS.slice(0, 5).map((i) => ({ id: i.id, explanation: i.explanation })) },
        'game-designer': { shells: ['quiz-arena', 'rpg'], quizArena: { roundLength: 5, bossLength: 6 }, difficulty: [{ item: 'q1', difficulty: 2 }], notes: 'n' },
        'narrative-designer': FRAME
      }
      for (const [role, a] of Object.entries(answers)) env.mock.on({ role }, () => JSON.stringify(a))
      const base = { title: 'Roman Basics', audience: 'Teens', age: '14', level: 'beginner', language: 'English', unit_id: 'u1' }
      const vars = (extra: Record<string, string | number>) => ({ ...base, ...extra })
      const run = <T>(role: string, task: string, schema: Parameters<typeof askRole<T>>[1]['schema'], v: Record<string, string | number>, check?: (x: T) => ReturnType<typeof checkPlan>) => runInJob(env, role, (ctx) => askRole<T>(ctx, { dataDir: env.dir, role, task, vars: vars(v), schema, check }))

      const cur = (await run('curriculum-designer', 'curriculum', curriculumSchema, { summary: 's', units: 2, objectives_per_unit: 2, unit_plan: '1. a', factbase: '[f1] x', notes: '' }, (c: ReturnType<typeof curriculumSchema.parse>) => checkCurriculum(c, { factIds, units: 2 }))).value
      const arts = (await run('subject-expert', 'articles', articlesSchema, { unit_title: 'The fall', unit_summary: 's', objectives: 'o', factbase: '[f1] x', articles_per_unit: 1, article_id_prefix: 'a-', other_articles: '(none)', scope: '' }, (a: ReturnType<typeof articlesSchema.parse>) => checkArticles(a, { factIds, unitIds: ['u1', 'u2'], unit: 'u1', count: 1, otherArticleIds: ['a-rome'] }))).value
      const drafted = (await run('item-writer', 'items', itemsSchema, { unit_title: 'The fall', objectives: 'o', factbase: '[f1] x', articles: 'a', item_kinds: 'all', items_per_objective: 2, item_id_prefix: 'q', scope: '', target_language: '', gap_marker: '{{g1}}' }, (i: ReturnType<typeof itemsSchema.parse>) => checkItems(i.items, { objectives, factIds, allowedKinds: kinds, unit: 'u1' }))).value
      expect(drafted.items).toHaveLength(5)
      const dist = (await run('misconception-designer', 'distractors', distractorsSchema, { factbase: 'f', items: '[]' })).value
      const withWhy = applyDistractors(drafted.items, dist)
      const explain = (await run('explainer', 'explain', explainSchema, { factbase: 'f', items: '[]' })).value
      const design = (await run('game-designer', 'design', designSchema, { units: 'u', item_summary: 'i', shells_available: 'quiz-arena', notes: '' })).value
      const frame = (await run('narrative-designer', 'frame', frameSchema, { topic: 'Rome', units: 'u', notes: '' }, (f: ReturnType<typeof frameSchema.parse>) => checkFrame(f, ['u1', 'u2']))).value

      // unit 2's items and article are the fixture's (the chain above ran unit 1)
      const items = [...withWhy, ...ITEMS.slice(5)]
      const { pack, catalogs } = assembleCourse({
        slug: 'roman-basics', title: 'Roman Basics', subject: 'Rome', audience: 'Teens', sourceLang: 'en', run: 1,
        factbase: (await import('./edu-authored-fixture')).FACT_PACK,
        curriculum: cur, articles: [...arts.articles, ARTICLES[1]!], items, explain, design: normalizeDesign(design, items.map((i) => i.id)), story: frame
      })
      expect(validateCourse(pack, catalogs).problems).toEqual([])
      expect((pack.shells as { enabled: string[] }).enabled).toEqual(['quiz-arena', 'rpg']) // the mock designer asks for the rpg: it plays from its automatic layout
      expect((pack.shells as { config: Record<string, unknown> }).config.rpg).toEqual({ story: { intro: ['story.intro'], outro: ['story.outro'] } }) // the frame story, from the narrative-designer
      expect((pack.extensions as { pipeline: object }).pipeline).not.toHaveProperty('requestedShells')
    } finally {
      await env.cleanup()
    }
  })
})
