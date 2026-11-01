import { DEFAULT_SHELL, GAME_DATA_FORMAT, PLAYER_ROOT_ID, type GameData } from '../shared/game-data'
import { createDebug } from './debug'
import { clear, h } from './dom'
import { makeUi } from './i18n'
import { withPassage } from './items/common'
import type { EduEngineApi, ItemRenderer, PlayerState, Shell, ShellDebugApi } from './types'

/** The version of the player runtime (`window.EduEngine.version`). */
export const ENGINE_VERSION = '1.0.0'

/** The seed of this page: `?seed=N` in the address (so a run can be replayed), else random. */
export function pageSeed(search: string = typeof location === 'undefined' ? '' : location.search): number {
  const raw = new URLSearchParams(search).get('seed')
  const n = raw === null ? NaN : Number(raw)
  return Number.isInteger(n) && n >= 0 && n < 2 ** 31 ? n : Math.floor(Math.random() * 2 ** 31)
}

/** Where the shell a learner picked is remembered, per course. */
export const shellChoiceKey = (packId: string): string => `edu-studio:shell:${packId}`

/** The shells a game can be played in: the course's `shells.enabled` that are registered, in order (the default shell when none is). */
export function playableShells(enabled: readonly string[], registered: ReadonlySet<string> | readonly string[], fallback: string = DEFAULT_SHELL): string[] {
  const has = (id: string): boolean => (Array.isArray(registered) ? registered.includes(id) : (registered as ReadonlySet<string>).has(id))
  const list = [...new Set(enabled)].filter(has)
  return list.length > 0 ? list : has(fallback) ? [fallback] : []
}

/** The shell to mount: `?shell=<id>` in the address, else the remembered choice, else the game data's shell, else the first playable. */
export function chooseShell(opts: { search: string; playable: readonly string[]; saved?: string | null; dataShell?: string }): string | undefined {
  const asked = new URLSearchParams(opts.search).get('shell')
  for (const c of [asked, opts.saved, opts.dataShell]) if (c && opts.playable.includes(c)) return c
  return opts.playable[0]
}

const readSaved = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
const writeSaved = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* a blocked storage only loses the remembered choice */
  }
}

const isGameData = (v: unknown): v is GameData => {
  const d = v as Partial<GameData> | undefined
  return !!d && d.format === GAME_DATA_FORMAT && typeof d.pack === 'object' && d.pack !== null && typeof d.catalogs === 'object' && d.catalogs !== null
}

/**
 * The runtime behind `window.EduEngine`: a registry of shells and item renderers (both plugins) and the published state. Shells and
 * renderers register themselves in `main.ts`; a later shell (a castle, an RPG) is one more `registerShell` call.
 */
export function createEngine(): EduEngineApi {
  const shells = new Map<string, Shell>()
  const renderers = new Map<string, ItemRenderer>()
  let state: PlayerState = {
    screen: 'loading',
    shell: '',
    lang: '',
    seed: 0,
    combo: 0,
    score: 0,
    reviewQueue: [],
    mastery: {},
    finished: false,
    steps: 0
  }
  let started: Shell | null = null
  let shellDebug: ShellDebugApi | null = null
  let data: GameData | null = null
  let root: HTMLElement | null = null
  let seed = 0
  const playable = (): string[] => (data ? playableShells(data.pack.shells.enabled, [...shells.keys()], data.shell || DEFAULT_SHELL) : [])

  const fail = (root: HTMLElement | null, message: string, lang = 'en'): void => {
    state = { ...state, screen: 'error' }
    const ui = makeUi(lang)
    if (root) {
      root.classList.add('edu-stage')
      root.setAttribute('data-edu-theme', 'chalkboard')
      clear(root)
      root.appendChild(h('div', { class: 'edu-error', role: 'alert', testid: 'error' }, h('h1', {}, ui('error')), h('p', {}, message)))
    }
    console.error(`[EduEngine] ${message}`)
  }

  const api: EduEngineApi = {
    version: ENGINE_VERSION,
    registerShell(id, shell) {
      shells.set(id, shell)
    },
    registerItemKind(kind, renderer) {
      renderers.set(kind, withPassage(renderer))
    },
    getState() {
      return JSON.parse(JSON.stringify(state)) as PlayerState
    },
    // `debug.shell` is read live: the mounted shell's helpers (Object.assign would copy the getter's value once)
    debug: Object.defineProperty(createDebug(() => state), 'shell', { enumerable: true, get: (): ShellDebugApi | undefined => shellDebug ?? undefined }),
    playableShells: () => playable(),
    start() {
      if (started) return
      root = document.getElementById(PLAYER_ROOT_ID)
      const raw: unknown = window.EDU_GAME_DATA
      if (!root) return fail(null, `the page has no #${PLAYER_ROOT_ID} element`)
      if (!isGameData(raw)) return fail(root, 'game-data.js did not define window.EDU_GAME_DATA')
      data = raw
      seed = pageSeed()
      const id = chooseShell({ search: typeof location === 'undefined' ? '' : location.search, playable: playable(), saved: readSaved(shellChoiceKey(data.pack.id)), dataShell: data.shell || DEFAULT_SHELL })
      if (!id) return fail(root, `no shell "${data.shell || DEFAULT_SHELL}" is registered`, data.defaultLang)
      mountShell(id)
    },
    switchShell(id) {
      if (!data || !root || !started || !playable().includes(id)) return
      writeSaved(shellChoiceKey(data.pack.id), id)
      try {
        started.unmount?.()
      } catch (e) {
        console.error(`[EduEngine] unmounting the shell failed: ${e instanceof Error ? e.message : String(e)}`)
      }
      started = null
      shellDebug = null
      clear(root)
      root.removeAttribute('data-edu-theme')
      root.className = ''
      state = { ...state, screen: 'loading' }
      mountShell(id)
    }
  }

  function mountShell(id: string): void {
    const shell = shells.get(id)
    if (!data || !root || !shell) return
    started = shell
    const host = {
      root,
      data,
      seed,
      getItemRenderer: (kind: string) => renderers.get(kind),
      publish: (s: PlayerState) => {
        state = s
      },
      shells: playable(),
      switchShell: (to: string) => api.switchShell(to),
      setDebug: (d: ShellDebugApi | null) => {
        shellDebug = d
      }
    }
    try {
      shell.mount(host)
    } catch (e) {
      started = null
      fail(root, e instanceof Error ? e.message : String(e), data.defaultLang)
    }
  }
  return api
}
