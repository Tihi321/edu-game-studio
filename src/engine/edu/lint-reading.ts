import type { CoursePack } from '../../shared/course'
import type { TextResolver } from '../../shared/edu'
import { READING_MAX_SENTENCE, READING_MEAN_SENTENCE_BAND, readingBand, readingStats } from '../../shared/reading'
import { paragraphsOf, passageOf } from '../../shared/shells/encyclopedia'

/**
 * Lint of the readings of a language course (EGS-36), run from `lintGameData`. The `GLOSS_*` codes belong to the encyclopedia shell (EGS-35).
 *
 *   READING_LENGTH             (warning) a reading has fewer or more words than its band (300 to 800 for B2; the format's band scaled for other levels)
 *   READING_SENTENCE_LENGTH    (warning) the mean sentence is outside 12 to 26 words, or one sentence has more than 45
 *   READING_ITEM_NO_PASSAGE    an item tagged `reading` has no `extensions.passage`, or its article or paragraph range does not exist
 *   READING_ITEM_COUNT         (warning) a reading has fewer than 4 items about it
 *   TFNG_OPTIONS               a `tfng` item is not an mcq with the options t, f, ng in that order and `shuffle: false`
 *   SELFCHECK_NO_MODEL         a `self-check` item is not a flashcard whose back is a model answer of at least 25 words
 *
 * A reading is an article with a glossary, or any article of a B2 language course. Sentence statistics are a proxy for the level of a text, not a proof.
 */

export const READING_LINT_CODES = ['READING_LENGTH', 'READING_SENTENCE_LENGTH', 'READING_ITEM_NO_PASSAGE', 'READING_ITEM_COUNT', 'TFNG_OPTIONS', 'SELFCHECK_NO_MODEL'] as const
export const READING_WARNING_CODES: ReadonlySet<string> = new Set(['READING_LENGTH', 'READING_SENTENCE_LENGTH', 'READING_ITEM_COUNT'])

export interface ReadingProblem {
  code: (typeof READING_LINT_CODES)[number]
  path: string
  message: string
  severity: 'error' | 'warning'
}

/** The least words a self-check model answer has. */
export const SELFCHECK_MIN_WORDS = 25
/** The least items a reading has. */
export const READING_MIN_ITEMS = 4

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The glossary of the encyclopedia section, as far as the lint needs it: article id -> number of entries. */
function glossedArticles(pack: CoursePack): Set<string> {
  const section = (pack.shells?.config as Record<string, unknown> | undefined)?.encyclopedia
  const glossary = isObj(section) && isObj(section.glossary) ? section.glossary : {}
  return new Set(Object.entries(glossary).filter(([, v]) => Array.isArray(v) && v.length > 0).map(([id]) => id))
}

/** The words a reading was asked to have (`extensions.language.reading.words`), if the pipeline recorded them. */
function askedWords(pack: CoursePack): [number, number] | undefined {
  const lang = pack.extensions?.language
  const reading = isObj(lang) ? lang.reading : undefined
  const words = isObj(reading) ? reading.words : undefined
  return Array.isArray(words) && words.length === 2 && words.every((n) => typeof n === 'number') ? [words[0] as number, words[1] as number] : undefined
}

export function lintReading(pack: CoursePack, res: TextResolver): ReadingProblem[] {
  const out: ReadingProblem[] = []
  const glossed = glossedArticles(pack)
  const b2 = pack.cefr === 'B2' && !!pack.targetLang
  const bodies = new Map(pack.encyclopedia.articles.map((a) => [a.id, res.text(a.body) ?? '']))
  const [lo, hi] = readingBand(pack.cefr, askedWords(pack))

  // ---- the texts ----
  pack.encyclopedia.articles.forEach((a, i) => {
    if (!glossed.has(a.id) && !b2) return
    // A1/A2 article texts have a glossary but are short notes, not graded readings: the pipeline records no reading band for them (no extensions.language.reading).
    if (!b2 && !askedWords(pack)) return
    const at = `encyclopedia.articles[${i}]`
    const body = bodies.get(a.id) ?? ''
    if (body.trim() === '') return // TEXT_MISSING
    const st = readingStats(body)
    if (st.words < lo || st.words > hi) out.push({ code: 'READING_LENGTH', severity: 'warning', path: `${at}.body`, message: `the reading "${a.id}" has ${st.words} words; a reading of this course has ${lo} to ${hi}` })
    const [mlo, mhi] = READING_MEAN_SENTENCE_BAND
    if (st.mean < mlo || st.mean > mhi || st.longest > READING_MAX_SENTENCE) {
      out.push({ code: 'READING_SENTENCE_LENGTH', severity: 'warning', path: `${at}.body`, message: `the reading "${a.id}" has sentences of ${st.mean.toFixed(1)} words on average (the band is ${mlo} to ${mhi}) and the longest has ${st.longest} words (at most ${READING_MAX_SENTENCE})` })
    }
    const n = pack.items.filter((it) => passageOf(it)?.article === a.id).length
    if (n < READING_MIN_ITEMS) out.push({ code: 'READING_ITEM_COUNT', severity: 'warning', path: at, message: `the reading "${a.id}" has ${n} item(s) about it; a reading needs at least ${READING_MIN_ITEMS} (give them extensions.passage)` })
  })

  // ---- the items ----
  pack.items.forEach((it, i) => {
    const at = `items[${i}]`
    const tags = it.tags ?? []
    const rawPassage = isObj(it.extensions) ? it.extensions.passage : undefined
    const passage = passageOf(it)
    if (tags.includes('reading') && !passage) out.push({ code: 'READING_ITEM_NO_PASSAGE', severity: 'error', path: `${at}.extensions.passage`, message: `the item "${it.id}" is tagged "reading" but names no passage (extensions.passage = { article, paragraphs? })` })
    else if (rawPassage !== undefined && !passage) out.push({ code: 'READING_ITEM_NO_PASSAGE', severity: 'error', path: `${at}.extensions.passage`, message: `the passage of the item "${it.id}" is malformed (it needs an article id and, optionally, paragraphs: [from, to])` })
    else if (passage) {
      const body = bodies.get(passage.article)
      if (body === undefined) out.push({ code: 'READING_ITEM_NO_PASSAGE', severity: 'error', path: `${at}.extensions.passage.article`, message: `the passage of the item "${it.id}" is the article "${passage.article}", which does not exist` })
      else if (passage.paragraphs) {
        const count = paragraphsOf([body]).length
        if (passage.paragraphs[1] > count) out.push({ code: 'READING_ITEM_NO_PASSAGE', severity: 'error', path: `${at}.extensions.passage.paragraphs`, message: `the passage of the item "${it.id}" ends at paragraph ${passage.paragraphs[1]}, the text "${passage.article}" has ${count}` })
      }
    }
    if (tags.includes('tfng')) {
      const raw = it as unknown as { options?: { id?: unknown }[]; shuffle?: unknown }
      const ids = it.kind === 'mcq' && Array.isArray(raw.options) ? raw.options.map((o) => String(o.id)).join(',') : ''
      if (it.kind !== 'mcq' || ids !== 't,f,ng' || raw.shuffle !== false) {
        out.push({ code: 'TFNG_OPTIONS', severity: 'error', path: at, message: `the true / false / not given item "${it.id}" must be an mcq with the options t, f, ng in this order and shuffle: false` })
      }
    }
    if (tags.includes('self-check')) {
      const back = it.kind === 'flashcard' ? res.text(String((it as unknown as { back?: unknown }).back)) : undefined
      const words = back ? back.split(/\s+/).filter(Boolean).length : 0
      if (it.kind !== 'flashcard' || words < SELFCHECK_MIN_WORDS) {
        out.push({ code: 'SELFCHECK_NO_MODEL', severity: 'error', path: `${at}.back`, message: `the self-check card "${it.id}" has ${it.kind === 'flashcard' ? `a model answer of ${words} word(s)` : 'no model answer (it is not a flashcard)'}; the learner compares with it, so it needs at least ${SELFCHECK_MIN_WORDS} words` })
      }
    }
  })
  return out
}
