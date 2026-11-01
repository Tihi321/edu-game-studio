import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { pipelineJobId } from '../src/engine/edu/pipeline'
import type { ArtPlanFile } from '../src/shared/art'
import { validateCourse } from '../src/shared/edu'
import type { AssetManifest } from '../src/shared/media'
import type { MusicPlanFile } from '../src/shared/music'
import type { VoicePlanFile } from '../src/shared/voice'
import { waitIdle } from './edu-helpers'
import { BRIEF, courseFile, json, makePipelineEnv, pf, pipelineOf, run, SLUG, statusOf, toolsOf } from './pipeline-helpers'
import type { PipelineEnv } from './pipeline-helpers'

/**
 * Art, music, sound effects and voice in the pipeline, end to end on the mock team with the fakes of ComfyUI, Pixel Studio, Chiptune Studio,
 * Google Flow and VibeTTS (EGS-15, EGS-16, EGS-17; merged from art-, music- and voice-pipeline.test.ts in EGS-41). No test touches a real provider.
 * One happy path per medium, then the cases that cover a different rule: a provider that is down, an unusable plan, stable ids, the credit opt-in.
 */

describe('art', () => {
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
    })

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
    })
})

describe('music and sound effects', () => {
  const BRIEF_RPG = { ...BRIEF, shells: ['quiz-arena', 'rpg'] }
  const TRACKS = ['mus-menu', 'mus-unit-u1', 'mus-unit-u2', 'mus-boss', 'mus-end', 'mus-rpg-overworld', 'mus-rpg-battle']
  const SFX = ['sfx-correct', 'sfx-wrong', 'sfx-combo', 'sfx-level-up', 'sfx-boss']
  const ACE = 'ace-step-v1-instrumental'

  interface Pack {
    assets: { id: string; kind: string; file: string; alt: string }[]
    cues: { id: string; on: string; asset: string; loop: boolean; volume: number }[]
    extensions: { audio?: { loops?: Record<string, { startSec: number; endSec: number }> } }
  }
  const packOf = (env: PipelineEnv) => json<Pack>(courseFile(env, SLUG, 'course', 'pack.json'))
  const manifestOf = (env: PipelineEnv) => json<AssetManifest>(courseFile(env, SLUG, 'course', 'assets.json'))
  const planOf = (env: PipelineEnv) => json<MusicPlanFile>(pf(env, 'music.json'))
  const lintOf = async (env: PipelineEnv, rebuild = false) => (await toolsOf(env).call('edu_lint', { slug: SLUG, rebuild })).data as { ok: boolean; errors: number; warnings: number; problems: { code: string; severity: string; path: string; message: string }[] }
  const audioRequests = (env: PipelineEnv) => env.comfy.requests.filter((r) => r.engine === ACE)
  const imageRequests = (env: PipelineEnv) => env.comfy.requests.filter((r) => r.engine !== ACE && !(r.prompt ?? '').startsWith('Remove the background'))
  const tool = (env: PipelineEnv, name: string) => env.chiptune.calls.filter((c) => c.tool === name)
  const wavFile = async (file: string) => (await readFile(file)).subarray(0, 4).toString() === 'RIFF'

    it('quiz arena and rpg: published; the plan, the audio assets, the cues and the loop points are in the pack; the files are in the build; the lint is clean; Flow was never called', async () => {
      const env = await makePipelineEnv()
      try {
        const { failed } = await run(env, BRIEF_RPG)
        expect(failed).toEqual([])
        const p = await pipelineOf(env)
        expect(p, JSON.stringify(p.blockedBy ?? p.failed)).toMatchObject({ stage: 'published' })
        for (const s of ['art_plan:all', 'art_generate:all', 'music_plan:all', 'music_generate:all']) expect(statusOf(p, s), s).toBe('done')
        expect(env.author.count('composer/plan')).toBe(1)
        expect(p.steps.find((s) => s.step === 'music_plan:all')!.note).toMatch(/7 track\(s\) and 5 sound effect\(s\) planned/)
        expect(p.steps.find((s) => s.step === 'music_generate:all')!.note).toMatch(/^12 sound\(s\) made/)

        // the plan: a track per area (ids come from where it plays), a sound per event
        const plan = await planOf(env)
        expect(plan).toMatchObject({ source: 'model', version: 1 })
        expect(plan.tracks.map((t) => t.id)).toEqual(TRACKS)
        expect(plan.tracks.map((t) => t.provider)).toEqual(['comfy', 'comfy', 'comfy', 'comfy', 'comfy', 'chiptune', 'chiptune']) // Chiptune Studio for the RPG, ACE-Step for the rest
        expect(plan.sfx.map((s) => s.id)).toEqual(SFX)
        expect(plan.sfx.every((s) => s.engine === 'chiptune')).toBe(true)

        // the pack: an audio asset for every track and effect with an alt key; the cues; the loop points of the Chiptune tracks
        const pack = await packOf(env)
        const audio = pack.assets.filter((a) => a.kind === 'audio')
        expect(audio.map((a) => a.id).sort()).toEqual([...TRACKS, ...SFX].sort())
        expect(pack.assets.filter((a) => a.kind === 'image')).toHaveLength(10) // the art is still all there
        const catalog = await json<{ strings: Record<string, string> }>(courseFile(env, SLUG, 'course', 'text', 'en.json'))
        for (const a of audio) {
          expect(a, a.id).toMatchObject({ alt: `asset.${a.id}.alt`, file: expect.stringMatching(new RegExp(`^assets/${a.id}/v1\\.wav$`)) })
          expect(catalog.strings[a.alt], a.alt).toBeTruthy()
        }
        expect(pack.cues.filter((c) => c.on.startsWith('music:')).map((c) => [c.on, c.asset, c.loop])).toEqual(TRACKS.map((t) => [`music:${t.replace('mus-', '')}`, t, true]))
        expect(pack.cues.filter((c) => !c.on.startsWith('music:')).map((c) => [c.on, c.asset, c.loop])).toEqual(SFX.map((s) => [s.replace('sfx-', ''), s, false]))
        expect(pack.cues.every((c) => c.volume > 0 && c.volume <= 1)).toBe(true)
        expect(pack.extensions.audio!.loops).toEqual({ 'mus-rpg-overworld': { startSec: 2, endSec: 41.5 }, 'mus-rpg-battle': { startSec: 2, endSec: 41.5 } })
        expect(validateCourse(pack, { en: { schema: 1, lang: 'en', ...catalog } }).problems).toEqual([])

        // the files: in the course, in the build, real audio; the game data lists them
        const manifest = await manifestOf(env)
        for (const id of [...TRACKS, ...SFX]) {
          expect(await wavFile(courseFile(env, SLUG, 'course', 'assets', id, 'v1.wav')), id).toBe(true)
          expect(existsSync(courseFile(env, SLUG, 'build', 'assets', id, 'v1.wav')), `build ${id}`).toBe(true)
        }
        const game = await json<{ assets: Record<string, string> }>(courseFile(env, SLUG, 'build', 'game-data.json'))
        for (const id of [...TRACKS, ...SFX]) expect(game.assets[id], id).toBe(`assets/${id}/v1.wav`)
        const byId = (id: string) => manifest.assets.find((a) => a.id === id)!
        expect(byId('mus-menu')).toMatchObject({ kind: 'music', engine: ACE, selected: 1, source: 'generated', alt: 'The music of menu' })
        expect(byId('mus-rpg-battle').versions[0]).toMatchObject({ engine: 'chiptune', loopStartSec: 2, loopEndSec: 41.5, songFile: 'v1.song' })
        expect(byId('sfx-correct').versions[0]).toMatchObject({ engine: 'chiptune', loopStartSec: null })

        // the generators: ACE-Step for the five tracks (at the planned length), Chiptune Studio for the two RPG tracks and the five effects, Flow never
        expect(audioRequests(env)).toHaveLength(5)
        expect(audioRequests(env).every((r) => r.seconds === 60 && /calm instrumental/.test(r.prompt ?? ''))).toBe(true)
        expect(tool(env, 'compose_track')).toHaveLength(2)
        expect(tool(env, 'compose_sfx').map((c) => (c.args as { sound: string }).sound)).toEqual(['coin', 'cancel', 'magic', 'powerup', 'alert'])
        expect(env.flow.calls).toEqual([])
        expect(imageRequests(env)).toHaveLength(10)

        // the lint: no error, no placeholder; edu_status carries the audio summary
        const lint = await lintOf(env)
        expect(lint).toMatchObject({ ok: true, errors: 0 })
        expect(lint.problems.filter((x) => x.code === 'PLACEHOLDER_ASSET')).toEqual([])
        expect(lint.problems.filter((x) => x.code === 'ASSET_MISSING' || x.code === 'MISSING_ASSET_FILE')).toEqual([])
        expect(await json(pf(env, 'lint.json'))).toMatchObject({ ok: true, errors: 0 })
        const st = (await toolsOf(env).call('edu_status', { slug: SLUG })).data as { media: Record<string, unknown> }
        expect(st.media).toMatchObject({ images: 10, made: 10, audio: 12, audioMade: 12, audioPlaceholders: 0 })
        expect(st.media.note).toBeUndefined()
      } finally {
        await env.cleanup()
      }
    })

    it('a plan that stays unusable is replaced by the deterministic plan from the course text: the step never blocks, every sound is there', async () => {
      const env = await makePipelineEnv({ musicPlan: 'unusable' })
      try {
        await run(env, BRIEF_RPG)
        const p = await pipelineOf(env)
        expect(p.stage).toBe('published')
        expect(p.steps.find((s) => s.step === 'music_plan:all')!.note).toMatch(/from the course text/)
        const plan = await planOf(env)
        expect(plan).toMatchObject({ source: 'fallback', note: expect.stringMatching(/no usable answer/) })
        expect(plan.tracks.every((t) => t.by === 'fallback')).toBe(true)
        expect(plan.tracks.map((t) => t.id)).toEqual(TRACKS)
        expect(plan.sfx.map((s) => s.id)).toEqual(SFX)
        expect((await packOf(env)).assets.filter((a) => a.kind === 'audio')).toHaveLength(12)
        expect((await lintOf(env)).errors).toBe(0)
      } finally {
        await env.cleanup()
      }
    })

    it('restart from: music makes run 2 with a new music_plan, the same ids and nothing made again; restart from: art redoes the art plan and the music plan the same way', async () => {
      const env = await makePipelineEnv()
      try {
        await run(env, BRIEF_RPG)
        expect((await pipelineOf(env)).stage).toBe('published')
        const made = [audioRequests(env).length, env.chiptune.calls.length]
        const before = await manifestOf(env)
        const first = (await planOf(env)).tracks.map((t) => t.id)
        const { call } = toolsOf(env)
        const r = await call('edu_run_pipeline', { slug: SLUG, restart: true, from: 'music' })
        expect(r.ok, r.text).toBe(true)
        expect(r.data.run).toBe(2)
        await waitIdle(env, SLUG, 60_000)
        const p = await pipelineOf(env)
        expect(p, JSON.stringify(p.blockedBy ?? p.failed)).toMatchObject({ run: 2, stage: 'published' })
        expect(p.steps.find((s) => s.step === 'music_plan:all')!.job).toBe(pipelineJobId(SLUG, 2, 'music_plan', null))
        expect(p.steps.find((s) => s.step === 'art_plan:all')!.job).toBe(pipelineJobId(SLUG, 1, 'art_plan', null)) // before the stage: kept
        expect(env.author.count('composer/plan')).toBe(2)
        expect(p.steps.find((s) => s.step === 'music_generate:all')!.note).toMatch(/0 sound\(s\) made.*12 already there/)
        expect((await planOf(env)).tracks.map((t) => t.id)).toEqual(first)
        expect([audioRequests(env).length, env.chiptune.calls.length]).toEqual(made)
        expect(await manifestOf(env)).toEqual(before)

        // from art: the art plan and the music plan run again, still nothing is made twice
        await call('edu_run_pipeline', { slug: SLUG, restart: true, from: 'art' })
        await waitIdle(env, SLUG, 60_000)
        const q = await pipelineOf(env)
        expect(q).toMatchObject({ run: 3, stage: 'published' })
        expect(q.steps.find((s) => s.step === 'music_plan:all')!.job).toBe(pipelineJobId(SLUG, 3, 'music_plan', null))
        expect(env.author.count('composer/plan')).toBe(3)
        expect([audioRequests(env).length, env.chiptune.calls.length]).toEqual(made)
        expect((await lintOf(env)).errors).toBe(0)
      } finally {
        await env.cleanup()
      }
    })

    it('the course says provider flow but not flowCredits: Flow is never called, the tracks use the default providers, and the plan says why', async () => {
      const env = await makePipelineEnv()
      try {
        await run(env, { ...BRIEF_RPG, media: { music: { provider: 'flow' } } })
        expect((await pipelineOf(env)).stage).toBe('published')
        expect(env.flow.calls).toEqual([])
        const plan = await planOf(env)
        expect(plan.tracks.map((t) => t.provider)).toEqual(['comfy', 'comfy', 'comfy', 'comfy', 'comfy', 'chiptune', 'chiptune'])
        expect(plan.warnings!.join()).toMatch(/flowCredits is not true/)
        expect((await pipelineOf(env)).steps.find((s) => s.step === 'music_plan:all')!.note).toMatch(/flowCredits is not true/)
        expect((await lintOf(env)).errors).toBe(0)
      } finally {
        await env.cleanup()
      }
    })
})

describe('voice', () => {
  const SLUG = 'croatian-greetings'
  const BRIEF_LANG = { topic: 'Croatian greetings', audience: 'adults', age: 30, sourceLang: 'en', targetLang: 'hr', cefr: 'A1', units: 2, story: 'none', shells: ['quiz-arena', 'rpg'], media: { voice: { narration: true } } }
  const HR_CLIPS = ['voice-hr-item-u1-q1-opt-a', 'voice-hr-item-u1-q2-listen-transcript', 'voice-hr-item-u2-q1-opt-a', 'voice-hr-item-u2-q2-listen-transcript']
  const EN_CLIPS = ['voice-en-unit-u1-summary', 'voice-en-unit-u2-summary']
  const DERIVED = ['u1-q1-listen', 'u1-q2-listen', 'u2-q1-listen', 'u2-q2-listen']

  interface Pack {
    items: { id: string; kind: string; asset?: string; transcript?: string; extensions?: { facts?: string[]; voice?: { derivedFrom?: string } } }[]
    assets: { id: string; kind: string; file: string; alt: string }[]
    extensions: { narration?: Record<string, string> }
  }
  const packOf = (env: PipelineEnv, slug = SLUG) => json<Pack>(courseFile(env, slug, 'course', 'pack.json'))
  const manifestOf = (env: PipelineEnv, slug = SLUG) => json<AssetManifest>(courseFile(env, slug, 'course', 'assets.json'))
  const lintOf = async (env: PipelineEnv, slug = SLUG, rebuild = false) => (await toolsOf(env).call('edu_lint', { slug, rebuild })).data as { ok: boolean; errors: number; warnings: number; problems: { code: string; severity: string; path: string; message: string }[] }
  const pf = (env: PipelineEnv, ...p: string[]) => courseFile(env, SLUG, 'pipeline', ...p)
  const voicePlanOf = (env: PipelineEnv) => json<VoicePlanFile>(pf(env, 'voice.json'))
  const wav = async (file: string) => (await readFile(file)).subarray(0, 4).toString() === 'RIFF'

  /** Today's Gemini quota with 7 of 10 requests used: Croatian (4 clips) does not fit in the 3 left, English (2 clips) does. */
  async function useQuota(env: PipelineEnv, used: number): Promise<void> {
    await (await env.engine.edu.voice.quota()).add(used)
  }

    it('published: pictures, pixel art, music, sound effects and spoken clips; no placeholder; a clean lint; the pack links the clips; Croatian is spoken by VibeTTS and English by Gemini (the quota rule)', async () => {
      const env = await makePipelineEnv()
      try {
        await useQuota(env, 7)
        const { failed, slug } = await run(env, BRIEF_LANG, 150_000)
        expect(slug).toBe(SLUG)
        expect(failed).toEqual([])
        const st = (await toolsOf(env).call('edu_status', { slug: SLUG })).data.pipeline as { stage: string; steps: { step: string; status: string; note?: string }[]; blockedBy?: string[] }
        expect(st.stage, JSON.stringify(st.blockedBy)).toBe('published')

        // the voice steps: after the audience review, before the build; real, not skipped
        const order = st.steps.map((s) => s.step)
        expect(order.indexOf('voice_plan:all')).toBeGreaterThan(order.indexOf('review_accessibility:all'))
        expect(order.indexOf('voice_generate:all')).toBeGreaterThan(order.indexOf('voice_plan:all'))
        expect(order.indexOf('build:all')).toBeGreaterThan(order.indexOf('voice_generate:all'))
        expect(statusOf(st, 'voice_plan:all')).toBe('done')
        expect(statusOf(st, 'voice_generate:all')).toBe('done')
        expect(st.steps.find((s) => s.step === 'voice_plan:all')!.note).toMatch(/^6 clip\(s\) planned \(4 listening, 2 narration\), 4 listening item\(s\) made from taught phrases, 6 new/)
        expect(st.steps.find((s) => s.step === 'voice_generate:all')!.note).toMatch(/^6 clip\(s\) spoken \(vibetts 4, gemini 2\).*hr: vibetts, en: gemini/)
        expect(st.steps.filter((s) => s.status === 'skipped').map((s) => s.step)).not.toContain('voice_plan:all')
        expect(env.author.count('voice-director/plan')).toBe(1)

        // the allocation rule: 3 Gemini requests left, Croatian needs 4 (local, VibeTTS reads it), English needs 2 (Gemini)
        const plan = await voicePlanOf(env)
        expect(plan).toMatchObject({ source: 'model', sourceLang: 'en', targetLang: 'hr' })
        expect(plan.allocation).toMatchObject({ hr: { provider: 'vibetts', need: 4, made: { vibetts: 4 }, placeholders: 0 }, en: { provider: 'gemini', need: 2, made: { gemini: 2 }, placeholders: 0 } })
        expect(env.vibetts.spoken.map((s) => [s.lang, s.voice])).toEqual(HR_CLIPS.map(() => ['hr', 'supertonic:F1']))
        expect(env.flow.spoken.map((s) => s.engine)).toEqual(['gemini', 'gemini']) // the paid Flow engine is never sent
        expect(env.flow.calls.filter((c) => c.tool === 'flow_narrate')).toHaveLength(2)
        expect(await (await env.engine.edu.voice.quota()).read()).toMatchObject({ used: 9, remaining: 1 })

        // every asset kind is in the manifest, with a real file, and nothing is a placeholder
        const manifest = await manifestOf(env)
        const kinds = [...new Set(manifest.assets.map((a) => a.kind))].sort()
        expect(kinds).toEqual(['background', 'illustration', 'music', 'sfx', 'sprite', 'tileset', 'voice'])
        expect(manifest.assets.filter((a) => ['background', 'illustration'].includes(a.kind))).toHaveLength(6)
        expect(manifest.assets.filter((a) => a.kind === 'tileset' || a.kind === 'sprite')).toHaveLength(4) // the RPG tiles and sprites (Pixel Studio)
        expect(manifest.assets.filter((a) => a.kind === 'music')).toHaveLength(7)
        expect(manifest.assets.filter((a) => a.kind === 'sfx')).toHaveLength(5)
        expect(manifest.assets.filter((a) => a.kind === 'voice').map((a) => a.id).sort()).toEqual([...HR_CLIPS, ...EN_CLIPS].sort())
        expect(manifest.assets).toHaveLength(28)
        expect(manifest.assets.filter((a) => a.placeholder)).toEqual([])
        expect(manifest.assets.filter((a) => a.versions.length !== 1)).toEqual([])
        expect(env.pixel.calls.length).toBeGreaterThan(0) // Pixel Studio made the pixel art
        expect(env.chiptune.calls.filter((c) => c.tool === 'compose_track')).toHaveLength(2)
        expect(env.chiptune.calls.filter((c) => c.tool === 'compose_sfx')).toHaveLength(5)

        // the pack: 28 assets (10 images, 12 sounds, 6 clips), none a placeholder, every clip an audio asset with an alt text
        const pack = await packOf(env)
        expect(pack.assets).toHaveLength(28)
        expect(pack.assets.filter((a) => /placeholder/i.test(a.file))).toEqual([])
        const catalog = await json<{ strings: Record<string, string> }>(courseFile(env, SLUG, 'course', 'text', 'en.json'))
        const clips = pack.assets.filter((a) => a.id.startsWith('voice-'))
        expect(clips.map((a) => a.id).sort()).toEqual([...HR_CLIPS, ...EN_CLIPS].sort())
        for (const a of clips) {
          expect(a, a.id).toMatchObject({ kind: 'audio', alt: `asset.${a.id}.alt`, file: expect.stringMatching(new RegExp(`^assets/${a.id}/v1\\.wav$`)) })
          expect(catalog.strings[a.alt], a.alt).toBeTruthy()
          expect(await wav(courseFile(env, SLUG, 'course', 'assets', a.id, 'v1.wav')), a.id).toBe(true)
          expect(existsSync(courseFile(env, SLUG, 'build', 'assets', a.id, 'v1.wav')), `build ${a.id}`).toBe(true)
        }

        // listening items: the four derived ones (same objective and facts as their source, marked) and every listening item points at a clip whose file exists
        const listening = pack.items.filter((i) => i.kind === 'listening')
        expect(listening.map((i) => i.id)).toEqual(DERIVED)
        expect(listening.map((i) => i.extensions?.voice?.derivedFrom)).toEqual(['u1-q1', 'u1-q2', 'u2-q1', 'u2-q2'])
        for (const it of listening) {
          expect(it.asset, it.id).toMatch(/^voice-hr-/)
          expect(clips.some((a) => a.id === it.asset), it.id).toBe(true)
          expect(existsSync(courseFile(env, SLUG, 'build', 'assets', it.asset!, 'v1.wav')), it.id).toBe(true)
          const source = pack.items.find((i) => i.id === it.extensions!.voice!.derivedFrom)!
          expect(it.extensions!.facts, it.id).toEqual(source.extensions!.facts) // the facts of the source item that passed the fact-check
        }
        expect(pack.items.findIndex((i) => i.id === 'u1-q1-listen')).toBe(pack.items.findIndex((i) => i.id === 'u1-q1') + 1) // put after its source

        // the narration: `pack.extensions.narration` maps the text key to its clip
        expect(pack.extensions.narration).toEqual({ 'unit.u1.summary': 'voice-en-unit-u1-summary', 'unit.u2.summary': 'voice-en-unit-u2-summary' })
        const hr = await json<{ strings: Record<string, string> }>(courseFile(env, SLUG, 'course', 'text', 'hr.json'))
        for (const it of listening) expect(hr.strings[it.transcript!] ?? Object.values(hr.strings).length, it.id).toBeTruthy() // the transcript is in the target-language catalog
        const en = await json<{ lang: string; strings: Record<string, string> }>(courseFile(env, SLUG, 'course', 'text', 'en.json'))
        expect(en.strings['item.u1-q1-listen.prompt']).toMatch(/Listen to the recording/)
        expect(validateCourse(pack, { en: { schema: 1, ...en }, hr: { schema: 1, lang: 'hr', ...hr } } as never).problems).toEqual([])

        // the lint: 0 errors, 0 warnings, with and without a rebuild; the pipeline's own lint saw the same
        for (const rebuild of [false, true]) expect(await lintOf(env, SLUG, rebuild)).toMatchObject({ ok: true, errors: 0, warnings: 0, problems: [] })
        expect(await json(pf(env, 'lint.json'))).toMatchObject({ ok: true, errors: 0 })
        const status = (await toolsOf(env).call('edu_status', { slug: SLUG })).data as { media: Record<string, unknown> }
        expect(status.media).toMatchObject({ images: 10, made: 10, audio: 18, audioMade: 18, audioPlaceholders: 0 })
      } finally {
        await env.cleanup()
      }
    })

    it('every provider down: silent placeholders and warnings, the run still publishes, the lint warns PLACEHOLDER_ASSET for each clip; a provider coming back replaces them', async () => {
      const env = await makePipelineEnv()
      try {
        env.flow.up = false
        env.vibetts.down = true
        env.comfy.down = true
        await run(env, { ...BRIEF_LANG, media: { voice: { narration: true }, art: { enabled: false }, music: { enabled: false } } }, 150_000)
        const st = (await toolsOf(env).call('edu_status', { slug: SLUG })).data.pipeline as { stage: string; steps: { step: string; status: string; note?: string }[] }
        expect(st.stage).toBe('published')
        expect(st.steps.find((s) => s.step === 'voice_generate:all')!.note).toMatch(/^0 clip\(s\) spoken, 6 placeholder\(s\) stand in/)
        const manifest = await manifestOf(env)
        expect(manifest.assets.filter((a) => a.kind === 'voice' && a.placeholder)).toHaveLength(6)
        const lint = await lintOf(env)
        expect(lint.errors).toBe(0)
        expect(lint.problems.filter((p) => p.code === 'PLACEHOLDER_ASSET')).toHaveLength(6)
        expect(((await toolsOf(env).call('edu_status', { slug: SLUG })).data as { media: Record<string, unknown> }).media).toMatchObject({ audio: 6, audioMade: 0, audioPlaceholders: 6 })

        env.vibetts.down = false // VibeTTS is back: edu_voice_generate speaks the placeholders (Gemini stays down, so everything is local)
        await toolsOf(env).call('edu_voice_generate', { slug: SLUG })
        await waitIdle(env, SLUG, 60_000)
        expect((await manifestOf(env)).assets.filter((a) => a.kind === 'voice' && a.placeholder)).toEqual([])
        expect(env.vibetts.spoken).toHaveLength(6)
        expect(await lintOf(env, SLUG, true)).toMatchObject({ errors: 0, warnings: 0 })
      } finally {
        await env.cleanup()
      }
    })
})
