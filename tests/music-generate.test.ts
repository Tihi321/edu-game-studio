import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateAll, generateAsset } from '../src/engine/assets/generate'
import { resolveFile } from '../src/engine/assets/manifest'
import { PLACEHOLDER_AUDIO_FILE, writePlaceholder } from '../src/engine/assets/placeholder'
import { AUDIO_KINDS } from '../src/shared/media'
import type { AssetEntry } from '../src/shared/media'
import { entryOf, genKit } from './assets-fixtures'
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
})

describe('Flow Music only with the explicit opt-in', () => {
  it('without flowCredits nothing is called, even when the entry says flow-music', async () => {
    for (const settings of [{}, { music: { provider: 'flow' } }, { music: { flowCredits: true } }]) {
      const r = await generateAsset(kit.ctx({ media: settings, flow: kit.flow }), track('mus-menu', 'flow-music'))
      expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Flow Music spends credits.*flowCredits: true/) })
    }
    expect(kit.flow.calls).toEqual([])
  })
})

describe('generateAll and the silent placeholders', () => {

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
