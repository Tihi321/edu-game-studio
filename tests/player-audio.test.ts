import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FADE_MS, GameAudio } from '../src/player/audio'
import type { AudioCue, AudioLike, AudioSettings } from '../src/player/audio'

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

})
