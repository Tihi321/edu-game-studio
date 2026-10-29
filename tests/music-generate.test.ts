import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateAll, generateAsset } from '../src/engine/assets/generate'
import { resolveFile, loadManifest } from '../src/engine/assets/manifest'
import { PLACEHOLDER_AUDIO_FILE, writePlaceholder } from '../src/engine/assets/placeholder'
import { pickChipSound } from '../src/engine/studios/chip-sound'
import { FlowError } from '../src/engine/studios/flow'
import { countFlowSongs } from '../src/engine/studios/flow-music'
import { AUDIO_KINDS, flowMusicAllowed, resolveMusicProvider } from '../src/shared/media'
import type { AssetEntry } from '../src/shared/media'
import { entryOf, genKit, media } from './assets-fixtures'
import type { GenKit } from './assets-fixtures'

/**
 * The audio branches of `generateAsset` (EGS-16), ported from VN Studio's `chiptune-sfx`, `flow-music` and the music part of `studios-generate`, and
 * adapted to a course: Chiptune Studio makes tracks (with loop points) and sound effects, ComfyUI (ACE-Step) the other music, Flow Music only on the
 * explicit opt-in and under the cap. Fakes only: every file they write is a real PCM wav.
 */

let kit: GenKit
beforeEach(async () => {
  kit = await genKit()
})
afterEach(async () => {
  await kit.done()
})

const must = async (p: ReturnType<typeof generateAsset>) => {
  const r = await p
  if (!r.ok || r.skipped) throw new Error(`expected a version: ${JSON.stringify(r)}`)
  return r
}
const track = (id: string, engine: string, over: Partial<AssetEntry> = {}): AssetEntry => ({ ...entryOf(id, 'music'), engine, ...over })
const sfx = (id: string, engine = 'chiptune', over: Partial<AssetEntry> = {}): AssetEntry => ({ ...entryOf(id, 'sfx'), engine, ...over })
const isWav = async (file: string) => (await readFile(file)).subarray(0, 4).toString() === 'RIFF'
const FLOW = { music: { provider: 'flow', flowCredits: true } }

describe('pickChipSound', () => {
  it('matches the key first, then the description, and says when it guessed', () => {
    expect(pickChipSound('sfx', 'bell', 'a ship bell')).toEqual({ sound: 'chime', guessed: false })
    expect(pickChipSound('sfx', 'knock', 'someone at the oak door')).toEqual({ sound: 'door', guessed: false })
    expect(pickChipSound('sfx', 'sting', 'a loud thunder clap')).toEqual({ sound: 'thunder', guessed: false })
    expect(pickChipSound('sfx', 'zzz', 'something odd')).toEqual({ sound: 'blip', guessed: true })
    expect(pickChipSound('ambience', 'waves', 'waves on the pier')).toEqual({ sound: 'waves', guessed: false })
    expect(pickChipSound('ambience', 'x', 'silence')).toEqual({ sound: 'drone', guessed: true })
  })
})

describe('which engine makes what', () => {
  it('Flow Music is never a default: a pixel course picks chiptune, a plain one ComfyUI; only provider flow AND flowCredits allow it', () => {
    expect(resolveMusicProvider(media({ art: { style: 'pixel' } }))).toBe('chiptune')
    expect(resolveMusicProvider(media())).toBe('comfy')
    expect(resolveMusicProvider(media(FLOW))).toBe('flow')
    expect(flowMusicAllowed(media())).toBe(false)
    expect(flowMusicAllowed(media({ music: { provider: 'flow' } }))).toBe(false) // the provider alone is not the opt-in
    expect(flowMusicAllowed(media({ music: { flowCredits: true } }))).toBe(false) // the credits alone are not either
    expect(flowMusicAllowed(media(FLOW))).toBe(true)
    expect(flowMusicAllowed(media({ art: { provider: 'flow' } }))).toBe(false) // the art provider flow does not choose music
  })

  it('counts the songs a course has made from its versions', () => {
    const v = (engine: string) => ({ n: 1, file: 'v1.mp3', createdAt: 'x', seed: null, engine, prompt: 'p' })
    expect(countFlowSongs([{ versions: [v('flow-music'), v('flow-music')] }, { versions: [v('chiptune')] }, { versions: [v('flow-music')] }])).toBe(3)
  })
})

describe('music from Chiptune Studio', () => {
  it('composes, renders, saves the song, and stores the loop points and the song file on the version', async () => {
    const r = await must(generateAsset(kit.ctx({ audioOf: () => ({ chip: { mood: 'peaceful', chip: 'nes', bpm: 70, key: 'G', bars: 24 }, seconds: 60 }) }), track('mus-menu', 'chiptune')))
    expect(r.version).toMatchObject({ n: 1, file: 'v1.wav', songFile: 'v1.song', loopStartSec: 2, loopEndSec: 41.5, engine: 'chiptune', seed: 4242 })
    expect(r.entry).toMatchObject({ selected: 1, source: 'generated' })
    expect(kit.chiptune.calls.map((c) => c.tool)).toEqual(['compose_track', 'render_audio', 'save_song', 'delete_song'])
    expect(kit.chiptune.calls[0]!.args).toMatchObject({ loop: true, mood: 'peaceful', chip: 'nes', bpm: 70, key: 'G', bars: 24 })
    const file = resolveFile(kit.dir, r.entry)!
    expect(file).toBe(path.join(kit.dir, 'assets', 'mus-menu', 'v1.wav'))
    expect(await isWav(file)).toBe(true)
    expect(existsSync(path.join(kit.dir, 'assets', 'mus-menu', 'v1.song'))).toBe(true)
    expect(kit.comfy.requests).toHaveLength(0)
  })

  it('without a plan the deterministic plan is used; a studio without ffmpeg gives a warning on the version', async () => {
    kit.chiptune.noFfmpeg = true
    const r = await must(generateAsset(kit.ctx({ media: { music: { chip: 'gb' } } }), track('mus-menu', 'chiptune')))
    expect(kit.chiptune.calls[0]!.args).toMatchObject({ chip: 'gb', loop: true })
    expect(r.version.warnings?.join(' ')).toMatch(/ffmpeg/)
  })

  it('a new version never overwrites the earlier file', async () => {
    const first = await must(generateAsset(kit.ctx(), track('mus-menu', 'chiptune')))
    const second = await must(generateAsset(kit.ctx(), first.entry, { force: true }))
    expect(second.version.file).toBe('v2.wav')
    expect(existsSync(path.join(kit.dir, 'assets', 'mus-menu', 'v1.wav'))).toBe(true)
  })

  it('without the studio it fails with the start hint, and the entry is unchanged', async () => {
    kit.chiptune.down = true
    const e = track('mus-menu', 'chiptune')
    const r = await generateAsset(kit.ctx(), e)
    expect(r).toMatchObject({ ok: false, entry: e, error: expect.stringContaining('yarn build && yarn mcp') })
  })
})

describe('sound effects from Chiptune Studio', () => {
  it('compose_sfx gets the planned sound, a path in the asset folder and the chosen chip; the version is a one-shot (no loop points)', async () => {
    const r = await must(generateAsset(kit.ctx({ media: { music: { chip: 'dreamcast' } }, audioOf: () => ({ sound: 'coin', prompt: 'a bright reward' }) }), sfx('sfx-correct')))
    expect(kit.chiptune.calls.map((c) => c.tool)).toEqual(['compose_sfx', 'save_song', 'delete_song'])
    const args = kit.chiptune.calls[0]!.args as { kind: string; sound: string; path: string; chip?: string; seconds?: number }
    expect(args).toMatchObject({ kind: 'sfx', sound: 'coin', chip: 'dreamcast' })
    expect(args.seconds).toBeUndefined()
    expect(path.isAbsolute(args.path)).toBe(true)
    expect(r.version).toMatchObject({ n: 1, file: 'v1.wav', engine: 'chiptune', songFile: 'v1.song', loopStartSec: null, loopEndSec: null })
    expect(await isWav(path.join(kit.dir, 'assets', 'sfx-correct', 'v1.wav'))).toBe(true)
    expect(r.version.warnings).toBeUndefined()
    expect(kit.comfy.requests).toHaveLength(0)
  })

  it('every event of the quiz arena gets its sound', async () => {
    const sounds: Record<string, string> = { correct: 'coin', wrong: 'cancel', combo: 'magic', 'level-up': 'powerup', boss: 'alert' }
    for (const [event, sound] of Object.entries(sounds)) await must(generateAsset(kit.ctx({ audioOf: () => ({ sound }) }), sfx(`sfx-${event}`)))
    expect(kit.chiptune.calls.filter((c) => c.tool === 'compose_sfx').map((c) => (c.args as { sound: string }).sound)).toEqual(Object.values(sounds))
  })

  it('with no plan the sound is picked from the id, and an unmatched one uses a fallback and says so', async () => {
    const r = await must(generateAsset(kit.ctx(), sfx('sfx-knock')))
    expect(kit.chiptune.calls[0]!.args).toMatchObject({ sound: 'door' })
    expect(r.version.warnings).toBeUndefined()
    const odd = await must(generateAsset(kit.ctx(), sfx('sfx-zzz')))
    expect(kit.chiptune.calls[3]!.args).toMatchObject({ sound: 'blip' })
    expect(odd.version.warnings?.join(' ')).toMatch(/no Chiptune Studio sound matches "sfx-zzz": used blip/)
  })

  it('an ambience calls compose_sfx in ambience mode and keeps the loop points', async () => {
    const r = await must(generateAsset(kit.ctx(), { ...entryOf('amb-waves', 'ambience'), engine: 'chiptune' }))
    expect(kit.chiptune.calls[0]).toMatchObject({ tool: 'compose_sfx', args: { kind: 'ambience', seconds: 60 } })
    expect(r.version).toMatchObject({ file: 'v1.wav', loopStartSec: 0, loopEndSec: 60 })
  })

  it('a ComfyUI audio engine makes an effect through the ComfyUI fake; sfxEngine none keeps it import-only (a failure that gets a placeholder)', async () => {
    const r = await must(generateAsset(kit.ctx(), sfx('sfx-correct', 'ace-step-v1-instrumental', { prompt: 'a bright ding' })))
    expect(kit.comfy.requests[0]).toMatchObject({ engine: 'ace-step-v1-instrumental', seconds: 5, prompt: 'a bright ding' })
    expect(r.version).toMatchObject({ engine: 'ace-step-v1-instrumental', file: 'v1.wav' })
    expect(await isWav(path.join(kit.dir, 'assets', 'sfx-correct', 'v1.wav'))).toBe(true)
    expect(kit.chiptune.calls).toHaveLength(0)
    const none = await generateAsset(kit.ctx({ media: { sound: { sfxEngine: 'none' } } }), sfx('sfx-wrong', 'none'))
    expect(none).toMatchObject({ ok: false, error: expect.stringMatching(/made by hand.*edu_asset_replace/) })
  })

  it('a locked or custom file is never overwritten', async () => {
    expect(await generateAsset(kit.ctx(), sfx('sfx-a', 'chiptune', { source: 'custom', locked: true }))).toMatchObject({ ok: true, skipped: true })
    expect(await generateAsset(kit.ctx(), track('mus-a', 'chiptune', { locked: true }))).toMatchObject({ ok: true, skipped: true, reason: 'locked' })
    expect(kit.chiptune.calls).toHaveLength(0)
  })
})

describe('music from ComfyUI (ACE-Step)', () => {
  it('makes the track with the plan prompt and length through the ComfyUI fake, a real wav on disk', async () => {
    const r = await must(generateAsset(kit.ctx({ audioOf: () => ({ prompt: 'calm instrumental, soft piano', seconds: 75 }) }), track('mus-unit-u1', 'ace-step-v1-instrumental', { prompt: 'calm instrumental, soft piano' })))
    expect(kit.comfy.requests).toHaveLength(1)
    expect(kit.comfy.requests[0]).toMatchObject({ engine: 'ace-step-v1-instrumental', prompt: 'calm instrumental, soft piano', seconds: 75 })
    expect(r.version).toMatchObject({ n: 1, file: 'v1.wav', engine: 'ace-step-v1-instrumental', prompt: 'calm instrumental, soft piano' })
    expect(r.version.loopStartSec).toBeUndefined() // no loop points: the player repeats the whole file
    expect(await isWav(path.join(kit.dir, 'assets', 'mus-unit-u1', 'v1.wav'))).toBe(true)
    expect(kit.chiptune.calls).toHaveLength(0)
  })

  it('a prompt left over from Chiptune Studio is not sent to a model', async () => {
    await must(generateAsset(kit.ctx({ audioOf: () => ({ prompt: 'calm instrumental, harp' }) }), track('mus-menu', 'ace-step-v1-instrumental', { prompt: 'chiptune: peaceful, snes, 72 bpm, key C, 32 bars' })))
    expect(kit.comfy.requests[0]!.prompt).toBe('calm instrumental, harp')
  })

  it('ComfyUI down fails with the reason, the entry unchanged', async () => {
    kit.comfy.down = true
    const e = track('mus-menu', 'ace-step-v1-instrumental')
    expect(await generateAsset(kit.ctx(), e)).toMatchObject({ ok: false, entry: e, error: expect.stringMatching(/ComfyUI/) })
  })
})

describe('Flow Music only with the explicit opt-in', () => {
  it('without flowCredits nothing is called, even when the entry says flow-music', async () => {
    for (const settings of [{}, { music: { provider: 'flow' } }, { music: { flowCredits: true } }]) {
      const r = await generateAsset(kit.ctx({ media: settings, flow: kit.flow }), track('mus-menu', 'flow-music'))
      expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Flow Music spends credits.*flowCredits: true/) })
    }
    expect(kit.flow.calls).toEqual([])
  })

  it('with the opt-in: asks for an instrumental, finds the loop, keeps the whole song and the song id', async () => {
    const r = await must(generateAsset(kit.ctx({ media: FLOW, flow: kit.flow, audioOf: () => ({ prompt: 'calm instrumental, warm piano' }) }), track('mus-menu', 'flow-music')))
    expect(r.version).toMatchObject({ n: 1, file: 'v1.mp3', engine: 'flow-music', seed: null, loopStartSec: 0, loopEndSec: 52, remote: { provider: 'flow-music', id: expect.stringMatching(/^song-/) } })
    const song = kit.flow.calls.find((c) => c.tool === 'music_generate')!.args as { sound: string; title: string; format: string; loopFriendly: boolean; name: string }
    expect(song).toMatchObject({ title: 'demo mus-menu', format: 'mp3', loopFriendly: true, name: 'v1.src', sound: 'calm instrumental, warm piano' })
    expect(kit.flow.calls.map((c) => c.tool)).toEqual(['music_generate', 'music_loop'])
    expect(await isWav(path.join(kit.dir, 'assets', 'mus-menu', 'v1.mp3'))).toBe(true) // the fake's content is real audio whatever the extension
    expect(r.version.warnings?.join(' ')).toMatch(/spent 5 credit/)
  })

  it('at the song cap nothing is called; raising the cap lets it through', async () => {
    const r = await generateAsset(kit.ctx({ media: FLOW, flow: kit.flow, flowSongs: { made: 4 } }), track('mus-menu', 'flow-music'))
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Flow Music cap reached \(4 song\(s\)\).*flowMusicMaxSongs/) })
    expect(kit.flow.calls).toHaveLength(0)
    const raised = await must(generateAsset(kit.ctx({ media: FLOW, flow: kit.flow, flowSongs: { made: 4 }, flowOptions: { quality: { background: 'upscaled', cover: 'upscaled', cg: 'upscaled', sheet: 'original', sprite: 'original', insert: 'original' }, jobTimeoutMs: 1000, musicTimeoutMs: 1000, maxSongs: 5 } }), track('mus-menu', 'flow-music')))
    expect(raised.version.engine).toBe('flow-music')
  })

  it('counts every song it makes toward the cap', async () => {
    const flowSongs = { made: 0 }
    await must(generateAsset(kit.ctx({ media: FLOW, flow: kit.flow, flowSongs }), track('mus-menu', 'flow-music')))
    await must(generateAsset(kit.ctx({ media: FLOW, flow: kit.flow, flowSongs }), track('mus-boss', 'flow-music')))
    expect(flowSongs.made).toBe(2)
  })

  it('a loop that is not good, or a loop tool that fails, leaves the whole song without loop points and a warning', async () => {
    kit.flow.loopScore = 0.2
    const a = await must(generateAsset(kit.ctx({ media: FLOW, flow: kit.flow }), track('mus-menu', 'flow-music')))
    expect(a.version).toMatchObject({ file: 'v1.mp3', loopStartSec: null, loopEndSec: null })
    expect(a.version.warnings?.join(' ')).toMatch(/no seamless loop was found \(seam score 0\.20\).*repeats from its start/)
    kit.flow.loopScore = 0.9
    kit.flow.loopError = new Error('ffmpeg is not installed')
    const b = await must(generateAsset(kit.ctx({ media: FLOW, flow: kit.flow }), track('mus-boss', 'flow-music')))
    expect(b.version).toMatchObject({ loopStartSec: null })
    expect(b.version.warnings?.join(' ')).toMatch(/no loop was made \(ffmpeg is not installed\)/)
  })

  it('a song that fails is an error and the entry is unchanged; a locked track is not touched', async () => {
    kit.flow.songError = new FlowError('Flow Music is out of credits', 'tool')
    const entry = track('mus-menu', 'flow-music')
    expect(await generateAsset(kit.ctx({ media: FLOW, flow: kit.flow }), entry)).toMatchObject({ ok: false, error: 'Flow Music is out of credits' })
    expect(await generateAsset(kit.ctx({ media: FLOW, flow: kit.flow }), { ...entry, locked: true })).toMatchObject({ ok: true, skipped: true })
    expect(kit.flow.calls.filter((c) => c.tool === 'music_generate')).toHaveLength(1)
  })
})

describe('generateAll and the silent placeholders', () => {
  it('makes only the audio kinds when asked, saves after each asset, and skips what has a file (resumable)', async () => {
    const manifest = { assets: [track('mus-menu', 'chiptune'), sfx('sfx-correct'), entryOf('img-a', 'illustration')] }
    const res = await generateAll(kit.ctx(), manifest, { kinds: AUDIO_KINDS })
    expect(res.generated).toEqual(['mus-menu', 'sfx-correct']) // the picture is not an audio kind
    expect(kit.comfy.requests).toHaveLength(0)
    expect((await loadManifest(kit.dir)).assets.map((a) => [a.id, a.selected])).toEqual([['mus-menu', 1], ['sfx-correct', 1], ['img-a', null]]) // the picture is left as it was
    const again = await generateAll(kit.ctx(), res.manifest, { kinds: AUDIO_KINDS })
    expect(again).toMatchObject({ generated: [], skipped: ['mus-menu', 'sfx-correct'] })
    expect(kit.chiptune.calls.filter((c) => c.tool === 'compose_track')).toHaveLength(1)
  })

  it('a provider that is down is a placeholder, not a failure: a silent wav named placeholder, recorded on the entry, replaced by the first version', async () => {
    kit.chiptune.down = true
    const manifest = { assets: [sfx('sfx-correct')] }
    const res = await generateAll(kit.ctx(), manifest, { kinds: AUDIO_KINDS, onFailure: (e, error) => writePlaceholder(kit.dir, e, error) })
    expect(res.failed).toEqual([{ id: 'sfx-correct', error: expect.stringContaining('not running') }])
    const e = res.manifest.assets[0]!
    expect(e.placeholder).toMatchObject({ file: PLACEHOLDER_AUDIO_FILE, reason: expect.stringContaining('not running') })
    const wav = path.join(kit.dir, 'assets', 'sfx-correct', PLACEHOLDER_AUDIO_FILE)
    expect(await isWav(wav)).toBe(true)
    expect(resolveFile(kit.dir, e)).toBeNull() // no real version: the lint warns PLACEHOLDER_ASSET because of the file name
    kit.chiptune.down = false
    const made = await must(generateAsset(kit.ctx(), e))
    expect(made.entry.placeholder).toBeUndefined()
    expect(existsSync(wav)).toBe(false)
  })
})
