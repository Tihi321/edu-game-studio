import type { ChoiceOption, ListeningItem } from '../../shared/course'
import { button, h } from '../dom'
import type { ItemRenderer } from '../types'
import { mark, orderedOptions } from './common'
import { singleChoice } from './choice'
import { typedBox } from './text'

/**
 * Listening: a Play button for the audio clip, then either options (`choose`) or a text input (`type`). The sound plays only when the
 * learner presses Play (browsers block autoplay anyway). After the answer the transcript is shown.
 * Test ids: `audio-play`, `audio`, `option-<optionId>`, `answer-input`, `submit`, `transcript`.
 */
export const listeningRenderer: ItemRenderer = {
  kind: 'listening',
  render(ctx) {
    const item = ctx.item as unknown as ListeningItem
    const url = ctx.assetUrl(item.asset)
    const audio = h('audio', { preload: 'auto', testid: 'audio', ...(url ? { src: url } : {}) })
    const status = h('p', { class: 'audio-status', role: 'status' })
    let played = false
    const play = button(
      'audio-play',
      [h('span', { class: 'play-icon', 'aria-hidden': 'true' }, '🔊'), h('span', {}, ctx.ui('play'))],
      () => {
        status.textContent = ''
        audio.currentTime = 0
        audio.play().then(
          () => {
            ctx.duck?.(true)
            if (!played) {
              played = true
              play.lastElementChild!.textContent = ctx.ui('play.again')
            }
          },
          () => {
            status.textContent = ctx.ui('audio.fail')
          }
        )
      },
      { class: 'btn btn-play' }
    )
    audio.addEventListener('error', () => {
      status.textContent = ctx.ui('audio.fail')
      ctx.duck?.(false)
    })
    // the music is quieter only while the clip sounds
    for (const e of ['ended', 'pause']) audio.addEventListener(e, () => ctx.duck?.(false))
    const head = h('div', { class: 'audio-block' }, play, audio, status)

    if (item.mode === 'choose') {
      const opts = orderedOptions<ChoiceOption>(ctx, item.options ?? [], item.shuffle).map((o) => ({ id: o.id, text: ctx.text.t(o.text) }))
      const choice = singleChoice(ctx, opts, item.answer)
      const el = h('div', { class: 'listening' }, head, choice.el)
      return {
        el,
        focus: () => play.focus(),
        key: choice.key!,
        reveal: (r, a) => {
          choice.reveal(r, a)
          el.appendChild(h('p', { class: 'transcript', testid: 'transcript' }, `${ctx.ui('transcript')} ${ctx.text.t(item.transcript)}`))
        },
        destroy: () => {
          audio.pause()
          ctx.duck?.(false)
        }
      }
    }
    const box = typedBox(ctx, (text) => ctx.submit(text))
    const el = h('div', { class: 'listening' }, head, box.el)
    return {
      el,
      focus: () => play.focus(),
      reveal: (result) => {
        box.mic?.disable()
        box.input.disabled = true
        box.submit.disabled = true
        mark(box.el.querySelector('.typed-row') as HTMLElement, result.correct, ctx)
        el.appendChild(h('p', { class: 'transcript', testid: 'transcript' }, `${ctx.ui('transcript')} ${ctx.text.t(item.transcript)}`))
      },
      destroy: () => {
        box.mic?.stop()
        audio.pause()
        ctx.duck?.(false)
      }
    }
  }
}
