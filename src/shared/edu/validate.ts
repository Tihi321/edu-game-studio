import { coursePackSchema, textCatalogSchema, type CourseAsset, type CoursePack, type TextCatalog } from '../course'
import './kinds'
import { ITEM_KINDS, type Problem, type TextRef, type ValidationContext } from './registry'
import { makeTextResolver } from './text'
import { validateShellSections } from '../shells'

/**
 * `validateCourse(pack, catalogs)`: the structural integrity of a course. It does NOT judge pedagogy (two forms per objective, distractor
 * rules, prerequisite cycles, placeholders): that is `edu_lint` (EGS-03), which can reuse `findUnitCycle`, `ITEM_KINDS[kind].distractors`
 * and the other helpers exported from here and from `course.ts`.
 *
 * Problem codes:
 *   SCHEMA                 zod: wrong type, missing or unknown field (pack, catalog or an item against its kind's schema)
 *   UNKNOWN_KIND           an item of a kind nobody registered
 *   DUPLICATE_ID           an id used twice in one collection (units, objectives, items, assets, cues, articles, facts, options, pairs ...)
 *   UNKNOWN_UNIT / UNKNOWN_OBJECTIVE / UNKNOWN_ASSET / UNKNOWN_FACT / UNKNOWN_ARTICLE   a reference to something that does not exist
 *   UNKNOWN_OPTION / UNKNOWN_GROUP / UNKNOWN_REGION   an answer key that points to no option, group or region
 *   MISSING_TEXT           a text key without a string (or, for a typed answer, without an accepted list) in an edition
 *   MISSING_WHY            a distractor without its misconception explanation key
 *   MISSING_GAP_MARKER     a cloze text without the {{gap}} marker of one of its gaps
 *   ASSET_KIND             an item needs an image or audio asset and got the other
 *   PUZZLE_UNPLACED / PUZZLE_INVALID   a crossword or word search whose words cannot be placed in an edition
 *   MISSING_CATALOG / CATALOG_LANG / UNKNOWN_LANGUAGE / SOURCE_LANG_NOT_LISTED   the languages and the text files do not agree
 *   SHELL_SCHEMA           a game shell's section (`shells.config[<shell>]`) does not parse; a section's broken references come with the
 *                          shell's own UNKNOWN_* codes (src/shared/shells)
 */

export interface ValidationResult {
  ok: boolean
  problems: Problem[]
  /** The parsed pack (defaults filled in, every item parsed by its kind's schema), when there are no problems. */
  pack?: CoursePack
  catalogs?: Record<string, TextCatalog>
}

const fmtPath = (path: readonly PropertyKey[]): string =>
  path.reduce<string>((s, p) => (typeof p === 'number' ? `${s}[${p}]` : s ? `${s}.${String(p)}` : String(p)), '')

const join = (a: string, b: string): string => (!b ? a : b.startsWith('[') ? `${a}${b}` : `${a}.${b}`)

function schemaProblems(prefix: string, issues: readonly { path: readonly PropertyKey[]; message: string }[]): Problem[] {
  return issues.map((i) => ({ code: 'SCHEMA', path: join(prefix, fmtPath(i.path)).replace(/^\./, ''), message: i.message }))
}

/** Catalogs may come as a record by language or as a list (each with its own `lang`). */
export type CatalogsInput = Readonly<Record<string, unknown>> | readonly unknown[]

export function validateCourse(packInput: unknown, catalogsInput: CatalogsInput = {}): ValidationResult {
  const problems: Problem[] = []
  const add = (code: string, path: string, message: string): void => {
    problems.push({ code, path, message })
  }

  const parsedPack = coursePackSchema.safeParse(packInput)
  if (!parsedPack.success) return { ok: false, problems: schemaProblems('', parsedPack.error.issues) }
  const pack: CoursePack = parsedPack.data

  // ---- catalogs ----
  const entries: [string, unknown][] = Array.isArray(catalogsInput)
    ? catalogsInput.map((c, i): [string, unknown] => [typeof (c as { lang?: unknown } | null)?.lang === 'string' ? (c as { lang: string }).lang : `#${i}`, c])
    : Object.entries(catalogsInput)
  const catalogs: Record<string, TextCatalog> = {}
  for (const [lang, raw] of entries) {
    const p = textCatalogSchema.safeParse(raw)
    if (!p.success) {
      problems.push(...schemaProblems(`text[${lang}]`, p.error.issues))
      continue
    }
    if (p.data.lang !== lang && !lang.startsWith('#')) add('CATALOG_LANG', `text[${lang}].lang`, `the catalog for "${lang}" says it is "${p.data.lang}"`)
    catalogs[p.data.lang] = p.data
  }
  const editions = pack.languages
  if (!editions.includes(pack.sourceLang)) add('SOURCE_LANG_NOT_LISTED', 'sourceLang', `the source language "${pack.sourceLang}" is not in languages`)
  const needed = [...new Set([...editions, ...(pack.targetLang ? [pack.targetLang] : [])])]
  for (const lang of needed) if (!catalogs[lang]) add('MISSING_CATALOG', `text[${lang}]`, `no text catalog for "${lang}" (course/text/${lang}.json)`)
  for (const lang of Object.keys(catalogs)) if (!needed.includes(lang)) add('UNKNOWN_LANGUAGE', `text[${lang}]`, `a catalog for "${lang}", which is not an edition or the target language`)

  // ---- duplicates ----
  const dups = (list: readonly { id: string }[], path: string): void => {
    const seen = new Set<string>()
    list.forEach((x, i) => {
      if (seen.has(x.id)) add('DUPLICATE_ID', `${path}[${i}].id`, `the id "${x.id}" is used twice in ${path}`)
      seen.add(x.id)
    })
  }
  dups(pack.units, 'units')
  dups(pack.objectives, 'objectives')
  dups(pack.items, 'items')
  dups(pack.assets, 'assets')
  dups(pack.cues, 'cues')
  dups(pack.encyclopedia.articles, 'encyclopedia.articles')
  dups(pack.factbase, 'factbase')

  // ---- references ----
  const units = new Set(pack.units.map((u) => u.id))
  const objectives = new Set(pack.objectives.map((o) => o.id))
  const assets = new Map<string, CourseAsset>(pack.assets.map((a) => [a.id, a]))
  const facts = new Set(pack.factbase.map((f) => f.id))
  const articles = new Set(pack.encyclopedia.articles.map((a) => a.id))
  const ref = (set: ReadonlySet<string> | ReadonlyMap<string, unknown>, id: string, code: string, path: string, what: string): void => {
    if (!set.has(id)) add(code, path, `unknown ${what} "${id}"`)
  }
  pack.units.forEach((u, i) => u.requires.forEach((r, j) => ref(units, r, 'UNKNOWN_UNIT', `units[${i}].requires[${j}]`, 'unit')))
  pack.objectives.forEach((o, i) => {
    ref(units, o.unit, 'UNKNOWN_UNIT', `objectives[${i}].unit`, 'unit')
    o.facts.forEach((f, j) => ref(facts, f, 'UNKNOWN_FACT', `objectives[${i}].facts[${j}]`, 'fact'))
  })
  pack.cues.forEach((c, i) => ref(assets, c.asset, 'UNKNOWN_ASSET', `cues[${i}].asset`, 'asset'))
  pack.encyclopedia.articles.forEach((a, i) => {
    if (a.asset) ref(assets, a.asset, 'UNKNOWN_ASSET', `encyclopedia.articles[${i}].asset`, 'asset')
    if (a.unit) ref(units, a.unit, 'UNKNOWN_UNIT', `encyclopedia.articles[${i}].unit`, 'unit')
    a.citations.forEach((f, j) => ref(facts, f, 'UNKNOWN_FACT', `encyclopedia.articles[${i}].citations[${j}]`, 'fact'))
    a.related.forEach((r, j) => ref(articles, r, 'UNKNOWN_ARTICLE', `encyclopedia.articles[${i}].related[${j}]`, 'article'))
  })

  // ---- text keys ----
  const textRefs: TextRef[] = [
    ...pack.units.flatMap((u, i) => [{ path: `units[${i}].title`, key: u.title }, ...(u.summary ? [{ path: `units[${i}].summary`, key: u.summary }] : [])]),
    ...pack.objectives.map((o, i) => ({ path: `objectives[${i}].text`, key: o.text })),
    ...pack.assets.map((a, i) => ({ path: `assets[${i}].alt`, key: a.alt })),
    ...pack.encyclopedia.articles.flatMap((a, i) => [
      { path: `encyclopedia.articles[${i}].title`, key: a.title },
      { path: `encyclopedia.articles[${i}].body`, key: a.body }
    ]),
    ...pack.factbase.flatMap((f, i) => (f.claim ? [{ path: `factbase[${i}].claim`, key: f.claim }] : []))
  ].map((r) => ({ ...r, role: 'string' as const }))
  const resolvers = Object.fromEntries(editions.map((l) => [l, makeTextResolver(catalogs, l, pack.targetLang)]))
  const checkText = (r: TextRef, path: string): void => {
    const missing = editions.filter((l) => {
      const res = resolvers[l]!
      return r.role === 'accepted' ? !res.hasAccepted(r.key) : !res.hasText(r.key)
    })
    if (missing.length === 0) return
    const what = r.role === 'accepted' ? 'accepted answers for' : 'a string for'
    add('MISSING_TEXT', path, `no ${what} key "${r.key}" in: ${missing.join(', ')}`)
  }
  for (const r of textRefs) checkText(r, r.path)

  // ---- game shell sections (shells.config[<shell>], src/shared/shells) ----
  const shells = validateShellSections(pack)
  problems.push(...shells.problems)
  for (const r of shells.textRefs) checkText(r, r.path)

  // ---- items ----
  const parsedItems = [...pack.items]
  const vctx: ValidationContext = { pack, catalogs, assets, languages: editions }
  pack.items.forEach((item, i) => {
    const at = `items[${i}]`
    ref(objectives, item.objective, 'UNKNOWN_OBJECTIVE', `${at}.objective`, 'objective')
    if (item.asset) ref(assets, item.asset, 'UNKNOWN_ASSET', `${at}.asset`, 'asset')
    const kind = ITEM_KINDS.get(item.kind)
    if (!kind) {
      add('UNKNOWN_KIND', `${at}.kind`, `no item kind "${item.kind}" is registered`)
      return
    }
    const parsed = kind.schema.safeParse(item)
    if (!parsed.success) {
      problems.push(...schemaProblems(at, parsed.error.issues))
      return
    }
    const it = parsed.data
    parsedItems[i] = it
    for (const r of kind.textRefs(it)) checkText(r, `${at}.${r.path}`)
    for (const d of kind.distractors?.(it) ?? []) if (!d.why) add('MISSING_WHY', `${at}.${d.path}`, `the distractor "${d.id}" has no why (the misconception it stands for)`)
    for (const p of kind.validate?.(it, vctx) ?? []) add(p.code, `${at}.${p.path}`, p.message)
  })

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, problems, pack: { ...pack, items: parsedItems }, catalogs }
}
