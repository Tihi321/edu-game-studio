import { h } from '../dom'
import type { SpeechError, SpeechSession, SpeechState } from '../speech/types'
import type { ItemContext } from '../types'

/**
 * The microphone button of a text input (EGS-18): `data-testid="speak"`, `aria-pressed` while it listens, a live region (`speak-status`) that
 * says what happens. The transcript only fills the input (the learner edits and checks as usual). A second press or Escape stops. Returns
 * null when the shell has no speech service (no recognizer, not a language course, the learner switched it off): no button at all.
 */
export interface SpeakButton {
  /** The button goes next to the input, the live region below it. */
  button: HTMLButtonElement
  status: HTMLElement
  stop(): void
  disable(): void
}

export function speakButton(ctx: ItemContext, getInput: () => HTMLInputElement | null): SpeakButton | null {
  const svc = ctx.speech
  if (!svc) return null
  const btn = h('button', { type: 'button', class: 'btn btn-mic', testid: 'speak', 'aria-pressed': 'false', 'data-state': 'idle' }, ctx.ui('speak'))
  const status = h('span', { class: 'speak-status', testid: 'speak-status', role: 'status', 'aria-live': 'polite' })
  let session: SpeechSession | null = null
  let state: SpeechState = 'idle'
  let off = false

  const set = (s: SpeechState, err?: SpeechError): void => {
    state = s
    btn.setAttribute('data-state', s)
    btn.setAttribute('aria-pressed', String(s === 'listening'))
    btn.classList.toggle('is-listening', s === 'listening')
    if (s === 'listening') ctx.duck?.(true)
    else ctx.duck?.(false)
    if (s === 'listening') status.textContent = ctx.ui('speak.listening')
    else if (s === 'thinking') status.textContent = ctx.ui('speak.thinking')
    else if (s === 'error') status.textContent = ctx.ui(`speak.err.${err ?? 'failed'}` as 'speak.err.failed')
    if (s === 'idle' || s === 'error') session = null
  }
  const stop = (): void => {
    session?.stop()
  }
  const start = (): void => {
    const input = getInput()
    if (off || !input || input.disabled) return
    status.textContent = ''
    session = svc.start({
      onState: set,
      onText: (text) => {
        const target = getInput()
        if (!target || target.disabled) return
        target.value = text
        target.dispatchEvent(new Event('input', { bubbles: true }))
        status.textContent = ctx.ui('speak.heard', { text })
        target.focus()
      }
    })
  }
  btn.addEventListener('click', () => (state === 'idle' || state === 'error' ? start() : state === 'listening' ? stop() : undefined))
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state === 'listening') {
      e.preventDefault()
      e.stopPropagation()
      stop()
    }
  })
  return {
    button: btn,
    status,
    stop,
    disable: () => {
      off = true
      stop()
      btn.disabled = true
    }
  }
}

/** Escape in a text input stops a listening mic as well; `box` listens for it on the input. */
export function escapeStops(input: HTMLInputElement, mic: SpeakButton | null): void {
  if (!mic) return
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mic.button.getAttribute('aria-pressed') === 'true') {
      e.preventDefault()
      e.stopPropagation()
      mic.stop()
    }
  })
}
