/**
 * The vocabulary deck of the readings (EGS-36): a flashcard harvested from a glossary entry names its entry in `extensions.gloss`
 * (`{ article, entry }`), and the learner can take an entry out of the deck in the reader ("in my deck" off, saved as `glossOff` in the
 * encyclopedia's shell data with the key `<articleId>/<entryId>`). A hidden entry's card is never queued. Pure.
 */

/** The tag of a harvested card. */
export const GLOSS_TAG = 'gloss'

/** The key of an entry in `glossOff` (the same as the reader's). */
export const glossDeckKey = (articleId: string, entryId: string): string => `${articleId}/${entryId}`

/** The id of the card harvested from the n-th (1-based) entry of an article's glossary. */
export const glossCardId = (articleId: string, n: number): string => `${articleId}-gl-${n}`

/** The entry a harvested card stands for, or null for any other item. */
export function glossOf(item: { extensions?: Record<string, unknown> | undefined }): { article: string; entry: string } | null {
  const g = item.extensions?.gloss
  if (typeof g !== 'object' || g === null) return null
  const o = g as Record<string, unknown>
  return typeof o.article === 'string' && typeof o.entry === 'string' ? { article: o.article, entry: o.entry } : null
}

/** Whether the learner took the card's entry out of the deck. */
export function isGlossHidden(item: { extensions?: Record<string, unknown> | undefined }, off: ReadonlySet<string>): boolean {
  const g = glossOf(item)
  return g !== null && off.has(glossDeckKey(g.article, g.entry))
}

/** The ids of the items that are hidden by `glossOff`. */
export function hiddenGlossItems(items: readonly { id: string; extensions?: Record<string, unknown> | undefined }[], glossOff: Iterable<string>): Set<string> {
  const off = new Set(glossOff)
  return new Set(items.filter((i) => isGlossHidden(i, off)).map((i) => i.id))
}
