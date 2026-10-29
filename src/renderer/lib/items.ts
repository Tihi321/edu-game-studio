import type { CourseItem, CoursePack, TextCatalog } from '../../shared/course'
import { ITEM_KINDS, formOf, makeTextResolver } from '../../shared/edu'
import type { TextPatchView } from '../../shared/protocol'

/**
 * The item editor's model: which texts an item has, where each lives (an edition's catalog or the target language's), what a draft changes,
 * and the `updateItem` arguments that save it. Pure, so it is unit-tested; the React editor only draws it.
 */

type Json = Record<string, unknown>
const asJson = (item: CourseItem): Json => item as unknown as Json

/** A text of the item: a catalog key with a human label, and what it holds in the edition being edited. */
export interface TextField {
  key: string
  /** The item path the key is used at, such as `options[1].why`. */
  path: string
  label: string
  role: 'string' | 'accepted'
  /** The text (`string`), or the accepted answers one per line (`accepted`). */
  value: string
}

/** What the editor changed: only the keys that were touched. */
export interface TextEdits {
  strings: Record<string, string>
  /** key -> the accepted answers, one per line in the box. */
  accepted: Record<string, string>
}

export const noEdits = (): TextEdits => ({ strings: {}, accepted: {} })
export const hasEdits = (e: TextEdits): boolean => Object.keys(e.strings).length > 0 || Object.keys(e.accepted).length > 0

const ordinal = (i: number): string => String(i + 1)

/** A label for a text path: `options[1].why` -> "Why option 2 is wrong". */
export function labelForPath(path: string): string {
  const fixed: Record<string, string> = {
    prompt: 'Question',
    explanation: 'Explanation',
    didYouKnow: 'Did you know',
    hint: 'Hint',
    text: 'Sentence with gaps',
    answer: 'Accepted answers',
    transcript: 'Transcript of the clip',
    back: 'Back of the card',
    why: 'Why the wrong choice is wrong'
  }
  if (fixed[path]) return fixed[path]
  let m = /^options\[(\d+)\]\.text$/.exec(path)
  if (m) return `Option ${ordinal(Number(m[1]))}`
  m = /^options\[(\d+)\]\.why$/.exec(path)
  if (m) return `Why option ${ordinal(Number(m[1]))} is wrong`
  m = /^gaps\[(\d+)\]\.answer$/.exec(path)
  if (m) return `Gap ${ordinal(Number(m[1]))}: accepted answers`
  m = /^gaps\[(\d+)\]\.bank\[(\d+)\]$/.exec(path)
  if (m) return `Gap ${ordinal(Number(m[1]))}: bank word ${ordinal(Number(m[2]))}`
  m = /^pairs\[(\d+)\]\.(left|right)$/.exec(path)
  if (m) return `Pair ${ordinal(Number(m[1]))}, ${m[2]} side`
  m = /^items\[(\d+)\]\.text$/.exec(path)
  if (m) return `Entry ${ordinal(Number(m[1]))}`
  m = /^items\[(\d+)\]\.when$/.exec(path)
  if (m) return `Entry ${ordinal(Number(m[1]))}: date or label`
  m = /^items\[(\d+)\]\.why$/.exec(path)
  if (m) return `Entry ${ordinal(Number(m[1]))}: why it belongs`
  m = /^groups\[(\d+)\]\.title$/.exec(path)
  if (m) return `Group ${ordinal(Number(m[1]))} title`
  m = /^regions\[(\d+)\]\.label$/.exec(path)
  if (m) return `Region ${ordinal(Number(m[1]))} label`
  m = /^regions\[(\d+)\]\.why$/.exec(path)
  if (m) return `Region ${ordinal(Number(m[1]))}: why it is wrong`
  m = /^words\[(\d+)\]\.answer$/.exec(path)
  if (m) return `Word ${ordinal(Number(m[1]))}: accepted answers`
  m = /^words\[(\d+)\]\.clue$/.exec(path)
  if (m) return `Word ${ordinal(Number(m[1]))}: clue`
  return path
}

/** Where the text of a key lives for an edition: its own catalog, else the target language's (the taught phrases), else the edition's (a new text). */
export function holderLang(key: string, lang: string, pack: Pick<CoursePack, 'targetLang'>, catalogs: Readonly<Record<string, TextCatalog>>): string {
  const has = (l: string | undefined): boolean => !!l && (catalogs[l]?.strings[key] !== undefined || !!catalogs[l]?.accepted?.[key])
  if (has(lang)) return lang
  if (has(pack.targetLang)) return pack.targetLang as string
  return lang
}

/** The texts of an item in an edition, each once, in the order the item uses them. */
export function itemTextFields(item: CourseItem, pack: Pick<CoursePack, 'targetLang'>, catalogs: Readonly<Record<string, TextCatalog>>, lang: string): TextField[] {
  const def = ITEM_KINDS.get(item.kind)
  if (!def) return []
  const text = makeTextResolver(catalogs, lang, pack.targetLang)
  const seen = new Set<string>()
  const out: TextField[] = []
  for (const r of def.textRefs(item)) {
    if (seen.has(r.key)) continue
    seen.add(r.key)
    out.push({ key: r.key, path: r.path, label: labelForPath(r.path), role: r.role, value: r.role === 'accepted' ? text.accepted(r.key).join('\n') : (text.text(r.key) ?? '') })
  }
  return out
}

/** The catalogs with the draft texts written in, for the live preview (nothing is saved). */
export function draftCatalogs(catalogs: Readonly<Record<string, TextCatalog>>, pack: Pick<CoursePack, 'targetLang'>, lang: string, edits: TextEdits): Record<string, TextCatalog> {
  const out: Record<string, TextCatalog> = { ...catalogs }
  const target = (key: string): string => holderLang(key, lang, pack, catalogs)
  const cat = (l: string): TextCatalog => out[l] ?? { schema: 1, lang: l, strings: {} }
  for (const [key, value] of Object.entries(edits.strings)) {
    const l = target(key)
    out[l] = { ...cat(l), strings: { ...cat(l).strings, [key]: value } }
  }
  for (const [key, raw] of Object.entries(edits.accepted)) {
    const l = target(key)
    const list = splitLines(raw)
    out[l] = { ...cat(l), accepted: { ...(cat(l).accepted ?? {}), ...(list.length > 0 ? { [key]: list } : {}) } }
  }
  return out
}

/** One answer per line: trimmed, empty lines dropped. */
export const splitLines = (raw: string): string[] => raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

/** The structural fields of an item the editor can change (the rest only changes through texts). */
const STRUCTURAL = ['difficulty', 'answer', 'answers', 'items', 'timeline'] as const

export interface SavePlan {
  patch: Record<string, unknown>
  text?: TextPatchView
}

/** What saving the draft sends: a merge patch of the changed structural fields (arrays whole) and the changed texts, by the catalog they live in. Null when nothing changed. */
export function buildSave(original: CourseItem, draft: CourseItem, edits: TextEdits, pack: Pick<CoursePack, 'targetLang'>, catalogs: Readonly<Record<string, TextCatalog>>, lang: string): SavePlan | null {
  const a = asJson(original)
  const b = asJson(draft)
  const patch: Record<string, unknown> = {}
  for (const f of STRUCTURAL) if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) patch[f] = b[f]
  const text: TextPatchView = {}
  for (const [key, value] of Object.entries(edits.strings)) {
    const l = holderLang(key, lang, pack, catalogs)
    ;((text[l] ??= {}).strings ??= {})[key] = value
  }
  for (const [key, raw] of Object.entries(edits.accepted)) {
    const list = splitLines(raw)
    if (list.length === 0) continue
    const l = holderLang(key, lang, pack, catalogs)
    ;((text[l] ??= {}).accepted ??= {})[key] = list
  }
  const hasText = Object.keys(text).length > 0
  if (Object.keys(patch).length === 0 && !hasText) return null
  return { patch, ...(hasText ? { text } : {}) }
}

// ---- structural helpers the editors share ----

export type Opt = { id: string; text: string }

/** The options of a choice item (`mcq`, `multi-select`, `listening` with options). */
export const optionsOf = (item: CourseItem): Opt[] => (Array.isArray(asJson(item).options) ? (asJson(item).options as Opt[]) : [])

export const withField = (item: CourseItem, field: string, value: unknown): CourseItem => ({ ...asJson(item), [field]: value }) as unknown as CourseItem

export function toggleIn(list: readonly string[], id: string, on: boolean, order: readonly string[]): string[] {
  const set = new Set(list)
  if (on) set.add(id)
  else set.delete(id)
  return order.filter((x) => set.has(x))
}

/** Moves entry `i` by `delta` places (the order editor); out of range is no move. */
export function moved<T>(list: readonly T[], i: number, delta: number): T[] {
  const j = i + delta
  if (j < 0 || j >= list.length) return [...list]
  const out = [...list]
  const [x] = out.splice(i, 1)
  out.splice(j, 0, x as T)
  return out
}

/** The kinds in a pack with their counts, for the filter select. */
export function kindCounts(pack: Pick<CoursePack, 'items'>): { kind: string; form: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const i of pack.items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1)
  return [...counts.entries()].map(([kind, count]) => ({ kind, form: formOf({ kind }), count })).sort((x, y) => x.form.localeCompare(y.form))
}
