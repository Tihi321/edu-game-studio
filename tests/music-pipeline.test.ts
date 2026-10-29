import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPlaytest } from '../src/engine/edu/playtest'
import { buildTools, toolList } from '../src/engine/mcp/tools'
import { GUIDE } from '../src/engine/mcp/server'
import { pipelineJobId } from '../src/engine/edu/pipeline'
import { validateCourse } from '../src/shared/edu'
import type { MusicPlanFile } from '../src/shared/music'
import type { AssetManifest } from '../src/shared/media'
import { waitIdle } from './edu-helpers'
import { BRIEF, courseFile, json, makePipelineEnv, pf, pipelineOf, run, SLUG, statusOf, toolsOf } from './pipeline-helpers'
import type { PipelineEnv } from './pipeline-helpers'

/**
 * Music and sound effects in the pipeline (EGS-16), end to end on the mock team with the fakes of ComfyUI, Pixel Studio, Chiptune Studio and
 * Google Flow: the composer plans, the generators make the tracks and the effects (every fake file is a real PCM wav), the pack carries the audio
 * assets and the cues, the build has the files and the lint is clean. No test touches a real provider: the data folder's autostart is off.
 */

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

describe('the whole run with art and music: images, music and sound effects in the pack and the build', () => {
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
  }, 150_000)

  it('the composer may merge units into one track: the id is the first unit\'s, and there is a cue for each unit', async () => {
    const env = await makePipelineEnv({ musicPlan: 'merge' })
    try {
      await run(env, BRIEF)
      expect((await pipelineOf(env)).stage).toBe('published')
      const plan = await planOf(env)
      // the game designer asks for the rpg shell too, so its two areas are in the plan
      expect(plan.tracks.map((t) => [t.id, t.areas])).toEqual([['mus-menu', ['menu']], ['mus-unit-u1', ['unit-u1', 'unit-u2']], ['mus-boss', ['boss']], ['mus-end', ['end']], ['mus-rpg-overworld', ['rpg-overworld']], ['mus-rpg-battle', ['rpg-battle']]])
      const pack = await packOf(env)
      expect(pack.cues.filter((c) => c.on.startsWith('music:unit')).map((c) => [c.on, c.asset])).toEqual([['music:unit-u1', 'mus-unit-u1'], ['music:unit-u2', 'mus-unit-u1']])
      expect(audioRequests(env)).toHaveLength(4)
      expect((await lintOf(env)).errors).toBe(0)
    } finally {
      await env.cleanup()
    }
  }, 120_000)

  it('music.enabled: false skips both steps: no composer, no sound, no cue; the pictures are unaffected', async () => {
    const env = await makePipelineEnv()
    try {
      await run(env, { ...BRIEF, media: { music: { enabled: false } } })
      const p = await pipelineOf(env)
      expect(p.stage).toBe('published')
      for (const s of ['music_plan:all', 'music_generate:all']) expect(p.steps.find((x) => x.step === s)).toMatchObject({ status: 'skipped', note: expect.stringMatching(/media\.music\.enabled is false/) })
      expect(env.author.count('composer')).toBe(0)
      const pack = await packOf(env)
      expect(pack.assets.filter((a) => a.kind === 'audio')).toEqual([])
      expect(pack.cues).toEqual([])
      expect(audioRequests(env)).toHaveLength(0)
      expect(env.chiptune.calls).toEqual([])
      expect(imageRequests(env).length).toBeGreaterThan(0)
    } finally {
      await env.cleanup()
    }
  }, 120_000)
})

describe('the composer gives no usable plan', () => {
  it('a plan that needs the repair round still publishes', async () => {
    const env = await makePipelineEnv({ musicPlan: 'repair' })
    try {
      await run(env, BRIEF)
      expect((await pipelineOf(env)).stage).toBe('published')
      expect(env.author.count('composer/plan')).toBe(2)
      expect((await planOf(env)).source).toBe('model')
    } finally {
      await env.cleanup()
    }
  }, 120_000)

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
  }, 120_000)
})

describe('ids are stable and a version already made is not made again', () => {
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
  }, 240_000)
})

describe('a provider that is down does not fail the run', () => {
  it('Chiptune Studio down: the RPG tracks and every effect get a silent placeholder and a warning, the course builds and publishes, the lint warns PLACEHOLDER_ASSET and nothing else; when it is back edu_asset_generate replaces them and the pack is re-linked', async () => {
    const env = await makePipelineEnv()
    try {
      env.chiptune.down = true
      await run(env, BRIEF_RPG)
      const p = await pipelineOf(env)
      expect(p, JSON.stringify(p.blockedBy ?? p.failed)).toMatchObject({ stage: 'published' })
      const gen = p.steps.find((s) => s.step === 'music_generate:all')!
      expect(gen).toMatchObject({ status: 'done', note: expect.stringMatching(/^5 sound\(s\) made, 7 placeholder\(s\) stand in \(a provider is down: Chiptune Studio: .*not running/) })
      expect(audioRequests(env)).toHaveLength(5) // ACE-Step still made the five tracks

      const manifest = await manifestOf(env)
      const stand = manifest.assets.filter((a) => a.placeholder)
      expect(stand.map((a) => a.id).sort()).toEqual(['mus-rpg-battle', 'mus-rpg-overworld', ...SFX].sort())
      for (const a of stand) {
        expect(a.versions).toEqual([])
        expect(a.placeholder).toMatchObject({ file: 'placeholder.wav', reason: expect.stringMatching(/not running/) })
        expect(await wavFile(courseFile(env, SLUG, 'build', 'assets', a.id, 'placeholder.wav')), a.id).toBe(true)
      }
      const pack = await packOf(env)
      expect(pack.assets.filter((a) => a.file.endsWith('/placeholder.wav'))).toHaveLength(7)
      expect(pack.cues.filter((c) => c.asset === 'sfx-correct')).toHaveLength(1) // the cue points at the placeholder until the real sound is there
      expect(pack.extensions.audio).toBeUndefined() // no real Chiptune track, so no loop points

      const lint = await lintOf(env)
      expect(lint.ok).toBe(true)
      expect(lint.errors).toBe(0)
      const ph = lint.problems.filter((x) => x.code === 'PLACEHOLDER_ASSET')
      expect(ph).toHaveLength(7)
      expect(ph.every((x) => x.severity === 'warning')).toBe(true)
      expect(lint.problems.every((x) => x.severity === 'warning')).toBe(true)
      expect((await toolsOf(env).call('edu_status', { slug: SLUG })).data.media).toMatchObject({ audio: 12, audioMade: 5, audioPlaceholders: 7, note: expect.stringMatching(/7 sound\(s\) are silent placeholders.*PLACEHOLDER_ASSET/) })

      // the studio comes back: the effects first, then the tracks; the placeholders go and the pack points at the real files
      env.chiptune.down = false
      const { call } = toolsOf(env)
      const q = await call('edu_asset_generate', { slug: SLUG, kind: 'sfx' })
      expect(q.ok, q.text).toBe(true)
      await waitIdle(env, SLUG, 60_000)
      const mid = await manifestOf(env)
      for (const id of SFX) {
        expect(mid.assets.find((a) => a.id === id)).toMatchObject({ selected: 1 })
        expect(mid.assets.find((a) => a.id === id)!.placeholder, id).toBeUndefined()
      }
      expect(mid.assets.find((a) => a.id === 'mus-rpg-battle')!.placeholder).toBeDefined() // not asked for yet
      await call('edu_asset_generate', { slug: SLUG, kind: 'music' })
      await waitIdle(env, SLUG, 60_000)
      const after = await manifestOf(env)
      for (const a of after.assets) expect(a.placeholder, a.id).toBeUndefined()
      const linked = await packOf(env)
      expect(linked.assets.every((a) => !/placeholder/.test(a.file))).toBe(true)
      expect(linked.extensions.audio!.loops).toEqual({ 'mus-rpg-overworld': { startSec: 2, endSec: 41.5 }, 'mus-rpg-battle': { startSec: 2, endSec: 41.5 } })
      expect(audioRequests(env)).toHaveLength(5) // the five ACE-Step tracks were not made again
      expect((await call('edu_build', { slug: SLUG })).ok).toBe(true)
      const clean = await lintOf(env, true)
      expect(clean.errors).toBe(0)
      expect(clean.problems.filter((x) => x.code === 'PLACEHOLDER_ASSET')).toEqual([])
    } finally {
      await env.cleanup()
    }
  }, 240_000)

  it('ComfyUI down: the five ACE-Step tracks get placeholders next to the pictures; the Chiptune sounds are made; the run publishes', async () => {
    const env = await makePipelineEnv()
    try {
      env.comfy.down = true
      await run(env, BRIEF_RPG)
      const p = await pipelineOf(env)
      expect(p, JSON.stringify(p.blockedBy ?? p.failed)).toMatchObject({ stage: 'published' })
      expect(p.steps.find((s) => s.step === 'music_generate:all')!.note).toMatch(/^7 sound\(s\) made, 5 placeholder\(s\) stand in \(a provider is down: ComfyUI: every ComfyUI lane is busy or unreachable/)
      const manifest = await manifestOf(env)
      expect(manifest.assets.filter((a) => a.kind === 'music' && a.placeholder).map((a) => a.id)).toEqual(['mus-menu', 'mus-unit-u1', 'mus-unit-u2', 'mus-boss', 'mus-end'])
      expect(manifest.assets.filter((a) => a.kind === 'sfx').every((a) => a.selected === 1)).toBe(true)
      const lint = await lintOf(env)
      expect(lint).toMatchObject({ ok: true, errors: 0 })
      expect(lint.problems.every((x) => x.severity === 'warning')).toBe(true)
    } finally {
      await env.cleanup()
    }
  }, 150_000)

  it('sound.sfxEngine: none: the effects are made by hand: placeholders, and edu_asset_replace gives the real file (custom, locked) and clears the lint warning', async () => {
    const env = await makePipelineEnv()
    try {
      await run(env, { ...BRIEF, media: { art: { enabled: false }, sound: { sfxEngine: 'none' } } })
      expect((await pipelineOf(env)).stage).toBe('published')
      expect(env.chiptune.calls.filter((c) => c.tool === 'compose_sfx')).toHaveLength(0)
      const manifest = await manifestOf(env)
      const sfx = manifest.assets.filter((a) => a.kind === 'sfx')
      expect(sfx).toHaveLength(5)
      expect(sfx.every((a) => a.engine === 'none' && a.placeholder?.reason.match(/made by hand/))).toBe(true)
      const mine = path.join(env.dir, 'mine.wav')
      await writeFile(mine, await readFile(courseFile(env, SLUG, 'course', 'assets', 'mus-menu', 'v1.wav')))
      const r = await toolsOf(env).call('edu_asset_replace', { slug: SLUG, id: 'sfx-correct', file: mine })
      expect(r.ok, r.text).toBe(true)
      expect(r.data.asset).toMatchObject({ id: 'sfx-correct', source: 'custom', locked: true, placeholder: false })
      expect((await packOf(env)).assets.find((a) => a.id === 'sfx-correct')!.file).toBe('assets/sfx-correct/custom.wav')
      expect(existsSync(courseFile(env, SLUG, 'course', 'assets', 'sfx-correct', 'placeholder.wav'))).toBe(false)
    } finally {
      await env.cleanup()
    }
  }, 120_000)
})

describe('Flow Music spends credits: never by default, only with the opt-in, capped', () => {
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
  }, 120_000)

  it('a default course, and a course whose ART provider is flow, never call Flow Music either', async () => {
    const env = await makePipelineEnv()
    try {
      await run(env, { ...BRIEF, media: { art: { provider: 'flow' } } })
      expect((await pipelineOf(env)).stage).toBe('published')
      expect(env.flow.calls.filter((c) => c.tool.startsWith('music_'))).toEqual([]) // Flow made the pictures, not the music
      expect(env.flow.calls.filter((c) => c.tool === 'flow_generate').length).toBeGreaterThan(0)
      expect((await manifestOf(env)).assets.filter((a) => a.kind === 'music').map((a) => a.engine).filter((e) => e !== ACE && e !== 'chiptune')).toEqual([]) // ACE-Step and Chiptune Studio only
    } finally {
      await env.cleanup()
    }
  }, 120_000)

  it('provider flow AND flowCredits: Flow Music makes tracks until flowMusicMaxSongs (config/studios.md); the rest are made by the default providers, with a warning', async () => {
    const env = await makePipelineEnv()
    try {
      await writeFile(path.join(env.dir, 'config', 'studios.md'), '---\nkind: studios\nflowMusicMaxSongs: 2\n---\n')
      await run(env, { ...BRIEF_RPG, media: { art: { enabled: false }, music: { provider: 'flow', flowCredits: true } } })
      const p = await pipelineOf(env)
      expect(p, JSON.stringify(p.blockedBy ?? p.failed)).toMatchObject({ stage: 'published' })
      expect((await planOf(env)).tracks.every((t) => t.provider === 'flow')).toBe(true)
      expect(env.flow.calls.filter((c) => c.tool === 'music_generate')).toHaveLength(2) // the cap
      expect(env.flow.calls.filter((c) => c.tool === 'music_loop')).toHaveLength(2)
      const manifest = await manifestOf(env)
      const flowMade = manifest.assets.filter((a) => a.versions.some((v) => v.engine === 'flow-music'))
      expect(flowMade.map((a) => a.id)).toEqual(['mus-menu', 'mus-unit-u1'])
      expect(flowMade[0]!.versions[0]).toMatchObject({ engine: 'flow-music', remote: { provider: 'flow-music' }, loopStartSec: 0, loopEndSec: 52 })
      // the five tracks beyond the cap: ACE-Step for the plain areas, Chiptune Studio for the RPG
      expect(manifest.assets.filter((a) => a.kind === 'music').map((a) => [a.id, a.versions[0]!.engine])).toEqual([['mus-menu', 'flow-music'], ['mus-unit-u1', 'flow-music'], ['mus-unit-u2', ACE], ['mus-boss', ACE], ['mus-end', ACE], ['mus-rpg-overworld', 'chiptune'], ['mus-rpg-battle', 'chiptune']])
      expect(p.steps.find((s) => s.step === 'music_generate:all')!.note).toMatch(/Flow Music cap reached \(flowMusicMaxSongs 2\)/)
      expect((await lintOf(env)).problems.filter((x) => x.code === 'PLACEHOLDER_ASSET')).toEqual([])
      expect((await toolsOf(env).call('edu_asset_generate', { slug: SLUG, force: true, ids: ['mus-menu'] })).ok).toBe(true) // asking again does not get round the cap
      await waitIdle(env, SLUG, 60_000)
      expect(env.flow.calls.filter((c) => c.tool === 'music_generate')).toHaveLength(2)
    } finally {
      await env.cleanup()
    }
  }, 150_000)
})

// ---- the tools, on a hand-made course ----

describe('the music tools on a hand-made course', () => {
  it('edu_music_plan is a listed tool with a schema and is described in the MCP guide, with the music and sound sections', async () => {
    const env = await makePipelineEnv()
    try {
      const names = toolList(buildTools(env.engine.edu, { control: env.engine.mcpControl(), clientQueue: env.engine.clientQueue })).map((t) => t.name)
      expect(names).toContain('edu_music_plan')
      for (const t of ['edu_music_plan', 'mus-<area>', 'sfx-<event>', 'flowCredits', 'placeholder.wav', 'extensions.audio.loops', 'setting-reduce-audio']) expect(GUIDE, t).toContain(t)
    } finally {
      await env.cleanup()
    }
  })

  async function handCourse(env: PipelineEnv, slug: string): Promise<void> {
    const { call } = toolsOf(env)
    const must = async (name: string, args: Record<string, unknown>) => {
      const r = await call(name, args)
      expect(r.ok, `${name}: ${r.text}`).toBe(true)
      return r.data
    }
    await must('edu_create_course', { slug, title: 'Italy', languages: ['en'], sourceLang: 'en', subject: 'Italy', audience: 'teenagers' })
    await must('edu_item_add', { slug, item: { id: 'q2', kind: 'flashcard', objective: 'u1-o1', prompt: 'q2.prompt', explanation: 'q2.expl', back: 'q2.back' }, text: { en: { strings: { 'q2.prompt': 'The capital', 'q2.expl': 'Rome.', 'q2.back': 'Rome' } } } })
    await must('edu_item_add', { slug, item: { id: 'q3', kind: 'true-false', objective: 'u1-o1', prompt: 'q3.prompt', explanation: 'q3.expl', answer: true }, text: { en: { strings: { 'q3.prompt': 'Rome is the capital of Italy.', 'q3.expl': 'It is.' } } } }) // a second form of the objective
  }

  it('edu_music_plan {fallback: true} plans from the course text; edu_asset_generate makes the sounds, links the pack with the cues; edu_asset_list shows where each plays; the lint is clean', async () => {
    const env = await makePipelineEnv()
    try {
      await handCourse(env, 'hand')
      const { call } = toolsOf(env)
      const planned = await call('edu_music_plan', { slug: 'hand', fallback: true })
      expect(planned.ok, planned.text).toBe(true)
      expect(planned.data).toMatchObject({ source: 'fallback', tracks: 4, sfx: 5, packLinked: true })
      expect((planned.data.added as string[]).sort()).toEqual(['mus-boss', 'mus-end', 'mus-menu', 'mus-unit-u1', ...SFX].sort())
      // nothing is made yet: no file, no link
      expect((await call('edu_asset_list', { slug: 'hand' })).data.summary).toMatchObject({ audio: 9, audioMade: 0, audioPlaceholders: 0 })
      expect((await json<Pack>(courseFile(env, 'hand', 'course', 'pack.json'))).cues).toEqual([])

      const queued = await call('edu_asset_generate', { slug: 'hand', kind: 'music' })
      expect(queued.ok, queued.text).toBe(true)
      await waitIdle(env, 'hand', 60_000)
      expect(audioRequests(env)).toHaveLength(4)
      expect((await call('edu_asset_generate', { slug: 'hand' })).ok).toBe(true) // no kind: everything that is still missing (the effects)
      await waitIdle(env, 'hand', 60_000)
      expect(audioRequests(env)).toHaveLength(4) // the tracks are not made again
      expect(env.chiptune.calls.filter((c) => c.tool === 'compose_sfx')).toHaveLength(5)

      const list = await call('edu_asset_list', { slug: 'hand', kind: 'music' })
      expect((list.data.assets as { id: string; plays: string[] }[]).map((a) => [a.id, a.plays])).toEqual([['mus-menu', ['music:menu']], ['mus-unit-u1', ['music:unit-u1']], ['mus-boss', ['music:boss']], ['mus-end', ['music:end']]])
      expect(list.data.music).toMatchObject({ enabled: true, flowCredits: false })
      expect(((await call('edu_asset_list', { slug: 'hand', kind: 'sfx' })).data.assets as { plays: string[] }[]).map((a) => a.plays[0])).toEqual(['correct', 'wrong', 'combo', 'level-up', 'boss'])
      const pack = await json<Pack>(courseFile(env, 'hand', 'course', 'pack.json'))
      expect(pack.cues.map((c) => c.on)).toEqual(['music:menu', 'music:unit-u1', 'music:boss', 'music:end', 'correct', 'wrong', 'combo', 'level-up', 'boss'])
      expect((await call('edu_build', { slug: 'hand' })).ok).toBe(true)
      const lint = await call('edu_lint', { slug: 'hand' })
      expect(lint.data, JSON.stringify(lint.data.problems)).toMatchObject({ ok: true, errors: 0 })
      expect((lint.data.problems as { code: string }[]).filter((x) => x.code === 'PLACEHOLDER_ASSET')).toEqual([])
    } finally {
      await env.cleanup()
    }
  }, 150_000)

  it('edu_music_plan with no fallback queues the composer (a model job); a plan set by hand and a locked track survive another plan; a switched-off music is refused', async () => {
    const env = await makePipelineEnv()
    try {
      await handCourse(env, 'hand-model')
      const { call } = toolsOf(env)
      env.mock.on({ role: 'composer' }, () =>
        JSON.stringify({
          music: [{ area: 'menu', mood: 'calm', prompt: 'calm instrumental, light harp and flute', alt: 'Harp on the title screen' }, { area: 'unit-u1', mood: 'peaceful', prompt: 'calm instrumental, soft piano and strings', alt: 'Piano in a round' }, { area: 'boss', mood: 'mysterious-calm', prompt: 'calm instrumental, low strings and a soft drum', alt: 'Strings in the boss round' }, { area: 'end', mood: 'peaceful', prompt: 'calm instrumental, bells and soft piano', alt: 'Bells at the end' }],
          sfx: ['correct', 'wrong', 'combo', 'level-up'].map((event) => ({ event, sound: 'chime', alt: `A chime for ${event}` }))
        })
      )
      const r = await call('edu_music_plan', { slug: 'hand-model' })
      expect(r.ok, r.text).toBe(true)
      const jobId = (r.data.jobs as string[])[0]!
      expect(jobId).toMatch(/^hand-model--asset_music_plan--q/)
      await waitIdle(env, 'hand-model', 60_000)
      expect((await env.engine.jobs.list('done')).find((j) => j.id === jobId)!.data).toMatchObject({ task: 'asset_music_plan', role: 'composer' })
      const plan = await json<MusicPlanFile>(courseFile(env, 'hand-model', 'pipeline', 'music.json'))
      expect(plan).toMatchObject({ source: 'model' })
      expect(plan.sfx.map((s) => s.sound)).toEqual(['chime', 'chime', 'chime', 'chime'])
      await call('edu_asset_generate', { slug: 'hand-model' })
      await waitIdle(env, 'hand-model', 60_000)

      // a prompt set by hand and a locked track stay when the plan runs again
      expect((await call('edu_asset_set', { slug: 'hand-model', id: 'mus-menu', prompt: 'my own harp prompt' })).ok).toBe(true)
      expect((await call('edu_asset_lock', { slug: 'hand-model', id: 'mus-boss', locked: true })).ok).toBe(true)
      await call('edu_music_plan', { slug: 'hand-model', fallback: true })
      const list = (await call('edu_asset_list', { slug: 'hand-model', kind: 'music' })).data.assets as { id: string; prompt: string; locked: boolean; selected: number }[]
      expect(list.find((a) => a.id === 'mus-menu')).toMatchObject({ prompt: 'my own harp prompt', selected: 1 })
      expect(list.find((a) => a.id === 'mus-boss')).toMatchObject({ locked: true, selected: 1 })
      const before = audioRequests(env).length
      await call('edu_asset_generate', { slug: 'hand-model', force: true, kind: 'music' })
      await waitIdle(env, 'hand-model', 60_000)
      expect(audioRequests(env)).toHaveLength(before + 3) // menu, u1, end again; the locked boss track is never touched
      expect(audioRequests(env).some((x) => x.prompt === 'my own harp prompt')).toBe(true)

      const off = await call('edu_media_settings', { slug: 'hand-model', set: { music: { enabled: false } } })
      expect(off.ok, off.text).toBe(true)
      expect((await call('edu_music_plan', { slug: 'hand-model', fallback: true })).text).toMatch(/media\.music\.enabled is false/)
      expect((await call('edu_asset_generate', { slug: 'hand-model', kind: 'music' })).text).toMatch(/media\.music\.enabled is false/)
      expect((await call('edu_music_plan', { slug: 'nope', fallback: true })).text).toMatch(/no course "nope"/)
      // a sound has no per-asset picture provider; and with the music switched off the next re-link takes the cues out of the pack
      expect((await call('edu_asset_set', { slug: 'hand-model', id: 'mus-menu', provider: 'flow' })).text).toMatch(/is a sound.*media\.music\.provider/)
      expect((await json<Pack>(courseFile(env, 'hand-model', 'course', 'pack.json'))).cues.length).toBeGreaterThan(0)
      expect((await call('edu_asset_select', { slug: 'hand-model', id: 'mus-menu', version: 1 })).ok).toBe(true)
      expect((await json<Pack>(courseFile(env, 'hand-model', 'course', 'pack.json'))).cues).toEqual([])
    } finally {
      await env.cleanup()
    }
  }, 150_000)
})

// ---- the real autoplay bot and the real player on a pipeline course with art and music, only where Chromium is installed ----

async function chromiumAvailable(): Promise<string | null> {
  try {
    const { chromium } = await import('playwright')
    const b = await chromium.launch()
    await b.close()
    return null
  } catch (e) {
    return e instanceof Error ? (e.message.split('\n')[0] ?? 'unknown error') : String(e)
  }
}
const unavailable = await chromiumAvailable()
if (unavailable) console.warn(`[music-pipeline] the real-bot tests are SKIPPED: Chromium cannot be launched (${unavailable}). Run "yarn playwright install chromium".`)

describe.skipIf(!!unavailable)('the real autoplay bot and the real player play a course with art and music', () => {
  it('the bot plays with sound on: 0 console errors and 0 media errors, every image and audio file of the build was loaded; a broken sound is a media error that fails the run', async () => {
    const env = await makePipelineEnv({ playtest: (dir, opts) => runPlaytest(dir, { ...opts, personas: ['perfect', 'average'], concurrency: 1, timeoutMs: 200_000 }) })
    try {
      await run(env, BRIEF_RPG, 200_000)
      const p = await pipelineOf(env)
      expect(p.stage, JSON.stringify(p.blockedBy ?? p.failed)).toBe('published')
      const play = await json<{ ok: boolean; runs: { persona: string; summary: { finished: boolean; consoleErrors: number; mediaErrors: number; media: { checked: boolean; images: number; audio: number } } }[] }>(pf(env, 'playtest.json'))
      expect(play.ok).toBe(true)
      for (const r of play.runs) {
        expect([r.summary.finished, r.summary.consoleErrors, r.summary.mediaErrors], r.persona).toEqual([true, 0, 0])
        expect(r.summary.media).toEqual({ checked: true, images: 10, audio: 12 })
      }

      // a sound that does not decode: the bot reports it as a media error and the run fails, like a console error
      const build = courseFile(env, SLUG, 'build')
      await writeFile(path.join(build, 'assets', 'sfx-correct', 'v1.wav'), 'this is not audio')
      const bad = await runPlaytest(build, { personas: ['perfect'], timeoutMs: 120_000 })
      expect(bad.ok).toBe(false)
      expect(bad.runs[0]!.summary!.mediaErrors).toBeGreaterThanOrEqual(1)
      expect(bad.failures.some((f) => /media: sfx-correct \(assets\/sfx-correct\/v1\.wav\)/.test(f))).toBe(true)
    } finally {
      await env.cleanup()
    }
  }, 400_000)

  it('in the real player: the menu music starts, "reduce audio" and "sounds" stop it and are kept with the progress, a round starts the unit\'s music, and a broken file is a console error', async () => {
    const env = await makePipelineEnv()
    try {
      await run(env, BRIEF, 120_000)
      expect((await pipelineOf(env)).stage).toBe('published')
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const page = await browser.newPage()
        const errors: string[] = []
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(m.text())
        })
        page.on('pageerror', (e) => errors.push(String(e)))
        // every Audio element the player makes is recorded (the browser may refuse to play before a click; what the player does with the elements is what counts)
        await page.addInitScript(
          `window.__made = []; const Native = window.Audio; window.Audio = function (src) { const el = new Native(src); window.__made.push({ src: String(src || ''), el }); return el }`
        )
        const url = `file:///${courseFile(env, SLUG, 'build', 'index.html').replace(/\\/g, '/')}`
        await page.goto(url)
        await page.waitForSelector('[data-testid="course-title"]')
        const made = (): Promise<{ src: string; paused: boolean; volume: number; loop: boolean }[]> => page.evaluate("window.__made.map((m) => ({ src: m.src.replace(/^.*\\/assets\\//, 'assets/'), paused: m.el.paused, volume: m.el.volume, loop: m.el.loop }))")
        // the menu music: one track, looping, fading in
        await expect.poll(async () => (await made()).filter((m) => m.src === 'assets/mus-menu/v1.wav').length).toBe(1)
        await expect.poll(async () => (await made()).find((m) => m.src === 'assets/mus-menu/v1.wav')!.volume, { timeout: 5000 }).toBeGreaterThan(0.3)
        expect((await made()).find((m) => m.src === 'assets/mus-menu/v1.wav')).toMatchObject({ loop: true })

        // "reduce audio" is next to the sound toggle; turning it on stops the music at once and is kept with the progress
        expect(await page.locator('[data-testid="setting-sound"]').count()).toBe(1)
        await page.locator('[data-testid="setting-reduce-audio"]').check()
        expect((await made()).find((m) => m.src === 'assets/mus-menu/v1.wav')!.paused).toBe(true)
        expect(await page.evaluate("Object.entries(localStorage).filter(([k]) => k.startsWith('edu-studio:progress:')).map(([, v]) => JSON.parse(v).settings)")).toEqual([expect.objectContaining({ reduceAudio: true, sound: true })])
        await page.reload()
        await page.waitForSelector('[data-testid="course-title"]')
        expect(await page.locator('[data-testid="setting-reduce-audio"]').isChecked()).toBe(true)
        expect((await made()).filter((m) => m.src.includes('/mus-'))).toEqual([]) // no music at all while audio is reduced

        // off again: the menu music is back; starting a unit round changes the music to the unit's track, one at a time
        await page.locator('[data-testid="setting-reduce-audio"]').uncheck()
        await expect.poll(async () => (await made()).filter((m) => m.src === 'assets/mus-menu/v1.wav').length).toBe(1)
        await page.locator('[data-testid="start"]').click()
        await page.locator('[data-testid="unit-u1"]').click()
        await expect.poll(async () => (await made()).some((m) => m.src === 'assets/mus-unit-u1/v1.wav')).toBe(true)
        await expect.poll(async () => (await made()).filter((m) => m.src.includes('/mus-') && !m.paused).length, { timeout: 5000 }).toBe(1)
        expect(errors).toEqual([])
      } finally {
        await browser.close()
      }
    } finally {
      await env.cleanup()
    }
  }, 240_000)
})
