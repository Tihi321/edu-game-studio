import { button, clear, h } from '../player/dom'
import type { LeaderRow, PublicQuestion, RoomView } from '../shared/live'
import { focusHeading, getJson, makeFrame, openEvents, PHASES, postJson, translator, type T } from './common'

/**
 * The player's page: join, wait, answer, see the reveal, the leaderboard and the podium. Every text from the server goes in as text
 * (no innerHTML). The server sends the whole public view on every change, so a reconnecting player gets the current screen at once.
 */

const TOKEN_KEY = 'edu-live-token'
const JOIN_ERRORS: Record<string, 'join.error.code' | 'join.error.name' | 'join.error.taken' | 'join.error.full' | 'join.error.started' | 'join.error.closed'> = {
  code: 'join.error.code',
  name: 'join.error.name',
  taken: 'join.error.taken',
  full: 'join.error.full',
  started: 'join.error.started',
  closed: 'join.error.closed'
}

export async function startPlayer(root: HTMLElement): Promise<void> {
  const frame = makeFrame(root)
  let t: T = translator('en')
  let token = ''
  try {
    token = sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    // storage is blocked: the player must join again after a reload
  }
  let es: EventSource | undefined
  let renderedKey = ''
  let tickTimer = 0
  let keyCleanup: (() => void) | undefined
  let questionApi: { sync(v: RoomView): void } | undefined

  const setLang = (lang: string): void => {
    document.documentElement.lang = lang
    t = translator(lang)
    document.title = t('title')
  }

  const stopTick = (): void => {
    if (tickTimer) window.clearInterval(tickTimer)
    tickTimer = 0
  }

  const screen = (heading: string, ...children: (Node | null)[]): HTMLElement => {
    stopTick()
    keyCleanup?.()
    keyCleanup = undefined
    questionApi = undefined
    clear(frame.content)
    const hd = h('h1', { testid: 'live-heading' }, heading)
    frame.content.append(hd, ...children.filter((c): c is Node => c !== null))
    focusHeading(hd)
    frame.announce(heading)
    return hd
  }

  // ---- join ----
  const showJoin = (message = ''): void => {
    renderedKey = 'join'
    const err = h('p', { class: 'error', role: 'alert', testid: 'live-error' }, message)
    const code = h('input', { id: 'live-code', class: 'input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 6, autocomplete: 'off', required: true, testid: 'live-code' })
    const name = h('input', { id: 'live-name', class: 'input', type: 'text', maxlength: 20, autocomplete: 'nickname', required: true, testid: 'live-name' })
    const go = h('button', { type: 'submit', class: 'btn primary', testid: 'live-join' }, t('join.button'))
    const form = h(
      'form',
      {
        class: 'form',
        novalidate: true,
        onsubmit: (e: Event) => {
          e.preventDefault()
          void join(code.value.trim(), name.value, go, err)
        }
      },
      h('label', { for: 'live-code' }, t('join.code')),
      code,
      h('label', { for: 'live-name' }, t('join.name')),
      name,
      err,
      go
    )
    screen(t('join.heading'), form)
    code.focus()
  }

  const join = async (code: string, name: string, go: HTMLButtonElement, err: HTMLElement): Promise<void> => {
    go.disabled = true
    err.textContent = ''
    try {
      const r = await postJson('/live/join', { code, name })
      if (r.status === 200 && typeof r.data.token === 'string') {
        token = r.data.token
        try {
          sessionStorage.setItem(TOKEN_KEY, token)
        } catch {
          // storage blocked
        }
        connect()
        return
      }
      const e = String(r.data.error ?? '')
      err.textContent = r.status === 429 ? t('join.error.rate') : t(JOIN_ERRORS[e] ?? 'join.error.network')
    } catch {
      err.textContent = t('join.error.network')
    }
    go.disabled = false
  }

  // ---- the stream ----
  const connect = (): void => {
    es?.close()
    es = openEvents(
      `/live/events?token=${encodeURIComponent(token)}`,
      PHASES,
      (data) => onView(data as RoomView),
      (lost) => frame.banner(lost ? t('connection.lost') : ''),
      () => {
        // the token is unknown (kicked, or the room was closed and is gone): back to the join screen
        es?.close()
        try {
          sessionStorage.removeItem(TOKEN_KEY)
        } catch {
          // storage blocked
        }
        token = ''
        frame.banner('')
        showJoin(t('join.error.closed'))
      }
    )
  }

  const onView = (v: RoomView): void => {
    if (v.lang !== document.documentElement.lang) setLang(v.lang)
    const key = `${v.phase}:${v.question?.index ?? v.reveal?.index ?? ''}`
    if (key === renderedKey && v.phase === 'question') return void questionApi?.sync(v)
    if (key === renderedKey && v.phase !== 'lobby') return
    renderedKey = key
    switch (v.phase) {
      case 'lobby':
        return showLobby(v)
      case 'question':
        return showQuestion(v)
      case 'reveal':
        return showReveal(v)
      case 'leaderboard':
        return showLeaderboard(v)
      case 'podium':
        return showPodium(v)
      case 'closed':
        es?.close()
        try {
          sessionStorage.removeItem(TOKEN_KEY)
        } catch {
          // storage blocked
        }
        return void screen(t('closed.heading'), h('p', { testid: 'live-closed' }, t('closed.text')))
    }
  }

  // ---- screens ----
  const showLobby = (v: RoomView): void => {
    const names = v.players ?? []
    const list = h('ul', { class: 'names', testid: 'live-lobby-players' }, names.map((n) => h('li', {}, n)))
    screen(t('lobby.heading'), h('p', { testid: 'live-you' }, t('lobby.you', { name: v.you?.nickname ?? '' })), h('p', { testid: 'live-count' }, t('lobby.count', { n: v.playerCount })), h('p', {}, t('lobby.wait')), list)
  }

  const showQuestion = (v: RoomView): void => {
    const q = v.question as PublicQuestion
    const picked = new Set<string>()
    let locked = false
    let sending = false
    const buttons = new Map<string, HTMLButtonElement>()
    const lockedMsg = h('p', { class: 'locked', role: 'status', testid: 'live-locked', hidden: true }, t('q.locked'))
    const err = h('p', { class: 'error', role: 'alert', testid: 'live-error' })
    const input = q.kind === 'typed' ? h('input', { id: 'live-answer', class: 'input', type: 'text', maxlength: 200, autocomplete: 'off', autocapitalize: 'off', spellcheck: false, testid: 'live-answer-input' }) : null
    const submit = h('button', { type: 'button', class: 'btn primary', testid: 'live-submit', disabled: q.multi || q.kind === 'typed' }, t('q.submit'))

    const lock = (): void => {
      locked = true
      for (const b of buttons.values()) b.disabled = true
      submit.disabled = true
      if (input) input.disabled = true
      lockedMsg.hidden = false
      frame.announce(t('q.locked'))
    }
    const send = async (payload: Record<string, unknown>): Promise<void> => {
      if (locked || sending) return
      sending = true
      err.textContent = ''
      try {
        const r = await postJson('/live/answer', { token, answer: payload })
        if (r.status === 200 || r.data.error === 'already') lock()
        else if (r.data.error === 'late' || r.data.error === 'phase') {
          // the server has moved on: the next event shows the reveal
          lock()
        } else err.textContent = t('q.error')
      } catch {
        err.textContent = t('join.error.network')
      }
      sending = false
    }
    const refresh = (): void => {
      for (const [id, b] of buttons) {
        b.setAttribute('aria-pressed', String(picked.has(id)))
        b.classList.toggle('chosen', picked.has(id))
      }
      if (q.multi) submit.disabled = locked || picked.size === 0
      if (input) submit.disabled = locked || input.value.trim() === ''
    }
    q.options.forEach((o, n) => {
      const b = button(
        `live-option-${o.id}`,
        [h('span', { class: 'key', 'aria-hidden': 'true' }, n < 9 ? String(n + 1) : ''), h('span', { class: 'label' }, o.text)],
        () => {
          if (locked) return
          if (q.multi) {
            if (picked.has(o.id)) picked.delete(o.id)
            else picked.add(o.id)
            refresh()
          } else {
            picked.add(o.id)
            refresh()
            void send({ option: o.id })
          }
        },
        { class: 'choice', 'aria-pressed': 'false' }
      )
      buttons.set(o.id, b)
    })
    submit.addEventListener('click', () => {
      if (q.multi) void send({ options: [...picked] })
      else if (input) void send({ text: input.value })
    })
    input?.addEventListener('input', refresh)
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (!submit.disabled) submit.click()
      }
    })

    const bar = h('div', { class: 'bar-fill' })
    const secs = h('span', { class: 'secs', testid: 'live-seconds' }, t('q.seconds', { n: Math.ceil(q.remainingMs / 1000) }))
    const track = h('div', { class: 'bar', role: 'progressbar', 'aria-label': t('q.seconds', { n: q.seconds }), 'aria-valuemin': 0, 'aria-valuemax': q.seconds, 'aria-valuenow': Math.ceil(q.remainingMs / 1000), testid: 'live-timer' }, bar)
    const group = h('div', { class: 'choices', role: 'group', 'aria-labelledby': 'live-prompt' }, [...buttons.values()])
    const prompt = h('h2', { id: 'live-prompt', class: 'prompt', testid: 'live-prompt' }, q.prompt)

    screen(
      t('q.progress', { n: q.index + 1, total: q.total }),
      h('div', { class: 'timer' }, track, secs),
      prompt,
      q.multi ? h('p', { class: 'hint' }, t('q.multi.hint')) : null,
      input ? h('label', { for: 'live-answer', class: 'sr-only' }, t('q.typed')) : null,
      input ?? group,
      q.multi || input ? submit : null,
      err,
      lockedMsg
    )
    prompt.setAttribute('data-kind', q.kind)

    // the countdown runs on this device's clock from the time left when the question arrived
    const end = performance.now() + q.remainingMs
    const tick = (): void => {
      const left = Math.max(0, end - performance.now())
      bar.style.transform = `scaleX(${q.seconds > 0 ? left / (q.seconds * 1000) : 0})`
      const s = Math.ceil(left / 1000)
      secs.textContent = t('q.seconds', { n: s })
      track.setAttribute('aria-valuenow', String(s))
    }
    tick()
    tickTimer = window.setInterval(tick, 200)

    const onKey = (e: KeyboardEvent): void => {
      if (locked || e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof HTMLInputElement)) return
      const i = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1
      const o = q.options[i]
      if (o) buttons.get(o.id)?.click()
    }
    document.addEventListener('keydown', onKey)
    keyCleanup = () => document.removeEventListener('keydown', onKey)

    if (v.you?.answered) lock()
    questionApi = { sync: (nv) => void (nv.you?.answered && !locked && lock()) }
    ;(input ?? [...buttons.values()][0])?.focus({ preventScroll: true })
  }

  const showReveal = (v: RoomView): void => {
    const r = v.reveal
    if (!r) return
    const out = r.you
    const verdict = out.correct ? t('reveal.correct') : out.answered ? t('reveal.wrong') : t('reveal.none')
    const correctText = r.kind === 'typed' ? r.correctText : r.options.filter((o) => r.correctIds.includes(o.id)).map((o) => o.text).join(', ')
    const counts = r.options.length
      ? h(
          'ul',
          { class: 'reveal-options', testid: 'live-reveal-options' },
          r.options.map((o) => {
            const right = r.correctIds.includes(o.id)
            return h('li', { class: right ? 'is-right' : '', testid: `live-reveal-option-${o.id}` }, h('span', { 'aria-hidden': 'true' }, right ? '✓ ' : '✗ '), o.text, ` (${r.counts[o.id] ?? 0})`)
          })
        )
      : null
    const hd = screen(
      verdict,
      h('p', { class: 'prompt' }, r.prompt),
      h('p', { testid: 'live-correct-answer' }, t('reveal.answer', { answer: correctText })),
      counts,
      r.explanation ? h('section', { class: 'why' }, h('h2', {}, t('reveal.explanation')), h('p', { testid: 'live-explanation' }, r.explanation)) : null,
      h('p', { class: 'points', testid: 'live-points' }, t('reveal.points', { n: out.points })),
      h('p', { testid: 'live-score' }, t('reveal.score', { n: v.you?.score ?? 0 }))
    )
    hd.setAttribute('data-testid', 'live-verdict')
    hd.setAttribute('data-correct', String(out.correct))
    frame.announce(`${verdict} ${t('reveal.points', { n: out.points })}`)
  }

  const rowItem = (r: LeaderRow, i: number, prefix: string): HTMLElement =>
    h(
      'li',
      { class: r.you ? 'row you' : 'row', testid: `${prefix}-${i}`, 'data-rank': r.rank },
      h('span', { class: 'rank' }, `${r.rank}.`),
      h('span', { class: 'nick' }, r.nickname, r.you ? h('span', { class: 'sr-only' }, ' (you)') : null),
      h('span', { class: 'pts' }, t('board.points', { n: r.score }))
    )

  const showLeaderboard = (v: RoomView): void => {
    const lb = v.leaderboard
    if (!lb) return
    const list = h('ol', { class: 'rows', testid: 'live-leaderboard' }, lb.rows.map((r, i) => rowItem(r, i, 'live-row')))
    screen(t('board.heading'), list, h('p', { class: 'rank-line', testid: 'live-rank' }, t('board.rank', { rank: v.you?.rank ?? 0, total: lb.total })))
  }

  const showPodium = (v: RoomView): void => {
    const p = v.podium
    if (!p) return
    const list = h(
      'ol',
      { class: 'rows podium', testid: 'live-podium' },
      p.rows.map((r, i) => rowItem(r, i, 'live-podium'))
    )
    screen(t('podium.heading'), list, h('p', { class: 'rank-line', testid: 'live-rank' }, t('board.rank', { rank: v.you?.rank ?? 0, total: p.total })))
  }

  // ---- go ----
  try {
    const info = await getJson('/live/info')
    if (typeof info.data.lang === 'string') setLang(info.data.lang)
  } catch {
    // the page still works in English
  }
  if (token) connect()
  else showJoin()
  window.addEventListener('pagehide', () => {
    keyCleanup?.()
    es?.close()
  })
}
