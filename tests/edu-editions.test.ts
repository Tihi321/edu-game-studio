import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyEdition, checkEdition, chunkEntries, editionEntries, editionSchema, placeholdersOf } from '../src/engine/edu/editions'
import { loadCourseFolder } from '../src/engine/edu/course-io'
import { editionLanguages } from '../src/engine/edu/pipeline'
import { CourseStore } from '../src/engine/edu/store'
import { validateCourse } from '../src/shared/edu'
import type { TextCatalog } from '../src/shared/course'
import { copyFixture, useTemp } from './edu-build-helpers'
import { courseFile, json, makePipelineEnv, pipelineOf, run, statusOf, toolsOf } from './pipeline-helpers'

const cat = (lang: string, strings: Record<string, string>, accepted?: Record<string, string[]>): TextCatalog => ({ schema: 1, lang, strings, ...(accepted ? { accepted } : {}) }) as TextCatalog

describe('editions: the pure parts', () => {
  it('translates the source catalog but not the keys of the target-language catalog (the taught phrases), accepted lists included', () => {
    const source = cat('hr', { 'q.prompt': 'Kako se kaže "kuća"?', 'q.answer': 'Haus', 'q.gap': 'x', 'q.text': 'Das ist {{g1}}.' }, { 'q.answer': ['Haus'], 'q.hr': ['kuća', 'dom'] })
    const target = cat('de', { 'q.answer': 'Haus', 'q.text': 'Das ist {{g1}}.' }, { 'q.answer': ['Haus'] })
    const entries = editionEntries(source, target)
    expect(entries.map((e) => e.key).sort()).toEqual(['q.gap', 'q.hr', 'q.prompt'])
    expect(entries.find((e) => e.key === 'q.hr')).toEqual({ key: 'q.hr', accepted: ['kuća', 'dom'] }) // accepted without a string
    expect(editionEntries(source)).toHaveLength(5) // no target language: everything
  })

  it('chunks by count and by size, and an oversized entry goes alone', () => {
    const e = (key: string, n: number) => ({ key, text: 'x'.repeat(n) })
    expect(chunkEntries([e('a', 10), e('b', 10), e('c', 10)], 2).map((c) => c.length)).toEqual([2, 1])
    expect(chunkEntries([e('a', 5000), e('b', 5000), e('c', 10)], 60, 7000).map((c) => c.map((x) => x.key))).toEqual([['a'], ['b', 'c']])
    expect(chunkEntries([e('big', 99_999)]).map((c) => c.length)).toEqual([1])
    expect(chunkEntries([])).toEqual([])
  })

  it('checks a translation: a missing, invented or doubled key, an empty text, changed placeholders, missing accepted answers', () => {
    const asked = [
      { key: 'a', text: 'Das ist {{g1}} und {name}.' },
      { key: 'b', text: 'Hallo' },
      { key: 'c', accepted: ['kuća', 'dom'] }
    ]
    const ok = editionSchema.parse({ items: [{ key: 'a', text: 'This is {name} and {{g1}}.' }, { key: 'b', text: 'Hello' }, { key: 'c', accepted: ['house', 'home'] }] })
    expect(checkEdition(asked, ok)).toEqual([])
    const bad = editionSchema.parse({ items: [{ key: 'a', text: 'This is {{g2}} and {name}.' }, { key: 'x', text: 'invented' }, { key: 'c', accepted: [] }, { key: 'c', accepted: ['house'] }] })
    const issues = checkEdition(asked, bad).map((p) => `${p.ref}: ${p.issue}`).join('\n')
    expect(issues).toMatch(/a: the placeholders changed/)
    expect(issues).toMatch(/x: this key was not asked for/)
    expect(issues).toMatch(/b: missing/)
    expect(issues).toMatch(/c: this key is given twice/)
    expect(checkEdition([{ key: 'b', text: 'Hallo' }], editionSchema.parse({ items: [{ key: 'b', text: '  ' }] }))[0]!.issue).toMatch(/text is missing or empty/)
    expect(placeholdersOf('{{g1}} {a.b} no {1} {{ g2 }}')).toEqual(['{a.b}', '{{ g2 }}', '{{g1}}'])
  })

  it('puts an answer together, trimmed, for the asked entries only', () => {
    const into = { strings: {} as Record<string, string>, accepted: {} as Record<string, string[]> }
    const asked = [{ key: 'a', text: 'x' }, { key: 'c', accepted: ['k'] }]
    applyEdition(asked, editionSchema.parse({ items: [{ key: 'a', text: ' A ' }, { key: 'c', accepted: [' K '] }, { key: 'z', text: 'Z' }] }), into)
    expect(into).toEqual({ strings: { a: 'A' }, accepted: { c: ['K'] } })
  })

  it('an edition is every language of the brief but the source and the taught language', () => {
    const R = (languages: string[], sourceLang: string, targetLang?: string) => ({ languages, brief: { sourceLang, ...(targetLang ? { targetLang } : {}) } }) as never
    expect(editionLanguages(R(['hr', 'en'], 'hr', 'de'))).toEqual(['en'])
    expect(editionLanguages(R(['en'], 'en'))).toEqual([])
    expect(editionLanguages(R(['en', 'hr', 'de'], 'en', 'hr'))).toEqual(['de'])
  })
})

describe('editions in the pipeline (mock translator)', () => {
  const BRIEF_DE = { topic: 'German verbs', audience: 'adults', age: 30, sourceLang: 'hr', languages: ['hr', 'en'], targetLang: 'de', cefr: 'A1', units: 2, story: 'none' }

  it('hr + en from one run of a German course: three catalogs, the pack lists both editions, nothing taught is translated, validate is clean', async () => {
    const env = await makePipelineEnv()
    try {
      const { failed, slug } = await run(env, BRIEF_DE, 90_000)
      expect(failed).toEqual([])
      const p = (await toolsOf(env).call('edu_status', { slug })).data.pipeline as Awaited<ReturnType<typeof pipelineOf>>
      expect(p.stage).toBe('published')
      expect(statusOf(p, 'editions:all')).toBe('done')
      expect(env.author.calls.filter((c) => c === 'translator/edition').length).toBeGreaterThan(0)
      expect(env.author.calls).not.toContain('translator/edition:repair')
      const dir = (...x: string[]) => courseFile(env, slug, 'course', ...x)
      const pack = await json<{ languages: string[]; sourceLang: string; targetLang: string }>(dir('pack.json'))
      expect(pack).toMatchObject({ languages: ['hr', 'en'], sourceLang: 'hr', targetLang: 'de' })
      const hr = await json<TextCatalog>(dir('text', 'hr.json'))
      const en = await json<TextCatalog>(dir('text', 'en.json'))
      const de = await json<TextCatalog>(dir('text', 'de.json'))
      const taught = (k: string) => k in de.strings
      for (const k of Object.keys(hr.strings)) {
        expect(k in en.strings, k).toBe(!taught(k))
        if (!taught(k)) expect(en.strings[k], k).toBe(`[English] ${hr.strings[k]}`)
      }
      expect(Object.keys(en.strings).some(taught)).toBe(false)
      expect(Object.keys(en.accepted ?? {}).every((k) => !taught(k))).toBe(true)
      expect(Object.keys(de.strings).length).toBeGreaterThan(0)
      // the taught catalog is not written by the editions step: its file is what the assemble step made (no "[English]" in it)
      expect(await readFile(dir('text', 'de.json'), 'utf8')).not.toContain('[English]')
      expect(validateCourse(pack, { hr, en, de }).problems).toEqual([])
      expect(await json<{ languages: string[] }>(courseFile(env, slug, 'pipeline', 'editions.json'))).toMatchObject({ languages: ['en'] })
    } finally {
      await env.cleanup()
    }
  }, 120_000)

  it('a translation with a key missing is asked again once (repair round) and then accepted', async () => {
    const env = await makePipelineEnv({ editions: 'repair' })
    try {
      const { failed, slug } = await run(env, BRIEF_DE, 90_000)
      expect(failed).toEqual([])
      expect(env.author.calls).toContain('translator/edition:repair')
      const pack = await json<{ languages: string[] }>(courseFile(env, slug, 'course', 'pack.json'))
      expect(pack.languages).toEqual(['hr', 'en'])
    } finally {
      await env.cleanup()
    }
  }, 120_000)

  it('a translator that keeps dropping a key fails the step with the key named; the pack keeps one language and the run does not publish', async () => {
    const env = await makePipelineEnv({ editions: 'drops' })
    try {
      const { failed, slug } = await run(env, BRIEF_DE, 90_000)
      expect(failed.length).toBeGreaterThan(0)
      const p = (await toolsOf(env).call('edu_status', { slug })).data.pipeline as Awaited<ReturnType<typeof pipelineOf>>
      expect(p.stage).not.toBe('published')
      expect(p.failed?.[0]?.failure).toMatch(/translator answer still has problems[\s\S]*missing/)
      expect((await json<{ languages: string[] }>(courseFile(env, slug, 'course', 'pack.json'))).languages).toEqual(['hr'])
    } finally {
      await env.cleanup()
    }
  }, 120_000)

  it('nothing to translate (the other language is the taught one): the step is skipped with its reason and no translator is called', async () => {
    const env = await makePipelineEnv()
    try {
      const { failed, slug } = await run(env, { topic: 'Croatian greetings', audience: 'adults', age: 30, sourceLang: 'en', targetLang: 'hr', cefr: 'A1', units: 2, languages: ['en', 'hr'] }, 90_000)
      expect(failed).toEqual([])
      const p = (await toolsOf(env).call('edu_status', { slug })).data.pipeline as Awaited<ReturnType<typeof pipelineOf>>
      expect(statusOf(p, 'editions:all')).toBe('skipped')
      expect(env.author.calls.some((c) => c.startsWith('translator/'))).toBe(false)
    } finally {
      await env.cleanup()
    }
  }, 120_000)
})

describe('CourseStore.addEditions', () => {
  const setup = async () => {
    const { dataDir, root } = await copyFixture('hr-a1-greetings')
    const store = new CourseStore(dataDir)
    const read = (f: string) => readFile(path.join(root, 'course', 'text', f), 'utf8')
    const loaded = await loadCourseFolder(root)
    const en = loaded.catalogs.en as TextCatalog
    const hr = loaded.catalogs.hr as TextCatalog
    const entries = editionEntries(en, hr)
    const made = { strings: {} as Record<string, string>, accepted: {} as Record<string, string[]> }
    for (const e of entries) {
      if (e.text !== undefined) made.strings[e.key] = `[de] ${e.text}`
      if (e.accepted) made.accepted[e.key] = e.accepted.map((a) => `[de] ${a}`)
    }
    return { store, root, read, made, entries }
  }

  useTemp()

  it('writes the new catalog and lists the edition; the source and the taught catalogs stay byte-identical; the course validates and builds', async () => {
    const { store, root, read, made, entries } = await setup()
    expect(entries.length).toBeGreaterThan(0)
    const [enBefore, hrBefore] = [await read('en.json'), await read('hr.json')]
    const res = await store.addEditions('hr-a1-greetings', { de: made })
    expect(res.languages).toEqual(['en', 'de'])
    expect(await read('en.json')).toBe(enBefore)
    expect(await read('hr.json')).toBe(hrBefore) // the taught phrases of the target language
    expect(JSON.parse(await read('de.json'))).toMatchObject({ lang: 'de' })
    const loaded = await loadCourseFolder(root)
    expect(validateCourse(loaded.pack, loaded.catalogs).problems).toEqual([])
    expect((await store.validate('hr-a1-greetings')).ok).toBe(true)
  })

  it('refuses an edition with a key missing and writes nothing; refuses the source or the taught language', async () => {
    const { store, root, read, made } = await setup()
    const pack0 = await readFile(path.join(root, 'course', 'pack.json'), 'utf8')
    const lacking = { strings: { ...made.strings }, accepted: made.accepted }
    delete lacking.strings[Object.keys(lacking.strings)[0]!]
    await expect(store.addEditions('hr-a1-greetings', { de: lacking })).rejects.toThrow(/nothing was written.*MISSING_TEXT/)
    await expect(store.addEditions('hr-a1-greetings', { en: made })).rejects.toThrow(/source or the target language/)
    await expect(store.addEditions('hr-a1-greetings', { hr: made })).rejects.toThrow(/source or the target language/)
    expect(await readFile(path.join(root, 'course', 'pack.json'), 'utf8')).toBe(pack0)
    await expect(read('de.json')).rejects.toThrow()
  })

  it('assemble again drops the catalog of an edition the pack no longer lists (a restart from assemble)', async () => {
    const { store, root, read, made } = await setup()
    await store.addEditions('hr-a1-greetings', { de: made })
    const loaded = await loadCourseFolder(root)
    await store.writeAssembled('hr-a1-greetings', { ...(loaded.pack as object), languages: ['en'] } as Record<string, unknown>, { en: loaded.catalogs.en, hr: loaded.catalogs.hr })
    await expect(read('de.json')).rejects.toThrow()
    expect((await store.validate('hr-a1-greetings')).ok).toBe(true)
  })
})
