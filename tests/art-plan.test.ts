import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { artAssetId } from '../src/shared/art'
import type { ArtPlanFile } from '../src/shared/art'
import { fallbackArtLines, resolveArtEntries } from '../src/engine/edu/art'
import type { ArtLine, ArtSource } from '../src/engine/edu/art'
import { mergePlan } from '../src/engine/edu/media'
import type { AssetEntry } from '../src/shared/media'
import { media } from './assets-fixtures'
import { makeEduEnv } from './edu-helpers'
import type { EduEnv } from './edu-helpers'
import { runInJob } from './research-helpers'

const SRC: ArtSource = {
  title: 'The Roman Empire',
  subject: 'The Roman Empire',
  audience: 'teenagers',
  age: '14',
  language: 'English',
  units: [{ id: 'u1', title: 'The republic' }, { id: 'u2', title: 'The fall' }],
  articles: [
    { id: 'a-u1-1', unit: 'u1', title: 'The founding of Rome', body: 'Rome was founded on seven hills beside the river Tiber [f1]. It began as a small town.' },
    { id: 'a-u2-1', unit: 'u2', title: 'The last emperor', body: 'The western empire fell in 476 [f2].' }
  ],
  items: [
    { id: 'u1-q1', kind: 'flashcard', unit: 'u1', prompt: 'The river of Rome', hasPicture: false },
    { id: 'u1-q2', kind: 'mcq', unit: 'u1', prompt: 'Which hill was first?', hasPicture: false },
    { id: 'u1-q3', kind: 'typed', unit: 'u1', prompt: 'Name the founder', hasPicture: true },
    { id: 'u2-q1', kind: 'listening', unit: 'u2', prompt: 'Listen', hasPicture: false },
    { id: 'u2-q2', kind: 'hotspot', unit: 'u2', prompt: 'Where is Rome?', hasPicture: false, asset: 'map-italy', width: 800, height: 500, regions: [{ id: 'r1', shape: { type: 'circle', cx: 400, cy: 250, r: 40 } }] }
  ],
  shells: ['quiz-arena', 'rpg'],
  characters: [{ name: 'Livia', role: 'the guide', description: 'an old scribe with a lantern' }]
}

/** An answer that covers everything the source requires. */
const full = (src = SRC): ArtLine[] => fallbackArtLines(src)

describe('stable asset ids and the table of slots', () => {
  it('ids come from what a picture illustrates, never from a counter', () => {
    expect(artAssetId({ type: 'article', article: 'a-u1-1' })).toBe('img-article-a-u1-1')
    expect(artAssetId({ type: 'item', item: 'u1-q1' })).toBe('img-item-u1-q1')
    expect(artAssetId({ type: 'item', item: 'u1-q1', side: 'back' })).toBe('img-item-u1-q1-back')
    expect(artAssetId({ type: 'hotspot', item: 'u2-q2' }, 'map-italy')).toBe('map-italy') // a hotspot keeps the asset it names
    expect(artAssetId({ type: 'shell', shell: 'quiz-arena', slot: 'bg-u1' })).toBe('img-quiz-arena-bg-u1')
    expect(artAssetId({ type: 'shell', shell: 'mindmaze', slot: 'room-u2' })).toBe('img-mindmaze-room-u2')
    expect(artAssetId({ type: 'shell', shell: 'encyclopedia', slot: 'plate-a-u1-1' })).toBe('img-encyclopedia-plate-a-u1-1')
    expect(artAssetId({ type: 'shell', shell: 'rpg', slot: 'npc-2' })).toBe('img-rpg-npc-2')
  })
})

describe('the plan in the manifest: a rerun keeps ids and versions', () => {
  const entriesOf = (prompts: Record<string, string> = {}) => resolveArtEntries(full().map((l) => ({ ...l, prompt: prompts[`${l.id ?? l.slot}`] ?? l.prompt })), SRC, { media: media(), by: 'fallback' })

  it('a new plan adds assets; an asset with versions keeps its prompt and engine; a prompt set by hand and a locked asset keep theirs; an asset the plan dropped stays', () => {
    const first = mergePlan({ assets: [] }, entriesOf(), media())
    expect(first.assets.map((a) => a.id)).toEqual(entriesOf().map((e) => e.id))
    expect(first.assets.every((a) => a.versions.length === 0 && a.selected === null && !a.locked)).toBe(true)
    // life happens: a version of one, a prompt by hand on another, a lock on a third, an orphan
    const withLife = {
      assets: first.assets.map((a): AssetEntry => {
        if (a.id === 'img-article-a-u1-1') return { ...a, versions: [{ n: 1, file: 'v1.webp', createdAt: 'x', seed: 1, engine: 'qwen-image-2.1', prompt: a.prompt }], selected: 1 }
        if (a.id === 'img-article-a-u2-1') return { ...a, prompt: 'MY PROMPT', promptByHand: true }
        if (a.id === 'img-quiz-arena-bg-u1') return { ...a, prompt: 'LOCKED PROMPT', locked: true }
        return a
      }),
    }
    withLife.assets.push({ ...first.assets[0]!, id: 'img-article-gone' })
    const second = mergePlan(withLife, entriesOf({ 'a-u1-1': 'NEW PROMPT A', 'a-u2-1': 'NEW PROMPT B', 'bg-u1': 'NEW PROMPT C', 'bg-u2': 'NEW PROMPT D' }), media())
    const get = (id: string) => second.assets.find((a) => a.id === id)!
    expect(second.assets.map((a) => a.id)).toEqual([...entriesOf().map((e) => e.id), 'img-article-gone'])
    expect(get('img-article-a-u1-1')).toMatchObject({ selected: 1, versions: [{ n: 1 }], prompt: expect.not.stringContaining('NEW PROMPT A') }) // the version stays, so does the prompt it was made from
    expect(get('img-article-a-u2-1').prompt).toBe('MY PROMPT')
    expect(get('img-quiz-arena-bg-u1').prompt).toBe('LOCKED PROMPT')
    expect(get('img-quiz-arena-bg-u2').prompt).toMatch(/NEW PROMPT D/) // nothing made yet: the new prompt is used
    expect(get('img-article-gone')).toBeTruthy()
    // alt text, style and size follow the plan
    expect(get('img-article-a-u1-1')).toMatchObject({ alt: expect.stringMatching(/The founding of Rome/), style: 'illustrated', fit: { w: 960, h: 720 } })
  })
})

describe('the art-director through a job: the repair round and the fallback plan', () => {
  let env: EduEnv
  beforeEach(async () => {
    env = await makeEduEnv()
  })
  afterEach(async () => {
    await env.cleanup()
  })

  const lines = (bad = false): ArtLine[] => full().map((l) => (bad && l.for === 'article' ? { ...l, id: 'no-such-article' } : l))
  const plan1 = (images: ArtLine[]) => JSON.stringify({ images, notes: 'Soft colours.' })
  const planIt = (slug: string) => runInJob(env, 'art-director', (ctx) => env.engine.edu.media.planArt(ctx, slug, SRC), { book: slug })
  const planFile = async (slug: string): Promise<ArtPlanFile> => JSON.parse(await readFile(path.join(env.dir, 'courses', slug, 'pipeline', 'art.json'), 'utf8')) as ArtPlanFile

  it('a good answer is the plan: art.json is written and the manifest has every asset', async () => {
    let calls = 0
    env.mock.on({ role: 'art-director' }, () => (calls++, plan1(lines())))
    const r = await planIt('plan-ok')
    expect(calls).toBe(1)
    expect(r.plan).toMatchObject({ source: 'model', style: 'illustrated' })
    expect(r.plan.entries.every((e) => e.by === 'model')).toBe(true)
    expect(r.added).toHaveLength(10)
    expect((await planFile('plan-ok')).entries.map((e) => e.id)).toEqual(r.plan.entries.map((e) => e.id))
    expect((await env.engine.edu.media.loadManifest('plan-ok')).assets).toHaveLength(10)
  })

  it('an answer that stays unusable after the repair round gives the deterministic plan, so the step never blocks the course', async () => {
    let calls = 0
    env.mock.on({ role: 'art-director' }, () => (calls++, plan1(lines(true))))
    const r = await planIt('plan-fallback')
    expect(calls).toBe(2)
    expect(r.plan).toMatchObject({ source: 'fallback', note: expect.stringMatching(/no usable answer/) })
    expect(r.plan.entries).toHaveLength(10)
    expect(r.plan.entries.every((e) => e.by === 'fallback')).toBe(true)
    // an answer that is no JSON at all is the same
    env.mock.on({ role: 'art-director' }, () => 'I would rather paint than write JSON.')
    expect((await planIt('plan-nojson')).plan.source).toBe('fallback')
  })
})
