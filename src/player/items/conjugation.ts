import type { ConjugationItem } from '../../shared/course'
import { shuffledCopy } from '../../shared/edu'
import { button, h } from '../dom'
import type { UiKey } from '../i18n'
import type { ItemContext, ItemRenderer, ItemView } from '../types'
import { escapeStops, speakButton } from './speak'
import { letterRow, visuallyHidden } from './common'

/**
 * `conjugation` (EGS-27): the verb as a heading, the tense as a badge, one labelled input per asked person in a table (the persons that are
 * `given` are read-only rows). With `ask` smaller than the number of open forms a seeded subset is asked. Test ids: `conj-<person>` (input),
 * `conj-<person>-result`, `conj-given-<person>` (a given row), `check`, `letter-<char>`. Enter moves to the next input, Enter on the last one
 * checks. The answer is `{ [person]: typed form }` for the asked persons; after the check every row shows its mark and the table shows the
 * right form of each wrong one.
 */

const TENSE_KEYS = new Set(['praesens', 'perfekt', 'praeteritum', 'futur1', 'imperativ', 'konjunktiv2', 'passiv-praesens', 'passiv-praeteritum', 'perfekt-passiv', 'konjunktiv2-vergangenheit', 'konjunktiv1', 'konjunktiv1-vergangenheit'])

/** The persons asked in this presentation: all open forms, or `ask` of them chosen by the seeded generator (table order kept). */
export function askedPersons(item: ConjugationItem, ctx: Pick<ItemContext, 'rng'>): string[] {
  const open = item.forms.filter((f) => !f.given).map((f) => f.person)
  if (item.ask === undefined || item.ask >= open.length) return open
  const chosen = new Set(shuffledCopy(open, ctx.rng).slice(0, item.ask))
  return open.filter((p) => chosen.has(p))
}

export const conjugationRenderer: ItemRenderer = {
  kind: 'conjugation',
  render(ctx: ItemContext): ItemView {
    const item = ctx.item as unknown as ConjugationItem
    const asked = new Set(askedPersons(item, ctx))
    const inputs = new Map<string, HTMLInputElement>()
    const rows = new Map<string, HTMLElement>()
    let locked = false
    let last: HTMLInputElement | null = null

    const order = item.forms.filter((f) => asked.has(f.person)).map((f) => f.person)
    const filled = (): boolean => order.every((p) => (inputs.get(p)?.value.trim() ?? '') !== '')
    const sync = (): void => {
      check.disabled = locked || !filled()
    }
    const go = (): void => {
      if (locked || !filled()) return
      locked = true
      ctx.submit(Object.fromEntries(order.map((p) => [p, inputs.get(p)?.value.trim() ?? ''])))
    }

    const tbody = h('tbody')
    for (const f of item.forms) {
      const label = ctx.text.t(f.label)
      if (!asked.has(f.person)) {
        tbody.appendChild(h('tr', { class: 'conj-row is-given', testid: `conj-given-${f.person}` }, h('th', { scope: 'row', class: 'conj-label' }, label), h('td', { class: 'conj-given' }, ctx.text.canonical(f.answer) ?? ''), h('td', { class: 'conj-result' })))
        continue
      }
      const input = h('input', {
        type: 'text',
        autocomplete: 'off',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        lang: ctx.data.pack.targetLang ?? ctx.lang,
        class: 'text-input conj-input',
        testid: `conj-${f.person}`,
        'aria-label': `${label}: ${ctx.text.t(item.verb)}`
      })
      input.addEventListener('input', sync)
      input.addEventListener('focus', () => (last = input))
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        const next = order.slice(order.indexOf(f.person) + 1).map((p) => inputs.get(p)).find((x) => x && x.value.trim() === '')
        if (next) next.focus()
        else go()
      })
      inputs.set(f.person, input)
      const result = h('td', { class: 'conj-result', testid: `conj-${f.person}-result`, 'aria-live': 'polite' })
      const row = h('tr', { class: 'conj-row' }, h('th', { scope: 'row', class: 'conj-label' }, label), h('td', { class: 'conj-cell' }, input), result)
      rows.set(f.person, row)
      tbody.appendChild(row)
    }

    const tenseKey = `conj.tense.${item.tense}` as UiKey
    const tense = TENSE_KEYS.has(item.tense) ? ctx.ui(tenseKey) : item.tense
    const head = h('div', { class: 'conj-head' }, h('p', { class: 'conj-verb', testid: 'conj-verb', lang: ctx.data.pack.targetLang ?? ctx.lang }, ctx.text.t(item.verb)), h('span', { class: 'badge conj-tense', testid: 'conj-tense' }, tense))
    const table = h('table', { class: 'conj-table', 'aria-label': `${ctx.text.t(item.verb)}, ${tense}` }, tbody)
    const check = button('check', ctx.ui('submit'), go, { class: 'btn btn-primary', disabled: true })
    const letters = letterRow(ctx, () => last ?? inputs.get(order[0] ?? '') ?? null)
    const mic = speakButton(ctx, () => last ?? order.map((p) => inputs.get(p)).find((i) => i && i.value.trim() === '') ?? inputs.get(order[0] ?? '') ?? null)
    for (const i of inputs.values()) escapeStops(i, mic)
    const el = h('div', { class: 'conj' }, head, table, letters, h('div', { class: 'actions' }, mic?.button, check), mic?.status)

    return {
      el,
      focus: () => inputs.get(order[0] ?? '')?.focus(),
      destroy: () => mic?.stop(),
      reveal: (result) => {
        mic?.disable()
        locked = true
        check.disabled = true
        const expected = (result.expected && typeof result.expected === 'object' ? result.expected : {}) as Record<string, string | null>
        for (const person of order) {
          const input = inputs.get(person)
          const cell = el.querySelector(`[data-testid="conj-${person}-result"]`)
          if (!input || !cell) continue
          const ok = result.detail?.[person] === true
          input.disabled = true
          input.classList.add(ok ? 'is-correct' : 'is-wrong')
          rows.get(person)?.classList.add(ok ? 'is-correct' : 'is-wrong')
          cell.setAttribute('data-ok', String(ok))
          cell.appendChild(h('span', { class: 'mark', 'aria-hidden': 'true' }, ok ? '✓' : '✗'))
          cell.appendChild(visuallyHidden(ok ? ctx.ui('verdict.correct') : ctx.ui('verdict.wrong')))
          const answer = expected[person]
          if (!ok && answer) cell.appendChild(h('span', { class: 'conj-answer', testid: `conj-answer-${person}` }, answer))
        }
      }
    }
  }
}
