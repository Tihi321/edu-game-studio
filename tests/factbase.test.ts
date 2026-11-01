import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FactBase, factLines, normaliseFact } from '../src/engine/edu/factbase'
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
})
