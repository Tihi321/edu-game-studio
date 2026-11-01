import { describe, expect, it } from 'vitest'
import { failures } from './edu-helpers'
import { courseFile, json, makePipelineEnv, run, statusOf, toolsOf } from './pipeline-helpers'
import { readingStats } from '../src/shared/reading'

type Pack = {
  cefr: string
  languages: string[]
  targetLang: string
  extensions: { language?: { reading?: { words: number[]; glossary: number[] }; verbUnits?: string[] } }
  encyclopedia: { articles: { id: string; title: string; body: string; unit: string }[] }
  items: { id: string; kind: string; tags: string[]; prompt: string; back?: string; shuffle?: boolean; options?: { id: string }[]; extensions: { passage?: { article: string }; gloss?: { article: string; entry: string } } }[]
  shells: { enabled: string[]; config: { encyclopedia?: { reader: boolean; glossary: Record<string, { id: string; term: string; lemma?: string; gloss: string }[]> } } }
}
type Cat = { strings: Record<string, string> }

/** A German B2 course for Croatian speakers with an English edition, on the mock team. */
const BRIEF = { topic: 'Arbeit und Stadt', audience: 'adults', age: 30, sourceLang: 'hr', languages: ['hr', 'en'], targetLang: 'de', cefr: 'B2', units: 2, story: 'none' }

describe('a language-b2 run on the mock team (EGS-36)', () => {
  it('writes readings in the band with glossaries, harvests the vocabulary deck with stable ids, and lints clean', async () => {
    const env = await makePipelineEnv()
    try {
      const { failed, slug } = await run(env, BRIEF, 90_000)
      expect(failed.length ? await failures(env) : []).toEqual([])
      const view = (await toolsOf(env).call('edu_status', { slug })).data.pipeline as { stage: string; steps: { step: string; status: string }[] }
      expect(view.stage, JSON.stringify((view as { blockedBy?: string[] }).blockedBy)).toBe('published')
      expect(statusOf(view, 'harvest:all')).toBe('done')
      expect(env.author.calls).toEqual(expect.arrayContaining(['subject-expert/reading:u1', 'subject-expert/reading:u2', 'item-writer/items:u1']))
      expect(env.author.calls.some((c) => c.startsWith('subject-expert/articles:'))).toBe(false)

      const pack = await json<Pack>(courseFile(env, slug, 'course', 'pack.json'))
      expect(pack).toMatchObject({ cefr: 'B2', targetLang: 'de', languages: ['hr', 'en'] })
      expect(pack.extensions.language?.reading).toEqual({ words: [350, 700], glossary: [10, 20] })
      expect(pack.shells.enabled).toContain('encyclopedia')
      expect(pack.shells.config.encyclopedia?.reader).toBe(true)

      // the readings are German, in the target catalog, 300 to 800 words
      const de = await json<Cat>(courseFile(env, slug, 'course', 'text', 'de.json'))
      const hr = await json<Cat>(courseFile(env, slug, 'course', 'text', 'hr.json'))
      expect(pack.encyclopedia.articles).toHaveLength(4)
      for (const a of pack.encyclopedia.articles) {
        const body = de.strings[a.body]!
        expect(body, a.id).toBeDefined()
        expect(hr.strings[a.body]).toBeUndefined()
        const words = readingStats(body).words
        expect(words).toBeGreaterThanOrEqual(300)
        expect(words).toBeLessThanOrEqual(800)
        // the glossary: terms and lemmas in German, glosses in the edition catalogs, every term in the text
        const entries = pack.shells.config.encyclopedia!.glossary[a.id]!
        expect(entries.length).toBeGreaterThanOrEqual(10)
        for (const e of entries) {
          expect(body.includes(de.strings[e.term]!), `${a.id} ${e.id}`).toBe(true)
          expect(de.strings[e.lemma!]).toBe('die Entscheidung, -en')
          expect(hr.strings[e.gloss]).toMatch(/^decision number/)
        }
      }

      // the reading items name their text; the tfng items keep their order; the self-check cards have a model answer
      const readingItems = pack.items.filter((i) => i.tags.includes('reading'))
      expect(readingItems.length).toBeGreaterThan(8)
      for (const i of readingItems) expect(i.extensions.passage?.article, i.id).toMatch(/^a-u[12]-[12]$/)
      for (const i of pack.items.filter((x) => x.tags.includes('tfng'))) {
        expect(i.shuffle).toBe(false)
        expect(i.options!.map((o) => o.id)).toEqual(['t', 'f', 'ng'])
      }
      expect(pack.items.filter((i) => i.tags.includes('self-check')).length).toBeGreaterThan(0)

      // the harvest: one flashcard per glossary entry, ids <articleId>-gl-<n>, tagged gloss, naming their entry
      const cards = pack.items.filter((i) => i.tags.includes('gloss'))
      expect(cards).toHaveLength(40)
      expect(cards.map((c) => c.id)).toEqual(expect.arrayContaining(['a-u1-1-gl-1', 'a-u1-1-gl-10', 'a-u2-2-gl-10']))
      expect(new Set(cards.map((c) => c.id)).size).toBe(40)
      for (const c of cards) {
        expect(c.kind).toBe('flashcard')
        expect(c.extensions.gloss?.article).toMatch(/^a-u/)
        expect(de.strings[c.prompt]).toContain('«Entscheidung')
      }

      // the lint of the run has no error
      expect(await json(courseFile(env, slug, 'pipeline', 'lint.json'))).toMatchObject({ ok: true, errors: 0 })
    } finally {
      await env.cleanup()
    }
  })

  it('the harvest step is idempotent: running it again makes no new card and changes no file', async () => {
    const env = await makePipelineEnv()
    try {
      const { failed, slug } = await run(env, BRIEF, 90_000)
      expect(failed).toEqual([])
      const before = await json<Pack>(courseFile(env, slug, 'course', 'pack.json'))
      const again = await env.engine.edu.courses.harvest(slug)
      expect(again.added).toEqual([])
      expect(again.kept).toHaveLength(40)
      const after = await json<Pack>(courseFile(env, slug, 'course', 'pack.json'))
      expect(after.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id))
    } finally {
      await env.cleanup()
    }
  })

  it('a course that is not a B1 or B2 language course skips the harvest and keeps ordinary articles', async () => {
    const env = await makePipelineEnv()
    try {
      const { failed, slug } = await run(env, { topic: 'German basics', audience: 'adults', age: 30, sourceLang: 'en', targetLang: 'de', cefr: 'A2', units: 2 }, 90_000)
      expect(failed).toEqual([])
      const view = (await toolsOf(env).call('edu_status', { slug })).data.pipeline as { steps: { step: string; status: string; note?: string }[] }
      expect(view.steps.find((s) => s.step === 'harvest:all')).toMatchObject({ status: 'skipped' })
      expect(env.author.calls.some((c) => c.startsWith('subject-expert/reading:'))).toBe(false)
      const pack = await json<Pack>(courseFile(env, slug, 'course', 'pack.json'))
      expect(pack.items.some((i) => i.tags.includes('gloss'))).toBe(false)
      expect(pack.shells.config.encyclopedia).toBeUndefined()
    } finally {
      await env.cleanup()
    }
  })
})
