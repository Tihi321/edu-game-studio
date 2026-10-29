import { describe, expect, it } from 'vitest'
import { applyMedia } from '../src/engine/edu/media-link'
import { checkMusicPlan, fallbackMusicLines, mergeMusicPlan, musicPlanSchema, musicPromptVars, resolveMusicEntries, sfxEngineOf, trackProvider } from '../src/engine/edu/music'
import type { MusicPlanOutput, MusicSource } from '../src/engine/edu/music'
import { CHIP_SOUNDS } from '../src/engine/studios/chip-sound'
import { cuesOfPlan, musicAreas, musicAssetId, sfxAssetId, unitArea } from '../src/shared/music'
import type { MusicPlanFile } from '../src/shared/music'
import type { AssetEntry } from '../src/shared/media'
import { media } from './assets-fixtures'

/**
 * The composer's contract (EGS-16): the areas and events a course needs, the output schema and its checks (what the repair round is for), the
 * deterministic fallback plan, stable ids across runs, providers per area, and how a plan lands in the manifest and the pack.
 */

const src = (over: Partial<MusicSource> = {}): MusicSource => ({
  title: 'The Roman Empire',
  subject: 'The Roman Empire',
  audience: 'teenagers',
  age: '14',
  language: 'English',
  units: [{ id: 'u1', title: 'The Republic' }, { id: 'u2', title: 'The Empire' }],
  shells: ['quiz-arena'],
  genreText: 'The Roman Empire teenagers',
  ...over
})
const RPG = { shells: ['quiz-arena', 'rpg'] }

const lineOf = (area: string, extra: Record<string, unknown> = {}) => ({ area, mood: 'peaceful', prompt: `calm instrumental, soft piano, for ${area}`, alt: `The music of ${area}`, ...extra })
const sfxLines = ['correct', 'wrong', 'combo', 'level-up'].map((event) => ({ event, sound: 'coin', alt: `The sound of ${event}` }))
const full = (s: MusicSource): MusicPlanOutput => musicPlanSchema.parse({ music: musicAreas({ units: s.units, shells: s.shells }).map((a) => lineOf(a.area)), sfx: sfxLines })

describe('the areas and the ids', () => {
  it('menu, one per unit, boss and end; the castle and the RPG add their own; ids are stable and come from what they play in', () => {
    expect(musicAreas({ units: src().units, shells: ['quiz-arena'] }).map((a) => a.area)).toEqual(['menu', 'unit-u1', 'unit-u2', 'boss', 'end'])
    expect(musicAreas({ units: src().units, shells: ['quiz-arena', 'mindmaze', 'rpg'] }).map((a) => a.area)).toEqual(['menu', 'unit-u1', 'unit-u2', 'boss', 'end', 'castle', 'rpg-overworld', 'rpg-battle'])
    expect(musicAssetId('unit-u1')).toBe('mus-unit-u1')
    expect(musicAssetId('rpg-overworld')).toBe('mus-rpg-overworld')
    expect(sfxAssetId('level-up')).toBe('sfx-level-up')
    expect(unitArea('U1')).toBe('unit-u1')
  })
})

describe('the answer: schema and checks', () => {
  it('a complete answer has no problem; nulls are dropped', () => {
    const s = src()
    expect(checkMusicPlan(full(s), s)).toEqual([])
    const withNulls = musicPlanSchema.parse({ music: musicAreas({ units: s.units, shells: s.shells }).map((a) => lineOf(a.area, { bpm: null, chip: null })), sfx: sfxLines, notes: null })
    expect(checkMusicPlan(withNulls, s)).toEqual([])
    expect(() => musicPlanSchema.parse({ music: [], sfx: [] })).toThrow()
    expect(() => musicPlanSchema.parse({ music: [{ area: 'menu' }], sfx: [] })).toThrow() // mood, prompt and alt are needed
  })

  it('says which areas and events are missing, which are unknown, and which are covered twice', () => {
    const s = src(RPG)
    const answer = musicPlanSchema.parse({ music: [lineOf('menu'), lineOf('unit-u1'), lineOf('unit-u1'), lineOf('lobby')], sfx: [{ event: 'correct', alt: 'x' }, { event: 'fanfare', alt: 'x' }] })
    const p = checkMusicPlan(answer, s)
    const text = p.map((x) => `${x.ref}: ${x.issue}`).join('\n')
    expect(text).toMatch(/lobby: no such area/)
    expect(text).toMatch(/unit-u1: the area is covered 2 times/)
    expect(text).toMatch(/missing music for: unit-u2, boss, end, rpg-overworld, rpg-battle/)
    expect(text).toMatch(/fanfare: no such event/)
    expect(text).toMatch(/missing sound effects for: wrong, combo, level-up/)
  })

  it('a unit line may merge the other units (units: [...]) and then they are covered; only a unit line may', () => {
    const s = src()
    const merged = musicPlanSchema.parse({ music: [lineOf('menu'), lineOf('unit-u1', { units: ['u2'] }), lineOf('boss'), lineOf('end')], sfx: sfxLines })
    expect(checkMusicPlan(merged, s)).toEqual([])
    const bad = musicPlanSchema.parse({ music: [lineOf('menu', { units: ['u1'] }), lineOf('unit-u2'), lineOf('boss'), lineOf('end')], sfx: sfxLines })
    expect(checkMusicPlan(bad, s).map((x) => x.issue).join('|')).toMatch(/only a unit-<id> line can merge/)
  })

  it('a prompt too short to compose from is a problem', () => {
    const s = src()
    const a = full(s)
    a.music[0]!.prompt = 'nice'
    expect(checkMusicPlan(a, s).map((x) => x.issue).join('|')).toMatch(/too short/)
  })
})

describe('the deterministic fallback', () => {
  it('covers every area and every required event, is the same every time, and passes the contract', () => {
    for (const s of [src(), src(RPG), src({ shells: ['quiz-arena', 'mindmaze', 'rpg', 'encyclopedia'] })]) {
      const a = fallbackMusicLines(s)
      expect(fallbackMusicLines(s)).toEqual(a)
      const parsed = musicPlanSchema.parse({ music: a.music, sfx: a.sfx })
      expect(checkMusicPlan(parsed, s), s.shells.join()).toEqual([])
      expect(parsed.music.map((l) => l.area)).toEqual(musicAreas({ units: s.units, shells: s.shells }).map((x) => x.area))
      expect(a.sfx.map((x) => x.event)).toEqual(['correct', 'wrong', 'combo', 'level-up', 'boss'])
      for (const x of a.sfx) expect(CHIP_SOUNDS.sfx, x.event).toContain(x.sound)
    }
  })
})

describe('providers per area', () => {
  it('Chiptune Studio makes the castle and RPG music, ComfyUI the rest; a pixel course is Chiptune everywhere; an explicit provider wins', () => {
    const plain = media()
    expect(trackProvider(plain, ['menu'])).toBe('comfy')
    expect(trackProvider(plain, ['unit-u1', 'unit-u2'])).toBe('comfy')
    expect(trackProvider(plain, ['castle'])).toBe('chiptune')
    expect(trackProvider(plain, ['rpg-overworld'])).toBe('chiptune')
    expect(trackProvider(media({ art: { style: 'pixel' } }), ['menu'])).toBe('chiptune')
    expect(trackProvider(media({ music: { provider: 'comfy' } }), ['rpg-battle'])).toBe('comfy')
    expect(trackProvider(media({ music: { provider: 'chiptune' } }), ['menu'])).toBe('chiptune')
  })

  it('Flow Music needs the opt-in: provider flow alone gives the default provider and a warning', () => {
    const warnings: string[] = []
    expect(trackProvider(media({ music: { provider: 'flow' } }), ['menu'], warnings)).toBe('comfy')
    expect(warnings.join()).toMatch(/spends credits.*flowCredits is not true/)
    expect(trackProvider(media({ music: { provider: 'flow', flowCredits: true } }), ['menu'])).toBe('flow')
  })

  it('the sound effects are Chiptune Studio unless sound.sfxEngine says otherwise (none: made by hand)', () => {
    expect(sfxEngineOf(media())).toBe('chiptune')
    expect(sfxEngineOf(media({ sound: { sfxEngine: 'none' } }))).toBe('none')
    expect(sfxEngineOf(media({ sound: { sfxEngine: 'custom:foley' } }))).toBe('custom:foley')
  })
})

describe('from the answer to entries', () => {
  const lines = (s: MusicSource) => full(s)

  it('a track for each area with a stable id, the right provider and a chip plan; a sound for each event with its engine', () => {
    const s = src(RPG)
    const r = resolveMusicEntries(lines(s), s, { media: media(), by: 'model' })
    expect(r.tracks.map((t) => [t.id, t.provider])).toEqual([['mus-menu', 'comfy'], ['mus-unit-u1', 'comfy'], ['mus-unit-u2', 'comfy'], ['mus-boss', 'comfy'], ['mus-end', 'comfy'], ['mus-rpg-overworld', 'chiptune'], ['mus-rpg-battle', 'chiptune']])
    expect(r.tracks[0]).toMatchObject({ areas: ['menu'], loop: true, seconds: 90, by: 'model', mood: 'peaceful', alt: 'The music of menu' })
    expect(r.tracks[0]!.bpm).toBeGreaterThanOrEqual(50)
    expect(r.sfx.map((x) => [x.id, x.event, x.sound, x.engine])).toEqual(['correct', 'wrong', 'combo', 'level-up'].map((e) => [`sfx-${e}`, e, 'coin', 'chiptune']))
    // the same plan twice gives the same ids and the same plan (stable across runs)
    expect(resolveMusicEntries(lines(s), s, { media: media(), by: 'model' })).toEqual(r)
  })

  it('merged units are one track with the first area\'s id and a cue area for each; the chosen chip wins; lengths and moods are repaired', () => {
    const s = src()
    const a = musicPlanSchema.parse({
      music: [lineOf('menu', { seconds: 5, mood: 'heavy-metal', chip: 'amiga', bpm: 400 }), lineOf('unit-u1', { units: ['u2'], seconds: 9999 }), lineOf('boss'), lineOf('end')],
      sfx: sfxLines
    })
    const r = resolveMusicEntries(a, s, { media: media({ music: { chip: 'gb' } }), by: 'model' })
    expect(r.tracks.map((t) => t.id)).toEqual(['mus-menu', 'mus-unit-u1', 'mus-boss', 'mus-end'])
    expect(r.tracks[1]).toMatchObject({ areas: ['unit-u1', 'unit-u2'], seconds: 180 })
    expect(r.tracks[0]).toMatchObject({ seconds: 30, chip: 'gb' })
    expect(r.tracks[0]!.bpm).toBeLessThanOrEqual(100)
    expect(r.tracks[0]!.mood).not.toBe('heavy-metal')
  })

  it('an area the answer left out gets a track from the fallback, so a unit is never silent; a sound with an unknown name gets one picked', () => {
    const s = src()
    const a = musicPlanSchema.parse({ music: [lineOf('menu')], sfx: [{ event: 'correct', sound: 'no-such-sound', alt: 'x' }] })
    const r = resolveMusicEntries(a, s, { media: media(), by: 'model' })
    expect(r.tracks.map((t) => [t.id, t.by])).toEqual([['mus-menu', 'model'], ['mus-unit-u1', 'fallback'], ['mus-unit-u2', 'fallback'], ['mus-boss', 'fallback'], ['mus-end', 'fallback']])
    expect(r.sfx.map((x) => [x.event, x.sound, x.by])).toEqual([['correct', 'coin', 'model'], ['wrong', 'cancel', 'fallback'], ['combo', 'magic', 'fallback'], ['level-up', 'powerup', 'fallback']])
  })

  it('Flow Music is planned only with the opt-in, and the plan says why it is not', () => {
    const s = src()
    const without = resolveMusicEntries(lines(s), s, { media: media({ music: { provider: 'flow' } }), by: 'model' })
    expect(without.tracks.every((t) => t.provider === 'comfy')).toBe(true)
    expect(without.warnings.join()).toMatch(/flowCredits/)
    const withIt = resolveMusicEntries(lines(s), s, { media: media({ music: { provider: 'flow', flowCredits: true } }), by: 'model' })
    expect(withIt.tracks.every((t) => t.provider === 'flow')).toBe(true)
    expect(withIt.warnings).toEqual([])
  })

  it('the prompt of the composer lists every area with its provider, every event, the sounds and the chips', () => {
    const v = musicPromptVars(src(RPG), media())
    expect(String(v.areas)).toMatch(/- menu \(comfy\)/)
    expect(String(v.areas)).toMatch(/- rpg-battle \(chiptune\)/)
    expect(String(v.events)).toMatch(/- correct \(REQUIRED\)/)
    expect(String(v.events)).toMatch(/- boss: /)
    expect(String(v.sounds)).toContain('coin')
    expect(String(v.chips)).toContain('dreamcast')
    expect(v.sfx_engine).toBe('chiptune')
  })
})

describe('into the manifest', () => {
  const plan = (m = media()): Pick<MusicPlanFile, 'tracks' | 'sfx'> => {
    const s = src()
    const r = resolveMusicEntries(full(s), s, { media: m, by: 'model' })
    return { tracks: r.tracks, sfx: r.sfx }
  }

  it('adds an entry per track and sound; a rerun keeps versions, the selection, locks and hand-set prompts, and follows a provider change', () => {
    const first = mergeMusicPlan({ assets: [] }, plan(), media())
    expect(first.assets.map((a) => [a.id, a.kind, a.engine])).toEqual([...['menu', 'unit-u1', 'unit-u2', 'boss', 'end'].map((a) => [`mus-${a}`, 'music', 'ace-step-v1-instrumental']), ...['correct', 'wrong', 'combo', 'level-up'].map((e) => [`sfx-${e}`, 'sfx', 'chiptune'])])
    const made: AssetEntry[] = first.assets.map((a) => (a.id === 'mus-menu' ? { ...a, versions: [{ n: 1, file: 'v1.wav', createdAt: 'x', seed: 1, engine: a.engine, prompt: 'p' }], selected: 1, prompt: 'my prompt', promptByHand: true } : a.id === 'mus-boss' ? { ...a, locked: true, prompt: 'locked prompt' } : a))
    const chip = media({ music: { provider: 'chiptune' } })
    const again = mergeMusicPlan({ assets: made }, plan(chip), chip) // the course switched to Chiptune Studio and the plan was made again
    const byId = (id: string) => again.assets.find((a) => a.id === id)!
    expect(byId('mus-menu')).toMatchObject({ selected: 1, prompt: 'my prompt', promptByHand: true, engine: 'chiptune' }) // kept: version and prompt; the engine follows the course
    expect(byId('mus-boss')).toMatchObject({ locked: true, prompt: 'locked prompt', engine: 'ace-step-v1-instrumental' }) // a locked asset is not touched
    expect(byId('mus-end').engine).toBe('chiptune')
    expect(again.assets).toHaveLength(first.assets.length)
    // an asset the plan no longer names stays in the manifest (nothing is deleted)
    const fewer = { tracks: plan().tracks.slice(0, 1), sfx: [] }
    expect(mergeMusicPlan(again, fewer, media()).assets).toHaveLength(first.assets.length)
  })
})

describe('into the pack: cues and loop points', () => {
  const merged = () => {
    const s = src()
    const r = resolveMusicEntries(musicPlanSchema.parse({ music: [lineOf('menu'), lineOf('unit-u1', { units: ['u2'] }), lineOf('boss'), lineOf('end')], sfx: sfxLines }), s, { media: media(), by: 'model' })
    return { tracks: r.tracks, sfx: r.sfx }
  }

  it('cues: one music cue per area of a track (a merged track has two), one event cue per sound; only for assets that have a file', () => {
    const cues = cuesOfPlan(merged(), () => true)
    expect(cues.filter((c) => c.on.startsWith('music:')).map((c) => [c.id, c.on, c.asset, c.loop])).toEqual([
      ['cue-music-menu', 'music:menu', 'mus-menu', true],
      ['cue-music-unit-u1', 'music:unit-u1', 'mus-unit-u1', true],
      ['cue-music-unit-u2', 'music:unit-u2', 'mus-unit-u1', true],
      ['cue-music-boss', 'music:boss', 'mus-boss', true],
      ['cue-music-end', 'music:end', 'mus-end', true]
    ])
    expect(cues.filter((c) => !c.on.startsWith('music:')).map((c) => [c.on, c.asset, c.loop])).toEqual(['correct', 'wrong', 'combo', 'level-up'].map((e) => [e, `sfx-${e}`, false]))
    expect(cuesOfPlan(merged(), (id) => id === 'sfx-correct').map((c) => c.id)).toEqual(['cue-sfx-correct'])
  })

  it('applyMedia sets the audio assets, the cues and the loop points; the pack\'s own cues stay; cues of an earlier plan that are gone are removed', () => {
    const pack: Record<string, unknown> = { assets: [], cues: [{ id: 'my-cue', on: 'correct', asset: 'mine', loop: false, volume: 1 }, { id: 'cue-music-old', on: 'music:old', asset: 'mus-old', loop: true, volume: 0.5 }], extensions: { pipeline: { run: 1 } } }
    const catalog = { strings: {} as Record<string, string> }
    const plan = merged()
    const assets = [...plan.tracks, ...plan.sfx].map((a) => ({ id: a.id, kind: 'audio' as const, file: `assets/${a.id}/v1.wav`, alt: a.alt }))
    const out = applyMedia(pack, catalog, { assets, targets: {}, cues: cuesOfPlan(plan, () => true), loops: { 'mus-menu': { startSec: 2, endSec: 41.5 } } })
    expect(out).toMatchObject({ assets: 8, cues: 9 })
    expect((pack.cues as { id: string }[]).map((c) => c.id)).toEqual(['my-cue', ...cuesOfPlan(plan, () => true).map((c) => c.id)])
    expect((pack.assets as { id: string; kind: string; alt: string }[]).find((a) => a.id === 'mus-menu')).toEqual({ id: 'mus-menu', kind: 'audio', file: 'assets/mus-menu/v1.wav', alt: 'asset.mus-menu.alt' })
    expect(catalog.strings['asset.mus-menu.alt']).toBe('The music of menu')
    expect(pack.extensions).toEqual({ pipeline: { run: 1 }, audio: { loops: { 'mus-menu': { startSec: 2, endSec: 41.5 } } } })
    // a later merge without that loop removes it, and an empty `audio` is removed from the extensions
    applyMedia(pack, catalog, { assets, targets: {}, cues: [], loops: {} })
    expect(pack.extensions).toEqual({ pipeline: { run: 1 } })
    expect((pack.cues as { id: string }[]).map((c) => c.id)).toEqual(['my-cue'])
    // a merge with no cues leaves the pack's cues alone
    applyMedia(pack, catalog, { assets: [], targets: {} })
    expect((pack.cues as { id: string }[]).map((c) => c.id)).toEqual(['my-cue'])
  })
})
