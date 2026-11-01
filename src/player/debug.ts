import type { ClozeItem, CourseItem, CrosswordItem, HotspotItem, ListeningItem, MatchPairsItem, McqItem, MultiSelectItem, OrderItem, SortGroupsItem, TrueFalseItem } from '../shared/course'
import { makeCheckContext, makeTextResolver, solveItem, type CheckContext } from '../shared/edu'
import type { GameData } from '../shared/game-data'
import type { EduDebugApi, PlayerState } from './types'

/**
 * `window.EduEngine.debug`: a read-only helper for the autoplay bot (EGS-04). `solve(itemId)` is an answer the shared checker accepts
 * (`solveItem`), `wrong(itemId)` is one it rejects (a distractor with an explanation where there is one). Both use the shapes of
 * `src/shared/edu/checkers.ts`, in the edition being played. They only read the game data that the page already holds; nothing is
 * drawn in the UI and nothing is changed. Documented in `docs/player.md`.
 */

const wrongOption = (options: readonly { id: string; why?: string | undefined }[], right: readonly string[]): string | undefined => {
  const wrong = options.filter((o) => !right.includes(o.id))
  return (wrong.find((o) => o.why) ?? wrong[0])?.id
}

/** An answer of the item's shape that is wrong; `undefined` for an unknown kind. */
export function wrongAnswerFor(item: CourseItem): unknown {
  switch (item.kind) {
    case 'mcq': {
      const i = item as unknown as McqItem
      return wrongOption(i.options, [i.answer])
    }
    case 'listening': {
      const i = item as unknown as ListeningItem
      return i.mode === 'choose' ? wrongOption(i.options ?? [], [i.answer]) : 'zzzzzz'
    }
    case 'true-false':
      return !(item as unknown as TrueFalseItem).answer
    case 'multi-select': {
      const i = item as unknown as MultiSelectItem
      const w = wrongOption(i.options, i.answers)
      return w === undefined ? [] : [w]
    }
    case 'cloze':
      return Object.fromEntries((item as unknown as ClozeItem).gaps.map((g) => [g.id, 'qqq']))
    case 'typed':
      return 'qqqqq'
    case 'match-pairs': {
      const ids = (item as unknown as MatchPairsItem).pairs.map((p) => p.id)
      return Object.fromEntries(ids.map((id, n) => [id, ids[(n + 1) % ids.length]]))
    }
    case 'order':
      return (item as unknown as OrderItem).items.map((x) => x.id).reverse()
    case 'sort-groups': {
      const i = item as unknown as SortGroupsItem
      return Object.fromEntries(i.items.map((x) => [x.id, i.groups.find((g) => g.id !== x.group)?.id ?? x.group]))
    }
    case 'hotspot': {
      const i = item as unknown as HotspotItem
      const w = i.regions.filter((r) => r.id !== i.answer)
      return (w.find((r) => r.why) ?? w[0])?.id
    }
    case 'flashcard':
      return 'again'
    case 'crossword':
      return Object.fromEntries((item as unknown as CrosswordItem).words.map((w) => [w.id, 'x']))
    case 'word-search':
      return []
    default:
      return undefined
  }
}

export function createDebug(getState: () => PlayerState): EduDebugApi {
  const lookup = (itemId: string): { item: CourseItem; ctx: CheckContext } | undefined => {
    const data: GameData | undefined = window.EDU_GAME_DATA
    const item = data?.pack.items.find((i) => i.id === itemId)
    if (!data || !item) return undefined
    const lang = getState().lang || data.defaultLang
    return { item, ctx: makeCheckContext({ pack: data.pack, text: makeTextResolver(data.catalogs, lang, data.pack.targetLang) }) }
  }
  return {
    solve(itemId) {
      const f = lookup(itemId)
      return f ? solveItem(f.item, f.ctx) : undefined
    },
    wrong(itemId) {
      const f = lookup(itemId)
      return f ? wrongAnswerFor(f.item) : undefined
    }
  }
}
