/**
 * The player's audio (EGS-16): the background music of the current area and the sound effects of the game events, from the `cues` of the pack.
 *
 *   music    a cue `{on: 'music:<area>', loop: true, volume}`: one track at a time, a short fade when the area changes, nothing when the area has none
 *            (the `menu` track is the fallback), the same file in two areas keeps playing. A track made by Chiptune Studio has loop points in
 *            `pack.extensions.audio.loops`: the player jumps from the end point back to the start point.
 *   effects  a cue `{on: '<event>', loop: false, volume}`: `correct`, `wrong`, `combo`, `level-up` (also the old name `unit-complete`), `boss`.
 *   settings `sound` off: nothing plays. `reduceAudio` on: no music, and the effects are quieter.
 *
 * A browser may refuse to play before the first click or key press: that is caught silently and the track starts at the first gesture. A file that
 * cannot be loaded is a `console.error` (the autoplay bot counts it). The shell owns the settings: it passes a function that reads them, and calls
 * `refresh()` when they change. No DOM is needed to test this class: `create` makes the audio element.
 */

export interface AudioLike {
  volume: number
  loop: boolean
  currentTime: number
  readonly paused: boolean
  play(): Promise<void> | void
  pause(): void
  addEventListener(type: string, listener: () => void): void
}

export interface AudioCue {
  id: string
  on: string
  asset: string
  loop: boolean
  volume: number
}

export interface AudioSettings {
  sound: boolean
  reduceAudio?: boolean
}

export interface AudioOptions {
  cues: readonly AudioCue[]
  /** Asset id -> URL (`GameData.assets`). */
  assets: Record<string, string>
  /** Asset id -> loop points in seconds (`pack.extensions.audio.loops`). */
  loops?: Record<string, { startSec: number; endSec: number }>
  /** The current settings: read at every call, so a toggle needs no more than `refresh()`. */
  settings: () => AudioSettings
  /** Makes an audio element for a URL (default: `new Audio(url)`). */
  create?: (url: string) => AudioLike
  /** What reports a load error (default: `console.error`; the autoplay bot counts those). */
  onError?: (message: string) => void
  /** Where the first user gesture is heard (default: `document`; null: none). */
  gestureTarget?: EventTarget | null
}

/** Sound effects are this much quieter with "reduce audio". */
export const REDUCED_SFX_FACTOR = 0.4
/** While narration or a listening clip plays, the music is this much quieter (`duck`). */
export const DUCK_FACTOR = 0.3
export const FADE_MS = 400
const FADE_STEP_MS = 40
/** How often the loop point of a track is checked, in ms. */
const LOOP_CHECK_MS = 60

// the shells say `unit-complete` (the pack's old name for it), the quiz arena says `level-up`: a cue of either name plays for both
const ALIASES: Record<string, string[]> = { 'level-up': ['level-up', 'unit-complete'], 'unit-complete': ['unit-complete', 'level-up'] }
const GESTURES = ['pointerdown', 'keydown', 'touchstart']

interface Track {
  url: string
  area: string
  cueVolume: number
  el: AudioLike
  /** Fade state: the timer, so a new fade replaces the old one. */
  fade?: ReturnType<typeof setInterval>
  loopTimer?: ReturnType<typeof setInterval>
  level: number
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

/** The loop points of the pack (`pack.extensions.audio.loops`), checked: only entries with two numbers and an end after the start. */
export function loopsOf(extensions: unknown): Record<string, { startSec: number; endSec: number }> {
  const raw = (extensions as { audio?: { loops?: Record<string, unknown> } } | null | undefined)?.audio?.loops
  const out: Record<string, { startSec: number; endSec: number }> = {}
  if (raw && typeof raw === 'object') {
    for (const [id, v] of Object.entries(raw)) {
      const p = v as { startSec?: unknown; endSec?: unknown } | null
      if (p && typeof p.startSec === 'number' && typeof p.endSec === 'number' && Number.isFinite(p.startSec) && Number.isFinite(p.endSec) && p.endSec > p.startSec && p.startSec >= 0) out[id] = { startSec: p.startSec, endSec: p.endSec }
    }
  }
  return out
}

export class GameAudio {
  private wanted: string | null = null
  private track: Track | null = null
  private ducked = false
  private readonly gesture: EventTarget | null
  private readonly onGesture = (): void => this.resume()

  constructor(private readonly o: AudioOptions) {
    this.gesture = o.gestureTarget === undefined ? (typeof document !== 'undefined' ? document : null) : o.gestureTarget
    if (this.gesture) for (const g of GESTURES) this.gesture.addEventListener(g, this.onGesture, { capture: true, passive: true } as AddEventListenerOptions)
  }

  /** The cue of a music area: its own, else the menu's. */
  musicCue(area: string): AudioCue | undefined {
    const music = (a: string): AudioCue | undefined => this.o.cues.find((c) => c.on === `music:${a}` && this.o.assets[c.asset])
    return music(area) ?? (area === 'menu' ? undefined : music('menu'))
  }

  /** The music area that plays now, or null. For tests and the debug view. */
  get playing(): { area: string; asset: string; url: string } | null {
    const t = this.track
    if (!t) return null
    return { area: t.area, asset: this.o.cues.find((c) => this.o.assets[c.asset] === t.url)?.asset ?? '', url: t.url }
  }

  private create(url: string): AudioLike {
    if (this.o.create) return this.o.create(url)
    return new Audio(url) as unknown as AudioLike
  }

  private report(url: string): void {
    const msg = `[EduAudio] the sound could not be loaded: ${url}`
    if (this.o.onError) this.o.onError(msg)
    else console.error(msg)
  }

  private attempt(el: AudioLike): void {
    try {
      const p = el.play()
      if (p && typeof p.catch === 'function') p.catch(() => undefined) // autoplay blocked, or the file is not playable (the error event reports that)
    } catch {
      /* a sound is never worth an error */
    }
  }

  private volumeOf(t: Track): number {
    return clamp01(t.cueVolume * (this.ducked ? DUCK_FACTOR : 1))
  }

  // ---- music ----

  /** The shell says which area the game is in now (null: none). The music follows, unless sound is off or audio is reduced. */
  setArea(area: string | null): void {
    this.wanted = area
    this.apply()
  }

  /** The settings changed (the toggles): start, stop or quieten what plays. */
  refresh(): void {
    this.apply()
  }

  private apply(): void {
    const s = this.o.settings()
    const cue = this.wanted && s.sound && !s.reduceAudio ? this.musicCue(this.wanted) : undefined
    const url = cue ? this.o.assets[cue.asset] : undefined
    if (!cue || !url) return this.stopTrack(!s.sound || !!s.reduceAudio)
    const area = this.wanted as string
    if (this.track && this.track.url === url) {
      this.track.area = area
      this.track.cueVolume = cue.volume
      if (this.track.el.paused) this.attempt(this.track.el)
      this.setLevel(this.track, this.volumeOf(this.track))
      return
    }
    this.stopTrack(false)
    this.startTrack(url, area, cue)
  }

  private startTrack(url: string, area: string, cue: AudioCue): void {
    let el: AudioLike
    try {
      el = this.create(url)
    } catch {
      return this.report(url)
    }
    el.loop = true
    el.volume = 0
    el.addEventListener('error', () => this.report(url))
    const t: Track = { url, area, cueVolume: cue.volume, el, level: 0 }
    this.track = t
    const loop = this.o.loops?.[cue.asset]
    if (loop && loop.endSec > loop.startSec) {
      // the file repeats natively from its start; with loop points the track jumps from the end point back to the start point
      t.loopTimer = setInterval(() => {
        if (el.currentTime >= loop.endSec - 0.05) el.currentTime = loop.startSec
      }, LOOP_CHECK_MS)
    }
    this.attempt(el)
    this.fadeTo(t, this.volumeOf(t), FADE_MS)
  }

  /** Stops the current track: with a fade, or at once (`now`: sound turned off, audio reduced, the game left). */
  private stopTrack(now: boolean): void {
    const t = this.track
    if (!t) return
    this.track = null
    if (t.loopTimer) clearInterval(t.loopTimer)
    if (now) {
      if (t.fade) clearInterval(t.fade)
      t.el.pause()
      return
    }
    this.fadeTo(t, 0, FADE_MS, () => t.el.pause())
  }

  private setLevel(t: Track, v: number): void {
    t.level = clamp01(v)
    t.el.volume = t.level
  }

  private fadeTo(t: Track, to: number, ms: number, done?: () => void): void {
    if (t.fade) clearInterval(t.fade)
    const from = t.level
    const steps = Math.max(1, Math.round(ms / FADE_STEP_MS))
    let n = 0
    t.fade = setInterval(() => {
      n++
      this.setLevel(t, from + ((to - from) * n) / steps)
      if (n >= steps) {
        if (t.fade) clearInterval(t.fade)
        t.fade = undefined
        done?.()
      }
    }, FADE_STEP_MS)
  }

  /** The first click or key press: a track the browser refused to start is started now. */
  private resume(): void {
    const t = this.track
    if (t && t.el.paused && this.o.settings().sound && !this.o.settings().reduceAudio) this.attempt(t.el)
    else if (!t) this.apply()
  }

  /** Narration or a listening clip plays: the music goes quieter while it does (the listening item, the encyclopedia's narration and the quiz arena call this). */
  duck(on: boolean): void {
    this.ducked = on
    if (this.track) this.setLevel(this.track, this.volumeOf(this.track))
  }

  // ---- sound effects ----

  /** A game event: plays every one-shot cue for it. Nothing when sound is off; quieter with "reduce audio". */
  sfx(event: string): void {
    const s = this.o.settings()
    if (!s.sound) return
    const names = ALIASES[event] ?? [event]
    for (const cue of this.o.cues.filter((c) => names.includes(c.on) && !c.loop)) {
      const url = this.o.assets[cue.asset]
      if (!url) continue
      try {
        const el = this.create(url)
        el.volume = clamp01(cue.volume * (s.reduceAudio ? REDUCED_SFX_FACTOR : 1))
        el.addEventListener('error', () => this.report(url))
        this.attempt(el)
      } catch {
        this.report(url)
      }
    }
  }

  // ---- the end ----

  /** The game is left: the music stops at once and the listeners go. */
  dispose(): void {
    this.wanted = null
    this.stopTrack(true)
    if (this.gesture) for (const g of GESTURES) this.gesture.removeEventListener(g, this.onGesture, { capture: true } as EventListenerOptions)
  }
}
