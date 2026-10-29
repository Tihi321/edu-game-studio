import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { citedFactIds, citedNumbers, FactBase, factLines, normaliseFact, sourceLines } from '../src/engine/edu/factbase'
import { ResearchStore } from '../src/engine/research/notes'
import { factSchema } from '../src/shared/course'
import { parseMd } from '../src/shared/md'

let dir = ''
let store: ResearchStore
let allow = false
let fb: FactBase

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'edu-factbase-'))
  store = new ResearchStore(dir)
  allow = false
  fb = new FactBase(dir, store, { allowUnverified: () => allow })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

const src = (n: number, title = `Source ${n}`) => ({ url: `https://example.org/s${n}`, title })
const note = (question: string, facts: { fact: string; source?: ReturnType<typeof src> }[], unverified = false) => store.write({ question, course: 'rome', askedBy: 'you', unverified, facts })
const read = (...p: string[]) => readFile(path.join(dir, 'courses', 'rome', 'factbase', ...p), 'utf8')

describe('merging notes into the fact base', () => {
  it('gives facts ids f1, f2 ... and sources numbers 1, 2 ..., and keeps them stable when later notes merge', async () => {
    await note('When did the Western Roman Empire end?', [
      { fact: 'The Western Roman Empire ended in 476.', source: src(1) },
      { fact: 'Odoacer deposed the last western emperor.', source: src(2) }
    ])
    const first = await fb.mergeNotes('rome')
    expect(first.added.map((f) => [f.id, f.sources])).toEqual([['f1', [1]], ['f2', [2]]])
    expect(first.merged).toEqual(['courses/rome/research/1-when-did-the-western-roman-empire-end.md'])
    const before = await fb.get('rome')
    expect(before.sources.map((s) => [s.n, s.url])).toEqual([[1, 'https://example.org/s1'], [2, 'https://example.org/s2']])

    // a second note: one new fact on a known source, one on a new source, one fact on both
    await note('Who was the first emperor?', [
      { fact: 'Augustus was the first Roman emperor.', source: src(2) },
      { fact: 'Augustus took power in 27 BC.', source: src(3) }
    ])
    const second = await fb.mergeNotes('rome')
    expect(second.added.map((f) => [f.id, f.sources])).toEqual([['f3', [2]], ['f4', [3]]])
    const after = await fb.get('rome')
    // what was cited before did not change
    expect(after.facts.slice(0, 2)).toEqual(before.facts)
    expect(after.sources.slice(0, 2)).toEqual(before.sources)
    expect(after.sources.map((s) => s.n)).toEqual([1, 2, 3])
    expect(after.merged).toHaveLength(2)
    expect(after.pendingNotes).toEqual([])
    expect(after.notes).toBe(2)
    // the files are readable by a person and by the engine
    expect(parseMd(await read('facts.md')).body).toContain('[f3] Augustus was the first Roman emperor. (sources [2])')
    expect(parseMd(await read('sources.md')).body).toMatch(/3\. Source 3\. https:\/\/example\.org\/s3/)
    expect((parseMd(await read('merged.md')).data.notes as string[])).toHaveLength(2)
    // merging again changes nothing
    const again = await fb.mergeNotes('rome')
    expect(again).toEqual({ added: [], duplicates: 0, skippedUnverified: 0, merged: [] })
    expect((await fb.get('rome')).facts).toEqual(after.facts)
  })

  it('a fact that repeats one already there (same words, any case or punctuation) adds its source instead of a new fact', async () => {
    await note('When did the Western Roman Empire end?', [{ fact: 'The Western Roman Empire ended in 476.', source: src(1) }])
    await fb.mergeNotes('rome')
    await note('What happened in 476?', [
      { fact: 'the western roman EMPIRE ended, in 476!', source: src(2) },
      { fact: 'The Western Roman Empire ended in 476.', source: src(1) }
    ])
    const r = await fb.mergeNotes('rome')
    expect(r.added).toEqual([])
    expect(r.duplicates).toBe(2)
    const v = await fb.get('rome')
    expect(v.facts).toHaveLength(1)
    expect(v.facts[0]).toMatchObject({ id: 'f1', sources: [1, 2] }) // the second source was added once
    expect(v.sources.map((s) => s.n)).toEqual([1, 2])
    expect(normaliseFact('The  Western, Roman Empire!')).toBe('the western roman empire')
  })

  it('unverified facts are dropped unless allow_unverified_facts is set; the note stays pending, and a sourced duplicate confirms an unverified fact', async () => {
    await note('Who were the consuls?', [{ fact: 'Two consuls were elected each year.' }], true)
    const dropped = await fb.mergeNotes('rome')
    expect(dropped).toEqual({ added: [], duplicates: 0, skippedUnverified: 1, merged: [] })
    const v = await fb.get('rome')
    expect(v.facts).toEqual([])
    expect(v.pendingNotes).toEqual(['courses/rome/research/1-who-were-the-consuls.md'])
    allow = true
    const kept = await fb.mergeNotes('rome')
    expect(kept.added).toEqual([expect.objectContaining({ id: 'f1', sources: [], unverified: true, topic: 'Who were the consuls?' })])
    expect((await fb.get('rome')).pendingNotes).toEqual([])
    expect(factLines((await fb.get('rome')).facts)).toBe('[f1] Two consuls were elected each year. (unverified, no source)')
    // a sourced note that says the same confirms it
    await note('How many consuls were there?', [{ fact: 'Two consuls were elected each year.', source: src(1) }])
    await fb.mergeNotes('rome')
    expect((await fb.get('rome')).facts[0]).toEqual({ id: 'f1', fact: 'Two consuls were elected each year.', sources: [1], note: 'courses/rome/research/1-who-were-the-consuls.md', topic: 'Who were the consuls?' })
  })

  it('a note with no facts is marked merged, two merges at once do not repeat facts, and an empty course has an empty fact base', async () => {
    expect(await fb.get('rome')).toEqual({ facts: [], sources: [], merged: [], notes: 0, pendingNotes: [] })
    await note('An empty question here?', [])
    await note('When did the Western Roman Empire end?', [{ fact: 'The Western Roman Empire ended in 476.', source: src(1) }])
    const [a, b] = await Promise.all([fb.mergeNotes('rome'), fb.mergeNotes('rome')])
    expect(a.added.length + b.added.length).toBe(1)
    const v = await fb.get('rome')
    expect(v.facts.map((f) => f.id)).toEqual(['f1'])
    expect(v.merged).toHaveLength(2)
  })

  it('a note that was edited by hand with a line that has no source is not a sourced fact', async () => {
    const n = await note('When did the Western Roman Empire end?', [{ fact: 'The Western Roman Empire ended in 476.', source: src(1) }])
    const file = path.join(dir, n.file)
    await appendFile(file, '- A line somebody typed without a source.\n')
    const r = await fb.mergeNotes('rome')
    expect(r.added.map((f) => f.id)).toEqual(['f1'])
    expect(r.skippedUnverified).toBe(1)
    expect((await fb.get('rome')).pendingNotes).toHaveLength(1)
  })
})

describe('citations and prompt lines', () => {
  it('citedFactIds finds [f3], [f3, f5] and [f3][f5], once each, in order of first use', () => {
    expect(citedFactIds('Rome fell [f3]. Odoacer ruled [f5, f3] and later [f12][f5].')).toEqual(['f3', 'f5', 'f12'])
    expect(citedFactIds('No citation, a source number [3], an array a[0] and [fx] and [f].')).toEqual([])
    expect(citedFactIds('[f1; f2] [ f3 ]')).toEqual(['f1', 'f2'])
  })

  it('citedNumbers finds [3], [3, 4] and [3][4], ascending', () => {
    expect(citedNumbers('One [3]. Two [4, 2] and [3][10].')).toEqual([2, 3, 4, 10])
    expect(citedNumbers('A fact [f3] is not a source number.')).toEqual([])
  })

  it('factLines and sourceLines are the lines the prompts show', async () => {
    await note('A question about Rome', [{ fact: 'Fact one is here.', source: src(1, 'Title One') }, { fact: 'Fact two is here.', source: src(2, '') }])
    await fb.mergeNotes('rome')
    await note('Another question about Rome', [{ fact: 'Fact one is here.', source: src(2, '') }])
    await fb.mergeNotes('rome')
    const v = await fb.get('rome')
    expect(factLines(v.facts)).toBe('[f1] Fact one is here. (sources [1][2])\n[f2] Fact two is here. (sources [2])')
    expect(sourceLines(v.sources)).toBe('[1] Title One. https://example.org/s1\n[2] https://example.org/s2')
    expect(sourceLines(v.sources, [2])).toBe('[2] https://example.org/s2')
  })
})

describe('the fact base as course-pack data', () => {
  it('toPack gives pack.factbase entries with one source (the first) and the claim strings; the entries pass the pack schema', async () => {
    await note('A question about Rome', [
      { fact: 'Fact one is here.', source: src(1, 'Title One') },
      { fact: 'Fact two is here.', source: src(2, '') }
    ])
    await fb.mergeNotes('rome')
    await note('Another question about Rome', [{ fact: 'Fact one is here.', source: src(3, 'Third') }])
    await fb.mergeNotes('rome')
    const pack = await fb.toPack('rome')
    expect(pack.factbase).toEqual([
      { id: 'f1', claim: 'fact.f1.claim', source: 'Title One', url: 'https://example.org/s1' }, // f1 has sources 1 and 3: the first
      { id: 'f2', claim: 'fact.f2.claim', source: 'example.org', url: 'https://example.org/s2' } // no title: the host
    ])
    expect(pack.strings).toEqual({ 'fact.f1.claim': 'Fact one is here.', 'fact.f2.claim': 'Fact two is here.' })
    for (const f of pack.factbase) expect(factSchema.safeParse(f).success, f.id).toBe(true)
  })

  it('an unverified fact has a source text that says so, and no url', async () => {
    allow = true
    await note('Who were the consuls?', [{ fact: 'Two consuls were elected each year.' }], true)
    await fb.mergeNotes('rome')
    const pack = await fb.toPack('rome')
    expect(pack.factbase[0]).toMatchObject({ id: 'f1', source: expect.stringContaining('unverified') })
    expect(pack.factbase[0]).not.toHaveProperty('url')
    expect(factSchema.safeParse(pack.factbase[0]).success).toBe(true)
  })
})
