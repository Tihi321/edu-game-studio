import { z } from 'zod'
import type { TextCatalog } from '../../shared/course'
import { dropNulls } from './authoring'
import type { Problem } from './authoring'

/**
 * The editions step (EGS-32): the translator role turns the text catalog of the source language into the catalog of another edition. Pure parts
 * only (what is translated, how the answer is checked, how it is put together); the job is in `pipeline-handlers.ts`.
 *
 * What is translated: every string of `text/<sourceLang>.json` (and its `accepted` lists) **except** the keys that live in the target-language
 * catalog of a language course: the taught phrases are the same in every edition and are never translated. Keys, `{{gap}}` markers and
 * `{placeholders}` are kept as they are.
 */

/** One thing to translate: a key, its text and, for a typed answer, the accepted answers (first = canonical). */
export interface EditionEntry {
  key: string
  text?: string
  accepted?: string[]
}

/** The entries of the source catalog that an edition needs: the keys the target-language catalog does not hold. */
export function editionEntries(source: TextCatalog, target?: TextCatalog): EditionEntry[] {
  const taught = (key: string): boolean => !!target && (key in target.strings || key in (target.accepted ?? {}))
  const keys = [...new Set([...Object.keys(source.strings), ...Object.keys(source.accepted ?? {})])].filter((k) => !taught(k))
  return keys.map((key) => ({
    key,
    ...(source.strings[key] !== undefined ? { text: source.strings[key] } : {}),
    ...(source.accepted?.[key]?.length ? { accepted: source.accepted[key] } : {})
  }))
}

/** The entries in groups for one model call each: at most `maxEntries` and about `maxChars` of text (an entry larger than that goes alone). */
export function chunkEntries(entries: readonly EditionEntry[], maxEntries = 60, maxChars = 7000): EditionEntry[][] {
  const out: EditionEntry[][] = []
  let cur: EditionEntry[] = []
  let size = 0
  for (const e of entries) {
    const n = (e.text?.length ?? 0) + (e.accepted?.join('').length ?? 0) + e.key.length
    if (cur.length > 0 && (cur.length >= maxEntries || size + n > maxChars)) {
      out.push(cur)
      cur = []
      size = 0
    }
    cur.push(e)
    size += n
  }
  if (cur.length > 0) out.push(cur)
  return out
}

export const editionSchema = z.preprocess(
  dropNulls,
  z.object({
    items: z
      .array(
        z.object({
          key: z.string({ error: 'key must be the key of the entry' }).min(1),
          text: z.string({ error: 'text must be a string' }).optional(),
          accepted: z.array(z.string({ error: 'an accepted answer must be a string' })).optional()
        }),
        { error: 'items must be a list of {key, text, accepted?}' }
      )
      .min(1, 'give an item for every entry')
  })
)
export type EditionOutput = z.output<typeof editionSchema>

/** `{{g1}}` gap markers and `{name}` placeholders of a text, sorted: a translation keeps exactly the same ones. */
export const placeholdersOf = (s: string): string[] => (s.match(/\{\{[^{}]+\}\}|\{[A-Za-z_][\w.]*\}/g) ?? []).sort()

/** What the translation of `asked` gets wrong: a key missing or invented, an empty text, a lost or changed placeholder, a missing accepted list. */
export function checkEdition(asked: readonly EditionEntry[], out: EditionOutput): Problem[] {
  const problems: Problem[] = []
  const bad = (ref: string, issue: string, fix?: string): void => void problems.push({ ref, issue, ...(fix ? { fix } : {}), severity: 'major' })
  const got = new Map<string, EditionOutput['items'][number]>()
  for (const it of out.items) {
    if (got.has(it.key)) bad(it.key, 'this key is given twice', 'give each key once')
    got.set(it.key, it)
  }
  const wanted = new Set(asked.map((e) => e.key))
  for (const it of out.items) if (!wanted.has(it.key)) bad(it.key, 'this key was not asked for', 'remove it; use only the keys given')
  for (const e of asked) {
    const it = got.get(e.key)
    if (!it) {
      bad(e.key, 'missing: this key has no translation', 'add an item with this exact key')
      continue
    }
    if (e.text !== undefined) {
      if (!it.text?.trim()) bad(e.key, 'the text is missing or empty', 'translate "text"')
      else if (placeholdersOf(it.text).join('\u0000') !== placeholdersOf(e.text).join('\u0000')) bad(e.key, `the placeholders changed (the original has ${placeholdersOf(e.text).join(' ') || 'none'})`, 'keep every {{...}} and {...} exactly as it is, and add none')
    }
    if (e.accepted !== undefined) {
      if (!it.accepted?.length || it.accepted.some((a) => !a.trim())) bad(e.key, 'the accepted answers are missing or empty', 'give "accepted": the translated answers, the canonical one first')
      else if (placeholdersOf(it.accepted.join(' ')).join('\u0000') !== placeholdersOf(e.accepted.join(' ')).join('\u0000')) bad(e.key, 'the placeholders of the accepted answers changed')
    }
  }
  return problems
}

/** The strings and accepted lists of an answer, for the entries that were asked. */
export function applyEdition(asked: readonly EditionEntry[], out: EditionOutput, into: { strings: Record<string, string>; accepted: Record<string, string[]> }): void {
  const got = new Map(out.items.map((i) => [i.key, i]))
  for (const e of asked) {
    const it = got.get(e.key)!
    if (e.text !== undefined) into.strings[e.key] = it.text!.trim()
    if (e.accepted !== undefined) into.accepted[e.key] = it.accepted!.map((a) => a.trim())
  }
}

