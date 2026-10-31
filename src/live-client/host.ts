import { button, clear, h } from '../player/dom'
import type { HostView } from '../shared/live'
import { makeFrame, openEvents, postJson, translator, type T } from './common'

/** The host page (`/live/host/<hostToken>/`): the join code, who is in, and the buttons that run the quiz. Everything from the server is drawn as text. */

type HostState = HostView & { code: string; playerUrls: string[] }

export function startHost(root: HTMLElement, hostToken: string): void {
  const frame = makeFrame(root)
  let t: T = translator('en')
  const base = `/live/host/${hostToken}`
  let lastPhase = ''

  const act = async (action: string, body: Record<string, unknown> = {}): Promise<void> => {
    try {
      await postJson(`${base}/${action}`, body)
    } catch {
      frame.banner(t('join.error.network'))
    }
  }

  const render = (s: HostState): void => {
    if (document.documentElement.lang !== s.lang) {
      document.documentElement.lang = s.lang
      t = translator(s.lang)
    }
    document.title = `${t('title')} - ${t('host.heading')}`
    clear(frame.content)
    const phase = s.phase
    const hd = h('h1', { testid: 'host-heading' }, `${s.title} - ${t('host.heading')}`)
    const code = h('p', { class: 'bigcode', testid: 'host-code', 'aria-label': t('host.code') }, s.code)
    const urls = h('ul', { class: 'names', testid: 'host-urls' }, s.playerUrls.map((u) => h('li', {}, u)))
    const roster = s.roster.length
      ? h(
          'ul',
          { class: 'names roster', testid: 'host-players' },
          s.roster.map((p) =>
            h(
              'li',
              { testid: `host-player-${p.id}` },
              h('span', { class: p.connected ? 'dot on' : 'dot off', 'aria-hidden': 'true' }),
              h('span', { class: 'nick' }, p.nickname),
              h('span', { class: 'pts' }, ` ${p.score}`),
              p.answered && phase === 'question' ? h('span', { class: 'sr-only' }, ' ✓') : null,
              button(`host-kick-${p.id}`, t('host.kick', { name: p.nickname }), () => void act('kick', { playerId: p.id }), { class: 'btn small', 'aria-label': t('host.kick', { name: p.nickname }) })
            )
          )
        )
      : h('p', { testid: 'host-noplayers' }, t('host.noplayers'))
    const controls = h(
      'div',
      { class: 'controls' },
      button('host-start', t('host.start'), () => void act('start'), { class: 'btn primary', disabled: phase !== 'lobby' || s.roster.length === 0 }),
      button('host-end', t('host.end'), () => void act('end-question'), { class: 'btn', disabled: phase !== 'question' }),
      button('host-next', t('host.next'), () => void act('next'), { class: 'btn primary', disabled: phase !== 'reveal' && phase !== 'leaderboard' }),
      button('host-close', t('host.close'), () => void act('close'), { class: 'btn danger', disabled: phase === 'closed' })
    )
    const q = s.question
    const r = s.reveal
    const info = h(
      'section',
      { class: 'hostinfo' },
      h('p', { testid: 'host-phase' }, t('host.phase', { phase })),
      s.questionIndex >= 0 ? h('p', { testid: 'host-progress' }, t('q.progress', { n: s.questionIndex + 1, total: s.questionCount })) : null,
      q ? h('p', { class: 'prompt', testid: 'host-prompt' }, q.prompt) : null,
      phase === 'question' ? h('p', { testid: 'host-answered' }, t('host.answered', { n: s.answered, total: s.connected })) : null,
      r ? h('p', { testid: 'host-correct' }, t('reveal.answer', { answer: r.kind === 'typed' ? r.correctText : r.options.filter((o) => r.correctIds.includes(o.id)).map((o) => o.text).join(', ') })) : null,
      s.leaderboard
        ? h(
            'ol',
            { class: 'rows', testid: 'host-leaderboard' },
            s.leaderboard.rows.map((row) => h('li', { class: 'row' }, h('span', { class: 'rank' }, `${row.rank}.`), h('span', { class: 'nick' }, row.nickname), h('span', { class: 'pts' }, t('board.points', { n: row.score }))))
          )
        : null
    )
    const lanNote = s.playerUrls.some((u) => !u.includes('127.0.0.1')) ? h('p', { class: 'warn', testid: 'host-lan' }, t('host.lan')) : null
    frame.content.append(...[hd, h('h2', {}, t('host.code')), code, h('h2', {}, t('host.urls')), urls, lanNote, controls, info, h('h2', {}, `${t('host.players')} (${s.roster.length})`), roster].filter((n): n is HTMLElement => n !== null))
    if (lastPhase !== phase) {
      lastPhase = phase
      frame.announce(t('host.phase', { phase }))
    }
  }

  const es = openEvents(
    `${base}/events`,
    ['host'],
    (data) => {
      const s = data as HostState
      render(s)
      if (s.phase === 'closed') es.close()
    },
    (lost) => frame.banner(lost ? t('connection.lost') : ''),
    () => frame.banner(t('closed.heading'))
  )
}
