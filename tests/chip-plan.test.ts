import { describe, expect, it } from 'vitest'
import { chipFor, fallbackChipPlan, mergeChipPlan } from '../src/engine/studios/chip-plan'
import { CHIPS, parseCourseMedia } from '../src/shared/media'

/** Ported from VN Studio's `chip-plan` test: the Chiptune Studio track plan (mood, chip, tempo, key, bars) and its fallback. */

const base = fallbackChipPlan('music_01', { genreText: 'kids bedtime' })

describe('ps1 and dreamcast chips', () => {
  it('are chips of the course media settings', () => {
    expect(CHIPS.slice(0, 5)).toEqual(['nes', 'gb', 'genesis', 'snes', 'pce'])
    for (const chip of ['ps1', 'dreamcast']) expect(parseCourseMedia({ music: { chip } }).music.chip).toBe(chip)
    expect(() => parseCourseMedia({ music: { chip: 'amiga' } })).toThrow(/media\.music\.chip/)
  })

  it('mergeChipPlan keeps them and the synth moods, and clamps the tempo by mood', () => {
    expect(mergeChipPlan({ chip: 'ps1', mood: 'darkwave', bpm: 100 }, base)).toMatchObject({ chip: 'ps1', mood: 'darkwave', bpm: 100 })
    expect(mergeChipPlan({ chip: 'dreamcast', mood: 'outrun', bpm: 300 }, base)).toMatchObject({ chip: 'dreamcast', mood: 'outrun', bpm: 118 })
    expect(mergeChipPlan({ mood: 'synthwave', bpm: 112 }, base).bpm).toBe(112)
    expect(mergeChipPlan({ mood: 'calm', bpm: 300 }, base).bpm).toBe(100)
    expect(mergeChipPlan({ mood: 'heavy-metal', bpm: 300 }, base)).toMatchObject({ mood: base.mood, bpm: 100 })
  })

  it('a synth course gets dreamwave on the Dreamcast chip, a 90s course the PS1 chip, a chosen chip wins', () => {
    const synth = { genreText: 'neon 80s synthwave', seconds: 100 }
    expect(fallbackChipPlan('music_01', synth)).toMatchObject({ mood: 'dreamwave', chip: 'dreamcast', bpm: 80 })
    expect(['music_01', 'music_02', 'music_03', 'music_04', 'music_05', 'music_06'].map((id) => fallbackChipPlan(id, synth).mood)).toEqual(['dreamwave', 'synthwave', 'darkwave', 'dreamwave', 'ambient', 'dreamwave'])
    expect(fallbackChipPlan('music_02', synth).bpm).toBe(96)
    expect(fallbackChipPlan('music_01', { genreText: '90s coming of age' }).chip).toBe('ps1')
    expect(fallbackChipPlan('music_01', { genreText: '90s coming of age' }).mood).toBe('peaceful')
    expect(chipFor({ chip: 'nes', genreText: 'neon synthwave' })).toBe('nes')
    expect(chipFor({ palette: 'gameboy', genreText: 'neon synthwave' })).toBe('gb')
  })

  it('a course that is not synth or 90s keeps exactly the plan it had', () => {
    expect(fallbackChipPlan('music_01', { genreText: 'mystery detective', seconds: 100 })).toEqual({ mood: 'mysterious-calm', chip: 'snes', bpm: 72, key: 'C', bars: 32 })
    expect(fallbackChipPlan('music_02', { genreText: 'mystery detective', seconds: 100 })).toEqual({ mood: 'peaceful', chip: 'snes', bpm: 66, key: 'F', bars: 28 })
    expect(fallbackChipPlan('music_01', { genreText: 'kids bedtime', seconds: 100 })).toEqual({ mood: 'lullaby', chip: 'snes', bpm: 72, key: 'C', bars: 32 })
    expect(fallbackChipPlan('music_02', { genreText: 'a quiet novel', seconds: 100 })).toEqual({ mood: 'ambient', chip: 'snes', bpm: 66, key: 'F', bars: 28 })
    expect(fallbackChipPlan('music_01', { genreText: 'space sci-fi cyber', seconds: 100 })).toMatchObject({ mood: 'ambient', chip: 'snes' })
  })
})
