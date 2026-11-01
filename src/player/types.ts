import type { CourseItem } from '../shared/course'
import type { CheckContext, CheckResult, SeededRandom, TextResolver } from '../shared/edu'
import type { GameData } from '../shared/game-data'
import type { UiKey } from './i18n'
import type { SpeechService } from './speech/types'

/** The screens the quiz arena shows. The autoplay bot reads `getState().screen`; see `docs/player.md`. */
export type ScreenName = 'loading' | 'error' | 'title' | 'map' | 'item' | 'feedback' | 'summary' | 'review' | 'end'

/**
 * A screen of any shell: the quiz arena's (`ScreenName`) or a shell's own (`world`, `room`, `battle`, `article`, `case` ...). Every
 * shell shares `loading`, `error`, `title`, `item` (a question waits for an answer), `feedback` (after the answer, until `next`) and
 * `end` (the course is finished); see docs/player.md, "Shells".
 */
export type AnyScreen = ScreenName | (string & {})

export type RoundKind = 'unit' | 'boss' | 'review' | 'verbs'

/** The JSON-safe snapshot `window.EduEngine.getState()` returns. */
export interface PlayerState {
  screen: AnyScreen
  shell: string
  lang: string
  seed: number
  unitId?: string
  /** The 1-based number of the round in this page session (a replay is a new round). */
  round?: number
  roundKind?: RoundKind
  itemId?: string
  itemKind?: string
  /** 0-based position of the current question in the round, retries of missed items included. */
  itemIndex?: number
  /** How many fresh (first-time) questions the round has; retries come on top. */
  roundSize?: number
  combo: number
  score: number
  lastResult?: { correct: boolean; typo?: boolean; diacritics?: boolean }
  /** Ids of the items missed and not yet answered right (the review queue). */
  reviewQueue: string[]
  /** Unit id -> stars 0..3. */
  mastery: Record<string, number>
  finished: boolean
  /** Answers submitted in this page session (a flashcard grade is an answer). */
  steps: number
  /** Shells: what the open question is for (`door`, `battle`, `hunt`, `line`, `clue` ...), on the screens `item` and `feedback`. */
  context?: string
  /** Shells: their own JSON-safe state (the room, hit points, found clues ...); documented per shell in docs/player.md. */
  view?: Record<string, unknown>
}

/** What a renderer gets for one question. */
export interface ItemContext {
  item: CourseItem
  data: GameData
  lang: string
  text: TextResolver
  check: CheckContext
  /** A generator for this presentation (option shuffles); the same seed and item give the same order. */
  rng: SeededRandom
  /** The seed of this presentation (for helpers such as `presentedOrder`). */
  seed: string
  assetUrl(id: string | undefined): string | undefined
  assetAlt(id: string | undefined): string
  ui(key: UiKey, vars?: Record<string, string | number>): string
  /** Letters to offer as buttons under a text input (Croatian: č ć š ž đ), empty for none. */
  specialLetters: string[]
  /** Hands the answer over. The shell checks it with `checkItem` and shows the feedback. Calling it again returns the first result. */
  submit(answer: unknown): CheckResult
  /** A clip is playing (true) or has stopped (false): the shell's music goes quieter meanwhile (`GameAudio.duck`). Missing in the studio's preview. */
  duck?(on: boolean): void
  /** The passage panel of an item starts open (the encyclopedia reader's practice); missing: closed. */
  passageOpen?: boolean
  /** Speaking practice (EGS-18): a recognizer for the course's target language, or missing (no recognizer, not a language course, switched off, the studio's preview). */
  speech?: SpeechService
}

export interface ItemView {
  el: HTMLElement
  /** Moves the focus to the first thing to do. */
  focus(): void
  /** Marks the right and wrong parts and locks the input. */
  reveal(result: CheckResult, answer: unknown): void
  /** Keyboard shortcuts of the item (number keys). Return true when the key was used. */
  key?(e: KeyboardEvent): boolean
  /** Called when the view leaves the page (stop audio, timers). */
  destroy?(): void
}

export interface ItemRenderer {
  kind: string
  /** true: the renderer draws the prompt itself (a flashcard front), so the shell leaves its heading out. */
  ownsPrompt?: boolean
  render(ctx: ItemContext): ItemView
}

export interface ShellHost {
  root: HTMLElement
  data: GameData
  seed: number
  getItemRenderer(kind: string): ItemRenderer | undefined
  /** The shell publishes its state here after every change; `getState()` returns a copy. */
  publish(state: PlayerState): void
  /** The shells this game can be played in (the course's `shells.enabled` that are registered), in order. */
  shells: readonly string[]
  /** Leaves this shell and mounts another one of `shells` (the choice is remembered per course). Unknown ids are ignored. */
  switchShell(id: string): void
  /** Read-only helpers for the autoplay bot, published as `EduEngine.debug.shell` while this shell is mounted (null clears them). */
  setDebug(api: ShellDebugApi | null): void
}

/** A shell's bot helpers (`EduEngine.debug.shell`): pure reads of the shell's state, never a change and never drawn. */
export type ShellDebugApi = Record<string, (...args: never[]) => unknown>

export interface Shell {
  id: string
  mount(host: ShellHost): void
  unmount?(): void
}

/** Read-only helper for the autoplay bot: answers in the shapes of `src/shared/edu/checkers.ts`, in the edition being played. */
export interface EduDebugApi {
  /** An answer the checker accepts (`undefined` for an unknown item or kind). */
  solve(itemId: string): unknown
  /** An answer the checker rejects (`undefined` for an unknown item or kind). */
  wrong(itemId: string): unknown
  /** The mounted shell's own helpers (a route to the next door, the solution of a case ...), when it has any. */
  shell?: ShellDebugApi
}

export interface EduEngineApi {
  version: string
  registerShell(id: string, shell: Shell): void
  registerItemKind(kind: string, renderer: ItemRenderer): void
  getState(): PlayerState
  /** The bot's solver hook (see `docs/player.md`). */
  debug: EduDebugApi
  /** Mounts the shell chosen for this page (idempotent): `?shell=<id>`, else the remembered choice, else `GameData.shell`. */
  start(): void
  /** Unmounts the shell and mounts another playable one (what the shell picker on the title screen does). */
  switchShell(id: string): void
  /** The shells this game can be played in (registered and enabled by the course), in order. */
  playableShells(): string[]
}

declare global {
  interface Window {
    EduEngine: EduEngineApi
    EDU_GAME_DATA?: GameData
  }
}
