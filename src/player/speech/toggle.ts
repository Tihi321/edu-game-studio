import { h } from '../dom'
import type { Ui } from '../i18n'
import type { SpeechService } from './types'

/** The title screen's "Speak your answers" switch with its one-line privacy note. Null when the course has no speech service. */
export function speakToggle(ui: Ui, svc: SpeechService | undefined, on: boolean, set: (on: boolean) => void): HTMLElement | null {
  if (!svc) return null
  return h(
    'label',
    { class: 'toggle' },
    h('input', {
      type: 'checkbox',
      testid: 'setting-speak',
      ...(on ? { checked: true } : {}),
      onchange: (e: Event) => set((e.target as HTMLInputElement).checked)
    }),
    h('span', { class: 'toggle-text' }, h('b', {}, ui('speak.setting')), h('small', { testid: 'speak-privacy' }, ui(svc.kind === 'whisper' ? 'speak.privacy.local' : 'speak.privacy.web')))
  )
}
