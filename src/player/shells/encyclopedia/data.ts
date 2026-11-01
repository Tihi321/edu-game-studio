/**
 * What the encyclopedia keeps in `progress.shells.encyclopedia.data`: the collectibles found (step ids) and the articles read, and for a
 * reading course (EGS-35) where the reader stands (`reader`) and the glosses the learner took out of the vocabulary deck (`glossOff`).
 * Pure. Read it through `readData`: an imported progress file may hold anything.
 */

/** Where the reader stands: the chapter open, how far down it (0 to 1) and the chapters read to their last paragraph. */
export interface ReaderState {
  chapter?: string
  scroll: number
  done: string[]
}

export interface EncData {
  /** Step ids whose collectible is in the codex. */
  found: string[]
  /** Article ids opened at least once. */
  read: string[]
  /** The reader's place (missing until the reader has been opened). */
  reader?: ReaderState
  /** Glosses switched out of the deck, as `<articleId>/<glossId>` (missing when none). */
  glossOff?: string[]
}

export const emptyData = (): EncData => ({ found: [], read: [] })

const strings = (v: unknown, allowed: ReadonlySet<string>): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && allowed.has(x)))] : [])

/** The saved data with unknown ids dropped (a course may change between sessions). `glossKeys` are the `<articleId>/<glossId>` the course has. */
export function readData(raw: unknown, stepIds: ReadonlySet<string>, articleIds: ReadonlySet<string>, glossKeys: ReadonlySet<string> = new Set()): EncData {
  if (typeof raw !== 'object' || raw === null) return emptyData()
  const o = raw as Record<string, unknown>
  const out: EncData = { found: strings(o.found, stepIds), read: strings(o.read, articleIds) }
  const r = o.reader
  if (typeof r === 'object' && r !== null) {
    const x = r as Record<string, unknown>
    const chapter = typeof x.chapter === 'string' && articleIds.has(x.chapter) ? x.chapter : undefined
    const scroll = typeof x.scroll === 'number' && Number.isFinite(x.scroll) ? Math.min(1, Math.max(0, x.scroll)) : 0
    out.reader = { ...(chapter ? { chapter } : {}), scroll, done: strings(x.done, articleIds) }
  }
  const off = strings(o.glossOff, glossKeys)
  if (off.length > 0) out.glossOff = off
  return out
}

export const withFound = (d: EncData, stepId: string): EncData => (d.found.includes(stepId) ? d : { ...d, found: [...d.found, stepId] })
export const withRead = (d: EncData, articleId: string): EncData => (d.read.includes(articleId) ? d : { ...d, read: [...d.read, articleId] })

/** The reader moved: another chapter (scroll back to the top) or a new scroll position in the same one. */
export function withReaderAt(d: EncData, chapter: string, scroll: number): EncData {
  const cur = d.reader ?? { scroll: 0, done: [] }
  const s = Math.min(1, Math.max(0, scroll))
  if (cur.chapter === chapter && Math.abs(cur.scroll - s) < 0.005) return d
  return { ...d, reader: { ...cur, chapter, scroll: s } }
}

/** A chapter was read to its last paragraph. */
export function withChapterDone(d: EncData, chapter: string): EncData {
  const cur = d.reader ?? { scroll: 0, done: [] }
  return cur.done.includes(chapter) ? d : { ...d, reader: { ...cur, done: [...cur.done, chapter] } }
}

/** Takes a gloss out of the deck (`inDeck` false) or puts it back. */
export function withGlossDeck(d: EncData, key: string, inDeck: boolean): EncData {
  const off = d.glossOff ?? []
  if (inDeck) {
    if (!off.includes(key)) return d
    const next = off.filter((k) => k !== key)
    const { glossOff: _drop, ...rest } = d
    return next.length > 0 ? { ...rest, glossOff: next } : rest
  }
  return off.includes(key) ? d : { ...d, glossOff: [...off, key] }
}

/** The key of a gloss in `glossOff`. */
export const glossKey = (articleId: string, glossId: string): string => `${articleId}/${glossId}`
