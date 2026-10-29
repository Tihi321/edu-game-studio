import type { TextCatalog } from '../course'

/**
 * Looks a text key up for one edition. A key is found in the edition's catalog first, then in the target-language catalog of a language
 * course (`pack.targetLang`): the phrases that are taught are the same in every edition and are not translated with the UI text.
 * `accepted(key)` is the list of accepted spellings of a typed answer (first = canonical); a key without an `accepted` entry falls back to
 * its string, so a typed answer works even if the author only wrote the string.
 */
export interface TextResolver {
  lang: string
  /** The text of a key, or undefined. */
  text(key: string): string | undefined
  /** The text of a key, or the key itself (what a UI shows for a missing string, so the gap is visible). */
  t(key: string): string
  /** Accepted answers of a key: the `accepted` entry, else the string, else an empty list. */
  accepted(key: string): string[]
  /** The canonical answer of a key (first accepted entry), or undefined. */
  canonical(key: string): string | undefined
  hasText(key: string): boolean
  /** True when a non-empty `accepted` entry exists for the key. */
  hasAccepted(key: string): boolean
}

export function makeTextResolver(catalogs: Readonly<Record<string, TextCatalog>>, lang: string, targetLang?: string): TextResolver {
  const edition = catalogs[lang]
  const target = targetLang && targetLang !== lang ? catalogs[targetLang] : undefined
  const text = (key: string): string | undefined => edition?.strings[key] ?? target?.strings[key]
  const explicit = (key: string): string[] | undefined => {
    const a = edition?.accepted?.[key] ?? target?.accepted?.[key]
    return a && a.length > 0 ? a : undefined
  }
  return {
    lang,
    text,
    t: (key) => text(key) ?? key,
    accepted: (key) => {
      const a = explicit(key)
      if (a) return a
      const s = text(key)
      return s ? [s] : []
    },
    canonical: (key) => explicit(key)?.[0] ?? text(key),
    hasText: (key) => text(key) !== undefined,
    hasAccepted: (key) => explicit(key) !== undefined
  }
}
