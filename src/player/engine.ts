import { DEFAULT_SHELL, GAME_DATA_FORMAT, PLAYER_ROOT_ID, type GameData } from '../shared/game-data'
import { createDebug } from './debug'
import { clear, h } from './dom'
import { makeUi } from './i18n'
import type { EduEngineApi, ItemRenderer, PlayerState, Shell } from './types'

/** The version of the player runtime (`window.EduEngine.version`). */
export const ENGINE_VERSION = '1.0.0'

/** The seed of this page: `?seed=N` in the address (so a run can be replayed), else random. */
export function pageSeed(search: string = typeof location === 'undefined' ? '' : location.search): number {
  const raw = new URLSearchParams(search).get('seed')
  const n = raw === null ? NaN : Number(raw)
  return Number.isInteger(n) && n >= 0 && n < 2 ** 31 ? n : Math.floor(Math.random() * 2 ** 31)
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

  const fail = (root: HTMLElement | null, message: string, lang = 'en'): void => {
    state = { ...state, screen: 'error' }
    const ui = makeUi(lang)
    if (root) {
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
      renderers.set(kind, renderer)
    },
    getState() {
      return JSON.parse(JSON.stringify(state)) as PlayerState
    },
    debug: createDebug(() => state),
    start() {
      if (started) return
      const root = document.getElementById(PLAYER_ROOT_ID)
      const data: unknown = window.EDU_GAME_DATA
      if (!root) return fail(null, `the page has no #${PLAYER_ROOT_ID} element`)
      if (!isGameData(data)) return fail(root, 'game-data.js did not define window.EDU_GAME_DATA')
      const wanted = data.shell || DEFAULT_SHELL
      const shell = shells.get(wanted) ?? shells.get(DEFAULT_SHELL)
      if (!shell) return fail(root, `no shell "${wanted}" is registered`, data.defaultLang)
      started = shell
      const seed = pageSeed()
      try {
        shell.mount({
          root,
          data,
          seed,
          getItemRenderer: (kind) => renderers.get(kind),
          publish: (s) => {
            state = s
          }
        })
      } catch (e) {
        started = null
        fail(root, e instanceof Error ? e.message : String(e), data.defaultLang)
      }
    }
  }
  return api
}
