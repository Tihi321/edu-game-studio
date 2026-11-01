import { normalizeText } from '../../../shared/edu/match'
import { paragraphsOf } from '../../../shared/shells/encyclopedia'

/**
 * Reading logic of the encyclopedia, pure (no DOM): the paragraphs of an article, the cross-links in its body (every mention of another
 * article's title: first mention only, longest title first, whole words, case-insensitive) and the search.
 */

export interface Seg {
  text: string
  /** The id of the article this stretch of text links to. */
  link?: string
}

export interface ArticleText {
  id: string
  title: string
  paragraphs: string[]
}

export { paragraphsOf }

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The paragraphs as runs of text and links. A title is linked at its first mention in the whole body (not the article's own title);
 * where two titles overlap ("The Sun" inside "The Sun and the planets") the longer one wins.
 */
export function linkify(paragraphs: readonly string[], selfId: string, others: readonly { id: string; title: string }[]): Seg[][] {
  const cands = others
    .filter((o) => o.id !== selfId && o.title.trim().length >= 3)
    .map((o) => ({ id: o.id, title: o.title.trim() }))
    .sort((a, b) => b.title.length - a.title.length)
  const linked = new Set<string>()
  return paragraphs.map((par) => {
    const found: { start: number; end: number; id: string }[] = []
    for (const c of cands) {
      if (linked.has(c.id)) continue
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc(c.title)}(?![\\p{L}\\p{N}])`, 'iu')
      const m = re.exec(par)
      if (!m) continue
      const start = m.index
      const end = start + m[0].length
      if (found.some((f) => start < f.end && end > f.start)) continue // the longer title came first
      found.push({ start, end, id: c.id })
      linked.add(c.id)
    }
    found.sort((a, b) => a.start - b.start)
    const out: Seg[] = []
    let at = 0
    for (const f of found) {
      if (f.start > at) out.push({ text: par.slice(at, f.start) })
      out.push({ text: par.slice(f.start, f.end), link: f.id })
      at = f.end
    }
    if (at < par.length) out.push({ text: par.slice(at) })
    return out.length > 0 ? out : [{ text: par }]
  })
}

/** The ids of the articles a body links to. */
export const linkedIds = (segs: readonly (readonly Seg[])[]): string[] => [...new Set(segs.flat().flatMap((s) => (s.link ? [s.link] : [])))]

export interface SearchHit {
  id: string
  score: number
  /** The sentence of the body that holds the words (empty for a title hit). */
  snippet: string
}

const fold = (s: string): string => normalizeText(s, { fold: true })

/** Searches titles (first) and bodies. Accents and case do not matter ("bec" finds "Beč"). Fewer than 2 letters: nothing. */
export function searchArticles(query: string, articles: readonly ArticleText[], limit = 8): SearchHit[] {
  const q = fold(query)
  if (q.replace(/ /g, '').length < 2) return []
  const tokens = q.split(' ').filter(Boolean)
  const hits: SearchHit[] = []
  for (const a of articles) {
    const title = fold(a.title)
    const words = title.split(' ')
    let score = 0
    if (title === q) score = 120
    else if (title.startsWith(q)) score = 100
    else if (words.some((w) => w.startsWith(q))) score = 80
    else if (title.includes(q)) score = 60
    else if (tokens.every((t) => title.includes(t))) score = 50
    let snippet = ''
    const sentences = a.paragraphs.flatMap((p) => p.split(/(?<=[.!?])\s+/))
    const hit = sentences.find((s) => tokens.every((t) => fold(s).includes(t)))
    if (hit) {
      snippet = hit.length > 150 ? `${hit.slice(0, 147).trimEnd()}...` : hit
      if (score === 0) score = 20
    }
    if (score > 0) hits.push({ id: a.id, score, snippet: score >= 50 ? '' : snippet })
  }
  return hits.sort((x, y) => y.score - x.score).slice(0, limit)
}

/** A short query that finds the article by its title (a word of it, at least 3 letters, else the whole title): what the bot types. */
export function searchTermFor(article: ArticleText, all: readonly ArticleText[]): string {
  const words = article.title.split(/\s+/).filter((w) => w.replace(/[^\p{L}\p{N}]/gu, '').length >= 3)
  const tries = [...words.sort((a, b) => b.length - a.length), article.title]
  for (const t of tries) if (searchArticles(t, all).some((h) => h.id === article.id)) return t.replace(/[^\p{L}\p{N}\s]/gu, '').trim()
  return article.title
}
