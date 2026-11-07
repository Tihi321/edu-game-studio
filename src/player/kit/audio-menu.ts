import { button, h } from '../dom'
import type { Ui } from '../i18n'
import type { Progress } from '../progress'

/**
 * The in-game audio panel (EGS-62): a speaker button fixed in the top-right corner of every screen of every shell and a modal panel with the
 * Music, Sound effects and Voices sliders (0-100, step 5; only the channels the game has), a "Sound off" toggle (the same `settings.sound` as the
 * title screen) and the "Reduce audio" toggle. The values are the `musicVolume`, `sfxVolume`, `voiceVolume` of the progress settings.
 *
 * Both render paths (`ShellSession.render`, `QuizArena.go`) call `mount(app)` after they drew a screen. The open state lives in this object, so a
 * re-render while the panel is open draws it open again with the focus on the same control. While it is open one capture-phase `keydown`
 * listener on the window keeps the keys typed in the panel from reaching the shell (RPG arrows, quiz shortcuts), closes it on Escape and keeps
 * Tab inside. A tap on the backdrop, Close and the Android back button (`audio-close`) close it; the focus goes back to the speaker button.
 *
 * Test ids: `audio-settings` (the button), `audio-panel`, `audio-backdrop`, `setting-music-volume`, `setting-sfx-volume`, `setting-voice-volume`
 * (each with `<id>-value`), `audio-mute` (`aria-pressed` = sound off), `audio-reduce`, `audio-close`.
 */

/** Which volume channels a game has. */
export interface AudioChannels {
  music: boolean
  sfx: boolean
  voice: boolean
}

const AUDIO_FILE = /\.(mp3|ogg|wav|m4a|opus)(\?.*)?$/i
const isAudioUrl = (url: string): boolean => AUDIO_FILE.test(url) || url.startsWith('data:audio/')

/** The channels of a game: music (a `music:` cue), effects (another one-shot cue), voices (an audio asset no cue plays: narration, listening and role-play clips). */
export function audioChannels(cues: readonly { on: string; asset: string; loop: boolean }[], assets: Record<string, string>): AudioChannels {
  const cued = new Set(cues.map((c) => c.asset))
  return {
    music: cues.some((c) => c.on.startsWith('music:')),
    sfx: cues.some((c) => !c.on.startsWith('music:') && !c.loop),
    voice: Object.entries(assets).some(([id, url]) => isAudioUrl(url) && !cued.has(id))
  }
}

/** True when the game has any sound at all (a cue or an audio asset): the speaker button is drawn. */
export const hasAnyAudio = (cues: readonly unknown[], assets: Record<string, string>): boolean => cues.length > 0 || Object.values(assets).some(isAudioUrl)

export interface AudioMenuHost {
  ui: Ui
  channels: AudioChannels
  settings(): Progress['settings']
  /** Merges the patch into the saved settings. */
  update(patch: Partial<Progress['settings']>): void
  /** The music and the clips that play follow the new settings. */
  refresh(): void
}

type VolumeKey = 'musicVolume' | 'sfxVolume' | 'voiceVolume'
const SLIDERS: { key: VolumeKey; id: string; label: 'audio.music' | 'audio.sfx' | 'audio.voice'; channel: keyof AudioChannels }[] = [
  { key: 'musicVolume', id: 'setting-music-volume', label: 'audio.music', channel: 'music' },
  { key: 'sfxVolume', id: 'setting-sfx-volume', label: 'audio.sfx', channel: 'sfx' },
  { key: 'voiceVolume', id: 'setting-voice-volume', label: 'audio.voice', channel: 'voice' }
]

export class AudioMenu {
  private isOpen = false
  private app: HTMLElement | null = null
  private panelEl: HTMLElement | null = null
  /** The test id of the control that had the focus in the panel (kept over a re-render). */
  private focusId = ''
  private listening = false

  constructor(private readonly host: AudioMenuHost) {}

  /** True while the panel is open: the shell must not take the focus away on a re-render. */
  get open(): boolean {
    return this.isOpen
  }

  /** Adds the speaker button (and the panel, when it is open) as the last children of the `.edu-app` that was just drawn. */
  mount(app: HTMLElement): void {
    this.app = app
    this.panelEl = null
    app.appendChild(this.speaker())
    if (this.isOpen) {
      this.showPanel()
      this.focusPanel()
    }
  }

  /** Closes the panel and puts the focus back on the speaker button. Returns whether it was open. */
  close(): boolean {
    if (!this.isOpen) return false
    this.isOpen = false
    this.unlisten()
    this.panelEl?.parentElement?.remove()
    this.panelEl = null
    const btn = this.speakerButton()
    btn?.setAttribute('aria-expanded', 'false')
    btn?.focus()
    return true
  }

  private speakerButton(): HTMLElement | null {
    return this.app?.querySelector<HTMLElement>('[data-testid="audio-settings"]') ?? null
  }

  private speaker(): HTMLElement {
    return button(
      'audio-settings',
      h('span', { class: 'edu-audio-icon', 'aria-hidden': 'true' }, this.host.settings().sound ? '🔊' : '🔇'),
      () => {
        if (this.isOpen) this.close()
        else this.openPanel()
      },
      { class: 'edu-audio-btn', 'aria-label': this.host.ui('audio.settings'), 'aria-haspopup': 'dialog', 'aria-expanded': String(this.isOpen) }
    )
  }

  private openPanel(): void {
    if (!this.app) return
    this.isOpen = true
    this.focusId = ''
    this.speakerButton()?.setAttribute('aria-expanded', 'true')
    this.showPanel()
    this.focusPanel()
  }

  private focusPanel(): void {
    const panel = this.panelEl
    if (!panel) return
    const target = (this.focusId ? panel.querySelector<HTMLElement>(`[data-testid="${this.focusId}"]`) : null) ?? panel.querySelector<HTMLElement>('input, button')
    target?.focus({ preventScroll: true })
  }

  private showPanel(): void {
    const app = this.app
    if (!app) return
    const ui = this.host.ui
    const rows = SLIDERS.filter((s) => this.host.channels[s.channel]).map((s) => this.sliderRow(s))
    const sound = this.host.settings().sound
    const mute = button(
      'audio-mute',
      ui('audio.mute'),
      () => {
        const next = !this.host.settings().sound
        this.host.update({ sound: next })
        this.host.refresh()
        mute.setAttribute('aria-pressed', String(!next))
        const icon = this.speakerButton()?.querySelector('.edu-audio-icon')
        if (icon) icon.textContent = next ? '🔊' : '🔇'
      },
      { class: 'btn edu-audio-mute', 'aria-pressed': String(!sound) }
    )
    const reduce = h('input', {
      type: 'checkbox',
      testid: 'audio-reduce',
      ...(this.host.settings().reduceAudio ? { checked: true } : {}),
      onchange: (e: Event) => {
        this.host.update({ reduceAudio: (e.target as HTMLInputElement).checked })
        this.host.refresh()
      }
    })
    const closeBtn = button('audio-close', ui('audio.close'), () => void this.close(), { class: 'btn btn-primary edu-audio-close' })
    const panel = h(
      'div',
      { class: 'edu-audio-panel', testid: 'audio-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'edu-audio-title' },
      h('h2', { id: 'edu-audio-title', class: 'edu-audio-title' }, ui('audio.title')),
      ...rows,
      h('div', { class: 'edu-audio-toggles' }, mute, h('label', { class: 'toggle edu-audio-reduce' }, reduce, h('span', { class: 'toggle-text' }, h('b', {}, ui('reduceAudio'))))),
      h('div', { class: 'actions actions-center' }, closeBtn)
    )
    panel.addEventListener('focusin', (e) => {
      this.focusId = (e.target as HTMLElement).getAttribute('data-testid') ?? ''
    })
    const backdrop = h('div', { class: 'edu-audio-backdrop', testid: 'audio-backdrop' }, panel)
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.close()
    })
    this.panelEl = panel
    app.appendChild(backdrop)
    this.listen()
  }

  private sliderRow(s: (typeof SLIDERS)[number]): HTMLElement {
    const id = `edu-audio-${s.id}`
    const stored = this.host.settings()[s.key]
    const value = typeof stored === 'number' ? stored : 100
    const out = h('output', { class: 'edu-audio-value', id: `${id}-value`, testid: `${s.id}-value`, for: id }, String(value))
    const input = h('input', {
      type: 'range',
      id,
      testid: s.id,
      min: '0',
      max: '100',
      step: '5',
      value: String(value),
      'aria-describedby': `${id}-value`,
      oninput: (e: Event) => {
        const n = Number((e.target as HTMLInputElement).value)
        out.textContent = String(n)
        this.host.update({ [s.key]: n })
        this.host.refresh()
      }
    })
    out.textContent = String(input.valueAsNumber) // a stored 47 is drawn as the 45 the slider can show
    return h('div', { class: 'edu-audio-row' }, h('label', { for: id }, this.host.ui(s.label)), h('div', { class: 'edu-audio-ctl' }, input, out))
  }

  // ---- keys ----

  private readonly onKey = (e: KeyboardEvent): void => {
    const panel = this.panelEl
    if (!this.isOpen || !panel?.isConnected) return this.unlisten()
    const inPanel = e.target instanceof Node && panel.contains(e.target)
    if (e.key === 'Escape') {
      e.stopPropagation()
      e.preventDefault()
      this.close()
      return
    }
    if (!inPanel) return
    if (e.key === 'Tab') {
      const items = [...panel.querySelectorAll<HTMLElement>('input, button')].filter((el) => !(el as HTMLButtonElement).disabled)
      const first = items[0]
      const last = items[items.length - 1]
      if (first && last) {
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    e.stopPropagation() // the shell's keys (RPG arrows, quiz shortcuts) do not act while the panel has the keyboard
  }

  private listen(): void {
    if (this.listening) return
    this.listening = true
    window.addEventListener('keydown', this.onKey, true)
  }

  private unlisten(): void {
    if (!this.listening) return
    this.listening = false
    window.removeEventListener('keydown', this.onKey, true)
  }
}
