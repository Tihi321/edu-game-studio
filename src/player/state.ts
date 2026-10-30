import type { CheckResult } from '../shared/edu'
import type { AnyScreen, PlayerState, RoundKind } from './types'

/** Everything the snapshot is made from. The shell fills it; `buildSnapshot` turns it into the JSON-safe `getState()` value. */
export interface SnapshotInput {
  screen: AnyScreen
  shell: string
  lang: string
  seed: number
  roundNumber?: number
  roundKind?: RoundKind
  unitId?: string
  itemId?: string
  itemKind?: string
  itemIndex?: number
  roundSize?: number
  combo: number
  score: number
  lastResult?: Pick<CheckResult, 'correct' | 'typo' | 'diacritics'>
  reviewQueue: readonly string[]
  mastery: Readonly<Record<string, number>>
  finished: boolean
  steps: number
  /** Shells: what the open question is for (kept on `item` and `feedback` only). */
  context?: string
  /** Shells: their own state, JSON-safe (it is deep-copied). */
  view?: Readonly<Record<string, unknown>>
}

/** A fresh, JSON-safe object (no undefined, no shared references): the caller can keep or mutate it without touching the shell. */
export function buildSnapshot(i: SnapshotInput): PlayerState {
  const inItem = i.screen === 'item' || i.screen === 'feedback'
  return {
    screen: i.screen,
    shell: i.shell,
    lang: i.lang,
    seed: i.seed,
    ...(i.unitId ? { unitId: i.unitId } : {}),
    ...(i.roundNumber !== undefined && i.roundNumber > 0 ? { round: i.roundNumber } : {}),
    ...(i.roundKind ? { roundKind: i.roundKind } : {}),
    ...(inItem && i.itemId ? { itemId: i.itemId } : {}),
    ...(inItem && i.itemKind ? { itemKind: i.itemKind } : {}),
    ...(inItem && i.itemIndex !== undefined ? { itemIndex: i.itemIndex } : {}),
    ...(i.roundSize !== undefined && i.roundKind ? { roundSize: i.roundSize } : {}),
    combo: i.combo,
    score: i.score,
    ...(i.lastResult && i.screen === 'feedback'
      ? { lastResult: { correct: i.lastResult.correct, ...(i.lastResult.typo ? { typo: true } : {}), ...(i.lastResult.diacritics ? { diacritics: true } : {}) } }
      : {}),
    reviewQueue: [...i.reviewQueue],
    mastery: { ...i.mastery },
    finished: i.finished,
    steps: i.steps,
    ...(inItem && i.context ? { context: i.context } : {}),
    ...(i.view ? { view: JSON.parse(JSON.stringify(i.view)) as Record<string, unknown> } : {})
  }
}
