import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DUCK_FACTOR, FADE_MS, GameAudio, REDUCED_SFX_FACTOR, loopsOf } from '../src/player/audio'
import type { AudioCue, AudioLike, AudioSettings } from '../src/player/audio'
import { exportProgress, newProgress, parseProgress } from '../src/player/progress'
import { loadFixture } from './edu-fixtures'

/**
 * The player's audio (EGS-16) with a fake `Audio`: one track at a time, the area's cue (the menu track as the fallback), a fade, loop points, mute,
 * "reduce audio", autoplay blocked and started at the first gesture, load errors, sound effects and their old names, and the setting kept with the progress.
 */

class FakeAudio implements AudioLike {
  static made: FakeAudio[] = []
  volume = 1
  loop = false
  currentTime = 0
  paused = true
  playCalls = 0
  /** The browser refuses to play (autoplay policy): `play()` rejects until this is false. */
  blocked = false
  private listeners = new Map<string, (() => void)[]>()
  constructor(readonly src: string) {
    FakeAudio.made.push(this)
  }
  play(): Promise<void> {
    this.playCalls++
    if (this.blocked) return Promise.reject(new Error('NotAllowedError'))
    this.paused = false
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
  addEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  fire(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn()
  }
}

const CUES: AudioCue[] = [
  { id: 'cue-music-menu', on: 'music:menu', asset: 'mus-menu', loop: true, volume: 0.5 },
  { id: 'cue-music-unit-u1', on: 'music:unit-u1', asset: 'mus-u1', loop: true, volume: 0.4 },
  { id: 'cue-music-unit-u2', on: 'music:unit-u2', asset: 'mus-u1', loop: true, volume: 0.4 }, // a merged track: the same file in two areas
  { id: 'cue-music-boss', on: 'music:boss', asset: 'mus-boss', loop: true, volume: 0.6 },
  { id: 'cue-sfx-correct', on: 'correct', asset: 'sfx-correct', loop: false, volume: 0.8 },
  { id: 'cue-sfx-wrong', on: 'wrong', asset: 'sfx-wrong', loop: false, volume: 0.8 },
  { id: 'cue-sfx-level-up', on: 'level-up', asset: 'sfx-level-up', loop: false, volume: 0.9 }
]
const ASSETS = { 'mus-menu': 'assets/mus-menu/v1.wav', 'mus-u1': 'assets/mus-unit-u1/v1.wav', 'mus-boss': 'assets/mus-boss/v1.wav', 'sfx-correct': 'assets/sfx-correct/v1.wav', 'sfx-wrong': 'assets/sfx-wrong/v1.wav', 'sfx-level-up': 'assets/sfx-level-up/v1.wav' }

let settings: AudioSettings
let errors: string[]
let gesture: EventTarget
const make = (over: Partial<ConstructorParameters<typeof GameAudio>[0]> = {}) => new GameAudio({ cues: CUES, assets: ASSETS, settings: () => settings, create: (u) => new FakeAudio(u), onError: (m) => errors.push(m), gestureTarget: gesture, ...over })
const alive = () => FakeAudio.made.filter((a) => !a.paused)
const urls = (list: FakeAudio[]) => list.map((a) => a.src)
const settle = () => vi.advanceTimersByTime(FADE_MS + 100)

beforeEach(() => {
  vi.useFakeTimers()
  FakeAudio.made = []
  settings = { sound: true, reduceAudio: false }
  errors = []
  gesture = new EventTarget()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('music', () => {
  it('plays the area\'s track as a loop and fades it in; one track at a time; the old one fades out and stops', () => {
    const a = make()
    a.setArea('menu')
    expect(FakeAudio.made).toHaveLength(1)
    expect(FakeAudio.made[0]).toMatchObject({ src: ASSETS['mus-menu'], loop: true, paused: false, volume: 0 })
    vi.advanceTimersByTime(FADE_MS / 2)
    expect(FakeAudio.made[0]!.volume).toBeGreaterThan(0.1)
    settle()
    expect(FakeAudio.made[0]!.volume).toBeCloseTo(0.5, 5) // the cue's volume
    a.setArea('unit-u1')
    expect(urls(FakeAudio.made)).toEqual([ASSETS['mus-menu'], ASSETS['mus-u1']])
    settle()
    expect(urls(alive())).toEqual([ASSETS['mus-u1']]) // one track at a time
    expect(FakeAudio.made[0]!.volume).toBe(0)
    expect(FakeAudio.made[1]!.volume).toBeCloseTo(0.4, 5)
    expect(a.playing).toMatchObject({ area: 'unit-u1', asset: 'mus-u1' })
  })

  it('the same file in the next area keeps playing (no restart); an area with no cue uses the menu track; nothing wanted stops it', () => {
    const a = make()
    a.setArea('unit-u1')
    settle()
    a.setArea('unit-u2') // a merged track
    expect(FakeAudio.made).toHaveLength(1)
    expect(a.playing).toMatchObject({ area: 'unit-u2' })
    a.setArea('end') // no `music:end` cue: the menu track stands in
    settle()
    expect(urls(alive())).toEqual([ASSETS['mus-menu']])
    expect(a.musicCue('end')?.asset).toBe('mus-menu')
    expect(a.musicCue('menu')?.asset).toBe('mus-menu')
    a.setArea(null)
    settle()
    expect(alive()).toEqual([])
    expect(a.playing).toBeNull()
  })

  it('a course with no music cue plays nothing, and an area whose file is not in the assets is skipped', () => {
    const none = make({ cues: [] })
    none.setArea('menu')
    expect(FakeAudio.made).toEqual([])
    const missing = make({ assets: {} })
    missing.setArea('menu')
    expect(FakeAudio.made).toEqual([])
  })

  it('sound off: nothing plays and the music stops at once; turned on again it starts where the game is', () => {
    const a = make()
    a.setArea('boss')
    settle()
    expect(alive()).toHaveLength(1)
    settings = { sound: false }
    a.refresh()
    expect(alive()).toEqual([]) // at once, no fade
    a.setArea('menu')
    expect(FakeAudio.made).toHaveLength(1) // muted: the new area makes no sound
    a.sfx('correct')
    expect(FakeAudio.made).toHaveLength(1)
    settings = { sound: true }
    a.refresh()
    expect(urls(alive())).toEqual([ASSETS['mus-menu']])
  })

  it('reduce audio: no music at all, and the music is back when it is turned off', () => {
    const a = make()
    a.setArea('menu')
    settle()
    settings = { sound: true, reduceAudio: true }
    a.refresh()
    expect(alive()).toEqual([])
    a.setArea('unit-u1')
    settle()
    expect(alive()).toEqual([])
    expect(FakeAudio.made).toHaveLength(1)
    settings = { sound: true, reduceAudio: false }
    a.refresh()
    expect(urls(alive())).toEqual([ASSETS['mus-u1']])
  })

  it('a track with loop points jumps from the end point back to the start point; one without is left to the native loop', () => {
    const a = make({ loops: { 'mus-u1': { startSec: 2, endSec: 40 } } })
    a.setArea('unit-u1')
    const el = FakeAudio.made[0]!
    el.currentTime = 39
    vi.advanceTimersByTime(200)
    expect(el.currentTime).toBe(39)
    el.currentTime = 39.97
    vi.advanceTimersByTime(100)
    expect(el.currentTime).toBe(2)
    a.setArea('menu')
    settle()
    el.currentTime = 39.99
    vi.advanceTimersByTime(500)
    expect(el.currentTime).toBe(39.99) // the timer went with the track
    expect(FakeAudio.made[1]).toMatchObject({ loop: true })
  })

  it('the loop points of the pack are read with care', () => {
    expect(loopsOf({ audio: { loops: { a: { startSec: 2, endSec: 41.5 }, b: { startSec: 5, endSec: 5 }, c: { startSec: 'x', endSec: 9 }, d: null, e: { startSec: -1, endSec: 3 } } } })).toEqual({ a: { startSec: 2, endSec: 41.5 } })
    expect(loopsOf({})).toEqual({})
    expect(loopsOf(undefined)).toEqual({})
    expect(loopsOf({ audio: { loops: 5 } })).toEqual({})
  })

  it('autoplay blocked is silent, and the track starts at the first gesture (but not when sound is off)', async () => {
    const blocked = (u: string) => Object.assign(new FakeAudio(u), { blocked: true })
    const a = make({ create: blocked })
    a.setArea('menu')
    await Promise.resolve()
    expect(errors).toEqual([]) // refused: no error, no throw
    expect(FakeAudio.made[0]).toMatchObject({ paused: true, playCalls: 1 })
    FakeAudio.made[0]!.blocked = false
    gesture.dispatchEvent(new Event('pointerdown'))
    expect(FakeAudio.made[0]).toMatchObject({ paused: false, playCalls: 2 })
    // muted: a gesture does not start anything
    const b = make({ create: (u) => Object.assign(new FakeAudio(u), { blocked: true }) })
    b.setArea('menu')
    settings = { sound: false }
    const last = FakeAudio.made[FakeAudio.made.length - 1]!
    last.blocked = false
    gesture.dispatchEvent(new Event('keydown'))
    expect(last.paused).toBe(true)
  })

  it('a file that cannot be loaded is reported as an error (the bot counts those), once per element', () => {
    const a = make()
    a.setArea('menu')
    FakeAudio.made[0]!.fire('error')
    expect(errors).toEqual([`[EduAudio] the sound could not be loaded: ${ASSETS['mus-menu']}`])
    a.sfx('correct')
    FakeAudio.made[1]!.fire('error')
    expect(errors).toHaveLength(2)
    // an element that cannot even be made is reported too, and nothing throws
    const broken = make({ create: () => { throw new Error('no audio here') } })
    expect(() => broken.setArea('menu')).not.toThrow()
    expect(() => broken.sfx('correct')).not.toThrow()
    expect(errors).toHaveLength(4)
  })

  it('ducking makes the music quieter while narration plays, and back', () => {
    const a = make()
    a.setArea('menu')
    settle()
    a.duck(true)
    expect(FakeAudio.made[0]!.volume).toBeCloseTo(0.5 * DUCK_FACTOR, 5)
    a.duck(false)
    expect(FakeAudio.made[0]!.volume).toBeCloseTo(0.5, 5)
  })

  it('dispose stops the music at once and removes the gesture listeners', () => {
    const a = make({ create: (u) => Object.assign(new FakeAudio(u), { blocked: true }) })
    a.setArea('menu')
    a.dispose()
    FakeAudio.made[0]!.blocked = false
    gesture.dispatchEvent(new Event('pointerdown'))
    expect(FakeAudio.made[0]!.paused).toBe(true)
    expect(a.playing).toBeNull()
  })
})

describe('sound effects', () => {
  it('plays the event\'s one-shot cue at the cue volume; the old name unit-complete is the same event as level-up', () => {
    const a = make()
    a.sfx('correct')
    expect(FakeAudio.made[0]).toMatchObject({ src: ASSETS['sfx-correct'], loop: false, paused: false, volume: 0.8 })
    a.sfx('wrong')
    expect(urls(FakeAudio.made)).toEqual([ASSETS['sfx-correct'], ASSETS['sfx-wrong']])
    a.sfx('level-up')
    expect(FakeAudio.made[2]).toMatchObject({ src: ASSETS['sfx-level-up'], volume: 0.9 })
    // a hand-made course that names the event unit-complete
    const old = make({ cues: [{ id: 'c', on: 'unit-complete', asset: 'sfx-level-up', loop: false, volume: 1 }] })
    old.sfx('level-up')
    expect(FakeAudio.made[3]).toMatchObject({ src: ASSETS['sfx-level-up'], volume: 1 })
    // the shells say unit-complete, the quiz arena level-up: the cue named either plays for both
    a.sfx('unit-complete')
    expect(FakeAudio.made[4]).toMatchObject({ src: ASSETS['sfx-level-up'], volume: 0.9 })
    old.sfx('unit-complete')
    expect(FakeAudio.made[5]).toMatchObject({ src: ASSETS['sfx-level-up'], volume: 1 })
    FakeAudio.made.length = 4
    a.sfx('combo') // no cue for it: nothing
    a.sfx('boss')
    expect(FakeAudio.made).toHaveLength(4)
  })

  it('reduce audio makes the effects quieter (not silent); a looping cue is never an effect', () => {
    settings = { sound: true, reduceAudio: true }
    const a = make()
    a.sfx('correct')
    expect(FakeAudio.made[0]!.volume).toBeCloseTo(0.8 * REDUCED_SFX_FACTOR, 5)
    a.sfx('music:menu')
    expect(FakeAudio.made).toHaveLength(1)
  })
})

describe('the setting is kept with the progress', () => {
  it('reduceAudio is exported and imported; an older save without it means false; junk is false', async () => {
    const f = await loadFixture('solar-system')
    let p = newProgress(f.pack.id)
    expect(p.settings).toEqual({ timer: false, sound: true, reduceAudio: false })
    p = { ...p, settings: { ...p.settings, reduceAudio: true, sound: false } }
    const back = parseProgress(exportProgress(p), f.pack)
    expect(back.ok && back.progress.settings).toEqual({ timer: false, sound: false, reduceAudio: true })
    const old = JSON.parse(exportProgress(p)) as { progress: { settings: Record<string, unknown> } }
    delete old.progress.settings.reduceAudio
    const parsedOld = parseProgress(JSON.stringify(old), f.pack)
    expect(parsedOld.ok && parsedOld.progress.settings.reduceAudio).toBe(false)
    old.progress.settings.reduceAudio = 'yes'
    const junk = parseProgress(JSON.stringify(old), f.pack)
    expect(junk.ok && junk.progress.settings.reduceAudio).toBe(false)
  })
})
