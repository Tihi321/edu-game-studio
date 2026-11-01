/**
 * Counting a reading (EGS-36): words, sentences and their length, the same way for the writer's check (`checkArticles`), the lint
 * (`READING_LENGTH`, `READING_SENTENCE_LENGTH`) and the tests. Pure. Sentence and word counts are a proxy for the level of a text, never a proof.
 */

/** The words of a text, not counting headings (`## ...`) and the citation numbers (`[1]`, `[1, 2]`, `[f3]`). */
export function plainReading(body: string): string {
  return body
    .split('\n')
    .filter((l) => !/^\s*#{1,6}\s/.test(l))
    .join('\n')
    .replace(/\[(?:f?\d{1,4})(?:\s*[,;]\s*f?\d{1,4})*\]/g, '')
}

/** German abbreviations whose dot does not end a sentence. */
const ABBREVIATIONS = /\b(z\.\s?B|d\.\s?h|u\.\s?a|z\.\s?T|bzw|usw|ca|Dr|Prof|Nr|Mio|Mrd|vgl|etc|St)\./g

export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
}

/** The sentences of a text: cut after . ! ? followed by a space or a line break (abbreviations like "z. B." do not end one). */
export function sentencesOf(text: string): string[] {
  const t = text.replace(ABBREVIATIONS, (m) => m.replace(/\./g, '․'))
  return t
    .split(/(?<=[.!?…])["»«“”)]?\s+|\n+/)
    .map((s) => s.replace(/․/g, '.').trim())
    .filter((s) => wordsOf(s).length > 0)
}

export interface ReadingStats {
  words: number
  sentences: number
  /** Mean words per sentence. */
  mean: number
  /** Words in the longest sentence. */
  longest: number
}

export function readingStats(body: string): ReadingStats {
  const plain = plainReading(body)
  const sentences = sentencesOf(plain)
  const lengths = sentences.map((s) => wordsOf(s).length)
  const words = lengths.reduce((a, b) => a + b, 0)
  return { words, sentences: sentences.length, mean: sentences.length ? words / sentences.length : 0, longest: lengths.length ? Math.max(...lengths) : 0 }
}

/** The word band a B2 reading must stay in (the lint warns outside it), and the mean sentence length band. */
export const READING_WORD_BAND: readonly [number, number] = [300, 800]
export const READING_MEAN_SENTENCE_BAND: readonly [number, number] = [12, 26]
export const READING_MAX_SENTENCE = 45

/** The band for a reading of a course whose format asks for `[min, max]` words: B2 keeps the plan's 300 to 800, a shorter format scales it. */
export function readingBand(cefr: string | undefined, asked?: readonly [number, number]): readonly [number, number] {
  if (cefr === 'B2' || !asked) return READING_WORD_BAND
  return [Math.round(asked[0] * 0.75), Math.round(asked[1] * 1.15)]
}
