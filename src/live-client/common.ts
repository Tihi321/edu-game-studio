import { liveText, type LiveStringKey } from '../shared/live'

export type T = (key: LiveStringKey, vars?: Record<string, string | number>) => string
export const translator = (lang: string): T => liveText(lang)

/** POSTs JSON; resolves with the status and the parsed body ({} when it is not JSON). Never throws on an HTTP error, only on no network. */
export async function postJson(url: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store' })
  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    // not JSON: leave it empty
  }
  return { status: res.status, data }
}

export async function getJson(url: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, { credentials: 'omit', cache: 'no-store' })
  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    // not JSON
  }
  return { status: res.status, data }
}

/** The named events the server sends (the phase names). */
export const PHASES = ['lobby', 'question', 'reveal', 'leaderboard', 'podium', 'closed'] as const

/** The page frame: one <main> with a heading, the content area and a polite live region for announcements. */
export interface Frame {
  main: HTMLElement
  content: HTMLElement
  announce(text: string): void
  banner(text: string): void
}

export function makeFrame(root: HTMLElement): Frame {
  root.textContent = ''
  const main = document.createElement('main')
  main.id = 'live-main'
  const banner = document.createElement('p')
  banner.className = 'banner'
  banner.setAttribute('data-testid', 'live-banner')
  banner.setAttribute('role', 'status')
  banner.hidden = true
  const content = document.createElement('div')
  content.className = 'content'
  const live = document.createElement('div')
  live.className = 'sr-only'
  live.setAttribute('aria-live', 'polite')
  live.setAttribute('aria-atomic', 'true')
  live.setAttribute('data-testid', 'live-status')
  main.append(banner, content)
  root.append(main, live)
  return {
    main,
    content,
    announce: (text) => {
      live.textContent = ''
      // a changed text is what a screen reader announces
      window.setTimeout(() => (live.textContent = text), 30)
    },
    banner: (text) => {
      banner.textContent = text
      banner.hidden = text === ''
    }
  }
}

/** Moves the focus to a heading after a screen change, so keyboard and screen-reader users start at the top of the new screen. */
export function focusHeading(el: HTMLElement): void {
  el.setAttribute('tabindex', '-1')
  el.focus({ preventScroll: true })
}

/** Opens an event stream. `onView` gets the parsed data of every named event; `onGone` is called when the server refuses the stream for good. */
export function openEvents(url: string, names: readonly string[], onView: (data: unknown) => void, onLost: (lost: boolean) => void, onGone: () => void): EventSource {
  const es = new EventSource(url)
  for (const n of names) {
    es.addEventListener(n, (e) => {
      onLost(false)
      try {
        onView(JSON.parse((e as MessageEvent<string>).data))
      } catch {
        // a broken message is ignored
      }
    })
  }
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) onGone()
    else onLost(true)
  }
  return es
}
