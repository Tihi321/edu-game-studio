import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { pipelineJobId } from '../src/engine/edu/pipeline'
import type { ArtPlanFile } from '../src/shared/art'
import type { AssetManifest } from '../src/shared/media'
import { validateCourse } from '../src/shared/edu'
import { waitIdle } from './edu-helpers'
import { BRIEF, courseFile, json, makePipelineEnv, pf, pipelineOf, run, SLUG, statusOf, toolsOf } from './pipeline-helpers'
import type { PipelineEnv } from './pipeline-helpers'

/**
 * Art in the pipeline (EGS-15), end to end on the mock team with the fakes of ComfyUI, Pixel Studio and Google Flow: the art-director plans, the
 * generators make the pictures, the art-critic reviews them, the pack carries them with stable ids, the build has the files and the lint is clean.
 * No test touches a real provider: the data folder's autostart is off.
 */

/** The art tests are about pictures: their briefs switch the music off (tests/music-pipeline.test.ts has the music, and one run with both). */
const NO_MUSIC = { enabled: false }
const BRIEF_RPG = { ...BRIEF, shells: ['quiz-arena', 'rpg'], media: { music: NO_MUSIC } }

interface Pack {
  assets: { id: string; kind: string; file: string; alt: string }[]
  items: { id: string; kind: string; asset?: string; backAsset?: string }[]
  encyclopedia: { articles: { id: string; asset?: string }[] }
  shells: { enabled: string[]; config: Record<string, Record<string, unknown>> }
}
const packOf = (env: PipelineEnv) => json<Pack>(courseFile(env, SLUG, 'course', 'pack.json'))
const manifestOf = (env: PipelineEnv) => json<AssetManifest>(courseFile(env, SLUG, 'course', 'assets.json'))
const planOf = (env: PipelineEnv) => json<ArtPlanFile>(pf(env, 'art.json'))
const lintOf = async (env: PipelineEnv, rebuild = false) => (await toolsOf(env).call('edu_lint', { slug: SLUG, rebuild })).data as { ok: boolean; errors: number; warnings: number; problems: { code: string; severity: string; path: string; message: string }[] }
const imageRequests = (env: PipelineEnv) => env.comfy.requests.filter((r) => !(r.prompt ?? '').startsWith('Remove the background'))

describe('the whole run with art: every planned image is in the pack and the build', () => {
  it('quiz arena and rpg: published, art.json has every picture, the pack links them, the build has the files, the lint is clean, Flow was never called', async () => {
    const env = await makePipelineEnv()
    try {
      const { failed } = await run(env, BRIEF_RPG)
      expect(failed).toEqual([])
      const p = await pipelineOf(env)
      expect(p, JSON.stringify(p.blockedBy ?? p.failed)).toMatchObject({ stage: 'published' })
      expect(statusOf(p, 'art_plan:all')).toBe('done')
      expect(statusOf(p, 'art_generate:all')).toBe('done')
      expect(p.steps.find((s) => s.step === 'art_review:all')).toMatchObject({ status: 'skipped', note: expect.stringMatching(/no model with vision/) }) // the mock model has no vision
      expect(env.author.count('art-director/plan')).toBe(1)

      // the plan: an article picture each, the quiz arena backdrops (a unit each and the boss), the rpg tiles, hero and NPCs, one question picture
      const plan = await planOf(env)
      expect(plan).toMatchObject({ source: 'model', style: 'illustrated' })
      const ids = plan.entries.map((e) => e.id)
      expect(ids.filter((i) => i.startsWith('img-article-'))).toHaveLength(2)
      for (const id of ['img-quiz-arena-bg-u1', 'img-quiz-arena-bg-u2', 'img-quiz-arena-bg-boss', 'img-rpg-tiles', 'img-rpg-hero', 'img-rpg-npc-1', 'img-rpg-npc-2']) expect(ids, id).toContain(id)
      expect(ids.filter((i) => i.startsWith('img-item-'))).toHaveLength(1)

      // the pack: every planned image is an asset with an alt text key; the links are set
      const pack = await packOf(env)
      expect(pack.assets.map((a) => a.id).sort()).toEqual([...ids].sort())
      for (const a of pack.assets) {
        expect(a).toMatchObject({ kind: 'image', alt: `asset.${a.id}.alt`, file: expect.stringMatching(new RegExp(`^assets/${a.id}/v1\\.webp$`)) })
      }
      const catalog = await json<{ strings: Record<string, string> }>(courseFile(env, SLUG, 'course', 'text', 'en.json'))
      for (const a of pack.assets) expect(catalog.strings[a.alt], a.alt).toBeTruthy()
      expect(pack.encyclopedia.articles.map((a) => a.asset)).toEqual(['img-article-a-u1-1', 'img-article-a-u2-1'])
      const withPicture = pack.items.find((i) => i.asset === ids.find((x) => x.startsWith('img-item-')))
      expect(withPicture?.id).toBe(ids.find((x) => x.startsWith('img-item-'))!.replace('img-item-', ''))
      expect(pack.shells.config['quiz-arena']).toMatchObject({ roundLength: 5, art: { 'bg-u1': 'img-quiz-arena-bg-u1', 'bg-u2': 'img-quiz-arena-bg-u2', 'bg-boss': 'img-quiz-arena-bg-boss' } })
      expect(pack.shells.config.rpg).toEqual({ tileset: 'img-rpg-tiles', sprites: { hero: 'img-rpg-hero', npc: 'img-rpg-npc-1' } }) // the rpg shell plays from its automatic layout in its own skin fields
      expect(((pack as unknown as { extensions: { art?: unknown } }).extensions).art).toEqual({ rpg: { 'npc-2': 'img-rpg-npc-2' } }) // a slot the section has no field for
      expect(validateCourse(pack, { en: { schema: 1, lang: 'en', ...catalog } }).problems).toEqual([])

      // the files: in the course (assets/<id>/v1.webp), in the build, at the planned sizes; the manifest says what made them
      const manifest = await manifestOf(env)
      expect(manifest.assets).toHaveLength(ids.length)
      for (const a of manifest.assets) {
        expect(a).toMatchObject({ selected: 1, source: 'generated', locked: false })
        expect(existsSync(courseFile(env, SLUG, 'course', 'assets', a.id, 'v1.webp')), a.id).toBe(true)
        expect(existsSync(courseFile(env, SLUG, 'build', 'assets', a.id, 'v1.webp')), `build ${a.id}`).toBe(true)
      }
      const dims = async (id: string) => sharp(await readFile(courseFile(env, SLUG, 'build', 'assets', id, 'v1.webp'))).metadata()
      expect(await dims('img-quiz-arena-bg-u1')).toMatchObject({ width: 1280, height: 720 })
      expect(await dims('img-article-a-u1-1')).toMatchObject({ width: 960, height: 720 })
      expect(await dims('img-rpg-tiles')).toMatchObject({ width: 512, height: 512 })
      expect((await dims('img-rpg-hero')).height! % 6).toBe(0)
      expect(manifest.assets.find((a) => a.id === 'img-rpg-tiles')!.versions[0]).toMatchObject({ nativeFile: 'v1.px.png' }) // Pixel Studio made the pixel art
      const game = await json<{ assets: Record<string, string> }>(courseFile(env, SLUG, 'build', 'game-data.json'))
      expect(Object.keys(game.assets).sort()).toEqual([...ids].sort())

      // the generators: ComfyUI for every picture, Pixel Studio for the tile set and the three sprites, Flow never
      expect(imageRequests(env)).toHaveLength(ids.length)
      expect(env.pixel.calls.filter((c) => c.tool === 'import_image')).toHaveLength(4)
      expect(env.flow.calls).toEqual([])

      // the lint: no error and no placeholder
      const lint = await lintOf(env)
      expect(lint).toMatchObject({ ok: true, errors: 0 })
      expect(lint.problems.filter((x) => x.code === 'PLACEHOLDER_ASSET')).toEqual([])
      expect(lint.problems.filter((x) => x.code === 'ASSET_MISSING')).toEqual([])
      expect(await json(pf(env, 'lint.json'))).toMatchObject({ ok: true, errors: 0 })
      // edu_status carries the media summary
      const st = (await toolsOf(env).call('edu_status', { slug: SLUG })).data as { media: Record<string, unknown> }
      expect(st.media).toMatchObject({ images: ids.length, made: ids.length, placeholders: 0, rejected: 0 })
    } finally {
      await env.cleanup()
    }
  }, 120_000)

  it('restart from: art makes run 2 with a new art_plan and keeps the versions already made (nothing is made again); the earlier stages are kept', async () => {
    const env = await makePipelineEnv()
    try {
      await run(env, BRIEF_RPG)
      expect((await pipelineOf(env)).stage).toBe('published')
      const made = imageRequests(env).length
      const before = await manifestOf(env)
      const { call } = toolsOf(env)
      const r = await call('edu_run_pipeline', { slug: SLUG, restart: true, from: 'art' })
      expect(r.ok, r.text).toBe(true)
      expect(r.data.run).toBe(2)
      await waitIdle(env, SLUG, 60_000)
      const p = await pipelineOf(env)
      expect(p, JSON.stringify(p.blockedBy ?? p.failed)).toMatchObject({ run: 2, stage: 'published' })
      expect(p.steps.find((s) => s.step === 'art_plan:all')!.job).toBe(pipelineJobId(SLUG, 2, 'art_plan', null))
      expect(p.steps.find((s) => s.step === 'art_generate:all')!.job).toBe(pipelineJobId(SLUG, 2, 'art_generate', null))
      expect(p.steps.find((s) => s.step === 'curriculum:all')!.job).toBe(pipelineJobId(SLUG, 1, 'curriculum', null)) // before the stage: kept
      expect(env.author.count('art-director/plan')).toBe(2)
      expect(p.steps.find((s) => s.step === 'art_generate:all')!.note).toMatch(/0 picture\(s\) made.*already there/)
      expect(imageRequests(env)).toHaveLength(made) // the versions made in run 1 are used: no image is made again
      expect(await manifestOf(env)).toEqual(before)
      expect((await lintOf(env)).errors).toBe(0)
    } finally {
      await env.cleanup()
    }
  }, 150_000)

  it('restart from an earlier stage clears the art plan and plans again, with the same ids', async () => {
    const env = await makePipelineEnv()
    try {
      await run(env, BRIEF_RPG)
      const first = (await planOf(env)).entries.map((e) => e.id)
      await toolsOf(env).call('edu_run_pipeline', { slug: SLUG, restart: true, from: 'design' })
      await waitIdle(env, SLUG, 60_000)
      expect((await pipelineOf(env)).stage).toBe('published')
      expect((await planOf(env)).entries.map((e) => e.id)).toEqual(first)
    } finally {
      await env.cleanup()
    }
  }, 150_000)

  it('the course settings can switch the art off: the steps are skipped, no picture, no placeholder, and the course still publishes', async () => {
    const env = await makePipelineEnv()
    try {
      await run(env, { ...BRIEF, media: { art: { enabled: false }, music: NO_MUSIC } })
      const p = await pipelineOf(env)
      expect(p.stage).toBe('published')
      for (const s of ['art_plan:all', 'art_generate:all', 'art_review:all']) expect(p.steps.find((x) => x.step === s)).toMatchObject({ status: 'skipped', note: expect.stringMatching(/media\.art\.enabled is false/) })
      expect((await packOf(env)).assets).toEqual([])
      expect(env.comfy.requests).toHaveLength(0)
      expect(env.author.count('art-director')).toBe(0)
      expect(existsSync(courseFile(env, SLUG, 'course', 'assets.json'))).toBe(false)
    } finally {
      await env.cleanup()
    }
  }, 120_000)

  it('the media block of the brief is written to course.md', async () => {
    const env = await makePipelineEnv()
    try {
      const made = await toolsOf(env).call('edu_create_course', { brief: { ...BRIEF, media: { art: { style: 'pixel', review: false } } } })
      expect(made.ok, made.text).toBe(true)
      expect((await env.engine.edu.getCourseMeta(SLUG))!.data).toMatchObject({ media: { art: { style: 'pixel', review: false } } })
      const media = await env.engine.edu.media.settings(SLUG)
      expect(media.art).toMatchObject({ style: 'pixel', review: false, enabled: true, generator: 'qwen-image-2.1' })
      const bad = await toolsOf(env).call('edu_create_course', { brief: { ...BRIEF, topic: 'Another topic', media: { art: { provider: 'midjourney' } } } })
      expect(bad.ok).toBe(false)
      expect(bad.text).toMatch(/provider/)
    } finally {
      await env.cleanup()
    }
  }, 60_000)
})

describe('the art-director gives no usable plan', () => {
  it('a plan that needs the repair round still publishes', async () => {
    const env = await makePipelineEnv({ artPlan: 'repair' })
    try {
      await run(env, BRIEF_RPG)
      expect((await pipelineOf(env)).stage).toBe('published')
      expect(env.author.count('art-director/plan')).toBe(2)
      expect((await planOf(env)).source).toBe('model')
    } finally {
      await env.cleanup()
    }
  }, 120_000)

  it('a plan that stays unusable is replaced by the deterministic plan from the course text: the step never blocks, every picture is there', async () => {
    const env = await makePipelineEnv({ artPlan: 'unusable' })
    try {
      await run(env, BRIEF_RPG)
      const p = await pipelineOf(env)
      expect(p.stage).toBe('published')
      expect(p.steps.find((s) => s.step === 'art_plan:all')!.note).toMatch(/from the course text/)
      const plan = await planOf(env)
      expect(plan).toMatchObject({ source: 'fallback', note: expect.stringMatching(/no usable answer/) })
      expect(plan.entries.every((e) => e.by === 'fallback')).toBe(true)
      expect(plan.entries.map((e) => e.id)).toEqual(expect.arrayContaining(['img-article-a-u1-1', 'img-quiz-arena-bg-boss', 'img-rpg-tiles', 'img-rpg-npc-2']))
      expect((await packOf(env)).assets).toHaveLength(plan.entries.length)
      expect((await lintOf(env)).errors).toBe(0)
    } finally {
      await env.cleanup()
    }
  }, 120_000)
})

describe('a provider that is down does not fail the run', () => {
  it('ComfyUI down: every picture gets its placeholder and a warning, the course builds and publishes, the lint warns PLACEHOLDER_ASSET and nothing else; when ComfyUI is back edu_asset_generate replaces them', async () => {
    const env = await makePipelineEnv()
    try {
      env.comfy.down = true
      await run(env, BRIEF_RPG)
      const p = await pipelineOf(env)
      expect(p, JSON.stringify(p.blockedBy ?? p.failed)).toMatchObject({ stage: 'published' })
      const gen = p.steps.find((s) => s.step === 'art_generate:all')!
      expect(gen).toMatchObject({ status: 'done', note: expect.stringMatching(/10 placeholder\(s\) stand in \(the image provider is down: every ComfyUI lane is busy or unreachable/) })
      expect(env.comfy.requests.length).toBeLessThan(10) // the first failure says ComfyUI is down: the rest were not tried (one wait for the whole run)

      const manifest = await manifestOf(env)
      for (const a of manifest.assets) {
        expect(a.versions).toEqual([])
        expect(a.placeholder).toMatchObject({ file: 'placeholder.svg', reason: expect.stringMatching(/unreachable/) })
        expect(existsSync(courseFile(env, SLUG, 'build', 'assets', a.id, 'placeholder.svg')), a.id).toBe(true)
      }
      const pack = await packOf(env)
      expect(pack.assets.every((a) => a.file.endsWith('/placeholder.svg'))).toBe(true)
      expect(pack.encyclopedia.articles.every((a) => !!a.asset)).toBe(true)

      const lint = await lintOf(env)
      expect(lint.ok).toBe(true)
      expect(lint.errors).toBe(0)
      const ph = lint.problems.filter((x) => x.code === 'PLACEHOLDER_ASSET')
      expect(ph).toHaveLength(10)
      expect(ph.every((x) => x.severity === 'warning')).toBe(true)
      expect(lint.problems.every((x) => x.severity === 'warning')).toBe(true)
      expect((await toolsOf(env).call('edu_status', { slug: SLUG })).data.media).toMatchObject({ images: 10, made: 0, placeholders: 10, note: expect.stringMatching(/10 picture\(s\) are placeholders.*PLACEHOLDER_ASSET/) })

      // ComfyUI comes back: one call makes the pictures and the placeholders go
      env.comfy.down = false
      const { call } = toolsOf(env)
      const queued = await call('edu_asset_generate', { slug: SLUG })
      expect(queued.ok, queued.text).toBe(true)
      expect(queued.data.jobs).toHaveLength(1)
      await waitIdle(env, SLUG, 60_000)
      const after = await manifestOf(env)
      for (const a of after.assets) {
        expect(a).toMatchObject({ selected: 1, versions: [expect.objectContaining({ n: 1 })] })
        expect(a.placeholder).toBeUndefined()
        expect(existsSync(courseFile(env, SLUG, 'course', 'assets', a.id, 'placeholder.svg')), `${a.id} placeholder file`).toBe(false)
      }
      expect((await packOf(env)).assets.every((a) => a.file.endsWith('/v1.webp'))).toBe(true) // the pack is re-linked
      expect((await call('edu_build', { slug: SLUG })).ok).toBe(true)
      const clean = await lintOf(env, true)
      expect(clean.errors).toBe(0)
      expect(clean.problems.filter((x) => x.code === 'PLACEHOLDER_ASSET')).toEqual([])
    } finally {
      await env.cleanup()
    }
  }, 150_000)

  it('Pixel Studio down: the built-in pixelate makes the RPG art, with a warning on each asset, and the run publishes', async () => {
    const env = await makePipelineEnv()
    try {
      env.pixel.down = true
      await run(env, BRIEF_RPG)
      expect((await pipelineOf(env)).stage).toBe('published')
      const manifest = await manifestOf(env)
      for (const id of ['img-rpg-tiles', 'img-rpg-hero', 'img-rpg-npc-1', 'img-rpg-npc-2']) {
        const v = manifest.assets.find((a) => a.id === id)!.versions[0]!
        expect(v.warnings?.some((w) => /Pixel Studio could not convert the image.*used the built-in pixelate/.test(w)), id).toBe(true)
      }
      const gen = (await pipelineOf(env)).steps.find((s) => s.step === 'art_generate:all')!
      expect(gen.note).toMatch(/warning\(s\)/)
      expect((await lintOf(env)).problems.filter((x) => x.code === 'PLACEHOLDER_ASSET')).toEqual([])
    } finally {
      await env.cleanup()
    }
  }, 120_000)

  it('hand-made art: Edu Studio never calls ComfyUI for an image; placeholders stand in until edu_asset_replace gives the real file (custom, locked)', async () => {
    const env = await makePipelineEnv()
    try {
      await run(env, { ...BRIEF, media: { art: { provider: 'hand' }, music: NO_MUSIC } })
      expect((await pipelineOf(env)).stage).toBe('published')
      expect(imageRequests(env)).toHaveLength(0)
      expect(env.flow.calls).toEqual([])
      const { call } = toolsOf(env)
      const list = await call('edu_asset_list', { slug: SLUG })
      const assets = list.data.assets as { id: string; placeholder: boolean; placeholderReason?: string }[]
      expect(assets.length).toBeGreaterThan(0)
      expect(assets.every((a) => a.placeholder && /made by hand/.test(a.placeholderReason!))).toBe(true)
      const mine = path.join(env.dir, 'mine.png')
      await writeFile(mine, await sharp({ create: { width: 90, height: 60, channels: 3, background: '#2060c0' } }).png().toBuffer())
      const id = 'img-article-a-u1-1'
      const r = await call('edu_asset_replace', { slug: SLUG, id, file: mine })
      expect(r.ok, r.text).toBe(true)
      expect(r.data.asset).toMatchObject({ id, source: 'custom', locked: true, placeholder: false })
      expect(r.data).toMatchObject({ packLinked: true })
      expect((await packOf(env)).assets.find((a) => a.id === id)!.file).toBe(`assets/${id}/custom.png`)
      expect(existsSync(courseFile(env, SLUG, 'course', 'assets', id, 'placeholder.svg'))).toBe(false)
      // generating again does not touch it, and does not call ComfyUI for the others (the course says by hand)
      await call('edu_asset_generate', { slug: SLUG })
      await waitIdle(env, SLUG, 30_000)
      expect(imageRequests(env)).toHaveLength(0)
      expect((await manifestOf(env)).assets.find((a) => a.id === id)).toMatchObject({ source: 'custom', locked: true })
    } finally {
      await env.cleanup()
    }
  }, 120_000)
})

describe('Google Flow only when the course asks', () => {
  it('art.provider: flow makes every picture through Flow (no ComfyUI image call), the run publishes and the lint is clean', async () => {
    const env = await makePipelineEnv()
    try {
      await run(env, { ...BRIEF_RPG, media: { art: { provider: 'flow' }, music: NO_MUSIC } })
      expect((await pipelineOf(env)).stage).toBe('published')
      const sent = env.flow.calls.filter((c) => c.tool === 'flow_generate')
      expect(sent).toHaveLength(10)
      expect(new Set(sent.map((c) => c.args.project))).toEqual(new Set([`edu-${SLUG}`]))
      expect(imageRequests(env)).toHaveLength(0)
      const manifest = await manifestOf(env)
      expect(manifest.assets.every((a) => a.versions[0]!.engine === 'flow' && a.versions[0]!.remote?.provider === 'flow')).toBe(true)
      const lint = await lintOf(env)
      expect(lint.errors).toBe(0)
      expect(lint.problems.filter((x) => x.code === 'PLACEHOLDER_ASSET')).toEqual([])
    } finally {
      await env.cleanup()
    }
  }, 120_000)
})

describe('the art-critic', () => {
  it('a revise sends the picture back with the critic\'s note; the new version passes in round 2; only that picture is looked at again', async () => {
    const env = await makePipelineEnv({ vision: true, artReview: (id, round) => (id === 'img-article-a-u1-1' && round === 1 ? 'revise' : 'pass') })
    try {
      await run(env, BRIEF_RPG)
      const p = await pipelineOf(env)
      expect(p, JSON.stringify(p.blockedBy ?? p.failed)).toMatchObject({ stage: 'published' })
      for (const s of ['art_review:all', 'art_generate-k2:all', 'art_review-k2:all']) expect(statusOf(p, s), s).toBe('done')
      expect(p.steps.find((s) => s.step === 'art_review:all')!.note).toMatch(/10 picture\(s\) reviewed, 9 approved, 1 sent back/)
      expect(p.steps.find((s) => s.step === 'art_review-k2:all')!.note).toMatch(/1 picture\(s\) reviewed, 1 approved/)
      expect(env.author.criticImages.every((n) => n === 1)).toBe(true) // a picture goes with every review
      expect(env.author.criticImages).toHaveLength(11)
      expect(env.author.calls.filter((c) => c.startsWith('art-critic/review:img-article-a-u1-1'))).toEqual(['art-critic/review:img-article-a-u1-1:k1', 'art-critic/review:img-article-a-u1-1:k2'])
      expect(env.author.calls.filter((c) => c.startsWith('art-critic/review:img-quiz-arena-bg-u1'))).toEqual(['art-critic/review:img-quiz-arena-bg-u1:k1'])
      // the regeneration carried the note, and the new version is the selected one
      const redo = imageRequests(env).filter((r) => (r.prompt ?? '').includes('article a-u1-1'))
      expect(redo).toHaveLength(2)
      expect(redo[1]!.prompt).toMatch(/Correct this: .*the subject is too small \(show the subject large in the middle\)/)
      expect(redo[0]!.prompt).not.toMatch(/Correct this/)
      const a = (await manifestOf(env)).assets.find((x) => x.id === 'img-article-a-u1-1')!
      expect(a).toMatchObject({ selected: 2, review: { status: 'approved', version: 2, rounds: 2 } })
      expect(a.versions.map((v) => v.n)).toEqual([1, 2])
      expect(a.prompt).not.toMatch(/Correct this/) // the note is on the version, not on the plan's prompt
      expect((await packOf(env)).assets.find((x) => x.id === 'img-article-a-u1-1')!.file).toBe('assets/img-article-a-u1-1/v2.webp')
      expect(existsSync(courseFile(env, SLUG, 'build', 'assets', 'img-article-a-u1-1', 'v2.webp'))).toBe(true)
      expect(await json(pf(env, 'reviews', 'art_review-k1.json'))).toMatchObject({ round: 1, revise: [{ id: 'img-article-a-u1-1' }] })
    } finally {
      await env.cleanup()
    }
  }, 150_000)

  it('a critic that never passes does not block: after the last round the picture stays, rejected, with the note', async () => {
    const env = await makePipelineEnv({ vision: true, artReview: (id) => (id === 'img-rpg-hero' ? 'revise' : 'pass') })
    try {
      await run(env, BRIEF_RPG)
      const p = await pipelineOf(env)
      expect(p, JSON.stringify(p.blockedBy ?? p.failed)).toMatchObject({ stage: 'published' })
      expect(p.steps.find((s) => s.step === 'art_review-k2:all')!.note).toMatch(/1 still rejected after the last round \(they stay in the course\): img-rpg-hero/)
      const hero = (await manifestOf(env)).assets.find((x) => x.id === 'img-rpg-hero')!
      expect(hero).toMatchObject({ selected: 2, review: { status: 'rejected', version: 2, rounds: 2, note: expect.stringMatching(/subject is too small/) } })
      expect((await packOf(env)).assets.some((a) => a.id === 'img-rpg-hero')).toBe(true) // it stays in the course
      expect(env.author.calls.filter((c) => c.startsWith('art-critic/review:img-rpg-hero'))).toEqual(['art-critic/review:img-rpg-hero:k1', 'art-critic/review:img-rpg-hero:k2'])
      expect((await toolsOf(env).call('edu_status', { slug: SLUG })).data.media).toMatchObject({ rejected: 1, placeholders: 0 })
      const listed = (await toolsOf(env).call('edu_asset_list', { slug: SLUG, kind: 'sprite' })).data.assets as { id: string; review?: { status: string } }[]
      expect(listed.find((a) => a.id === 'img-rpg-hero')!.review!.status).toBe('rejected')
    } finally {
      await env.cleanup()
    }
  }, 150_000)

  it('review: false skips the critic with the reason; a course with a vision model but no review setting is reviewed by default', async () => {
    const env = await makePipelineEnv({ vision: true })
    try {
      await run(env, { ...BRIEF, media: { art: { review: false }, music: NO_MUSIC } })
      const p = await pipelineOf(env)
      expect(p.steps.find((s) => s.step === 'art_review:all')).toMatchObject({ status: 'skipped', note: 'media.art.review is false' })
      expect(env.author.count('art-critic')).toBe(0)
    } finally {
      await env.cleanup()
    }
    const on = await makePipelineEnv({ vision: true })
    try {
      await run(on, BRIEF)
      expect(on.author.count('art-critic/review')).toBeGreaterThan(0)
      expect(statusOf(await pipelineOf(on), 'art_review:all')).toBe('done')
    } finally {
      await on.cleanup()
    }
  }, 180_000)
})
