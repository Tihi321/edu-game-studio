import { describe, expect, it } from 'vitest'
import { checkMusicPlan, fallbackMusicLines, mergeMusicPlan, musicPlanSchema, resolveMusicEntries, trackProvider } from '../src/engine/edu/music'
import type { MusicPlanOutput, MusicSource } from '../src/engine/edu/music'
import { CHIP_SOUNDS } from '../src/engine/studios/chip-sound'
import { musicAreas } from '../src/shared/music'
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

describe('the answer: schema and checks', () => {

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

  it('Flow Music needs the opt-in: provider flow alone gives the default provider and a warning', () => {
    const warnings: string[] = []
    expect(trackProvider(media({ music: { provider: 'flow' } }), ['menu'], warnings)).toBe('comfy')
    expect(warnings.join()).toMatch(/spends credits.*flowCredits is not true/)
    expect(trackProvider(media({ music: { provider: 'flow', flowCredits: true } }), ['menu'])).toBe('flow')
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
