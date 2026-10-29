import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { artAssetId, artSizes, composePrompt, hotspotSizes, rpgNpcCount, shellSlots, styleWords } from '../src/shared/art'
import type { ArtPlanFile } from '../src/shared/art'
import { artPlanSchema, artPromptVars, checkArtPlan, fallbackArtLines, MAX_ITEM_IMAGES, resolveArtEntries } from '../src/engine/edu/art'
import type { ArtLine, ArtSource } from '../src/engine/edu/art'
import { applyMedia } from '../src/engine/edu/media-link'
import type { MediaMerge } from '../src/engine/edu/media-link'
import { mergePlan } from '../src/engine/edu/media'
import { formatProblems } from '../src/engine/edu/authoring'
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
const plan = (images: ArtLine[]) => artPlanSchema.parse({ images, notes: '' })

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

  it('the slots of each shell: quiz arena (a backdrop per unit and the boss), mindmaze rooms, encyclopedia plates, RPG tiles, hero and NPCs; any other shell gets a backdrop', () => {
    const ctx = { units: SRC.units, articles: SRC.articles }
    expect(shellSlots('quiz-arena', ctx).map((s) => s.slot)).toEqual(['bg-u1', 'bg-u2', 'bg-boss'])
    expect(shellSlots('mindmaze', ctx).map((s) => s.slot)).toEqual(['room-u1', 'room-u2'])
    expect(shellSlots('encyclopedia', ctx).map((s) => s.slot)).toEqual(['plate-a-u1-1', 'plate-a-u2-1'])
    expect(shellSlots('rpg', ctx).map((s) => [s.slot, s.kind])).toEqual([['tiles', 'tileset'], ['hero', 'sprite'], ['npc-1', 'sprite'], ['npc-2', 'sprite']])
    expect(shellSlots('roleplay', ctx).map((s) => [s.slot, s.kind])).toEqual([['backdrop', 'background']])
    expect([2, 1, 3, 9].map(rpgNpcCount)).toEqual([2, 2, 3, 4])
    for (const shell of ['quiz-arena', 'mindmaze', 'encyclopedia', 'rpg', 'roleplay']) for (const s of shellSlots(shell, ctx)) expect(s.required, `${shell}/${s.slot}`).toBe(true)
  })

  it('sizes by kind: a background is 16:9, an article picture 4:3, a tile sheet square, a sprite tall; a hotspot picture follows its item', () => {
    expect(artSizes('background')).toEqual({ size: { w: 1664, h: 928 }, fit: { w: 1280, h: 720 } })
    expect(artSizes('illustration').fit).toEqual({ w: 960, h: 720 })
    expect(artSizes('illustration', '16:9').fit).toEqual({ w: 1280, h: 720 })
    expect(artSizes('illustration', '1:1').fit).toEqual({ w: 768, h: 768 })
    expect(artSizes('tileset').fit).toEqual({ w: 512, h: 512 })
    expect(artSizes('sprite').size.h).toBeGreaterThan(artSizes('sprite').size.w)
    const h = hotspotSizes(800, 500)
    expect(h.fit).toEqual({ w: 800, h: 500 })
    expect(h.size.w % 32).toBe(0)
    expect(Math.abs(h.size.w / h.size.h - 800 / 500)).toBeLessThan(0.05)
  })

  it('a prompt is the style words, the subject and the framing; a course can replace the style words', () => {
    const p = composePrompt('background', 'a marble forum at dawn.', 'illustrated')
    expect(p.startsWith(styleWords('illustrated'))).toBe(true)
    expect(p).toMatch(/a marble forum at dawn, wide landscape/)
    expect(composePrompt('sprite', 'a knight', 'pixel', 'watercolour')).toMatch(/^watercolour, a knight, one character/)
  })
})

describe('the art-director contract', () => {
  it('parses an answer, drops nulls, and says in words what is wrong', () => {
    const ok = artPlanSchema.parse({ images: [{ for: 'article', id: 'a-u1-1', prompt: 'a hill', alt: 'A hill', ratio: null, side: null }], notes: null })
    expect(ok.images[0]).toEqual({ for: 'article', id: 'a-u1-1', prompt: 'a hill', alt: 'A hill' })
    const bad = artPlanSchema.safeParse({ images: [{ for: 'poster', prompt: 'x', alt: 'y' }] })
    expect(bad.success).toBe(false)
    expect(JSON.stringify((bad as { error: { issues: unknown[] } }).error.issues)).toMatch(/for is article, item or shell/)
    expect(artPlanSchema.safeParse({ images: [] }).success).toBe(false)
  })

  it('a full plan has no problem; the fallback plan is a full plan', () => {
    expect(checkArtPlan(plan(full()), SRC)).toEqual([])
    const lines = fallbackArtLines(SRC)
    expect(lines.filter((l) => l.for === 'article').map((l) => l.id)).toEqual(['a-u1-1', 'a-u2-1'])
    expect(lines.filter((l) => l.for === 'shell').map((l) => `${l.shell}/${l.slot}`)).toEqual(['quiz-arena/bg-u1', 'quiz-arena/bg-u2', 'quiz-arena/bg-boss', 'rpg/tiles', 'rpg/hero', 'rpg/npc-1', 'rpg/npc-2'])
    expect(lines.find((l) => l.id === 'u2-q2')).toMatchObject({ for: 'item', prompt: expect.stringContaining('Where is Rome?') }) // the hotspot needs its picture
    expect(lines.find((l) => l.slot === 'hero')!.prompt).toMatch(/Livia/) // the story's characters are used
    for (const l of lines) expect(l.prompt.length).toBeGreaterThan(12)
  })

  it('names what is missing: an article, a required slot, a hotspot picture', () => {
    const lines = full().filter((l) => !(l.for === 'article' && l.id === 'a-u2-1') && !(l.slot === 'bg-boss') && l.id !== 'u2-q2')
    const issue = checkArtPlan(plan(lines), SRC).map((p) => p.issue).join('\n')
    expect(issue).toMatch(/an article picture for a-u2-1/)
    expect(issue).toMatch(/the shell image quiz-arena \/ bg-boss/)
    expect(issue).toMatch(/the picture of the hotspot item u2-q2/)
  })

  it('refuses ids and slots that do not exist, duplicates, a picture for a listening item or one that has a picture already, a short prompt and too many item pictures', () => {
    const base = full()
    const problems = (extra: ArtLine[]) => formatProblems(checkArtPlan(plan([...base, ...extra]), SRC))
    expect(problems([{ for: 'article', id: 'nope', prompt: 'a long enough prompt', alt: 'x' }])).toMatch(/nope: no article with this id/)
    expect(problems([{ for: 'item', id: 'nope', prompt: 'a long enough prompt', alt: 'x' }])).toMatch(/no item with this id/)
    expect(problems([{ for: 'item', id: 'u2-q1', prompt: 'a long enough prompt', alt: 'x' }])).toMatch(/a listening item has sound, not a picture/)
    expect(problems([{ for: 'item', id: 'u1-q3', prompt: 'a long enough prompt', alt: 'x' }])).toMatch(/has a picture already/)
    expect(problems([{ for: 'item', id: 'u1-q1', side: 'back', prompt: 'a long enough prompt', alt: 'x' }])).not.toMatch(/back picture/) // a flashcard has a back
    expect(problems([{ for: 'item', id: 'u1-q2', side: 'back', prompt: 'a long enough prompt', alt: 'x' }])).toMatch(/only a flashcard has a back picture/)
    expect(problems([{ for: 'shell', shell: 'quiz-arena', slot: 'bg-u9', prompt: 'a long enough prompt', alt: 'x' }])).toMatch(/quiz-arena\/bg-u9: no such slot.*bg-u1, bg-u2, bg-boss/)
    expect(problems([{ for: 'shell', shell: 'mindmaze', slot: 'room-u1', prompt: 'a long enough prompt', alt: 'x' }])).toMatch(/this shell is not in the course/)
    expect(problems([{ for: 'article', id: 'a-u1-1', prompt: 'a long enough prompt', alt: 'x' }])).toMatch(/planned twice/)
    expect(problems([{ for: 'item', id: 'u1-q1', prompt: 'short', alt: 'x' }])).toMatch(/prompt is too short/)
    const many: ArtSource = { ...SRC, items: Array.from({ length: MAX_ITEM_IMAGES + 1 }, (_, i) => ({ id: `q${i}`, kind: 'flashcard', prompt: 'p', hasPicture: false })) }
    const lines = [...fallbackArtLines(many), ...many.items.map((i): ArtLine => ({ for: 'item', id: i.id, prompt: 'a long enough prompt', alt: 'x' }))]
    expect(formatProblems(checkArtPlan(plan(lines), many))).toMatch(new RegExp(`${MAX_ITEM_IMAGES + 1} item pictures, at most ${MAX_ITEM_IMAGES}`))
  })

  it('an article that has a real picture is not required (and not planned again)', () => {
    const src: ArtSource = { ...SRC, articles: SRC.articles.map((a) => (a.id === 'a-u1-1' ? { ...a, hasPicture: true } : a)) }
    expect(checkArtPlan(plan(full(src)), src)).toEqual([])
    expect(fallbackArtLines(src).some((l) => l.id === 'a-u1-1')).toBe(false)
    expect(formatProblems(checkArtPlan(plan([...full(src), { for: 'article', id: 'a-u1-1', prompt: 'a long enough prompt', alt: 'x' }]), src))).toMatch(/no article with this id/)
  })

  it('the prompt is shown the articles, the items, the slots (REQUIRED marked) and the limits', () => {
    const v = artPromptVars(SRC, media())
    expect(String(v.articles)).toMatch(/- a-u1-1 \(unit u1\): The founding of Rome\./)
    expect(String(v.items)).toMatch(/- u1-q1 \(flashcard, unit u1\): The river of Rome/)
    expect(String(v.items)).not.toMatch(/u1-q3/) // it has a picture
    expect(String(v.items)).not.toMatch(/u2-q1/) // a listening item
    expect(String(v.items)).toMatch(/u2-q2 \(hotspot, unit u2, REQUIRED: a picture 800 by 500/)
    expect(String(v.slots)).toMatch(/- shell rpg, slot tiles \(tileset, REQUIRED\)/)
    expect(String(v.shells)).toBe('quiz-arena, rpg')
    expect(v.max_item_images).toBe(MAX_ITEM_IMAGES)
    expect(String(v.articles)).not.toMatch(/\[f1\]/) // citations are noise for a picture
  })
})

describe('from lines to plan entries', () => {
  it('each line gets its id, kind, style, provider, sizes and a full prompt', () => {
    const entries = resolveArtEntries(full(), SRC, { media: media(), by: 'model' })
    const byId = new Map(entries.map((e) => [e.id, e]))
    expect([...byId.keys()]).toEqual(['img-article-a-u1-1', 'img-article-a-u2-1', 'map-italy', 'img-quiz-arena-bg-u1', 'img-quiz-arena-bg-u2', 'img-quiz-arena-bg-boss', 'img-rpg-tiles', 'img-rpg-hero', 'img-rpg-npc-1', 'img-rpg-npc-2'])
    expect(byId.get('img-article-a-u1-1')).toMatchObject({ kind: 'illustration', style: 'illustrated', provider: 'comfy', target: { type: 'article', article: 'a-u1-1' }, fit: { w: 960, h: 720 }, by: 'model' })
    expect(byId.get('img-quiz-arena-bg-boss')).toMatchObject({ kind: 'background', fit: { w: 1280, h: 720 } })
    expect(byId.get('img-rpg-tiles')).toMatchObject({ kind: 'tileset', style: 'pixel', fit: { w: 512, h: 512 } }) // pixel art whatever the course style
    expect(byId.get('img-rpg-hero')).toMatchObject({ kind: 'sprite', style: 'pixel' })
    // the hotspot keeps the asset id its item names and the size of the item
    expect(byId.get('map-italy')).toMatchObject({ target: { type: 'hotspot', item: 'u2-q2' }, fit: { w: 800, h: 500 }, kind: 'illustration' })
    expect(byId.get('img-article-a-u1-1')!.prompt).toMatch(/^clean flat educational illustration/)
    expect(byId.get('img-rpg-hero')!.prompt).toMatch(/^pixel art/)
  })

  it('the provider follows the course (comfy by default, flow only when asked, hand), and lines the course cannot place are dropped', () => {
    const p = (m: Record<string, unknown>) => resolveArtEntries(full().slice(0, 2), SRC, { media: media(m), by: 'fallback' }).map((e) => e.provider)
    expect(p({})).toEqual(['comfy', 'comfy'])
    expect(p({ art: { provider: 'flow' } })).toEqual(['flow', 'flow'])
    expect(p({ art: { provider: 'hand' } })).toEqual(['hand', 'hand'])
    expect(p({ art: { provider: 'pixel-studio-draw' } })).toEqual(['comfy', 'comfy'])
    const dropped = resolveArtEntries([{ for: 'article', id: 'zzz', prompt: 'a long enough prompt', alt: 'x' }, { for: 'shell', shell: 'rpg', slot: 'nope', prompt: 'a long enough prompt', alt: 'x' }, { for: 'item', id: 'u2-q1', prompt: 'a long enough prompt', alt: 'x' }], SRC, { media: media(), by: 'model' })
    expect(dropped).toEqual([]) // an unknown article or slot, and an item with no place for a picture (a listening item), are dropped (the check refuses them first)
    expect(resolveArtEntries(full().slice(0, 1), SRC, { media: media({ art: { style: 'pixel', stylePrompt: 'chunky pixels' } }), by: 'model' })[0]).toMatchObject({ style: 'pixel', prompt: expect.stringMatching(/^chunky pixels, /) })
  })

  it('the same line twice makes one entry', () => {
    const l = full()[0]!
    expect(resolveArtEntries([l, l], SRC, { media: media(), by: 'model' })).toHaveLength(1)
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

describe('applyMedia: the links in the pack', () => {
  const pack = () => ({
    assets: [{ id: 'own', kind: 'image', file: 'assets/own.svg', alt: 'own.alt' }],
    items: [
      { id: 'q1', kind: 'flashcard' },
      { id: 'q2', kind: 'mcq' },
      { id: 'q3', kind: 'hotspot', asset: 'map-italy' },
      { id: 'q4', kind: 'listening', asset: 'tone' }
    ],
    encyclopedia: { articles: [{ id: 'a1', asset: undefined as string | undefined }] },
    shells: { enabled: ['quiz-arena'], config: { 'quiz-arena': { roundLength: 5 } } as Record<string, Record<string, unknown>> }
  })
  const merge: MediaMerge = {
    assets: [
      { id: 'img-article-a1', kind: 'image', file: 'assets/img-article-a1/v1.webp', alt: 'The founding' },
      { id: 'img-item-q1', kind: 'image', file: 'assets/img-item-q1/v2.webp', alt: 'A river' },
      { id: 'img-item-q1-back', kind: 'image', file: 'assets/img-item-q1-back/placeholder.svg', alt: 'The back', placeholder: true },
      { id: 'img-item-q4', kind: 'image', file: 'assets/img-item-q4/v1.webp', alt: 'must not be linked' },
      { id: 'map-italy', kind: 'image', file: 'assets/map-italy/v1.webp', alt: 'A map of Italy' },
      { id: 'img-quiz-arena-bg-u1', kind: 'image', file: 'assets/img-quiz-arena-bg-u1/v1.webp', alt: 'A forum' },
      { id: 'img-rpg-hero', kind: 'image', file: 'assets/img-rpg-hero/v1.webp', alt: 'The hero' },
      { id: 'img-unplanned', kind: 'image', file: 'assets/img-unplanned/v1.webp', alt: 'No target' }
    ],
    targets: {
      'img-article-a1': { type: 'article', article: 'a1' },
      'img-item-q1': { type: 'item', item: 'q1' },
      'img-item-q1-back': { type: 'item', item: 'q1', side: 'back' },
      'img-item-q4': { type: 'item', item: 'q4' },
      'map-italy': { type: 'hotspot', item: 'q3' },
      'img-quiz-arena-bg-u1': { type: 'shell', shell: 'quiz-arena', slot: 'bg-u1' },
      'img-rpg-hero': { type: 'shell', shell: 'rpg', slot: 'hero' },
      'img-gone': { type: 'article', article: 'a1' } // an asset with no file: no link
    }
  }

  it('adds the assets and their alt keys, links articles, items (front and back), the hotspot and the art of every shell, and keeps what was there', () => {
    const p = pack()
    const catalog = { strings: {} as Record<string, string> }
    const r = applyMedia(p as never, catalog, merge)
    expect(p.assets.map((a) => a.id)).toEqual(['own', ...merge.assets.map((a) => a.id)])
    expect(p.assets.find((a) => a.id === 'img-article-a1')).toEqual({ id: 'img-article-a1', kind: 'image', file: 'assets/img-article-a1/v1.webp', alt: 'asset.img-article-a1.alt' })
    expect(catalog.strings['asset.img-article-a1.alt']).toBe('The founding')
    expect(catalog.strings['asset.img-item-q1-back.alt']).toBe('The back')
    expect(p.encyclopedia.articles[0]!.asset).toBe('img-article-a1')
    expect(p.items[0]).toMatchObject({ asset: 'img-item-q1', backAsset: 'img-item-q1-back' })
    expect(p.items[1]).toEqual({ id: 'q2', kind: 'mcq' })
    expect(p.items[2]).toMatchObject({ asset: 'map-italy' }) // a hotspot keeps the asset it names
    expect(p.items[3]).toMatchObject({ asset: 'tone' }) // a listening item's asset is audio: never replaced by a picture
    expect(p.shells.config['quiz-arena']).toEqual({ roundLength: 5, art: { 'bg-u1': 'img-quiz-arena-bg-u1' } })
    expect(p.shells.config.rpg).toEqual({ art: { hero: 'img-rpg-hero' } }) // a shell the pack does not have yet still gets its art recorded
    expect(r).toEqual({ assets: 8, links: 6 })
  })

  it('is idempotent and replaces an asset that is there (a new version, a placeholder replaced)', () => {
    const p = pack()
    const catalog = { strings: {} as Record<string, string> }
    applyMedia(p as never, catalog, merge)
    const once = JSON.stringify(p)
    applyMedia(p as never, catalog, merge)
    expect(JSON.stringify(p)).toBe(once)
    applyMedia(p as never, catalog, { ...merge, assets: merge.assets.map((a) => (a.id === 'img-item-q1-back' ? { ...a, file: 'assets/img-item-q1-back/v1.webp', placeholder: undefined } : a)) })
    expect(p.assets.find((a) => a.id === 'img-item-q1-back')!.file).toBe('assets/img-item-q1-back/v1.webp')
    expect(p.assets.filter((a) => a.id === 'img-item-q1-back')).toHaveLength(1)
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

  it('an answer with problems is sent back once, in words, and the repaired answer is the plan', async () => {
    const seen: string[] = []
    let calls = 0
    env.mock.on({ role: 'art-director' }, (req) => {
      seen.push(req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n'))
      return plan1(lines(++calls === 1))
    })
    const r = await planIt('plan-repair')
    expect(calls).toBe(2)
    expect(seen[1]).toMatch(/no-such-article: no article with this id/)
    expect(seen[1]).toMatch(/missing: an article picture for a-u1-1; an article picture for a-u2-1/)
    expect(r.plan.source).toBe('model')
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

  it('the second run of the plan keeps the ids and the versions already made', async () => {
    env.mock.on({ role: 'art-director' }, () => plan1(lines()))
    const first = await planIt('plan-twice')
    await env.engine.edu.media.mutate('plan-twice', (m) => ({ assets: m.assets.map((a) => (a.id === 'img-article-a-u1-1' ? { ...a, versions: [{ n: 1, file: 'v1.webp', createdAt: 'x', seed: 1, engine: 'qwen-image-2.1', prompt: a.prompt }], selected: 1 } : a)) }))
    const second = await planIt('plan-twice')
    expect(second.plan.entries.map((e) => e.id)).toEqual(first.plan.entries.map((e) => e.id))
    expect(second.added).toEqual([])
    expect(second.kept).toHaveLength(10)
    expect((await env.engine.edu.media.loadManifest('plan-twice')).assets.find((a) => a.id === 'img-article-a-u1-1')).toMatchObject({ selected: 1, versions: [{ n: 1 }] })
  })
})
