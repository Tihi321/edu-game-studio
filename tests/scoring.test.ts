import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { jsonSchemaOf } from '../src/engine/pipeline/llm'
import { contentText } from '../src/engine/models/types'
import { countsAsRevise, decide, dimensionsFor, normalizeReviewJson, notesProblem, reviewSchema, reviewSchemaFor, reviewsThatRevise, runReview, scoresExample, weightedScore } from '../src/engine/review/scoring'
import type { ReviewResult } from '../src/engine/review/scoring'
import { qualitySchema } from '../src/shared/schemas'
import { makeEduEnv } from './edu-helpers'
import { runInJob } from './research-helpers'

const r = (role: string, verdict: 'pass' | 'revise', scores: Record<string, number>, notes = 'n'): ReviewResult => ({ role, verdict, scores, notes, problems: [] })
const quality = (o: Record<string, unknown> = {}) => qualitySchema.parse({ kind: 'quality', ...o })

describe('the review contract', () => {
  it('the seeded quality defaults and every reviewer role has its dimensions', () => {
  // the seeded quality defaults: threshold 7, two rounds, must-pass fact-checker and the audience reviewers
  {
    expect(quality()).toMatchObject({ threshold: 7, max_rounds: 2, revise_below: 7, must_pass: ['fact-checker', 'accessibility-reviewer', 'child-safety-reviewer'], weights: {} })
  }

  // every reviewer role has its dimensions; the misconception-designer is not a reviewer
  {
    expect(dimensionsFor('fact-checker')).toEqual(['accuracy'])
    expect(dimensionsFor('accessibility-reviewer')).toEqual(['accessibility', 'readability'])
    expect(dimensionsFor('child-safety-reviewer')).toEqual(['age_fit'])
    expect(dimensionsFor('playtester')).toEqual(['flow', 'difficulty'])
    expect(dimensionsFor('misconception-designer')).toEqual(['quality'])
    expect(scoresExample('accessibility-reviewer')).toBe('{"accessibility": 8, "readability": 8}')
  }
  })

  it('reviewSchema takes what models write; a reviewer role requires its own dimensions', () => {
  // reviewSchema takes what models write: any case, scores as text or out of range, findings as lines or objects, missing fields
  {
    const out = reviewSchema.parse({
      verdict: ' REVISE ',
      scores: { 'Age Fit': '6', accuracy: 11, bad: 'x', low: 0 },
      problems: ['Item q1 has a wrong key.', { id: 'q2', problem: 'two answers are true', suggestion: 'drop one', severity: 'MAJOR' }, { article: 'a1', description: 'no citation' }, '  ', 7, { nothing: true }]
    })
    expect(out).toEqual({
      verdict: 'revise',
      scores: { age_fit: 6, accuracy: 10, low: 1 },
      notes: '',
      problems: [{ ref: '', issue: 'Item q1 has a wrong key.' }, { ref: 'q2', issue: 'two answers are true', fix: 'drop one', severity: 'major' }, { ref: 'a1', issue: 'no citation' }]
    })
    expect(reviewSchema.parse({ verdict: 'pass' })).toEqual({ verdict: 'pass', scores: {}, notes: '', problems: [] })
    expect(reviewSchema.safeParse({ verdict: 'maybe' }).success).toBe(false)
    expect(reviewSchema.safeParse('text').success).toBe(false)
    expect(normalizeReviewJson('text')).toBe('text')
  }

  // a reviewer role\'s schema requires its own dimensions, and it has a JSON schema for the provider
  {
    const s = reviewSchemaFor('accessibility-reviewer')
    expect(s.safeParse({ verdict: 'pass', scores: { accessibility: 8, readability: 9 }, notes: 'ok', problems: [] }).success).toBe(true)
    const missing = s.safeParse({ verdict: 'pass', scores: { accessibility: 8 } })
    expect(missing.success).toBe(false)
    expect(s.safeParse({ verdict: 'pass', scores: { accessibility: 8, readability: 9, extra: 5 } }).success).toBe(true) // other scores are allowed
    const js = jsonSchemaOf(s) as { properties: Record<string, { required?: string[]; enum?: string[] }>; required: string[] }
    expect(js.properties.verdict!.enum).toEqual(['pass', 'revise'])
    expect(js.properties.scores!.required).toEqual(['accessibility', 'readability'])
    expect(js.required).toEqual(expect.arrayContaining(['verdict', 'scores']))
    expect(() => jsonSchemaOf(reviewSchema)).not.toThrow()
  }
  })
})

describe('scoring: weights, revise rules, must-pass gates and the threshold', () => {
  const q = quality({ threshold: 7, weights: { accuracy: 2, readability: 1, accessibility: 1, age_fit: 1 } })

  it('weightedScore averages per dimension; decide against the threshold and a must-pass revise', () => {
  // weightedScore averages each dimension over the reviewers, then weighs the averages
  {
    const reviews = [r('fact-checker', 'pass', { accuracy: 8 }), r('accessibility-reviewer', 'pass', { accessibility: 6, readability: 6 }), r('child-safety-reviewer', 'pass', { age_fit: 10 }), r('playtester', 'pass', { accuracy: 6 })]
    const w = weightedScore(reviews, q.weights)
    expect(w.byDimension).toEqual({ accuracy: 7, accessibility: 6, readability: 6, age_fit: 10 })
    expect(w.score).toBeCloseTo((7 * 2 + 6 + 6 + 10) / 5, 2)
    expect(weightedScore([], {})).toEqual({ score: 0, byDimension: {} })
    expect(weightedScore([r('x', 'pass', { novel: 4 })], {}).score).toBe(4) // a dimension without a weight counts 1
  }

  // decide: publishes above the threshold, rejects below it, and a must-pass reviewer that says revise rejects whatever the scores
  {
    const good = [r('fact-checker', 'pass', { accuracy: 9 }), r('accessibility-reviewer', 'pass', { accessibility: 8, readability: 8 }), r('child-safety-reviewer', 'pass', { age_fit: 9 })]
    expect(decide(good, q)).toMatchObject({ publish: true, reasons: [] })
    const low = decide([r('fact-checker', 'pass', { accuracy: 5 })], q)
    expect(low.publish).toBe(false)
    expect(low.reasons[0]).toMatch(/below the threshold/)
    const gate = decide([r('child-safety-reviewer', 'revise', { age_fit: 9 }, 'a scary scene'), r('fact-checker', 'pass', { accuracy: 9 })], q)
    expect(gate.publish).toBe(false)
    expect(gate.reasons[0]).toMatch(/must-pass gate failed: child-safety-reviewer says revise. a scary scene/)
    // a reviewer that is not must-pass does not block by its verdict alone
    expect(decide([...good, r('playtester', 'revise', { flow: 9, difficulty: 9 })], q).publish).toBe(true)
  }
  })

  it('decide: a hard gate rejects with its reason; countsAsRevise; notesProblem', () => {
  // decide: a hard gate that is not ok rejects too, with its reason, next to the other reasons
  {
    const good = [r('fact-checker', 'pass', { accuracy: 9 })]
    const d = decide(good, q, [{ name: 'lint', ok: false, reason: '3 errors: ITEM_NO_KEY at q1' }, { name: 'bot', ok: true }, { name: 'bot-failure', ok: false }])
    expect(d.publish).toBe(false)
    expect(d.reasons).toEqual(['hard gate failed: lint: 3 errors: ITEM_NO_KEY at q1', 'hard gate failed: bot-failure'])
    expect(decide(good, q, [{ name: 'lint', ok: true }]).publish).toBe(true)
    // a gate and a must-pass failure and a low score each give their own reason
    const all = decide([r('fact-checker', 'revise', { accuracy: 2 })], q, [{ name: 'lint', ok: false }])
    expect(all.reasons).toHaveLength(3)
  }

  // countsAsRevise: a non-must-pass revise counts only with a score below revise_below; must-pass always counts; a revise without scores counts
  {
    const qq = quality({ revise_below: 7 })
    expect(countsAsRevise(r('playtester', 'pass', { flow: 2 }), qq)).toBe(false)
    expect(countsAsRevise(r('playtester', 'revise', { flow: 9, difficulty: 8 }), qq)).toBe(false) // "revise" with only good scores is a pass
    expect(countsAsRevise(r('playtester', 'revise', { flow: 9, difficulty: 6 }), qq)).toBe(true)
    expect(countsAsRevise(r('playtester', 'revise', { flow: 7 }), qq)).toBe(false) // 7 is not below 7
    expect(countsAsRevise(r('fact-checker', 'revise', { accuracy: 10 }), qq)).toBe(true)
    expect(countsAsRevise(r('playtester', 'revise', {}), qq)).toBe(true)
    expect(reviewsThatRevise([r('fact-checker', 'pass', { accuracy: 9 }), r('playtester', 'revise', { flow: 3 }), r('playtester', 'revise', { flow: 9 })], qq).map((x) => x.scores)).toEqual([{ flow: 3 }])
  }

  // notesProblem: a revise that promises items and gives none is refused; a pass is never checked
  {
    expect(notesProblem('revise', 'Three concrete fixes below.', [])).toMatch(/too short/)
    expect(notesProblem('revise', 'The check found a few problems in the later items, as follows', [])).toMatch(/promise a list/)
    expect(notesProblem('revise', 'The check found three fixes, described here in a paragraph of its own with no list at all.', [])).toMatch(/promise 3 items but give 0/)
    expect(notesProblem('revise', 'Three fixes:\n- Fix the key of q1.\n- Fix the key of q2.\n- Fix the key of q3.', [])).toBeNull()
    expect(notesProblem('revise', 'Three concrete fixes below.', [{}, {}, {}])).toBeNull()
    expect(notesProblem('revise', 'Two fixes below.', [{}])).toMatch(/promise 2 items but give 1/)
    expect(notesProblem('revise', 'The article cites a fact that says something else, and the item', [])).toMatch(/middle of a sentence/)
    expect(notesProblem('revise', 'The article cites a fact that says something else, and the item', [{}])).toBeNull()
    expect(notesProblem('pass', 'Fine', [])).toBeNull()
  }
  })
})

describe('runReview: the prompt, the review JSON and the follow-up for notes that say nothing', () => {
  async function withPrompt(env: { dir: string }) {
    const dir = path.join(env.dir, 'prompts', 'accessibility-reviewer')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'review.md'), '---\nkind: prompt\nrole: accessibility-reviewer\ntask: review\n---\nReview the course "{{title}}" (round {{round}}).\n\n{{content}}\n\nReply with {"verdict": "pass", "scores": {{scores_example}}, "notes": "...", "problems": []}\n')
  }

  it('builds the prompt from the variables, adds the scores example, and returns the review with the role', async () => {
    const env = await makeEduEnv()
    try {
      await withPrompt(env)
      let seen = ''
      env.mock.on({ role: 'accessibility-reviewer' }, (req) => {
        seen = req.messages.map((m) => contentText(m.content)).join('\n')
        return JSON.stringify({ verdict: 'Pass', scores: { Accessibility: 9, Readability: '8' }, notes: 'Plain wording throughout.', problems: [] })
      })
      const review = await runInJob(env, 'accessibility-reviewer', (ctx) => runReview(ctx, { role: 'accessibility-reviewer', task: 'review', dataDir: env.dir, vars: { title: 'Rome', round: 1, content: 'ITEM q1: What is a consul?' } }))
      expect(review).toEqual({ role: 'accessibility-reviewer', verdict: 'pass', scores: { accessibility: 9, readability: 8 }, notes: 'Plain wording throughout.', problems: [] })
      expect(seen).toContain('Review the course "Rome" (round 1).')
      expect(seen).toContain('ITEM q1: What is a consul?')
      expect(seen).toContain('"scores": {"accessibility": 8, "readability": 8}')
      expect(seen).toContain('Facts come only from the course') // the shared rules are the system message
    } finally {
      await env.cleanup()
    }
  })

  it('an invalid answer is repaired once (chatJson); a revise with no usable notes is asked again in the same job, and kept with a warning if it stays empty', async () => {
    const env = await makeEduEnv()
    try {
      await withPrompt(env)
      let calls = 0
      env.mock.on({ role: 'accessibility-reviewer' }, (req) => {
        calls++
        const last = contentText(req.messages[req.messages.length - 1]!.content)
        if (/Your verdict is revise, but/.test(last)) {
          return JSON.stringify({ verdict: 'revise', scores: { accessibility: 4, readability: 5 }, notes: 'Two problems.', problems: [{ ref: 'q1', issue: 'jargon', fix: 'say "magistrate"' }, 'Item q2 relies on colour.'] })
        }
        return JSON.stringify({ verdict: 'revise', scores: { accessibility: 4, readability: 5 }, notes: 'Two fixes below.', problems: [] })
      })
      const review = await runInJob(env, 'accessibility-reviewer', (ctx) => runReview(ctx, { role: 'accessibility-reviewer', task: 'review', dataDir: env.dir, vars: { title: 'Rome', round: 1, content: 'x' } }))
      expect(calls).toBe(2)
      expect(review.verdict).toBe('revise')
      expect(review.problems).toEqual([{ ref: 'q1', issue: 'jargon', fix: 'say "magistrate"' }, { ref: '', issue: 'Item q2 relies on colour.' }])
      // never any problems: asked twice, then kept
      calls = 0
      env.mock.on({ role: 'accessibility-reviewer' }, () => {
        calls++
        return JSON.stringify({ verdict: 'revise', scores: { accessibility: 4, readability: 5 }, notes: 'Three fixes below.', problems: [] })
      })
      const kept = await runInJob(env, 'accessibility-reviewer', (ctx) => runReview(ctx, { role: 'accessibility-reviewer', task: 'review', dataDir: env.dir, vars: { title: 'Rome', round: 1, content: 'x' } }))
      expect(calls).toBe(2)
      expect(kept).toMatchObject({ verdict: 'revise', notes: 'Three fixes below.', problems: [] })
      // an answer that is not JSON twice fails the job (the scheduler retries it)
      env.mock.on({ role: 'accessibility-reviewer' }, () => 'I think it is fine.')
      await expect(runInJob(env, 'accessibility-reviewer', (ctx) => runReview(ctx, { role: 'accessibility-reviewer', task: 'review', dataDir: env.dir, vars: { title: 'Rome', round: 1, content: 'x' } }))).rejects.toThrow(/valid JSON twice/)
    } finally {
      await env.cleanup()
    }
  })
})
