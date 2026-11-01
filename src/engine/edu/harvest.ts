import { glossCardId, glossDeckKey, GLOSS_TAG } from '../../shared/gloss-deck'
import { paragraphsOf } from '../../shared/shells/encyclopedia'
import { plainReading, sentencesOf } from '../../shared/reading'

/**
 * The vocabulary harvest (EGS-36): one flashcard for each glossary entry of each reading, so the words of the texts enter the spaced-repetition
 * deck. Deterministic (no model), idempotent (the id of a card is `<articleId>-gl-<n>`, n = the position of the entry in the glossary, 1-based; a card
 * that exists is kept as it is) and it honours the learner's "in my deck" switch (`glossOff`: keys `<articleId>/<entryId>`; a hidden entry gets no
 * new card, and the player never queues a hidden entry's existing card either: see `shared/gloss-deck.ts`).
 *
 * The card: the front is the sentence of the text with the word marked, in the taught language (so in the target catalog); the back is the
 * lemma and the gloss (in the source language, so the editions step translates it); the explanation repeats the gloss and the note. It is attached to the
 * first objective of the reading's unit, tagged `gloss`, and `extensions.gloss` names the entry. Works on the raw pack and catalogs (what is on disk).
 */

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export interface HarvestOptions {
  /** Entries taken out of the deck: `<articleId>/<entryId>`. */
  glossOff?: Iterable<string>
}

export interface HarvestResult {
  /** The ids of the cards made now. */
  added: string[]
  /** The ids of the cards that were there already. */
  kept: string[]
  /** The ids not made because the entry is hidden. */
  hidden: string[]
}

/** The sentence of a reading that holds the term, with the term marked in guillemets; the term alone when it is not found. */
export function termInSentence(body: string, term: string): string {
  const text = paragraphsOf([plainReading(body)])
    .filter((p) => !/^#{1,6}\s/.test(p))
    .join('\n')
  const sentence = sentencesOf(text).find((s) => s.includes(term))
  if (!sentence) return `«${term}»`
  const at = sentence.indexOf(term)
  return `${sentence.slice(0, at)}«${term}»${sentence.slice(at + term.length)}`.replace(/\s+/g, ' ').trim()
}

/** Adds the harvested flashcards to `pack` and the catalogs (both mutated). Throws when the pack has no objective. */
export function harvestGlossary(pack: Json, catalogs: Record<string, Json>, opts: HarvestOptions = {}): HarvestResult {
  const result: HarvestResult = { added: [], kept: [], hidden: [] }
  const shells = isObj(pack.shells) ? pack.shells : {}
  const config = isObj(shells.config) ? shells.config : {}
  const section = isObj(config.encyclopedia) ? config.encyclopedia : {}
  const glossary = isObj(section.glossary) ? section.glossary : {}
  if (Object.keys(glossary).length === 0) return result
  const source = String(pack.sourceLang)
  const target = typeof pack.targetLang === 'string' ? pack.targetLang : source
  const strings = (lang: string): Record<string, string> => {
    const cat = catalogs[lang] ?? (catalogs[lang] = { schema: 1, lang, strings: {} })
    if (!isObj(cat.strings)) cat.strings = {}
    return cat.strings as Record<string, string>
  }
  const src = strings(source)
  const tgt = strings(target)
  const text = (key: unknown): string => (typeof key === 'string' ? (tgt[key] ?? src[key] ?? '') : '')
  const off = new Set(opts.glossOff ?? [])
  const items = arr(pack.items) as Json[]
  const have = new Set(items.map((i) => String(i.id)))
  const objectives = arr(pack.objectives).filter(isObj)
  const articles = arr(isObj(pack.encyclopedia) ? pack.encyclopedia.articles : []).filter(isObj)
  for (const article of articles) {
    const id = String(article.id)
    const entries = arr(glossary[id]).filter(isObj)
    if (entries.length === 0) continue
    const unit = typeof article.unit === 'string' ? article.unit : undefined
    const objective = objectives.find((o) => o.unit === unit) ?? objectives[0]
    if (!objective) throw new Error('the course has no objective to attach the vocabulary cards to')
    const body = text(article.body)
    const facts = arr(article.citations).filter((c): c is string => typeof c === 'string')
    entries.forEach((e, i) => {
      const cardId = glossCardId(id, i + 1)
      if (have.has(cardId)) {
        result.kept.push(cardId)
        return
      }
      if (off.has(glossDeckKey(id, String(e.id)))) {
        result.hidden.push(cardId)
        return
      }
      const term = text(e.term)
      if (!term) return // the lint (TEXT_MISSING) reports a gloss without its term
      const lemma = text(e.lemma) || term
      const gloss = text(e.gloss)
      const note = text(e.note)
      const k = (suffix: string): string => `item.${cardId}.${suffix}`
      tgt[k('prompt')] = termInSentence(body, term)
      src[k('back')] = `${lemma}: ${gloss}`
      src[k('expl')] = `${term}: ${gloss}${note ? ` (${note})` : ''}`
      items.push({
        id: cardId,
        objective: objective.id,
        kind: 'flashcard',
        prompt: k('prompt'),
        back: k('back'),
        explanation: k('expl'),
        difficulty: 2,
        tags: [GLOSS_TAG, ...(unit ? [`unit:${unit}`] : [])],
        extensions: { gloss: { article: id, entry: String(e.id) }, ...(facts.length ? { facts } : {}) }
      })
      have.add(cardId)
      result.added.push(cardId)
    })
  }
  pack.items = items
  return result
}
