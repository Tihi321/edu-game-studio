/**
 * Tolerant matching of a typed answer. Pure TypeScript, no DOM, no node.
 *
 * THE POLICY (one place, so the player, the bot and the lint agree):
 *
 *  1. Normalisation (`normalizeText`): Unicode NFKC, lower case, apostrophes dropped, every other run of punctuation or whitespace is one
 *     space, ends trimmed. So case, spacing and punctuation never matter ("Dobro sam,  hvala!" = "dobro sam hvala").
 *  2. Exact: the normalised input equals a normalised accepted answer, accents included. Always correct.
 *  3. Accents: if the two are equal only after diacritics folding (`foldDiacritics`: c with a caron or acute -> c, s caron -> s, z caron
 *     -> z, d with a stroke -> d, plus any other NFD combining mark; and the digraph `dj` counts as the stroked d), the answer is a
 *     near-miss on accents. The policy decides what that is worth (`MatchOptions.diacritics`):
 *       - `ignore` (default for a subject course): correct, nothing reported;
 *       - `warn` (language courses): correct, `diacritics: true` so the UI can say "mind the accents";
 *       - `strict` (an item with `strictDiacritics: true`): NOT correct, `diacritics: true` so the UI can say "almost: check the accents".
 *  4. Typos: an answer one edit away (Levenshtein distance <= 1: one letter inserted, dropped or changed; a swap of two letters is
 *     distance 2 and is not accepted) is a typo, correct with `typo: true` ("accepted, mind the spelling"), but ONLY when the accepted
 *     answer has at least 4 letters (spaces not counted): "dan" must not become "tan". Compared on folded text, so accents never cost
 *     an edit; under `strict` the typo is measured on unfolded text, so a missing accent is a near-miss (rule 3), never a "typo".
 *  5. Synonyms are simply further entries in the accepted list (`TextCatalog.accepted`); every entry is tried, the first is the
 *     canonical answer. Distance 2 or more is wrong.
 */

export type DiacriticsPolicy = 'ignore' | 'warn' | 'strict'

export interface MatchOptions {
  diacritics?: DiacriticsPolicy
  /** Allow a one-letter typo (default true). */
  typos?: boolean
  /** The accepted answer needs at least this many letters for typo tolerance (default 4). */
  minTypoLength?: number
}

export interface MatchResult {
  correct: boolean
  /** The normalised input equals the accepted answer with its accents. */
  exact: boolean
  /** Accepted although a letter is wrong, missing or extra. */
  typo: boolean
  /** The accents differ (reported when the policy is `warn` or `strict`). */
  diacritics: boolean
  /** The accepted entry that matched (or came nearest, for a wrong answer). */
  matched: string | null
  /** The first accepted entry. */
  canonical: string | null
  /** Edit distance of the best candidate on folded text (a wrong answer: how far off). */
  distance: number
}

/** Removes accents: c/c/s/z with carons or acutes, d with a stroke, and every other combining mark; ligatures and special letters are spelt out. */
export function foldDiacritics(s: string): string {
  return s
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/ß/g, 'ss')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'AE')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/ø/g, 'o')
    .replace(/Ø/g, 'O')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
}

/** Case, whitespace and punctuation insensitive form of a text. `fold` also removes accents and reads `dj` as the stroked d. */
export function normalizeText(s: string, opts: { fold?: boolean } = {}): string {
  let t = s.normalize('NFKC').toLowerCase()
  t = t.replace(/['’‘`´]/g, '')
  t = t.replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
  if (opts.fold) t = foldDiacritics(t).replace(/dj/g, 'd')
  return t.replace(/\s+/g, ' ').trim()
}

/** Letters only, folded and upper-cased: how crossword and word-search answers are compared and laid on a grid. */
export function lettersKey(s: string): string {
  return foldDiacritics(s.normalize('NFKC')).toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Levenshtein distance. Stops early once it is certain to exceed `max`, then returns `max + 1`. */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0
  const x = Array.from(a)
  const y = Array.from(b)
  if (Math.abs(x.length - y.length) > max) return max + 1
  if (x.length === 0) return y.length
  if (y.length === 0) return x.length
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i)
  for (let i = 1; i <= x.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= y.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1))
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[y.length]!
}

/** Matches `input` against the accepted answers (see the policy above). An empty input never matches. */
export function matchAnswer(input: string, accepted: readonly string[], opts: MatchOptions = {}): MatchResult {
  const policy = opts.diacritics ?? 'ignore'
  const typos = opts.typos !== false
  const minLen = opts.minTypoLength ?? 4
  const canonical = accepted[0] ?? null
  const miss = (distance: number, matched: string | null): MatchResult => ({ correct: false, exact: false, typo: false, diacritics: false, matched, canonical, distance })

  const inExact = normalizeText(input)
  if (!inExact) return miss(Infinity, null)
  const inFold = normalizeText(input, { fold: true })

  let nearest: string | null = null
  let nearestDist = Infinity
  let foldedHit: string | null = null
  let typoHit: { a: string; d: number } | null = null

  for (const a of accepted) {
    const aExact = normalizeText(a)
    if (!aExact) continue
    if (aExact === inExact) return { correct: true, exact: true, typo: false, diacritics: false, matched: a, canonical, distance: 0 }
    const aFold = normalizeText(a, { fold: true })
    if (aFold === inFold) {
      foldedHit ??= a
      continue
    }
    const d = levenshtein(inFold, aFold, 2)
    if (d < nearestDist) {
      nearestDist = d
      nearest = a
    }
    if (typos && aFold.replace(/ /g, '').length >= minLen) {
      // strict: the typo is measured with the accents, so a lost accent can not hide behind it
      const dm = policy === 'strict' ? levenshtein(inExact, aExact, 1) : d
      if (dm <= 1 && (!typoHit || dm < typoHit.d)) typoHit = { a, d: dm }
    }
  }

  if (foldedHit !== null) {
    if (policy === 'strict') return { correct: false, exact: false, typo: false, diacritics: true, matched: foldedHit, canonical, distance: 0 }
    return { correct: true, exact: false, typo: false, diacritics: policy === 'warn', matched: foldedHit, canonical, distance: 0 }
  }
  if (typoHit) return { correct: true, exact: false, typo: true, diacritics: false, matched: typoHit.a, canonical, distance: typoHit.d }
  return miss(nearestDist, nearest)
}

/** The policy of an item: its own `strictDiacritics` wins (true = strict, false = ignore), else the course default. */
export function resolveDiacritics(itemStrict: boolean | undefined, courseDefault: DiacriticsPolicy | undefined): DiacriticsPolicy {
  if (itemStrict === true) return 'strict'
  if (itemStrict === false) return 'ignore'
  return courseDefault ?? 'ignore'
}
