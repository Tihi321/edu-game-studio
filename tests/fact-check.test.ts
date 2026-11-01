import { describe, expect, it } from 'vitest'
import { factCheck, factCheckRefs } from '../src/engine/edu/fact-check'
import type { FactCheckUnit } from '../src/engine/edu/fact-check'
import type { Fact, SourceEntry } from '../src/engine/edu/factbase'
import { contentText } from '../src/engine/models/types'
import { makeEduEnv } from './edu-helpers'
import { runInJob } from './research-helpers'

const facts: Fact[] = [
  { id: 'f1', fact: 'The Western Roman Empire ended in 476.', sources: [1], note: 'n1' },
  { id: 'f2', fact: 'Odoacer deposed Romulus Augustulus.', sources: [1, 2], note: 'n1' }
]
const sources: SourceEntry[] = [
  { n: 1, url: 'https://example.org/476', title: 'End of Rome', retrieved: '2026-10-20' },
  { n: 2, url: 'https://example.org/odoacer', title: '', retrieved: '2026-10-20' }
]
const good: FactCheckUnit = {
  articles: [{ id: 'art-fall', title: 'The fall of Rome', body: 'The western empire ended in 476 [f1]. Odoacer removed the last emperor [f2].' }],
  items: [
    { id: 'q-year', kind: 'mcq', facts: ['f1'], text: 'Q: When did the Western Roman Empire end?\n- 476 (right)\n- 1453\nExplanation: the empire ended in 476.' },
    { id: 'q-who', kind: 'true-false', facts: ['f2'], text: 'Q: Odoacer deposed the last western emperor. True.' }
  ]
}

describe('factCheckRefs: the checks that need no model', () => {

  it('an item with no fact, an unknown fact, an article with no citation or an unknown one: a problem with the ref of each', () => {
    const bad: FactCheckUnit = {
      articles: [
        { id: 'a-none', body: 'Rome was big.' },
        { id: 'a-ghost', body: 'Rome fell [f1][f9].' },
        { id: 'a-ok', body: 'Rome fell [f1, f2].' }
      ],
      items: [
        { id: 'q-none', facts: [], text: 'x' },
        { id: 'q-ghost', facts: ['f1', 'f7'], text: 'x' },
        { id: 'q-ok', facts: ['f2'], text: 'x' }
      ]
    }
    const problems = factCheckRefs(['f1', 'f2'], bad)
    expect(problems.map((p) => [p.ref, p.issue.replace(/ \(.*/, '')])).toEqual([
      ['q-none', 'the item names no fact it rests on'],
      ['q-ghost', 'the item names the fact f7, which is not in the fact base'],
      ['a-none', 'the article cites no fact'],
      ['a-ghost', 'the article cites the fact f9, which is not in the fact base']
    ])
    expect(problems.every((p) => p.severity === 'major' && !!p.fix)).toBe(true)
  })
})

describe('factCheck: the fact-checker review of a unit', () => {
  it('asks the fact-checker with the fact base, the sources and the unit text, and returns its review', async () => {
    const env = await makeEduEnv()
    try {
      let prompt = ''
      env.mock.on({ role: 'fact-checker' }, (req) => {
        prompt = req.messages.map((m) => contentText(m.content)).join('\n')
        return JSON.stringify({ verdict: 'pass', scores: { accuracy: 9 }, notes: 'Everything rests on a fact.', problems: [] })
      })
      const review = await runInJob(env, 'fact-checker', (ctx) => factCheck(ctx, { dataDir: env.dir, title: 'Rome', round: 1, facts, sources, unit: good }))
      expect(review).toEqual({ role: 'fact-checker', verdict: 'pass', scores: { accuracy: 9 }, notes: 'Everything rests on a fact.', problems: [] })
      expect(prompt).toContain('Course: "Rome". This is review round 1.')
      expect(prompt).toContain('[f1] The Western Roman Empire ended in 476. (sources [1])')
      expect(prompt).toContain('[f2] Odoacer deposed Romulus Augustulus. (sources [1][2])')
      expect(prompt).toContain('[1] End of Rome. https://example.org/476')
      expect(prompt).toContain('### Article art-fall: The fall of Rome')
      expect(prompt).toContain('### Item q-year (mcq)')
      expect(prompt).toContain('(no problems found by the script)')
      expect(prompt).toContain('"scores": {"accuracy": 8}')
      expect(prompt).toMatch(/a wrong answer key/)
    } finally {
      await env.cleanup()
    }
  })

  it('the model\'s problems come back by ref; a model that says pass cannot override the reference check, which forces revise', async () => {
    const env = await makeEduEnv()
    try {
      const bad: FactCheckUnit = { articles: good.articles, items: [{ id: 'q-ghost', facts: ['f9'], text: 'Q: something' }, ...good.items] }
      let prompt = ''
      env.mock.on({ role: 'fact-checker' }, (req) => {
        prompt = req.messages.map((m) => contentText(m.content)).join('\n')
        return JSON.stringify({ verdict: 'pass', scores: { accuracy: 9 }, notes: 'Looks fine to me.', problems: [] })
      })
      const review = await runInJob(env, 'fact-checker', (ctx) => factCheck(ctx, { dataDir: env.dir, title: 'Rome', round: 2, facts, sources, unit: bad }))
      expect(prompt).toContain('- q-ghost: the item names the fact f9, which is not in the fact base') // the checker is told what the script found
      expect(review.verdict).toBe('revise')
      expect(review.scores).toEqual({ accuracy: 9 })
      expect(review.notes).toMatch(/^1 reference problem\(s\) found by the script\. Looks fine to me\./)
      expect(review.problems).toEqual([expect.objectContaining({ ref: 'q-ghost', severity: 'major' })])

      // the model's own findings follow the script's, without a repeat of the same one
      env.mock.on({ role: 'fact-checker' }, () =>
        JSON.stringify({
          verdict: 'revise',
          scores: { accuracy: 4 },
          notes: 'Two problems.',
          problems: [
            { ref: 'q-year', issue: 'the answer key 1453 is wrong: the fact says 476', fix: 'make 476 the answer', severity: 'major' },
            { ref: 'q-ghost', issue: 'the item names the fact f9, which is not in the fact base', fix: 'use f1' }
          ]
        })
      )
      const second = await runInJob(env, 'fact-checker', (ctx) => factCheck(ctx, { dataDir: env.dir, title: 'Rome', round: 2, facts, sources, unit: bad }))
      expect(second.verdict).toBe('revise')
      expect(second.problems.map((p) => p.ref)).toEqual(['q-ghost', 'q-year']) // the script's problem first, then the model's other one: the same finding twice is kept once
    } finally {
      await env.cleanup()
    }
  })
})
