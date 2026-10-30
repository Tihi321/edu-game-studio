/**
 * What the encyclopedia keeps in `progress.shells.encyclopedia.data`: the collectibles found (step ids) and the articles read. Pure.
 * Read it through `readData`: an imported progress file may hold anything.
 */

export interface EncData {
  /** Step ids whose collectible is in the codex. */
  found: string[]
  /** Article ids opened at least once. */
  read: string[]
}

export const emptyData = (): EncData => ({ found: [], read: [] })

const strings = (v: unknown, allowed: ReadonlySet<string>): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && allowed.has(x)))] : [])

/** The saved data with unknown ids dropped (a course may change between sessions). */
export function readData(raw: unknown, stepIds: ReadonlySet<string>, articleIds: ReadonlySet<string>): EncData {
  if (typeof raw !== 'object' || raw === null) return emptyData()
  const o = raw as Record<string, unknown>
  return { found: strings(o.found, stepIds), read: strings(o.read, articleIds) }
}

export const withFound = (d: EncData, stepId: string): EncData => (d.found.includes(stepId) ? d : { ...d, found: [...d.found, stepId] })
export const withRead = (d: EncData, articleId: string): EncData => (d.read.includes(articleId) ? d : { ...d, read: [...d.read, articleId] })
