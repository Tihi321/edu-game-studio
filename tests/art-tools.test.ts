import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildTools, callTool, toolList } from '../src/engine/mcp/tools'
import { GUIDE } from '../src/engine/mcp/server'
import type { ArtPlanFile } from '../src/shared/art'
import type { AssetManifest } from '../src/shared/media'
import { makeEduEnv, waitIdle } from './edu-helpers'
import type { EduEnv } from './edu-helpers'

/**
 * The media tools on a hand-made course (no pipeline run): plan, generate, list, set, select, replace, lock and the media settings. They write the
 * manifest and re-link the pack, so a built course picks the change up with the next edu_build. Fakes only; the autostart is off.
 */

const ASSET_TOOLS = ['edu_asset_list', 'edu_asset_plan', 'edu_asset_generate', 'edu_asset_set', 'edu_asset_select', 'edu_asset_replace', 'edu_asset_lock', 'edu_media_settings']

let env: EduEnv
beforeEach(async () => {
  env = await makeEduEnv({ studios: true })
})
afterEach(async () => {
  await env.cleanup()
})

const tools = () => buildTools(env.engine.edu, { control: env.engine.mcpControl(), clientQueue: env.engine.clientQueue })
async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await callTool(tools(), name, args)
  return { ok: !r.isError, text: r.content[0].text, // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a tool result is any JSON; the tests read it loosely
    data: (r.isError ? { error: r.content[0].text } : r.structuredContent) as Record<string, any> }
}
const must = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await call(name, args)
  expect(r.ok, `${name}: ${r.text}`).toBe(true)
  return r.data
}
const root = (slug: string, ...p: string[]) => path.join(env.dir, 'courses', slug, ...p)
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const manifest = (slug: string) => json<AssetManifest>(root(slug, 'course', 'assets.json'))
const pack = (slug: string) => json<{ assets: { id: string; file: string; alt: string }[]; encyclopedia: { articles: { id: string; asset?: string }[] }; items: { id: string; asset?: string }[]; shells: { config: Record<string, Record<string, unknown>> } }>(root(slug, 'course', 'pack.json'))

/** A hand-made course with an article, a hotspot item (800 x 500, two regions) whose picture does not exist yet, and a flashcard. */
async function handCourse(slug: string): Promise<void> {
  await must('edu_create_course', { slug, title: 'Italy', languages: ['en'], sourceLang: 'en', subject: 'Italy', audience: 'teenagers' })
  await must('edu_course_edit', {
    slug,
    patch: {
      encyclopedia: { articles: [{ id: 'a1', title: 'art.a1.title', body: 'art.a1.body', unit: 'u1' }] },
      assets: [{ id: 'map-italy', kind: 'image', file: 'assets/map.svg', alt: 'map.alt' }]
    },
    text: { en: { strings: { 'art.a1.title': 'The boot of Europe', 'art.a1.body': 'Italy is shaped like a boot.', 'map.alt': 'A map of Italy' } } }
  })
  await must('edu_item_add', {
    slug,
    item: {
      id: 'q1',
      kind: 'hotspot',
      objective: 'u1-o1',
      prompt: 'q1.prompt',
      explanation: 'q1.expl',
      asset: 'map-italy',
      width: 800,
      height: 500,
      regions: [
        { id: 'r1', label: 'q1.r1', shape: { type: 'rect', x: 100, y: 100, w: 200, h: 150 } },
        { id: 'r2', label: 'q1.r2', shape: { type: 'circle', cx: 600, cy: 300, r: 80 } }
      ],
      answer: 'r1'
    },
    text: { en: { strings: { 'q1.prompt': 'Where is Rome?', 'q1.expl': 'In the middle.', 'q1.r1': 'The middle', 'q1.r2': 'The east' } } }
  })
  await must('edu_item_add', { slug, item: { id: 'q2', kind: 'flashcard', objective: 'u1-o1', prompt: 'q2.prompt', explanation: 'q2.expl', back: 'q2.back' }, text: { en: { strings: { 'q2.prompt': 'The capital', 'q2.expl': 'Rome.', 'q2.back': 'Rome' } } } })
}
const imageRequests = () => env.comfy.requests.filter((r) => !(r.prompt ?? '').startsWith('Remove the background'))

describe('the media tools exist and are documented', () => {
  it('are listed with schemas, named edu_*, and described in the MCP guide and the studios status', async () => {
    const names = toolList(tools()).map((t) => t.name)
    for (const t of ASSET_TOOLS) {
      expect(names, t).toContain(t)
      expect(GUIDE, t).toContain(t)
    }
    const s = await must('edu_studios_status')
    expect(s.comfy).toMatch(/edu_comfy_status/)
  })
})

describe('plan, generate, edit: a hand-made course', () => {
  it('edu_asset_plan {fallback: true} plans from the course text (an article picture, the quiz arena backdrops, the hotspot picture); edu_asset_generate makes them and links the pack; the lint is clean', async () => {
    await handCourse('hand')
    const planned = await must('edu_asset_plan', { slug: 'hand', fallback: true })
    expect(planned).toMatchObject({ source: 'fallback', planned: 4, packLinked: true })
    expect(planned.added.sort()).toEqual(['img-article-a1', 'img-quiz-arena-bg-boss', 'img-quiz-arena-bg-u1', 'map-italy'])
    // nothing is made yet: the plan is in the manifest, the pack is as it was
    expect((await must('edu_asset_list', { slug: 'hand' })).summary).toMatchObject({ images: 4, made: 0, placeholders: 0 })
    expect((await pack('hand')).assets.map((a) => a.id)).toEqual(['map-italy'])
    const none = await call('edu_asset_generate', { slug: 'hand', ids: ['nope'] })
    expect(none.ok).toBe(true) // an id that is not there is simply nothing to make

    const queued = await must('edu_asset_generate', { slug: 'hand' })
    expect(queued.jobs).toHaveLength(1)
    expect(queued.jobs[0]).toMatch(/^hand--asset_generate--q/)
    await waitIdle(env, 'hand', 30_000)
    expect(imageRequests()).toHaveLength(4)
    expect(env.flow.calls).toEqual([])
    const list = await must('edu_asset_list', { slug: 'hand' })
    expect(list.summary).toMatchObject({ images: 4, made: 4, placeholders: 0, rejected: 0 })
    expect(list.assets.map((a: { id: string; selected: number }) => [a.id, a.selected])).toEqual(expect.arrayContaining([['img-article-a1', 1], ['map-italy', 1]]))
    expect(list.assets.find((a: { id: string }) => a.id === 'img-article-a1').target).toEqual({ type: 'article', article: 'a1' })
    expect(list.settings).toMatchObject({ enabled: true, style: 'illustrated' })

    // the pack: the article and the shell art are linked, the hotspot keeps its asset id but now has a real picture
    const p = await pack('hand')
    expect(p.encyclopedia.articles[0]!.asset).toBe('img-article-a1')
    expect(p.assets.find((a) => a.id === 'map-italy')).toEqual({ id: 'map-italy', kind: 'image', file: 'assets/map-italy/v1.webp', alt: 'asset.map-italy.alt' })
    expect(p.shells.config['quiz-arena']).toMatchObject({ art: { 'bg-u1': 'img-quiz-arena-bg-u1', 'bg-boss': 'img-quiz-arena-bg-boss' } })
    expect(p.items.find((i) => i.id === 'q1')!.asset).toBe('map-italy')

    // the hotspot picture is fitted to its item (800 x 500) with the regions drawn faintly over it by code
    const raw = await sharp(root('hand', 'course', 'assets', 'map-italy', 'v1.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(raw.info).toMatchObject({ width: 800, height: 500 })
    const red = (x: number, y: number) => raw.data[(y * 800 + x) * 4]!
    const avg = (x0: number, x1: number, y: number) => Array.from({ length: x1 - x0 }, (_, i) => red(x0 + i, y)).reduce((s, v) => s + v, 0) / (x1 - x0)
    expect(avg(110, 290, 100)).toBeGreaterThan(avg(320, 500, 100) + 15) // the top edge of the rectangle is lighter than the same row outside the regions (the fake picture is one colour)

    expect((await must('edu_validate', { slug: 'hand' })).ok).toBe(true)
    await must('edu_build', { slug: 'hand' })
    const lint = await must('edu_lint', { slug: 'hand' })
    expect(lint).toMatchObject({ ok: true, errors: 0 })
    expect(lint.problems.filter((x: { code: string }) => x.code === 'PLACEHOLDER_ASSET')).toEqual([])
    expect(existsSync(root('hand', 'build', 'assets', 'map-italy', 'v1.webp'))).toBe(true)
  })

  it('edu_asset_plan with no fallback queues the art-director (a model job): its plan is checked, written and linked, and a hotspot item gets its picture too', async () => {
    await handCourse('hand-model')
    let calls = 0
    env.mock.on({ role: 'art-director' }, () => {
      calls++
      return JSON.stringify({
        images: [
          { for: 'article', id: 'a1', prompt: 'A map-like picture of a boot-shaped peninsula in a blue sea', alt: 'Italy shaped like a boot' },
          { for: 'item', id: 'q1', prompt: 'An illustrated map of Italy with a big city in the middle and one in the east', alt: 'A map of Italy' },
          { for: 'shell', shell: 'quiz-arena', slot: 'bg-u1', prompt: 'An empty sunny Roman street', alt: 'A Roman street' },
          { for: 'shell', shell: 'quiz-arena', slot: 'bg-boss', prompt: 'An empty arena under a dark sky', alt: 'An arena' }
        ],
        notes: 'Warm colours.'
      })
    })
    const r = await must('edu_asset_plan', { slug: 'hand-model' })
    expect(r.jobs[0]).toMatch(/^hand-model--asset_plan--q/)
    await waitIdle(env, 'hand-model', 30_000)
    expect(calls).toBe(1)
    const plan = await json<ArtPlanFile>(root('hand-model', 'pipeline', 'art.json'))
    expect(plan.source).toBe('model')
    expect(plan.entries.map((e) => e.id).sort()).toEqual(['img-article-a1', 'img-quiz-arena-bg-boss', 'img-quiz-arena-bg-u1', 'map-italy'])
    expect(plan.entries.find((e) => e.id === 'map-italy')).toMatchObject({ target: { type: 'hotspot', item: 'q1' }, fit: { w: 800, h: 500 } })
    const done = await env.engine.jobs.list('done')
    expect(done.find((j) => j.id === r.jobs[0])!.data).toMatchObject({ task: 'asset_plan', role: 'art-director' })
  })

  it('edu_asset_set keeps a prompt by hand through a new plan; edu_asset_generate {ids, force} makes it again with that prompt; edu_asset_select goes back to a version; edu_asset_lock stops the generator', async () => {
    await handCourse('hand-set')
    await must('edu_asset_plan', { slug: 'hand-set', fallback: true })
    await must('edu_asset_generate', { slug: 'hand-set' })
    await waitIdle(env, 'hand-set', 30_000)
    const id = 'img-article-a1'
    const set = await must('edu_asset_set', { slug: 'hand-set', id, prompt: 'a boot made of pasta, flat colours' })
    expect(set.asset).toMatchObject({ id, prompt: 'a boot made of pasta, flat colours' })
    expect((await manifest('hand-set')).assets.find((a) => a.id === id)).toMatchObject({ prompt: 'a boot made of pasta, flat colours', promptByHand: true })
    await must('edu_asset_plan', { slug: 'hand-set', fallback: true }) // the plan runs again: the prompt set by hand stays, the version stays
    expect((await manifest('hand-set')).assets.find((a) => a.id === id)).toMatchObject({ prompt: 'a boot made of pasta, flat colours', selected: 1 })

    const before = imageRequests().length
    await must('edu_asset_generate', { slug: 'hand-set', ids: [id], force: true })
    await waitIdle(env, 'hand-set', 30_000)
    expect(imageRequests()).toHaveLength(before + 1)
    expect(imageRequests().at(-1)!.prompt).toBe('a boot made of pasta, flat colours')
    let a = (await manifest('hand-set')).assets.find((x) => x.id === id)!
    expect(a).toMatchObject({ selected: 2 })
    expect(a.versions.map((v) => v.n)).toEqual([1, 2])
    expect((await pack('hand-set')).assets.find((x) => x.id === id)!.file).toBe(`assets/${id}/v2.webp`)

    const sel = await must('edu_asset_select', { slug: 'hand-set', id, version: 1 })
    expect(sel).toMatchObject({ asset: { selected: 1 }, packLinked: true })
    expect((await pack('hand-set')).assets.find((x) => x.id === id)!.file).toBe(`assets/${id}/v1.webp`)
    expect((await call('edu_asset_select', { slug: 'hand-set', id, version: 9 })).text).toMatch(/no version 9/)

    await must('edu_asset_lock', { slug: 'hand-set', id, locked: true })
    const n = imageRequests().length
    await must('edu_asset_generate', { slug: 'hand-set', ids: [id], force: true })
    await waitIdle(env, 'hand-set', 30_000)
    expect(imageRequests()).toHaveLength(n) // locked: never made again, not even with force
    await must('edu_asset_lock', { slug: 'hand-set', id, locked: false })
    a = (await manifest('hand-set')).assets.find((x) => x.id === id)!
    expect(a.locked).toBe(false)
  })

  it('edu_asset_set provider: flow makes that one asset through Google Flow while the course uses ComfyUI; the course setting flow makes all of them', async () => {
    await handCourse('hand-flow')
    await must('edu_asset_plan', { slug: 'hand-flow', fallback: true })
    await must('edu_asset_generate', { slug: 'hand-flow' })
    await waitIdle(env, 'hand-flow', 30_000)
    expect(env.flow.calls).toEqual([])
    const id = 'img-quiz-arena-bg-u1'
    await must('edu_asset_set', { slug: 'hand-flow', id, provider: 'flow' })
    await must('edu_asset_generate', { slug: 'hand-flow', ids: [id], force: true })
    await waitIdle(env, 'hand-flow', 30_000)
    expect(env.flow.calls.filter((c) => c.tool === 'flow_generate')).toHaveLength(1)
    expect((await manifest('hand-flow')).assets.find((a) => a.id === id)!.versions.at(-1)).toMatchObject({ engine: 'flow', remote: { provider: 'flow' } })
    await must('edu_asset_set', { slug: 'hand-flow', id, provider: 'comfy' })
    expect((await manifest('hand-flow')).assets.find((a) => a.id === id)!.engine).toBe('qwen-image-2.1')

    // the media settings of the course: read, change (a merge patch), refuse what is invalid
    expect((await must('edu_media_settings', { slug: 'hand-flow' })).media.art).toMatchObject({ enabled: true, review: true })
    const set = await must('edu_media_settings', { slug: 'hand-flow', set: { art: { provider: 'flow', review: false } } })
    expect(set.media.art).toMatchObject({ provider: 'flow', review: false })
    expect((await env.engine.edu.getCourseMeta('hand-flow'))!.data).toMatchObject({ media: { art: { provider: 'flow', review: false } } })
    await must('edu_asset_generate', { slug: 'hand-flow', force: true })
    await waitIdle(env, 'hand-flow', 30_000)
    expect(env.flow.calls.filter((c) => c.tool === 'flow_generate')).toHaveLength(1 + 3) // every picture again, now through Flow, except the one that says provider: comfy itself
    expect((await call('edu_media_settings', { slug: 'hand-flow', set: { art: { provider: 'midjourney' } } })).text).toMatch(/media\.art\.provider/)
    expect((await must('edu_media_settings', { slug: 'hand-flow', set: { art: { provider: null } } })).media.art.provider).toBeUndefined() // null removes the key
  })

  it('edu_asset_replace takes a file you made (custom, locked, the pack re-linked) and refuses what cannot be the asset', async () => {
    await handCourse('hand-replace')
    await must('edu_asset_plan', { slug: 'hand-replace', fallback: true })
    const mine = path.join(env.dir, 'mine.png')
    await writeFile(mine, await sharp({ create: { width: 64, height: 48, channels: 3, background: '#aa4400' } }).png().toBuffer())
    const r = await must('edu_asset_replace', { slug: 'hand-replace', id: 'img-article-a1', file: mine })
    expect(r.asset).toMatchObject({ source: 'custom', locked: true, selected: null, file: 'assets/img-article-a1/custom.png' })
    expect((await pack('hand-replace')).encyclopedia.articles[0]!.asset).toBe('img-article-a1')
    // generating does not touch it
    await must('edu_asset_generate', { slug: 'hand-replace' })
    await waitIdle(env, 'hand-replace', 30_000)
    expect(imageRequests()).toHaveLength(3) // the other three pictures
    const wav = path.join(env.dir, 'a.wav')
    await writeFile(wav, 'RIFF')
    expect((await call('edu_asset_replace', { slug: 'hand-replace', id: 'map-italy', file: wav })).text).toMatch(/is an image: use a/)
    expect((await call('edu_asset_replace', { slug: 'hand-replace', id: 'map-italy', file: path.join(env.dir, 'none.png') })).text).toMatch(/is not a file/)
    expect((await call('edu_asset_replace', { slug: 'hand-replace', id: 'nope', file: mine })).text).toMatch(/no asset "nope"/)
  })

  it('refuses what cannot be done, with a message that says what to do', async () => {
    await handCourse('hand-err')
    expect((await call('edu_asset_generate', { slug: 'hand-err' })).text).toMatch(/edu_asset_plan \{slug\} first/)
    expect((await call('edu_asset_plan', { slug: 'nope', fallback: true })).text).toMatch(/no course "nope"/)
    await must('edu_asset_plan', { slug: 'hand-err', fallback: true })
    expect((await call('edu_asset_set', { slug: 'hand-err', id: 'img-article-a1' })).text).toMatch(/give prompt, negative or provider/)
    expect((await call('edu_asset_set', { slug: 'hand-err', id: 'img-nope', prompt: 'x' })).text).toMatch(/no asset "img-nope" in the manifest of "hand-err"/)
    expect((await call('edu_asset_lock', { slug: 'hand-err', id: 'img-nope', locked: true })).ok).toBe(false)
    await must('edu_media_settings', { slug: 'hand-err', set: { art: { enabled: false } } })
    expect((await call('edu_asset_plan', { slug: 'hand-err', fallback: true })).text).toMatch(/media\.art\.enabled is false/)
    expect((await call('edu_asset_generate', { slug: 'hand-err' })).text).toMatch(/media\.art\.enabled is false/)
  })
})

describe('the generators are started on the job path only', () => {
  it('the generation job asks for ComfyUI and the studios with autoStart; the status and list tools never do', async () => {
    await handCourse('hand-start')
    const asked: string[] = []
    const svc = env.engine.edu
    const comfy = svc.comfy.bind(svc)
    const studios = svc.studios.bind(svc)
    svc.comfy = async (o) => (asked.push(`comfy:${o?.autoStart === true}`), comfy(o))
    svc.studios = async (o) => (asked.push(`studios:${o?.autoStart === true}`), studios(o))
    await must('edu_asset_plan', { slug: 'hand-start', fallback: true })
    await must('edu_asset_list', { slug: 'hand-start' })
    await must('edu_studios_status')
    expect(asked.filter((a) => a.endsWith(':true'))).toEqual([]) // planning, listing and the status checks never start anything
    await must('edu_asset_generate', { slug: 'hand-start' })
    await waitIdle(env, 'hand-start', 30_000)
    expect(asked).toEqual(expect.arrayContaining(['comfy:true', 'studios:true']))
  })
})
